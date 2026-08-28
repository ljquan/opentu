import type { ModelRef } from '../../utils/settings-types';
import {
  listSettingsProviderProfiles,
  planInvocationFromSettings,
} from '../provider-routing/settings-repository';
import type {
  InvocationPlan,
  NormalizedModelRef,
  ProviderBaseUrlStrategy,
  ProviderModelBinding,
  ProviderPptExplainerBindingMetadata,
  ProviderPptExplainerPresentationInput,
  ProviderPptExplainerPresenterMode,
  ProviderPptExplainerSourceKind,
  ProviderProfileSnapshot,
  ResolvedProviderContext,
} from '../provider-routing/types';

export const PPT_EXPLAINER_PROVIDER_PROTOCOL = 'tuzi.ppt-explainer' as const;
export const PPT_EXPLAINER_REQUEST_SCHEMA =
  'tuzi.ppt-explainer.multipart-v1' as const;
export const PPT_EXPLAINER_RESPONSE_SCHEMA =
  'tuzi.ppt-explainer.task-v1' as const;
export const PPT_EXPLAINER_ROUTE_SCHEMA_VERSION = 2 as const;

const DEFAULT_IDEMPOTENCY_HEADER = 'Idempotency-Key';
const MAX_URL_DECODE_ROUNDS = 16;
const HTTP_HEADER_TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const REMOTE_ID_TEMPLATE_RE = /\{(?:remoteId|taskId)\}/;
const SENSITIVE_QUERY_KEY_RE =
  /^(?:api[-_]?key|access[-_]?token|authorization|auth|key|secret|signature)$/i;
const SENSITIVE_HEADER_NAME_RE =
  /(?:api[-_.\s]?key|authorization|proxy[-_.\s]?authorization|access[-_.\s]?token|refresh[-_.\s]?token|token|secret|cookie|credential|password|passwd|signature)/i;
const FORBIDDEN_IDEMPOTENCY_HEADER_RE =
  /^(?:authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie)$/i;

const SOURCE_KINDS = new Set<ProviderPptExplainerSourceKind>([
  'topic',
  'current_ppt',
  'pptx',
]);
const PRESENTATION_INPUTS = new Set<ProviderPptExplainerPresentationInput>([
  'pptx',
  'slide_images',
]);
const PRESENTER_MODES = new Set<ProviderPptExplainerPresenterMode>([
  'single_voice',
  'dual_voice',
  'single_avatar',
  'dual_avatar',
]);

export type PptExplainerProviderPreflightErrorCode =
  | 'binding_unavailable'
  | 'invalid_binding'
  | 'missing_credentials'
  | 'capability_unsupported'
  | 'route_unavailable';

export class PptExplainerProviderPreflightError extends Error {
  constructor(
    readonly code: PptExplainerProviderPreflightErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PptExplainerProviderPreflightError';
  }
}

export interface PptExplainerProviderRequirements {
  source: ProviderPptExplainerSourceKind;
  presentationInput: ProviderPptExplainerPresentationInput;
  presenterMode: ProviderPptExplainerPresenterMode;
  requiresReferenceAudio?: boolean;
}

export interface PptExplainerProviderBinding extends ProviderModelBinding {
  operation: 'video';
  protocol: typeof PPT_EXPLAINER_PROVIDER_PROTOCOL;
  requestSchema: typeof PPT_EXPLAINER_REQUEST_SCHEMA;
  responseSchema: typeof PPT_EXPLAINER_RESPONSE_SCHEMA;
  pollPathTemplate: string;
  metadata: NonNullable<ProviderModelBinding['metadata']> & {
    pptExplainer: ProviderPptExplainerBindingMetadata;
  };
}

export interface PptExplainerProviderPreflightResult {
  provider: ResolvedProviderContext;
  modelRef: NormalizedModelRef;
  binding: PptExplainerProviderBinding;
  requirements: PptExplainerProviderRequirements;
}

