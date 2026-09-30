/** All workflow portals stay within the same scoped DOM and React tree. */
export function workflowRoot(): HTMLElement {
    const root = document.getElementById("opentu-workflow-root");
    if (!root) throw new Error("工作流尚未挂载");
    return root;
}
