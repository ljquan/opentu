import type {
  Task,
  TaskInvocationBindingSnapshot,
  TaskInvocationOperation,
  TaskInvocationRouteSnapshot,
} from '../types/task.types';
import {
  createModelRef,
  providerProfilesSettings,
  resolveInvocationRoute,
  type ModelRef,
} from '../utils/settings-manager';
import {
  resolveInvocationPlanFromRoute,
  type ProviderModelBinding,
} from './provider-routing';

const DEFAULT_BASE_URL = 'https://api.tu-zi.com/v1';

type MetadataCloneRule =
  | true
  | 'string-record'
  | 'string-array-record'
  | { readonly [key: string]: MetadataCloneRule };

const PERSISTABLE_METADATA_SCHEMA: Record<string, MetadataCloneRule> = {
  text: {
    supportsImageInput: true,
    imageInputMode: true,
    maxImageCount: true,
    capabilitySource: true,
    capabilityConfidence: true,
  },
  image: {
    imageApiCompatibility: true,
    resolvedImageApiCompatibility: true,
    action: true,
    maxImageCount: true,
    supportsMask: true,
  },
  video: {
    allowedDurations: true,
    defaultDuration: true,
    durationMode: true,
    durationField: true,
    durationToModelMap: 'string-record',
    strictDurationValidation: true,
    resultMode: true,
    downloadPathTemplate: true,
    versionField: true,
    versionOptions: true,
    defaultVersion: true,
    versionOptionsByAction: 'string-array-record',
  },
  audio: {
    action: true,
    defaultAction: true,
    submitPathByAction: 'string-record',
    versionField: true,
    versionOptions: true,
    defaultVersion: true,
    supportsContinuation: true,
    supportsUploadContinuation: true,
    supportsTags: true,
    supportsTitle: true,
    supportsLyricsPrompt: true,
  },
  pptExplainer: {
    capabilities: {
      sources: true,
      presentationInputs: true,
      presenterModes: true,
      finalComposition: true,
    },
    responsePaths: {
      submit: {
        status: true,
        error: true,
        remoteId: true,
        progress: true,
        finalVideoUrl: true,
      },
      poll: {
        status: true,
        error: true,
        remoteId: true,
        progress: true,
        finalVideoUrl: true,
      },
      cancel: {
        status: true,
        error: true,
        remoteId: true,
        progress: true,
        finalVideoUrl: true,
      },
    },
    statusMapping: {
      queued: true,
      processing: true,
      completed: true,
      failed: true,
      cancelled: true,
    },
    progressScale: true,
    idempotencyHeader: true,
    cancel: {
      pathTemplate: true,
      method: true,
    },
  },
};

