import { strToU8, Zip, ZipPassThrough } from 'fflate';
import type { BatchReference, BatchWorkItem, DocumentBatch } from '@/types/document-batch';
import { imageReference, validateImageLink } from './document-xlsx-import';
const MAX_IMAGE=25*1024*1024;
export const BATCH_IMAGE_DOWNLOAD_TIMEOUT_MS = 60_000;
export async function loadBatchReference(reference:BatchReference,signal?:AbortSignal):Promise<BatchReference>{
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('图片下载超过 60 秒，已跳过')), BATCH_IMAGE_DOWNLOAD_TIMEOUT_MS);
    try { return await readBatchReference(reference, controller.signal); }
    catch (error) { controller.signal.throwIfAborted(); throw error; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
async function readBatchReference(reference:BatchReference,signal:AbortSignal):Promise<BatchReference>{
    if(reference.blob){
        signal?.throwIfAborted();
        if(reference.blob.size>MAX_IMAGE)throw new Error('图片超过 25 MiB');
        const verified=imageReference(new Uint8Array(await reference.blob.arrayBuffer()),reference.name,reference.source);
        return {...reference,blob:verified.blob,mimeType:verified.mimeType};
    }
    const url=validateImageLink(reference.url);
    const response=await fetch(url,{signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
    if(!response.ok)throw new Error(`图片下载失败（${response.status}）`);
    if(Number(response.headers.get('content-length'))>MAX_IMAGE)throw new Error('图片超过 25 MiB');
    if(!response.body)throw new Error('图片响应为空');
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){signal?.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_IMAGE)throw new Error('图片超过 25 MiB');chunks.push(value);}}
    finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    const verified=imageReference(bytes,reference.name,reference.source);return {...reference,blob:verified.blob,mimeType:verified.mimeType};
}
export function blobDataUrl(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('图片读取失败'));r.readAsDataURL(blob);});}
export async function loadResult(url:string,name:string,source:string,signal?:AbortSignal){
    const {unifiedCacheService}=await import('../../../../services/unified-cache-service');
    const cached=await unifiedCacheService.getCachedBlob(url,{allowNetwork:false}).catch(()=>null);
    if(cached)return loadBatchReference({id:name,name,source,url,blob:cached},signal);
    // Blob/data URLs originate from completed tasks, never from imported documents.
    if(url.startsWith('blob:')||/^data:image\/(png|jpeg|webp|gif);base64,/i.test(url)){
        if(url.length>MAX_IMAGE*1.4)throw new Error('图片超过 25 MiB');
        const blob=await (await fetch(url,{signal})).blob();
        return loadBatchReference({id:name,name,source,url,blob},signal);
    }
    return loadBatchReference({id:name,name,source,url},signal);
}
const safeName=(s:string)=>Array.from(s, c => c.charCodeAt(0)<32 ? '_' : c).join('').replace(/[\\/:*?"<>|]/g,'_').replace(/^\.+/,'').slice(0,80)||'batch';
function saveBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function exportBatchResults(batch:DocumentBatch,items:BatchWorkItem[],resultIds:string[],signal?:AbortSignal):Promise<{saved:number;failed:Array<{id:string;message:string}>}>{
    const selected=new Set(resultIds),failed:Array<{id:string;message:string}>=[];let bytes=0,count=0,part=1,saved=0;let manifest:Array<Record<string,unknown>>=[];
    // Emit each file immediately into Blob parts instead of retaining all source ArrayBuffers.
    let parts: Blob[] = [];
    const createZip = () => new Zip((error, data) => { if (error) throw error; parts.push(new Blob([new Uint8Array(data)])); });
    let zip = createZip();
    const addFile = (name: string, data: Uint8Array) => { const file = new ZipPassThrough(name); zip.add(file); file.push(data, true); };
    const flush=async()=>{if(!count)return;signal?.throwIfAborted();addFile('manifest.json',strToU8(JSON.stringify({batchId:batch.id,results:manifest,failures:failed},null,2)));zip.end();const blob=new Blob(parts,{type:'application/zip'});parts=[];signal?.throwIfAborted();saveBlob(blob,`${safeName(batch.title)}-${part++}.zip`);saved+=count;zip=createZip();bytes=0;count=0;manifest=[];};
    for(const item of items){if(item.scopeId!==batch.scopeId||item.batchId!==batch.id)continue;for(const result of item.results){if(!selected.has(result.id)||result.hidden)continue;signal?.throwIfAborted();try{
        const ref=await loadResult(result.url,result.id,item.snapshot.source,signal);const blob=ref.blob!;
        if(count&&(count>=100||bytes+blob.size>200*1024*1024))await flush();
        const extension=ref.mimeType==='image/jpeg'?'jpg':ref.mimeType?.split('/')[1]||'png';
        const file=`${safeName(item.snapshot.title)}_${item.snapshot.rowId}/${item.runId}_${item.slot+1}_${result.id}.${extension}`;
        addFile(file,new Uint8Array(await blob.arrayBuffer()));manifest.push({rowId:item.snapshot.rowId,source:item.snapshot.source,runId:item.runId,resultId:result.id,file});bytes+=blob.size;count++;
    }catch(error){signal?.throwIfAborted();failed.push({id:result.id,message:error instanceof Error?error.message:'下载失败'});}}}
    await flush();if(failed.length)saveBlob(new Blob([JSON.stringify({batchId:batch.id,failed},null,2)],{type:'application/json'}),`${safeName(batch.title)}-下载失败.json`);return {saved,failed};
}
