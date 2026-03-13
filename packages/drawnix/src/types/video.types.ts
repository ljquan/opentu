/**
 * Video Model Types and Configuration
 *
 * Defines types for video generation models and their parameters.
 */

// Known built-in video generation models
export type KnownVideoModel =
  | 'sora-2'
  | 'sora-2-pro'
  | 'sora-2-4s'
  | 'sora-2-8s'
  | 'sora-2-12s'
  | 'kling-v1-6'
  | 'veo3'
  | 'veo3-pro'
  | 'veo3.1'
  | 'veo3.1-pro'
  | 'veo3.1-components'
  | 'veo3.1-4k'
  | 'veo3.1-components-4k'
  | 'veo3.1-pro-4k'
  | 'seedance-1.5-pro'
  | 'seedance-1.0-pro'
  | 'seedance-1.0-pro-fast'
  | 'seedance-1.0-lite';

// Video generation models also allow runtime-discovered ids.
export type VideoModel = KnownVideoModel | string;

// Video model provider
export type VideoProvider = 'sora' | 'veo' | 'kling' | 'seedance';

// Image upload mode
export type ImageUploadMode = 'reference' | 'frames' | 'components';

// Duration option
export interface DurationOption {
  label: string;
  value: string;
}

// Size option with aspect ratio
export interface SizeOption {
  label: string;
  value: string;
  aspectRatio: string;
}

// Image upload configuration
export interface ImageUploadConfig {
  maxCount: number; // Maximum number of images
  mode: ImageUploadMode; // Upload mode: reference, frames, or components
  labels?: string[]; // Labels for each upload slot (e.g., ['首帧', '尾帧'])
  required?: boolean; // Whether image upload is required
}

// Storyboard mode configuration for models
export interface StoryboardModeConfig {
  supported: boolean; // Whether model supports storyboard mode
  maxScenes: number; // Maximum scenes allowed (default 5)
  minSceneDuration: number; // Minimum duration per scene in seconds
}

// Video model configuration
export interface VideoModelConfig {
  id: VideoModel;
  label: string;
  provider: VideoProvider;
  description?: string;
  // Duration options
  durationOptions: DurationOption[];
  defaultDuration: string;
  // Size options
  sizeOptions: SizeOption[];
  defaultSize: string;
  // Image upload configuration
  imageUpload: ImageUploadConfig;
  // Storyboard mode configuration (optional, only for supported models)
  storyboardMode?: StoryboardModeConfig;
}

// Uploaded image with slot info
export interface UploadedVideoImage {
  slot: number; // Slot index (0, 1, 2)
  slotLabel?: string; // Slot label (e.g., '首帧', '尾帧')
  url: string; // Base64 or URL
  name: string; // File name
  file?: File; // Original file object
}

// Storyboard scene definition
export interface StoryboardScene {
  id: string; // Unique scene ID
  duration: number; // Duration in seconds (e.g., 7.5)
  prompt: string; // Scene prompt/description
  order: number; // Scene order (1-5)
}

// Storyboard configuration
export interface StoryboardConfig {
  enabled: boolean; // Whether storyboard mode is enabled
  scenes: StoryboardScene[]; // Scene list (1-5 scenes)
  totalDuration: number; // Total video duration from model (10/15/25)
}

// Video generation parameters (extended)
export interface VideoGenerationParams {
  model: VideoModel;
  prompt: string;
  /** For legacy compatibility; prefer seconds */
  duration?: string | number;
  seconds?: string;
  size?: string;
  // Support multiple images for different models
  inputReferences?: UploadedVideoImage[];
  // Legacy single image support
  inputReference?: string;
  // Storyboard mode configuration
  storyboard?: StoryboardConfig;
}
