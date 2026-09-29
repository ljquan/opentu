import type { DocumentBatch, BatchWorkItem, BatchRun, BatchSnapshot } from '@/types/document-batch';
import { nanoid } from 'nanoid';
const DB_NAME = 'opentu-document-batches';
const stores = ['batches', 'items', 'runs', 'controls'] as const;
export class BatchConflictError extends Error { constructor() { super('批次已被其他标签页修改或删除；本地编辑已保留，请重新加载后核对。'); } }
function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve,reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => { for (const name of stores) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name,{keyPath:'id'}); };
        req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
        req.onerror = () => reject(req.error || new Error('无法打开批次存储'));
        req.onblocked = () => reject(new Error('其他标签页正在使用旧版存储，请关闭后重试'));
    });
}
const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve,reject) => { request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); });
async function transaction<T>(names: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction)=>Promise<T>): Promise<T> {
    const db = await openDatabase();
    try {
        const tx=db.transaction(names,mode);
        const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||new Error('批次事务未完成'));});
        // Install rejection handling before an action can abort.
        void done.catch(()=>undefined);
        try { const result=await action(tx); await done; return result; }
        catch(error){try{tx.abort();}catch{/* already completed */} await done.catch(()=>undefined);throw error;}
    } finally {db.close();}
}
export const listDocumentBatches = (scopeId:string) => transaction(['batches'],'readonly',async tx => ((await read(tx.objectStore('batches').getAll())) as DocumentBatch[]).filter(b=>b.scopeId===scopeId&&!b.deletedAt).sort((a,b)=>b.updatedAt-a.updatedAt));
export const getDocumentBatch = (id:string,scopeId:string) => transaction(['batches'],'readonly',async tx => {const b=await read(tx.objectStore('batches').get(id)) as DocumentBatch|undefined;return b?.scopeId===scopeId&&!b.deletedAt?b:undefined;});
export const saveDocumentBatch = (batch:DocumentBatch) => transaction(['batches'],'readwrite',async tx => {
    const store=tx.objectStore('batches'); const old=await read(store.get(batch.id)) as DocumentBatch|undefined;
    if(old && (old.scopeId!==batch.scopeId||old.deletedAt||(old.revision||0)!==(batch.revision||0)))throw new BatchConflictError();
    if(batch.rows.length>500)throw new Error('批次最多 500 行，请拆分批次');
    const bytes=(batch.imports||[]).reduce((n,i)=>n+i.blob.size+(i.pages||[]).reduce((s,p)=>s+p.blob.size,0),0)+[...batch.rows.flatMap(r=>r.references),...(batch.unassigned||[])].reduce((n,r)=>n+(r.blob?.size||0),0);
    if(bytes>500*1024*1024)throw new Error('批次本地资源超过 500 MiB，请拆分');
    const next={...batch,revision:(old?.revision||0)+1,epoch:old?.epoch||0,updatedAt:Date.now()};store.put(next);return next;
});
export const deleteDocumentBatch = (id:string,scopeId:string,revision?:number) => transaction(['batches','items','runs','controls'],'readwrite',async tx => {
    const store=tx.objectStore('batches');const old=await read(store.get(id)) as DocumentBatch|undefined;
    if(!old||old.scopeId!==scopeId||old.deletedAt||(revision!==undefined&&old.revision!==revision))throw new BatchConflictError();
    const items=await read(tx.objectStore('items').getAll()) as BatchWorkItem[];
    if(items.some(i=>i.batchId===id&&i.scopeId===scopeId&&['submitting','polling','uncertain'].includes(i.state)))throw new Error('批次仍有在途或结果待确认任务，请保留批次用于查询');
    // The tombstone fences late writers; completed history no longer needs its input blobs.
    for(const item of items)if(item.batchId===id&&item.scopeId===scopeId)tx.objectStore('items').delete(item.id);
    for(const run of await read(tx.objectStore('runs').getAll()) as BatchRun[])if(run.batchId===id&&run.scopeId===scopeId)tx.objectStore('runs').delete(run.id);
    store.put({...old,deletedAt:Date.now(),epoch:(old.epoch||0)+1,revision:(old.revision||0)+1,rows:[],imports:[],unassigned:[]});
    tx.objectStore('controls').put({id,scopeId,active:false});
});
export const listBatchItems = (batchId:string,scopeId:string) => transaction(['items'],'readonly',async tx => (await read(tx.objectStore('items').getAll()) as BatchWorkItem[]).filter(i=>i.batchId===batchId&&i.scopeId===scopeId));
export const listBatchRuns = (batchId:string,scopeId:string) => transaction(['runs'],'readonly',async tx => (await read(tx.objectStore('runs').getAll()) as BatchRun[]).filter(r=>r.batchId===batchId&&r.scopeId===scopeId).sort((a,b)=>b.createdAt-a.createdAt));
export const planBatch = (batch:DocumentBatch,snapshots:Array<{snapshot:BatchSnapshot;count:number}>,commandId:string) => transaction(['batches','items','runs','controls'],'readwrite',async tx=>{
    const current=await read(tx.objectStore('batches').get(batch.id)) as DocumentBatch|undefined;
    if(!current||current.deletedAt||current.scopeId!==batch.scopeId||current.revision!==batch.revision)throw new BatchConflictError();
    const runs=await read(tx.objectStore('runs').getAll()) as BatchRun[];
    const existing=runs.find(r=>r.scopeId===batch.scopeId&&r.batchId===batch.id&&r.commandId===commandId);if(existing)return existing;
    const all=await read(tx.objectStore('items').getAll()) as BatchWorkItem[];
    const active=new Set(all.filter(i=>i.batchId===batch.id&&i.scopeId===batch.scopeId&&!['succeeded','failed','cancelled'].includes(i.state)).map(i=>i.snapshot.rowId));
    if(snapshots.some(s=>active.has(s.snapshot.rowId)))throw new Error('选中行已有未完成计划，不能重复提交');
    const count=snapshots.reduce((n,s)=>n+s.count,0);if(!count||count>1000||snapshots.some(s=>!Number.isInteger(s.count)||s.count<1))throw new Error('每轮最多 1000 个工作项，数量必须为正整数');
    const run:BatchRun={id:nanoid(),commandId,batchId:batch.id,scopeId:batch.scopeId,createdAt:Date.now(),itemIds:[]};
    for(const {snapshot,count} of snapshots)for(let slot=0;slot<count;slot++){
        const item:BatchWorkItem={id:nanoid(),taskId:`document-${nanoid()}`,attemptId:nanoid(),runId:run.id,batchId:batch.id,scopeId:batch.scopeId,epoch:current.epoch||0,snapshot,slot,state:'queued',results:[],updatedAt:Date.now()};
        tx.objectStore('items').add(item);run.itemIds.push(item.id);
    }
    tx.objectStore('runs').add(run);
    const control = await read(tx.objectStore('controls').get(batch.id));
    if (!control?.active) tx.objectStore('controls').put({id:batch.id,scopeId:batch.scopeId,active:false});
    return run;
});
export const setBatchActive = (batchId:string,scopeId:string,active:boolean,owner?:string) => transaction(['batches','controls'],'readwrite',async tx=>{
    const b=await read(tx.objectStore('batches').get(batchId)) as DocumentBatch|undefined;if(!b||b.deletedAt||b.scopeId!==scopeId)throw new BatchConflictError();
    const current=await read(tx.objectStore('controls').get(batchId));
    if(active && current?.active && current.owner && current.owner!==owner)throw new BatchConflictError();
    if(!active&&owner&&current?.owner!==owner)return;
    tx.objectStore('controls').put({id:batchId,scopeId,active,owner});
});
/** The ticket is never released or recreated. A lost response is not permission to POST again. */
export const claimBatchTicket = (item:BatchWorkItem,owner:string,scopeGuard:()=>boolean,externalActive=0) => transaction(['batches','items','controls'],'readwrite',async tx=>{
    const b=await read(tx.objectStore('batches').get(item.batchId)) as DocumentBatch|undefined;
    const control=await read(tx.objectStore('controls').get(item.batchId));
    const current=await read(tx.objectStore('items').get(item.id)) as BatchWorkItem|undefined;
    if(!scopeGuard()||!b||b.deletedAt||b.scopeId!==item.scopeId||(b.epoch||0)!==item.epoch||!control?.active||control.owner!==owner||!current||current.ticket||current.state!=='queued'||current.attemptId!==item.attemptId)return false;
    const all=await read(tx.objectStore('items').getAll()) as BatchWorkItem[];
    const busy=all.filter(i=>i.scopeId===item.scopeId&&i.snapshot.profileId===item.snapshot.profileId&&['submitting','polling','uncertain'].includes(i.state)).length;
    if(!scopeGuard()||busy+externalActive>=Math.max(1,Math.min(8,b.concurrency||3)))return false;
    const ticket=nanoid();tx.objectStore('items').put({...current,state:'submitting',ticket,startedAt:Date.now(),updatedAt:Date.now()});return ticket;
});
export const projectBatchItem = (item:BatchWorkItem,patch:Partial<Pick<BatchWorkItem,'state'|'results'|'error'>>) => transaction(['batches','items'],'readwrite',async tx=>{
    const b=await read(tx.objectStore('batches').get(item.batchId)) as DocumentBatch|undefined;const old=await read(tx.objectStore('items').get(item.id)) as BatchWorkItem|undefined;
    if(!b||b.deletedAt||b.scopeId!==item.scopeId||(b.epoch||0)!==item.epoch||!old||old.attemptId!==item.attemptId)return;
    if(['succeeded','failed','cancelled'].includes(old.state)&&patch.state!==old.state)return;
    const results=patch.results?.map(result=>({...result,hidden:old.results.find(r=>r.id===result.id)?.hidden||result.hidden}));
    tx.objectStore('items').put({...old,...patch,...(results?{results}:{}),updatedAt:Date.now()});
});
export const cancelQueuedItems = (batchId:string,scopeId:string) => transaction(['items'],'readwrite',async tx=>{const store=tx.objectStore('items');for(const i of await read(store.getAll()) as BatchWorkItem[])if(i.batchId===batchId&&i.scopeId===scopeId&&i.state==='queued')store.put({...i,state:'cancelled',updatedAt:Date.now()});});

