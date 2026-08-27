import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { imessagePhotonPlugin } from "./src/channel.js";

export default defineChannelPluginEntry({
  id: "imessage-photon",
  name: "iMessage (Photon)",
  description: "iMessage channel via Photon Spectrum Cloud — no Mac required.",
  plugin: imessagePhotonPlugin,
});