export interface PptExplainerProviderRouteSnapshot {
  schemaVersion: typeof PPT_EXPLAINER_ROUTE_SCHEMA_VERSION;
  operation: 'video';
  providerProfileId: string;
  canonicalBaseUrl: string;
  modelRef: NormalizedModelRef;
  binding: {
    id: string;
    protocol: typeof PPT_EXPLAINER_PROVIDER_PROTOCOL;
    requestSchema: typeof PPT_EXPLAINER_REQUEST_SCHEMA;
    responseSchema: typeof PPT_EXPLAINER_RESPONSE_SCHEMA;
    submitPath: string;
    pollPathTemplate: string;
    baseUrlStrategy?: ProviderBaseUrlStrategy;
    pptExplainer: ProviderPptExplainerBindingMetadata;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      `PPT 讲解视频 binding 缺少${label}`
    );
  }
  return value.trim();
}

function assertAllowedStringArray<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string
): asserts value is T[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || !allowed.has(item as T))
  ) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      `PPT 讲解视频 binding 的${label}无效`
    );
  }
}

function assertResponsePath(value: unknown, label: string): void {
  requireNonEmptyString(value, `${label}字段映射`);
}

function assertEndpointTemplate(
  value: unknown,
  label: string,
  requireRemoteId: boolean
): string {
  const endpoint = requireNonEmptyString(value, label);
  if (/\r|\n|\0/.test(endpoint)) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      `PPT 讲解视频 binding 的${label}包含非法字符`
    );
  }
  if (requireRemoteId && !REMOTE_ID_TEMPLATE_RE.test(endpoint)) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      `PPT 讲解视频 binding 的${label}必须包含 {remoteId} 或 {taskId}`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint, 'https://opentu.invalid');
  } catch {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      `PPT 讲解视频 binding 的${label}不是有效路径`
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hash) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      `PPT 讲解视频 binding 的${label}仅允许 HTTP(S) 路径且不能包含片段`
    );
  }
  if (parsed.username || parsed.password) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      `PPT 讲解视频 binding 的${label}不得包含凭据`
    );
  }
  for (const key of parsed.searchParams.keys()) {
    const decodedKey = collectUrlDecodedVariants(key);
    if (
      decodedKey.exceededLimit ||
      decodedKey.values.some((candidate) =>
        SENSITIVE_QUERY_KEY_RE.test(candidate)
      )
    ) {
      throw new PptExplainerProviderPreflightError(
        'invalid_binding',
        `PPT 讲解视频 binding 的${label}不得内嵌鉴权参数`
      );
    }
  }
  return endpoint;
}

function collectUrlDecodedVariants(value: string): {
  values: string[];
  exceededLimit: boolean;
} {
  const values = [value];
  let current = value;
  for (let round = 0; round < MAX_URL_DECODE_ROUNDS; round += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return { values, exceededLimit: false };
    }
    if (decoded === current) return { values, exceededLimit: false };
    values.push(decoded);
    current = decoded;
  }

  try {
    return {
      values,
      exceededLimit: decodeURIComponent(current) !== current,
    };
  } catch {
    return { values, exceededLimit: false };
  }
}

function canonicalizeProviderBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PptExplainerProviderPreflightError(
      'route_unavailable',
      'PPT 讲解视频供应商 Base URL 未配置'
    );
  }
  const baseUrl = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new PptExplainerProviderPreflightError(
      'route_unavailable',
      'PPT 讲解视频供应商 Base URL 无效'
    );
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new PptExplainerProviderPreflightError(
      'route_unavailable',
      'PPT 讲解视频供应商 Base URL 必须是无凭据、查询参数和片段的 HTTP(S) 地址'
    );
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
}

