import { useId } from "react";
import { RotateCcw } from "lucide-react";
import { effectiveNativeParameters } from "../../../shared/native-parameters";
import type { AiConfig, ModelCapability } from "@/stores/use-config-store";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { getNativeParameterDraft, getNativeParameterValues, nativeModel, resetNativeParameterValues, setNativeParameterValue } from "@/integration/native-parameters";

export function NativeSettingsPanel({ config, capability, onChange, theme, className, showTitle = true }: {
    config: AiConfig;
    capability: ModelCapability;
    onChange: (value: string) => void;
    theme: CanvasTheme;
    className?: string;
    showTitle?: boolean;
}) {
    const prefix = useId();
    const model = config.model || config[`${capability}Model`];
    const entry = nativeModel(config, capability, model);
    let values: Record<string, string | number | boolean> = {};
    let error = "";
    try {
        values = getNativeParameterDraft(config, model, capability);
        getNativeParameterValues(config, model, capability);
    } catch (cause) { error = cause instanceof Error ? cause.message : "参数无效"; }
    const titles = { video: "视频设置", image: "图片设置", text: "文字设置", audio: "音频设置" };
    const control = "min-h-9 w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 disabled:opacity-50";
    const controlStyle = { background: theme.toolbar.panel, color: theme.node.text, borderColor: theme.node.stroke };
    return <div className={className || "space-y-4"} style={{ color: theme.node.text, maxWidth: "100%" }} onMouseDown={(event) => event.stopPropagation()} data-native-settings={capability}>
        <div className="flex items-center justify-between gap-2">
            {showTitle && <div className="text-sm font-semibold">{titles[capability]}</div>}
            <button type="button" aria-label="恢复当前模型默认参数" title="恢复当前模型默认参数" className="ml-auto grid size-8 shrink-0 place-items-center rounded-md hover:opacity-70" onClick={() => onChange(resetNativeParameterValues(config, model, capability))}><RotateCcw size={16} /></button>
        </div>
        {effectiveNativeParameters(entry?.parameters || [], values).map((param) => {
            const id = `${prefix}-${param.id}`;
            const value = values[param.id] ?? "";
            const boolean = param.valueType === "enum" && param.options?.length === 2 && param.options.every((option) => ["true", "false"].includes(option.value));
            const update = (next: string | number | boolean) => onChange(setNativeParameterValue(config, model, capability, param.id, next));
            return <div key={param.id} className="space-y-1.5">
                <label htmlFor={id} className="flex items-center justify-between gap-3 text-sm" style={{ color: theme.node.muted }}>
                    <span className="break-words">{param.label}</span>
                    {boolean && <input id={id} type="checkbox" role="switch" className="size-4 shrink-0 accent-current" checked={value === true || value === "true"} disabled={!!param.disabledReason} onChange={(event) => update(String(event.target.checked))} />}
                </label>
                {!boolean && (param.valueType === "enum" ? <select id={id} value={String(value)} disabled={!!param.disabledReason} className={control} style={controlStyle} onChange={(event) => update(event.target.value)}>
                    {!param.options?.some((option) => option.value === String(value)) && <option value={String(value)}>{value === "" ? "默认" : `${value}（不再支持）`}</option>}
                    {param.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select> : <input id={id} type={param.valueType === "number" ? "number" : "text"} value={String(value)} disabled={!!param.disabledReason} min={param.min} max={param.max} step={param.step ?? (param.integer ? 1 : "any")} className={control} style={controlStyle} onChange={(event) => update(event.target.value)} />)}
                {param.disabledReason && <div className="text-xs leading-5" style={{ color: theme.node.muted }}>{param.disabledReason}</div>}
            </div>;
        })}
        {!entry?.parameters?.length && <p className="text-sm" style={{ color: theme.node.muted }}>当前模型未提供可配置参数。</p>}
        {entry?.referenceInputs?.images && <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
            {entry.referenceInputs.images.labels?.join("、") || "参考图片"}
            {entry.referenceInputs.images.maxCount !== undefined ? ` · 最多 ${entry.referenceInputs.images.maxCount} 张` : ""}
        </div>}
        {error && <p role="alert" className="break-words text-sm leading-5" style={{ color: "#c24145" }}>{error}</p>}
    </div>;
}
