import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import {
  embedImagesInXlsx,
  mapExportImages,
  readImageBytes,
  splitExcelSource,
} from './xlsx-image-export';
import { readXlsxEmbeddedImages } from './xlsx-embedded-images';

describe('XLSX embedded image export', () => {
  it('embeds images in requested row and column while keeping cells readable', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['提示词', '参考图', '预览图'],
        ['first', '', ''],
      ]),
      'data'
    );
    const input = XLSX.write(workbook, {
      type: 'array',
      bookType: 'xlsx',
    }) as ArrayBuffer;
    const output = await embedImagesInXlsx(input, [
      {
        row: 1,
        column: 1,
        offset: 0,
        name: 'reference',
        bytes: new Uint8Array([1, 2]),
        width: 2,
        height: 1,
        contentType: 'image/png',
      },
      {
        row: 1,
        column: 2,
        offset: 0,
        name: 'preview',
        bytes: new Uint8Array([3, 4]),
        width: 1,
        height: 2,
        contentType: 'image/jpeg',
      },
    ]);
    const zip = await JSZip.loadAsync(output);
    expect(
      await zip.file('xl/media/batch-image-1.png')?.async('uint8array')
    ).toEqual(new Uint8Array([1, 2]));
    expect(
      await zip.file('xl/media/batch-image-2.jpg')?.async('uint8array')
    ).toEqual(new Uint8Array([3, 4]));
    const drawing = await zip.file('xl/drawings/drawing1.xml')?.async('text');
    expect(drawing).toContain('<xdr:col>1</xdr:col>');
    expect(drawing).toContain('<xdr:col>2</xdr:col>');
    expect(drawing).toContain('<xdr:row>1</xdr:row>');
    expect(drawing).toContain('cx="1143000" cy="571500"');
    expect(drawing).toContain('cx="571500" cy="1143000"');
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml')?.async('text');
    const stylesXml = await zip.file('xl/styles.xml')?.async('text');
    expect(stylesXml).toContain('wrapText="1"');
    expect(sheetXml).toMatch(/<c[^>]+s="\d+"/);
    const textOnly = await JSZip.loadAsync(await embedImagesInXlsx(input, []));
    expect(await textOnly.file('xl/styles.xml')?.async('text')).toContain(
      'wrapText="1"'
    );
    expect(
      await textOnly.file('xl/worksheets/sheet1.xml')?.async('text')
    ).toMatch(/<c[^>]+s="\d+"/);
    const reopened = XLSX.read(output, { type: 'array' });
    const references = await readXlsxEmbeddedImages(
      output,
      'data',
      new Set([1])
    );
    expect(references.get(1)).toEqual([
      { url: 'data:image/png;base64,AQI=', column: 1 },
    ]);
    expect((await readXlsxEmbeddedImages(output, 'data')).get(1)).toHaveLength(
      2
    );
    expect(
      XLSX.utils.sheet_to_json(reopened.Sheets.data, { header: 1 })
    ).toEqual([
      ['提示词', '参考图', '预览图'],
      ['first', '', ''],
    ]);
  });

  it('keeps the data URL MIME type when reading inline images', async () => {
    await expect(
      readImageBytes('data:image/jpeg;base64,AQID')
    ).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
      width: 1,
      height: 1,
    });
  });

  it('reports failed remote reads to the caller so the source URL remains exportable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    );
    await expect(
      readImageBytes('https://images.example.com/photo.png')
    ).rejects.toThrow('503');
    vi.unstubAllGlobals();
  });

  it('rejects an HTML response even when the URL looks like an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => ({
          type: 'text/html',
          arrayBuffer: async () => new ArrayBuffer(0),
        }),
      })
    );
    await expect(
      readImageBytes('https://images.example.com/photo.png')
    ).rejects.toThrow('非图片内容');
    vi.unstubAllGlobals();
  });

  it('splits long failed sources and bounds fetch concurrency', async () => {
    expect(
      splitExcelSource('x'.repeat(65000)).map((part) => part.length)
    ).toEqual([32000, 32000, 1000]);
    let active = 0;
    let maximum = 0;
    const result = await mapExportImages(
      Array.from({ length: 12 }, (_, i) => i),
      async (value) => {
        active++;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active--;
        return value;
      }
    );
    expect(result).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(maximum).toBe(8);
  });
});
