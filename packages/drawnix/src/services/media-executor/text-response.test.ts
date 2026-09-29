import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractCompletionText, fetchTextCompletion, safeTextError, textCompletionPath, textRequestBody } from './text-response';

afterEach(() => vi.unstubAllGlobals());

describe('Tuzi text compatibility', () => {
  it('supports root and versioned addresses without overriding custom paths', () => {
    expect(textCompletionPath('https://api.tu-zi.com')).toBe('/v1/chat/completions');
    expect(textCompletionPath('https://api.tu-zi.com', '/chat/completions')).toBe('/v1/chat/completions');
    expect(textCompletionPath('https://api.tu-zi.com/v1/')).toBe('/v1/chat/completions');
    expect(textCompletionPath('https://api.tu-zi.com', undefined, true)).toBe('/v1/responses');
    expect(textCompletionPath('https://api.tu-zi.com/v1', '/v1/chat/completions', true)).toBe('/v1/responses');
    expect(textCompletionPath('https://api.tu-zi.com', '/custom')).toBe('/custom');
    expect(textCompletionPath('https://other.test')).toBe('/chat/completions');
  });
  it('uses the local proxy only for the exact Tuzi chat endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1', origin: 'http://127.0.0.1:7200' } });
    const init = { method: 'POST', body: '{}', signal: new AbortController().signal };
    await fetchTextCompletion('https://api.tu-zi.com/v1/chat/completions', init);
    expect(fetcher).toHaveBeenLastCalledWith('/__opentu_tuzi_session__/v1/chat/completions', init);
    await fetchTextCompletion('https://api.tu-zi.com/v1/responses', init);
    expect(fetcher).toHaveBeenLastCalledWith('/__opentu_tuzi_session__/v1/responses', init);
    await fetchTextCompletion('https://other.test/v1/chat/completions', init);
    expect(fetcher).toHaveBeenLastCalledWith('https://other.test/v1/chat/completions', init);
    vi.stubGlobal('window', { location: { hostname: 'example.com', origin: 'https://example.com' } });
    await fetchTextCompletion('https://api.tu-zi.com/v1/chat/completions', init);
    expect(fetcher).toHaveBeenLastCalledWith('https://api.tu-zi.com/v1/chat/completions', init);
  });
  it('maps system, assistant and image inputs plus output parameters to Responses', () => {
    const body = textRequestBody('/v1/responses', {model:'gpt-5.6-sol',stream:false,max_tokens:1024,temperature:1,top_p:1,response_format:{type:'json_schema',json_schema:{name:'answer',strict:true,schema:{type:'object'}}},messages:[
      {role:'system',content:[{type:'text',text:'instructions'}]},
      {role:'assistant',content:[{type:'text',text:'previous answer'}]},
      {role:'user',content:[{type:'text',text:'describe'}, {type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}, {type:'image_url',image_url:{url:'https://example.test/b.png'}}]},
    ]});
    expect(body).not.toHaveProperty('messages');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).toMatchObject({max_output_tokens:1024,text:{format:{type:'json_schema',name:'answer',strict:true}},input:[
      {role:'system',content:[{type:'input_text',text:'instructions'}]},
      {role:'assistant',content:[{type:'output_text',text:'previous answer'}]},
      {role:'user',content:[{type:'input_text',text:'describe'}, {type:'input_image',image_url:'data:image/png;base64,AA=='}, {type:'input_image',image_url:'https://example.test/b.png'}]},
    ]});
    const chat = {model:'other',messages:[],stream:false};
    expect(textRequestBody('/chat/completions',chat)).toBe(chat);
  });
  it('reads Responses message output and surfaces incomplete or failed responses', () => {
    expect(extractCompletionText({status:'completed',output:[{type:'reasoning',content:[]},{type:'message',content:[{type:'output_text',text:'OK'}]}]})).toBe('OK');
    expect(extractCompletionText({output_text:'direct'})).toBe('direct');
    expect(() => extractCompletionText({status:'failed'})).toThrow('failed');
    expect(() => extractCompletionText({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]})).toThrow('token');
    expect(() => extractCompletionText({output:[{type:'message',content:[{type:'refusal',refusal:'refused'}]}]})).toThrow('refused');
  });
  it('accepts plain and structured text and rejects error or empty success bodies', () => {
    expect(extractCompletionText({ choices: [{ message: { content: '正文' } }] })).toBe('正文');
    expect(extractCompletionText({ choices: [{ message: { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] } }] })).toBe('AB');
    expect(() => extractCompletionText({ error: { message: 'model unavailable' } })).toThrow('model unavailable');
    expect(() => extractCompletionText({ choices: [{ message: { content: '' }, finish_reason: 'length' }] })).toThrow('token');
    expect(() => extractCompletionText({})).toThrow('未返回有效正文');
  });
  it('retains useful HTTP errors while removing credentials', () => {
    expect(safeTextError(new Error('HTTP 401 Bearer sk-secret; key=private-value'), ['private-value']).message)
      .toBe('HTTP 401 Bearer [redacted]; key=[redacted]');
  });
});
