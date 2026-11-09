import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSvgSandboxDocument,
  controlSvgAnimation,
  inspectSvgSource,
  isSvgUrl,
  supportsSvgPlayback,
} from '../svg-source';

const svg = (body: string, attrs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100" ${attrs}>${body}</svg>`;
afterEach(() => vi.restoreAllMocks());

describe('SVG capabilities from source bytes', () => {
  it('recognizes static vectors without inventing motion or layers from the model name', () => {
    const source = inspectSvgSource(
      svg(
        '<defs><path id="template" d="M0 0L10 10"/></defs><circle cx="20" cy="30" r="10"/>'
      )
    );
    expect(source.vectorCount).toBe(1);
    expect(source.canConvert).toBe(true);
    expect(source.animation).toEqual({
      smil: false,
      css: false,
      detected: false,
    });
    expect(source.viewBox).toEqual([10, 20, 200, 100]);
  });
  it('keeps embedded and mixed raster SVG out of pure vector conversion', () => {
    for (const extra of ['', '<rect width="20" height="30"/>']) {
      const source = inspectSvgSource(
        svg(
          `<image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>${extra}`
        )
      );
      expect(source.hasRaster).toBe(true);
      expect(source.canConvert).toBe(false);
      expect(source.conversionReason).toContain('位图');
    }
  });
  it('detects real SMIL and retains it rather than silently converting it to static layers', () => {
    const source = inspectSvgSource(
      svg(
        '<circle r="10"><animate attributeName="r" values="10;20;10" dur="2s" repeatCount="indefinite"/></circle>'
      )
    );
    expect(source.animation.smil).toBe(true);
    expect(source.canConvert).toBe(false);
    expect(source.markup).toContain('<animate');
    expect(source.conversionReason).toContain('动画');
  });
  it('does not call unused definitions animated or embedded definition bitmaps editable vectors', () => {
    const source = inspectSvgSource(
      svg(
        '<defs><circle id="unused"><animate attributeName="r" values="1;2" dur="1s"/></circle></defs><rect width="10" height="10"/>'
      )
    );
    expect(source.animation).toEqual({
      smil: false,
      css: false,
      detected: true,
    });
    const raster = inspectSvgSource(
      svg(
        '<defs><image id="bitmap" href="data:image/png;base64,aQ=="/></defs><use href="#bitmap"/>'
      )
    );
    expect(raster.hasRaster).toBe(true);
    expect(raster.canConvert).toBe(false);
  });
  it('does not advertise event-only or zero-duration SMIL as controlled playback', () => {
    for (const attrs of ['begin="click" dur="1s"', 'dur="0s"']) {
      const source = inspectSvgSource(
        svg(
          `<circle><animate attributeName="r" values="1;2" ${attrs}/></circle>`
        )
      );
      expect(source.animation.detected).toBe(true);
      expect(source.animation.smil).toBe(false);
    }
  });
  it('detects CSS animation only when a real element uses a declared keyframe and positive timing', () => {
    const styles =
      '<style>@keyframes pulse {from{opacity:0}to{opacity:1}}.flower {animation: pulse 2s infinite}</style>';
    expect(
      inspectSvgSource(svg(`${styles}<circle class="flower" r="10"/>`))
        .animation.css
    ).toBe(true);
    expect(
      inspectSvgSource(svg(`${styles}<circle class="other" r="10"/>`)).animation
        .css
    ).toBe(false);
    expect(
      inspectSvgSource(
        svg(styles.replace('2s', '0s') + '<circle class="flower"/>')
      ).animation.css
    ).toBe(false);
    expect(
      inspectSvgSource(
        svg(styles.replace('2s', '0s 2s') + '<circle class="flower"/>')
      ).animation.css
    ).toBe(false);
    expect(
      inspectSvgSource(
        svg(
          '<style>@keyframes pulse {from{opacity:0}to{opacity:1}}</style><circle style="animation:pulse 1s infinite"/>'
        )
      ).animation.css
    ).toBe(true);
  });
  it.each([
    '<script>alert(1)</script>',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">html</div></foreignObject>',
    '<circle onload="alert(1)"/>',
    '<image href="https://example.com/a.png"/>',
    '<use href="javascript:alert(1)"/>',
    '<style>@import "https://example.com/a.css";</style>',
    '<style>.a {fill:url(https://example.com/a.svg)}</style>',
    '<style>.a {fill:u\\72l(https://example.com/a.svg)}</style>',
    '<style>.a {fill:u/**/rl(https://example.com/a.svg)}</style>',
    '<circle xml:base="https://example.com"/>',
    '<circle><animate attributeName="href" to="https://example.com" dur="1s"/></circle>',
  ])(
    'rejects active or external content before iframe rendering: %s',
    (body) => {
      expect(() => inspectSvgSource(svg(body))).toThrow();
    }
  );
  it('rejects malformed, missing geometry, entity declarations and excessive input', () => {
    for (const text of [
      '<svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      '<!DOCTYPE svg [<!ENTITY a "foo">]>' + svg('<text>&a;</text>'),
      svg(' '.repeat(2 * 1024 * 1024)),
      svg('<circle/>'.repeat(2001)),
    ]) {
      expect(() => inspectSvgSource(text)).toThrow();
    }
  });
  it('allows local gradients, references, masks and original text', () => {
    const source = inspectSvgSource(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="blue"/></linearGradient><path id="petal" d="M0 0L10 10Z"/></defs><path fill="url(#g)" d="M0 0L10 10Z"/><use href="#petal"/><text>Hello</text>'
      )
    );
    expect(source.canConvert).toBe(true);
    expect(source.vectorCount).toBe(3);
  });
  it('builds a script-free document allowing only exact source style hashes', () => {
    const source = inspectSvgSource(
      svg('<style>.a {fill:blue}</style><circle class="a" style="opacity:.5"/>')
    );
    const html = buildSvgSandboxDocument(source);
    expect(html).toContain("script-src 'none'");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("'sha256-");
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain('allow-scripts');
    expect(html).toContain(source.markup);
  });
  it('controls native animation objects without changing or adding source animations', () => {
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const pause = vi.fn(),
      play = vi.fn(),
      setTime = vi.fn();
    Object.assign(root, {
      pauseAnimations: pause,
      unpauseAnimations: play,
      setCurrentTime: setTime,
    });
    const animation = { currentTime: 12, pause: vi.fn(), play: vi.fn() };
    const doc = {
      querySelector: () => root,
      getAnimations: () => [animation],
    } as unknown as Document;
    controlSvgAnimation(doc, true, true);
    expect(pause).toHaveBeenCalledOnce();
    expect(setTime).toHaveBeenCalledWith(0);
    expect(animation.currentTime).toBe(0);
    expect(animation.pause).toHaveBeenCalledOnce();
    controlSvgAnimation(doc, false);
    expect(play).toHaveBeenCalledOnce();
    expect(animation.play).toHaveBeenCalledOnce();
    expect(root.children).toHaveLength(0);
    expect(supportsSvgPlayback(inspectSvgSource(svg('<circle/>')))).toBe(false);
  });
  it('recognizes data and signed cache URLs without treating every image as SVG', () => {
    expect(isSvgUrl('/__aitu_cache__/image/a.svg?x=1')).toBe(true);
    expect(isSvgUrl('data:image/svg+xml;charset=utf8,<svg/>')).toBe(true);
    expect(isSvgUrl('https://example.com/image.png')).toBe(false);
  });
});
