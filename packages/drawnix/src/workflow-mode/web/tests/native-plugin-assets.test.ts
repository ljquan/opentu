import { afterEach, describe, expect, it, vi } from 'vitest';
import { activatePlugin, installPluginFromUrl, unloadPlugins } from '../src/lib/canvas/plugin-loader';
import { getNodeDefinition } from '../src/lib/canvas/node-registry';

afterEach(() => { unloadPlugins(); vi.unstubAllGlobals(); });

describe('plugin asset paths after runtime merge', () => {
    it('removes plugin styles, listeners and node definitions on exit and supports re-entry', () => {
        const cleanup = vi.fn();
        const plugin = { id: 'test-plugin', name: 'Test', version: '1.0.0', nodes: [{ type: 'test-plugin:node', title: 'Test', defaultSize: { width: 100, height: 100 }, Content: () => null }], css: '.test-plugin { color: red; }', setup: () => cleanup };
        activatePlugin(plugin);
        expect(getNodeDefinition('test-plugin:node')).toBeDefined();
        expect(document.querySelector('[data-canvas-plugin-style]')).not.toBeNull();
        unloadPlugins();
        expect(cleanup).toHaveBeenCalledOnce();
        expect(getNodeDefinition('test-plugin:node')).toBeUndefined();
        expect(document.querySelector('[data-canvas-plugin-style]')).toBeNull();
        activatePlugin(plugin);
        expect(getNodeDefinition('test-plugin:node')).toBeDefined();
    });
    it.each([
        ['/plugins/custom.js', '/workflow-assets/plugins/custom.js'],
        ['/plugins/custom.js?v=2', '/workflow-assets/plugins/custom.js?v=2'],
        ['/workflow-assets/plugins/custom.js', '/workflow-assets/plugins/custom.js'],
        ['https://plugins.example/plugins/custom.js', 'https://plugins.example/plugins/custom.js'],
    ])('loads %s from the expected location and surfaces download failures', async (url, expected) => {
        const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
        vi.stubGlobal('fetch', fetch);
        await expect(installPluginFromUrl(url)).rejects.toThrow();
        expect(fetch).toHaveBeenCalledWith(expected);
    });
});
