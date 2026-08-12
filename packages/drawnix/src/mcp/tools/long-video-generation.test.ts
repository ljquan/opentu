import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateLongVideoBatchId } from './long-video-generation';

const mocks = vi.hoisted(() => ({
  generateTaskId: vi.fn(),
}));

vi.mock('../../utils/task-utils', () => ({
  generateTaskId: mocks.generateTaskId,
}));

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    createTask: vi.fn(),
  },
}));

vi.mock('../../utils/settings-manager', () => ({
  geminiSettings: {
    get: vi.fn(() => ({})),
  },
}));

vi.mock('../../utils/gemini-api', () => ({
  defaultGeminiClient: {
    sendChat: vi.fn(),
  },
}));

describe('generateLongVideoBatchId', () => {
  beforeEach(() => {
    mocks.generateTaskId.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps batch IDs unique for submissions created in the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_723_456_789_012);
    mocks.generateTaskId
      .mockReturnValueOnce('8ac10324-cedf-41fa-8229-c9df2f867f49')
      .mockReturnValueOnce('342f9654-a503-4406-a179-064585882c5c');

    const firstBatchId = generateLongVideoBatchId();
    const secondBatchId = generateLongVideoBatchId();

    expect(firstBatchId).toBe(
      'long_video_1723456789012_8ac10324-cedf-41fa-8229-c9df2f867f49'
    );
    expect(secondBatchId).toBe(
      'long_video_1723456789012_342f9654-a503-4406-a179-064585882c5c'
    );
    expect(secondBatchId).not.toBe(firstBatchId);
  });
});
