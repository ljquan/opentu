import React, { useState } from 'react';
import { Button } from 'tdesign-react';
import { RetryImage } from '../retry-image';
import { isVirtualMediaUrl } from '../../utils/virtual-media-url';

// Includes cache fallback and retry delays, rather than restarting for each
// request. A stalled preview must not hide the result behind a skeleton forever.
export const TASK_IMAGE_PREVIEW_TIMEOUT_MS = 45_000;

export function TaskImagePreview({
  src,
  isCached,
}: {
  src: string;
  isCached: boolean;
}) {
  const [attempt, setAttempt] = useState(0);

  return (
    <RetryImage
      key={`${src}:${isCached}:${attempt}`}
      src={src}
      alt="Generated"
      eager
      // Keep virtual thumbnail requests small. Remote results can reuse a
      // locally cached Blob even when their original signed URL has expired.
      preferCachedBlob={!isVirtualMediaUrl(src)}
      loadTimeoutMs={TASK_IMAGE_PREVIEW_TIMEOUT_MS}
      maxRetries={5}
      fallback={
        <div className="task-item__preview-placeholder">
          <span>预览暂不可用</span>
          <Button
            size="small"
            variant="text"
            onClick={(event) => {
              event.stopPropagation();
              setAttempt((value) => value + 1);
            }}
          >
            重新加载预览
          </Button>
        </div>
      }
    />
  );
}
