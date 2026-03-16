import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { carbonVoicePlugin } from "./src/channel.js";
import { setCarbonVoiceRuntime } from "./runtime.js";

const plugin = {
  id: "carbonvoice",
  name: "Carbon Voice",
  description: "Carbon Voice channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setCarbonVoiceRuntime(api.runtime);
    api.registerChannel({ plugin: carbonVoicePlugin as ChannelPlugin });
  },
};

export default plugin;

