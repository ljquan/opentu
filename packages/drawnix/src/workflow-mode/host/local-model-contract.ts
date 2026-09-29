import { inferBindingsForProviderModel } from '../../services/provider-routing/binding-inference';
import {
  getModelAdapter,
  resolveAdapterForModel,
  resolveAdapterForBinding,
} from '../../services/model-adapters';
import { getModelConfig } from '../../constants/model-config';
import {
  getSunoModelAlias,
  getForcedSunoParams,
} from '../../utils/suno-model-aliases';
import { localVideoContract } from './local-video-contract';
import {
  describeNativeModel,
  extendAdapterParameters,
  applyNativeAdapterContract,
} from './native-parameters';
import type { Capability } from '../shared/model-defaults';

export function localModelContract(
  model: string,
  capability: Capability,
  apiFormat: 'openai' | 'gemini',
  baseUrl = '',
  imageAction: 'generation' | 'edit' = 'generation'
) {
  if (capability === 'video') {
    const result = localVideoContract(model, baseUrl);
    return result
      ? { ...result, unavailableReason: apiFormat === 'gemini' ? '此视频模型的 OpenTu 适配器需要 OpenAI 兼容渠道' : result.unavailableReason, binding: undefined, requestSchema: undefined }
      : undefined;
  }
  const alias = capability === 'audio' ? getSunoModelAlias(model) : null;
  const contractModel = alias?.entryModelId || model;
  const known = getModelConfig(contractModel);
  if (capability === 'text') {
    // Discovered/custom OpenAI-compatible text models are not necessarily in
    // the built-in catalog, but they still share the standard sampling fields.
    // Keep the text settings panel and request body consistent for those models.
    const contract = known?.type === capability
      ? describeNativeModel(contractModel, capability)
      : describeNativeModel('gpt-5.5', 'text');
    return {
      ...contract,
      adapterId: 'fallback-text-executor',
      binding: undefined,
      requestSchema: undefined,
      unavailableReason: undefined,
    };
  }
  if (!known || known.type !== capability) return undefined;
  const contract = describeNativeModel(contractModel, capability);
  const bindings = inferBindingsForProviderModel(
    {
      id: 'workflow-local',
      name: 'Workflow',
      baseUrl,
      apiKey: '',
      providerType:
        apiFormat === 'gemini' ? 'gemini-compatible' : 'openai-compatible',
      authType: 'bearer',
    },
    known
  ).sort((a, b) => b.priority - a.priority);
  const binding =
    imageAction === 'edit' &&
    bindings[0]?.metadata?.image?.action === 'generation'
      ? bindings.find((item) => item.metadata?.image?.action === 'edit')
      : bindings[0];
  const adapter =
    (binding ? resolveAdapterForBinding(binding, capability) : undefined) ||
    resolveAdapterForModel(contractModel, capability);
  const adapterId = adapter?.id;
  let unavailableReason = !adapter
    ? 'OpenTu 当前未提供此模型的调用适配器'
    : undefined;
  if (imageAction === 'edit' && !binding && bindings[0]?.metadata?.image?.action === 'generation')
    unavailableReason = '当前渠道未提供此模型的参考图编辑接口';
  if (apiFormat === 'gemini' && adapterId !== 'gemini-image-adapter')
    unavailableReason = '此模型的 OpenTu 适配器需要 OpenAI 兼容渠道';
  const parameters = applyNativeAdapterContract(
    extendAdapterParameters(contract.parameters || [], adapterId),
    capability,
    adapterId,
    binding?.requestSchema
  );
  for (const [id, value] of Object.entries(getForcedSunoParams(model))) {
    const parameter = parameters.find((item) => item.id === id);
    if (parameter) {
      parameter.defaultValue = value;
      parameter.options = [{ value, label: value }];
    }
  }
  return {
    ...contract,
    referenceInputs:
      adapter?.kind === 'image'
        ? {
            images: {
              mode: 'reference' as const,
              ...(adapter.id === 'flux-image-adapter' ? { maxCount: 8 } : {}),
              ...(binding?.metadata?.image?.maxImageCount
                ? { maxCount: binding.metadata.image.maxImageCount }
                : {}),
            },
          }
        : contract.referenceInputs,
    parameters,
    adapterId,
    binding,
    requestSchema: binding?.requestSchema,
    unavailableReason,
  };
}

export { getModelAdapter };
