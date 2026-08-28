import type { Message, Space } from "spectrum-ts";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { createChannelMessageReplyPipeline } from "openclaw/plugin-sdk/channel-outbound";
import { sendText, phoneFromSpaceId, normalizePhone } from "./spectrum.js";
import { resolveAccount, type ResolvedAccount } from "./channel.js";

const CHANNEL = "imessage-photon";
const AGENT_ID = "main";

/**
 * Minimal surface of the channel runtime helpers injected by the gateway
 * (`ctx.channelRuntime`). Typed loosely here because the SDK exports the
 * full surface as a compatibility type.
 */
export type ChannelRuntime = {
  inbound: {
    run: (params: unknown) => Promise<unknown>;
    buildContext: (params: unknown) => Promise<Record<string, unknown>>;
  };
  routing: {
    buildAgentSessionKey: (params: {
      agentId: string;
      channel: string;
      accountId?: string | null;
      peer?: { kind: string; id: string } | null;
    }) => string;
  };
  session: {
    resolveStorePath: (store?: string, opts?: { agentId?: string }) => string;
    recordInboundSession: (params: unknown) => Promise<unknown>;
  };
  reply: {
    dispatchReplyWithBufferedBlockDispatcher: (params: unknown) => Promise<unknown>;
  };
  reactions: {
    createAckReactionHandle: (params: unknown) => unknown | null;
    removeAckReactionHandleAfterReply: (params: unknown) => void;
  };
  media: {
    saveMediaBuffer: (
      buffer: Buffer,
      contentType?: string,
      subdir?: string,
      maxBytes?: number,
      originalFilename?: string,
    ) => Promise<{ id: string; path: string; size: number; contentType?: string }>;
  };
};

type ReactionContent = {
  type: "reaction";
  emoji?: string;
  kind?: string;
  target?: { content?: { type?: string; text?: string } };
  targetGuid?: string;
};

function senderPhone(space: Space, message: Message): string | undefined {
  const sender = (message as unknown as { sender?: { id?: string } }).sender?.id;
  return normalizePhone(sender) ?? phoneFromSpaceId(space.id);
}

function isAllowed(space: Space, message: Message, allowFrom: string[]): boolean {
  if (allowFrom.length === 0) return true;
  const phone = senderPhone(space, message);
  return Boolean(phone && allowFrom.includes(phone));
}

/** Handle one inbound Spectrum message: text -> agent turn, reaction -> tapback. */
export async function handleInbound(
  runtime: ChannelRuntime,
  cfg: OpenClawConfig,
  space: Space,
  message: Message,
  log?: (msg: string) => void,
): Promise<void> {
  const account = resolveAccount(cfg);
  if (!isAllowed(space, message, account.allowFrom)) {
    log?.(`[imessage-photon] blocked (not allowlisted): ${space.id}`);
    return;
  }
  if (message.content.type === "text") {
    await dispatchText(runtime, cfg, space, message, account, log);
  } else if (message.content.type === "reaction") {
    await dispatchTapback(runtime, cfg, space, message, account, log);
  } else if (message.content.type === "voice" || message.content.type === "attachment") {
    await dispatchMedia(runtime, cfg, space, message, account, log);
  } else if (message.content.type === "reply") {
    await dispatchReply(runtime, cfg, space, message, account, log);
  } else if (message.content.type === "poll" || message.content.type === "poll_option") {
    await dispatchPollEvent(runtime, cfg, space, message, account, log);
  } else if (message.content.type === "edit" || message.content.type === "unsend") {
    // edit/unsend from the user are system events: log only (no agent turn).
    log?.(`[imessage-photon] system event type=${message.content.type} from ${space.id}`);
  } else {
    // System events (read, typing, contact, group ops, rename, ...) and any
    // unknown types are logged, never silently dropped.
    log?.(`[imessage-photon] system event type=${message.content.type} from ${space.id}`);
  }
}

