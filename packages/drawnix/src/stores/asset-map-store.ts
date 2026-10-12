/**
 * 模块级 asset map store
 *
 * 解决 CardGenerator.createRoot 创建的独立 React 树无法访问 AssetContext 的问题。
 * AssetProvider 更新时写入，CardElement 通过 useSyncExternalStore 订阅。
 */
import type { Asset } from '../types/asset.types';

type Listener = () => void;

let currentMap: Map<string, Asset> = new Map();
const listeners = new Set<Listener>();
let loadAssets: (() => void) | undefined;

export function registerAssetMapLoader(loader: () => void): () => void {
  loadAssets = loader;
  if (listeners.size > 0) loader();
  return () => {
    if (loadAssets === loader) loadAssets = undefined;
  };
}

export function setGlobalAssetMap(map: Map<string, Asset>): void {
  if (map === currentMap) return;
  currentMap = map;
  listeners.forEach((fn) => fn());
}

export function getAssetMapSnapshot(): Map<string, Asset> {
  return currentMap;
}

export function subscribeAssetMap(listener: Listener): () => void {
  listeners.add(listener);
  loadAssets?.();
  return () => {
    listeners.delete(listener);
  };
}
