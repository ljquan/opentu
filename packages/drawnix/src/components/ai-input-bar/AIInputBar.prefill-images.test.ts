import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

// Exercise the actual prefill mapping and display/submission memos without
// initializing providers or sending a generation request.
const source = readFileSync(resolve(__dirname, 'AIInputBar.tsx'), 'utf8');
const tree = ts.createSourceFile(
  'AIInputBar.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const functions: string[] = [];
const declarations = new Map<string, string>();
function visit(node: ts.Node) {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    [
      'normalizeAIInputImageDataUrl',
      'normalizeAIInputImageUrl',
      'isUploadedCanvasReference',
    ].includes(node.name.text)
  )
    functions.push(node.getText(tree));
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    [
      'allContent',
      'displayContent',
      'generationContent',
      'nextUploadedContent',
    ].includes(node.name.text) &&
    node.initializer
  ) {
    // nextUploadedContent occurs in other handlers too; select the prefill map.
    if (
      node.name.text !== 'nextUploadedContent' ||
      node.initializer.getText(tree).includes('detail.images')
    ) {
      declarations.set(node.name.text, `const ${node.getText(tree)};`);
    }
  }
  ts.forEachChild(node, visit);
}
visit(tree);
if (functions.length !== 3 || declarations.size !== 4)
  throw new Error('Prefill declarations not found');
const compiled = ts.transpileModule(
  `
${functions.join('\n')}
exports.resolve = function(detail, selectedContent, boundTargetContent, boundTargetGenerationContent) {
  ${declarations.get('nextUploadedContent')}
  const uploadedContent = nextUploadedContent;
  ${declarations.get('allContent')}
  ${declarations.get('displayContent')}
  ${declarations.get('generationContent')}
  return { allContent, displayContent, generationContent };
};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText;
type Image = {
  type: 'image';
  url: string;
  name: string;
  sourceElementId?: string;
  maskImage?: string;
};
const callbacks = {} as {
  resolve: (
    detail: { images: Image[] },
    selected: Image[],
    bound: Image | null,
    generation: Image | null
  ) => Record<'allContent' | 'displayContent' | 'generationContent', Image[]>;
};
runInNewContext(compiled, {
  exports: callbacks,
  URL,
  window: { location: { origin: 'http://localhost:7201' } },
  useMemo: (callback: () => unknown) => callback(),
});
const image: Image = {
  type: 'image',
  url: '/__aitu_cache__/image/source.png',
  name: '视角参考图',
  sourceElementId: 'source',
};

describe('canvas toolbar prefill reference identity', () => {
  it('shows and submits one image after selecting it and confirming angle editing', () => {
    const result = callbacks.resolve({ images: [image] }, [], image, image);
    expect(result.displayContent).toHaveLength(1);
    expect(result.generationContent).toHaveLength(1);
    expect(result.generationContent[0].sourceElementId).toBe('source');
  });
  it('does not duplicate when selection publication finishes after prefill or the image is reselected', () => {
    const result = callbacks.resolve({ images: [image] }, [image], null, null);
    expect(result.allContent).toHaveLength(1);
    expect(result.displayContent).toHaveLength(1);
    expect(result.generationContent).toHaveLength(1);
  });
  it('recognizes the same reference with absolute URL and retry parameters', () => {
    const selected = {
      ...image,
      url: `http://localhost:7201${image.url}?_retry=2&bypass_sw=1`,
    };
    const result = callbacks.resolve(
      { images: [image] },
      [selected],
      selected,
      selected
    );
    expect(result.displayContent).toHaveLength(1);
    expect(result.generationContent).toHaveLength(1);
  });
  it.each([
    { ...image, sourceElementId: 'other' },
    { ...image, url: '/edited.png' },
    { ...image, maskImage: '/mask.png' },
    { ...image, sourceElementId: undefined },
  ])('preserves distinct identity or edited pixels: %j', (other) => {
    const result = callbacks.resolve(
      { images: [image] },
      [other],
      other,
      other
    );
    expect(result.allContent).toHaveLength(2);
    expect(result.displayContent).toHaveLength(2);
    expect(result.generationContent).toHaveLength(2);
  });
  it('retains all other prefilled images and preserves the original upload indices', () => {
    const other = { ...image, sourceElementId: 'other', url: '/other.png' };
    const result = callbacks.resolve(
      { images: [other, image] },
      [],
      image,
      image
    );
    expect(result.displayContent.map((item) => item.sourceElementId)).toEqual([
      'other',
      'source',
    ]);
    expect(result.generationContent).toHaveLength(2);
  });
  it('keeps the semantic replacement background even when the displayed target matches', () => {
    const background = { ...image, url: '/background.png' };
    const result = callbacks.resolve(
      { images: [image] },
      [],
      image,
      background
    );
    expect(result.displayContent).toHaveLength(1);
    expect(result.generationContent.map((item) => item.url)).toEqual([
      '/background.png',
      image.url,
    ]);
  });
  it('keeps the prefilled reference after deselection and the selected reference after removing the upload', () => {
    expect(
      callbacks.resolve({ images: [image] }, [], null, null).generationContent
    ).toHaveLength(1);
    const result = callbacks.resolve({ images: [] }, [], image, image);
    expect(result.displayContent).toHaveLength(1);
    expect(result.generationContent).toHaveLength(1);
  });
});
