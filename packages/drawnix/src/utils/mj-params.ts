const MJ_PARAM_MAP: Record<string, string> = {
  mj_ar: '--ar',
  mj_v: '--v',
  mj_style: '--style',
  mj_s: '--s',
  mj_q: '--q',
  mj_seed: '--seed',
};

export const buildMJPromptSuffix = (params: Record<string, string>): string => {
  const parts: string[] = [];

  Object.entries(MJ_PARAM_MAP).forEach(([key, token]) => {
    const value = params[key];
    if (!value || value === 'default') return;
    parts.push(`${token} ${value}`);
  });

  return parts.join(' ');
};

export const buildMJPrompt = (
  prompt: string,
  params?: Record<string, unknown>
): string => {
  const selected: Record<string, string> = {};
  let basePrompt = prompt;

  Object.entries(MJ_PARAM_MAP).forEach(([key, token]) => {
    const value = params?.[key];
    if (
      typeof value !== 'string' &&
      !(typeof value === 'number' && Number.isFinite(value))
    ) {
      return;
    }
    const normalized = String(value).trim();
    if (!normalized || normalized === 'default') return;
    selected[key] = normalized;
    // Canvas callers may have already embedded the same selected flag.
    basePrompt = basePrompt.replace(
      new RegExp(`(?:^|\\s+)${token}(?:\\s+|=)\\S+`, 'g'),
      ''
    );
  });

  const suffix = buildMJPromptSuffix(selected);
  if (!suffix) return prompt;
  return [basePrompt.trim(), suffix].filter(Boolean).join(' ');
};
