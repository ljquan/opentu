// automatic JSX 的 dev 变体(编译器在 dev 模式会引用 jsxDEV)。转发到同一套 createElement。

import type * as React from "react";

import { getReact } from "./runtime";
import { Fragment } from "./jsx-runtime";

export { Fragment };
export type { JSX } from "./jsx-runtime";

export function jsxDEV(type: unknown, props: Record<string, unknown> | null, key?: unknown): React.ReactElement {
    const react = getReact();
    const resolvedType = type === Fragment ? react.Fragment : type;
    const config = key === undefined ? props : { ...(props ?? {}), key };
    return react.createElement(resolvedType as never, config as never);
}
