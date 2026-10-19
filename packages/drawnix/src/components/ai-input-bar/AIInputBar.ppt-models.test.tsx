import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { useMemo } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as ts from 'typescript';
import type { ModelConfig } from '../../constants/model-config';

interface Inputs {
  generationType: string;
  selectedSkillId: string;
  pptExplainerDialogOpen: boolean;
  configuredImageModels: ModelConfig[];
  configuredVideoModels: ModelConfig[];
}

interface ModelLists {
  images: ModelConfig[];
  videos: ModelConfig[];
}

// Run the actual component's declarations with real React memoization, without
// importing the generation runtime and its startup side effects.
const source = readFileSync(resolve(__dirname, 'AIInputBar.tsx'), 'utf8');
const tree = ts.createSourceFile(
  'AIInputBar.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const names = new Set([
  'usesStrictPptModels',
  'executablePptImageModels',
  'executablePptVideoModels',
]);
const declarations: string[] = [];
let filterCode = '';
function visit(node: ts.Node): void {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name?.text === 'filterExecutablePptModels'
  ) {
    filterCode = node.getText(tree);
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    names.has(node.name.text)
  ) {
    declarations.push(`const ${node.getText(tree)};`);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (!filterCode || declarations.length !== names.size)
  throw new Error('PPT model declaration discovery failed');
const compiled = ts.transpileModule(
  `
  ${filterCode}
  exports.useModels = function useModels(inputs) {
    const { generationType, selectedSkillId, pptExplainerDialogOpen,
      configuredImageModels, configuredVideoModels } = inputs;
    ${declarations.join('\n')}
    return { images: executablePptImageModels, videos: executablePptVideoModels };
  };
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText;

function model(id: string, type: 'image' | 'video'): ModelConfig {
  return { id, type, label: id } as ModelConfig;
}

function createHarness() {
  const resolvePlan = vi.fn((_type: string, modelId: string) =>
    modelId.startsWith('unavailable')
      ? null
      : {
          provider: {
            baseUrl: 'https://example.invalid/v1',
            apiKey: 'test-key',
          },
        }
  );
  const exports = {} as { useModels: (inputs: Inputs) => ModelLists };
  runInNewContext(compiled, {
    exports,
    useMemo,
    getModelRefFromConfig: () => null,
    resolveInvocationPlanFromRoute: resolvePlan,
  });
  const inputs: Inputs = {
    generationType: 'image',
    selectedSkillId: 'auto',
    pptExplainerDialogOpen: false,
    configuredImageModels: [
      model('image-1', 'image'),
      model('unavailable-image', 'image'),
    ],
    configuredVideoModels: [model('video-1', 'video')],
  };
  return { inputs, resolvePlan, useModels: exports.useModels };
}

describe('AIInputBar on-demand PPT model validation', () => {
  it.each(['image', 'video', 'audio', 'text', 'agent'])(
    'does not validate PPT routes on ordinary %s startup',
    (generationType) => {
      const h = createHarness();
      renderHook(() => h.useModels({ ...h.inputs, generationType }));
      expect(h.resolvePlan).not.toHaveBeenCalled();
    }
  );

  it('ignores a remembered PPT skill while using ordinary image mode', () => {
    const h = createHarness();
    renderHook(() =>
      h.useModels({
        ...h.inputs,
        selectedSkillId: 'generate_ppt_explainer_video',
      })
    );
    expect(h.resolvePlan).not.toHaveBeenCalled();
  });

  it('does no PPT route work for a 199-model catalog during ordinary startup', () => {
    const h = createHarness();
    renderHook(() =>
      h.useModels({
        ...h.inputs,
        configuredImageModels: Array.from({ length: 150 }, (_, index) =>
          model(`image-${index}`, 'image')
        ),
        configuredVideoModels: Array.from({ length: 49 }, (_, index) =>
          model(`video-${index}`, 'video')
        ),
      })
    );
    expect(h.resolvePlan).not.toHaveBeenCalled();
  });

  it('validates when entering PPT and retains the existing availability filter', () => {
    const h = createHarness();
    const { result, rerender } = renderHook(
      (inputs: Inputs) => h.useModels(inputs),
      { initialProps: h.inputs }
    );
    expect(h.resolvePlan).not.toHaveBeenCalled();
    rerender({
      ...h.inputs,
      generationType: 'agent',
      selectedSkillId: 'generate_ppt_explainer_video',
    });
    expect(h.resolvePlan).toHaveBeenCalledTimes(3);
    expect(result.current.images.map((item) => item.id)).toEqual(['image-1']);
    expect(result.current.videos.map((item) => item.id)).toEqual(['video-1']);
  });

  it('validates an open PPT dialog even if the generation mode changes', () => {
    const h = createHarness();
    renderHook(() =>
      h.useModels({
        ...h.inputs,
        selectedSkillId: 'generate_ppt_explainer_video',
        pptExplainerDialogOpen: true,
      })
    );
    expect(h.resolvePlan).toHaveBeenCalledTimes(3);
  });

  it('does not repeat validation on unchanged renders, but revalidates changed model configuration in PPT', () => {
    const h = createHarness();
    const pptInputs = {
      ...h.inputs,
      generationType: 'agent',
      selectedSkillId: 'generate_ppt_explainer_video',
    };
    const { result, rerender } = renderHook(
      (inputs: Inputs) => h.useModels(inputs),
      { initialProps: pptInputs }
    );
    h.resolvePlan.mockClear();
    rerender({ ...pptInputs });
    expect(h.resolvePlan).not.toHaveBeenCalled();
    rerender({
      ...pptInputs,
      configuredImageModels: [model('image-2', 'image')],
    });
    expect(h.resolvePlan).toHaveBeenCalledTimes(1);
    expect(result.current.images.map((item) => item.id)).toEqual(['image-2']);
  });

  it('stops validating after leaving PPT, including later configuration changes', () => {
    const h = createHarness();
    const { rerender } = renderHook((inputs: Inputs) => h.useModels(inputs), {
      initialProps: {
        ...h.inputs,
        generationType: 'agent',
        selectedSkillId: 'generate_ppt_explainer_video',
      },
    });
    h.resolvePlan.mockClear();
    rerender({ ...h.inputs, selectedSkillId: 'generate_ppt_explainer_video' });
    rerender({
      ...h.inputs,
      configuredVideoModels: [model('video-2', 'video')],
    });
    expect(h.resolvePlan).not.toHaveBeenCalled();
  });

  it('removes models that become unavailable after configuration changes in PPT', () => {
    const h = createHarness();
    const pptInputs = {
      ...h.inputs,
      generationType: 'agent',
      selectedSkillId: 'generate_ppt_explainer_video',
    };
    const { result, rerender } = renderHook(
      (inputs: Inputs) => h.useModels(inputs),
      { initialProps: pptInputs }
    );
    expect(result.current.images).toHaveLength(1);
    h.resolvePlan.mockReturnValue(null);
    rerender({
      ...pptInputs,
      configuredImageModels: [...pptInputs.configuredImageModels],
      configuredVideoModels: [...pptInputs.configuredVideoModels],
    });
    expect(result.current.images).toHaveLength(0);
    expect(result.current.videos).toHaveLength(0);
  });
});
