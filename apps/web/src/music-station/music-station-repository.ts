export type MusicReleaseVisibility = 'draft' | 'public' | 'private';

export interface MusicRelease {
  id: string;
  taskId: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  prompt: string;
  tags: string[];
  model: string;
  audioUrl: string;
  coverUrl?: string;
  duration?: number;
  lyrics?: string;
  providerTaskId?: string;
  clipId?: string;
  visibility: MusicReleaseVisibility;
}

const STORAGE_KEY = 'opentu:music-releases:v1';

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isRelease(value: unknown): value is MusicRelease {
  const release = value as Partial<MusicRelease> | null;
  return Boolean(
    release &&
      typeof release.id === 'string' &&
      typeof release.taskId === 'string' &&
      typeof release.title === 'string' &&
      typeof release.audioUrl === 'string' &&
      Array.isArray(release.tags) &&
      (release.visibility === 'draft' ||
        release.visibility === 'public' ||
        release.visibility === 'private')
  );
}

function read(): MusicRelease[] {
  try {
    const raw = getStorage()?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isRelease) : [];
  } catch {
    return [];
  }
}

function write(releases: MusicRelease[]): void {
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify(releases));
  } catch {
    // Local storage is an enhancement; the task result remains available.
  }
}

export const musicReleaseRepository = {
  list(): MusicRelease[] {
    return read().sort((a, b) => b.updatedAt - a.updatedAt);
  },

  save(release: MusicRelease): MusicRelease[] {
    const releases = read();
    const index = releases.findIndex((item) => item.id === release.id);
    if (index >= 0) {
      releases[index] = release;
    } else {
      releases.push(release);
    }
    write(releases);
    return this.list();
  },

  setVisibility(id: string, visibility: MusicReleaseVisibility): MusicRelease[] {
    const releases = read().map((release) =>
      release.id === id
        ? { ...release, visibility, updatedAt: Date.now() }
        : release
    );
    write(releases);
    return this.list();
  },
};

