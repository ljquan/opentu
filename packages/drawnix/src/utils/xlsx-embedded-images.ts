import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  processEntities: false,
});

export interface EmbeddedXlsxImage {
  url: string;
  column: number;
}

export function mergeImageColumns(
  textImages: EmbeddedXlsxImage[],
  embeddedImages: EmbeddedXlsxImage[]
): string[] {
  return [...textImages, ...embeddedImages]
    .sort((a, b) => a.column - b.column)
    .map(({ url }) => url);
}

function anchorColumn(anchor: XmlObject): number {
  const column = Number(anchor.from?.col);
  return Number.isInteger(column) && column >= 0 ? column : 0;
}

interface XmlObject {
  '@name': string;
  '@id': string;
  '@Id': string;
  '@Target': string;
  '@TargetMode': string;
  '@embed': string;
  workbook?: { sheets?: { sheet?: XmlObject | XmlObject[] } };
  Relationships?: { Relationship?: XmlObject | XmlObject[] };
  worksheet?: { drawing?: XmlObject | XmlObject[] };
  wsDr?: {
    absoluteAnchor?: unknown;
    oneCellAnchor?: XmlObject | XmlObject[];
    twoCellAnchor?: XmlObject | XmlObject[];
  };
  from?: { row?: string; col?: string };
  pic?: { blipFill?: { blip?: XmlObject } };
}

const asList = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

function resolvePart(source: string, target: string): string {
  if (
    !target ||
    target.includes('\\') ||
    [...target].some((char) => char.charCodeAt(0) < 32) ||
    /^[a-z]+:/i.test(target)
  ) {
    throw new Error('非法 Excel 资源路径');
  }
  const parts = target.startsWith('/') ? [] : source.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Excel 资源越过包边界');
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

function readPart(file: JSZip.JSZipObject, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let failed = false;
    const stream = (
      file as unknown as {
        internalStream: (type: 'uint8array') => {
          on: (
            event: string,
            callback: (value: Uint8Array | Error) => void
          ) => void;
          pause: () => void;
          resume: () => void;
        };
      }
    ).internalStream('uint8array');
    stream.on('data', (value) => {
      if (failed) return;
      const chunk = value as Uint8Array;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        stream.pause();
        reject(new Error('Excel 资源超过大小限制，请拆分后导入'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (error) => reject(error));
    stream.on('end', () => {
      if (failed) return;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(bytes);
    });
    stream.resume();
  });
}

async function readXml(file: JSZip.JSZipObject): Promise<XmlObject> {
  const source = new TextDecoder().decode(
    await readPart(file, 5 * 1024 * 1024)
  );
  if (
    /<!DOCTYPE|<!ENTITY/i.test(source) ||
    XMLValidator.validate(source) !== true
  ) {
    throw new Error('Excel XML 格式无效');
  }
  return parser.parse(source) as XmlObject;
}

function dataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

function imageContentType(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    } as Record<string, string>
  )[extension || ''];
}

