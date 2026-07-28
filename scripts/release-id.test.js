const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createReleaseId, sanitizeReleaseRef } = require('./release-id');

describe('release id', () => {
  it('uses the Netlify deploy id before the commit ref', () => {
    assert.equal(
      createReleaseId('1.0.4', {
        DEPLOY_ID: 'deploy-123',
        COMMIT_REF: 'commit-456',
      }),
      '1.0.4-deploy-123'
    );
  });

  it('uses the commit ref when no deploy id exists', () => {
    assert.equal(
      createReleaseId('1.0.4', { COMMIT_REF: '0403c0c84da12' }),
      '1.0.4-0403c0c84da12'
    );
  });

  it('creates a unique timestamp fallback for local builds', () => {
    assert.equal(
      createReleaseId('1.0.4', {}, new Date('2026-07-28T01:30:47.570Z')),
      '1.0.4-20260728013047570'
    );
  });

  it('removes unsafe cache-key characters', () => {
    assert.equal(
      sanitizeReleaseRef('preview/202?token=secret'),
      'preview202tokensecret'
    );
  });
});
