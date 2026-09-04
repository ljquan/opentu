import type { ModelConfig } from '../constants/model-config';
import {
  createModelRef,
  resolveInvocationRoute,
  type ModelRef,
} from './settings-manager';

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

export function findExactSelectableModel(
  models: ModelConfig[],
  modelId?: string | null,
  modelRef?: ModelRef | null
): ModelConfig | undefined {
  if (!modelId) {
    return undefined;
  }
  const expectedKey = getSelectionKey(modelId, modelRef);
  return models.find(
    (model) => getSelectionKeyForModel(model) === expectedKey
  );
}

export function findMatchingSelectableModel(
  models: ModelConfig[],
  modelId?: string | null,
  modelRef?: ModelRef | null
): ModelConfig | undefined {
  if (!modelId) {
    return undefined;
  }

  const expectedProfileId = modelRef?.profileId || null;
  const matchingManualModel =
    expectedProfileId === null
      ? models.find(
          (model) =>
            model.id === modelId &&
            Boolean(model.sourceProfileId) &&
            (model.tags || []).includes('manual')
        )
      : undefined;

  return (
    findExactSelectableModel(models, modelId, modelRef) ||
    models.find(
      (model) =>
        model.id === modelId &&
        (model.sourceProfileId || null) === expectedProfileId
    ) ||
    matchingManualModel ||
    (expectedProfileId === null
      ? models.find((model) => model.id === modelId && !model.sourceProfileId)
      : undefined) ||
    models.find((model) => model.id === modelId)
  );
}

export interface ResolvedModelSelection {
  modelId: string;
  modelRef: ModelRef | null;
  selectionKey: string;
}

function areSelectionRefsEqual(
  left?: ModelRef | null,
  right?: ModelRef | null
): boolean {
  return (
    (left?.profileId || null) === (right?.profileId || null) &&
    (left?.modelId || null) === (right?.modelId || null)
  );
}

export function normalizeSelectableModelSelection(
  models: ModelConfig[],
  modelId?: string | null,
  modelRef?: ModelRef | null,
  fallbackModelId = ''
): ResolvedModelSelection {
  const hasMismatchedModelRef = Boolean(
    modelId && modelRef?.modelId && modelId !== modelRef.modelId
  );
  const effectiveModelRef = hasMismatchedModelRef
    ? createModelRef(modelRef?.profileId || null, modelId)
    : modelRef;
  const requestedModelId =
    effectiveModelRef?.modelId || modelId || models[0]?.id || fallbackModelId;
  const matchedModel = findMatchingSelectableModel(
    models,
    requestedModelId,
    effectiveModelRef
  );
  const nextModelId = matchedModel?.id || requestedModelId;
  const nextModelRef =
    getModelRefFromConfig(matchedModel) ||
    createModelRef(
      effectiveModelRef?.profileId || null,
      effectiveModelRef?.modelId || nextModelId
    );

  return {
    modelId: nextModelId,
    modelRef: nextModelRef,
    selectionKey: getSelectionKey(nextModelId, nextModelRef),
  };
}

export function resolveActiveImageModelSelection(
  models: ModelConfig[],
  fallbackModelId = 'gemini-2.5-flash-image-vip'
): ResolvedModelSelection {
  const route = resolveInvocationRoute('image');
  const routeRef = createModelRef(route.profileId, route.modelId);
  const matchedModel = findMatchingSelectableModel(
    models,
    route.modelId,
    routeRef
  );

  return normalizeSelectableModelSelection(
    models,
    matchedModel?.id || route.modelId,
    getModelRefFromConfig(matchedModel) || routeRef,
    fallbackModelId
  );
}

export function findManualProfileModelSelection(
  models: ModelConfig[],
  modelId?: string | null
): ResolvedModelSelection | null {
  if (!modelId) {
    return null;
  }

  const manualModel = models.find(
    (model) =>
      model.id === modelId &&
      Boolean(model.sourceProfileId) &&
      (model.tags || []).includes('manual')
  );

  if (!manualModel) {
    return null;
  }

  return normalizeSelectableModelSelection(
    models,
    manualModel.id,
    getModelRefFromConfig(manualModel),
    modelId
  );
}

