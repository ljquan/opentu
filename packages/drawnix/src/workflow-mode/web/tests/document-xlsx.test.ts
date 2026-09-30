import { beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import * as XLSX from 'xlsx';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { IMPORT_LIMITS, importXlsxBytes, resolveZipPath, unpackDocument, validateImageLink } from '../src/services/document-xlsx-import';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
function workbook(sheets: Array<{name: string; data: unknown[][]; hiddenRows?: number[]; hidden?: boolean}>) {
  const book = XLSX.utils.book_new();
  for (const { name, data, hiddenRows } of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(data);
    if (hiddenRows) { sheet['!rows'] = []; for (const row of hiddenRows) sheet['!rows'][row] = {hidden:true}; }
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  book.Workbook = {Sheets: sheets.map(s => ({name:s.name, Hidden:s.hidden ? 1 : 0}))};
  return XLSX.write(book, {type:'array',bookType:'xlsx'}) as ArrayBuffer;
}
const png = new Uint8Array([137,80,78,71,13,10,26,10]);
function withDrawing(buffer: ArrayBuffer, anchors: Array<{row:number; col?:number; end?:number; missing?:boolean}>) {
  const files = unzipSync(new Uint8Array(buffer));
  const sheetPath = 'xl/worksheets/sheet1.xml';
  files[sheetPath] = strToU8(new TextDecoder().decode(files[sheetPath]).replace('</worksheet>', '<drawing r:id="arbitraryDrawingId"/></worksheet>'));
  files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8('<Relationships><Relationship Target="../drawings/custom.xml" Id="arbitraryDrawingId" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"/></Relationships>');
  const content = anchors.map((a,i) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${a.col ?? 0}</xdr:col><xdr:row>${a.row}</xdr:row></xdr:from><xdr:to><xdr:row>${a.end ?? a.row + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:blipFill><a:blip r:embed="img${i}"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor>`).join('');
  files['xl/drawings/custom.xml'] = strToU8(`<xdr:wsDr xmlns:xdr="x" xmlns:a="a" xmlns:r="r">${content}</xdr:wsDr>`);
  files['xl/drawings/_rels/custom.xml.rels'] = strToU8(`<Relationships>${anchors.map((a,i) => `<Relationship Type="image" Target="../media/${a.missing ? 'missing' : i}.png" Id="img${i}"/>`).join('')}</Relationships>`);
  anchors.forEach((a,i) => { if (!a.missing) files[`xl/media/${i}.png`] = png; });
  return new Uint8Array(zipSync(files)).buffer;
}
describe('document XLSX import', () => {
  it.each(['xl/cellimages.xml', 'xl/richData/rdrichvalue.xml'])('requires review of every row for unmapped image extensions: %s', async path => {
    const files = unzipSync(new Uint8Array(workbook([{name:'one',data:[['prompt'],['x'],['y']]}])));
    files[path] = strToU8('<root/>');
    const result = await importXlsxBytes(new Uint8Array(zipSync(files)).buffer, 'images.xlsx');
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every(row => row.status === 'needs-review' && row.diagnostics.some(d => d.message.includes('补图')))).toBe(true);
  });
  it('preserves physical row provenance and signed link commas', async () => {
    const result = await importXlsxBytes(workbook([{name:'中文表',data:[['提示词','图片链接'],['first','https://cdn.example.com/a,b.png'],[],['second','']]}]), 'a.xlsx');
    expect(result.rows.map(r=>r.source)).toEqual(['中文表!2','中文表!4']);
    expect(result.rows[0].references[0].url).toBe('https://cdn.example.com/a,b.png');
    expect(result.hash).toHaveLength(64);
  });
  it('accepts exactly 500 non-empty rows across sheets and ignores trailing blanks', async () => {
    const rows = [['prompt'], ...Array.from({length:250},(_,i)=>[`a-${i}`]), [], []];
    const result = await importXlsxBytes(workbook([{name:'one',data:rows},{name:'two',data:rows}]), 'a.xlsx');
    expect(result.rows).toHaveLength(500);
    await expect(importXlsxBytes(workbook([{name:'one',data:rows},{name:'two',data:[...rows,['extra']]}]), 'a.xlsx')).rejects.toThrow(/500/);
  });
  it('rejects invalid and duplicate mappings before using indexes', async () => {
    const bytes=workbook([{name:'one',data:[['prompt'],['x']]}]);
    await expect(importXlsxBytes(bytes,'a.xlsx',{mappings:[{sheet:'one',headerRow:0,prompt:0,title:-1,images:-1}]})).rejects.toThrow(/映射/);
    await expect(importXlsxBytes(bytes,'a.xlsx',{mappings:[{sheet:'other',headerRow:1,prompt:0,title:-1,images:-1}]})).rejects.toThrow(/映射/);
  });
  it('sorts embedded image columns and follows relationship ids', async () => {
    const bytes=withDrawing(workbook([{name:'one',data:[['prompt'],['x']]}]),[{row:1,col:4},{row:1,col:1}]);
    const result=await importXlsxBytes(bytes,'a.xlsx');
    expect(result.rows[0].references.map(r=>r.name)).toEqual(['1.png','0.png']);
    expect(result.unassigned).toHaveLength(0);
  });
  it('leaves cross-row images unassigned and diagnoses missing media', async () => {
    const bytes=withDrawing(workbook([{name:'one',data:[['prompt'],['x'],['y']]}]),[{row:1,end:3},{row:2,missing:true}]);
    const result=await importXlsxBytes(bytes,'a.xlsx');
    expect(result.unassigned).toHaveLength(1);
    expect(result.rows.every(r=>r.status==='needs-review')).toBe(true);
    expect(result.diagnostics.some(d=>d.message.includes('缺失'))).toBe(true);
  });
  it('excludes hidden rows and their images unless explicitly included', async () => {
    const bytes=withDrawing(workbook([{name:'one',data:[['prompt'],['secret'],['visible']],hiddenRows:[1]},{name:'hidden sheet',data:[['prompt'],['other secret']],hidden:true}]),[{row:1}]);
    const result=await importXlsxBytes(bytes,'a.xlsx');
    expect(result.rows.map(r=>r.prompt)).toEqual(['visible']);
    expect(result.unassigned).toHaveLength(0);
    const explicit=await importXlsxBytes(bytes,'a.xlsx',{includeHidden:true});
    expect(explicit.rows).toHaveLength(3);
    expect(explicit.rows[0].references).toHaveLength(1);
  });
  it('rejects more than 16 combined embedded and link references', async () => {
    const bytes=withDrawing(workbook([{name:'one',data:[['prompt','images'],['x','https://cdn.example.com/a.png']]}]),Array.from({length:16},()=>({row:1})));
    await expect(importXlsxBytes(bytes,'a.xlsx')).rejects.toThrow(/16/);
  });
  it('rejects ZIP traversal, duplicate-normalized paths, and actual expansion budgets', () => {
    expect(()=>resolveZipPath('xl/worksheets/sheet1.xml','../../../outside')).toThrow();
    expect(resolveZipPath('xl/drawings/custom.xml','../media/a.png')).toBe('xl/media/a.png');
    expect(()=>unpackDocument(zipSync({'/absolute':strToU8('x')}))).toThrow(/路径/);
    expect(()=>unpackDocument(zipSync({'a/../b':strToU8('x')}))).toThrow(/路径/);
    expect(()=>unpackDocument(zipSync({'a':new Uint8Array(10000)}),{...IMPORT_LIMITS,entry:100})).toThrow(/预算/);
    expect(()=>unpackDocument(zipSync({'a':new Uint8Array(100),'b':new Uint8Array(100)}),{...IMPORT_LIMITS,expanded:150})).toThrow(/预算/);
  });
  it('rejects credentials, local hosts, normalized numeric IPs and unsafe protocols', () => {
    for(const url of ['http://127.0.0.1/a','http://2130706433/a','http://10.1.2.3/a','http://[::1]/a','https://user:pass@example.com/a','file:///x','http://foo.local/a']) expect(()=>validateImageLink(url)).toThrow();
  });
  it('resolves model columns only from the supplied image catalog and preserves scoped parameters',async()=>{
    const bytes=workbook([{name:'one',data:[['prompt','模型','数量','参数','比例','分辨率'],['x','paint','3','{"quality":"high"}','16:9','2k']]}]);
    const result=await importXlsxBytes(bytes,'a.xlsx',{availableModels:['channel::paint']});
    expect(result.rows[0].overrides).toMatchObject({model:'channel::paint',count:3});
    expect(JSON.parse(result.rows[0].overrides!.nativeParams!)).toEqual({'image::channel::paint':{quality:'high',aspect_ratio:'16:9',resolution:'2k'}});
    expect(result.rows[0].status).toBe('needs-review');
    const ambiguous=await importXlsxBytes(bytes,'a.xlsx',{availableModels:['a::paint','b::paint']});
    expect(ambiguous.rows[0].diagnostics.some(d=>d.message.includes('唯一渠道'))).toBe(true);
  });
  it('retains invalid count and JSON as diagnostics instead of silently using them',async()=>{
    const result=await importXlsxBytes(workbook([{name:'one',data:[['prompt','count','params'],['x','-2','{invalid}']]}]),'a.xlsx');
    expect(result.rows[0].overrides?.count).toBe(0);
    expect(result.rows[0].diagnostics.some(d=>d.message.includes('-2'))).toBe(true);
    expect(result.rows[0].diagnostics.some(d=>d.message.includes('{invalid}'))).toBe(true);
  });
  it('rejects entity-bearing XML and macro packages before parsing', async () => {
    const bytes=workbook([{name:'one',data:[['prompt'],['x']]}]);
    const macro=unzipSync(new Uint8Array(bytes));macro['xl/vbaProject.bin']=new Uint8Array([1]);
    await expect(importXlsxBytes(new Uint8Array(zipSync(macro)).buffer,'a.xlsx')).rejects.toThrow(/宏/);
    const entity=unzipSync(new Uint8Array(bytes));entity['xl/workbook.xml']=strToU8('<!DOCTYPE a [<!ENTITY x "x">]><workbook/>');
    await expect(importXlsxBytes(new Uint8Array(zipSync(entity)).buffer,'a.xlsx')).rejects.toThrow();
  });
});

it.each(['http://127.0.0.1./image','http://localhost./image','http://10.0.0.1.nip.io/image','http://127.0.0.1.sslip.io/image'])('rejects local-address aliases: %s', (url) => {
 expect(() => validateImageLink(url)).toThrow();
});
