import {
  PlaitHistoryBoard,
  RectangleClient,
  Transforms,
  clearSelectedElement,
  addSelectedElement,
  type PlaitBoard,
  type PlaitElement,
} from '@plait/core';
import {
  BasicShapes,
  createGeometryElement,
  ShapeDefaultSpace,
} from '@plait/draw';
import type { Element as SlateElement } from 'slate';
import type { LayerTextRecognition, LayerTextStyle } from './types';
import {
  getSemanticLayerMetadata,
  getSemanticLayerElementPoints,
} from './canvas';

function textFontFamily(style: LayerTextStyle): string {
  const family = style.similar_font_family;
  return family && family !== 'unknown' && /^[\p{L}\p{N} _-]+$/u.test(family)
    ? family
    : 'sans-serif';
}

/** Fit each OCR line inside Plait's actual text area, including its padding. */
export function fitLayerTextFontSize(
  runs: LayerTextRecognition['lines'][number]['runs'],
  width: number,
  height: number
): number {
  const context = document.createElement('canvas').getContext('2d');
  const measuredWidth = runs.reduce((sum, run) => {
    if (!context)
      return (
        sum +
        Array.from(run.text).reduce(
          (w, char) => w + (char.charCodeAt(0) > 255 ? 100 : 60),
          0
        )
      );
    context.font = `${run.style.italic ? 'italic' : 'normal'} ${
      run.style.bold ? 'bold' : 'normal'
    } 100px "${textFontFamily(run.style)}", sans-serif`;
    return sum + context.measureText(run.text).width;
  }, 0);
  const availableWidth = Math.max(
    1,
    width - ShapeDefaultSpace.rectangleAndText * 2 - 1
  );
  const size = Math.min(
    height / 1.4,
    measuredWidth > 0 ? (availableWidth * 100) / measuredWidth : height / 1.4
  );
  return Math.max(1, Math.floor(size * 100) / 100);
}

/** Map original OCR coordinates relative to the current raster layer, so moved,
 * resized and rotated layer groups remain editable in their current location. */
export function buildLayerTextElements(source: PlaitElement): PlaitElement[] {
  const layer = getSemanticLayerMetadata(source);
  if (
    source.type !== 'image' ||
    !source.points ||
    !layer?.textRecognition?.lines.length
  ) {
    throw new Error('该图片层没有可用的文字识别结果');
  }
  const [left, top, right, bottom] = layer.boundingBox.absolute;
  const rect = RectangleClient.getRectangleByPoints(source.points);
  if (
    ![left, top, right, bottom, rect.x, rect.y, rect.width, rect.height].every(
      Number.isFinite
    ) ||
    right <= left ||
    bottom <= top ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    throw new Error('文字图层坐标无效');
  const scaleX = rect.width / (right - left);
  const scaleY = rect.height / (bottom - top);
  const angle =
    typeof source.angle === 'number' && Number.isFinite(source.angle)
      ? source.angle
      : 0;
  return layer.textRecognition.lines.map((line) => {
    const [x1, y1, x2, y2] = line.boundingBox.absolute;
    if (
      ![x1, y1, x2, y2].every(Number.isFinite) ||
      x1 < left ||
      y1 < top ||
      x2 > right ||
      y2 > bottom ||
      x2 <= x1 ||
      y2 <= y1
    ) {
      throw new Error('OCR 行框超出文字图层范围，已保留原图片层');
    }
    const bounds = {
      x: rect.x + (x1 - left) * scaleX,
      y: rect.y + (y1 - top) * scaleY,
      width: (x2 - x1) * scaleX,
      height: (y2 - y1) * scaleY,
    };
    const fontSize = fitLayerTextFontSize(
      line.runs,
      bounds.width,
      bounds.height
    );
    const text = {
      type: 'paragraph',
      align: 'left',
      children: line.runs.map(({ text, style }) => ({
        text,
        'font-size': fontSize,
        'font-family': textFontFamily(style),
        color: style.foreground_color || '#000000',
        bold: style.bold === true,
        italic: style.italic === true,
        underline: style.underline === true,
        strikethrough: style.strikethrough === true,
      })),
    } as unknown as SlateElement;
    const element = createGeometryElement(
      BasicShapes.text,
      getSemanticLayerElementPoints(bounds, rect, angle),
      text,
      {},
      { textHeight: bounds.height }
    );
    return {
      ...element,
      angle,
      autoSize: false,
      groupId: source.groupId,
      ...(typeof source.opacity === 'number'
        ? { opacity: source.opacity }
        : {}),
      metadata: {
        semanticText: {
          sourceElementId: source.id,
          providerGroupId: layer.providerGroupId,
          zIndex: layer.zIndex,
          approximate: true,
        },
      },
    };
  });
}

export function convertLayerToEditableText(
  board: PlaitBoard,
  sourceId: string
): number {
  const index = board.children.findIndex((element) => element.id === sourceId);
  if (index < 0) throw new Error('原图片层已不存在');
  const source = board.children[index];
  const layer = getSemanticLayerMetadata(source);
  if (layer?.hidden) throw new Error('请先显示原图片层再转换');
  if (
    board.children.some(
      (element) => element.metadata?.semanticText?.sourceElementId === sourceId
    )
  ) {
    throw new Error('该图层已转换，请直接编辑文字或撤销上次转换');
  }
  const elements = buildLayerTextElements(source);
  // All decoding and geometry checks happen before the synchronous history batch.
  let failure: unknown;
  PlaitHistoryBoard.withNewBatch(board, () => {
    try {
      elements.forEach((element, offset) =>
        Transforms.insertNode(board, element, [index + 1 + offset])
      );
      Transforms.setNode(
        board,
        {
          metadata: {
            ...source.metadata,
            semanticLayer: { ...layer, hidden: true },
          },
        },
        [index]
      );
      clearSelectedElement(board);
    } catch (error) {
      failure = error;
      const ids = new Set(elements.map((element) => element.id));
      for (let i = board.children.length - 1; i >= 0; i--) {
        if (ids.has(board.children[i].id)) Transforms.removeNode(board, [i]);
      }
      const originalIndex = board.children.findIndex(
        (element) => element.id === sourceId
      );
      if (originalIndex >= 0)
        Transforms.setNode(board, { metadata: source.metadata }, [
          originalIndex,
        ]);
      clearSelectedElement(board);
      addSelectedElement(board, source);
    }
  });
  if (failure) throw failure;
  const ids = new Set(elements.map((element) => element.id));
  Transforms.addSelectionWithTemporaryElements(
    board,
    board.children.filter((element) => ids.has(element.id))
  );
  return elements.length;
}