function collectProviderCredentialValues(
  provider: ResolvedProviderContext
): string[] {
  const values = new Set<string>();
  const addValue = (value: string | undefined): void => {
    const normalized = value?.trim();
    if (!normalized) return;
    collectUrlDecodedVariants(normalized).values.forEach((candidate) =>
      values.add(candidate)
    );
  };

  addValue(provider.apiKey);
  for (const [name, value] of Object.entries(provider.extraHeaders || {})) {
    if (!SENSITIVE_HEADER_NAME_RE.test(name)) continue;
    addValue(value);
    const authorizationValue = value.match(
      /^\s*(?:bearer|basic)\s+(.+)$/i
    )?.[1];
    addValue(authorizationValue);
  }
  return [...values].filter(Boolean);
}

function getSafeCanonicalProviderBaseUrl(
  provider: ResolvedProviderContext
): string {
  const canonicalBaseUrl = canonicalizeProviderBaseUrl(provider.baseUrl);
  const decodedBaseUrl = collectUrlDecodedVariants(canonicalBaseUrl);
  if (
    decodedBaseUrl.exceededLimit ||
    collectProviderCredentialValues(provider).some((credential) =>
      decodedBaseUrl.values.some((value) => value.includes(credential))
    )
  ) {
    throw new PptExplainerProviderPreflightError(
      'route_unavailable',
      'PPT 讲解视频供应商 Base URL 不得包含供应商凭据'
    );
  }
  return canonicalBaseUrl;
}

function assertEndpointProviderBoundary(
  endpoint: string,
  label: string,
  provider: ResolvedProviderContext
): void {
  let baseUrl: URL;
  let resolvedEndpoint: URL;
  try {
    baseUrl = new URL(provider.baseUrl);
    resolvedEndpoint = new URL(endpoint, baseUrl);
  } catch {
    throw new PptExplainerProviderPreflightError(
      'route_unavailable',
      'PPT 讲解视频供应商 Base URL 无效'
    );
  }

  if (
    (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') ||
    baseUrl.username ||
    baseUrl.password
  ) {
    throw new PptExplainerProviderPreflightError(
      'route_unavailable',
      'PPT 讲解视频供应商 Base URL 必须是无凭据的 HTTP(S) 地址'
    );
  }
  if (resolvedEndpoint.origin !== baseUrl.origin) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      `PPT 讲解视频 binding 的${label}不得跨越供应商 Base URL`
    );
  }

  const decodedEndpoint = collectUrlDecodedVariants(endpoint);
  if (decodedEndpoint.exceededLimit) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      `PPT 讲解视频 binding 的${label}URL 编码层级过深`
    );
  }
  const endpointValues = new Set(decodedEndpoint.values);
  const containsCredential = collectProviderCredentialValues(provider).some(
    (credential) =>
      [...endpointValues].some((value) => value.includes(credential))
  );
  if (containsCredential) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      `PPT 讲解视频 binding 的${label}不得包含供应商凭据`
    );
  }
}

function assertProviderEndpointBoundaries(
  binding: PptExplainerProviderBinding,
  provider: ResolvedProviderContext
): void {
  const endpoints: Array<[string, string, boolean]> = [
    [binding.submitPath, '提交路径', false],
    [binding.pollPathTemplate, '查询路径', true],
  ];
  const cancelPath = binding.metadata.pptExplainer.cancel?.pathTemplate;
  if (cancelPath) endpoints.push([cancelPath, '取消路径', true]);

  for (const [value, label, requireRemoteId] of endpoints) {
    const endpoint = assertEndpointTemplate(value, label, requireRemoteId);
    assertEndpointProviderBoundary(endpoint, label, provider);
  }
}

export function assertPptExplainerProviderRouteIsSafe(
  result: PptExplainerProviderPreflightResult
): void {
  getSafeCanonicalProviderBaseUrl(result.provider);
  assertPptExplainerBinding(result.binding);
  assertProviderEndpointBoundaries(result.binding, result.provider);
}

function normalizeIdempotencyHeader(value: unknown): string {
  const header =
    typeof value === 'string' && value.trim()
      ? value.trim()
      : DEFAULT_IDEMPOTENCY_HEADER;
  if (
    !HTTP_HEADER_TOKEN_RE.test(header) ||
    FORBIDDEN_IDEMPOTENCY_HEADER_RE.test(header)
  ) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      'PPT 讲解视频 binding 的幂等请求头无效'
    );
  }
  return header;
}

