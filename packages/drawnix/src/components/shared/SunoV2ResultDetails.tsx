import React from 'react';
import type { SunoV2Result } from '../../services/suno-v2';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Structured Suno outputs are useful even when there is no playable audio. */
export const SunoV2ResultDetails: React.FC<{ result: SunoV2Result; showResources?: boolean }> = ({ result, showResources = true }) => {
  const data = object(result.data);
  const alignment = Array.isArray(data.alignment) ? data.alignment.map(object) : [];
  const instruments = Array.isArray(data.instruments) ? data.instruments : [];
  const resourceLabels = { music_id: '曲目', persona_id: '音色', model_id: '自建模型', file_id: '文件' };
  return <section aria-label="Suno 结果" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    {showResources && result.resources.map((resource) => <p key={`${resource.kind}:${resource.id}`}>
      {resourceLabels[resource.kind]}：{resource.title || resource.id}
    </p>)}
    {typeof data.upsampled_tags === 'string' && <div>
      <strong>扩写后的风格</strong><pre style={{ whiteSpace: 'pre-wrap' }}>{data.upsampled_tags}</pre>
    </div>}
    {alignment.length > 0 && <div style={{ overflow: 'auto', maxHeight: 280 }}>
      <table><caption>歌词时间轴</caption><thead><tr><th scope="col">起点（秒）</th><th scope="col">终点（秒）</th><th scope="col">歌词</th></tr></thead>
        <tbody>{alignment.map((row, index) => <tr key={index}>
          <td>{typeof row.start_s === 'number' ? row.start_s : '—'}</td>
          <td>{typeof row.end_s === 'number' ? row.end_s : '—'}</td>
          <td>{typeof row.word === 'string' ? row.word : ''}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {Array.isArray(data.waveform_data) && <p>波形数据：{data.waveform_data.length} 个采样点</p>}
    {instruments.length > 0 && <div><strong>MIDI 乐器轨</strong><ul>{instruments.map((instrument, index) => {
      const item = object(instrument);
      return <li key={index}>{typeof instrument === 'string' ? instrument : String(item.name || item.instrument || `音轨 ${index + 1}`)}</li>;
    })}</ul></div>}
    {result.files.map((file, index) => <p key={`${file.fileUrl}:${index}`}>
      <a href={file.fileUrl} target="_blank" rel="noreferrer" download>{file.format?.toUpperCase() || '文件'} 下载</a>
    </p>)}
    {['aligned-lyrics', 'gen-midi', 'upsample-tags'].includes(result.action) && <details>
      <summary>查看完整结果</summary>
      <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>{JSON.stringify(result.data, null, 2)}</pre>
    </details>}
  </section>;
};
