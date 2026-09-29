import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createDocumentBatchTemplate } from '../src/services/document-xlsx-template';
import { importXlsxBytes } from '../src/services/document-xlsx-import';

describe('downloadable batch template', () => {
    it('round trips through the actual importer without mappings or diagnostics', async () => {
        const data = XLSX.write(createDocumentBatchTemplate(), {type:'array',bookType:'xlsx'});
        const imported = await importXlsxBytes(data, 'template.xlsx');
        expect(imported.rows).toHaveLength(1);
        expect(imported.rows[0].prompt).toContain('橙红色陶瓷杯');
        expect(imported.rows[0].references).toEqual([]);
        expect(imported.rows[0].status).toBe('ready');
        expect(imported.rows[0].overrides?.count).toBe(1);
        expect(imported.rows[0].diagnostics).toEqual([]);
        expect(imported.diagnostics).toEqual([]);
    });
});