function assertStatusMapping(value: unknown): void {
  if (!isRecord(value)) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      'PPT 讲解视频 binding 缺少状态映射'
    );
  }

  const groups = ['queued', 'processing', 'completed', 'failed'] as const;
  const seen = new Set<string>();
  for (const group of [...groups, 'cancelled'] as const) {
    const entries = value[group];
    if (group === 'cancelled' && entries === undefined) continue;
    if (
      !Array.isArray(entries) ||
      (groups.includes(group as (typeof groups)[number]) &&
        entries.length === 0) ||
      entries.some((entry) => typeof entry !== 'string' || !entry.trim())
    ) {
      throw new PptExplainerProviderPreflightError(
        'invalid_binding',
        `PPT 讲解视频 binding 的 ${group} 状态映射无效`
      );
    }
    for (const entry of entries) {
      const normalized = entry.trim().toLowerCase();
      if (seen.has(normalized)) {
        throw new PptExplainerProviderPreflightError(
          'invalid_binding',
          `PPT 讲解视频 binding 的状态值重复：${entry}`
        );
      }
      seen.add(normalized);
    }
  }
}

function assertPptExplainerMetadata(
  value: unknown
): asserts value is ProviderPptExplainerBindingMetadata {
  if (!isRecord(value)) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      'PPT 讲解视频 binding 缺少显式能力元数据'
    );
  }
  const capabilities = value.capabilities;
  if (!isRecord(capabilities)) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      'PPT 讲解视频 binding 缺少能力声明'
    );
  }
  assertAllowedStringArray(capabilities.sources, SOURCE_KINDS, '来源能力');
  assertAllowedStringArray(
    capabilities.presentationInputs,
    PRESENTATION_INPUTS,
    '演示输入能力'
  );
  assertAllowedStringArray(
    capabilities.presenterModes,
    PRESENTER_MODES,
    '讲解模式能力'
  );
  if (capabilities.finalComposition !== true) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      'PPT 讲解视频 binding 必须显式声明最终成片能力'
    );
  }
  if (capabilities.referenceAudioVoiceCloning === true) {
    const referenceAudio = value.referenceAudio;
    if (!isRecord(referenceAudio)) {
      throw new PptExplainerProviderPreflightError(
        'invalid_binding',
        'PPT 讲解视频 binding 声明了参考音频能力但缺少 multipart 字段映射'
      );
    }
    const fieldName = requireNonEmptyString(
      referenceAudio.fieldName,
      '参考音频 multipart 字段名'
    );
    if (!/^[A-Za-z][A-Za-z0-9_.-]*(?:\[\])?$/.test(fieldName)) {
      throw new PptExplainerProviderPreflightError(
        'invalid_binding',
        '参考音频 multipart 字段名包含非法字符'
      );
    }
    if (referenceAudio.acceptedMimeTypes !== undefined) {
      if (
        !Array.isArray(referenceAudio.acceptedMimeTypes) ||
        referenceAudio.acceptedMimeTypes.some(
          (item) => typeof item !== 'string' || !item.trim()
        )
      ) {
        throw new PptExplainerProviderPreflightError(
          'invalid_binding',
          '参考音频支持的 MIME 类型声明无效'
        );
      }
    }
  }

  const responsePaths = value.responsePaths;
  if (!isRecord(responsePaths)) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      'PPT 讲解视频 binding 缺少响应字段映射'
    );
  }
  const submit = responsePaths.submit;
  const poll = responsePaths.poll;
  if (!isRecord(submit) || !isRecord(poll)) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      'PPT 讲解视频 binding 缺少 submit 或 poll 字段映射'
    );
  }
  assertResponsePath(submit.remoteId, 'submit.remoteId');
  assertResponsePath(poll.status, 'poll.status');
  assertResponsePath(poll.finalVideoUrl, 'poll.finalVideoUrl');
  for (const [scope, paths] of Object.entries(responsePaths)) {
    if (!isRecord(paths)) {
      throw new PptExplainerProviderPreflightError(
        'invalid_binding',
        `PPT 讲解视频 binding 的 ${scope} 字段映射无效`
      );
    }
    for (const [key, path] of Object.entries(paths)) {
      if (path !== undefined) assertResponsePath(path, `${scope}.${key}`);
    }
  }

  assertStatusMapping(value.statusMapping);
  if (
    value.progressScale !== undefined &&
    value.progressScale !== 'percent' &&
    value.progressScale !== 'ratio'
  ) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      'PPT 讲解视频 binding 的进度刻度无效'
    );
  }
  normalizeIdempotencyHeader(value.idempotencyHeader);

  if (value.cancel !== undefined) {
    if (!isRecord(value.cancel)) {
      throw new PptExplainerProviderPreflightError(
        'invalid_binding',
        'PPT 讲解视频 binding 的取消契约无效'
      );
    }
    assertEndpointTemplate(value.cancel.pathTemplate, '取消路径', true);
    if (value.cancel.method !== 'DELETE' && value.cancel.method !== 'POST') {
      throw new PptExplainerProviderPreflightError(
        'invalid_binding',
        'PPT 讲解视频 binding 的取消方法仅支持 DELETE 或 POST'
      );
    }
  }
}

