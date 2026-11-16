import {
  addSelectedElement,
  clearSelectedElement,
  idCreator,
  PlaitBoard,
  PlaitElement,
  Point,
  Transforms,
} from '@plait/core';
import { BasicShapes, createDefaultGeometry } from '@plait/draw';
import type { AIInputPrefillImage } from './ai-input-ui-events';
import type { ModelRef } from '../utils/settings-manager';
import type { ImageUploadConfig } from '../types/video.types';

export const GENERATION_NODE_CHANGE = 'aitu:generation-node-change';
export function notifyGenerationNodeChange(board: PlaitBoard, openNodeId?: string) {
  window.dispatchEvent(new CustomEvent(GENERATION_NODE_CHANGE, { detail: { board, openNodeId } }));
}
/** Choose facing sides, so a card to the left never sends a wire through its source. */
export function generationConnectionSides(source: { x: number; width: number }, target: { x: number; width: number }) {
  const targetIsRight = target.x + target.width / 2 >= source.x + source.width / 2;
  return { sourceX: targetIsRight ? 1 : 0, targetX: targetIsRight ? 0 : 1 };
}

/** Separate, stable input ports; keep the header and footer free of wires. */
export function generationInputPort(
  index: number,
  count: number,
  height: number
): Point {
  const inset = Math.min(56, height / 4);
  return [
    0,
    (inset + ((height - inset * 2) * (index + 1)) / (count + 1)) / height,
  ];
}
export type GenerationReferenceRole =
  | 'reference'
  | 'first-frame'
  | 'last-frame';
export interface GenerationNodeReference extends AIInputPrefillImage {
  referenceId: string;
  role: GenerationReferenceRole;
}
export interface GenerationNodeData {
  version: 1;
  generationType: 'image' | 'video';
  prompt: string;
  model?: string;
  modelRef?: ModelRef | null;
  params: Record<string, string>;
  count: number;
  references: GenerationNodeReference[];
}
export type GenerationNodeElement = PlaitElement & {
  generationNode: GenerationNodeData;
  points: Point[];
};
export function isGenerationNode(
  element: PlaitElement | null | undefined
): element is GenerationNodeElement {
  const data = element?.generationNode;
  return (
    !!data &&
    data.version === 1 &&
    (data.generationType === 'image' || data.generationType === 'video') &&
    typeof data.prompt === 'string' &&
    data.params &&
    typeof data.params === 'object' &&
    Number.isInteger(data.count) &&
    data.count > 0 &&
    Array.isArray(data.references) &&
    data.references.every(
      (ref: GenerationNodeReference) =>
        ref &&
        typeof ref.referenceId === 'string' &&
        typeof ref.url === 'string' &&
        ['reference', 'first-frame', 'last-frame'].includes(ref.role)
    )
  );
}
export function isGenerationSource(element: PlaitElement | undefined): boolean {
  return (
    element?.type === 'image' &&
    !element.isVideo &&
    !element.isAudio &&
    typeof element.url === 'string'
  );
}
export function createGenerationReference(
  source: PlaitElement
): GenerationNodeReference {
  return {
    referenceId: idCreator(),
    role: 'reference',
    sourceElementId: source.id,
    sourceElementUrl: source.url,
    url: source.url,
    name: source.name || '参考图',
  };
}
export function appendGenerationReference(
  data: GenerationNodeData,
  source: PlaitElement
): GenerationNodeData {
  if (
    !isGenerationSource(source) ||
    data.references.some((ref) => ref.sourceElementId === source.id)
  )
    return data;
  return {
    ...data,
    references: [...data.references, createGenerationReference(source)],
  };
}
export function updateGenerationNode(
  board: PlaitBoard,
  id: string,
  data: GenerationNodeData
): void {
  const index = board.children.findIndex((element) => element.id === id);
  if (index < 0 || !isGenerationNode(board.children[index])) return;
  if (
    JSON.stringify(board.children[index].generationNode) ===
    JSON.stringify(data)
  )
    return;
  Transforms.setNode(board, { generationNode: structuredClone(data) }, [index]);
}
export function addGenerationReference(
  board: PlaitBoard,
  node: GenerationNodeElement,
  source: PlaitElement
): void {
  updateGenerationNode(
    board,
    node.id,
    appendGenerationReference(node.generationNode, source)
  );
}
export function createGenerationNode(
  board: PlaitBoard,
  point: Point,
  type: 'image' | 'video',
  source: PlaitElement
): GenerationNodeElement {
  const shape = createDefaultGeometry(
    board,
    [point, [point[0] + 344, point[1] + 224]],
    BasicShapes.roundRectangle
  );
  const node = {
    ...shape,
    fill: '#ffffff',
    strokeColor: '#dcdbe5',
    strokeWidth: 1,
    generationNode: {
      version: 1 as const,
      generationType: type,
      prompt: '',
      params: {},
      count: 1,
      references: [createGenerationReference(source)],
    },
  };
  Transforms.insertNode(board, node, [board.children.length]);
  clearSelectedElement(board);
  addSelectedElement(board, node);
  return node;
}

