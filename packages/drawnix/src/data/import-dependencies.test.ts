import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import mermaid from 'mermaid';

describe('updated import dependencies', () => {
  it('preserves workbook cell types through an XLSX round trip', () => {
    const rows = [['Name', 'Count', 'Enabled'], ['example', 12, true]];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Data');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const restored = XLSX.read(bytes, { type: 'array' });
    expect(XLSX.utils.sheet_to_json(restored.Sheets.Data, { header: 1 })).toEqual(rows);
    expect(XLSX.version).toBe('0.20.3');
  });

  it('parses existing flowchart and sequence syntax in strict mode', async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    await expect(mermaid.parse('flowchart LR\n A[Start] --> B[End]')).resolves.toBeTruthy();
    await expect(mermaid.parse('sequenceDiagram\n Alice->>Bob: Hello')).resolves.toBeTruthy();
  }, 30000);
});
