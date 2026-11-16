import {
  DEFAULT_MODEL_VISIBILITY_SETTINGS,
  filterModelsByVisibility,
  isDefaultModelHidden,
  isModelHiddenByVisibility,
  matchesModelVisibilityFamily,
  type ModelConfig,
} from '../model-config';

const model = (id: string): ModelConfig => ({
  id,
  label: id,
  type: 'video',
  vendor: 'OTHER' as ModelConfig['vendor'],
});

describe('model visibility policy', () => {
  it('matches requested families by case-insensitive prefix', () => {
    expect(matchesModelVisibilityFamily('HappyHorse-1.0-t2v', 'happyhorse-1.0')).toBe(true);
    expect(matchesModelVisibilityFamily('gemini-omni-1.1-flash-pro', 'gemini-omni-1.1-flash')).toBe(true);
    expect(matchesModelVisibilityFamily('veo-2.0-generate-001', 'veo2')).toBe(true);
    expect(matchesModelVisibilityFamily('VEO3.1-PRO', 'veo3')).toBe(true);
    expect(matchesModelVisibilityFamily('veo3.1-pro', 'veo2')).toBe(false);
  });

  it('hides configured families and legacy models by default', () => {
    expect(isModelHiddenByVisibility('happyhorse-1.0-t2v')).toBe(true);
    expect(isModelHiddenByVisibility('veo3.1')).toBe(true);
    expect(isDefaultModelHidden('gpt-5')).toBe(true);
    expect(isDefaultModelHidden('gpt-5-gizmo-abc')).toBe(true);
  });

  it('honors the single hide switch when filtering a selector list', () => {
    const settings = {
      ...DEFAULT_MODEL_VISIBILITY_SETTINGS,
      hideConfiguredModels: false,
    };
    const models = filterModelsByVisibility([
      model('veo3.1'),
      model('veo-2.0-generate-001'),
      model('gpt-5'),
      model('gpt-6-sol'),
    ], settings);

    expect(models.map((item) => item.id)).toEqual([
      'veo3.1',
      'veo-2.0-generate-001',
      'gpt-5',
      'gpt-6-sol',
    ]);
  });
});
