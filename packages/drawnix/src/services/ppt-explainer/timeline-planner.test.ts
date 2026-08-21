import { describe, expect, it } from 'vitest';
import {
  planPptExplainerSlideTimeline,
  pptExplainerTimelineInternals,
} from './timeline-planner';

const speakers = [{ id: 'host', displayName: '主讲人' }];

describe('PPT explainer slide timeline', () => {
  it('splits a 30 second slide into supported 10 second segments', () => {
    const timeline = planPptExplainerSlideTimeline({
      turns: [
        {
          speakerId: 'host',
          text: '第一句介绍主题。第二句解释背景。第三句给出结论。第四句说明行动建议。第五句总结重点。第六句自然收尾。',
        },
      ],
      speakers,
      secondsPerSlide: 30,
      durationOptions: [
        { label: '5秒', value: '5' },
        { label: '10秒', value: '10' },
      ],
    });

    expect(timeline.map((segment) => segment.requestDurationSeconds)).toEqual([
      10, 10, 10,
    ]);
    expect(timeline.map((segment) => segment.outputDurationSeconds)).toEqual([
      10, 10, 10,
    ]);
    expect(timeline.every((segment) => segment.turns.length > 0)).toBe(true);
  });

  it('caps an unsupported 7 second target from a 10 second source segment', () => {
    const timeline = planPptExplainerSlideTimeline({
      turns: [{ speakerId: 'host', text: '先说明主题，再给出重点结论。' }],
      speakers,
      secondsPerSlide: 7,
      durationOptions: [
        { label: '5秒', value: '5' },
        { label: '10秒', value: '10' },
      ],
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      requestDurationSeconds: 10,
      outputDurationSeconds: 7,
    });
  });

  it('only trims the final segment when the target is not divisible', () => {
    const timeline = planPptExplainerSlideTimeline({
      turns: [
        {
          speakerId: 'host',
          text: '第一段完整讲解。第二段继续分析。第三段补充结论。第四段给出建议。第五段自然收尾。',
        },
      ],
      speakers,
      secondsPerSlide: 25,
      durationOptions: [
        { label: '5秒', value: '5' },
        { label: '10秒', value: '10' },
      ],
    });

    expect(timeline.map((segment) => segment.outputDurationSeconds)).toEqual([
      10, 10, 5,
    ]);
  });

  it('keeps subtitle cues short and sentence-aligned', () => {
    const cues = pptExplainerTimelineInternals.splitTextAtNaturalBreaks(
      `这是一个超过三十个字符的长句，需要被安全拆开以免整页字幕遮挡画面。${'补'.repeat(
        40
      )}`
    );

    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((cue) => cue.length <= 30)).toBe(true);
  });

  it('allocates subtitle time by text weight', () => {
    const cues = pptExplainerTimelineInternals.buildSubtitleCues(
      [
        { speakerId: 'host', text: '短句' },
        { speakerId: 'host', text: '这是明显更长的一句讲解' },
      ],
      10,
      new Map([['host', '主讲人']])
    );

    expect(cues[0].startSeconds).toBe(0);
    expect(cues[0].endSeconds).toBeLessThan(5);
    expect(cues[1].endSeconds).toBe(10);
  });
});
