import type {
  SelectedContentItem,
  WorkflowMessageData,
} from '../../types/chat.types';

export interface WorkflowMediaResult {
  type: 'image' | 'video' | 'audio';
  url: string;
  thumbnailUrl?: string;
  title?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMediaUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('data:') ||
      value.startsWith('blob:') ||
      value.startsWith('/'))
  );
}

function inferMediaType(
  url: string,
  stepType: WorkflowMessageData['generationType']
): WorkflowMediaResult['type'] {
  if (url.startsWith('data:video/') || /\.(mp4|webm|mov)(\?|#|$)/i.test(url)) {
    return 'video';
  }
  if (
    url.startsWith('data:audio/') ||
    /\.(mp3|wav|ogg|m4a)(\?|#|$)/i.test(url)
  ) {
    return 'audio';
  }
  if (stepType === 'video' || stepType === 'audio') {
    return stepType;
  }
  return 'image';
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isMediaUrl) : [];
}

function addMediaFromRecord(
  record: Record<string, unknown>,
  stepType: WorkflowMessageData['generationType'],
  media: WorkflowMediaResult[],
  seen: Set<string>
): void {
  const urls = [
    ...getStringArray(record.urls),
    ...getStringArray(record.imageUrls),
    ...getStringArray(record.videoUrls),
    ...getStringArray(record.audioUrls),
  ];

  if (isMediaUrl(record.url)) {
    urls.unshift(record.url);
  }
  if (isMediaUrl(record.imageUrl)) {
    urls.unshift(record.imageUrl);
  }
  if (isMediaUrl(record.videoUrl)) {
    urls.unshift(record.videoUrl);
  }
  if (isMediaUrl(record.audioUrl)) {
    urls.unshift(record.audioUrl);
  }

  const thumbnailUrls = [
    ...getStringArray(record.thumbnailUrls),
    ...getStringArray(record.previewImageUrls),
  ];
  if (isMediaUrl(record.thumbnailUrl)) {
    thumbnailUrls.unshift(record.thumbnailUrl);
  }
  if (isMediaUrl(record.previewImageUrl)) {
    thumbnailUrls.unshift(record.previewImageUrl);
  }

  urls.forEach((url, index) => {
    if (seen.has(url)) {
      return;
    }
    seen.add(url);
    media.push({
      type: inferMediaType(url, stepType),
      url,
      thumbnailUrl: thumbnailUrls[index] || thumbnailUrls[0],
      title: typeof record.title === 'string' ? record.title : undefined,
    });
  });
}

export function collectWorkflowMediaResults(
  workflow: WorkflowMessageData,
  steps: WorkflowMessageData['steps'] = workflow.steps
): WorkflowMediaResult[] {
  const media: WorkflowMediaResult[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown, depth = 0): void => {
    if (depth > 4) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }

    if (!isRecord(value)) {
      if (isMediaUrl(value) && !seen.has(value)) {
        seen.add(value);
        media.push({
          type: inferMediaType(value, workflow.generationType),
          url: value,
        });
      }
      return;
    }

    addMediaFromRecord(value, workflow.generationType, media, seen);

    ['data', 'result', 'response', 'output'].forEach((key) => {
      const nested = value[key];
      if (Array.isArray(nested)) {
        nested.forEach((item) => visit(item, depth + 1));
      } else {
        visit(nested, depth + 1);
      }
    });
  };

  steps.forEach((step) => {
    if (step.status === 'completed') {
      visit(step.result);
    }
  });

  return media;
}

export function getLatestWorkflowImageReferences(
  workflows: Iterable<WorkflowMessageData>
): SelectedContentItem[] {
  const orderedWorkflows = Array.from(workflows);

  for (let index = orderedWorkflows.length - 1; index >= 0; index -= 1) {
    const workflow = orderedWorkflows[index];
    const mediaResults = collectWorkflowMediaResults(workflow).filter(
      (item) => item.type === 'image'
    );

    if (mediaResults.length === 0) {
      continue;
    }

    return mediaResults.map((item, mediaIndex) => ({
      type: 'image',
      url: item.url,
      name: item.title || `上一次生成结果 ${mediaIndex + 1}`,
    }));
  }

  return [];
}

export function shouldUseImplicitWorkflowReferences(prompt: string): boolean {
  const normalizedPrompt = prompt.trim().toLowerCase();
  if (!normalizedPrompt) {
    return false;
  }

  return /上面|前面|刚才|上一|之前|这些|那些|这张|这几张|那张|原图|参考|基于|沿用|继续|修改|改成|换成|替换|变成|保持|previous|above|these|those|same|reference|continue|edit|modify|change|replace|turn.*into/i.test(
    normalizedPrompt
  );
}