export function findOnlyManualProfileModelSelection(
  models: ModelConfig[]
): ResolvedModelSelection | null {
  const manualModels = models.filter(
    (model) =>
      Boolean(model.sourceProfileId) && (model.tags || []).includes('manual')
  );

  if (manualModels.length !== 1) {
    return null;
  }

  const [manualModel] = manualModels;
  return normalizeSelectableModelSelection(
    models,
    manualModel.id,
    getModelRefFromConfig(manualModel),
    manualModel.id
  );
}

function isLegacyImageAlias(modelId?: string | null): boolean {
  const normalized = modelId?.trim().toLowerCase();
  return normalized === 'image2' || normalized === 'image-2';
}

export function resolveImageSubmissionModelSelection({
  models,
  currentModel,
  currentModelRef,
  controlledModel,
  controlledModelRef,
  activeSelection,
  fallbackModelId = 'gemini-2.5-flash-image-vip',
}: {
  models: ModelConfig[];
  currentModel?: string | null;
  currentModelRef?: ModelRef | null;
  controlledModel?: string | null;
  controlledModelRef?: ModelRef | null;
  activeSelection?: ResolvedModelSelection | null;
  fallbackModelId?: string;
}): ResolvedModelSelection {
  const explicitCurrentManualSelection = findManualProfileModelSelection(
    models,
    currentModel
  );
  if (
    explicitCurrentManualSelection &&
    currentModelRef?.modelId !== currentModel
  ) {
    return explicitCurrentManualSelection;
  }

  const explicitControlledManualSelection = findManualProfileModelSelection(
    models,
    controlledModel
  );
  if (
    explicitControlledManualSelection &&
    controlledModelRef?.modelId !== controlledModel
  ) {
    return explicitControlledManualSelection;
  }

  const currentSelection = normalizeSelectableModelSelection(
    models,
    currentModel,
    currentModelRef,
    fallbackModelId
  );

  const explicitModelIds = [
    currentModel,
    currentModelRef?.modelId,
    controlledModel,
    controlledModelRef?.modelId,
    activeSelection?.modelId,
    activeSelection?.modelRef?.modelId,
  ].filter((modelId): modelId is string => Boolean(modelId?.trim()));
  if (
    explicitModelIds.length > 0 &&
    explicitModelIds.every(isLegacyImageAlias)
  ) {
    const onlyManualSelection = findOnlyManualProfileModelSelection(models);
    if (onlyManualSelection) {
      return onlyManualSelection;
    }
  }

  if (
    activeSelection?.modelRef?.profileId &&
    currentSelection.selectionKey !== activeSelection.selectionKey &&
    !currentSelection.modelRef?.profileId
  ) {
    return activeSelection;
  }

  const onlyManualSelection = findOnlyManualProfileModelSelection(models);
  if (
    onlyManualSelection &&
    !currentSelection.modelRef?.profileId &&
    activeSelection &&
    !activeSelection.modelRef?.profileId
  ) {
    return onlyManualSelection;
  }

  const manualCurrentSelection = findManualProfileModelSelection(
    models,
    currentSelection.modelId
  );
  if (
    manualCurrentSelection &&
    currentSelection.selectionKey !== manualCurrentSelection.selectionKey &&
    !currentSelection.modelRef?.profileId
  ) {
    return manualCurrentSelection;
  }

  if (controlledModel || controlledModelRef) {
    const controlledSelection = normalizeSelectableModelSelection(
      models,
      controlledModel,
      controlledModelRef,
      fallbackModelId
    );
    const isStaleUnscopedControlledSelection =
      activeSelection?.modelRef?.profileId &&
      !controlledSelection.modelRef?.profileId &&
      controlledSelection.selectionKey !== activeSelection.selectionKey;

    if (isStaleUnscopedControlledSelection) {
      return currentSelection.modelRef?.profileId
        ? currentSelection
        : activeSelection;
    }

    const manualControlledSelection = findManualProfileModelSelection(
      models,
      controlledSelection.modelId
    );
    if (manualControlledSelection && !controlledSelection.modelRef?.profileId) {
      return currentSelection.modelRef?.profileId
        ? currentSelection
        : manualControlledSelection;
    }

    if (
      currentSelection.selectionKey !== controlledSelection.selectionKey ||
      !areSelectionRefsEqual(
        currentSelection.modelRef,
        controlledSelection.modelRef
      )
    ) {
      return controlledSelection;
    }
  }

  return currentSelection;
}
