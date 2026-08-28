import { describe, expect, it } from 'vitest';
import {
  buildPptExplainerNarrationPlan,
  narrationPlannerInternals,
} from './narration-planner';

const slides = [
  { pageIndex: 1, title: '第一页', snapshotUrl: '/1.png', turns: [] },
  { pageIndex: 2, title: '第二页', snapshotUrl: '/2.png', turns: [] },
];
const speakers = [
  { id: 'a', displayName: 'A', voiceId: 'voice-a' },
  { id: 'b', displayName: 'B', voiceId: 'voice-b' },
];

describe('PPT explainer narration response', () => {
  it('includes the slide duration, narration direction and target text length', () => {
    const messages = narrationPlannerInternals.buildNarrationMessages(
      [
        {
          pageIndex: 1,
          title: '第一页',
          notes: '解释核心结论',
          turns: [],
        },
      ],
      speakers,
      'single_voice',
      {
        secondsPerSlide: 30,
        narrationInstruction: '重点解释图表，并自然收尾',
      }
    );
    const systemText = messages[0].content[0].text;
    const payload = JSON.parse(messages[1].content[0].text);

    expect(systemText).toContain('每页目标讲解时长为 30 秒');
    expect(systemText).toContain('每页正文目标约 120 个字符');
    expect(systemText).toContain('适合字幕逐句切换的自然短句');
    expect(payload).toMatchObject({
      secondsPerSlide: 30,
      targetNarrationCharacters: 120,
      narrationInstruction: '重点解释图表，并自然收尾',
    });
  });

  it('limits dual-speaker alternation to avoid excessive video requests', () => {
    const messages = narrationPlannerInternals.buildNarrationMessages(
      [{ pageIndex: 1, title: '第一页', notes: '解释核心结论', turns: [] }],
      speakers,
      'dual_voice',
      { secondsPerSlide: 10 }
    );
    const systemText = messages[0].content[0].text;

    expect(systemText).toContain('优先只安排一轮');
    expect(systemText).toContain('内容较长时最多两轮');
    expect(systemText).toContain('不要逐句来回切换');
  });

  it('regenerates notes that cannot cover the requested duration', () => {
    expect(
      narrationPlannerInternals.canReuseSingleSpeakerNotes('简短备注', {
        secondsPerSlide: 30,
      })
    ).toBe(false);
    expect(
      narrationPlannerInternals.canReuseSingleSpeakerNotes('讲'.repeat(120), {
        secondsPerSlide: 30,
      })
    ).toBe(true);
    expect(
      narrationPlannerInternals.canReuseSingleSpeakerNotes('讲'.repeat(120), {
        secondsPerSlide: 30,
        narrationInstruction: '加入案例',
      })
    ).toBe(false);
  });

  it('reuses duration-sized notes with the requested timing estimate', async () => {
    const notes = '讲'.repeat(40);
    const result = await buildPptExplainerNarrationPlan(
      [{ pageIndex: 1, title: '第一页', notes, turns: [] }],
      {
        presenterMode: 'single_voice',
        speakers: [speakers[0]],
        textRoute: 'text-model',
        secondsPerSlide: 10,
      }
    );

    expect(result[0].turns).toEqual([
      {
        speakerId: 'a',
        text: notes,
        estimatedDurationSeconds: 10,
      },
    ]);
  });

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
