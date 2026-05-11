import { createPluginRuntimeStore, type PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setCarbonVoiceRuntime, getRuntime: getCarbonVoiceRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "carbonvoice",
    errorMessage: "Carbon Voice runtime not initialized",
  });

export { getCarbonVoiceRuntime, setCarbonVoiceRuntime };
