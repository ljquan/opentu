import { App, Button, Drawer, Input, List, Space, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { createModelChannel, type ModelChannel } from '@/stores/use-config-store';
import { fetchTuziModels } from '@/services/tuzi-model-discovery';

export function TuziChannelEditor({channel,onSave,onClose}:{channel:ModelChannel|null;onSave:(value:ModelChannel)=>void;onClose:()=>void}) {
    const [draft,setDraft]=useState<ModelChannel|null>(channel);
    const [loading,setLoading]=useState(false);
    const [query,setQuery]=useState('');
    const request=useRef<AbortController>();
    const {message}=App.useApp();
    useEffect(()=>{setDraft(channel);setLoading(false);setQuery('');return()=>request.current?.abort();},[channel]);
    if(!draft)return null;
    const credentials=draft.credentials||[];
    const updateKey=(id:string,patch:Partial<(typeof credentials)[number]>)=>setDraft({...draft,credentials:credentials.map(c=>c.id===id?{...c,...patch}:c)});
    const acquire=async(mode:'hot'|'all')=>{
        if(loading)return;
        const controller=new AbortController();request.current=controller;setLoading(true);
        try {
            const models=await fetchTuziModels(mode,controller.signal);
            if(controller.signal.aborted)return;
            setDraft(current=>current?{...current,models:models.map(m=>current.models.find(old=>old.name===m.name)||m)}:current);
            message.success(`已获取 ${models.length} 个模型，保存后生效`);
        } catch (error) {if(!controller.signal.aborted)message.error(`${error instanceof Error ? error.message : '模型获取失败'}；原列表已保留`);}
        finally {if(!controller.signal.aborted)setLoading(false);}
    };
    return <Drawer open title="Tuzi 固定渠道" size={680} onClose={onClose} extra={<Space><Button onClick={onClose}>取消</Button><Button type="primary" disabled={loading} onClick={()=>{
        if(credentials.some(c=>!c.apiKey.trim())){message.error('请填写 Key 或移除空项');return;}
        if(credentials.length && !credentials.some(c=>c.id===draft.activeCredentialId)){message.error('请选择一个当前使用的 Key');return;}
        let activeCredentialId=draft.activeCredentialId;
        const revised=credentials.map(c=>{
            const previous=channel?.credentials?.find(old=>old.id===c.id);
            if(!previous || previous.apiKey===c.apiKey)return c;
            const id=nanoid();if(activeCredentialId===c.id)activeCredentialId=id;
            return {...c,id};
        });
        onSave(createModelChannel({...draft,credentials:revised,activeCredentialId}));onClose();
    }}>保存</Button></Space>}>
        <label className="block mb-4">渠道名称<Input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
        <p className="mb-4">固定接口：https://api.tu-zi.com · OpenAI 协议</p>
        <div className="mb-2 flex items-center justify-between"><strong>API Key</strong><Button onClick={()=>setDraft({...draft,credentials:[...credentials,{id:nanoid(),label:`Key ${credentials.length+1}`,apiKey:'',createdAt:Date.now()}]})}>添加 Key</Button></div>
        <p className="mb-3 text-xs text-stone-500">手动选用一个 Key，不自动轮换。修改 Key 会建立新标识；仍需查询旧任务时请保留原 Key，另行添加新 Key。</p>
        {credentials.map(c=><div key={c.id} className="mb-3 rounded border p-3 space-y-2">
            <Input aria-label="Key 备注" value={c.label} onChange={e=>updateKey(c.id,{label:e.target.value})}/>
            <Input.Password aria-label={`${c.label} API Key`} value={c.apiKey} onChange={e=>{
                updateKey(c.id,{apiKey:e.target.value.trim()});
            }}/>
            <Space><Button type={draft.activeCredentialId===c.id?'primary':'default'} disabled={!c.apiKey} onClick={()=>setDraft({...draft,activeCredentialId:c.id})}>{draft.activeCredentialId===c.id?'使用中':'使用'}</Button>
                <Button danger onClick={()=>setDraft({...draft,activeCredentialId:draft.activeCredentialId===c.id?undefined:draft.activeCredentialId,credentials:credentials.filter(x=>x.id!==c.id)})}>移除</Button></Space>
        </div>)}
        <div className="mt-6 space-y-3">
            <strong>渠道模型 <Tag>{draft.models.length}</Tag></strong>
            <p className="text-xs text-stone-500">仅点击后获取，不会自动刷新。获取全部可能返回较多模型；新列表替换当前草稿的范围，同名模型保留已有能力配置。</p>
            <Space><Button loading={loading} onClick={()=>void acquire('hot')}>获取热门 200</Button><Button disabled={loading} onClick={()=>void acquire('all')}>获取全部模型</Button></Space>
            <Input.Search aria-label="搜索渠道模型" placeholder="搜索模型" value={query} onChange={e=>setQuery(e.target.value)}/>
            <List size="small" pagination={{pageSize:20,showSizeChanger:false}} dataSource={draft.models.filter(m=>m.name.toLowerCase().includes(query.toLowerCase()))} renderItem={model=><List.Item><span>{model.name}</span><select aria-label={`${model.name} 能力`} value={model.capability} onChange={e=>setDraft({...draft,models:draft.models.map(m=>m.name===model.name?{...m,capability:e.target.value as typeof model.capability}:m)})}><option value="image">图片</option><option value="video">视频</option><option value="text">文本</option><option value="audio">音频</option></select></List.Item>}/>
        </div>
    </Drawer>;
}
