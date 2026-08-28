import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionContext,
  ChannelMessageActionName,
  ChannelMessageToolSchemaContribution,
} from "openclaw/plugin-sdk/channel-contract";
import { jsonResult } from "openclaw/plugin-sdk/agent-runtime";
import { loadOutboundMediaFromUrl } from "openclaw/plugin-sdk/outbound-media";
import {
  text as textContent,
  markdown as markdownContent,
  richlink as richlinkContent,
  app as appContent,
  attachment as attachmentContent,
  poll as pollContent,
  read as readContent,
  reply as replyContent,
  voice as voiceContent,
  contact as contactContent,
  type ContentInput,
} from "spectrum-ts";
import { effect as effectContent } from "@spectrum-ts/imessage";
import { resolveAccount } from "./channel.js";
import { resolveSpace, resolveMessage } from "./spectrum.js";

// Full-screen iMessage effects (spectrum-ts exposes the builder but not the
// id table, so we keep the canonical ids here).
const MESSAGE_EFFECTS: Record<string, string> = {
  balloons: "com.apple.messages.effect.CKBalloonEffect",
  celebration: "com.apple.messages.effect.CKHappyBirthdayEffect",
  confetti: "com.apple.messages.effect.CKConfettiEffect",
  echo: "com.apple.messages.effect.CKEchoEffect",
  fireworks: "com.apple.messages.effect.CKFireworksEffect",
  gentle: "com.apple.MobileSMS.expressivesend.gentle",
  heart: "com.apple.messages.effect.CKHeartEffect",
  invisible: "com.apple.MobileSMS.expressivesend.invisibleink",
  lasers: "com.apple.messages.effect.CKLasersEffect",
  loud: "com.apple.MobileSMS.expressivesend.loud",
  slam: "com.apple.MobileSMS.expressivesend.impact",
  sparkles: "com.apple.messages.effect.CKSparklesEffect",
  spotlight: "com.apple.messages.effect.CKSpotlightEffect",
};

// Base chat actions always available through the shared message tool.
const BASE_ACTIONS = ["send", "react", "read", "edit", "unsend", "reply"] as const;
// Feature-gated actions (default off; enable via channels.imessage-photon.*).
const MEDIA_ACTION = "sendAttachment";
const POLL_ACTION = "poll";
const EFFECT_ACTION = "sendWithEffect";
const CONTACT_ACTION = "sendContact";
// Note: there is no custom "sendVoice" action. OpenClaw's message-tool layer
// hard-codes which actions accept a target (MESSAGE_ACTION_TARGET_MODE), and
// unknown actions are rejected with "Action X does not accept a target".
// Voice is sent via sendAttachment with contentType audio/* instead.

const SUPPORTED = new Set<string>([
  ...BASE_ACTIONS,
  MEDIA_ACTION,
  POLL_ACTION,
  EFFECT_ACTION,
  CONTACT_ACTION,
]);

