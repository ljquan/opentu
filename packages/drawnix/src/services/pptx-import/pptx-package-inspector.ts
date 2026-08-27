import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  PptxImportError,
  type PptxImportDiagnostic,
  type PptxImportPackageMetadata,
  type PptxImportPackageSlide,
} from './pptx-import.types';

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const ZIP64_UINT16_SENTINEL = 0xffff;
const ZIP64_UINT32_SENTINEL = 0xffffffff;
const MAX_ZIP_COMMENT_BYTES = 0xffff;

// Ratios are structural bomb checks, not product file-size limits.
export const MAX_PPTX_ENTRY_EXPANSION_RATIO = 1000;
export const MAX_PPTX_PACKAGE_EXPANSION_RATIO = 1000;
// These cap ZIP parser/renderer work declared by the package. They are not
// limits on PPT page count, source file bytes, or provider output duration.
export const MAX_PPTX_ZIP_ENTRY_COUNT = 10_000;
export const MAX_PPTX_DECLARED_EXPANDED_BYTES = 512 * 1024 * 1024;
export const MAX_PPTX_RELATIONSHIP_DEPTH = 256;

interface ZipDirectoryEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  directory: boolean;
}

export interface PptxZipDirectory {
  entries: ZipDirectoryEntry[];
  entriesByLowerPath: Map<string, ZipDirectoryEntry>;
}

interface Relationship {
  id: string;
  type: string;
  target: string;
  targetMode?: string;
}

interface ParsedRelationshipPart {
  sourcePartPath: string;
  relationships: Relationship[];
}

interface XmlRecord {
  [key: string]: unknown;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: false,
});

function fail(
  code: ConstructorParameters<typeof PptxImportError>[0],
  kind: ConstructorParameters<typeof PptxImportError>[1],
  message: string,
  cause?: unknown
): never {
  throw new PptxImportError(code, kind, message, { cause });
}

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function localName(name: string): string {
  const normalized = name.startsWith('@_') ? name.slice(2) : name;
  return normalized.split(':').pop() || normalized;
}

function getChild(record: unknown, name: string): unknown {
  if (!isRecord(record)) return undefined;
  const entry = Object.entries(record).find(
    ([key]) => !key.startsWith('@_') && localName(key) === name
  );
  return entry?.[1];
}

function getAttribute(record: unknown, name: string): string | undefined {
  if (!isRecord(record)) return undefined;
  const entry = Object.entries(record).find(
    ([key]) => key.startsWith('@_') && localName(key) === name
  );
  return typeof entry?.[1] === 'string' ? entry[1] : undefined;
}

function getRelationshipId(record: unknown): string | undefined {
  if (!isRecord(record)) return undefined;
  const namespaced = Object.entries(record).find(
    ([key, value]) =>
      key.startsWith('@_') &&
      key.slice(2).includes(':') &&
      localName(key) === 'id' &&
      typeof value === 'string'
  );
  return typeof namespaced?.[1] === 'string' ? namespaced[1] : undefined;
}

function readUint64Safe(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  if (high > 0x1fffff) {
    fail(
      'invalid-file',
      'input',
      'PPTX ZIP64 字段超出浏览器可安全表示的整数范围'
    );
  }
  return high * 0x100000000 + low;
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimumOffset = Math.max(
    0,
    view.byteLength - (22 + MAX_ZIP_COMMENT_BYTES)
  );
  for (
    let offset = view.byteLength - 22;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) !== ZIP_END_OF_CENTRAL_DIRECTORY) {
      continue;
    }
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) {
      return offset;
    }
  }
  fail('invalid-file', 'input', '文件不是完整的 PPTX ZIP 包');
}

