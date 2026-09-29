import type { CanvasPlugin, CanvasPluginFactory, PluginRuntime } from "./types";

// 身份帮助函数:为插件对象(或工厂)补全类型,给作者完整补全与校验。
// 采用 automatic JSX 后,插件通常不再需要 runtime,直接写对象形式即可:
//
//   export default definePlugin({ id, name, version, nodes: [...] })
//
// 仍支持工厂形式(需要 runtime.version/emit/on 时):
//
//   export default definePlugin((runtime) => ({ ... }))

export function definePlugin(plugin: CanvasPlugin): CanvasPlugin;
export function definePlugin(factory: CanvasPluginFactory): CanvasPluginFactory;
export function definePlugin(input: CanvasPlugin | CanvasPluginFactory): CanvasPlugin | CanvasPluginFactory {
    return input;
}

export type { PluginRuntime };
