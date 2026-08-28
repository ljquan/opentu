import { describe, expect, it } from 'vitest';
import type { PptExplainerSlide, PptExplainerSpeaker } from './types';
import {
  assertPersistablePptExplainerState,
  validatePptExplainerSlides,
  validatePptExplainerSpeakers,
} from './validation';

const speakers: PptExplainerSpeaker[] = [
  { id: 'host', displayName: '主持人', voiceId: 'voice-a' },
  { id: 'guest', displayName: '嘉宾', voiceId: 'voice-b' },
];

describe('PPT explainer validation', () => {
  it('accepts long dialogue and many slides without product caps', () => {
    validatePptExplainerSpeakers('dual_voice', speakers);
    const slides: PptExplainerSlide[] = Array.from(
      { length: 21 },
      (_, index) => ({
        pageIndex: index + 1,
        snapshotUrl: `/slide-${index + 1}.png`,
        turns: [
          {
            speakerId: index % 2 ? 'guest' : 'host',
            text: '讲解内容'.repeat(500),
            estimatedDurationSeconds: 61,
          },
        ],
      })
    );
    expect(() =>
      validatePptExplainerSlides(slides, speakers, {
        requireSnapshots: true,
        requireTurns: true,
      })
    ).not.toThrow();
  });

  it('rejects unknown speakers before provider submission', () => {
    expect(() =>
      validatePptExplainerSlides(
        [
          {
            pageIndex: 1,
            snapshotUrl: '/1.png',
            turns: [{ speakerId: 'x', text: 'hi' }],
          },
        ],
        speakers,
        { requireSnapshots: true, requireTurns: true }
      )
    ).toThrow('未知 speaker');
  });

  it('rejects a missing slide snapshot before provider submission', () => {
    expect(() =>
      validatePptExplainerSlides(
        [
          {
            pageIndex: 1,
            snapshotUrl: '   ',
            turns: [{ speakerId: 'host', text: '第一页讲解' }],
          },
        ],
        speakers,
        { requireSnapshots: true, requireTurns: true }
      )
    ).toThrow('第 1 页缺少页面快照');
  });

  it('requires avatars only for avatar modes', () => {
    expect(() =>
      validatePptExplainerSpeakers('single_avatar', [speakers[0]])
    ).toThrow('数字人来源');
    expect(() =>
      validatePptExplainerSpeakers('single_voice', [speakers[0]])
    ).not.toThrow();
  });

  it('accepts reference audio and rejects mixed or duplicate voice sources', () => {
    const referenceSpeakers: PptExplainerSpeaker[] = [
      {
        id: 'host',
        displayName: '主持人',
        voiceSource: 'reference_audio',
        voiceReference: {
          cacheUrl: '/__aitu_internal__/ppt-explainer/job/host.mp3',
          assetName: 'voice-reference-01.mp3',
          filename: 'host.mp3',
          mimeType: 'audio/mpeg',
          size: 100,
          sourceAssetId: 'audio-1',
        },
      },
      {
        id: 'guest',
        displayName: '嘉宾',
        voiceSource: 'voice_id',
        voiceId: 'voice-b',
      },
    ];
    expect(() =>
      validatePptExplainerSpeakers('dual_voice', referenceSpeakers)
    ).not.toThrow();
    expect(() =>
      validatePptExplainerSpeakers('single_voice', [
        {
          ...referenceSpeakers[0],
          voiceId: 'must-not-coexist',
        },
      ])
    ).toThrow('必须且只能配置参考音频');
    expect(() =>
      validatePptExplainerSpeakers('dual_voice', [
        referenceSpeakers[0],
        {
          ...referenceSpeakers[0],
          id: 'guest',
          displayName: '嘉宾',
        },
      ])
    ).toThrow('两个不同声音');
  });

  it('rejects local-only avatar URLs before provider submission', () => {
    expect(() =>
      validatePptExplainerSpeakers('single_avatar', [
        {
          ...speakers[0],
          avatarAssetId: 'local-asset',
          avatarSourceUrl: '/__aitu_cache__/avatar.png',
        },
      ])
    ).toThrow('可公开访问');
  });

  it.each([
    'http://localhost/avatar.png',
    'http://127.0.0.1/avatar.png',
    'http://169.254.169.254/avatar.png',
    'http://192.168.1.10/avatar.png',
    'https://user:password@cdn.example.com/avatar.png',
  ])('rejects non-public avatar URL: %s', (avatarSourceUrl) => {
    expect(() =>
      validatePptExplainerSpeakers('single_avatar', [
        {
          ...speakers[0],
          avatarSourceUrl,
        },
      ])
    ).toThrow('可公开访问');
  });

  it('accepts a public avatar URL', () => {
    expect(() =>
      validatePptExplainerSpeakers('single_avatar', [
        {
          ...speakers[0],
          avatarSourceUrl: 'https://cdn.example.com/avatar.png',
        },
      ])
    ).not.toThrow();
  });

  it.each([
    'https://cdn.example.com/avatar.png?token=secret',
    'https://cdn.example.com/avatar.png?%74oken=secret',
    'https://cdn.example.com/avatar.png?X-Amz-Signature=abc',
    'https://cdn.example.com/avatar.png#signature=abc',
  ])('rejects credential-bearing avatar URLs: %s', (avatarSourceUrl) => {
    expect(() =>
      validatePptExplainerSpeakers('single_avatar', [
        {
          ...speakers[0],
          avatarSourceUrl,
        },
      ])
    ).toThrow('可公开访问');
  });

  it('rejects binary values and credentials in persisted state', () => {
    expect(() =>
      assertPersistablePptExplainerState({
        schemaVersion: 1,
        apiKey: 'secret',
      } as never)
    ).toThrow('凭据');
    expect(() =>
      assertPersistablePptExplainerState({
        schemaVersion: 1,
        file: new Blob(['x']),
      } as never)
    ).toThrow('二进制');
    expect(() =>
      assertPersistablePptExplainerState({
        schemaVersion: 1,
        extraHeaders: { 'X-Provider-Secret': 'must-not-persist' },
      } as never)
    ).toThrow('凭据');
    expect(() =>
      assertPersistablePptExplainerState({
        schemaVersion: 1,
        access_token: 'must-not-persist',
      } as never)
    ).toThrow('凭据');
    expect(() =>
      assertPersistablePptExplainerState({
        schemaVersion: 1,
        snapshotUrl: 'data:image/png;base64,AAAA',
      } as never)
    ).toThrow('base64');
    expect(() =>
      assertPersistablePptExplainerState({
        schemaVersion: 1,
        encodedSlide: 'QUFB'.repeat(256),
      } as never)
    ).toThrow('base64');
  });
});