function readZip64Extra(
  view: DataView,
  offset: number,
  length: number,
  needs: {
    uncompressed: boolean;
    compressed: boolean;
    localOffset: boolean;
    diskStart: boolean;
  }
): {
  uncompressed?: number;
  compressed?: number;
  localOffset?: number;
  diskStart?: number;
} {
  const end = offset + length;
  let cursor = offset;
  while (cursor + 4 <= end) {
    const fieldId = view.getUint16(cursor, true);
    const fieldLength = view.getUint16(cursor + 2, true);
    const fieldStart = cursor + 4;
    const fieldEnd = fieldStart + fieldLength;
    if (fieldEnd > end) {
      fail('invalid-file', 'input', 'PPTX ZIP 扩展字段已损坏');
    }
    if (fieldId === ZIP64_EXTRA_FIELD) {
      let valueOffset = fieldStart;
      const result: {
        uncompressed?: number;
        compressed?: number;
        localOffset?: number;
        diskStart?: number;
      } = {};
      const read64 = (): number => {
        if (valueOffset + 8 > fieldEnd) {
          fail('invalid-file', 'input', 'PPTX ZIP64 扩展字段不完整');
        }
        const value = readUint64Safe(view, valueOffset);
        valueOffset += 8;
        return value;
      };
      if (needs.uncompressed) result.uncompressed = read64();
      if (needs.compressed) result.compressed = read64();
      if (needs.localOffset) result.localOffset = read64();
      if (needs.diskStart) {
        if (valueOffset + 4 > fieldEnd) {
          fail('invalid-file', 'input', 'PPTX ZIP64 分卷字段不完整');
        }
        result.diskStart = view.getUint32(valueOffset, true);
      }
      return result;
    }
    cursor = fieldEnd;
  }
  fail('invalid-file', 'input', 'PPTX 缺少必需的 ZIP64 扩展字段');
}

function decodePackagePath(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail('invalid-file', 'input', 'PPTX 包含无法解码的部件路径', error);
  }
}

export function normalizePptxPackagePath(path: string): string {
  if (
    !path ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[a-zA-Z]:/.test(path)
  ) {
    fail('unsafe-package-path', 'security', 'PPTX 包含不安全的绝对路径');
  }

  const directory = path.endsWith('/');
  const parts = path.split('/');
  if (directory) parts.pop();
  if (
    parts.length === 0 ||
    parts.some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    fail('unsafe-package-path', 'security', 'PPTX 包含路径穿越部件');
  }
  return `${parts.join('/')}${directory ? '/' : ''}`;
}

