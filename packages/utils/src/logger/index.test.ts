import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, logger } from './index';

describe('createLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a namespaced logger', () => {
    const testLogger = createLogger('TestModule');

    testLogger.debug('debug message');
    testLogger.info('info message');
    testLogger.warn('warn message');
    testLogger.error('error message');

    expect(console.warn).toHaveBeenCalledWith('[TestModule]', 'warn message');
    expect(console.error).toHaveBeenCalledWith('[TestModule]', 'error message');
  });

  it('should support multiple arguments', () => {
    const testLogger = createLogger('Test');

    testLogger.warn('message', 1, 2, { key: 'value' });

    expect(console.warn).toHaveBeenCalledWith(
      '[Test]',
      'message',
      1,
      2,
      { key: 'value' }
    );
  });
});

describe('logger (default instance)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should log warnings', () => {
    logger.warn('warning message');
    expect(console.warn).toHaveBeenCalledWith('warning message');
  });

  it('should log errors', () => {
    logger.error('error message');
    expect(console.error).toHaveBeenCalledWith('error message');
  });

  it('should support multiple arguments', () => {
    logger.error('error', 'with', 'multiple', 'args');
    expect(console.error).toHaveBeenCalledWith(
      'error',
      'with',
      'multiple',
      'args'
    );
  });
});
