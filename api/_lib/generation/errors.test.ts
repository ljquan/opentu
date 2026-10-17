import { describe, expect, it } from 'vitest';
import { asGatewayError, sanitizeDiagnostic, upstreamError } from './errors';

describe('generation error safety', () => {
  it.each([408, 500, 502, 504])('does not retry ambiguous upstream status %s', (status) => {
    expect(upstreamError(status).retryable).toBe(false);
  });

  it('does not turn unknown failures into permission to resubmit', () => {
    expect(asGatewayError(new Error('unexpected failure')).retryable).toBe(false);
    expect(asGatewayError(new DOMException('timeout', 'TimeoutError')).retryable).toBe(false);
  });
  it('redacts credentials and URLs from diagnostics', () => {
    const message = sanitizeDiagnostic(
      new Error(
        'Bearer super-secret api_key=another-secret https://provider.invalid/v1/tasks?id=1'
      )
    );
    expect(message).toBe('[redacted] [redacted] [redacted]');
    expect(message).not.toContain('super-secret');
    expect(message).not.toContain('another-secret');
    expect(message).not.toContain('provider.invalid');
  });

  it('maps retryable provider failures to safe public errors', () => {
    const error = upstreamError(429);
    expect(error.code).toBe('UPSTREAM_BUSY');
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain('429');
  });
});