function readString(params: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = params[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function readStringArray(params: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const v = params[key];
    if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function readTarget(params: Record<string, unknown>): string | undefined {
  return readString(params, "to", "target", "phone", "phoneNumber", "number");
}

function readMessageId(params: Record<string, unknown>): string | undefined {
  return readString(params, "messageId", "message_id", "targetMessageId", "id");
}

/** Normalize an effect name to the iMessage effect id, or throw. */
function resolveEffect(name: string | undefined): string {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) throw new Error(`sendWithEffect requires effect (one of: ${Object.keys(MESSAGE_EFFECTS).join(", ")})`);
  const id = MESSAGE_EFFECTS[key];
  if (!id) throw new Error(`unsupported effect "${key}" (one of: ${Object.keys(MESSAGE_EFFECTS).join(", ")})`);
  return id;
}

/**
 * Read a media source from the agent's params into a sendable attachment.
 *
 * OpenClaw's message-tool layer can deliver media as either:
 *   - `params.buffer` (base64) — from local files / hosted hydration
 *   - `params.mediaUrl` / `media` / `filePath` / `path` — URL or sandbox path
 * We support both. Buffer input REQUIRES an explicit mimeType (no extension
 * to inspect), so we resolve contentType from params, then fall back to
 * extension/magic-byte sniffing via guessMimeType.
 */
async function readMediaContent(
  ctx: ChannelMessageActionContext,
  params: Record<string, unknown>,
): Promise<ContentInput> {
  // Render-friendly metadata
  const name =
    readString(params, "filename", "name", "fileName") ?? "attachment";
  const contentType = readString(params, "contentType", "mimeType");
  // Our own param names; accept Mouxy-style aliases only for tool compatibility
  const asVoice =
    params.asVoiceMessage === true ||
    params.asVoice === true ||
    params.as_voice === true;

  // 1) Hydrated base64 buffer
  const bufferB64 = typeof params.buffer === "string" ? params.buffer : undefined;
  if (bufferB64) {
    const buf = Buffer.from(bufferB64, "base64");
    const mime = contentType ?? guessMimeType(name, buf);
    if (!mime) {
      throw new Error(
        "Unable to resolve MIME type for attachment. Pass contentType/mimeType explicitly.",
      );
    }
    const builder = asVoice ? voiceContent : attachmentContent;
    return builder(buf, { name, mimeType: mime } as never);
  }

  // 2) mediaUrl / media / filePath / path (URL or sandbox path)
  const source =
    readString(params, "mediaUrl", "media", "media_url") ??
    readString(params, "filePath", "path", "file", "mediaPath");
  if (!source) throw new Error("sendAttachment requires buffer, mediaUrl/media, or filePath/path");

  const loaded = await loadOutboundMediaFromUrl(source, {
    maxBytes: typeof params.maxBytes === "number" ? params.maxBytes : 20 * 1024 * 1024,
    mediaAccess: ctx.mediaAccess,
    mediaLocalRoots: ctx.mediaLocalRoots,
    mediaReadFile: ctx.mediaReadFile,
  });
  const mime =
    contentType ??
    loaded.contentType ??
    guessMimeType(loaded.fileName ?? name, loaded.buffer);
  if (!mime) {
    throw new Error(
      "Unable to resolve MIME type for attachment. Pass contentType/mimeType explicitly.",
    );
  }
  const builder = asVoice ? voiceContent : attachmentContent;
  return builder(loaded.buffer, {
    name: loaded.fileName ?? name,
    mimeType: mime,
  } as never);
}

/** Best-effort MIME detection from a filename extension (or buffer magic bytes). */
function guessMimeType(filename: string | undefined, buf: Buffer | undefined): string | undefined {
  const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
  const byExt: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    ogg: "audio/ogg",
    mp4: "video/mp4",
    mov: "video/quicktime",
    m4v: "video/mp4",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    zip: "application/zip",
  };
  if (ext && byExt[ext]) return byExt[ext];
  if (buf && buf.length >= 8) {
    const hex = buf.subarray(0, 8).toString("hex");
    if (hex.startsWith("89504e47")) return "image/png";
    if (hex.startsWith("ffd8ff")) return "image/jpeg";
    if (hex.startsWith("47494638")) return "image/gif";
    if (hex.startsWith("52494646") && buf.subarray(8, 12).toString() === "WAVE") return "audio/wav";
    if (hex.startsWith("494433") || hex.startsWith("fffb") || hex.startsWith("fff3")) return "audio/mpeg";
    if (hex.startsWith("25504446")) return "application/pdf";
  }
  return undefined;
}

function actionOk(data: Record<string, unknown>): ReturnType<typeof jsonResult> {
  return jsonResult({ ok: true, ...data });
}

function actionError(message: string): ReturnType<typeof jsonResult> {
  return jsonResult({ ok: false, error: message });
}

/** Build the channel message-action adapter for iMessage via Photon. */
export function createMessageActions(): ChannelMessageActionAdapter {
  return {
    describeMessageTool: ({ cfg, accountId }) => {
      let account;
      try {
        account = resolveAccount(cfg, accountId);
      } catch {
        return null;
      }
      const actions: ChannelMessageActionName[] = [...BASE_ACTIONS] as ChannelMessageActionName[];
      if (account.enableMedia) actions.push(MEDIA_ACTION as ChannelMessageActionName);
      if (account.enablePoll) actions.push(POLL_ACTION as ChannelMessageActionName);
      if (account.enableEffects) actions.push(EFFECT_ACTION as ChannelMessageActionName);
      if (account.enableContact) actions.push(CONTACT_ACTION as ChannelMessageActionName);
      return {
        actions,
        mediaSourceParams: {
          sendAttachment: ["media", "mediaUrl", "filePath", "path", "file"],
        },
        // Expose rich-link and App-card capabilities on the shared send action.
        schema: [
          {
            properties: {
              url: Type.String({
                description:
                  "HTTPS URL to send as a rich link-preview message (iMessage renders it as a link card). Mutually exclusive with text/markdown/appUrl.",
              }),
              link: Type.String({
                description:
                  "Alias for url: HTTPS URL to send as a rich link-preview message.",
              }),
              appUrl: Type.String({
                description:
                  "HTTPS URL to send as a native iMessage App card (Spectrum App host). Recipient opens it in the Spectrum iMessage App without leaving Messages; degrades to a link preview on unsupported platforms. Mutually exclusive with text/markdown/url.",
              }),
              appLive: Type.Optional(
                Type.Boolean({
                  description:
                    "When sending an App card (appUrl set), request live in-transcript rendering (MSMessageLiveLayout). Requires the recipient to have the Spectrum App extension installed.",
                }),
              ),
            },
            actions: ["send"],
            visibility: "current-channel",
          } as ChannelMessageToolSchemaContribution,
        ],
      };
    },
    supportsAction: ({ action }) => SUPPORTED.has(action),
    resolveExecutionMode: () => "gateway",
    handleAction: async (ctx: ChannelMessageActionContext) => {
      const { action, params } = ctx;
      const actionName = action as string;
      try {
        const to = readTarget(params);
        const space = to ? resolveSpace(to) : undefined;
        if (!space) {
          return actionError(`no known iMessage space for target "${to ?? "(none)"}". The user must message the bot first.`);
        }

        switch (actionName) {
          case "send": {
            const text = readString(params, "text", "message", "content");
            const url = readString(params, "url", "link");
            const appUrl = readString(params, "appUrl", "app_url", "cardUrl");
            if (appUrl) {
              const live = params.appLive === true || params.appLive === "true" || params.live === true || params.live === "true";
              await space.send(appContent(appUrl, live ? { live: true } : undefined));
              return actionOk({ to, type: "app", url: appUrl, live });
            }
            if (url) {
              await space.send(richlinkContent(url));
              return actionOk({ to, type: "richlink", url });
            }
            const md = readString(params, "markdown", "md");
            if (md) {
              await space.send(markdownContent(md));
              return actionOk({ to, type: "markdown" });
            }
            if (!text) throw new Error("send requires text/message/content (or url/link, or appUrl)");
            await space.send(textContent(text));
            return actionOk({ to, type: "text" });
          }
          case "sendAttachment": {
            const content = await readMediaContent(ctx, params);
            await space.send(content);
            return actionOk({ to, type: "attachment" });
          }
          case "poll": {
            const question = readString(params, "pollQuestion", "question", "title", "text", "message");
            const options = readStringArray(params, "pollOptions", "options", "pollOption", "choices");
            if (!question) throw new Error("poll requires pollQuestion/question/title");
            if (options.length < 2) throw new Error("poll requires at least two options");
            await space.send(pollContent(question, ...options));
            return actionOk({ to, type: "poll", question, optionCount: options.length });
          }
          case "sendWithEffect": {
            const text = readString(params, "text", "message", "content");
            const effectName = readString(params, "effect", "effectId");
            if (!text) throw new Error("sendWithEffect requires text/message/content");
            await space.send(effectContent(markdownContent(text), resolveEffect(effectName) as never));
            return actionOk({ to, type: "effect", effect: effectName });
          }
          case "sendContact": {
            const input =
              readString(params, "name", "contactName") ??
              readString(params, "phone", "contactPhone") ??
              readString(params, "email", "contactEmail");
            if (!input) throw new Error("sendContact requires name, phone, or email");
            const contactValue = readString(params, "name", "contactName") ?? input;
            const phone = readString(params, "phone", "contactPhone");
            const email = readString(params, "email", "contactEmail");
            // contact() accepts a phone/email string or ContactInput; build
            // a phone-number contact when possible.
            await space.send(contactContent(phone ?? email ?? contactValue) as never);
            return actionOk({ to, type: "contact" });
          }
          case "sendVoice": {
            // Kept for backward compatibility: voice is sent through the media
            // path (audio/* contentType).
            const content = await readMediaContent(ctx, params);
            await space.send(content);
            return actionOk({ to, type: "voice" });
          }
          case "react": {
            const target = resolveMessage(readMessageId(params));
            if (!target) return actionError("react requires messageId of a recent message");
            const emoji = readString(params, "emoji", "reaction");
            if (!emoji) throw new Error("react requires emoji");
            await target.react(emoji);
            return actionOk({ to, emoji });
          }
          case "read": {
            const target = resolveMessage(readMessageId(params));
            if (target) await target.read();
            else await space.send(readContent(target ?? ({} as never)));
            return actionOk({ to });
          }
          case "edit": {
            const target = resolveMessage(readMessageId(params));
            if (!target) return actionError("edit requires messageId of a recent message");
            const text = readString(params, "text", "message", "content");
            if (!text) throw new Error("edit requires text/message/content");
            await target.edit(textContent(text));
            return actionOk({ to });
          }
          case "unsend": {
            const target = resolveMessage(readMessageId(params));
            if (!target) return actionError("unsend requires messageId of a recent message");
            await target.unsend();
            return actionOk({ to });
          }
          case "reply": {
            const target = resolveMessage(readMessageId(params));
            const text = readString(params, "text", "message", "content");
            if (!target) return actionError("reply requires messageId of a recent message");
            if (!text) throw new Error("reply requires text/message/content");
            await space.send(replyContent(textContent(text), target));
            return actionOk({ to });
          }
          default:
            return actionError(`unsupported action: ${actionName}`);
        }
      } catch (err) {
        return actionError(`imessage-photon ${actionName}: ${(err as Error).message}`);
      }
    },
  };
}