function clonePptExplainerMetadata(
  metadata: ProviderPptExplainerBindingMetadata
): ProviderPptExplainerBindingMetadata {
  return {
    capabilities: {
      sources: [...metadata.capabilities.sources],
      presentationInputs: [...metadata.capabilities.presentationInputs],
      presenterModes: [...metadata.capabilities.presenterModes],
      finalComposition: true,
      ...(metadata.capabilities.referenceAudioVoiceCloning === true
        ? { referenceAudioVoiceCloning: true }
        : {}),
    },
    ...(metadata.referenceAudio
      ? {
          referenceAudio: {
            fieldName: metadata.referenceAudio.fieldName,
            ...(metadata.referenceAudio.acceptedMimeTypes
              ? {
                  acceptedMimeTypes: [
                    ...metadata.referenceAudio.acceptedMimeTypes,
                  ],
                }
              : {}),
          },
        }
      : {}),
    responsePaths: {
      submit: { ...metadata.responsePaths.submit },
      poll: { ...metadata.responsePaths.poll },
      ...(metadata.responsePaths.cancel
        ? { cancel: { ...metadata.responsePaths.cancel } }
        : {}),
    },
    statusMapping: {
      queued: [...metadata.statusMapping.queued],
      processing: [...metadata.statusMapping.processing],
      completed: [...metadata.statusMapping.completed],
      failed: [...metadata.statusMapping.failed],
      ...(metadata.statusMapping.cancelled
        ? { cancelled: [...metadata.statusMapping.cancelled] }
        : {}),
    },
    ...(metadata.progressScale
      ? { progressScale: metadata.progressScale }
      : {}),
    idempotencyHeader: normalizeIdempotencyHeader(metadata.idempotencyHeader),
    ...(metadata.cancel
      ? {
          cancel: {
            pathTemplate: metadata.cancel.pathTemplate,
            method: metadata.cancel.method,
          },
        }
      : {}),
  };
}

function assertPptExplainerBinding(
  binding: ProviderModelBinding
): asserts binding is PptExplainerProviderBinding {
  if (
    binding.operation !== 'video' ||
    binding.protocol !== PPT_EXPLAINER_PROVIDER_PROTOCOL ||
    binding.requestSchema !== PPT_EXPLAINER_REQUEST_SCHEMA ||
    binding.responseSchema !== PPT_EXPLAINER_RESPONSE_SCHEMA
  ) {
    throw new PptExplainerProviderPreflightError(
      'invalid_binding',
      '所选 binding 不是受支持的 PPT 讲解视频 v1 契约'
    );
  }
  assertEndpointTemplate(binding.submitPath, '提交路径', false);
  assertEndpointTemplate(binding.pollPathTemplate, '查询路径', true);
  assertPptExplainerMetadata(binding.metadata?.pptExplainer);
}