const SENSITIVE_METADATA_MARKER =
  /(?:api[-_.\s]?key|authorization|proxy[-_.\s]?authorization|access[-_.\s]?token|refresh[-_.\s]?token|token|secret|cookie|credential|password|passwd)/i;

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toRouteModel(
  modelRef?: ModelRef | null,
  modelId?: string | null
): ModelRef | string | null {
  if (modelRef?.profileId || modelRef?.modelId) {
    return modelRef;
  }
  return normalizeString(modelId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function containsCredentialMarker(value: string): boolean {
  return SENSITIVE_METADATA_MARKER.test(value);
}

function cloneMetadataLeaf(value: unknown): unknown {
  if (typeof value === 'string') {
    return containsCredentialMarker(value) ? undefined : value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    const cloned: unknown[] = [];
    for (const item of value) {
      const safeItem = cloneMetadataLeaf(item);
      if (safeItem === undefined || Array.isArray(safeItem)) return undefined;
      cloned.push(safeItem);
    }
    return cloned;
  }
  return undefined;
}

function cloneStringRecord(
  value: unknown,
  arrayValues: boolean
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const cloned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (containsCredentialMarker(key)) continue;
    const safeItem = cloneMetadataLeaf(item);
    if (
      safeItem === undefined ||
      (arrayValues ? !Array.isArray(safeItem) : typeof safeItem !== 'string')
    ) {
      continue;
    }
    cloned[key] = safeItem;
  }
  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

function cloneMetadataByRule(value: unknown, rule: MetadataCloneRule): unknown {
  if (rule === true) return cloneMetadataLeaf(value);
  if (rule === 'string-record') return cloneStringRecord(value, false);
  if (rule === 'string-array-record') return cloneStringRecord(value, true);
  if (!isRecord(value)) return undefined;

  const cloned: Record<string, unknown> = {};
  for (const [key, childRule] of Object.entries(rule)) {
    const safeValue = cloneMetadataByRule(value[key], childRule);
    if (safeValue !== undefined) cloned[key] = safeValue;
  }
  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

function clonePersistableMetadata(
  metadata: ProviderModelBinding['metadata']
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  return cloneMetadataByRule(metadata, PERSISTABLE_METADATA_SCHEMA) as
    | Record<string, unknown>
    | undefined;
}

function cloneMetadata(
  metadata: ProviderModelBinding['metadata']
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  try {
    return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function snapshotBinding(
  binding?: ProviderModelBinding | null,
  metadataPolicy: 'all' | 'capabilities-only' = 'all'
): TaskInvocationBindingSnapshot | null {
  if (!binding) {
    return null;
  }

  return {
    id: binding.id,
    protocol: binding.protocol,
    requestSchema: binding.requestSchema,
    responseSchema: binding.responseSchema,
    submitPath: binding.submitPath,
    pollPathTemplate: binding.pollPathTemplate,
    baseUrlStrategy: binding.baseUrlStrategy,
    metadata:
      metadataPolicy === 'capabilities-only'
        ? clonePersistableMetadata(binding.metadata)
        : cloneMetadata(binding.metadata),
  };
}

export function createTaskInvocationRouteSnapshot(
  operation: TaskInvocationOperation,
  routeModel?: ModelRef | string | null,
  options: {
    bindingId?: string | null;
    metadataPolicy?: 'all' | 'capabilities-only';
  } = {}
): TaskInvocationRouteSnapshot {
  const plan = resolveInvocationPlanFromRoute(operation, routeModel, {
    bindingId: options.bindingId,
  });

  if (plan) {
    return {
      operation,
      modelRef: createModelRef(plan.modelRef.profileId, plan.modelRef.modelId),
      providerProfileId: plan.provider.profileId,
      providerType: plan.provider.providerType,
      modelId: plan.modelRef.modelId,
      binding: snapshotBinding(plan.binding, options.metadataPolicy),
    };
  }

  const route = resolveInvocationRoute(operation, routeModel);
  return {
    operation,
    modelRef: createModelRef(route.profileId, route.modelId),
    providerProfileId: route.profileId,
    providerType: route.providerType,
    modelId: route.modelId,
    binding: null,
  };
}

export function createTaskInvocationRouteSnapshotFromTask(
  task: Pick<Task, 'type' | 'params'>,
  operation?: TaskInvocationOperation
): TaskInvocationRouteSnapshot | undefined {
  const routeOperation =
    operation ||
    (task.type === 'video'
      ? 'video'
      : task.type === 'audio'
      ? 'audio'
      : task.type === 'chat'
      ? 'text'
      : task.type === 'image'
      ? 'image'
      : undefined);

  if (!routeOperation) {
    return undefined;
  }

  return createTaskInvocationRouteSnapshot(
    routeOperation,
    task.params.modelRef || task.params.model || null
  );
}

export function resolveTaskInvocationRouteModel(
  task: Pick<Task, 'params' | 'invocationRoute'>
): ModelRef | string | null {
  const route = task.invocationRoute;
  if (route) {
    const profileId =
      normalizeString(route.modelRef?.profileId) ||
      normalizeString(route.providerProfileId);
    const modelId =
      normalizeString(route.modelRef?.modelId) ||
      normalizeString(route.modelId);
    const ref = createModelRef(profileId, modelId);
    if (ref) {
      return ref;
    }
  }

  return task.params.modelRef || task.params.model || null;
}

export function resolveLegacyTaskInvocationRouteModel(
  operation: TaskInvocationOperation,
  task: Pick<Task, 'params' | 'invocationRoute'>
): ModelRef | string | null {
  const routeModel = resolveTaskInvocationRouteModel(task);
  if (typeof routeModel !== 'string') {
    return routeModel;
  }

  const modelId = normalizeString(routeModel);
  if (!modelId) {
    return routeModel;
  }

  const directRoute = resolveInvocationRoute(operation, modelId);
  if (directRoute.profileId) {
    return createModelRef(directRoute.profileId, directRoute.modelId);
  }

  const matchingProfiles = providerProfilesSettings
    .get()
    .filter((profile) => profile.enabled && profile.baseUrl && profile.apiKey);

  for (const profile of matchingProfiles) {
    const candidate = createModelRef(profile.id, modelId);
    if (resolveInvocationPlanFromRoute(operation, candidate)) {
      return candidate;
    }
  }

  return routeModel;
}

export function shouldUseStrictTaskInvocationRoute(
  task: Pick<Task, 'invocationRoute'>
): boolean {
  return Boolean(task.invocationRoute?.providerProfileId);
}

export function assertTaskInvocationRouteAvailable(
  operation: TaskInvocationOperation,
  task: Pick<Task, 'invocationRoute'>,
  options: { requireSelectedBindingMatch?: boolean } = {}
): void {
  const route = task.invocationRoute;
  if (!route?.providerProfileId) {
    return;
  }

  const profile = providerProfilesSettings
    .get()
    .find((item) => item.id === route.providerProfileId);

  if (!profile) {
    throw new Error('原供应商配置已删除，无法继续查询异步任务状态');
  }

  if (!profile.enabled) {
    throw new Error('原供应商配置已停用，无法继续查询异步任务状态');
  }

  if (!profile.apiKey?.trim()) {
    throw new Error('原供应商 API Key 未配置，无法继续查询异步任务状态');
  }

  if (!profile.baseUrl?.trim()) {
    throw new Error('原供应商 Base URL 未配置，无法继续查询异步任务状态');
  }

  const routeModel = toRouteModel(route.modelRef, route.modelId);
  const plan = resolveInvocationPlanFromRoute(operation, routeModel, {
    bindingId: route.binding?.id,
  });

  if (!plan) {
    throw new Error('原供应商模型绑定已不可用，无法继续查询异步任务状态');
  }

  if (options.requireSelectedBindingMatch && route.binding?.id) {
    const selectedPlan = resolveInvocationPlanFromRoute(operation, routeModel);
    if (selectedPlan?.binding.id !== route.binding.id) {
      throw new Error('原供应商模型绑定已发生变化，无法安全恢复任务');
    }
  }
}

export function mergeTaskInvocationRoute(
  existing: TaskInvocationRouteSnapshot | undefined,
  next: TaskInvocationRouteSnapshot | undefined
): TaskInvocationRouteSnapshot | undefined {
  return next || existing;
}

export function isLegacyDefaultVideoBaseUrl(baseUrl?: string | null): boolean {
  const normalized = normalizeString(baseUrl);
  return !normalized || normalized === DEFAULT_BASE_URL;
}
