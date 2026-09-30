import { getModelConfig } from '../../constants/model-config';
import { inferBindingsForProviderModel } from '../../services/provider-routing/binding-inference';
import { getEffectiveVideoCompatibleParams } from '../../services/video-binding-utils';
import { resolveAdapterForModel } from '../../services/model-adapters';
import { isSeedance2ModelId } from '../../utils/seedance-model';
import {
  describeNativeModel,
  applyNativeAdapterContract,
  serializeNativeParameter,
} from './native-parameters';

/** Resolve the same registered adapters as OpenTu without importing its channels. */
export function localVideoContract(model: string, baseUrl = '') {
  const adapter = resolveAdapterForModel(model, 'video');
  const adapterId = isSeedance2ModelId(model)
    ? 'seedance-2-video-adapter'
    : /^doubao-seedance-(1-5-pro|1-0-pro(?:-fast)?|1-0-lite)_(480p|720p|1080p)$/i.test(
        model
      )
    ? 'seedance-video-adapter'
    : adapter?.id;
  const contract = describeNativeModel(model, 'video');
  if (!contract.parameters?.length) return undefined;
  const known = getModelConfig(model);
  if (known) {
    const binding =
      inferBindingsForProviderModel(
        {
          id: 'workflow-local',
          name: 'Workflow',
          baseUrl,
          apiKey: '',
          providerType: 'openai-compatible',
          authType: 'bearer',
        },
        known
      ).sort((a, b) => b.priority - a.priority)[0] || null;
    const effective = getEffectiveVideoCompatibleParams(
      model,
      null,
      null,
      binding
    ).map(serializeNativeParameter);
    contract.parameters = contract.parameters.map((parameter) =>
      adapterId === 'seedance-video-adapter' && parameter.id === 'size'
        ? parameter
        : effective.find((item) => item.id === parameter.id) || parameter
    );
    for (const selector of contract.parameters.filter((parameter) =>
      ['sora_mode', 'klingAction2'].includes(parameter.id)
    )) {
      for (const option of selector.options || []) {
        const scoped = getEffectiveVideoCompatibleParams(
          model,
          null,
          { [selector.id]: option.value },
          binding
        ).map(serializeNativeParameter);
        for (const parameter of contract.parameters) {
          if (parameter.id === selector.id) continue;
          const override = scoped.find((item) => item.id === parameter.id);
          if (!override && !effective.some((item) => item.id === parameter.id))
            continue;
          parameter.variants = [
            ...(parameter.variants || []),
            {
              when: { [selector.id]: [option.value] },
              ...(override
                ? {
                    options: override.options,
                    defaultValue: override.defaultValue,
                    min: override.min,
                    max: override.max,
                  }
                : { disabledReason: '当前生成模式不支持此参数' }),
            },
          ];
        }
      }
    }
  }
  const supported = [
    'gemini-video-adapter',
    'kling-video-adapter',
    'seedance-video-adapter',
    'seedance-2-video-adapter',
    'happyhorse-video-adapter',
  ];
  const isH3 = model.toLowerCase() === 'minimax-h3';
  const unavailableReason =
    !isH3 && !supported.includes(adapterId || '')
      ? 'OpenTu 尚无此视频模型的可用适配器'
      : undefined;
  return {
    ...contract,
    adapterId,
    unavailableReason,
    referenceInputs:
      adapterId === 'kling-video-adapter'
        ? {
            images: {
              maxCount: 2,
              mode: 'frames' as const,
              labels: ['首帧', '尾帧'],
            },
          }
        : contract.referenceInputs,
    parameters: isH3
      ? contract.parameters
      : applyNativeAdapterContract(contract.parameters, 'video', adapterId),
  };
}