function readCentralDirectoryLocation(
  view: DataView,
  eocdOffset: number
): { entryCount: number; directorySize: number; directoryOffset: number } {
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const directorySize = view.getUint32(eocdOffset + 12, true);
  const directoryOffset = view.getUint32(eocdOffset + 16, true);

  const needsZip64 =
    entriesOnDisk === ZIP64_UINT16_SENTINEL ||
    entryCount === ZIP64_UINT16_SENTINEL ||
    directorySize === ZIP64_UINT32_SENTINEL ||
    directoryOffset === ZIP64_UINT32_SENTINEL;

  if (!needsZip64) {
    if (
      diskNumber !== 0 ||
      centralDirectoryDisk !== 0 ||
      entriesOnDisk !== entryCount
    ) {
      fail('invalid-file', 'input', '不支持分卷 PPTX ZIP 包');
    }
    return { entryCount, directorySize, directoryOffset };
  }

  const locatorOffset = eocdOffset - 20;
  if (
    locatorOffset < 0 ||
    view.getUint32(locatorOffset, true) !==
      ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR
  ) {
    fail('invalid-file', 'input', 'PPTX ZIP64 定位记录缺失');
  }
  const zip64Disk = view.getUint32(locatorOffset + 4, true);
  const zip64Offset = readUint64Safe(view, locatorOffset + 8);
  const totalDisks = view.getUint32(locatorOffset + 16, true);
  if (zip64Disk !== 0 || totalDisks !== 1) {
    fail('invalid-file', 'input', '不支持分卷 PPTX ZIP64 包');
  }
  if (
    zip64Offset + 56 > view.byteLength ||
    view.getUint32(zip64Offset, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY
  ) {
    fail('invalid-file', 'input', 'PPTX ZIP64 结束记录已损坏');
  }
  const zip64DiskNumber = view.getUint32(zip64Offset + 16, true);
  const zip64CentralDisk = view.getUint32(zip64Offset + 20, true);
  const zip64EntriesOnDisk = readUint64Safe(view, zip64Offset + 24);
  const zip64EntryCount = readUint64Safe(view, zip64Offset + 32);
  if (
    zip64DiskNumber !== 0 ||
    zip64CentralDisk !== 0 ||
    zip64EntriesOnDisk !== zip64EntryCount
  ) {
    fail('invalid-file', 'input', '不支持分卷 PPTX ZIP64 包');
  }
  return {
    entryCount: zip64EntryCount,
    directorySize: readUint64Safe(view, zip64Offset + 40),
    directoryOffset: readUint64Safe(view, zip64Offset + 48),
  };
}

export function parsePptxZipDirectory(bytes: Uint8Array): PptxZipDirectory {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  ) {
    fail(
      'encrypted-file',
      'security',
      '该文件是加密或旧版 Office 复合文档，无法作为 PPTX 导入'
    );
  }
  if (bytes.length < 22) {
    fail('invalid-file', 'input', 'PPTX 文件为空或不完整');
  }

  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEndOfCentralDirectory(view);
    const { entryCount, directorySize, directoryOffset } =
      readCentralDirectoryLocation(view, eocdOffset);
    if (entryCount > MAX_PPTX_ZIP_ENTRY_COUNT) {
      fail(
        'unsafe-package-resource-budget',
        'security',
        'PPTX ZIP 部件数量超过浏览器结构安全预算，已中止资源耗尽风险；这不是产品页数限制'
      );
    }
    const directoryEnd = directoryOffset + directorySize;
    if (
      entryCount <= 0 ||
      !Number.isSafeInteger(directoryEnd) ||
      directoryOffset < 0 ||
      directoryEnd > eocdOffset
    ) {
      fail('invalid-file', 'input', 'PPTX 中央目录范围无效');
    }

    const entries: ZipDirectoryEntry[] = [];
    const entriesByLowerPath = new Map<string, ZipDirectoryEntry>();
    let cursor = directoryOffset;
    let totalCompressed = 0;
    let totalUncompressed = 0;

    for (let index = 0; index < entryCount; index += 1) {
      if (
        cursor + 46 > directoryEnd ||
        view.getUint32(cursor, true) !== ZIP_CENTRAL_DIRECTORY_HEADER
      ) {
        fail('invalid-file', 'input', 'PPTX 中央目录条目已损坏');
      }
      const versionMadeBy = view.getUint16(cursor + 4, true);
      const flags = view.getUint16(cursor + 8, true);
      const compressionMethod = view.getUint16(cursor + 10, true);
      const crc32 = view.getUint32(cursor + 16, true);
      const compressed32 = view.getUint32(cursor + 20, true);
      const uncompressed32 = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const diskStart32 = view.getUint16(cursor + 34, true);
      const externalAttributes = view.getUint32(cursor + 38, true);
      const localOffset32 = view.getUint32(cursor + 42, true);
      const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
      if (entryEnd > directoryEnd) {
        fail('invalid-file', 'input', 'PPTX 中央目录条目越界');
      }

      if (
        (flags & 0x0001) !== 0 ||
        (flags & 0x0040) !== 0 ||
        (flags & 0x2000) !== 0
      ) {
        fail('encrypted-file', 'security', 'PPTX 包含加密部件');
      }
      if (compressionMethod !== 0 && compressionMethod !== 8) {
        fail('invalid-file', 'input', 'PPTX 使用了不支持的 ZIP 压缩算法');
      }

      const needsZip64 = {
        uncompressed: uncompressed32 === ZIP64_UINT32_SENTINEL,
        compressed: compressed32 === ZIP64_UINT32_SENTINEL,
        localOffset: localOffset32 === ZIP64_UINT32_SENTINEL,
        diskStart: diskStart32 === ZIP64_UINT16_SENTINEL,
      };
      const zip64 = Object.values(needsZip64).some(Boolean)
        ? readZip64Extra(
            view,
            cursor + 46 + nameLength,
            extraLength,
            needsZip64
          )
        : {};
      const compressedSize = zip64.compressed ?? compressed32;
      const uncompressedSize = zip64.uncompressed ?? uncompressed32;
      const localHeaderOffset = zip64.localOffset ?? localOffset32;
      const diskStart = zip64.diskStart ?? diskStart32;
      if (diskStart !== 0) {
        fail('invalid-file', 'input', '不支持分卷 PPTX ZIP 条目');
      }

      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      const name = normalizePptxPackagePath(decodePackagePath(nameBytes));
      const lowerName = name.toLowerCase();
      if (entriesByLowerPath.has(lowerName)) {
        fail(
          'unsafe-package-path',
          'security',
          'PPTX 包含重复或大小写冲突的部件路径'
        );
      }

      const unixMode = externalAttributes >>> 16;
      const madeByUnix = versionMadeBy >>> 8 === 3;
      if (madeByUnix && (unixMode & 0xf000) === 0xa000) {
        fail('unsafe-package-path', 'security', 'PPTX 包含符号链接部件');
      }

      const directory = name.endsWith('/');
      if (!directory && uncompressedSize > 0) {
        if (compressedSize === 0) {
          fail(
            'unsafe-compression-ratio',
            'security',
            'PPTX 部件声明了异常的零长度压缩数据'
          );
        }
        if (
          uncompressedSize / compressedSize >
          MAX_PPTX_ENTRY_EXPANSION_RATIO
        ) {
          fail(
            'unsafe-compression-ratio',
            'security',
            'PPTX 部件压缩比异常，已按结构攻击中止导入'
          );
        }
      }
      if (compressionMethod === 0 && compressedSize !== uncompressedSize) {
        fail('invalid-file', 'input', 'PPTX 未压缩部件的长度声明不一致');
      }

      if (
        uncompressedSize >
        MAX_PPTX_DECLARED_EXPANDED_BYTES - totalUncompressed
      ) {
        fail(
          'unsafe-package-resource-budget',
          'security',
          'PPTX ZIP 声明的展开资源量超过浏览器结构安全预算，已中止资源耗尽风险；这不是产品原文件大小限制'
        );
      }
      totalCompressed += compressedSize;
      totalUncompressed += uncompressedSize;
      if (
        !Number.isSafeInteger(totalCompressed) ||
        !Number.isSafeInteger(totalUncompressed)
      ) {
        fail(
          'unsafe-compression-ratio',
          'security',
          'PPTX 展开长度超出安全整数范围'
        );
      }

      const entry: ZipDirectoryEntry = {
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        crc32,
        localHeaderOffset,
        directory,
      };
      entries.push(entry);
      entriesByLowerPath.set(lowerName, entry);
      cursor = entryEnd;
    }

    if (cursor !== directoryEnd) {
      fail('invalid-file', 'input', 'PPTX 中央目录包含未识别数据');
    }
    if (
      totalCompressed > 0 &&
      totalUncompressed / totalCompressed > MAX_PPTX_PACKAGE_EXPANSION_RATIO
    ) {
      fail(
        'unsafe-compression-ratio',
        'security',
        'PPTX 总体压缩比异常，已按结构攻击中止导入'
      );
    }

    const ranges = entries.map((entry) => {
      const offset = entry.localHeaderOffset;
      if (
        offset + 30 > directoryOffset ||
        view.getUint32(offset, true) !== ZIP_LOCAL_FILE_HEADER
      ) {
        fail('invalid-file', 'input', 'PPTX 本地 ZIP 条目头已损坏');
      }
      const localFlags = view.getUint16(offset + 6, true);
      const localMethod = view.getUint16(offset + 8, true);
      const localNameLength = view.getUint16(offset + 26, true);
      const localExtraLength = view.getUint16(offset + 28, true);
      const localNameEnd = offset + 30 + localNameLength;
      const dataStart = localNameEnd + localExtraLength;
      const dataEnd = dataStart + entry.compressedSize;
      if (
        dataEnd > directoryOffset ||
        (localFlags & 0x0001) !== 0 ||
        (localFlags & 0x0040) !== 0 ||
        (localFlags & 0x2000) !== 0 ||
        localMethod !== entry.compressionMethod
      ) {
        fail('invalid-file', 'input', 'PPTX 本地 ZIP 条目声明不一致');
      }
      const localName = normalizePptxPackagePath(
        decodePackagePath(bytes.subarray(offset + 30, localNameEnd))
      );
      if (localName.toLowerCase() !== entry.name.toLowerCase()) {
        fail(
          'unsafe-package-path',
          'security',
          'PPTX 本地与中央目录路径不一致'
        );
      }
      return { start: offset, end: dataEnd };
    });
    ranges.sort((left, right) => left.start - right.start);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index].start < ranges[index - 1].end) {
        fail('invalid-file', 'security', 'PPTX ZIP 条目数据范围重叠');
      }
    }

    return { entries, entriesByLowerPath };
  } catch (error) {
    if (error instanceof PptxImportError) throw error;
    fail('invalid-file', 'input', 'PPTX ZIP 目录解析失败', error);
  }
}

