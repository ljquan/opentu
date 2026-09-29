import {describe,it,expect} from 'vitest';
import {promptEdit,validateEditedBatch} from '../src/pages/batch-generation/row-editing';
import type {BatchRow} from '../src/types/document-batch';
const row=():BatchRow=>({id:'row',order:0,title:'a',prompt:'',references:[],source:'A!2',status:'needs-review',diagnostics:[],results:[],updatedAt:1});
describe('document row editing',()=>{
 it('preserves pairing diagnostics when the prompt is corrected',()=>{const original={...row(),diagnostics:[{id:'pair',severity:'warning' as const,message:'跨行图片需要核对归属'},{id:'empty',severity:'warning' as const,message:'提示词为空或未映射，请补录'}]};const next=promptEdit(original,'新的原文');expect(next.status).toBe('needs-review');expect(next.diagnostics?.map(d=>d.id)).toEqual(['pair']);});
 it('does not consider an unloaded URL ready for generation',()=>{const original={...row(),references:[{id:'ref',name:'ref',url:'https://example.com/a',source:'A!2'}]};expect(promptEdit(original,'prompt').status).toBe('needs-review');});
 it('requires a nonempty prompt without deleting source diagnostics',()=>{const original={...row(),diagnostics:[{id:'source',severity:'warning' as const,message:'PDF 图文配对待确认'}]};const next=promptEdit(original,'  ');expect(next.diagnostics).toHaveLength(2);expect(next.status).toBe('needs-review');});
 it('enforces edit budgets rather than truncating rows or references',()=>{expect(validateEditedBatch(Array.from({length:500},row))).toBeUndefined();expect(validateEditedBatch(Array.from({length:501},row))).toContain('500');expect(validateEditedBatch([{...row(),references:Array.from({length:17},()=>({id:'r',name:'r',url:'',source:'manual'}))}])).toContain('16');});
});
