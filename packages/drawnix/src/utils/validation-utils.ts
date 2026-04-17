/**
 * Validation Utilities
 * 
 * Provides validation functions for generation parameters and task data.
 * Ensures data integrity before task creation and API calls.
 */

import { GenerationParams, TaskType } from '../types/task.types';

/**
 * Validation result interface
 * Contains validation status and error messages
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error messages if validation failed */
  errors: string[];
}

/**
 * Validates generation parameters for completeness and correctness
 * 
 * @param params - The generation parameters to validate
 * @param type - The task type (image or video)
 * @returns Validation result with status and error messages
 * 
 * @example
 * validateGenerationParams({ prompt: "cat" }, 'image')
 * // Returns { valid: true, errors: [] }
 * 
 * validateGenerationParams({}, 'image')
 * // Returns { valid: false, errors: ["Prompt is required"] }
 */
export function validateGenerationParams(
  params: GenerationParams,
  type?: TaskType
): ValidationResult {
  const errors: string[] = [];
  
  // Validate required fields
  if (!params.prompt || typeof params.prompt !== 'string') {
    errors.push('Prompt is required and must be a string');
  } else if (params.prompt.trim().length === 0) {
    errors.push('Prompt cannot be empty');
  }
  
  // Validate optional numeric fields
  if (params.width !== undefined) {
    if (typeof params.width !== 'number' || params.width <= 0) {
      errors.push('Width must be a positive number');
    } else if (params.width > 4096) {
      errors.push('Width must not exceed 4096 pixels');
    }
  }
  
  if (params.height !== undefined) {
    if (typeof params.height !== 'number' || params.height <= 0) {
      errors.push('Height must be a positive number');
    } else if (params.height > 4096) {
      errors.push('Height must not exceed 4096 pixels');
    }
  }
  
  // Validate video-specific fields
  if (type === TaskType.VIDEO && params.duration !== undefined) {
    if (typeof params.duration !== 'number' || params.duration <= 0) {
      errors.push('Duration must be a positive number');
    } else if (params.duration > 60) {
      errors.push('Duration must not exceed 60 seconds');
    }
  }

  if (type === TaskType.AUDIO) {
    if (params.title !== undefined && typeof params.title !== 'string') {
      errors.push('Title must be a string');
    }
    if (params.tags !== undefined && typeof params.tags !== 'string') {
      errors.push('Tags must be a string');
    }
    if (params.mv !== undefined && typeof params.mv !== 'string') {
      errors.push('mv must be a string');
    }
    if (params.continueAt !== undefined) {
      if (typeof params.continueAt !== 'number' || params.continueAt < 0) {
        errors.push('continueAt must be a non-negative number');
      }
    }
    if (params.infillStartS !== undefined) {
      if (typeof params.infillStartS !== 'number' || params.infillStartS < 0) {
        errors.push('infillStartS must be a non-negative number');
      }
    }
    if (params.infillEndS !== undefined) {
      if (typeof params.infillEndS !== 'number' || params.infillEndS < 0) {
        errors.push('infillEndS must be a non-negative number');
      }
    }
    if (
      typeof params.infillStartS === 'number' &&
      typeof params.infillEndS === 'number' &&
      params.infillStartS >= params.infillEndS
    ) {
      errors.push('infillStartS must be smaller than infillEndS');
    }
    if (
      params.continueClipId !== undefined &&
      typeof params.continueClipId !== 'string'
    ) {
      errors.push('continueClipId must be a string');
    }
  }

  // Validate character-specific fields
  if (type === TaskType.CHARACTER) {
    if (!params.sourceVideoTaskId) {
      errors.push('Source video task ID is required for character extraction');
    }
  }

  if (params.seed !== undefined) {
    if (typeof params.seed !== 'number' || !Number.isInteger(params.seed)) {
      errors.push('Seed must be an integer');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates a task type value
 *
 * @param type - The task type to validate
 * @returns True if the type is valid, false otherwise
 */
export function isValidTaskType(type: string): type is TaskType {
  return (
    type === TaskType.IMAGE ||
    type === TaskType.VIDEO ||
    type === TaskType.AUDIO ||
    type === TaskType.CHARACTER ||
    type === TaskType.CHAT
  );
}

/**
 * Sanitizes generation parameters by removing invalid fields
 * 
 * @param params - The generation parameters to sanitize
 * @returns Sanitized parameters object
 */
export function sanitizeGenerationParams(params: GenerationParams): GenerationParams {
  const sanitized: GenerationParams = {
    prompt: params.prompt?.trim() || '',
  };

  if (params.width && typeof params.width === 'number' && params.width > 0) {
    sanitized.width = Math.min(params.width, 4096);
  }

  if (params.height && typeof params.height === 'number' && params.height > 0) {
    sanitized.height = Math.min(params.height, 4096);
  }

  if (params.duration && typeof params.duration === 'number' && params.duration > 0) {
    sanitized.duration = Math.min(params.duration, 60);
  }

  if (params.style && typeof params.style === 'string') {
    sanitized.style = params.style.trim();
  }

  if (params.seed && typeof params.seed === 'number' && Number.isInteger(params.seed)) {
    sanitized.seed = params.seed;
  }

  // Preserve custom parameters (uploadedImages, uploadedImage, etc.)
  // Copy all other properties from the original params
  Object.keys(params).forEach(key => {
    if (!['prompt', 'width', 'height', 'duration', 'style', 'seed'].includes(key)) {
      (sanitized as any)[key] = params[key as keyof GenerationParams];
    }
  });

  return sanitized;
}

/**
 * Generates a hash from generation parameters for duplicate detection
 * 
 * @param params - The generation parameters
 * @param type - The task type
 * @returns Hash string representing the parameters
 */
export function generateParamsHash(params: GenerationParams, type: TaskType): string {
  const sortedParams = {
    type,
    prompt: params.prompt,
    width: params.width,
    height: params.height,
    duration: params.duration,
    style: params.style,
    seed: params.seed,
    // Include batch info for unique hash per batch task
    batchId: (params as any).batchId,
    batchIndex: (params as any).batchIndex,
    // Global index ensures uniqueness even for identical params
    globalIndex: (params as any).globalIndex,
  };

  return JSON.stringify(sortedParams);
}
