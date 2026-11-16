import { describe, expect, it } from 'vitest';
import {
  appendGenerationReference,
  GenerationNodeData,
  remapGenerationNode,
  snapshotGenerationReferences,
  validateGenerationNode,
} from './generation-node';
const a = { id: 'a', type: 'image', url: '/a.png' };
const b = { id: 'b', type: 'image', url: '/a.png' };
const empty = (): GenerationNodeData => ({
  version: 1,
  generationType: 'image',
  prompt: 'hello',
  params: { quality: 'high' },
  count: 2,
  references: [],
});
describe('generation node draft', () => {
  it('keeps distinct sources with the same pixels, but repeated connections are idempotent', () => {
    const one = appendGenerationReference(empty(), a);
    expect(appendGenerationReference(one, a)).toBe(one);
    const two = appendGenerationReference(one, b);
    expect(two.references.map((ref) => ref.sourceElementId)).toEqual([
      'a',
      'b',
    ]);
    expect(new Set(two.references.map((ref) => ref.referenceId)).size).toBe(2);
  });
  it('remaps copied sources and detaches uncopied live ids without losing media or order', () => {
    const data = appendGenerationReference(
      appendGenerationReference(empty(), a),
      b
    );
    const copy = remapGenerationNode(data, new Map([['a', 'copy-a']]));
    expect(copy.references.map((ref) => ref.sourceElementId)).toEqual([
      'copy-a',
      undefined,
    ]);
    expect(copy.references.map((ref) => ref.url)).toEqual(['/a.png', '/a.png']);
    expect(copy.references[0].referenceId).not.toBe(
      data.references[0].referenceId
    );
    expect(copy.params).toEqual(data.params);
    expect(data.references[0].sourceElementId).toBe('a');
  });
  it('source deletion blocks new submission while an earlier snapshot stays unchanged', () => {
    const data = appendGenerationReference(empty(), a);
    const frozen = snapshotGenerationReferences(data, [a]);
    expect(validateGenerationNode(data, [])).toEqual([
      '参考图来源已删除，请移除或重新连接',
    ]);
    expect(
      snapshotGenerationReferences(data, [{ ...a, url: '/changed.png' }])[0].url
    ).toBe('/changed.png');
    expect(frozen[0].url).toBe('/a.png');
  });
  it('rejects excessive video references and requires explicit frame roles', () => {
    const data = {
      ...appendGenerationReference(appendGenerationReference(empty(), a), b),
      generationType: 'video' as const,
    };
    expect(
      validateGenerationNode(data, [a, b], { mode: 'reference', maxCount: 1 })
    ).toHaveLength(1);
    expect(
      validateGenerationNode(data, [a, b], { mode: 'frames', maxCount: 2 })
    ).toHaveLength(1);
    data.references[0].role = 'last-frame';
    data.references[1].role = 'first-frame';
    expect(
      validateGenerationNode(data, [a, b], { mode: 'frames', maxCount: 2 })
    ).toEqual([]);
    expect(
      snapshotGenerationReferences(data, [a, b]).map(
        (ref) => ref.sourceElementId
      )
    ).toEqual(['b', 'a']);
    expect(data.references.map((ref) => ref.sourceElementId)).toEqual([
      'a',
      'b',
    ]);
    expect(
      validateGenerationNode(data, [a, b], { mode: 'reference', maxCount: 3 })
    ).toHaveLength(1);
  });
  it('rejects a lone last frame and duplicate first frames', () => {
    const data = {
      ...appendGenerationReference(empty(), a),
      generationType: 'video' as const,
    };
    data.references[0].role = 'last-frame';
    expect(
      validateGenerationNode(data, [a], { mode: 'frames', maxCount: 2 })
    ).toContain('请先添加首帧');
    data.references.push({
      ...data.references[0],
      referenceId: 'second',
      role: 'first-frame',
    });
    data.references[0].role = 'first-frame';
    expect(
      validateGenerationNode(data, [a], { mode: 'frames', maxCount: 2 })
    ).toContain('首帧和尾帧各只能设置一张');
  });
});
