import type { ModelConfig } from '../../constants/model-config';
import type {
  ProviderProfile,
  ProviderCatalog,
  ResolvedInvocationRoute,
} from '../../utils/settings-types';
import type {
  Capability,
  ModelDefaults,
  WorkflowChannel,
} from '../shared/model-defaults';
import {
  describeNativeModel,
  extendAdapterParameters,
  serializeNativeParameter,
  applyNativeAdapterContract,
} from './native-parameters';
import { buildNativeModelCoverage } from './native-model-coverage';

export function mapNativeModels(
  profiles: ProviderProfile[],
  catalogs: ProviderCatalog[],
  routes: ResolvedInvocationRoute[],
  models: ModelConfig[]
): ModelDefaults {
  const channels: WorkflowChannel[] = [];
  const sources = profiles
    .filter((profile) => profile.enabled)
    .map((profile) => ({
      id: profile.id as string | null,
      name: profile.name,
    }));
  if (routes.some((route) => !route.profileId))
    sources.push({ id: null, name: '默认配置' });
  for (const source of sources) {
    const profile = profiles.find((item) => item.id === source.id);
    const route = routes.find((item) => item.profileId === source.id);
    let baseUrl = '';
    try {
      const url = new URL(profile?.baseUrl || route?.baseUrl || '');
      if (['http:', 'https:'].includes(url.protocol)) baseUrl = url.origin + url.pathname;
    } catch { /* Unconfigured providers have no display address. */ }
    const catalog = catalogs.find((item) => item.profileId === source.id);
    const selected = new Set(catalog?.selectedModelIds || []);
    if (source.id === 'legacy-default') {
      models.forEach((model) => selected.add(model.id));
    } else if (source.id === null) {
      const legacyCapabilities = new Set(
        routes
          .filter((route) => route.profileId === source.id)
          .map((route) => route.routeType)
      );
      models
        .filter((model) => legacyCapabilities.has(model.type))
        .forEach((model) => selected.add(model.id));
    }
    catalog?.discoveredModels.forEach((model) => selected.add(model.id));
    catalog?.manualBindings?.forEach((binding) =>
      selected.add(binding.modelId)
    );
    routes
      .filter((route) => route.profileId === source.id)
      .forEach((route) => selected.add(route.modelId));
    const entries: WorkflowChannel['models'] = [];
    for (const id of selected) {
      const declared = new Set<Capability>([
        ...(catalog?.manualBindings
          ?.filter((binding) => binding.modelId === id)
          .map((binding) => binding.operation) || []),
        ...(catalog?.discoveredModels
          .filter((model) => model.id === id)
          .map((model) => model.type) || []),
        ...routes
          .filter(
            (route) => route.profileId === source.id && route.modelId === id
          )
          .map((route) => route.routeType),
      ]);
      const builtInCapability = models.find((model) => model.id === id)?.type;
      if (!declared.size && builtInCapability) declared.add(builtInCapability);
      for (const capability of declared)
        entries.push({
          name: id,
          capability,
          ...describeNativeModel(id, capability),
        });
    }
    if (entries.length)
      channels.push({
        id: `opentu-native-${source.id ?? 'legacy'}`,
        name: `OpenTu / ${source.name}`,
        opentuProfileId: source.id,
        baseUrl,
        apiKey: '',
        apiFormat: profile?.providerType === 'gemini-compatible' ? 'gemini' : 'openai',
        models: entries,
      });
  }
  const defaults: ModelDefaults['defaults'] = {
    image: '',
    video: '',
    text: '',
    audio: '',
  };
  for (const capability of Object.keys(defaults) as Capability[]) {
    const route = routes.find((item) => item.routeType === capability);
    const preferred =
      route &&
      channels.find(
        (channel) =>
          channel.opentuProfileId === route.profileId &&
          channel.models.some(
            (model) =>
              model.name === route.modelId && model.capability === capability
          )
      );
    const channel =
      preferred ||
      channels.find((item) =>
        item.models.some((model) => model.capability === capability)
      );
    if (channel)
      defaults[capability] = `${channel.id}::${
        preferred
          ? route!.modelId
          : channel.models.find((model) => model.capability === capability)!
              .name
      }`;
  }
  return { channels, defaults, warnings: [] };
}

