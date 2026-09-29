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

export function mapModelDefaults(
  profiles: ProviderProfile[],
  catalogs: ProviderCatalog[],
  routes: ResolvedInvocationRoute[],
  staticModels: ModelConfig[]
): ModelDefaults {
  const channels: WorkflowChannel[] = [];
  const warnings: string[] = [];
  for (const profile of profiles.filter((item) => item.enabled)) {
    const catalog = catalogs.find((item) => item.profileId === profile.id);
    if (
      profile.providerType === 'custom' ||
      profile.authType !== 'bearer' ||
      Object.keys(profile.extraHeaders || {}).length
    ) {
      warnings.push(`${profile.name}：自定义协议或鉴权暂不支持，未导入。`);
      continue;
    }
    let url: URL;
    try {
      url = new URL(profile.baseUrl);
    } catch {
      warnings.push(`${profile.name}：接口地址无效，未导入。`);
      continue;
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      warnings.push(`${profile.name}：接口地址包含不支持的参数，未导入。`);
      continue;
    }
    const selected = new Set(catalog?.selectedModelIds || []);
    for (const route of routes.filter((item) => item.profileId === profile.id))
      selected.add(route.modelId);
    const models: WorkflowChannel['models'] = [];
    for (const id of selected) {
      const model =
        catalog?.discoveredModels.find((item) => item.id === id) ||
        staticModels.find((item) => item.id === id);
      const capability =
        model?.type ||
        routes.find(
          (item) => item.profileId === profile.id && item.modelId === id
        )?.routeType;
      if (!capability) {
        warnings.push(`${profile.name} / ${id}：无法确认模型能力，未导入。`);
        continue;
      }
      const nativeGemini = profile.providerType === 'gemini-compatible';
      const supported =
        capability === 'text' ||
        (capability === 'image' &&
          (nativeGemini
            ? /gemini/i.test(id)
            : /^(gpt-image|dall-e)/i.test(id))) ||
        (capability === 'video' &&
          (nativeGemini
            ? /veo/i.test(id)
            : /^(sora|grok-imagine-video)/i.test(id))) ||
        (capability === 'audio' &&
          !nativeGemini &&
          /^(tts-|gpt-4o-mini-tts)/i.test(id));
      const special =
        !supported ||
        catalog?.manualBindings?.some((item) => item.modelId === id) ||
        (capability === 'image' &&
          (profile.preferAsyncImageEndpoint ||
            (profile.imageApiCompatibility &&
              profile.imageApiCompatibility !== 'openai-gpt-image')));
      if (special) {
        warnings.push(
          `${profile.name} / ${id}：需要 OpenTu 专用调用适配，未导入。`
        );
        continue;
      }
      models.push({ name: id, capability });
    }
    if (models.length)
      channels.push({
        id: `opentu-${profile.id}`,
        name: profile.name,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        apiFormat:
          profile.providerType === 'gemini-compatible' ? 'gemini' : 'openai',
        models,
      });
  }
  const defaults = { image: '', video: '', text: '', audio: '' };
  for (const capability of Object.keys(defaults) as Capability[]) {
    const route = routes.find((item) => item.routeType === capability);
    const preferred = channels.find(
      (item) =>
        item.id === `opentu-${route?.profileId}` &&
        item.models.some(
          (model) =>
            model.name === route?.modelId && model.capability === capability
        )
    );
    const fallback = channels.find((item) =>
      item.models.some((model) => model.capability === capability)
    );
    const channel = preferred || fallback;
    if (channel)
      defaults[capability] = `${channel.id}::${
        preferred
          ? route!.modelId
          : channel.models.find((model) => model.capability === capability)!
              .name
      }`;
  }
  return { channels, defaults, warnings };
}

export async function readModelDefaults(): Promise<ModelDefaults> {
  const settings = await import('../../utils/settings-manager');
  await settings.settingsManager.waitForInitialization();
  const { getModelsByType } = await import('../../constants/model-config');
  const routes = (['image', 'video', 'text', 'audio'] as Capability[]).map(
    (type) => settings.resolveInvocationRoute(type)
  );
  const profiles = [...(settings.providerProfilesSettings.get() || [])];
  for (const route of routes.filter((item) => !item.profileId)) {
    const id = 'legacy-workflow';
    if (!profiles.some((item) => item.id === id))
      profiles.push({
        id,
        name: 'OpenTu',
        baseUrl: route.baseUrl,
        apiKey: route.apiKey,
        providerType: route.providerType || 'openai-compatible',
        authType: 'bearer',
        enabled: true,
        capabilities: {
          supportsModelsEndpoint: true,
          supportsText: true,
          supportsImage: true,
          supportsVideo: true,
          supportsAudio: true,
          supportsTools: false,
        },
      });
    route.profileId = id;
  }
  return mapModelDefaults(
    profiles,
    settings.providerCatalogsSettings.get() || [],
    routes,
    (['image', 'video', 'text', 'audio'] as Capability[]).flatMap(
      getModelsByType
    )
  );
}
