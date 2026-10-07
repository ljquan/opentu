import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import {
  mergeImageColumns,
  readXlsxEmbeddedImages,
} from './xlsx-embedded-images';

describe('readXlsxEmbeddedImages', () => {
  it('merges URL and embedded references by reference column order', () => {
    expect(
      mergeImageColumns(
        [{ url: 'https://example.com/two.png', column: 5 }],
        [{ url: 'data:image/png;base64,AQID', column: 4 }]
      )
    ).toEqual(['data:image/png;base64,AQID', 'https://example.com/two.png']);
  });

  it('maps multiple floating pictures to their physical worksheet row', async () => {
    const files: Record<string, Uint8Array> = {};
    files['xl/workbook.xml'] = strToU8(
      '<workbook><sheets><sheet name="Tasks" id="sheetRel"/></sheets></workbook>'
    );
    files['xl/_rels/workbook.xml.rels'] = strToU8(
      '<Relationships><Relationship Id="sheetRel" Target="worksheets/sheet1.xml"/></Relationships>'
    );
    files['xl/worksheets/sheet1.xml'] = strToU8(
      '<worksheet><drawing id="drawingRel"/></worksheet>'
    );
    files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
      '<Relationships><Relationship Id="drawingRel" Target="../drawings/drawing1.xml"/></Relationships>'
    );
    files['xl/drawings/drawing1.xml'] = strToU8(
      '<wsDr><oneCellAnchor><from><col>4</col><row>2</row></from><pic><blipFill><blip embed="image1"/></blipFill></pic></oneCellAnchor><oneCellAnchor><from><col>4</col><row>2</row></from><pic><blipFill><blip embed="image2"/></blipFill></pic></oneCellAnchor><oneCellAnchor><from><col>4</col><row>4</row></from><pic><blipFill><blip embed="image1"/></blipFill></pic></oneCellAnchor></wsDr>'
    );
    files['xl/drawings/_rels/drawing1.xml.rels'] = strToU8(
      '<Relationships><Relationship Id="image1" Target="../media/one.png"/><Relationship Id="image2" Target="/xl/media/two.jpg"/></Relationships>'
    );
    files['xl/media/one.png'] = new Uint8Array([1, 2, 3]);
    files['xl/media/two.jpg'] = new Uint8Array([4, 5, 6]);

    const bytes = zipSync(files);
    const buffer = new Uint8Array(bytes).buffer;
    const images = await readXlsxEmbeddedImages(buffer, 'Tasks');

    expect(images.get(2)).toEqual([
      { url: 'data:image/png;base64,AQID', column: 4 },
      { url: 'data:image/jpeg;base64,BAUG', column: 4 },
    ]);
    expect(images.get(4)).toEqual([
      { url: 'data:image/png;base64,AQID', column: 4 },
    ]);
    expect(await readXlsxEmbeddedImages(buffer, 'Other sheet')).toEqual(
      new Map()
    );

    files['xl/drawings/drawing1.xml'] = strToU8(
      '<wsDr><twoCellAnchor><from><row>5</row><col>5</col></from><pic><blipFill><blip embed="image2"/></blipFill></pic></twoCellAnchor><twoCellAnchor><from><row>5</row><col>4</col></from><pic><blipFill><blip embed="image1"/></blipFill></pic></twoCellAnchor></wsDr>'
    );
    const ordered = await readXlsxEmbeddedImages(
      new Uint8Array(zipSync(files)).buffer,
      'Tasks'
    );
    expect(ordered.get(5)).toEqual([
      { url: 'data:image/png;base64,AQID', column: 4 },
      { url: 'data:image/jpeg;base64,BAUG', column: 5 },
    ]);

    delete files['xl/media/one.png'];
    await expect(
      readXlsxEmbeddedImages(new Uint8Array(zipSync(files)).buffer, 'Tasks')
    ).rejects.toThrow('图片资源缺失');
  });

  it('preserves physical row numbers across blank rows', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['提示词'],
      ['first'],
      [],
      ['second'],
    ]);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(rows.map((row) => row.__rowNum__)).toEqual([1, 3]);
  });

  it.runIf(Boolean(process.env.BATCH_XLSX_TEST_FILE))(
    'extracts all nine images from the supplied regression workbook',
    async () => {
      const bytes = readFileSync(process.env.BATCH_XLSX_TEST_FILE || '');
      const buffer = new Uint8Array(bytes).buffer;
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[sheetName]
      );
      const images = await readXlsxEmbeddedImages(buffer, sheetName);
      expect(
        rows.map((row) => images.get(Number(row.__rowNum__))?.length || 0)
      ).toEqual([0, 1, 2, 3, 1, 2]);
      expect([...images.values()].flat()).toHaveLength(9);
      expect(
        [...images.values()]
          .flat()
          .every(({ url }) => url.startsWith('data:image/png;base64,iVBOR'))
      ).toBe(true);
    }
  );
});
