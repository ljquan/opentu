import {
  getTuziVideoModelConfig,
  getTuziVideoMediaTypes,
  KLING_4_RATIO_OPTIONS,
  normalizeTuziVideoParams,
  OMNI_VIDEO_SIZES,
  type TuziVideoMedia,
} from '../constants/tuzi-video-models';
import {
  isPublicVideoMediaUrl,
  mediaMimeFromUrl,
  parseVideoMediaData,
  resolveTuziVideoMedia,
  validateHappyHorseImage,
  type TuziMediaResolver,
} from './tuzi-video-media';

export interface TuziVideoRequest {
  model: string;
  prompt: string;
  duration?: string | number;
  size?: string;
  referenceImages?: string[];
  params?: Record<string, unknown>;
}

function integer(
  value: unknown,
  min: number,
  max: number,
  label: string
): number {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    String(value).trim() === '' ||
    !Number.isInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw new Error(`${label} 必须是 ${min}–${max} 的整数`);
  }
  return Number(value);
}

function boolean(value: unknown, label: string): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${label} 必须是 true 或 false`);
}

function array(value: unknown, label: string): unknown[] {
  if (value === undefined || value === '') return [];
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`${label} 格式无效`);
    }
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} 必须是列表`);
  return parsed;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function choice(
  value: unknown,
  options: readonly string[],
  label: string
): string {
  if (typeof value !== 'string' || !options.includes(value))
    throw new Error(`${label} 不支持该取值`);
  return value;
}

