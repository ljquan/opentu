import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { PlaitBoard, PlaitElement } from '@plait/core';
import { MessagePlugin } from 'tdesign-react';
import type { Task } from '../../../types/task.types';
import { taskQueueService } from '../../../services/task-queue';
import { requestAIInputPrefill } from '../../../services/ai-input-ui-events';
import {
  buildImageTaskAIInputPrefillData,
  buildSeedream55ContinuePrefillData,
} from '../../../utils/image-task-prefill';
import { getCanvasBoardBinding } from '../../../services/canvas-operations/canvas-board-ref';
import { ToolButton } from '../../tool-button';

export function SeedreamContinueButton({
  board,
  element,
}: {
  board: PlaitBoard;
  element: PlaitElement;
}) {
  const [resolved, setResolved] = useState<{ url: string; task: Task } | null>(
    null
  );
  useEffect(() => {
    let active = true;
    setResolved(null);
    if (typeof element.url !== 'string') return;
    void taskQueueService
      .findImageTaskByResultUrl(element.url)
      .then((task) => {
        if (
          active &&
          task &&
          buildImageTaskAIInputPrefillData(task).model ===
            'doubao-seedream-5-5-261028'
        ) {
          setResolved({ url: element.url, task });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [element.id, element.url]);
  if (!resolved || resolved.url !== element.url) return null;
  return (
    <ToolButton
      type="icon"
      visible
      className="continue-image"
      icon={<Pencil size={15} />}
      aria-label="继续编辑"
      tooltip="以这张结果继续编辑（Seedream 5.5）"
      onClick={() => {
        if (
          getCanvasBoardBinding()?.board !== board ||
          !board.children.some(
            (item) => item.id === element.id && item.url === element.url
          )
        ) {
          MessagePlugin.warning('画布或图片已变更，请重新选择');
          return;
        }
        const detail = buildSeedream55ContinuePrefillData(resolved.task, {
          id: element.id,
          url: element.url,
        });
        requestAIInputPrefill(detail);
        if ((detail.images?.length || 0) > 10)
          MessagePlugin.warning(
            '参考图超过 10 张，请在输入栏删除不需要的历史参考图后发送'
          );
        else MessagePlugin.info('已带入上一轮结果，请输入本轮修改要求');
      }}
    />
  );
}
