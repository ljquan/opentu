/**
 * useCharacters Hook
 *
 * React hook for managing Sora characters.
 * Provides character list state, creation, deletion, and status management.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { characterStorageService } from '../services/character-storage-service';
import { characterAPIService } from '../services/character-api-service';
import { analytics } from '../utils/umami-analytics';
import type {
  SoraCharacter,
  CharacterStatus,
  CreateCharacterParams,
} from '../types/character.types';

interface UseCharactersReturn {
  /** All characters */
  characters: SoraCharacter[];
  /** Characters that are completed */
  completedCharacters: SoraCharacter[];
  /** Characters that are being created */
  pendingCharacters: SoraCharacter[];
  /** Whether initial load is in progress */
  isLoading: boolean;
  /** Create a new character from a video task */
  createCharacter: (params: CreateCharacterParams) => Promise<SoraCharacter | null>;
  /** Delete a character */
  deleteCharacter: (id: string) => Promise<boolean>;
  /** Refresh character list from storage */
  refreshCharacters: () => Promise<void>;
  /** Get a character by ID */
  getCharacterById: (id: string) => SoraCharacter | undefined;
  /** Check if a task already has a character being created */
  isCreatingCharacterForTask: (taskId: string) => boolean;
}

/**
 * Hook for managing Sora characters
 */
export function useCharacters(): UseCharactersReturn {
  const [characters, setCharacters] = useState<SoraCharacter[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Track active polling for characters
  const pollingRef = useRef<Map<string, boolean>>(new Map());

  // Subscribe to character storage changes
  useEffect(() => {
    const subscription = characterStorageService
      .getCharacters$()
      .subscribe(chars => {
        setCharacters(chars);
        setIsLoading(false);
      });

    // Initialize storage
    characterStorageService.init();

    return () => subscription.unsubscribe();
  }, []);

  // Resume polling for pending characters on mount
  useEffect(() => {
    const resumePendingCharacters = async () => {
      const pending = characterStorageService.getPendingCharacters();
      // console.log('[useCharacters] Found', pending.length, 'pending characters to resume');

      for (const character of pending) {
        if (!pollingRef.current.get(character.id)) {
          resumePollingForCharacter(character);
        }
      }
    };

    // Wait for initial load
    if (!isLoading) {
      resumePendingCharacters();
    }
  }, [isLoading]);

  /**
   * Resume polling for a pending character
   */
  const resumePollingForCharacter = useCallback(async (character: SoraCharacter) => {
    if (pollingRef.current.get(character.id)) {
      // console.log('[useCharacters] Already polling for:', character.id);
      return;
    }

    pollingRef.current.set(character.id, true);
    // console.log('[useCharacters] Resuming polling for:', character.id);

    try {
      const result = await characterAPIService.resumePolling(character.id, {
        onStatusChange: async (status: CharacterStatus) => {
          await characterStorageService.updateCharacterStatus(character.id, status);
        },
      });

      // Update with full character info
      await characterStorageService.updateCharacter(character.id, {
        username: result.username,
        profilePictureUrl: result.profile_picture_url,
        permalink: result.permalink,
        status: 'completed' as CharacterStatus,
        completedAt: Date.now(),
      });

      // console.log('[useCharacters] Character completed:', result.username);
    } catch (error) {
      console.error('[useCharacters] Character polling failed:', error);
      await characterStorageService.updateCharacterStatus(
        character.id,
        'failed' as CharacterStatus,
        (error as Error).message
      );
    } finally {
      pollingRef.current.delete(character.id);
    }
  }, []);

  /**
   * Create a new character from a video task
   */
  const createCharacter = useCallback(async (
    params: CreateCharacterParams
  ): Promise<SoraCharacter | null> => {
    const startTime = Date.now();
    
    // 埋点：角色提取开始
    analytics.track('character_extract_start', {
      videoTaskId: params.videoTaskId,
      hasTimestamps: !!params.characterTimestamps?.length,
    });

    try {
      // console.log('[useCharacters] Creating character from:', params.videoTaskId);

      // Create character via API
      const createResponse = await characterAPIService.createCharacter(params);
      const characterId = createResponse.id;

      // Create initial character record
      const character: SoraCharacter = {
        id: characterId,
        username: '', // Will be filled when completed
        profilePictureUrl: '', // Will be filled when completed
        sourceTaskId: params.localTaskId || '',
        sourceVideoId: params.videoTaskId,
        sourcePrompt: params.sourcePrompt,
        characterTimestamps: params.characterTimestamps,
        status: 'processing' as CharacterStatus,
        createdAt: Date.now(),
      };

      // Save to storage
      await characterStorageService.saveCharacter(character);

      // Start polling in background
      pollingRef.current.set(characterId, true);

      characterAPIService.resumePolling(characterId, {
        onStatusChange: async (status: CharacterStatus) => {
          await characterStorageService.updateCharacterStatus(characterId, status);
        },
      }).then(async (result) => {
        // Update with full character info
        await characterStorageService.updateCharacter(characterId, {
          username: result.username,
          profilePictureUrl: result.profile_picture_url,
          permalink: result.permalink,
          status: 'completed' as CharacterStatus,
          completedAt: Date.now(),
        });

        // 埋点：角色提取成功
        analytics.track('character_extract_success', {
          characterId,
          username: result.username,
          duration: Date.now() - startTime,
        });
        //         // console.log('[useCharacters] Character completed:', result.username);
      }).catch(async (error) => {
        console.error('[useCharacters] Character creation failed:', error);
        await characterStorageService.updateCharacterStatus(
          characterId,
          'failed' as CharacterStatus,
          (error as Error).message
        );

        // 埋点：角色提取失败
        analytics.track('character_extract_failed', {
          characterId,
          error: (error as Error).message,
          duration: Date.now() - startTime,
        });
      }).finally(() => {
        pollingRef.current.delete(characterId);
      });

      return character;
    } catch (error) {
      console.error('[useCharacters] Failed to create character:', error);
      throw error;
    }
  }, []);

  /**
   * Delete a character
   */
  const deleteCharacter = useCallback(async (id: string): Promise<boolean> => {
    // Stop any active polling
    pollingRef.current.delete(id);

    return characterStorageService.deleteCharacter(id);
  }, []);

  /**
   * Refresh character list from storage
   */
  const refreshCharacters = useCallback(async (): Promise<void> => {
    await characterStorageService.init();
  }, []);

  /**
   * Get a character by ID
   */
  const getCharacterById = useCallback((id: string): SoraCharacter | undefined => {
    return characters.find(c => c.id === id);
  }, [characters]);

  /**
   * Check if a task already has a character being created
   */
  const isCreatingCharacterForTask = useCallback((taskId: string): boolean => {
    return characters.some(
      c => c.sourceTaskId === taskId &&
        (c.status === 'pending' || c.status === 'processing')
    );
  }, [characters]);

  // Computed values
  const completedCharacters = characters.filter(c => c.status === 'completed');
  const pendingCharacters = characters.filter(
    c => c.status === 'pending' || c.status === 'processing'
  );

  return {
    characters,
    completedCharacters,
    pendingCharacters,
    isLoading,
    createCharacter,
    deleteCharacter,
    refreshCharacters,
    getCharacterById,
    isCreatingCharacterForTask,
  };
}
