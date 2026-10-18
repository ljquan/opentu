import React, { useEffect, useRef, useState } from 'react';

/** Task drafts use serializable data URLs; multipart is created only at submission. */
export const SunoFileInput: React.FC<{ label: string; value?: string; onChange: (value: string) => void }> = ({ label, value, onChange }) => {
  const [error, setError] = useState('');
  const activeReader = useRef<FileReader | null>(null);
  useEffect(() => () => { activeReader.current?.abort(); }, []);
  return <div>
    <input type="file" aria-label={label} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => {
      activeReader.current?.abort();
      activeReader.current = null;
      const file = event.target.files?.[0];
      setError('');
      onChange('');
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { setError('本地任务上传限 20 MB，请使用 URL 上传较大的文件'); return; }
      const reader = new FileReader();
      activeReader.current = reader;
      reader.onload = () => { if (activeReader.current === reader) onChange(String(reader.result)); };
      reader.onerror = () => { if (activeReader.current === reader) setError('文件读取失败'); };
      reader.readAsDataURL(file);
    }} />
    {value && <small>文件已载入 · 本地上传限 20 MB</small>}
    {error && <p role="alert">{error}</p>}
  </div>;
};
