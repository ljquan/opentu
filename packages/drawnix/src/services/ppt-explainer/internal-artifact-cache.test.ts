import { Blob as NodeBlob } from 'node:buffer';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deletePptExplainerArtifact,
  deletePptExplainerArtifacts,
  getPptExplainerArtifact,
  putPptExplainerArtifact,
} from './internal-artifact-cache';

describe('PPT explainer internal artifact cache', () => {
  beforeEach(() => {
    // fake-indexeddb relies on Node's structured clone, which cannot clone
    // jsdom's Blob implementation and otherwise persists it as an empty object.
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('indexedDB', indexedDB);
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to IndexedDB and keeps job cleanup isolated', async () => {
    const firstUrl = await putPptExplainerArtifact(
      'job-a',
      'voice-reference-01.mp3',
      new Blob(['host'], { type: 'audio/mpeg' })
    );
    const secondUrl = await putPptExplainerArtifact(
      'job-a',
      'source.pptx',
      new Blob(['deck'])
    );
    const otherJobUrl = await putPptExplainerArtifact(
      'job-b',
      'voice-reference-01.wav',
      new Blob(['guest'], { type: 'audio/wav' })
    );

    await expect(getPptExplainerArtifact(firstUrl)).resolves.toMatchObject({
      size: 4,
      type: 'audio/mpeg',
    });
    await deletePptExplainerArtifact(secondUrl);
    await expect(getPptExplainerArtifact(secondUrl)).resolves.toBeNull();

    await deletePptExplainerArtifacts('job-a');
    await expect(getPptExplainerArtifact(firstUrl)).resolves.toBeNull();
    await expect(getPptExplainerArtifact(otherJobUrl)).resolves.toMatchObject({
      size: 5,
      type: 'audio/wav',
    });
    await deletePptExplainerArtifacts('job-b');
  });
});
