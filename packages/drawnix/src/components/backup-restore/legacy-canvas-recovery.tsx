import { useRef, useState } from 'react';
import {
  readLegacyCanvasData,
  exportLegacyCanvasData,
  importLegacyCanvasData,
  loadLegacyCanvasArchive,
  getLegacyProjects,
  type LegacyCanvasSnapshot,
} from '../../services/backup-restore/legacy-canvas-data';
import { saveAs } from 'file-saver';

export function LegacyCanvasRecovery({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<LegacyCanvasSnapshot | null>(null);
  const [report, setReport] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const action = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      await work();
    } catch (error) {
      setReport([error instanceof Error ? error.message : '旧数据操作失败']);
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };
  const inspect = (next: LegacyCanvasSnapshot) => {
    setSnapshot(next);
    const projects = getLegacyProjects(next);
    setReport([
      `已读取 ${projects.length} 个旧项目、${next.manifest.records.length} 条记录、${next.files.size} 个媒体文件。`,
      ...next.manifest.warnings,
    ]);
  };
  return (
    <section
      className="backup-restore-dialog__section"
      aria-label="旧工作流数据恢复"
    >
      <h3>旧工作流数据</h3>
      <p>
        独立工作流模式已移除。可读取同一浏览器的旧数据或打开此前导出的备份。请先导出备份，再导入可转换内容。
      </p>
      <p>
        导入创建新画布；图片、文本、视频和音频优先转换，配置节点与插件不再执行。缺失的远程媒体不自动下载，历史任务不自动重新生成。源数据不会删除。
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void action(async () => inspect(await readLegacyCanvasData()))
          }
        >
          读取旧数据
        </button>
        <label>
          打开旧数据备份
          <input
            type="file"
            accept=".zip"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file)
                void action(async () =>
                  inspect(await loadLegacyCanvasArchive(file))
                );
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy || !snapshot}
          onClick={() =>
            void action(async () => {
              if (snapshot)
                saveAs(
                  await exportLegacyCanvasData(snapshot),
                  'opentu-legacy-canvas.zip'
                );
            })
          }
        >
          导出去凭据备份
        </button>
        <button
          type="button"
          disabled={busy || !snapshot}
          onClick={() =>
            void action(async () => {
              if (snapshot) setReport(await importLegacyCanvasData(snapshot));
            })
          }
        >
          将可转换内容导入主画布
        </button>
      </div>
      {busy && <p role="status">正在处理，请保留此窗口…</p>}
      {report.length > 0 && (
        <>
          <pre
            role="status"
            style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}
          >
            {report.join('\n')}
          </pre>
          <button
            type="button"
            onClick={() =>
              saveAs(
                new Blob([report.join('\n')], {
                  type: 'text/plain;charset=utf-8',
                }),
                'legacy-import-report.txt'
              )
            }
          >
            下载报告
          </button>
        </>
      )}
    </section>
  );
}
