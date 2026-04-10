/**
 * Character Avatar Cache Service
 *
 * Caches character profile pictures to IndexedDB to prevent
 * broken images when the original URL expires.
 */

import localforage from 'localforage';

// Storage key prefix
const STORAGE_PREFIX = 'avatar-';

// Initialize localforage instance for avatar cache
const avatarStore = localforage.createInstance({
  name: 'drawnix',
  storeName: 'character-avatars',
  description: 'Character avatar cache',
});

/**
 * Cached avatar data
 */
export interface CachedAvatar {
  /** Character ID */
  characterId: string;
  /** Avatar blob data */
  blob: Blob;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Cache timestamp */
  cachedAt: number;
  /** Original URL (for reference) */
  originalUrl: string;
}

/**
 * Character Avatar Cache Service
 * Singleton service for caching character profile pictures
 */
class CharacterAvatarCacheService {
  // In-memory object URL cache (to avoid creating multiple URLs for same blob)
  private objectUrlCache: Map<string, string> = new Map();

  /**
   * Cache a character avatar from URL
   * @param characterId - Character ID
   * @param url - Profile picture URL
   * @returns true if cached successfully
   */
  async cacheAvatar(characterId: string, url: string): Promise<boolean> {
    try {
      // Check if already cached
      const existing = await this.getCachedAvatar(characterId);
      if (existing) {
        // console.log('[AvatarCache] Avatar already cached for:', characterId);
        return true;
      }

      // console.log('[AvatarCache] Caching avatar for:', characterId);

      // Use Image + Canvas approach to handle CORS issues
      const blob = await this.fetchImageAsBlob(url);
      if (!blob) {
        throw new Error('Failed to fetch avatar image');
      }

      const mimeType = blob.type || 'image/png';

      // Store in IndexedDB
      const cachedAvatar: CachedAvatar = {
        characterId,
        blob,
        mimeType,
        size: blob.size,
        cachedAt: Date.now(),
        originalUrl: url,
      };

      await avatarStore.setItem(`${STORAGE_PREFIX}${characterId}`, cachedAvatar);
      // console.log('[AvatarCache] Avatar cached successfully:', characterId, `(${blob.size} bytes)`);

      return true;
    } catch (error) {
      console.error('[AvatarCache] Failed to cache avatar:', characterId, error);
      return false;
    }
  }

  /**
   * Fetch image as blob using Image + Canvas to avoid CORS issues
   * @param url - Image URL
   * @returns Blob or null if failed
   */
  private async fetchImageAsBlob(url: string): Promise<Blob | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }

          ctx.drawImage(img, 0, 0);

          canvas.toBlob((blob) => {
            resolve(blob);
          }, 'image/png');
        } catch (error) {
          console.warn('[AvatarCache] Canvas draw failed:', error);
          resolve(null);
        }
      };

      img.onerror = () => {
        console.warn('[AvatarCache] Image load failed for:', url);
        resolve(null);
      };

      // Add cache buster to avoid stale cache
      img.src = url;
    });
  }

  /**
   * Get cached avatar data
   * @param characterId - Character ID
   * @returns Cached avatar data or null
   */
  async getCachedAvatar(characterId: string): Promise<CachedAvatar | null> {
    try {
      const cached = await avatarStore.getItem<CachedAvatar>(`${STORAGE_PREFIX}${characterId}`);
      return cached || null;
    } catch (error) {
      console.error('[AvatarCache] Failed to get cached avatar:', characterId, error);
      return null;
    }
  }

  /**
   * Get cached avatar URL (creates object URL from blob)
   * @param characterId - Character ID
   * @returns Object URL or null if not cached
   */
  async getCachedUrl(characterId: string): Promise<string | null> {
    // Check in-memory cache first
    const cachedUrl = this.objectUrlCache.get(characterId);
    if (cachedUrl) {
      return cachedUrl;
    }

    // Get from IndexedDB
    const cached = await this.getCachedAvatar(characterId);
    if (cached?.blob) {
      // LRU 淘汰：超过 50 个时释放最旧的
      const MAX_OBJECT_URLS = 50;
      if (this.objectUrlCache.size >= MAX_OBJECT_URLS) {
        const firstKey = this.objectUrlCache.keys().next().value;
        if (firstKey) {
          URL.revokeObjectURL(this.objectUrlCache.get(firstKey)!);
          this.objectUrlCache.delete(firstKey);
        }
      }
      const url = URL.createObjectURL(cached.blob);
      this.objectUrlCache.set(characterId, url);
      return url;
    }

    return null;
  }

  /**
   * Get avatar URL with fallback
   * Returns cached URL if available, otherwise returns original URL
   * @param characterId - Character ID
   * @param originalUrl - Original profile picture URL
   * @returns URL to use for display
   */
  async getAvatarUrl(characterId: string, originalUrl: string): Promise<string> {
    // Try cached URL first
    const cachedUrl = await this.getCachedUrl(characterId);
    if (cachedUrl) {
      return cachedUrl;
    }

    // Return original URL (and trigger background cache)
    this.cacheAvatar(characterId, originalUrl).catch(() => {
      // Ignore cache errors
    });

    return originalUrl;
  }

  /**
   * Check if avatar is cached
   * @param characterId - Character ID
   * @returns true if cached
   */
  async isCached(characterId: string): Promise<boolean> {
    const cached = await this.getCachedAvatar(characterId);
    return cached !== null;
  }

  /**
   * Delete cached avatar
   * @param characterId - Character ID
   * @returns true if deleted successfully
   */
  async deleteCache(characterId: string): Promise<boolean> {
    try {
      // Revoke object URL if exists
      const cachedUrl = this.objectUrlCache.get(characterId);
      if (cachedUrl) {
        URL.revokeObjectURL(cachedUrl);
        this.objectUrlCache.delete(characterId);
      }

      await avatarStore.removeItem(`${STORAGE_PREFIX}${characterId}`);
      // console.log('[AvatarCache] Avatar cache deleted:', characterId);
      return true;
    } catch (error) {
      console.error('[AvatarCache] Failed to delete avatar cache:', characterId, error);
      return false;
    }
  }

  /**
   * Clear all cached avatars
   * @returns true if cleared successfully
   */
  async clearAll(): Promise<boolean> {
    try {
      // Revoke all object URLs
      this.objectUrlCache.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      this.objectUrlCache.clear();

      await avatarStore.clear();
      // console.log('[AvatarCache] All avatar caches cleared');
      return true;
    } catch (error) {
      console.error('[AvatarCache] Failed to clear all caches:', error);
      return false;
    }
  }

  /**
   * Get total cache size
   * @returns Total size in bytes
   */
  async getTotalCacheSize(): Promise<number> {
    try {
      let totalSize = 0;
      await avatarStore.iterate<CachedAvatar, void>((value) => {
        if (value?.size) {
          totalSize += value.size;
        }
      });
      return totalSize;
    } catch (error) {
      console.error('[AvatarCache] Failed to get cache size:', error);
      return 0;
    }
  }

  /**
   * Get cache count
   * @returns Number of cached avatars
   */
  async getCacheCount(): Promise<number> {
    try {
      return await avatarStore.length();
    } catch (error) {
      console.error('[AvatarCache] Failed to get cache count:', error);
      return 0;
    }
  }

  /**
   * Cleanup - revoke object URLs on service destroy
   */
  cleanup(): void {
    this.objectUrlCache.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    this.objectUrlCache.clear();
  }
}

// Export singleton instance
export const characterAvatarCacheService = new CharacterAvatarCacheService();