/** A copied draft carries media; only sources included in the copy remain live. */
export function remapGenerationNode(
  data: GenerationNodeData,
  ids: Map<string, string>
): GenerationNodeData {
  return {
    ...structuredClone(data),
    references: data.references.map((ref) => ({
      ...ref,
      referenceId: idCreator(),
      sourceElementId: ref.sourceElementId
        ? ids.get(ref.sourceElementId)
        : undefined,
    })),
  };
}

export function validateGenerationNode(
  data: GenerationNodeData,
  elements: readonly PlaitElement[],
  video?: ImageUploadConfig
): string[] {
  const errors: string[] = [];
  if (
    data.references.some(
      (ref) =>
        ref.sourceElementId &&
        !elements.some(
          (el) => el.id === ref.sourceElementId && isGenerationSource(el)
        )
    )
  )
    errors.push('参考图来源已删除，请移除或重新连接');
  if (data.generationType === 'image') {
    if (data.references.some((ref) => ref.role !== 'reference'))
      errors.push('图片生成仅支持普通参考图，请调整引用角色');
  } else if (video) {
    if (data.references.length > video.maxCount)
      errors.push(`当前视频模型最多支持 ${video.maxCount} 张图片，请调整引用`);
    if (video.required && !data.references.length)
      errors.push('当前视频模型需要参考图');
    if (video.mode === 'frames') {
      if (data.references.some((ref) => ref.role === 'reference'))
        errors.push('当前视频模型需要明确首帧/尾帧，请设置引用角色');
      if (
        data.references.filter((ref) => ref.role === 'first-frame').length >
          1 ||
        data.references.filter((ref) => ref.role === 'last-frame').length > 1
      )
        errors.push('首帧和尾帧各只能设置一张');
      if (
        data.references.some((ref) => ref.role === 'last-frame') &&
        !data.references.some((ref) => ref.role === 'first-frame')
      )
        errors.push('请先添加首帧');
    } else if (data.references.some((ref) => ref.role !== 'reference'))
      errors.push('当前视频模型使用普通参考图，请调整引用角色');
  }
  return errors;
}

export function snapshotGenerationReferences(
  data: GenerationNodeData,
  elements: readonly PlaitElement[]
): GenerationNodeReference[] {
  const refs = data.references.map((ref) => {
    const source =
      ref.sourceElementId &&
      elements.find((el) => el.id === ref.sourceElementId);
    return source
      ? { ...ref, url: source.url, sourceElementUrl: source.url }
      : { ...ref };
  });
  // Frame adapters consume [first, last]. Roles stay explicit in the draft.
  return data.generationType === 'video' &&
    refs.some((ref) => ref.role !== 'reference')
    ? refs.sort(
        (a, b) =>
          Number(a.role === 'last-frame') - Number(b.role === 'last-frame')
      )
    : refs;
}
