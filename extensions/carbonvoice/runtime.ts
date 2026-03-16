import { createPluginRuntimeStore } from "openclaw/plugin-sdk/compat";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

const { setRuntime: setCarbonVoiceRuntime, getRuntime: getCarbonVoiceRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Carbon Voice runtime not initialized");

export { getCarbonVoiceRuntime, setCarbonVoiceRuntime };

