import { guessCapability, type ChannelModel } from '@/stores/use-config-store';

const TUZI_ORIGIN = 'https://api.tu-zi.com';

export function tuziPricingUrl(origin = window.location.origin): string {
    // The public web endpoint omits CORS headers. Reuse the host's existing
    // Tuzi proxy (Vite/Netlify/Vercel); never attach account or model keys.
    return origin === TUZI_ORIGIN ? '/api/pricing' : '/__opentu_tuzi_session__/api/pricing';
}

export function parseTuziModels(payload: unknown, mode: 'hot' | 'all'): ChannelModel[] {
    const data = payload as { success?: boolean; data?: unknown };
    if (!data?.success || !Array.isArray(data.data) || data.data.length > 10000) throw new Error('Tuzi 模型列表格式无效或超出数量限制');
    const seen = new Set<string>();
    const rows = data.data.filter((r): r is {model_name:string;hot_rank?:number;tags?:unknown} => {
        if (!r || typeof r.model_name !== 'string' || !r.model_name.trim() || seen.has(r.model_name)) return false;
        seen.add(r.model_name); return true;
    });
    const selected = mode === 'hot' ? rows.filter(r => Number.isInteger(r.hot_rank) && Number(r.hot_rank) > 0).sort((a,b) => Number(a.hot_rank)-Number(b.hot_rank)).slice(0,200) : rows;
    if (!selected.length) throw new Error(mode === 'hot' ? '未获取到有效热度排名，已保留原模型' : '未获取到模型，已保留原列表');
    return selected.map(r => {
        const tags = typeof r.tags === 'string' ? r.tags : JSON.stringify(r.tags || []);
        const capability = /视频|video/i.test(tags) ? 'video' : /生图|图片生成|image/i.test(tags) ? 'image' : /音频|语音|audio|tts/i.test(tags) ? 'audio' : guessCapability(r.model_name);
        return { name:r.model_name, capability };
    });
}

/** Public discovery never sends any of the user's saved keys. Called only from an explicit click. */
export async function fetchTuziModels(mode: 'hot'|'all', signal?: AbortSignal): Promise<ChannelModel[]> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    const timer = setTimeout(abort,20000);
    try {
        signal?.throwIfAborted();
        const response = await fetch(tuziPricingUrl(), {signal:controller.signal,credentials:'omit',redirect:'error'});
        if (!response.ok) throw new Error(`Tuzi 榜单接口返回 HTTP ${response.status}，请稍后重试`);
        if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
            throw new Error('榜单接口未返回 JSON，请检查站点的 Tuzi 同源代理配置');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('模型响应为空');
        const chunks:Uint8Array[]=[]; let size=0;
        try { for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>20*1024*1024)throw new Error('模型响应过大'); chunks.push(value); } }
        finally { await reader.cancel().catch(()=>undefined); reader.releaseLock(); }
        const bytes = new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
        let payload: unknown;
        try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
        catch { throw new Error('Tuzi 榜单响应不是有效 JSON，请稍后重试'); }
        return parseTuziModels(payload,mode);
    } catch (error) {
        signal?.throwIfAborted();
        if (controller.signal.aborted) throw new Error('获取 Tuzi 榜单超时，请稍后重试');
        if (error instanceof TypeError) throw new Error('无法连接 Tuzi 榜单，请检查网络和站点同源代理');
        throw error;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
