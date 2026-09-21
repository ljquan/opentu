import type { DrawerGenerationSubmitParams } from '../../contexts/ChatDrawerContext';
import { resolveInvocationRoute } from '../../utils/settings-manager';

type DrawerGenerationRouteType = 'image' | 'video' | 'audio' | 'text';

export function getDrawerGenerationRouteType(
  generationType: DrawerGenerationSubmitParams['generationType']
): DrawerGenerationRouteType {
  if (generationType === 'video') return 'video';
  if (generationType === 'audio') return 'audio';
  if (generationType === 'text' || generationType === 'agent') return 'text';
  return 'image';
}

export function resolveDrawerGenerationRoute(
  params: DrawerGenerationSubmitParams
) {
  return resolveInvocationRoute(
    getDrawerGenerationRouteType(params.generationType),
    params.selectedModelRef || params.selectedModel
  );
}