function url(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isPublicVideoMediaUrl(value))
    throw new Error(`${label} 需要公网 HTTP(S) URL`);
  return value;
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} 不能为空`);
  return value.trim();
}

function mediaEntries(
  model: string,
  params: Record<string, unknown>
): TuziVideoMedia[] {
  const types = getTuziVideoMediaTypes(model).map((entry) => entry.value);
  return array(params.video_media, '参考素材').map((item) => {
    const entry = record(item, '参考素材');
    choice(entry.type, types, '素材角色');
    if (
      Object.keys(entry).some(
        (key) =>
          ![
            'type',
            'url',
            'mime_type',
            'id',
            'element_id',
            'voice_id',
            'duration',
          ].includes(key)
      )
    ) {
      throw new Error('参考素材包含未知字段');
    }
    if (
      entry.duration !== undefined &&
      (typeof entry.duration !== 'number' ||
        !Number.isFinite(entry.duration) ||
        entry.duration <= 0)
    ) {
      throw new Error('输入视频时长必须为正数');
    }
    return entry as unknown as TuziVideoMedia;
  });
}

async function imageInput(
  value: unknown,
  model: string,
  resolve?: TuziMediaResolver
): Promise<string> {
  const image = await resolveTuziVideoMedia(value, resolve);
  if (isPublicVideoMediaUrl(image)) return image;
  const { mime, data, bytes } = parseVideoMediaData(image);
  const allowed =
    model === 'kling-4.0'
      ? ['image/png', 'image/jpeg']
      : model === 'wan3.0-video'
      ? ['image/png', 'image/jpeg', 'image/webp', 'image/bmp']
      : ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowed.includes(mime)) throw new Error(`${model} 不支持该参考图片格式`);
  if (bytes.length > (model === 'kling-4.0' ? 30 : 20) * 1024 * 1024)
    throw new Error('参考图片大小超限');
  if (model.startsWith('happyhorse-1.1-'))
    validateHappyHorseImage(bytes, mime, model.endsWith('-i2v'));
  return `data:${mime};base64,${data}`;
}

async function omniInput(
  prompt: string,
  references: string[],
  media: TuziVideoMedia[],
  params: Record<string, unknown>,
  resolve?: TuziMediaResolver
): Promise<Record<string, unknown>> {
  const explicit = array(params.input, 'Gemini 多模态输入');
  if (explicit.length && (references.length || media.length))
    throw new Error('Gemini input 与参考素材不能重复指定');
  const parts: Record<string, unknown>[] = [];
  if (prompt.trim()) parts.push({ type: 'text', text: prompt });
  const entries: Record<string, unknown>[] = explicit.length
    ? explicit.map((item) => record(item, 'Gemini input'))
    : [
        ...references.map((value) => ({ type: 'image', uri: value })),
        ...media.map((entry) => ({
          type: entry.type,
          uri: entry.url,
          mime_type: entry.mime_type,
        })),
      ];
  if (!entries.length) {
    if (!prompt.trim()) throw new Error('Gemini 需要提示词或参考素材');
    return { prompt };
  }
  if (explicit.length && prompt.trim())
    throw new Error('Gemini prompt 与 input 二选一，请将文本放入 input');
  let mediaCount = 0;
  for (const entry of entries) {
    if (entry.type === 'text') {
      if (
        typeof entry.text !== 'string' ||
        !entry.text.trim() ||
        Object.keys(entry).some((key) => !['type', 'text'].includes(key))
      )
        throw new Error('Gemini 文本输入无效');
      parts.push({ type: 'text', text: entry.text });
      continue;
    }
    const type = choice(entry.type, ['image', 'video'], 'Gemini 媒体类型');
    if (
      Object.keys(entry).some(
        (key) => !['type', 'mime_type', 'uri', 'data'].includes(key)
      )
    )
      throw new Error('Gemini 媒体包含未知字段');
    if ((entry.uri !== undefined) === (entry.data !== undefined))
      throw new Error('Gemini 媒体需要且只能指定 uri 或 data');
    let value: string;
    if (entry.data !== undefined) {
      if (
        typeof entry.data !== 'string' ||
        entry.data.startsWith('data:') ||
        typeof entry.mime_type !== 'string'
      )
        throw new Error('Gemini data 必须是带 MIME 的原始 Base64');
      value = `data:${entry.mime_type};base64,${entry.data}`;
    } else value = await resolveTuziVideoMedia(entry.uri, resolve);
    const remote = isPublicVideoMediaUrl(value);
    const local = remote
      ? null
      : parseVideoMediaData(value, optionalText(entry.mime_type, 'MIME 类型'));
    const mime =
      optionalText(entry.mime_type, 'MIME 类型') ||
      local?.mime ||
      mediaMimeFromUrl(value);
    const allowed =
      type === 'image'
        ? ['image/png', 'image/jpeg', 'image/webp']
        : ['video/mp4', 'video/quicktime', 'video/webm'];
    if (!mime || !allowed.includes(mime) || (local && local.mime !== mime))
      throw new Error('请为 Gemini 素材选择正确的 MIME 类型');
    if (local && local.bytes.length > 20 * 1024 * 1024)
      throw new Error('Gemini 本地素材最多 20 MB，请改用公网 URL');
    if (local) parts.push({ type, mime_type: mime, data: local.data });
    else parts.push({ type, mime_type: mime, uri: value });
    mediaCount++;
  }
  if (mediaCount > 10) throw new Error('Gemini 最多支持 10 个参考素材');
  // Preserve the small, documented single public-image request for existing callers.
  if (
    !explicit.length &&
    media.length === 0 &&
    references.length === 1 &&
    prompt.trim() &&
    isPublicVideoMediaUrl(references[0]) &&
    mediaMimeFromUrl(references[0])?.startsWith('image/')
  ) {
    return { prompt, input_reference: references[0] };
  }
  return { input: parts };
}

async function klingContents(
  prompt: string,
  references: string[],
  media: TuziVideoMedia[],
  params: Record<string, unknown>,
  resolve?: TuziMediaResolver
) {
  const explicit = array(params.contents, 'Kling contents');
  if (explicit.length && (references.length || media.length))
    throw new Error('Kling contents 与参考素材不能重复指定');
  if (explicit.length && prompt.trim())
    throw new Error('Kling prompt 与 contents 二选一');
  const source = explicit.length
    ? explicit.map((item) => record(item, 'Kling contents'))
    : [
        ...(prompt.trim() ? [{ type: 'prompt', text: prompt }] : []),
        ...references.map((value, index) => ({
          type: 'refer_image',
          url: value,
          id: `image_${index + 1}`,
        })),
        ...media.map((entry, index) => ({
          ...entry,
          id: entry.id || `media_${index + 1}`,
        })),
      ];
  const counts: Record<string, number> = {};
  const ids = new Set<string>();
  let images = 0,
    videos = 0,
    assets = 0,
    knownDuration = 0;
  const contents: Record<string, unknown>[] = [];
  for (const item of source) {
    const entry = record(item, 'Kling 素材');
    const type = choice(
      entry.type,
      [
        'prompt',
        ...getTuziVideoMediaTypes('kling-4.0').map((item) => item.value),
      ],
      'Kling 素材类型'
    );
    if (
      Object.keys(entry).some(
        (key) =>
          ![
            'type',
            'text',
            'url',
            'id',
            'element_id',
            'voice_id',
            'duration',
            'mime_type',
          ].includes(key)
      )
    )
      throw new Error('Kling 素材包含未知字段');
    counts[type] = (counts[type] || 0) + 1;
    const id = optionalText(entry.id, '素材 ID');
    if (id && ids.has(id)) throw new Error('Kling 素材 ID 必须唯一');
    if (id) ids.add(id);
    if (type === 'prompt') {
      const text = optionalText(entry.text, 'Kling 提示词');
      if (!text) throw new Error('Kling 提示词不能为空');
      contents.push({ type, text });
      continue;
    }
    const content: Record<string, unknown> = { type, ...(id ? { id } : {}) };
    if (
      ['first_frame', 'middle_frame', 'last_frame', 'refer_image'].includes(
        type
      )
    ) {
      content.url = await imageInput(entry.url, 'kling-4.0', resolve);
      images++;
    } else if (['feature_video', 'base_video'].includes(type)) {
      content.url = url(entry.url, 'Kling 视频');
      if (entry.duration !== undefined) {
        if (
          typeof entry.duration !== 'number' ||
          !Number.isFinite(entry.duration) ||
          entry.duration <= 0
        )
          throw new Error('输入视频时长必须为正数');
        knownDuration += entry.duration;
      }
      videos++;
    } else {
      const field = type === 'element' ? 'element_id' : 'voice_id';
      const value = optionalText(entry[field], field);
      if (!id || !value)
        throw new Error(
          `${type} 需要素材 ID 和${type === 'element' ? '主体' : '音色'} ID`
        );
      content[field] = value;
    }
    contents.push(content);
    assets++;
  }
  if (!counts.prompt) throw new Error('Kling 需要提示词');
  const textLength = contents
    .filter((item) => item.type === 'prompt')
    .reduce(
      (length, item) =>
        length +
        [...String(item.text)].reduce(
          (sum, char) =>
            sum + ((char.codePointAt(0) || 0) <= 127 ? 11000 : 26000),
          0
        ),
      0
    );
  if (textLength > 26000 * 11000) throw new Error('Kling 提示词长度超限');
  if (
    images > 10 ||
    videos > 5 ||
    counts.base_video > 1 ||
    counts.element > 7 ||
    counts.voice > 3 ||
    assets > 15 ||
    knownDuration > 30
  )
    throw new Error('Kling 素材数量或输入视频总时长超限');
  for (const type of ['middle_frame', 'refer_image']) {
    if (
      counts[type] > 1 &&
      contents.some((item) => item.type === type && !item.id)
    )
      throw new Error('多张中间帧或参考图需要唯一素材 ID');
  }
  return contents;
}

/** Single native contract used by main-thread, worker and model adapters. */
export async function buildTuziVideoRequest(
  request: TuziVideoRequest,
  resolve?: TuziMediaResolver
): Promise<Record<string, unknown> | null> {
  const config = getTuziVideoModelConfig(request.model);
  if (!config) return null;
  const { model } = request;
  const params = normalizeTuziVideoParams<Record<string, unknown>>(model, {
    ...request.params,
    size: request.size || request.params?.size || config.defaultSize,
  });
  const wan = model === 'wan3.0-video';
  const omni = model === 'gemini-omni-1.2-flash';
  const durationValue =
    request.duration ?? params.duration ?? config.defaultDuration;
  const duration =
    wan && (durationValue === -1 || durationValue === '-1')
      ? -1
      : integer(
          durationValue,
          Number(config.durationOptions[0].value),
          Number(
            config.durationOptions[config.durationOptions.length - 1].value
          ),
          `${model} 视频时长`
        );
  const size = String(params.size);
  if (!config.sizeOptions.some((option) => option.value === size))
    throw new Error(`${model} 不支持视频尺寸 ${size}`);
  const media = mediaEntries(model, params);
  if (request.prompt !== undefined && typeof request.prompt !== 'string')
    throw new Error('提示词必须是文本');
  const prompt = request.prompt ?? '';
  let references: string[] = request.referenceImages || [];
  const hh = config.provider === 'happyhorse';
  const i2v = hh && model.endsWith('-i2v');
  const r2v = hh && model.endsWith('-r2v');
  if (!references.length) {
    const input = i2v
      ? params.image
      : r2v
      ? params.images
      : params.input_reference;
    if (input !== undefined && input !== '')
      references = Array.isArray(input) ? input : [input as string];
  }
  if (
    !i2v &&
    !omni &&
    !prompt.trim() &&
    !(model === 'kling-4.0' && params.contents)
  )
    throw new Error(`${model} 需要提示词`);
  if (omni) {
    const ratio = choice(
      params.ratio ?? '16:9',
      ['16:9', '9:16'],
      'Gemini 比例'
    );
    const task = choice(
      params.video_task ?? 'auto',
      [
        'auto',
        'text_to_video',
        'image_to_video',
        'reference_to_video',
        'edit',
        'extend',
      ],
      'Gemini 动作'
    );
    const previous = optionalText(params.previous_interaction_id, '前序任务');
    if (previous && !/^task_[^/\\?#\s]{1,507}$/.test(previous))
      throw new Error('前序任务必须是本站返回的 task_ 任务 ID');
    if (['edit', 'extend'].includes(task) && !previous)
      throw new Error('编辑或延展需要已完成的本站前序任务');
    if (previous && !['edit', 'extend'].includes(task))
      throw new Error('前序任务只能用于编辑或延展');
    if (task === 'extend' && duration > 10)
      throw new Error('Gemini 每次延展最多 10 秒');
    const input = await omniInput(prompt, references, media, params, resolve);
    return {
      model,
      ...input,
      seconds: String(duration),
      size: OMNI_VIDEO_SIZES[size][ratio === '9:16' ? 1 : 0],
      ...(task !== 'auto'
        ? { generation_config: { video_config: { task } } }
        : {}),
      ...(previous ? { previous_interaction_id: previous } : {}),
    };
  }
  if (model === 'kling-4.0') {
    const ratio = choice(
      params.ratio ?? 'adaptive',
      KLING_4_RATIO_OPTIONS,
      'Kling 4.0 比例'
    );
    return {
      model,
      contents: await klingContents(prompt, references, media, params, resolve),
      settings: { duration, resolution: size, aspect_ratio: ratio },
      ...(params.watermark !== undefined && params.watermark !== ''
        ? {
            options: {
              watermark_info: {
                enabled: boolean(params.watermark, 'watermark'),
              },
            },
          }
        : {}),
    };
  }
  const body: Record<string, unknown> = { model, prompt };
  if (hh) {
    if (media.length) throw new Error('HappyHorse 请使用参考图片输入');
    if (references.length > config.imageUpload.maxCount)
      throw new Error(
        `${model} 最多支持 ${config.imageUpload.maxCount} 张参考图`
      );
    if (config.imageUpload.required && !references.length)
      throw new Error(`${model} 需要参考图片`);
    const images = await Promise.all(
      references.map((value) => imageInput(value, model, resolve))
    );
    const parameters: Record<string, unknown> = {
      duration,
      resolution: size,
      watermark: boolean(params.watermark ?? false, 'watermark'),
    };
    if (params.seed !== undefined && params.seed !== '')
      parameters.seed = integer(params.seed, 0, 2147483647, 'seed');
    if (!i2v)
      parameters.ratio = choice(
        params.ratio ?? '16:9',
        ['16:9', '9:16', '1:1', '4:3', '3:4'],
        'HappyHorse 比例'
      );
    return {
      ...body,
      parameters,
      ...(i2v ? { image: images[0] } : r2v ? { images } : {}),
    };
  }
  const mode = choice(
    params.reference_mode ?? 'frames',
    ['frames', 'mixed'],
    'Wan 参考模式'
  );
  const raw: Record<string, unknown[]> = {
    reference_images: array(params.reference_images, 'Wan 参考图'),
    reference_videos: array(params.reference_videos, 'Wan 参考视频'),
    reference_audio: array(params.reference_audio, 'Wan 参考音频'),
  };
  if (references.length) {
    if (mode === 'mixed') raw.reference_images.push(...references);
    else {
      if (references.length > 2) throw new Error('Wan 首尾帧最多两张图片');
      if (params.first_frame || params.last_frame)
        throw new Error('首尾帧输入不能重复指定');
      body.first_frame = references[0];
      if (references[1]) body.last_frame = references[1];
    }
  }
  for (const key of ['first_frame', 'last_frame'])
    if (params[key] !== undefined) body[key] = params[key];
  for (const entry of media) {
    if (entry.type === 'first_frame' || entry.type === 'last_frame') {
      if (body[entry.type] !== undefined)
        throw new Error('首尾帧输入不能重复指定');
      body[entry.type] = entry.url;
    } else raw[entry.type].push(entry.url);
  }
  if (body.last_frame !== undefined && body.first_frame === undefined)
    throw new Error('尾帧需要同时提供首帧');
  const hasFrames =
    body.first_frame !== undefined || body.last_frame !== undefined;
  if (
    hasFrames &&
    (mode === 'mixed' ||
      Object.values(raw).some((items) => items.length) ||
      params.file ||
      params.link)
  )
    throw new Error('首尾帧与混合参考素材、文档及网页不能混用');
  if (
    mode === 'frames' &&
    Object.values(raw).some((items) => items.length) &&
    params.reference_mode !== undefined
  )
    throw new Error('请切换到混合参考模式');
  for (const [key, values] of Object.entries(raw)) {
    if (values.length > (key === 'reference_images' ? 10 : 5))
      throw new Error('Wan 参考素材数量超限');
    if (values.length)
      body[key] =
        key === 'reference_images'
          ? await Promise.all(
              values.map((value) => imageInput(value, model, resolve))
            )
          : values.map((value) => url(value, key));
  }
  for (const key of ['first_frame', 'last_frame'])
    if (body[key] !== undefined)
      body[key] = await imageInput(body[key], model, resolve);
  Object.assign(body, {
    duration,
    resolution: size,
    ratio: choice(
      params.ratio ?? 'adaptive',
      ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      'Wan 比例'
    ),
  });
  for (const key of ['watermark', 'audio', 'prompt_extend'])
    if (params[key] !== undefined && params[key] !== '')
      body[key] = boolean(params[key], key);
  if (params.seed !== undefined && params.seed !== '')
    body.seed = integer(params.seed, -1, 2147483647, 'seed');
  for (const key of ['file', 'link'])
    if (params[key] !== undefined && params[key] !== '')
      body[key] = url(params[key], key);
  if (body.file && body.link) throw new Error('文档与网页只能选择一项');
  if ((body.file || body.link) && body.prompt_extend === false)
    throw new Error('文档或网页输入需要开启提示词改写');
  const inputDuration = media
    .filter((item) => item.type === 'reference_videos')
    .reduce((sum, item) => sum + (item.duration ?? 1), 0);
  if (
    duration !== -1 &&
    raw.reference_videos.length &&
    duration + Math.max(raw.reference_videos.length, inputDuration) > 30
  )
    throw new Error('Wan 输入视频与输出总时长最多 30 秒');
  return body;
}