export const hideBatchResult = (batchId:string,scopeId:string,itemId:string,resultId:string) => transaction(['items'],'readwrite',async tx=>{
    const store=tx.objectStore('items');const item=await read(store.get(itemId)) as BatchWorkItem|undefined;
    if(!item||item.batchId!==batchId||item.scopeId!==scopeId)throw new BatchConflictError();
    store.put({...item,results:item.results.map(r=>r.id===resultId?{...r,hidden:true}:r)});
});
/** Retry only explicitly failed slots, preserving the input that actually failed. */
export const retryFailedBatchItems = (batchId:string,scopeId:string,itemIds:string[],commandId:string) => transaction(['batches','items','runs'],'readwrite',async tx=>{
    const batch=await read(tx.objectStore('batches').get(batchId)) as DocumentBatch|undefined;
    if(!batch||batch.deletedAt||batch.scopeId!==scopeId)throw new BatchConflictError();
    const runs=await read(tx.objectStore('runs').getAll()) as BatchRun[];
    const previous=runs.find(r=>r.batchId===batchId&&r.scopeId===scopeId&&r.commandId===commandId);if(previous)return previous;
    const store=tx.objectStore('items');const all=await read(store.getAll()) as BatchWorkItem[];
    const selected=all.filter(i=>i.batchId===batchId&&i.scopeId===scopeId&&itemIds.includes(i.id));
    if(!selected.length||selected.length!==new Set(itemIds).size||selected.some(i=>i.state!=='failed'))throw new Error('只能重试明确失败的工作项，不确定任务不能重发');
    if(all.some(i=>i.batchId===batchId&&i.scopeId===scopeId&&!['succeeded','failed','cancelled'].includes(i.state)&&selected.some(s=>s.snapshot.rowId===i.snapshot.rowId)))throw new Error('该行仍有未完成计划，请先等待对账');
    const run:BatchRun={id:nanoid(),commandId,batchId,scopeId,createdAt:Date.now(),itemIds:[]};
    for(const original of selected){const item:BatchWorkItem={...original,id:nanoid(),taskId:`document-${nanoid()}`,attemptId:nanoid(),runId:run.id,epoch:batch.epoch||0,state:'queued',ticket:undefined,startedAt:undefined,error:undefined,results:[],updatedAt:Date.now()};store.add(item);run.itemIds.push(item.id);}
    tx.objectStore('runs').add(run);return run;
});
