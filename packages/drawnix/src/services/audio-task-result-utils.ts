export function alignCachedAudioClipUrls<
  TClip extends {
    audioUrl: string;
  },
>(
  clips: TClip[] | undefined,
  cachedUrls: string[] | undefined,
  primaryUrl: string
): TClip[] | undefined {
  if (!clips?.length) {
    return clips;
  }

  return clips.map((clip, index) => {
    const alignedAudioUrl =
      cachedUrls?.[index] ||
      (index === 0 && primaryUrl ? primaryUrl : clip.audioUrl);

    if (!alignedAudioUrl || alignedAudioUrl === clip.audioUrl) {
      return clip;
    }

    return {
      ...clip,
      audioUrl: alignedAudioUrl,
    };
  });
}

export function resolveAudioResultUrls(
  result:
    | {
        clips?: Array<{ audioUrl?: string }>;
        urls?: string[];
        url?: string;
      }
    | undefined
): string[] {
  const clipUrls =
    result?.clips
      ?.map((clip) =>
        typeof clip.audioUrl === 'string' ? clip.audioUrl.trim() : ''
      )
      .filter((url): url is string => Boolean(url)) || [];

  if (clipUrls.length > 0) {
    return clipUrls;
  }

  if (Array.isArray(result?.urls) && result.urls.length > 0) {
    return result.urls.filter(
      (url): url is string => typeof url === 'string' && url.trim().length > 0
    );
  }

  if (typeof result?.url === 'string' && result.url.trim().length > 0) {
    return [result.url];
  }

  return [];
}
