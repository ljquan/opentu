import React from 'react';
import type { NativeSunoResult } from '../../services/suno-native';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export const SunoNativeResultDetails: React.FC<{ result: NativeSunoResult }> = ({ result }) => {
  const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
  const words = Array.isArray(data.alignedWords) ? data.alignedWords.map(object) : [];
  const midi = object(data.midiData);
  const instruments = Array.isArray(midi.instruments) ? midi.instruments.map(object) : [];
  return <section aria-label="Suno 原生结果" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    {result.resources.map((resource, index) => <p key={index}>
      {resource.title && <strong>{resource.title} </strong>}
      {resource.taskId && <span>任务 ID：{resource.taskId} </span>}
      {resource.audioId && <span>曲目 ID：{resource.audioId} </span>}
      {resource.personaId && <span>Persona ID：{resource.personaId} </span>}
      {resource.voiceId && <span>音色 ID：{resource.voiceId}</span>}
    </p>)}
    {typeof data.validateInfo === 'string' && <div><strong>请朗读以下验证文案并提交录音</strong><pre style={{ whiteSpace: 'pre-wrap' }}>{data.validateInfo}</pre></div>}
    {typeof data.result === 'string' && <pre style={{ whiteSpace: 'pre-wrap' }}>{data.result}</pre>}
    {typeof data.isAvailable === 'boolean' && <p>音色状态：{data.isAvailable ? '可用' : '尚不可用'}</p>}
    {typeof result.data === 'number' && <p>上游剩余额度：{result.data}</p>}
    {words.length > 0 && <div style={{ overflow: 'auto', maxHeight: 280 }}><table>
      <caption>歌词时间轴</caption><thead><tr><th scope="col">起点（秒）</th><th scope="col">终点（秒）</th><th scope="col">歌词</th></tr></thead>
      <tbody>{words.map((word, index) => <tr key={index}><td>{String(word.startS ?? '—')}</td><td>{String(word.endS ?? '—')}</td><td>{String(word.word ?? '')}</td></tr>)}</tbody>
    </table></div>}
    {Array.isArray(data.waveformData) && <p>波形数据：{data.waveformData.length} 个采样点</p>}
    {instruments.length > 0 && <div><strong>MIDI 乐器轨</strong><ul>{instruments.map((instrument, index) => <li key={index}>
      {String(instrument.name || instrument.instrument || `音轨 ${index + 1}`)}
    </li>)}</ul></div>}
    {result.files.map((file) => <div key={file.url}>
      {file.kind === 'video' && <video controls preload="none" src={file.url} aria-label="Suno 音乐视频" style={{ maxWidth: '100%' }} />}
      {file.kind === 'audio' && <audio controls preload="none" src={file.url} aria-label={file.label} />}
      {file.kind === 'image' && <img src={file.url} alt="Suno 生成封面" loading="lazy" style={{ maxWidth: '100%' }} />}
      <a href={file.url} target="_blank" rel="noreferrer" download>{file.label} 下载</a>
    </div>)}
    {result.lyrics.map((lyrics, index) => <details key={index}><summary>{lyrics.title || `歌词 ${index + 1}`}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{lyrics.text}</pre></details>)}
    <details><summary>查看完整结果（含时间轴 / MIDI 数据）</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(result.data, null, 2)}</pre></details>
  </section>;
};
