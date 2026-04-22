export type ConcatStage =
  | 'downloading'
  | 'parsing'
  | 'merging'
  | 'building';

export type ConcatProgressCallback = (
  progress: number,
  stage: ConcatStage
) => void;

export interface ConcatResult {
  url: string;
}

class VideoConcatService {
  async concatVideos(
    _urls: string[],
    onProgress?: ConcatProgressCallback
  ): Promise<ConcatResult> {
    onProgress?.(100, 'building');
    throw new Error('video concat service is unavailable in this build');
  }
}

export const videoConcatService = new VideoConcatService();
