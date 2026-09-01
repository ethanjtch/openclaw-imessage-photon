import {
  createChatChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/channel-core";
import type { ChannelSetupWizard } from "openclaw/plugin-sdk/channel-setup";
import { connectSpectrum, resetSpectrum, rememberSpace, rememberMessage } from "./spectrum.js";
import { handleInbound, type ChannelRuntime } from "./inbound.js";
import { createMessageActions } from "./actions.js";

/**
 * Resolved account: credentials + policy for one iMessage (Photon) account.
 * Values come from `channels.imessage-photon.*` config, falling back to env:
 *   SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET / SPECTRUM_ALLOWED_NUMBERS
 */
export type ResolvedAccount = {
  accountId: string | null;
  projectId: string;
  projectSecret: string;
  allowFrom: string[];
  dmPolicy: string | undefined;
  ackReaction: string;
  tapbackNotifications: "off" | "all";
  // Feature switches (all default off; spectrum-ts native capabilities).
  enableMedia: boolean;
  enablePoll: boolean;
  enableEffects: boolean;
  enableContact: boolean;
  enableVoice: boolean;
  enableGroups: boolean;
  enableTyping: boolean;
  enableReadReceipts: boolean;
};

function channelSection(cfg: OpenClawConfig): Record<string, unknown> | undefined {
  return (cfg.channels as Record<string, any> | undefined)?.["imessage-photon"];
}

function readAllowFrom(section: Record<string, unknown> | undefined): string[] {
  const fromConfig = section?.allowFrom;
  if (Array.isArray(fromConfig)) return fromConfig.map(String);
  const fromEnv = process.env.SPECTRUM_ALLOWED_NUMBERS ?? "";
  return fromEnv.split(",").map((s) => s.trim()).filter(Boolean);
}

export function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedAccount {
  const section = channelSection(cfg);
  const projectId = (section?.projectId as string | undefined) ?? process.env.SPECTRUM_PROJECT_ID ?? "";
  const projectSecret = (section?.projectSecret as string | undefined) ?? process.env.SPECTRUM_PROJECT_SECRET ?? "";
  if (!projectId || !projectSecret) {
    throw new Error(
      "imessage-photon: SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET are required " +
        "(set channels.imessage-photon.projectId/projectSecret or the env vars)",
    );
  }
  return {
    accountId: accountId ?? null,
    projectId,
    projectSecret,
    allowFrom: readAllowFrom(section),
    dmPolicy: section?.dmSecurity as string | undefined,
    ackReaction: (section?.ackReaction as string | undefined) ?? "👀",
    tapbackNotifications: (section?.tapbackNotifications as "off" | "all" | undefined) ?? "all",
    enableMedia: Boolean(section?.enableMedia),
    enablePoll: Boolean(section?.enablePoll),
    enableEffects: Boolean(section?.enableEffects),
    enableContact: Boolean(section?.enableContact),
    enableVoice: Boolean(section?.enableVoice),
    enableGroups: Boolean(section?.enableGroups),
    enableTyping: Boolean(section?.enableTyping),
    enableReadReceipts: Boolean(section?.enableReadReceipts),
  };
}

const setupWizard: ChannelSetupWizard = {
  channel: "imessage-photon",
  status: {
    configuredLabel: "Connected",
    unconfiguredLabel: "Not configured",
    resolveConfigured: ({ cfg }) => {
      const s = channelSection(cfg);
      if (s?.projectId && s?.projectSecret) return true;
      return Boolean(process.env.SPECTRUM_PROJECT_ID && process.env.SPECTRUM_PROJECT_SECRET);
    },
  },
  credentials: [
    {
      inputKey: "token",
      providerHint: "imessage-photon",
      credentialLabel: "Photon project ID",
      preferredEnvVar: "SPECTRUM_PROJECT_ID",
      envPrompt: "Use SPECTRUM_PROJECT_ID from the environment?",
      keepPrompt: "Keep the current project ID?",
      inputPrompt: "Paste your Photon project ID:",
      helpTitle: "Where do I find this?",
      helpLines: [
        "1. Sign up at https://photon.codes",
        "2. Create a project and select the iMessage provider",
        "3. Copy the Project ID from the project settings page",
      ],
      inspect: ({ cfg }) => {
        const s = channelSection(cfg);
        const v = (s?.projectId as string | undefined) ?? process.env.SPECTRUM_PROJECT_ID;
        return {
          accountConfigured: Boolean(s?.projectId),
          hasConfiguredValue: Boolean(v),
          resolvedValue: v,
        };
      },
      applySet: ({ cfg, value }) => ({
        ...cfg,
        channels: {
          ...cfg.channels,
          "imessage-photon": { ...channelSection(cfg), projectId: String(value) },
        },
      }),
    },
    {
      inputKey: "secret",
      providerHint: "imessage-photon",
      credentialLabel: "Photon project secret",
      preferredEnvVar: "SPECTRUM_PROJECT_SECRET",
      envPrompt: "Use SPECTRUM_PROJECT_SECRET from the environment?",
      keepPrompt: "Keep the current project secret?",
      inputPrompt: "Paste your Photon project secret:",
      helpTitle: "Where do I find this?",
      helpLines: [
        "The project secret is only shown once when you create the project.",
        "If you lost it, rotate it from the project settings page.",
      ],
      inspect: ({ cfg }) => {
        const s = channelSection(cfg);
        const v = (s?.projectSecret as string | undefined) ?? process.env.SPECTRUM_PROJECT_SECRET;
        return {
          accountConfigured: Boolean(s?.projectSecret),
          hasConfiguredValue: Boolean(v),
          resolvedValue: v,
        };
      },
      applySet: ({ cfg, value }) => ({
        ...cfg,
        channels: {
          ...cfg.channels,
          "imessage-photon": { ...channelSection(cfg), projectSecret: String(value) },
        },
      }),
    },
  ],
  textInputs: [
    {
      inputKey: "dmAllowlist",
      message: "Allowed sender phone numbers (comma-separated, E.164 like +8613800138000). Leave empty to allow everyone:",
      placeholder: "+8613800138000,+14155550123",
      required: false,
      helpTitle: "Who can message the agent?",
      helpLines: [
        "Enter phone numbers in E.164 form. Empty = anyone can DM the agent.",
        "This is the same as channels.imessage-photon.allowFrom.",
      ],
      currentValue: ({ cfg }) => {
        const s = channelSection(cfg);
        if (Array.isArray(s?.allowFrom)) return (s.allowFrom as string[]).join(",");
        return process.env.SPECTRUM_ALLOWED_NUMBERS ?? "";
      },
      applySet: ({ cfg, value }) => ({
        ...cfg,
        channels: {
          ...cfg.channels,
          "imessage-photon": {
            ...channelSection(cfg),
            allowFrom: value.split(",").map((s) => s.trim()).filter(Boolean),
          },
        },
      }),
    },
  ],
};

export const imessagePhotonPlugin = createChatChannelPlugin<ResolvedAccount>({
  base: {
    id: "imessage-photon",
    meta: {
      id: "imessage-photon",
      label: "iMessage (Photon)",
      selectionLabel: "iMessage via Photon Spectrum Cloud",
      docsPath: "https://github.com/ethanjtch/openclaw-imessage-photon",
      blurb: "iMessage through Photon Spectrum Cloud — no Mac required.",
      markdownCapable: false,
    },
    capabilities: {
      chatTypes: ["direct"],
      reactions: true,
      reply: true,
    },
    actions: createMessageActions(),
    agentPrompt: {
      // Text guidance layered on top of the fixed openclaw message-tool
      // schema: keep replies as plain text by default, and only use
      // reply-quoting when the user themselves quoted a message.
      messageToolHints: ({ cfg }) => {
        const account = resolveAccount(cfg);
        const hints = [
          "Prefer plain text (text) over markdown (markdown) unless the recipient explicitly asked for rich formatting. Plain text renders best in iMessage.",
          "For everyday replies use the plain send action without quotes.",
        ];
        if (account.enableMedia) {
          hints.push("Images/audio/video/files are sent with sendAttachment (media/buffer/filePath).");
        }
        return hints;
      },
      inboundFormattingHints: () => ({
        text_markup: "plain text",
        rules: [
          "When the user's message is a reply-to (quoted) message, reply by quoting that message back using the reply action with its messageId — this keeps the quoted conversation thread visible in iMessage.",
          "When the user's message is NOT a reply, reply with a plain send (no quote).",
        ],
      }),
    },
    setupWizard,
    config: {
      listAccountIds: () => ["default"],
      resolveAccount,
      inspectAccount(cfg, _accountId) {
        const s = channelSection(cfg);
        const hasCfg = Boolean(s?.projectId && s?.projectSecret);
        const hasEnv = Boolean(process.env.SPECTRUM_PROJECT_ID && process.env.SPECTRUM_PROJECT_SECRET);
        return {
          enabled: hasCfg || hasEnv,
          configured: hasCfg || hasEnv,
          projectIdStatus: s?.projectId || process.env.SPECTRUM_PROJECT_ID ? "available" : "missing",
          projectSecretStatus: s?.projectSecret || process.env.SPECTRUM_PROJECT_SECRET ? "available" : "missing",
        };
      },
    },
    // Directory: give iMessage contacts a friendly display name so sessions
    // show "iMessage <last4>" instead of the raw E.164 number.
    directory: {
      listPeers: async ({ cfg }) => {
        const account = resolveAccount(cfg);
        const peers = account.allowFrom ?? [];
        return peers.map((raw) => {
          const id = String(raw).trim();
          if (!id) return null;
          const tail = id.slice(-4);
          return { kind: "user", id, name: `iMessage ${tail}` };
        }).filter((e): e is { kind: "user"; id: string; name: string } => e !== null);
      },
    },
    setup: {
      applyAccountConfig: ({ cfg, input }) => ({
        ...cfg,
        channels: {
          ...cfg.channels,
          "imessage-photon": { ...channelSection(cfg), ...input },
        },
      }),
    },
    gateway: {
      startAccount: async (ctx) => {
        const log = (msg: string) => ctx.log?.info?.(msg);
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        const channelRuntime = ctx.channelRuntime as unknown as ChannelRuntime;

        // Reconnect loop: if the Spectrum stream ever ends (transport drop,
        // transient error), back off and re-create the connection instead of
        // leaving the channel dead until a manual gateway restart.
        let backoffMs = 1_000;
        while (!ctx.abortSignal.aborted) {
          try {
            log("[imessage-photon] connecting to Spectrum Cloud...");
            const app = await connectSpectrum(ctx.account.projectId, ctx.account.projectSecret);
            log(`[imessage-photon] connected to Spectrum Cloud (allowlist: ${
              ctx.account.allowFrom.length ? ctx.account.allowFrom.join(", ") : "ALL"
            })`);
            backoffMs = 1_000;
            for await (const [space, message] of app.messages) {
              if (ctx.abortSignal.aborted) break;
              rememberSpace(space);
              rememberMessage(message);
              handleInbound(channelRuntime, ctx.cfg, space, message, log).catch((err: unknown) => {
                ctx.log?.error?.(`[imessage-photon] inbound error: ${String(err)}`);
              });
            }
            if (ctx.abortSignal.aborted) break;
            log("[imessage-photon] message stream ended; reconnecting...");
          } catch (err) {
            ctx.log?.error?.(`[imessage-photon] stream failed: ${String(err)}`);
          }
          if (ctx.abortSignal.aborted) break;
          await resetSpectrum();
          await sleep(backoffMs + Math.random() * backoffMs * 0.2);
          backoffMs = Math.min(backoffMs * 2, 30_000);
        }
        log("[imessage-photon] stopped");
      },
      stopAccount: async () => {
        await resetSpectrum();
      },
    },
  },
  security: {
    dm: {
      channelKey: "imessage-photon",
      resolvePolicy: (account) => account.dmPolicy,
      resolveAllowFrom: (account) => account.allowFrom,
      defaultPolicy: "allowlist",
    },
  },
  threading: { topLevelReplyToMode: "reply" },
  outbound: {
    // Outbound delivery runs inside the gateway via our message actions
    // (handleAction). Declaring deliveryMode "gateway" makes the shared
    // message tool treat this channel as send-capable.
    deliveryMode: "gateway",
  },
});