/** Shared turn dispatch: build session route + context, then run the agent. */
async function runAgentTurn(
  runtime: ChannelRuntime,
  cfg: OpenClawConfig,
  space: Space,
  message: Message,
  account: ResolvedAccount,
  log: ((msg: string) => void) | undefined,
  opts: {
    rawText: string;
    textForAgent?: string;
    messageId: string;
    timestamp?: number;
    /** Tapbacks don't need a seen-ack reaction (and iMessage rejects reacting to a reaction). */
    ackEnabled?: boolean;
    /** Inbound media facts so OpenClaw's media-understanding pipeline (e.g. Deepgram STT) kicks in. */
    media?: { path: string; contentType?: string; kind?: string; messageId?: string }[];
  },
): Promise<void> {
  const phone = senderPhone(space, message) ?? space.id;
  const senderName = (message as unknown as { sender?: { name?: string } }).sender?.name;

  // Read receipt: mark the conversation read (iMessage marks the whole chat).
  if (account.enableReadReceipts) {
    message.read().catch((err: unknown) => log?.(`[imessage-photon] read receipt failed: ${String(err)}`));
  }

  // Typing indicator while the agent processes.
  const stopTyping = async (): Promise<void> => {
    if (account.enableTyping) {
      space.stopTyping().catch((err: unknown) => log?.(`[imessage-photon] stopTyping failed: ${String(err)}`));
    }
  };
  if (account.enableTyping) {
    space.startTyping().catch((err: unknown) => log?.(`[imessage-photon] startTyping failed: ${String(err)}`));
  }

  // Seen-ack: native ack-reaction handle; removed after the reply is delivered.
  const ackReaction =
    opts.ackEnabled === false
      ? ""
      : account.ackReaction ||
        (cfg.messages as { ackReaction?: string } | undefined)?.ackReaction ||
        "";
  let ackReactionMsg: Message | undefined;
  let ackHandle: ReturnType<typeof runtime.reactions.createAckReactionHandle> | null = null;
  if (ackReaction) {
    ackHandle = runtime.reactions.createAckReactionHandle({
      ackReactionValue: ackReaction,
      send: async () => {
        ackReactionMsg = await message.react(ackReaction);
        if (!ackReactionMsg) throw new Error("platform did not accept ack reaction");
      },
      remove: async () => {
        await ackReactionMsg?.unsend();
      },
      onSendError: (err: unknown) => log?.(`[imessage-photon] ack send failed: ${String(err)}`),
    } as never);
  }

  const replyPipeline = createChannelMessageReplyPipeline({
    cfg,
    agentId: AGENT_ID,
    channel: CHANNEL,
  });

  await runtime.inbound.run({
    channel: CHANNEL,
    raw: message,
    adapter: {
      ingest: (raw: Message) => ({
        id: opts.messageId,
        timestamp: opts.timestamp,
        rawText: opts.rawText,
        textForAgent: opts.textForAgent,
        raw,
      }),
      resolveTurn: async (input: unknown) => {
        const routeSessionKey = runtime.routing.buildAgentSessionKey({
          agentId: AGENT_ID,
          channel: CHANNEL,
          peer: { kind: "direct", id: phone },
        });
        const storePath = runtime.session.resolveStorePath(cfg.session?.store, {
          agentId: AGENT_ID,
        });
        const ctxPayload = await runtime.inbound.buildContext({
          channel: CHANNEL,
          from: phone,
          sender: { id: phone, name: senderName },
          conversation: { kind: "direct", id: space.id },
          route: { agentId: AGENT_ID, routeSessionKey },
          reply: { to: phone, sourceReplyDeliveryMode: "reply" },
          message: { rawBody: opts.rawText, bodyForAgent: opts.textForAgent },
          media: opts.media as never,
          timestamp: opts.timestamp,
          messageId: opts.messageId,
        });
        return {
          channel: CHANNEL,
          routeSessionKey,
          storePath,
          ctxPayload,
          recordInboundSession: runtime.session.recordInboundSession,
          runDispatch: () =>
            runtime.reply.dispatchReplyWithBufferedBlockDispatcher({
              ctx: ctxPayload,
              cfg,
              dispatcherOptions: {
                ...replyPipeline,
                deliver: async (payload: { text?: string }) => {
                  if (payload.text) {
                    await sendText(space, payload.text);
                  }
                  await stopTyping();
                  // Reply delivered: remove the seen-ack reaction.
                  if (ackHandle) {
                    runtime.reactions.removeAckReactionHandleAfterReply({
                      removeAfterReply: true,
                      ackReaction: ackHandle,
                      onError: (err: unknown) =>
                        log?.(`[imessage-photon] ack remove failed: ${String(err)}`),
                    });
                  }
                },
              },
            }),
        };
      },
    },
  } as never);
}

