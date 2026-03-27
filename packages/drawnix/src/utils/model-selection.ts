import type { ModelConfig } from '../constants/model-config';
import { createModelRef, type ModelRef } from './settings-manager';

export function getSelectionKey(
  modelId: string,
  modelRef?: ModelRef | null
): string {
  return modelRef?.profileId ? `${modelRef.profileId}::${modelId}` : modelId;
}

export function getSelectionKeyForModel(
  model: Pick<ModelConfig, 'id' | 'selectionKey' | 'sourceProfileId'>
): string {
  return (
    model.selectionKey ||
    (model.sourceProfileId ? `${model.sourceProfileId}::${model.id}` : model.id)
  );
}

export function getModelRefFromConfig(
  model?: Pick<ModelConfig, 'id' | 'sourceProfileId'> | null
): ModelRef | null {
  if (!model) {
    return null;
  }

  return createModelRef(model.sourceProfileId || null, model.id);
}

export function findMatchingSelectableModel(
  models: ModelConfig[],
  modelId?: string | null,
  modelRef?: ModelRef | null
): ModelConfig | undefined {
  if (!modelId) {
    return undefined;
  }

  const expectedKey = getSelectionKey(modelId, modelRef);
  const expectedProfileId = modelRef?.profileId || null;

  return (
    models.find((model) => getSelectionKeyForModel(model) === expectedKey) ||
    models.find(
      (model) =>
        model.id === modelId &&
        (model.sourceProfileId || null) === expectedProfileId
    ) ||
    (expectedProfileId === null
      ? models.find((model) => model.id === modelId && !model.sourceProfileId)
      : undefined) ||
    models.find((model) => model.id === modelId)
  );
}