function relationshipPartToSourcePath(path: string): string | null {
  if (path === '_rels/.rels') return '';
  const marker = '/_rels/';
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex < 0 || !path.endsWith('.rels')) return null;
  return `${path.slice(0, markerIndex)}/${path.slice(
    markerIndex + marker.length,
    -'.rels'.length
  )}`;
}

function relationshipPathForPart(partPath: string): string {
  const lastSlash = partPath.lastIndexOf('/');
  const directory = lastSlash >= 0 ? partPath.slice(0, lastSlash + 1) : '';
  const fileName = partPath.slice(lastSlash + 1);
  return `${directory}_rels/${fileName}.rels`;
}

function normalizeRelationshipTarget(
  sourcePartPath: string,
  rawTarget: string
): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawTarget);
  } catch (error) {
    fail('invalid-ooxml', 'security', 'PPTX 关系目标包含非法 URI 编码', error);
  }
  if (
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    decoded.includes('?')
  ) {
    fail('unsafe-package-path', 'security', 'PPTX 关系目标路径不安全');
  }
  const withoutFragment = decoded.split('#', 1)[0];
  const sourceDirectory = sourcePartPath.includes('/')
    ? sourcePartPath.slice(0, sourcePartPath.lastIndexOf('/') + 1)
    : '';
  const joined = withoutFragment.startsWith('/')
    ? withoutFragment.slice(1)
    : `${sourceDirectory}${withoutFragment}`;
  const normalized: string[] = [];
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (normalized.length === 0) {
        fail('unsafe-package-path', 'security', 'PPTX 关系目标逃逸包根目录');
      }
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  if (normalized.length === 0) {
    fail('unsafe-package-path', 'security', 'PPTX 关系目标为空');
  }
  return normalizePptxPackagePath(normalized.join('/'));
}

