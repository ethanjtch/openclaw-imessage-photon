import { Spectrum, type Message, type Space } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";

/** The Spectrum cloud app instance (long-lived WebSocket to Photon Cloud). */
export type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;

let app: SpectrumApp | null = null;

// Known spaces keyed by normalized phone (E.164 with +). Populated from the
// inbound message stream so outbound actions (message tool) can resolve a
// target phone to a live Space.
const spacesByPhone = new Map<string, Space>();
// Recent messages keyed by id, so actions like react/edit/unsend/reply can
// target a specific message.
const messagesById = new Map<string, Message>();
const MAX_CACHED_MESSAGES = 500;

/** Record a space observed on the inbound stream. */
export function rememberSpace(space: Space): void {
  const phone = normalizePhone(phoneFromSpaceId(space.id));
  if (phone) spacesByPhone.set(phone, space);
}

/** Record a message observed on the inbound stream (for target resolution). */
export function rememberMessage(message: Message): void {
  if (!message.id) return;
  messagesById.set(message.id, message);
  if (messagesById.size > MAX_CACHED_MESSAGES) {
    const oldest = messagesById.keys().next().value;
    if (oldest !== undefined) messagesById.delete(oldest);
  }
}

/** Resolve a cached Message by id (for react/edit/unsend/reply targets). */
export function resolveMessage(id: string | undefined | null): Message | undefined {
  if (!id) return undefined;
  return messagesById.get(id);
}

/** Resolve a Space for an outbound target (phone number). */
export function resolveSpace(target: string): Space | undefined {
  const phone = normalizePhone(target);
  if (!phone) return undefined;
  return spacesByPhone.get(phone);
}

/** Number of known spaces (used in diagnostics). */
export function knownSpaceCount(): number {
  return spacesByPhone.size;
}

/** Connect to Photon Spectrum Cloud. Reuses an existing connection. */
export async function connectSpectrum(
  projectId: string,
  projectSecret: string,
): Promise<SpectrumApp> {
  if (app) return app;
  app = await Spectrum({
    projectId,
    projectSecret,
    providers: [imessage.config()],
  });
  return app;
}

/** Close the current connection and clear it so the next connect re-creates it. */
export async function resetSpectrum(): Promise<void> {
  const current = app;
  app = null;
  if (current) {
    try {
      await current.stop();
    } catch {
      // best-effort teardown
    }
  }
}

/** Send a plain-text reply to a space (iMessage DM). */
export async function sendText(space: Space, text: string): Promise<void> {
  await space.send(text);
}

/** React to a message (iMessage tapback). New reactions replace the old one. */
export async function reactTo(message: Message, emoji: string): Promise<boolean> {
  const ok = await message.react(emoji);
  return Boolean(ok);
}

/** Extract the E.164 phone number from an iMessage space id like "any;-;+8613800138000". */
export function phoneFromSpaceId(spaceId: string): string | undefined {
  const m = spaceId.match(/\+?\d{6,15}$/);
  return m ? m[0] : undefined;
}

/** Normalize a phone candidate to E.164 with leading "+". */
export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  return `+${digits}`;
}
