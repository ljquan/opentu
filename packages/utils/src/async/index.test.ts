import { describe, it, expect, vi } from 'vitest';
import { isPromiseLike, composeEventHandlers, yieldToMain, processBatched } from './index';

describe('isPromiseLike', () => {
  it('should return true for Promise instances', () => {
    const promise = Promise.resolve(42);
    expect(isPromiseLike(promise)).toBe(true);
  });

  it('should return true for objects with then/catch/finally methods', () => {
    const promiseLike = {
      then: () => {},
      catch: () => {},
      finally: () => {},
    };
    expect(isPromiseLike(promiseLike)).toBe(true);
  });

  it('should return false for non-promise objects', () => {
    expect(isPromiseLike({})).toBe(false);
    expect(isPromiseLike({ then: () => {} })).toBe(false);
    expect(isPromiseLike({ then: () => {}, catch: () => {} })).toBe(false);
  });

  it('should return false for primitives', () => {
    expect(isPromiseLike(null)).toBe(false);
    expect(isPromiseLike(undefined)).toBe(false);
    expect(isPromiseLike(42)).toBe(false);
    expect(isPromiseLike('string')).toBe(false);
  });

  it('should type guard correctly', async () => {
    const value: unknown = Promise.resolve(42);

    if (isPromiseLike(value)) {
      // TypeScript should know this is a Promise
      const result = await value;
      expect(result).toBe(42);
    }
  });
});

describe('composeEventHandlers', () => {
  it('should call both handlers in order', () => {
    const calls: string[] = [];
    const handler1 = () => calls.push('handler1');
    const handler2 = () => calls.push('handler2');

    const composed = composeEventHandlers(handler1, handler2);
    composed({} as any);

    expect(calls).toEqual(['handler1', 'handler2']);
  });

  it('should pass event to both handlers', () => {
    const event = { type: 'click', target: 'button' };
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const composed = composeEventHandlers(handler1, handler2);
    composed(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
  });

  it('should skip second handler if defaultPrevented is true', () => {
    const event = {
      defaultPrevented: true,
    } as Event;

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const composed = composeEventHandlers(handler1, handler2);
    composed(event);

    expect(handler1).toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('should call second handler when checkForDefaultPrevented is false', () => {
    const event = {
      defaultPrevented: true,
    } as Event;

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const composed = composeEventHandlers(handler1, handler2, {
      checkForDefaultPrevented: false,
    });
    composed(event);

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('should handle undefined handlers', () => {
    const handler = vi.fn();

    const composed1 = composeEventHandlers(undefined, handler);
    composed1({} as any);
    expect(handler).toHaveBeenCalled();

    const composed2 = composeEventHandlers(handler, undefined);
    composed2({} as any);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should handle both handlers undefined', () => {
    const composed = composeEventHandlers(undefined, undefined);
    expect(() => composed({} as any)).not.toThrow();
  });

  it('should return value from second handler', () => {
    const handler1 = () => 'first';
    const handler2 = () => 'second';

    const composed = composeEventHandlers(handler1, handler2);
    const result = composed({} as any);

    expect(result).toBe('second');
  });
});

describe('yieldToMain', () => {
  it('should return a Promise', () => {
    const result = yieldToMain();
    expect(result).toBeInstanceOf(Promise);
  });

  it('should resolve immediately on next tick', async () => {
    const start = Date.now();
    await yieldToMain();
    const duration = Date.now() - start;
    // Should be nearly instant (< 50ms accounting for test overhead)
    expect(duration).toBeLessThan(50);
  });

  it('should allow other tasks to run', async () => {
    const order: number[] = [];
    
    // Schedule a microtask
    Promise.resolve().then(() => order.push(2));
    
    order.push(1);
    await yieldToMain(); // This uses setTimeout, so microtasks run first
    order.push(3);

    expect(order).toEqual([1, 2, 3]);
  });
});

describe('processBatched', () => {
  it('should process all items', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await processBatched(
      items,
      async (item) => item * 2,
      2
    );
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('should call processor with item and index', async () => {
    const items = ['a', 'b', 'c'];
    const calls: [string, number][] = [];
    
    await processBatched(
      items,
      async (item, index) => {
        calls.push([item, index]);
        return item;
      },
      5
    );

    expect(calls).toEqual([['a', 0], ['b', 1], ['c', 2]]);
  });

  it('should yield after batchSize items', async () => {
    const yieldSpy = vi.spyOn(global, 'setTimeout');
    const items = [1, 2, 3, 4, 5, 6];
    
    await processBatched(items, async (x) => x, 2);
    
    // Should yield 3 times (after item 2, 4, 6)
    // Note: We check that setTimeout was called, which indicates yielding
    expect(yieldSpy).toHaveBeenCalled();
    yieldSpy.mockRestore();
  });

  it('should handle empty array', async () => {
    const results = await processBatched([], async (x) => x, 5);
    expect(results).toEqual([]);
  });

  it('should use default batchSize of 5', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const results = await processBatched(items, async (x) => x * 2);
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });
});
