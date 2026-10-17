import { useCallback, useEffect, useRef, useState } from 'react';
import { knowledgeBaseService } from '../services/knowledge-base-service';
import {
  createReadingPlaybackSource,
  type ReadingPlaybackSource,
} from '../services/reading-playback-source';
import type { KBNoteMeta } from '../types/knowledge-base.types';

export function useAllTracksPlaybackSources() {
  const [noteMetas, setNoteMetas] = useState<KBNoteMeta[]>([]);
  const cacheRef = useRef<Map<string, ReadingPlaybackSource>>(new Map());
  const pendingRef = useRef<Map<string, Promise<ReadingPlaybackSource | null>>>(new Map());

  const refresh = useCallback(async () => {
    const metas = await knowledgeBaseService.getAllNoteMetas();
    setNoteMetas(metas.sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadReadingSource = useCallback(
    async (noteId: string): Promise<ReadingPlaybackSource | null> => {
      const cached = cacheRef.current.get(noteId);
      if (cached) return cached;

      const pending = pendingRef.current.get(noteId);
      if (pending) return pending;

      const request = knowledgeBaseService.getNoteById(noteId)
        .then((note) => {
          if (!note || !note.content?.trim()) return null;

          const source = createReadingPlaybackSource({
            elementId: `kb-note:${note.id}`,
            title: note.title || '知识库笔记',
            content: [note.title, note.content].filter(Boolean).join('\n\n'),
            origin: { kind: 'kb-note', id: note.id },
          });
          if (source) {
            cacheRef.current.set(noteId, source);
          }
          return source;
        })
        .finally(() => {
          pendingRef.current.delete(noteId);
        });
      pendingRef.current.set(noteId, request);
      return request;
    },
    []
  );

  const buildReadingQueue = useCallback(
    async (priorityNoteId?: string): Promise<ReadingPlaybackSource[]> => {
      const sources: ReadingPlaybackSource[] = [];

      // 优先加载点击的笔记
      if (priorityNoteId) {
        const first = await loadReadingSource(priorityNoteId);
        if (first) sources.push(first);
      }

      // 并行读取其余笔记，Promise.all 仍按 noteMetas 顺序返回结果。
      const remainingSources = await Promise.all(
        noteMetas
          .filter((meta) => meta.id !== priorityNoteId)
          .map((meta) => loadReadingSource(meta.id))
      );
      remainingSources.forEach((source) => {
        if (source) sources.push(source);
      });

      return sources;
    },
    [noteMetas, loadReadingSource]
  );

  return { noteMetas, refresh, loadReadingSource, buildReadingQueue };
}