function parseXml(xml: string, path: string): XmlRecord {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    fail(
      'invalid-ooxml',
      'security',
      `PPTX XML 部件 ${path} 包含 DTD 或实体声明`
    );
  }
  const validation = XMLValidator.validate(xml, {
    allowBooleanAttributes: false,
  });
  if (validation !== true) {
    fail('invalid-ooxml', 'input', `PPTX XML 部件 ${path} 格式错误`);
  }
  try {
    const parsed = xmlParser.parse(xml);
    if (!isRecord(parsed)) {
      fail('invalid-ooxml', 'input', `PPTX XML 部件 ${path} 没有根元素`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof PptxImportError) throw error;
    fail('invalid-ooxml', 'input', `PPTX XML 部件 ${path} 解析失败`, error);
  }
}

function parseRelationships(document: XmlRecord, path: string): Relationship[] {
  const root = getChild(document, 'Relationships');
  if (!isRecord(root)) {
    fail(
      'invalid-ooxml',
      'input',
      `PPTX 关系部件 ${path} 缺少 Relationships 根元素`
    );
  }
  const relationships: Relationship[] = [];
  const ids = new Set<string>();
  for (const value of asArray(getChild(root, 'Relationship'))) {
    const id = getAttribute(value, 'Id');
    const type = getAttribute(value, 'Type');
    const target = getAttribute(value, 'Target');
    const targetMode = getAttribute(value, 'TargetMode');
    if (!id || !type || !target || ids.has(id)) {
      fail('invalid-ooxml', 'input', `PPTX 关系部件 ${path} 包含无效关系`);
    }
    ids.add(id);
    relationships.push({ id, type, target, targetMode });
  }
  return relationships;
}

