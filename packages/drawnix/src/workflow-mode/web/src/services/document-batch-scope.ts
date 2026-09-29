import { getTuziBridgeContext, getTuziBridgeMode } from '../../../../services/tuzi-postmessage-bridge';
const KEY='opentu-document-workspace-id';
function localScope(){let value=localStorage.getItem(KEY);if(!value){value=crypto.randomUUID();localStorage.setItem(KEY,value);}return value;}
export function getDocumentBatchScope(): string|null {
    const context=getTuziBridgeContext();
    if(context?.userId&&context.status!=='unauthenticated')return `tuzi-user:${context.userId}`;
    if(getTuziBridgeMode()==='tuzi'||window.parent!==window)return null;
    return `standalone:${localScope()}`;
}
export const isDocumentBatchScope=(scopeId:string)=>scopeId===getDocumentBatchScope();
export const documentBatchScopeLabel=(scopeId:string)=>scopeId.startsWith('tuzi-user:')?'当前账号批次':'本地工作区批次';
export function subscribeDocumentBatchScope(listener:()=>void):()=>void {const event='opentu:tuzi-bridge-status';window.addEventListener(event,listener);window.addEventListener('storage',listener);return ()=>{window.removeEventListener(event,listener);window.removeEventListener('storage',listener);};}
