/**
 * Card 元素画布插入工具函数
 *
 * 将 CardBlock 数组按网格布局插入到画布中
 */
import { PlaitBoard, Point } from '@plait/core';
import { CardBlock } from './markdown-to-cards';
import { CardTransforms } from '../plugins/with-card';
import {
  CARD_DEFAULT_WIDTH,
  CARD_TITLE_HEIGHT,
  CARD_BODY_MIN_HEIGHT,
  CARD_LINE_HEIGHT,
  CARD_PADDING,
  CARD_BODY_FONT_SIZE,
  getCardColorByIndex,
} from '../constants/card-colors';
import { scrollToPointIfNeeded } from './selection-utils';

/** 网格布局常量 */
const GRID_COLUMNS = 3;
const CARD_GAP = 20;

/** 默认卡片宽度（像素），可被调用方覆盖 */
const DEFAULT_CARD_WIDTH = CARD_DEFAULT_WIDTH;

/**
 * 估算 Card 的高度
 * 根据 body 文本行数计算
 */
function estimateCardHeight(block: CardBlock, cardWidth: number = DEFAULT_CARD_WIDTH): number {
  const titleHeight = CARD_TITLE_HEIGHT;

  // 估算正文行数
  const bodyLines = block.body
    ? block.body.split('\n').reduce((acc, line) => {
        // 估算每行字符数（中文约 fontSize 宽，英文约 0.6 * fontSize）
        const estimatedWidth = line.split('').reduce((w, char) => {
          return w + (char.charCodeAt(0) > 127 ? CARD_BODY_FONT_SIZE : CARD_BODY_FONT_SIZE * 0.6);
        }, 0);
        const bodyWidth = cardWidth - CARD_PADDING * 2;
        const wrappedLines = Math.max(1, Math.ceil(estimatedWidth / bodyWidth));
        return acc + wrappedLines;
      }, 0)
    : 1;

  const bodyHeight = Math.max(CARD_BODY_MIN_HEIGHT, bodyLines * CARD_LINE_HEIGHT + CARD_PADDING * 2);
  return titleHeight + bodyHeight;
}

/**
 * 将 CardBlock 数组插入到画布
 *
 * @param board 画布实例
 * @param blocks CardBlock 数组
 * @param startPoint 起始位置（可选，默认使用画布中心或底部）
 * @param cardWidth Card 宽度（可选，默认 CARD_DEFAULT_WIDTH，传入 window.innerWidth * 0.5 可实现 50% 屏幕宽度）
 * @returns 插入的 Card 元素 ID 列表
 */
export function insertCardsToCanvas(
  board: PlaitBoard,
  blocks: CardBlock[],
  startPoint?: Point,
  cardWidth?: number
): string[] {
  if (!blocks || blocks.length === 0) return [];

  // 确定起始位置
  let insertX: number;
  let insertY: number;

  if (startPoint) {
    insertX = startPoint[0];
    insertY = startPoint[1];
  } else {
    // 使用画布底部最后一个元素的位置
    const point = getInsertStartPoint(board);
    insertX = point[0];
    insertY = point[1];
  }

  // 确定实际使用的卡片宽度
  const actualCardWidth = cardWidth ?? DEFAULT_CARD_WIDTH;

  const insertedIds: string[] = [];

  // 按网格布局插入
  blocks.forEach((block, index) => {
    const col = index % GRID_COLUMNS;
    const row = Math.floor(index / GRID_COLUMNS);

    const x = insertX + col * (actualCardWidth + CARD_GAP);
    const y = insertY + row * (estimateCardHeight(block, actualCardWidth) + CARD_GAP);

    const cardHeight = estimateCardHeight(block, actualCardWidth);
    const fillColor = getCardColorByIndex(index);

    const card = CardTransforms.insertCard(
      board,
      [[x, y], [x + actualCardWidth, y + cardHeight]],
      block.body,
      block.title,
      fillColor
    );

    insertedIds.push(card.id);
  });

  // 滚动到第一张 Card
  requestAnimationFrame(() => {
    if (insertedIds.length > 0) {
      const centerPoint: Point = [
        insertX + actualCardWidth / 2,
        insertY + estimateCardHeight(blocks[0], actualCardWidth) / 2,
      ];
      scrollToPointIfNeeded(board, centerPoint);
    }
  });

  return insertedIds;
}

/**
 * 获取插入起始位置
 * 优先使用画布底部最后一个元素的下方，否则使用默认位置
 */
function getInsertStartPoint(board: PlaitBoard): Point {
  if (!board.children || board.children.length === 0) {
    return [100, 100];
  }

  // 获取画布中所有元素的最大 Y 坐标
  let maxY = 0;
  let leftX = 100;

  for (const element of board.children) {
    const el = element as any;
    if (el.points && el.points.length >= 2) {
      const y1 = el.points[0][1];
      const y2 = el.points[1][1];
      const bottom = Math.max(y1, y2);
      if (bottom > maxY) {
        maxY = bottom;
        leftX = Math.min(el.points[0][0], el.points[1][0]);
      }
    }
  }

  return [leftX, maxY + 60];
}
