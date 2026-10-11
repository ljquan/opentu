import {
  RectangleClient,
  type PlaitBoard,
  type Point,
} from '@plait/core';

interface AnchorSize {
  width: number;
  height: number;
}

interface AnchorPlacementOptions {
  gap?: number;
  padding?: number;
  ignoreElementIds?: string[];
  ignoreTypes?: string[];
  maxSearchRadius?: number;
  extraOccupiedRects?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

interface RectangleLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BatchAnchorPlacementOptions extends AnchorPlacementOptions {
  frameRect?: RectangleLike;
}

type FrameAdjacentSide = 'right' | 'bottom' | 'left' | 'top';

const FRAME_ADJACENT_SIDE_PRIORITY: FrameAdjacentSide[] = [
  'right',
  'bottom',
  'left',
  'top',
];
const FRAME_FAN_BAND_CAPACITY = 4;

export function resolveImageGenerationBatchAnchorSeedPosition(
  origin: Point,
  size: AnchorSize,
  index: number,
  total: number,
  gap = 32
): Point {
  const columns = total <= 2 ? total : total <= 4 ? 2 : 3;
  const row = Math.floor(index / columns);
  const column = index % columns;

  return [
    origin[0] + column * (size.width + gap),
    origin[1] + row * (size.height + gap),
  ];
}

function buildOccupiedRects(
  board: PlaitBoard,
  options: AnchorPlacementOptions
): Array<RectangleLike & { id?: string; type?: string }> {
  const {
    ignoreElementIds = [],
    ignoreTypes = ['workzone'],
    extraOccupiedRects = [],
  } = options;

  return [
    ...board.children
      .filter(hasElementPoints)
      .filter(
        (element) =>
          !ignoreTypes.includes(element.type ?? '') &&
          !ignoreElementIds.includes(element.id ?? '')
      )
      .map((element) => ({
        ...RectangleClient.getRectangleByPoints(
          (element as unknown as { points: [Point, Point] }).points
        ),
        id: element.id,
        type: element.type,
      })),
    ...extraOccupiedRects,
  ];
}

function hasElementPoints(
  value: unknown
): value is {
  id?: string;
  type?: string;
  points: [Point, Point];
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { points?: unknown }).points) &&
    (value as { points: unknown[] }).points.length === 2
  );
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
  padding: number
): boolean {
  return (
    left.x < right.x + right.width + padding &&
    left.x + left.width + padding > right.x &&
    left.y < right.y + right.height + padding &&
    left.y + left.height + padding > right.y
  );
}

function buildCandidatePositions(
  origin: Point,
  stepX: number,
  stepY: number,
  maxSearchRadius: number
): Point[] {
  const candidates: Point[] = [origin];

  for (let radius = 1; radius <= maxSearchRadius; radius += 1) {
    candidates.push(
      [origin[0] + stepX * radius, origin[1]],
      [origin[0], origin[1] + stepY * radius],
      [origin[0] + stepX * radius, origin[1] + stepY * radius],
      [origin[0] - stepX * radius, origin[1]],
      [origin[0] - stepX * radius, origin[1] + stepY * radius],
      [origin[0], origin[1] - stepY * radius],
      [origin[0] + stepX * radius, origin[1] - stepY * radius],
      [origin[0] - stepX * radius, origin[1] - stepY * radius]
    );
  }

  return candidates;
}

function buildFrameAdjacentBatchSeedPositions(
  frameRect: RectangleLike,
  size: AnchorSize,
  total: number,
  side: FrameAdjacentSide,
  gap: number
): Point[] {
  const outerGap = Math.max(gap, 32);
  const slotGap = Math.max(Math.round(Math.min(size.width, size.height) * 0.16), 28);
  const fanDepth = Math.max(Math.round(Math.min(size.width, size.height) * 0.12), 18);
  const horizontalBandStep = size.width + slotGap;
  const verticalBandStep = size.height + slotGap;
  const positions: Point[] = [];

  for (let index = 0; index < total; index += 1) {
    const bandIndex = Math.floor(index / FRAME_FAN_BAND_CAPACITY);
    const slotIndex = index % FRAME_FAN_BAND_CAPACITY;
    const bandCount = Math.min(
      FRAME_FAN_BAND_CAPACITY,
      total - bandIndex * FRAME_FAN_BAND_CAPACITY
    );
    const offset = slotIndex - (bandCount - 1) / 2;
    const centerX = frameRect.x + frameRect.width / 2 - size.width / 2;
    const centerY = frameRect.y + frameRect.height / 2 - size.height / 2;
    const fanShift = Math.abs(offset) * fanDepth;

    let x = centerX;
    let y = centerY;

    switch (side) {
      case 'right':
        x =
          frameRect.x +
          frameRect.width +
          outerGap +
          bandIndex * horizontalBandStep +
          fanShift;
        y = centerY + offset * (size.height + slotGap);
        break;
      case 'left':
        x =
          frameRect.x -
          outerGap -
          size.width -
          bandIndex * horizontalBandStep -
          fanShift;
        y = centerY + offset * (size.height + slotGap);
        break;
      case 'top':
        x = centerX + offset * (size.width + slotGap);
        y =
          frameRect.y -
          outerGap -
          size.height -
          bandIndex * verticalBandStep -
          fanShift;
        break;
      case 'bottom':
      default:
        x = centerX + offset * (size.width + slotGap);
        y =
          frameRect.y +
          frameRect.height +
          outerGap +
          bandIndex * verticalBandStep +
          fanShift;
        break;
    }

    positions.push([Math.round(x), Math.round(y)]);
  }

  return positions;
}

