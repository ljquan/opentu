import { getAllBuiltInModelConfigs } from '../../constants/model-config';
import type {
  ModelDefaults,
  NativeModelCoverage,
} from '../shared/model-defaults';
import {
  describeNativeModel,
  PARAMETER_CONSUMERS,
  getNativeParameterConsumer,
} from './native-parameters';

export function buildNativeModelCoverage(
  snapshot: ModelDefaults
): NativeModelCoverage[] {
  const records: NativeModelCoverage[] = snapshot.channels.flatMap((channel) =>
    channel.models.map((model) => ({
      profileId: channel.opentuProfileId ?? null,
      modelId: model.name,
      capability: model.capability,
      status:
        model.unavailableReason ||
        model.parameters?.some((parameter) => parameter.disabledReason)
          ? ('upstream-unavailable' as const)
          : model.parameters?.length
          ? ('configured' as const)
          : ('parameter-contract-missing' as const),
      parameterIds: (model.parameters || []).map((parameter) => parameter.id),
      consumers: Object.fromEntries(
        (model.parameters || []).map((parameter) => [
          parameter.id,
          parameter.disabledReason
            ? `UPSTREAM_UNAVAILABLE: ${parameter.disabledReason}`
            : getNativeParameterConsumer(
                model.capability,
                parameter.id,
                model.adapterId,
                model.requestSchema
              ) || 'UNMAPPED',
        ])
      ),
      referenceInputs: model.referenceInputs || {},
      adapterId: model.adapterId,
      requestSchema: model.requestSchema,
      ...(model.unavailableReason ? { reason: model.unavailableReason } : {}),
    }))
  );
  for (const model of getAllBuiltInModelConfigs()) {
    if (
      records.some(
        (record) =>
          record.modelId === model.id && record.capability === model.type
      )
    )
      continue;
    const description = describeNativeModel(model.id, model.type);
    records.push({
      profileId: null,
      modelId: model.id,
      capability: model.type,
      status: 'unconfigured',
      parameterIds: (description.parameters || []).map(
        (parameter) => parameter.id
      ),
      consumers: Object.fromEntries(
        (description.parameters || []).map((parameter) => [
          parameter.id,
          PARAMETER_CONSUMERS[model.type][parameter.id] || 'UNMAPPED',
        ])
      ),
      referenceInputs: description.referenceInputs || {},
      reason: '未配置调用渠道',
    });
  }
  return records;
}
