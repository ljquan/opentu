import { describe, expect, it } from 'vitest';
import { PendingPersistence } from './pending-persistence';

describe('PendingPersistence', () => {
  it('invalidates an earlier sync revision even after a newer insertion has finished saving', () => {
    const persistence = new PendingPersistence();
    const snapshotRevision = persistence.currentRevision;
    const insertionRevision = persistence.begin();
    persistence.complete(insertionRevision);
    expect(persistence.hasPending).toBe(false);
    expect(persistence.currentRevision).not.toBe(snapshotRevision);
  });

  it('keeps a newer change pending when an older save completes', () => {
    const persistence = new PendingPersistence();
    const olderRevision = persistence.begin();
    const newerRevision = persistence.begin();

    expect(persistence.complete(olderRevision)).toBe(false);
    expect(persistence.hasPending).toBe(true);
    expect(persistence.complete(newerRevision)).toBe(true);
    expect(persistence.hasPending).toBe(false);
  });

  it('ignores saves started before a board reset', () => {
    const persistence = new PendingPersistence();
    const revision = persistence.begin();

    persistence.reset();

    expect(persistence.complete(revision)).toBe(false);
    expect(persistence.hasPending).toBe(false);
  });
});
