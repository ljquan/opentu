import { nanoid } from "nanoid";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { audioMetadata, buildAudioGenerationMetadata } from "@/lib/canvas/canvas-node-factory";
import type { StoredAudioGenerationResult } from "@/services/api/audio";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function audioResultNodes(node: CanvasNodeData, result: StoredAudioGenerationResult, config: AiConfig, prompt: string): CanvasNodeData[] {
    const metadata = { ...node.metadata, ...buildAudioGenerationMetadata(config), nativeParams: config.nativeParams, generationMode: "audio" as const, prompt, errorDetails: undefined };
    if (result.kind === "lyrics") return [{
        ...node, type: CanvasNodeType.Text, width: NODE_DEFAULT_SIZE[CanvasNodeType.Text].width, height: NODE_DEFAULT_SIZE[CanvasNodeType.Text].height,
        metadata: { ...metadata, content: result.text, status: "success", fontSize: 14, storageKey: undefined, mimeType: undefined, bytes: undefined, durationMs: undefined },
    }];
    return result.clips.map((clip, index) => ({
        ...node, id: index === 0 ? node.id : nanoid(), type: CanvasNodeType.Audio,
        position: { x: node.position.x, y: node.position.y + index * (node.height + 32) },
        metadata: { ...metadata, ...audioMetadata(clip) },
    }));
}
