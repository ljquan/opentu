export interface ImageAngleSettings {
  horizontal: number;
  pitch: number;
  distance: number;
  wide: boolean;
}

export function buildImageAnglePrompt(settings: ImageAngleSettings): string {
  if (
    ![settings.horizontal, settings.pitch, settings.distance].every(
      Number.isFinite
    ) ||
    settings.distance <= 0
  ) {
    throw new Error('视角参数无效');
  }
  return `以参考图为基础重新呈现场景，保持主体身份、材质和风格一致。相机水平角度 ${
    settings.horizontal
  }°（正值向右，负值向左），俯仰角 ${
    settings.pitch
  }°（正值俯视，负值仰视），相对拍摄距离 ${settings.distance}，${
    settings.wide ? '广角' : '标准镜头'
  }。生成新的拍摄视角，不要仅对原图做平面旋转或透视拉伸。`;
}

export function imageResizeDimensions(
  width: number,
  height: number,
  target: number
) {
  if (
    ![width, height, target].every(
      (value) => Number.isFinite(value) && value > 0
    )
  ) {
    throw new Error('图片尺寸必须为正数');
  }
  const scale = target / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Normalize to distinct pixel boundaries, so narrow images never produce empty pieces. */
export function imageSplitCuts(input: string, size: number): number[] {
  if (!Number.isInteger(size) || size < 1) throw new Error('图片尺寸无效');
  const parts = input.trim() ? input.split(/[,，;；\s]+/).filter(Boolean) : [];
  const cuts = parts.map((part) => Number(part));
  if (cuts.some((cut) => !Number.isFinite(cut) || cut <= 0 || cut >= 100)) {
    throw new Error('分割线填写 0 到 100 之间的百分比，用逗号分隔');
  }
  return [
    0,
    ...Array.from(new Set(cuts.map((cut) => Math.round((size * cut) / 100))))
      .filter((cut) => cut > 0 && cut < size)
      .sort((a, b) => a - b),
    size,
  ];
}

export function drawImageRegion(
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  output = { width, height },
  algorithm: 'high' | 'bilinear' | 'nearest' = 'high'
): string {
  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建图片处理画布');
  context.imageSmoothingEnabled = algorithm !== 'nearest';
  context.imageSmoothingQuality = algorithm === 'high' ? 'high' : 'low';
  context.drawImage(
    image,
    x,
    y,
    width,
    height,
    0,
    0,
    output.width,
    output.height
  );
  return canvas.toDataURL('image/png');
}

export function splitImageRegions(
  image: HTMLImageElement,
  x: number[],
  y: number[]
): string[] {
  const pieces: string[] = [];
  for (let row = 0; row < y.length - 1; row++) {
    for (let col = 0; col < x.length - 1; col++) {
      pieces.push(
        drawImageRegion(
          image,
          x[col],
          y[row],
          x[col + 1] - x[col],
          y[row + 1] - y[row]
        )
      );
    }
  }
  return pieces;
}