function scoreFrameAdjacentBatchPlan(
  positions: Point[],
  size: AnchorSize,
  occupiedRects: RectangleLike[],
  padding: number,
  side: FrameAdjacentSide
): number {
  const overlapCount = positions.reduce((count, position) => {
    const candidateRect = {
      x: position[0],
      y: position[1],
      width: size.width,
      height: size.height,
    };

    return (
      count +
      occupiedRects.filter((rect) => rectanglesOverlap(candidateRect, rect, padding))
        .length
    );
  }, 0);

  return (
    overlapCount * 1000 + FRAME_ADJACENT_SIDE_PRIORITY.indexOf(side) * 10
  );
}

function resolveFrameAdjacentBatchSeedPositions(
  board: PlaitBoard,
  frameRect: RectangleLike,
  size: AnchorSize,
  total: number,
  options: AnchorPlacementOptions
): Point[] {
  const { gap = 40, padding = 16 } = options;
  const occupiedRects = buildOccupiedRects(board, options);
  const rankedSides = FRAME_ADJACENT_SIDE_PRIORITY.map((side) => ({
    side,
    positions: buildFrameAdjacentBatchSeedPositions(
      frameRect,
      size,
      total,
      side,
      gap
    ),
  }));

  rankedSides.sort(
    (left, right) =>
      scoreFrameAdjacentBatchPlan(
        left.positions,
        size,
        occupiedRects,
        padding,
        left.side
      ) -
      scoreFrameAdjacentBatchPlan(
        right.positions,
        size,
        occupiedRects,
        padding,
        right.side
      )
  );

  return rankedSides[0]?.positions ?? [];
}

export function resolveImageGenerationBatchAnchorPositions(
  board: PlaitBoard,
  origin: Point,
  size: AnchorSize,
  total: number,
  options: BatchAnchorPlacementOptions = {}
): Point[] {
  const {
    frameRect,
    extraOccupiedRects = [],
    ...restOptions
  } = options;
  const placementOptions = { ...restOptions, extraOccupiedRects };
  const seedPositions = frameRect
    ? resolveFrameAdjacentBatchSeedPositions(
        board,
        frameRect,
        size,
        total,
        placementOptions
      )
    : Array.from({ length: total }, (_, index) =>
        resolveImageGenerationBatchAnchorSeedPosition(
          origin,
          size,
          index,
          total,
          placementOptions.gap
        )
      );
  const plannedRects = [...extraOccupiedRects];

  return seedPositions.map((seedPosition) => {
    const resolvedPosition = resolveImageGenerationAnchorAvailablePosition(
      board,
      seedPosition,
      size,
      {
        ...placementOptions,
        extraOccupiedRects: plannedRects,
      }
    );

    plannedRects.push({
      x: resolvedPosition[0],
      y: resolvedPosition[1],
      width: size.width,
      height: size.height,
    });

    return resolvedPosition;
  });
}

export function resolveImageGenerationAnchorAvailablePosition(
  board: PlaitBoard,
  desiredPosition: Point,
  size: AnchorSize,
  options: AnchorPlacementOptions = {}
): Point {
  const {
    gap = 40,
    padding = 16,
    maxSearchRadius = 6,
  } = options;

  const occupiedRects = buildOccupiedRects(board, options);

  const stepX = size.width + gap;
  const stepY = size.height + gap;
  const candidates = buildCandidatePositions(
    desiredPosition,
    stepX,
    stepY,
    maxSearchRadius
  );

  for (const candidate of candidates) {
    const candidateRect = {
      x: candidate[0],
      y: candidate[1],
      width: size.width,
      height: size.height,
    };

    const overlaps = occupiedRects.some((rect) =>
      rectanglesOverlap(candidateRect, rect, padding)
    );

    if (!overlaps) {
      return candidate;
    }
  }

  const fallbackX = desiredPosition[0];
  let fallbackY = desiredPosition[1] + stepY * (maxSearchRadius + 1);
  // Exhausted nearby lanes still need to clear retained cards and planned anchors.
  for (const rect of occupiedRects) {
    if (
      fallbackX < rect.x + rect.width + padding &&
      fallbackX + size.width + padding > rect.x
    ) {
      fallbackY = Math.max(fallbackY, rect.y + rect.height + padding);
    }
  }
  return [fallbackX, fallbackY];
}