export async function readNativeModels(): Promise<ModelDefaults> {
  const settings = await import('../../utils/settings-manager');
  await settings.settingsManager.waitForInitialization();
  const { getModelsByType, getAllBuiltInModelConfigs } = await import(
    '../../constants/model-config'
  );
  const capabilities: Capability[] = ['image', 'video', 'audio', 'text'];
  const models = [
    ...new Map(
      [
        ...getAllBuiltInModelConfigs(),
        ...capabilities.flatMap(getModelsByType),
      ].map((model) => [model.id, model])
    ).values(),
  ];
  const snapshot = mapNativeModels(
    settings.providerProfilesSettings.get() || [],
    settings.providerCatalogsSettings.get() || [],
    capabilities.map((type) => settings.resolveInvocationRoute(type)),
    models
  );
  const { resolveAdapterForInvocation, getAdapterContextFromSettings } =
    await import('../../services/model-adapters');
  const { getEffectiveVideoCompatibleParams } = await import(
    '../../services/video-binding-utils'
  );
  for (const channel of snapshot.channels) {
    for (const model of channel.models) {
      const modelRef = {
        profileId: channel.opentuProfileId ?? null,
        modelId: model.name,
      };
      const context = getAdapterContextFromSettings(model.capability, modelRef);
      model.requestSchema =
        context.binding?.requestSchema ||
        (context.binding?.protocol === 'openai.async.media'
          ? 'openai.async.image.form'
          : undefined);
      if (model.capability === 'text') {
        model.adapterId = 'fallback-text-executor';
        const input = context.binding?.metadata?.text;
        if (input?.supportsImageInput !== undefined)
          model.referenceInputs = input.supportsImageInput
            ? {
                images: {
                  mode: 'reference',
                  maxCount: input.maxImageCount || 6,
                },
              }
            : {};
        continue;
      }
      const adapter = resolveAdapterForInvocation(
        model.capability,
        model.name,
        { profileId: channel.opentuProfileId ?? null, modelId: model.name }
      );
      if (model.capability === 'video' && model.parameters?.length) {
        const modelRef = {
          profileId: channel.opentuProfileId ?? null,
          modelId: model.name,
        };
        const effective = getEffectiveVideoCompatibleParams(
          model.name,
          modelRef
        ).map(serializeNativeParameter);
        model.parameters = model.parameters.map((parameter) =>
          adapter?.id === 'seedance-video-adapter' && parameter.id === 'size'
            ? parameter
            : effective.find((item) => item.id === parameter.id) || parameter
        );
        for (const selector of model.parameters.filter((parameter) =>
          ['sora_mode', 'klingAction2'].includes(parameter.id)
        )) {
          for (const option of selector.options || []) {
            const scoped = getEffectiveVideoCompatibleParams(
              model.name,
              modelRef,
              { [selector.id]: option.value }
            ).map(serializeNativeParameter);
            for (const parameter of model.parameters) {
              if (parameter.id === selector.id) continue;
              const override = scoped.find((item) => item.id === parameter.id);
              if (
                !override &&
                !effective.some((item) => item.id === parameter.id)
              )
                continue;
              const variant = override
                ? {
                    options: override.options,
                    defaultValue: override.defaultValue,
                    min: override.min,
                    max: override.max,
                  }
                : { disabledReason: '当前生成模式不支持此参数' };
              parameter.variants = [
                ...(parameter.variants || []),
                { when: { [selector.id]: [option.value] }, ...variant },
              ];
            }
          }
        }
      }
      model.parameters = extendAdapterParameters(
        model.parameters || [],
        adapter?.id
      );
      model.parameters = applyNativeAdapterContract(
        model.parameters,
        model.capability,
        adapter?.id,
        model.requestSchema
      );
      model.adapterId = adapter?.id;
      if (!adapter)
        model.unavailableReason = 'OpenTu 当前未提供此模型的调用适配器';
      if (adapter?.kind === 'image')
        model.referenceInputs = {
          images: {
            mode: 'reference',
            ...(adapter.id === 'flux-image-adapter' ? { maxCount: 8 } : {}),
            ...(context.binding?.metadata?.image?.maxImageCount
              ? { maxCount: context.binding.metadata.image.maxImageCount }
              : {}),
          },
        };
      if (adapter?.id === 'kling-video-adapter')
        model.referenceInputs = {
          images: { maxCount: 2, mode: 'frames', labels: ['首帧', '尾帧'] },
        };
    }
  }
  snapshot.coverage = buildNativeModelCoverage(snapshot);
  return snapshot;
}
