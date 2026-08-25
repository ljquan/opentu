import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  inspectPptxPackage,
  MAX_PPTX_DECLARED_EXPANDED_BYTES,
  MAX_PPTX_ZIP_ENTRY_COUNT,
  parsePptxZipDirectory,
} from './pptx-package-inspector';
import { PptxImportError } from './pptx-import.types';

interface FixtureOptions {
  pages?: number;
  notes?: string;
  externalRelationship?: boolean;
  includeSlides?: boolean;
}

function contentTypesXml(pageCount: number): string {
  const slideOverrides = Array.from(
    { length: pageCount },
    (_, index) =>
      `<Override PartName="/ppt/slides/slide${
        index + 1
      }.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
      ${slideOverrides}
    </Types>`;
}

async function createPptxFixture(
  options: FixtureOptions = {}
): Promise<Uint8Array> {
  const pageCount = options.pages ?? 1;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml(pageCount));
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
    </Relationships>`
  );

  const slideIds = Array.from(
    { length: pageCount },
    (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`
  ).join('');
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst>${
        options.includeSlides === false ? '' : slideIds
      }</p:sldIdLst>
      <p:sldSz cx="12192000" cy="6858000"/>
    </p:presentation>`
  );

  const slideRelationships = Array.from(
    { length: pageCount },
    (_, index) =>
      `<Relationship Id="rId${
        index + 1
      }" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${
        index + 1
      }.xml"/>`
  ).join('');
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideRelationships}</Relationships>`
  );

  for (let index = 1; index <= pageCount; index += 1) {
    zip.file(
      `ppt/slides/slide${index}.xml`,
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>`
    );
  }

  if (options.notes) {
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
        ${
          options.externalRelationship
            ? '<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>'
            : ''
        }
      </Relationships>`
    );
    zip.file(
      'ppt/notesSlides/notesSlide1.xml',
      `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>${options.notes}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
      </p:notes>`
    );
    zip.file(
      'ppt/notesSlides/_rels/notesSlide1.xml.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdSlide" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide1.xml"/>
      </Relationships>`
    );
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'STORE',
  });
}

function expectImportError(
  promise: Promise<unknown>,
  code: PptxImportError['code']
): Promise<void> {
  return expect(promise).rejects.toMatchObject({ code }) as Promise<void>;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('测试 ZIP 缺少中央目录结束记录');
}

function getCentralDirectoryEntryOffsets(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let cursor = view.getUint32(eocdOffset + 16, true);
  const offsets: number[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('测试 ZIP 中央目录条目损坏');
    }
    offsets.push(cursor);
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
  }
  return offsets;
}

describe('PPTX package inspection', () => {
  it('accepts a structural PPTX, preserves order and extracts body notes', async () => {
    const metadata = await inspectPptxPackage(
      await createPptxFixture({ pages: 2, notes: '第一页讲者备注' })
    );

    expect(metadata.slides).toEqual([
      {
        pageIndex: 1,
        sourcePartPath: 'ppt/slides/slide1.xml',
        notes: '第一页讲者备注',
      },
      { pageIndex: 2, sourcePartPath: 'ppt/slides/slide2.xml' },
    ]);
    expect(metadata.slideSize).toMatchObject({
      widthEmu: 12192000,
      heightEmu: 6858000,
      aspectRatio: 16 / 9,
    });
    expect(metadata.fingerprint).toMatch(/^[a-f0-9]{16,64}$/);
  });

  it('does not impose a 20-page product limit', async () => {
    const metadata = await inspectPptxPackage(
      await createPptxFixture({ pages: 21 })
    );
    expect(metadata.slides).toHaveLength(21);
    expect(metadata.slides[20].pageIndex).toBe(21);
  });

  it('rejects an empty presentation with a specific input error', async () => {
    await expectImportError(
      inspectPptxPackage(
        await createPptxFixture({ pages: 1, includeSlides: false })
      ),
      'empty-presentation'
    );
  });

  it('rejects fake, encrypted and external-relation packages', async () => {
    await expectImportError(
      inspectPptxPackage(new Uint8Array([1, 2, 3])),
      'invalid-file'
    );

    const encrypted = new Uint8Array(22);
    encrypted.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expectImportError(inspectPptxPackage(encrypted), 'encrypted-file');

    await expectImportError(
      inspectPptxPackage(
        await createPptxFixture({
          notes: 'notes',
          externalRelationship: true,
        })
      ),
      'external-relationship'
    );
  });

  it('rejects ZIP path traversal before OOXML extraction', async () => {
    const zip = new JSZip();
    zip.file('../escape.xml', '<x/>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    expect(() => parsePptxZipDirectory(bytes)).toThrowError(
      expect.objectContaining({ code: 'unsafe-package-path' })
    );
  });

  it('rejects encrypted ZIP flags before decompression', async () => {
    const bytes = await createPptxFixture();
    const mutated = bytes.slice();
    for (let offset = 0; offset + 10 < mutated.length; offset += 1) {
      if (
        mutated[offset] === 0x50 &&
        mutated[offset + 1] === 0x4b &&
        mutated[offset + 2] === 0x01 &&
        mutated[offset + 3] === 0x02
      ) {
        mutated[offset + 8] |= 0x01;
        break;
      }
    }
    expect(() => parsePptxZipDirectory(mutated)).toThrowError(
      expect.objectContaining({ code: 'encrypted-file' })
    );
  });

  it('rejects excessive ZIP entries as structural safety, not a page cap', async () => {
    const bytes = (await createPptxFixture()).slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEndOfCentralDirectory(bytes);
    const unsafeEntryCount = MAX_PPTX_ZIP_ENTRY_COUNT + 1;
    view.setUint16(eocdOffset + 8, unsafeEntryCount, true);
    view.setUint16(eocdOffset + 10, unsafeEntryCount, true);

    expect(() => parsePptxZipDirectory(bytes)).toThrowError(
      expect.objectContaining({
        code: 'unsafe-package-resource-budget',
        kind: 'security',
        message: expect.stringContaining('不是产品页数限制'),
      })
    );
  });

  it('rejects a low-ratio package with an excessive declared expanded size', async () => {
    const bytes = (await createPptxFixture()).slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entryOffsets = getCentralDirectoryEntryOffsets(bytes);
    const declaredSize = Math.floor(MAX_PPTX_DECLARED_EXPANDED_BYTES / 2) + 1;
    for (const offset of entryOffsets.slice(0, 2)) {
      view.setUint32(offset + 20, declaredSize, true);
      view.setUint32(offset + 24, declaredSize, true);
    }

    expect(() => parsePptxZipDirectory(bytes)).toThrowError(
      expect.objectContaining({
        code: 'unsafe-package-resource-budget',
        kind: 'security',
        message: expect.stringContaining('不是产品原文件大小限制'),
      })
    );
  });

  it('rejects XML entity declarations without expanding them', async () => {
    const bytes = await createPptxFixture();
    const zip = await JSZip.loadAsync(bytes);
    zip.file(
      'ppt/presentation.xml',
      '<!DOCTYPE x [<!ENTITY a "boom">]><p:presentation xmlns:p="p"><p:sldIdLst/><p:sldSz cx="1" cy="1"/></p:presentation>'
    );
    await expectImportError(
      inspectPptxPackage(
        await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
      ),
      'invalid-ooxml'
    );
  });
});