function collectTextNodes(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextNodes(item, output);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (localName(key) === 't' && typeof child === 'string') {
      output.push(child);
    } else if (!key.startsWith('@_')) {
      collectTextNodes(child, output);
    }
  }
}

function extractSpeakerNotes(document: XmlRecord): string | undefined {
  const notesRoot = getChild(document, 'notes');
  const commonSlideData = getChild(notesRoot, 'cSld');
  const shapeTree = getChild(commonSlideData, 'spTree');
  const shapes = asArray(getChild(shapeTree, 'sp'));
  const paragraphs: string[] = [];

  for (const shape of shapes) {
    const nonVisual = getChild(getChild(shape, 'nvSpPr'), 'nvPr');
    const placeholder = getChild(nonVisual, 'ph');
    if (getAttribute(placeholder, 'type') !== 'body') continue;
    for (const paragraph of asArray(getChild(getChild(shape, 'txBody'), 'p'))) {
      const text: string[] = [];
      collectTextNodes(paragraph, text);
      const normalized = text
        .join('')
        .split(String.fromCharCode(0))
        .join('')
        .trim();
      if (normalized) paragraphs.push(normalized);
    }
  }

  const notes = paragraphs.join('\n').trim();
  return notes || undefined;
}

async function createFingerprint(
  bytes: Uint8Array
): Promise<{ value: string; algorithm: 'sha256' | 'fnv1a64' }> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return {
      value: Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join(''),
      algorithm: 'sha256',
    };
  }

  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const value of bytes) {
    first = Math.imul(first ^ value, 0x01000193) >>> 0;
    second = Math.imul(second ^ ((value + 0x9d) & 0xff), 0x01000193) >>> 0;
  }
  return {
    value: `${first.toString(16).padStart(8, '0')}${second
      .toString(16)
      .padStart(8, '0')}`,
    algorithm: 'fnv1a64',
  };
}

function trimDiagnosticMessage(message: string): string {
  return message.length <= 512 ? message : `${message.slice(0, 509)}...`;
}

