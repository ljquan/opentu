// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compile } from 'sass';
import { parse } from 'postcss';
import { fileURLToPath } from 'node:url';

describe('model dropdown description styles', () => {
  const stylesheet = compile(fileURLToPath(
    new URL('./model-dropdown.scss', import.meta.url)
  )).css;
  const declarations = new Map<string, string>();
  parse(stylesheet).walkRules('.model-dropdown__item-desc', (rule) => {
    rule.walkDecls((declaration) => {
      declarations.set(declaration.prop, declaration.value);
    });
  });

  it('excludes full descriptions from the auto-width popup intrinsic size', () => {
    expect(declarations.get('contain')).toBe('inline-size');
  });

  it('keeps long descriptions on one line with an ellipsis', () => {
    expect(declarations.get('white-space')).toBe('nowrap');
    expect(declarations.get('overflow')).toBe('hidden');
    expect(declarations.get('text-overflow')).toBe('ellipsis');
  });
});
