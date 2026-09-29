// @infinite-canvas/plugin-sdk 公开入口。
//
// 插件作者用 TS/TSX 编写,只关注节点 UI 与逻辑;类型、JSX、运行时桥接、构建
// 全部由本 SDK 提供,产物仍是宿主 loader 现有契约的 ESM(React external,宿主单例)。

export * from "./types";
export { definePlugin } from "./define-plugin";
export { getReact, getRuntime, useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useReducer, useContext, useId } from "./runtime";
