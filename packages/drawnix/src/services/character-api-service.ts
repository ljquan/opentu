/**
 * Character API Service
 *
 * Handles Sora-2 character creation and query API calls.
 * Characters are extracted from completed Sora-2 video tasks.
 */

import { geminiSettings } from '../utils/settings-manager';
import { createLogger } from '@aitu/utils';
import {
  getCharacterModel,
  type CreateCharacterParams,
  type CharacterCreateResponse,
  type CharacterQueryResponse,
  type CharacterPollingOptions,
  type CharacterStatus,
} from '../types/character.types';

// Create logger for this module
const log = createLogger('CharacterAPI');

// HTTP Status codes for better readability
const HTTP_STATUS = {
  ACCEPTED: 202,      // Request accepted, processing in background
  NOT_FOUND: 404,     // Resource not found (or not ready yet)
} as const;

/**
 * Character API Service
 * Manages character creation with async polling
 */
class CharacterAPIService {
  /**
   * Get base URL from settings (without /v1 suffix for this service)
   */
  private get baseUrl(): string {
    const settings = geminiSettings.get();
    // Remove /v1 suffix if present, as we append it in the endpoint
    return (settings.baseUrl || 'https://api.tu-zi.com/v1').replace(/\/v1\/?$/, '');
  }

  /**
   * Create a character from a Sora-2 video task
   * @param params - Character creation parameters
   * @returns Character creation response with ID
   */
  async createCharacter(params: CreateCharacterParams): Promise<CharacterCreateResponse> {
    const settings = geminiSettings.get();
    const apiKey = settings.apiKey;

    if (!apiKey) {
      throw new Error('API Key 未配置，请先配置 API Key');
    }

    // Get character model based on source video model
    const characterModel = getCharacterModel(params.sourceModel);

    log.debug('Creating character from video:', params.videoTaskId);
    log.debug('Source model:', params.sourceModel, '-> Character model:', characterModel);
    log.debug('Timestamps:', params.characterTimestamps || 'default');

    const formData = new FormData();
    formData.append('character_from_task', params.videoTaskId);
    formData.append('model', characterModel);

    if (params.characterTimestamps) {
      // Note: API parameter is character_timestamps (not chacter_timestamps)
      formData.append('character_timestamps', params.characterTimestamps);
    }

    const response = await fetchWithTuziClientChannel(`${this.baseUrl}/v1/videos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Create failed:', response.status, errorText);
      const error = new Error(`角色创建失败: ${response.status} - ${errorText}`);
      (error as any).apiErrorBody = errorText;
      (error as any).httpStatus = response.status;
      throw error;
    }

    const result = await response.json();
    log.debug('Character created:', result);
    return result;
  }

  /**
   * Query character status and information
   * @param characterId - Character ID (format: sora-2-character:ch_xxx)
   * @returns Character information
   */
  async queryCharacter(characterId: string): Promise<CharacterQueryResponse> {
    const settings = geminiSettings.get();
    const apiKey = settings.apiKey;

    if (!apiKey) {
      throw new Error('API Key 未配置');
    }

    const response = await fetchWithTuziClientChannel(`${this.baseUrl}/v1/videos/${characterId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Query failed:', response.status, errorText);

      // Check if character is still being processed:
      // - 202 Accepted: Request received, processing in background
      // - 404 Not Found: Character not ready yet (API returns 404 during processing)
      if (response.status === HTTP_STATUS.NOT_FOUND || response.status === HTTP_STATUS.ACCEPTED) {
        throw new Error('CHARACTER_PROCESSING');
      }

      const error = new Error(`角色查询失败: ${response.status} - ${errorText}`);
      (error as any).apiErrorBody = errorText;
      (error as any).httpStatus = response.status;
      throw error;
    }

    const result = await response.json();
    log.debug('Character query result:', result);
    return result;
  }

  /**
   * Create character and poll until completion
   * @param params - Character creation parameters
   * @param options - Polling options
   * @returns Completed character information
   */
  async createCharacterWithPolling(
    params: CreateCharacterParams,
    options: CharacterPollingOptions = {}
  ): Promise<CharacterQueryResponse & { characterId: string }> {
    const {
      interval = 3000,
      maxAttempts = 60, // 3 minutes at 3s interval
      onStatusChange,
    } = options;

    // Create character
    log.debug('Submitting character creation...');
    const createResponse = await this.createCharacter(params);
    const characterId = createResponse.id;
    log.debug('Character creation submitted:', characterId);

    // Notify status change
    if (onStatusChange) {
      onStatusChange('processing' as CharacterStatus);
    }

    // Poll for completion
    let attempts = 0;
    while (attempts < maxAttempts) {
      await this.sleep(interval);
      attempts++;

      try {
        log.debug(`Polling attempt ${attempts}/${maxAttempts}...`);
        const result = await this.queryCharacter(characterId);

        // Character is ready when we get username and profile_picture_url
        if (result.username && result.profile_picture_url) {
          log.debug('Character ready:', result.username);
          if (onStatusChange) {
            onStatusChange('completed' as CharacterStatus);
          }
          return { ...result, characterId };
        }
      } catch (error) {
        // If it's a processing error, continue polling
        if ((error as Error).message === 'CHARACTER_PROCESSING') {
          log.debug('Character still processing...');
          continue;
        }

        // For other errors, check if we should continue
        log.warn('Query error:', (error as Error).message);

        // If it's the last attempt, throw the error
        if (attempts >= maxAttempts) {
          if (onStatusChange) {
            onStatusChange('failed' as CharacterStatus);
          }
          throw error;
        }
      }
    }

    // Timeout
    if (onStatusChange) {
      onStatusChange('failed' as CharacterStatus);
    }
    throw new Error('角色创建超时，请稍后重试');
  }

  /**
   * Resume polling for an existing character
   * Used to recover from page refresh
   * @param characterId - Character ID to poll
   * @param options - Polling options
   * @returns Character information
   */
  async resumePolling(
    characterId: string,
    options: CharacterPollingOptions = {}
  ): Promise<CharacterQueryResponse> {
    const { onStatusChange } = options;

    log.debug('Resuming poll for character:', characterId);

    // Check immediate status
    try {
      const result = await this.queryCharacter(characterId);

      if (result.username && result.profile_picture_url) {
        log.debug('Character already ready:', result.username);
        if (onStatusChange) {
          onStatusChange('completed' as CharacterStatus);
        }
        return result;
      }
    } catch (error) {
      if ((error as Error).message !== 'CHARACTER_PROCESSING') {
        throw error;
      }
    }

    // Continue polling
    return this.pollUntilComplete(characterId, options);
  }

  /**
   * Poll for character completion
   * @private
   */
  private async pollUntilComplete(
    characterId: string,
    options: CharacterPollingOptions = {}
  ): Promise<CharacterQueryResponse> {
    const {
      interval = 3000,
      maxAttempts = 60,
      onStatusChange,
    } = options;

    let attempts = 0;

    while (attempts < maxAttempts) {
      await this.sleep(interval);
      attempts++;

      try {
        log.debug(`Poll attempt ${attempts}/${maxAttempts}...`);
        const result = await this.queryCharacter(characterId);

        if (result.username && result.profile_picture_url) {
          log.debug('Character ready:', result.username);
          if (onStatusChange) {
            onStatusChange('completed' as CharacterStatus);
          }
          return result;
        }
      } catch (error) {
        if ((error as Error).message === 'CHARACTER_PROCESSING') {
          continue;
        }

        if (attempts >= maxAttempts) {
          if (onStatusChange) {
            onStatusChange('failed' as CharacterStatus);
          }
          throw error;
        }
      }
    }

    if (onStatusChange) {
      onStatusChange('failed' as CharacterStatus);
    }
    throw new Error('角色创建超时，请稍后重试');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const characterAPIService = new CharacterAPIService();
import { fetchWithTuziClientChannel } from './tuzi-client-attribution';
