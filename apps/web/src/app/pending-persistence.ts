export class PendingPersistence {
  private revision = 0;
  private pendingRevision: number | null = null;

  begin(): number {
    this.pendingRevision = ++this.revision;
    return this.revision;
  }

  complete(revision: number): boolean {
    if (this.pendingRevision !== revision) {
      return false;
    }

    this.pendingRevision = null;
    return true;
  }

  reset(): void {
    this.revision += 1;
    this.pendingRevision = null;
  }

  get hasPending(): boolean {
    return this.pendingRevision !== null;
  }

  get currentRevision(): number {
    return this.revision;
  }
}
