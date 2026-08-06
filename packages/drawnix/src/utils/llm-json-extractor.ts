export type JsonKind = 'object' | 'array';
export type JsonPredicate = (value: unknown) => boolean;

export interface ExtractJsonOptions {
  kinds?: readonly JsonKind[];
  predicate?: JsonPredicate;
}

export interface ExtractJsonSourceOptions extends ExtractJsonOptions {
  allowInvalid?: boolean;
}

interface JsonCandidate {
  source: string;
  kind: JsonKind;
  value?: unknown;
  valid: boolean;
}

function getJsonKind(value: unknown): JsonKind | null {
  if (Array.isArray(value)) return 'array';
  if (value && typeof value === 'object') return 'object';
  return null;
}

function getFenceContents(text: string): string[] {
  const contents: string[] = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(text)) !== null) {
    contents.push(match[1].trim());
  }
  return contents;
}

function uniqueSources(sources: string[]): string[] {
  const seen = new Set<string>();
  return sources
    .map((source) => source.trim())
    .filter((source) => {
      if (!source || seen.has(source)) return false;
      seen.add(source);
      return true;
    });
}

function collectString(value: unknown, output: string[]): void {
  if (typeof value === 'string' && value.trim()) {
    output.push(value);
  }
}

export function normalizeLlmTextContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) return '';

  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function collectTextFromContentParts(value: unknown, output: string[]): void {
  collectString(normalizeLlmTextContent(value), output);
}

function collectKnownLlmPayloads(value: unknown): string[] {
  const output: string[] = [];
  const root = value as {
    candidates?: unknown;
    choices?: unknown;
    output_text?: unknown;
    text?: unknown;
    content?: unknown;
  } | null;

  if (!root || typeof root !== 'object') return output;

  collectString(root.output_text, output);
  collectString(root.text, output);
  collectString(root.content, output);
  collectTextFromContentParts(root.content, output);

  if (Array.isArray(root.candidates)) {
    for (const candidate of root.candidates) {
      const item = candidate as {
        content?: { parts?: unknown };
      } | null;
      collectTextFromContentParts(item?.content?.parts, output);
    }
  }

  if (Array.isArray(root.choices)) {
    for (const choice of root.choices) {
      const item = choice as {
        message?: { content?: unknown };
        delta?: { content?: unknown };
        text?: unknown;
      } | null;
      if (!item || typeof item !== 'object') continue;
      collectString(item.message?.content, output);
      collectString(item.delta?.content, output);
      collectString(item.text, output);
      collectTextFromContentParts(item.message?.content, output);
      collectTextFromContentParts(item.delta?.content, output);
    }
  }

  return output;
}