function assertCapabilities(
  metadata: ProviderPptExplainerBindingMetadata,
  requirements: PptExplainerProviderRequirements
): void {
  if (!metadata.capabilities.sources.includes(requirements.source)) {
    throw new PptExplainerProviderPreflightError(
      'capability_unsupported',
      `所选供应商不支持 ${requirements.source} 演示来源`
    );
  }
  if (
    !metadata.capabilities.presentationInputs.includes(
      requirements.presentationInput
    )
  ) {
    throw new PptExplainerProviderPreflightError(
      'capability_unsupported',
      `所选供应商不支持 ${requirements.presentationInput} 演示输入`
    );
  }
  if (
    !metadata.capabilities.presenterModes.includes(requirements.presenterMode)
  ) {
    throw new PptExplainerProviderPreflightError(
      'capability_unsupported',
      `所选供应商不支持 ${requirements.presenterMode} 讲解模式`
    );
  }
  if (requirements.requiresReferenceAudio) {
    if (metadata.capabilities.referenceAudioVoiceCloning !== true) {
      throw new PptExplainerProviderPreflightError(
        'capability_unsupported',
        '所选供应商未声明参考音频声线克隆能力'
      );
    }
    if (!metadata.referenceAudio?.fieldName) {
      throw new PptExplainerProviderPreflightError(
        'capability_unsupported',
        '所选供应商未声明参考音频 multipart 字段'
      );
    }
  }
}

export function preflightPptExplainerProvider(
  plan: InvocationPlan,
  requirements: PptExplainerProviderRequirements
): PptExplainerProviderPreflightResult {
  getSafeCanonicalProviderBaseUrl(plan.provider);
  if (!plan.provider.apiKey.trim()) {
    throw new PptExplainerProviderPreflightError(
      'missing_credentials',
      'PPT 讲解视频供应商 API Key 未配置'
    );
  }
  assertPptExplainerBinding(plan.binding);
  assertProviderEndpointBoundaries(plan.binding, plan.provider);
  assertCapabilities(plan.binding.metadata.pptExplainer, requirements);

  return {
    provider: plan.provider,
    modelRef: plan.modelRef,
    binding: plan.binding,
    requirements: { ...requirements },
  };
}

export function preflightPptExplainerProviderFromSettings(
  modelRef: ModelRef,
  requirements: PptExplainerProviderRequirements,
  options: {
    bindingId?: string | null;
    includeLegacyProfile?: boolean;
  } = {}
): PptExplainerProviderPreflightResult {
  try {
    const plan = planInvocationFromSettings(
      {
        operation: 'video',
        modelRef,
        bindingId: options.bindingId,
        requiredProtocol: PPT_EXPLAINER_PROVIDER_PROTOCOL,
      },
      { includeLegacyProfile: options.includeLegacyProfile }
    );
    return preflightPptExplainerProvider(plan, requirements);
  } catch (error) {
    if (error instanceof PptExplainerProviderPreflightError) throw error;
    throw new PptExplainerProviderPreflightError(
      'binding_unavailable',
      '未配置可用的 PPT 讲解视频供应商 binding'
    );
  }
}