/** Extract floating XLSX pictures, keyed by zero-based physical worksheet row. */
export async function readXlsxEmbeddedImages(
  buffer: ArrayBuffer,
  sheetName: string,
  referenceColumns?: Set<number>
): Promise<Map<number, EmbeddedXlsxImage[]>> {
  if (buffer.byteLength > 50 * 1024 * 1024)
    throw new Error('Excel 文件超过 50 MiB，请拆分后导入');
  const zip = await JSZip.loadAsync(buffer);
  if (
    Object.keys(zip.files).some((path) =>
      /cellimages|richData\/rdrichvalue/i.test(path)
    )
  ) {
    throw new Error(
      '暂不支持此 Excel 单元格图片格式，请改为插入浮动图片后导入'
    );
  }
  const workbookFile = zip.file('xl/workbook.xml');
  const workbookRelsFile = zip.file('xl/_rels/workbook.xml.rels');
  if (!workbookFile || !workbookRelsFile) return new Map();

  const workbook = await readXml(workbookFile);
  const workbookRels = await readXml(workbookRelsFile);
  const sheet = asList<XmlObject>(workbook.workbook?.sheets?.sheet).find(
    (item) => item['@name'] === sheetName
  );
  if (!sheet) return new Map();

  const relationships = new Map<string, string>();
  for (const relationship of asList<XmlObject>(
    workbookRels.Relationships?.Relationship
  )) {
    if (relationship['@TargetMode'] !== 'External') {
      relationships.set(
        relationship['@Id'],
        resolvePart('xl/workbook.xml', relationship['@Target'])
      );
    }
  }
  const sheetPath = relationships.get(sheet['@id']);
  if (!sheetPath) return new Map();

  const sheetFile = zip.file(sheetPath);
  const sheetRelsPath = resolvePart(
    sheetPath,
    `_rels/${sheetPath.split('/').pop()}.rels`
  );
  const sheetRelsFile = zip.file(sheetRelsPath);
  if (!sheetFile) throw new Error('Excel 工作表资源缺失');
  const sheetXml = await readXml(sheetFile);
  if (!sheetRelsFile) {
    if (sheetXml.worksheet?.drawing) throw new Error('Excel 绘图关系缺失');
    return new Map();
  }
  const sheetRels = await readXml(sheetRelsFile);
  const sheetRelationshipPaths = new Map<string, string>();
  for (const relationship of asList<XmlObject>(
    sheetRels.Relationships?.Relationship
  )) {
    if (relationship['@TargetMode'] !== 'External') {
      sheetRelationshipPaths.set(
        relationship['@Id'],
        resolvePart(sheetPath, relationship['@Target'])
      );
    }
  }

  const result = new Map<number, EmbeddedXlsxImage[]>();
  let totalImageBytes = 0;
  for (const drawingRef of asList<XmlObject>(sheetXml.worksheet?.drawing)) {
    const drawingPath = sheetRelationshipPaths.get(drawingRef['@id']);
    const drawingFile = drawingPath && zip.file(drawingPath);
    if (!drawingPath || !drawingFile) throw new Error('Excel 绘图资源缺失');
    const drawing = await readXml(drawingFile);
    if (drawing.wsDr?.absoluteAnchor)
      throw new Error('Excel 绝对定位图片无法归属任务行，请改为单元格定位图片');
    const drawingRelsPath = resolvePart(
      drawingPath,
      `_rels/${drawingPath.split('/').pop()}.rels`
    );
    const drawingRelsFile = zip.file(drawingRelsPath);
    const drawingRels = drawingRelsFile
      ? await readXml(drawingRelsFile)
      : undefined;
    const imagePaths = new Map<string, string>();
    for (const relationship of asList<XmlObject>(
      drawingRels?.Relationships?.Relationship
    )) {
      if (relationship['@TargetMode'] !== 'External') {
        imagePaths.set(
          relationship['@Id'],
          resolvePart(drawingPath, relationship['@Target'])
        );
      }
    }

    const anchors = [
      ...asList<XmlObject>(drawing.wsDr?.oneCellAnchor),
      ...asList<XmlObject>(drawing.wsDr?.twoCellAnchor),
    ].sort(
      (a, b) =>
        Number(a.from?.row) - Number(b.from?.row) ||
        anchorColumn(a) - anchorColumn(b)
    );
    for (const anchor of anchors) {
      if (!anchor.pic) continue;
      if (referenceColumns && !referenceColumns.has(anchorColumn(anchor)))
        continue;
      const row = Number(anchor.from?.row);
      const relationshipId = anchor.pic?.blipFill?.blip?.['@embed'];
      const imagePath = relationshipId && imagePaths.get(relationshipId);
      const imageFile = imagePath && zip.file(imagePath);
      const contentType = imagePath && imageContentType(imagePath);
      if (!Number.isInteger(row) || row < 0 || !imageFile || !contentType) {
        throw new Error(
          'Excel 图片资源缺失或格式不支持，请使用 PNG、JPEG、GIF、WebP'
        );
      }
      const values = result.get(row) || [];
      const bytes = await readPart(imageFile, 25 * 1024 * 1024);
      totalImageBytes += bytes.length;
      if (totalImageBytes > 200 * 1024 * 1024) {
        throw new Error('Excel 图片总量超过 200 MiB，请拆分后导入');
      }
      values.push({
        url: dataUrl(bytes, contentType),
        column: anchorColumn(anchor),
      });
      result.set(row, values);
    }
  }
  return result;
}
