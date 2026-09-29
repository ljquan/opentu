import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { settingsPopoverPosition } from "./settings-popover-position";
import { Settings2 } from "lucide-react";
import { Button, InputNumber } from "antd";
import { useTranslation } from "react-i18next";

import { reasoningEffortLabel, TextSettingsPanel } from "@/components/text-settings-panel";
import { nativeParameterSummary } from "@/integration/native-parameters";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";

type CanvasTextSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort" | "nativeParams", value: string) => void;
    count?: number;
    onCountChange?: (count: number) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
};

export function CanvasTextSettingsPopover({ config, onConfigChange, count, onCountChange, buttonClassName, placement = "topLeft" }: CanvasTextSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node) || buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [open]);

    const panel = open && buttonRect ? <TextSettingsPortal buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} config={config} count={count} onConfigChange={onConfigChange} onCountChange={onCountChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button size="small" type="text" className={buttonClassName || "!h-8 !max-w-[170px] !justify-start !rounded-full !px-2.5"} style={{ background: theme.node.fill, color: theme.node.text }} icon={<Settings2 className="size-3.5" />} onClick={() => setOpen((current) => !current)}>
                    <span className="truncate">{nativeParameterSummary(config, "text") ?? `${t("canvas.controls.reasoning")} · ${reasoningEffortLabel(config.reasoningEffort)}`}{onCountChange ? ` · ${t("canvas.controls.generations", { count })}` : ""}</span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function TextSettingsPortal({ buttonRect, panelRef, placement, theme, config, count, onConfigChange, onCountChange }: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasTextSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    count?: number;
    onConfigChange: CanvasTextSettingsPopoverProps["onConfigChange"];
    onCountChange?: (count: number) => void;
}) {
    const { t } = useTranslation();
    const style = {
        position: "fixed",
        zIndex: 1200,
        ...settingsPopoverPosition(buttonRect, placement, window.innerWidth, window.innerHeight),
        boxSizing: "border-box",
        background: theme.toolbar.panel,
        borderRadius: 18,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        padding: 18,
        overflowY: "auto",
        color: theme.node.text,
    } as const;

    return createPortal(
        <div ref={panelRef} style={style} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <TextSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} />
            {onCountChange ? (
                <div className="mt-4 space-y-2.5">
                    <div className="text-sm font-medium" style={{ color: theme.node.muted }}>{t("settingsPanels.text.count")}</div>
                    <InputNumber className="w-full" min={1} max={15} precision={0} value={count} onChange={(value) => onCountChange(value || 1)} />
                </div>
            ) : null}
        </div>,
        document.body,
    );
}