export function createPptExplainerProviderRouteSnapshot(
  result: PptExplainerProviderPreflightResult
): PptExplainerProviderRouteSnapshot {
  assertPptExplainerProviderRouteIsSafe(result);
  return {
    schemaVersion: PPT_EXPLAINER_ROUTE_SCHEMA_VERSION,
    operation: 'video',
    providerProfileId: result.provider.profileId,
    canonicalBaseUrl: getSafeCanonicalProviderBaseUrl(result.provider),
    modelRef: { ...result.modelRef },
    binding: {
      id: result.binding.id,
      protocol: PPT_EXPLAINER_PROVIDER_PROTOCOL,
      requestSchema: PPT_EXPLAINER_REQUEST_SCHEMA,
      responseSchema: PPT_EXPLAINER_RESPONSE_SCHEMA,
      submitPath: result.binding.submitPath,
      pollPathTemplate: result.binding.pollPathTemplate,
      baseUrlStrategy: result.binding.baseUrlStrategy,
      pptExplainer: clonePptExplainerMetadata(
        result.binding.metadata.pptExplainer
      ),
    },
  };
}

export function resolvePptExplainerProviderRouteSnapshot(
  snapshot: PptExplainerProviderRouteSnapshot,
  requirements: PptExplainerProviderRequirements,
  options: {
    profiles?: ProviderProfileSnapshot[];
    includeLegacyProfile?: boolean;
  } = {}
): PptExplainerProviderPreflightResult {
  if (snapshot.schemaVersion !== PPT_EXPLAINER_ROUTE_SCHEMA_VERSION) {
    throw new PptExplainerProviderPreflightError(
      'route_unavailable',
      'PPT 讲解视频原供应商路由快照版本过旧或不受支持，请重新创建任务'
    );
  }
  if (
    snapshot.operation !== 'video' ||
    snapshot.providerProfileId !== snapshot.modelRef.profileId
  ) {
    throw new PptExplainerProviderPreflightError(
      'route_unavailable',
      'PPT 讲解视频原供应商路由快照无效'
    );
  }

  const profiles =
    options.profiles ||
    listSettingsProviderProfiles({
      includeLegacyProfile: options.includeLegacyProfile,
    });
  const profile = profiles.find(
    (candidate) => candidate.id === snapshot.providerProfileId
  );
  if (!profile) {
    throw new PptExplainerProviderPreflightError(
      'route_unavailable',
      'PPT 讲解视频原供应商配置已删除或停用'
    );
  }

  const currentCanonicalBaseUrl = canonicalizeProviderBaseUrl(profile.baseUrl);
  if (
    snapshot.canonicalBaseUrl !==
      canonicalizeProviderBaseUrl(snapshot.canonicalBaseUrl) ||
    currentCanonicalBaseUrl !== snapshot.canonicalBaseUrl
  ) {
    throw new PptExplainerProviderPreflightError(
      'route_unavailable',
      'PPT 讲解视频原供应商 Base URL 已变更，无法恢复任务'
    );
  }

  const binding: ProviderModelBinding = {
    id: snapshot.binding.id,
    profileId: snapshot.providerProfileId,
    modelId: snapshot.modelRef.modelId,
    operation: 'video',
    protocol: snapshot.binding.protocol,
    requestSchema: snapshot.binding.requestSchema,
    responseSchema: snapshot.binding.responseSchema,
    submitPath: snapshot.binding.submitPath,
    pollPathTemplate: snapshot.binding.pollPathTemplate,
    baseUrlStrategy: snapshot.binding.baseUrlStrategy,
    priority: 1000,
    confidence: 'high',
    source: 'manual',
    metadata: {
      pptExplainer: clonePptExplainerMetadata(snapshot.binding.pptExplainer),
    },
  };
  return preflightPptExplainerProvider(
    {
      provider: {
        profileId: profile.id,
        profileName: profile.name,
        providerType: profile.providerType,
        baseUrl: snapshot.canonicalBaseUrl,
        apiKey: profile.apiKey,
        authType: profile.authType,
        extraHeaders: profile.extraHeaders,
      },
      modelRef: { ...snapshot.modelRef },
      binding,
    },
    requirements
  );
}

export function isPptExplainerProviderBinding(
  binding: ProviderModelBinding
): binding is PptExplainerProviderBinding {
  try {
    assertPptExplainerBinding(binding);
    return true;
  } catch {
    return false;
  }
}