export async function inspectPptxPackage(
  bytes: Uint8Array
): Promise<PptxImportPackageMetadata> {
  const directory = parsePptxZipDirectory(bytes);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, {
      createFolders: false,
      checkCRC32: false,
    });
  } catch (error) {
    fail('invalid-file', 'input', 'PPTX ZIP 内容无法读取', error);
  }

  const diagnostics: PptxImportDiagnostic[] = [];
  const actualPathByLower = new Map(
    directory.entries.map((entry) => [entry.name.toLowerCase(), entry.name])
  );

  const readXmlPart = async (requestedPath: string): Promise<XmlRecord> => {
    const actualPath = actualPathByLower.get(requestedPath.toLowerCase());
    const entry = actualPath
      ? directory.entriesByLowerPath.get(actualPath.toLowerCase())
      : undefined;
    const zipEntry = actualPath ? zip.file(actualPath) : null;
    if (!actualPath || !entry || !zipEntry || entry.directory) {
      fail('invalid-ooxml', 'input', `PPTX 缺少必需部件 ${requestedPath}`);
    }
    let content: Uint8Array;
    try {
      content = await zipEntry.async('uint8array');
    } catch (error) {
      fail('invalid-ooxml', 'input', `PPTX 部件 ${actualPath} 解压失败`, error);
    }
    if (content.byteLength !== entry.uncompressedSize) {
      fail(
        'invalid-file',
        'security',
        `PPTX 部件 ${actualPath} 展开长度与目录声明不一致`
      );
    }
    let xml: string;
    try {
      xml = new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch (error) {
      fail(
        'invalid-ooxml',
        'input',
        `PPTX XML 部件 ${actualPath} 不是有效 UTF-8`,
        error
      );
    }
    return parseXml(xml, actualPath);
  };

  const contentTypes = await readXmlPart('[Content_Types].xml');
  const relationshipParts: ParsedRelationshipPart[] = [];
  for (const entry of directory.entries) {
    const sourcePartPath = relationshipPartToSourcePath(entry.name);
    if (sourcePartPath === null) continue;
    const document = await readXmlPart(entry.name);
    const relationships = parseRelationships(document, entry.name);
    for (const relationship of relationships) {
      if (relationship.targetMode?.toLowerCase() === 'external') {
        fail(
          'external-relationship',
          'security',
          `PPTX 关系部件 ${entry.name} 包含外部目标，已阻止潜在网络访问`
        );
      }
    }
    relationshipParts.push({ sourcePartPath, relationships });
  }

  const relationshipPartBySource = new Map(
    relationshipParts.map((part) => [part.sourcePartPath.toLowerCase(), part])
  );
  const packageRelationships = relationshipPartBySource.get('');
  const officeDocumentRelationship = packageRelationships?.relationships.find(
    (relationship) => relationship.type.endsWith('/officeDocument')
  );
  if (!officeDocumentRelationship) {
    fail('invalid-ooxml', 'input', 'PPTX 包关系中缺少主演示文稿');
  }
  const presentationPath = normalizeRelationshipTarget(
    '',
    officeDocumentRelationship.target
  );
  if (!actualPathByLower.has(presentationPath.toLowerCase())) {
    fail('invalid-ooxml', 'input', 'PPTX 主演示文稿目标不存在');
  }

  const contentTypeRoot = getChild(contentTypes, 'Types');
  const presentationOverride = asArray(
    getChild(contentTypeRoot, 'Override')
  ).find(
    (value) =>
      getAttribute(value, 'PartName')?.replace(/^\//, '').toLowerCase() ===
      presentationPath.toLowerCase()
  );
  const presentationContentType = getAttribute(
    presentationOverride,
    'ContentType'
  );
  if (
    presentationContentType !==
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
  ) {
    fail('invalid-ooxml', 'input', '文件主部件不是标准 PPTX 演示文稿');
  }

  const adjacency = new Map<string, string[]>();
  for (const part of relationshipParts) {
    const targets: string[] = [];
    for (const relationship of part.relationships) {
      const target = normalizeRelationshipTarget(
        part.sourcePartPath,
        relationship.target
      );
      if (actualPathByLower.has(target.toLowerCase())) {
        targets.push(target.toLowerCase());
      } else {
        diagnostics.push({
          code: 'relationship-target-missing',
          severity: 'warning',
          message: trimDiagnosticMessage(
            `关系部件 ${relationshipPathForPart(
              part.sourcePartPath
            )} 引用了缺失目标`
          ),
          source: 'ooxml',
          sourcePartPath: part.sourcePartPath || '_rels/.rels',
        });
      }
    }
    adjacency.set(part.sourcePartPath.toLowerCase(), targets);
  }

  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [
    { path: '', depth: 0 },
  ];
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    if (visited.has(current.path)) continue;
    visited.add(current.path);
    if (current.depth > MAX_PPTX_RELATIONSHIP_DEPTH) {
      fail(
        'relationship-depth-exceeded',
        'security',
        'PPTX 关系图深度异常，已中止可能的无界遍历'
      );
    }
    for (const target of adjacency.get(current.path) || []) {
      if (!visited.has(target)) {
        queue.push({ path: target, depth: current.depth + 1 });
      }
    }
  }

  const presentation = await readXmlPart(presentationPath);
  const presentationRoot = getChild(presentation, 'presentation');
  const slideSizeElement = getChild(presentationRoot, 'sldSz');
  const widthEmu = Number(getAttribute(slideSizeElement, 'cx'));
  const heightEmu = Number(getAttribute(slideSizeElement, 'cy'));
  if (
    !Number.isSafeInteger(widthEmu) ||
    !Number.isSafeInteger(heightEmu) ||
    widthEmu <= 0 ||
    heightEmu <= 0
  ) {
    fail('invalid-ooxml', 'input', 'PPTX 页面尺寸缺失或无效');
  }

  const presentationRelationships = relationshipPartBySource.get(
    presentationPath.toLowerCase()
  );
  if (!presentationRelationships) {
    fail('invalid-ooxml', 'input', 'PPTX 缺少演示文稿关系部件');
  }
  const relationshipsById = new Map(
    presentationRelationships.relationships.map((relationship) => [
      relationship.id,
      relationship,
    ])
  );
  const slideIds = asArray(
    getChild(getChild(presentationRoot, 'sldIdLst'), 'sldId')
  );
  if (slideIds.length === 0) {
    fail('empty-presentation', 'input', 'PPTX 不包含任何页面');
  }

  const slides: PptxImportPackageSlide[] = [];
  const seenSlides = new Set<string>();
  for (let index = 0; index < slideIds.length; index += 1) {
    const relationId = getRelationshipId(slideIds[index]);
    const relationship = relationId
      ? relationshipsById.get(relationId)
      : undefined;
    if (!relationship || !relationship.type.endsWith('/slide')) {
      fail('invalid-ooxml', 'input', `PPTX 第 ${index + 1} 页关系无效`);
    }
    const slidePath = normalizeRelationshipTarget(
      presentationPath,
      relationship.target
    );
    if (
      seenSlides.has(slidePath.toLowerCase()) ||
      !actualPathByLower.has(slidePath.toLowerCase())
    ) {
      fail('invalid-ooxml', 'input', `PPTX 第 ${index + 1} 页部件缺失或重复`);
    }
    seenSlides.add(slidePath.toLowerCase());
    await readXmlPart(slidePath);

    let notes: string | undefined;
    const slideRelationships = relationshipPartBySource.get(
      slidePath.toLowerCase()
    );
    const notesRelationships =
      slideRelationships?.relationships.filter((item) =>
        item.type.endsWith('/notesSlide')
      ) || [];
    if (notesRelationships.length > 1) {
      fail('invalid-ooxml', 'input', `PPTX 第 ${index + 1} 页包含多个备注关系`);
    }
    if (notesRelationships.length === 1) {
      const notesPath = normalizeRelationshipTarget(
        slidePath,
        notesRelationships[0].target
      );
      if (actualPathByLower.has(notesPath.toLowerCase())) {
        try {
          notes = extractSpeakerNotes(await readXmlPart(notesPath));
        } catch (error) {
          if (error instanceof PptxImportError && error.kind !== 'security') {
            diagnostics.push({
              code: 'speaker-notes-unreadable',
              severity: 'warning',
              message: `第 ${index + 1} 页讲者备注无法读取，已按无备注处理`,
              pageIndex: index + 1,
              source: 'ooxml',
              sourcePartPath: notesPath,
            });
          } else {
            throw error;
          }
        }
      } else {
        diagnostics.push({
          code: 'speaker-notes-missing',
          severity: 'warning',
          message: `第 ${index + 1} 页讲者备注部件缺失，已按无备注处理`,
          pageIndex: index + 1,
          source: 'ooxml',
          sourcePartPath: notesPath,
        });
      }
    }

    slides.push({
      pageIndex: index + 1,
      sourcePartPath: slidePath,
      ...(notes ? { notes } : {}),
    });
  }

  const fingerprint = await createFingerprint(bytes);
  return {
    fingerprint: fingerprint.value,
    fingerprintAlgorithm: fingerprint.algorithm,
    slideSize: {
      widthEmu,
      heightEmu,
      aspectRatio: widthEmu / heightEmu,
    },
    slides,
    diagnostics,
  };
}