/** Inbound text message -> agent turn. */
async function dispatchText(
  runtime: ChannelRuntime,
  cfg: OpenClawConfig,
  space: Space,
  message: Message,
  account: ResolvedAccount,
  log: ((msg: string) => void) | undefined,
): Promise<void> {
  if (message.content.type !== "text") return;
  const text = message.content.text;
  log?.(`[imessage-photon] ${space.id} -> agent: ${text.slice(0, 120)}`);
  await runAgentTurn(runtime, cfg, space, message, account, log, {
    rawText: text,
    messageId: message.id,
    timestamp: message.timestamp?.getTime(),
  });
}

/** Inbound tapback (reaction) -> forwarded to the agent as a system event. */
async function dispatchTapback(
  runtime: ChannelRuntime,
  cfg: OpenClawConfig,
  space: Space,
  message: Message,
  account: ResolvedAccount,
  log: ((msg: string) => void) | undefined,
): Promise<void> {
  if (account.tapbackNotifications === "off") {
    log?.(`[imessage-photon] tapback ignored (notifications=off): ${space.id}`);
    return;
  }
  const c = message.content as unknown as ReactionContent;
  const emoji = c.emoji ?? c.kind ?? "?";
  const targetText = c.target?.content?.text ?? c.targetGuid ?? "上一条消息";
  const hint = `[Tapback] 用户对你发的消息「${targetText}」点了 ${emoji}。请回复一句简短的回应（可选）。`;
  log?.(`[imessage-photon] tapback ${emoji} from ${space.id}`);
  await runAgentTurn(runtime, cfg, space, message, account, log, {
    rawText: hint,
    textForAgent: hint,
    messageId: message.id,
    timestamp: message.timestamp?.getTime(),
    ackEnabled: false,
  });
}

/** Inbound media (voice / attachment) -> saved to the media store, then the agent is told where it landed. */
async function dispatchMedia(
  runtime: ChannelRuntime,
  cfg: OpenClawConfig,
  space: Space,
  message: Message,
  account: ResolvedAccount,
  log: ((msg: string) => void) | undefined,
): Promise<void> {
  const c = message.content as unknown as {
    type: "voice" | "attachment";
    read?: () => Promise<Buffer>;
    mimeType?: string;
    name?: string;
  };
  const kind = c.type === "voice" ? "语音" : "媒体";
  const mime = c.mimeType ?? "application/octet-stream";
  const name = c.name ?? (c.type === "voice" ? "voice.m4a" : "attachment.bin");
  try {
    if (typeof c.read !== "function") {
      log?.(`[imessage-photon] inbound ${kind} has no read(): ${space.id}`);
      return;
    }
    const buf = await c.read();
    const saved = await runtime.media.saveMediaBuffer(buf, mime, "inbound", undefined, name);
    const mediaKind = c.type === "voice" ? "audio" : "image";
    const hint = `[iMessage] 用户发来一条${kind}消息（已保存到 media store）。请查看内容并回应。`;
    log?.(`[imessage-photon] inbound ${kind} saved to ${saved.path} (mediaKind=${mediaKind})`);
    await runAgentTurn(runtime, cfg, space, message, account, log, {
      rawText: hint,
      textForAgent: hint,
      messageId: message.id,
      timestamp: message.timestamp?.getTime(),
      ackEnabled: false,
      media: [
        {
          path: saved.path,
          contentType: mime,
          kind: mediaKind,
          messageId: message.id,
        },
      ],
    });
  } catch (err) {
    log?.(`[imessage-photon] inbound ${kind} handling failed: ${String(err)}`);
  }
}

