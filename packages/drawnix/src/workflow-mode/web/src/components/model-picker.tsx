import { useEffect, useId, useMemo, useState } from "react";
import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { decodeChannelModel, modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const current = value || "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-9 w-fit max-w-full gap-2 rounded-lg border border-input bg-transparent px-3 text-sm font-normal transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? modelOptionLabel(config, current) : pickerPlaceholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionName(current) : pickerPlaceholder}</span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="canvas-model-menu z-[1200] w-[440px] max-w-[calc(100vw-24px)] max-h-[min(var(--radix-select-content-available-height),420px)] rounded-lg border border-border/70 bg-popover p-1 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                collisionPadding={12}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((model) => (
                        <SelectItem className="canvas-model-option min-h-14 px-3 py-2 pr-9 data-[state=checked]:bg-accent/70" key={model} value={model} textValue={modelOptionLabel(config, model)} title={modelOptionLabel(config, model)}>
                            <ModelLabel config={config} model={model} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    const channelId = decodeChannelModel(model)?.channelId;
    const channel = config.channels.find((entry) => entry.id === channelId);
    return (
        <span className="flex w-full min-w-0 items-start gap-2.5">
            <ModelIcon model={model} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="whitespace-normal text-sm font-medium leading-5 [overflow-wrap:anywhere]">{modelOptionName(model)}</span>
                {channel && <span className="whitespace-normal text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]">{channel.name}</span>}
            </span>
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [icon]);
    return icon && !failed ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" onError={() => setFailed(true)} /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    const icon = name.includes("claude") || name.includes("anthropic") ? "claude.svg"
        : name.includes("gemini") || name.includes("google") ? "gemini.svg"
        : name.includes("gpt") || name.includes("openai") ? "openai.svg"
        : name.includes("grok") ? "grok.svg"
        : name.includes("deepseek") ? "deepseek.svg"
        : name.includes("glm") ? "glm.svg"
        : "";
    if (icon) return `${import.meta.env.BASE_URL}icons/${icon}`;
    return "";
}
