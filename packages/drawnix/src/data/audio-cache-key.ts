export function createHash(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function getAudioCacheKeySeed(
  audioUrl: string,
  metadata: {
    clipId?: string;
    providerTaskId?: string;
  }
): string {
  if (metadata.clipId) {
    return metadata.clipId;
  }

  const audioHash = createHash(audioUrl).toString(36);
  if (metadata.providerTaskId) {
    return `${metadata.providerTaskId}-${audioHash}`;
  }

  return `audio-${audioHash}`;
}