/** Inbound reply (quoted message) -> forward the inner text to the agent. */
async function dispatchReply(
  runtime: ChannelRuntime,
  cfg: OpenClawConfig,
  space: Space,
  message: Message,
  account: ResolvedAccount,
  log: ((msg: string) => void) | undefined,
): Promise<void> {
  const c = message.content as unknown as {
    type: "reply";
    content?: { type?: string; text?: string; markdown?: string };
    target?: { content?: { type?: string; text?: string; markdown?: string } };
  };
  const inner = c.content;
  const innerType = inner?.type ?? "unknown";
  if (innerType === "attachment" || innerType === "voice") {
    // The quoted media isn't directly readable here; tell the agent about it.
    const hint = `[iMessage] 用户引用了一条${innerType === "voice" ? "语音" : "媒体"}消息回复。请回应一句简短确认。`;
    await runAgentTurn(runtime, cfg, space, message, account, log, {
      rawText: hint,
      textForAgent: hint,
      messageId: message.id,
      timestamp: message.timestamp?.getTime(),
      ackEnabled: false,
    });
    return;
  }
  const text = inner?.type === "markdown" ? inner.markdown : inner?.text;
  const quoted = c.target?.content && (c.target.content as { type?: string }).type !== "reaction"
    ? (c.target.content as { text?: string; markdown?: string }).text ??
      (c.target.content as { markdown?: string }).markdown ??
      ""
    : "";
  if (!text) {
    log?.(`[imessage-photon] reply with empty inner text (type=${innerType})`);
    return;
  }
  const prompt = quoted
    ? `[iMessage 引用回复] 用户引用了你的消息「${quoted.slice(0, 200)}」并回复：${text}`
    : `[iMessage 引用回复] ${text}`;
  log?.(`[imessage-photon] reply -> agent: ${prompt.slice(0, 120)}`);
  await runAgentTurn(runtime, cfg, space, message, account, log, {
    rawText: prompt,
    textForAgent: prompt,
    messageId: message.id,
    timestamp: message.timestamp?.getTime(),
  });
}

/** Inbound poll event (user voting / poll appearance) -> notify the agent. */
async function dispatchPollEvent(
  runtime: ChannelRuntime,
  cfg: OpenClawConfig,
  space: Space,
  message: Message,
  account: ResolvedAccount,
  log: ((msg: string) => void) | undefined,
): Promise<void> {
  const c = message.content as unknown as {
    type: "poll" | "poll_option";
    title?: string;
    options?: { title?: string }[];
    option?: { title?: string };
    poll?: { title?: string };
  };
  let hint: string;
  if (c.type === "poll_option" && c.option?.title) {
    const pollTitle = c.poll?.title ?? c.title ?? "某投票";
    hint = `[iMessage 投票] 用户在投票「${pollTitle}」中选择了「${c.option.title}」。需要时可以简短确认或继续对话。`;
  } else {
    hint = `[iMessage 投票] ${c.title ?? "用户发起/更新了一个投票"}${c.options?.length ? `（选项：${c.options.map((o) => o.title).join(" / ")}）` : ""}`;
  }
  await runAgentTurn(runtime, cfg, space, message, account, log, {
    rawText: hint,
    textForAgent: hint,
    messageId: message.id,
    timestamp: message.timestamp?.getTime(),
    ackEnabled: false,
  });
}