function collectEnvelopePayloadSources(sources: string[]): string[] {
  const payloads: string[] = [];
  for (const source of sources) {
    const trimmed = source.trim();
    if (!trimmed || !/^[{[]/.test(trimmed)) continue;
    try {
      payloads.push(...collectKnownLlmPayloads(JSON.parse(trimmed)));
    } catch {
      // Not a JSON envelope; keep using balanced scanning on the source itself.
    }
  }
  return payloads;
}

function buildJsonSearchSources(text: string): string[] {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('响应为空，未找到有效 JSON');
  }

  const withoutClosedThink = trimmed.replace(
    /<think\b[^>]*>[\s\S]*?<\/think>/gi,
    ''
  );
  const lastThinkEnd = trimmed.toLowerCase().lastIndexOf('</think>');
  const afterThink =
    lastThinkEnd >= 0 ? trimmed.slice(lastThinkEnd + '</think>'.length) : '';

  const directSources = uniqueSources([
    ...getFenceContents(afterThink),
    afterThink,
    ...getFenceContents(withoutClosedThink),
    withoutClosedThink,
    ...getFenceContents(trimmed),
    trimmed,
  ]);
  const envelopePayloads = collectEnvelopePayloadSources(directSources);

  return uniqueSources([
    ...envelopePayloads.flatMap((payload) => [
      ...getFenceContents(payload),
      payload,
    ]),
    ...directSources,
  ]);
}

function extractBalancedJsonAt(source: string, start: number): string | null {
  const opener = source[start];
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : '';
  if (!closer) return null;

  const stack: string[] = [closer];
  let inString = false;
  let escaped = false;

  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      stack.push('}');
      continue;
    }

    if (char === '[') {
      stack.push(']');
      continue;
    }

    if (char === '}' || char === ']') {
      if (stack[stack.length - 1] !== char) return null;
      stack.pop();
      if (stack.length === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

function normalizeKinds(kinds?: readonly JsonKind[]): JsonKind[] {
  return kinds && kinds.length > 0 ? [...kinds] : ['object', 'array'];
}

function parseCandidate(source: string): JsonCandidate | null {
  try {
    const value = JSON.parse(source);
    const kind = getJsonKind(value);
    if (!kind) return null;
    return { source, kind, value, valid: true };
  } catch {
    const opener = source[0];
    const kind = opener === '{' ? 'object' : opener === '[' ? 'array' : null;
    return kind ? { source, kind, valid: false } : null;
  }
}

function predicateMatches(
  candidate: JsonCandidate,
  predicate?: JsonPredicate
): boolean {
  if (!predicate) return true;
  if (!candidate.valid) return false;
  try {
    return predicate(candidate.value);
  } catch {
    return false;
  }
}

function collectCandidates(
  text: string,
  options: ExtractJsonSourceOptions = {}
): JsonCandidate[] {
  const allowed = new Set(normalizeKinds(options.kinds));
  const openers = new Set<string>(
    [...allowed].map((kind) => (kind === 'object' ? '{' : '['))
  );
  const candidates: JsonCandidate[] = [];
  const seen = new Set<string>();

  for (const source of buildJsonSearchSources(text)) {
    for (let index = 0; index < source.length; index += 1) {
      if (!openers.has(source[index])) continue;
      const jsonSource = extractBalancedJsonAt(source, index);
      if (!jsonSource || seen.has(jsonSource)) continue;
      seen.add(jsonSource);

      const candidate = parseCandidate(jsonSource);
      if (!candidate || !allowed.has(candidate.kind)) continue;
      if (!candidate.valid && !options.allowInvalid) continue;
      if (!predicateMatches(candidate, options.predicate)) continue;
      candidates.push(candidate);
    }
  }

  return candidates;
}

export function extractJsonValue<T = unknown>(
  text: string,
  options: ExtractJsonOptions = {}
): T {
  const candidate = collectCandidates(text, {
    ...options,
    allowInvalid: false,
  })[0];
  if (!candidate || !candidate.valid) {
    throw new Error('响应中未找到有效 JSON');
  }
  return candidate.value as T;
}

export function extractJsonObject<T = Record<string, unknown>>(
  text: string,
  predicate?: JsonPredicate
): T {
  return extractJsonValue<T>(text, {
    kinds: ['object'],
    predicate,
  });
}

export function extractJsonArray<T = unknown>(
  text: string,
  predicate?: JsonPredicate
): T[] {
  return extractJsonValue<T[]>(text, {
    kinds: ['array'],
    predicate,
  });
}

export function collectJsonObjects<T = Record<string, unknown>>(
  text: string,
  predicate?: JsonPredicate
): T[] {
  return collectCandidates(text, {
    kinds: ['object'],
    predicate,
    allowInvalid: false,
  }).map((candidate) => candidate.value as T);
}

export function extractJsonSource(
  text: string,
  options: ExtractJsonSourceOptions = {}
): string {
  const candidate = collectCandidates(text, options)[0];
  if (!candidate) {
    throw new Error('响应中未找到有效 JSON');
  }
  return candidate.source;
}

export function collectJsonSources(
  text: string,
  options: ExtractJsonSourceOptions = {}
): string[] {
  return collectCandidates(text, options).map((candidate) => candidate.source);
}
