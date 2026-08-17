import { describe, expect, it } from 'vitest';
import { narrationPlannerInternals } from './narration-planner';

const slides = [
  { pageIndex: 1, title: '第一页', snapshotUrl: '/1.png', turns: [] },
  { pageIndex: 2, title: '第二页', snapshotUrl: '/2.png', turns: [] },
];
const speakers = [
  { id: 'a', displayName: 'A', voiceId: 'voice-a' },
  { id: 'b', displayName: 'B', voiceId: 'voice-b' },
];

describe('PPT explainer narration response', () => {
  it('parses structured page turns without truncating duration', () => {
    const parsed = narrationPlannerInternals.parseNarrationResponse(
      JSON.stringify({
        slides: [
          {
            pageIndex: 1,
            turns: [
              {
                speakerId: 'a',
                text: 'A'.repeat(2000),
                estimatedDurationSeconds: 61,
              },
            ],
          },
          { pageIndex: 2, turns: [{ speakerId: 'b', text: '继续' }] },
        ],
      }),
      slides,
      speakers
    );
    expect(parsed.get(1)?.[0].text).toHaveLength(2000);
    expect(parsed.get(1)?.[0].estimatedDurationSeconds).toBe(61);
  });

  it('rejects missing pages and unknown speakers', () => {
    expect(() =>
      narrationPlannerInternals.parseNarrationResponse(
        '{"slides":[{"pageIndex":1,"turns":[{"speakerId":"x","text":"bad"}]}]}',
        slides,
        speakers
      )
    ).toThrow();
  });
});
