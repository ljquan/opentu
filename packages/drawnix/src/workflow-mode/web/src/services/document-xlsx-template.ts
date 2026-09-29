import * as XLSX from 'xlsx';

/** Keep the first row compatible with automatic header detection. */
export function createDocumentBatchTemplate(): XLSX.WorkBook {
    const sheet = XLSX.utils.aoa_to_sheet([
        ['标题', '提示词', '图片', '数量'],
        ['示例：纯文字生图（使用前替换或删除）', '生成一张橙红色陶瓷杯的产品照片，米白背景，柔和自然光，无文字。', '', 1],
    ]);
    sheet['!cols'] = [{ wch: 38 }, { wch: 80 }, { wch: 48 }, { wch: 10 }];
    sheet['!rows'] = [{ hpt: 24 }, { hpt: 112 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '批量生成');
    return workbook;
}

export function downloadDocumentBatchTemplate(): void {
    XLSX.writeFile(createDocumentBatchTemplate(), '文档批量生成模板.xlsx');
}
