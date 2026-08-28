/**
 * Gemini API 认证和配置管理
 */

import { GeminiConfig } from './types';
import { geminiSettings } from '../settings-manager';
import { isTuziEmbeddedMode } from '../../services/tuzi-embedded-config';

/**
 * DOM弹窗获取API Key
 */
export function promptForApiKey(): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    // 创建弹窗遮罩
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // 创建弹窗内容
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      width: 400px;
      max-width: 90vw;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    dialog.innerHTML = `
      <h3 style="margin: 0 0 16px 0; color: #333; font-size: 18px;">配置 API Key</h3>
      <p style="margin: 0 0 16px 0; color: #666; line-height: 1.5;">
        请输入您的 API Key，输入后将自动保存到本地存储中。
      </p>
      <p style="margin: 0 0 8px 0; color: #666; line-height: 1.5;">
        您可以从以下地址获取 API Key（新建令牌渠道分组选择default）:
        <a href="https://api.tu-zi.com/token" target="_blank" rel="noopener noreferrer" 
           style="color: #0052d9; text-decoration: none;">
          https://api.tu-zi.com/token
        </a>
      </p>
      <a href="https://www.bilibili.com/video/BV1k4PqzPEKz/" target="_blank" rel="noopener noreferrer"
         style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; background: #fb7299; color: #fff; border-radius: 4px; font-size: 14px; text-decoration: none; margin-bottom: 16px;">
        ▶ 观看视频教程 (B站)
      </a>
      <input type="text" id="apiKeyInput" placeholder="请输入 API Key" 
             style="width: 100%; padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 4px; font-size: 14px; box-sizing: border-box; margin-bottom: 16px;" />
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="cancelBtn" 
                style="padding: 8px 16px; border: 1px solid #d9d9d9; border-radius: 4px; background: white; color: #333; cursor: pointer; font-size: 14px;">
          取消
        </button>
        <button id="confirmBtn" 
                style="padding: 8px 16px; border: 1px solid #0052d9; border-radius: 4px; background: #0052d9; color: white; cursor: pointer; font-size: 14px;">
          确认
        </button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 获取元素
    const input = dialog.querySelector('#apiKeyInput') as HTMLInputElement;
    const cancelBtn = dialog.querySelector('#cancelBtn') as HTMLButtonElement;
    const confirmBtn = dialog.querySelector('#confirmBtn') as HTMLButtonElement;

    // 阻止所有键盘事件冒泡到页面其他元素（防止输入被捕获到表格等）
    const stopKeyboardPropagation = (e: KeyboardEvent) => {
      e.stopPropagation();
    };
    overlay.addEventListener('keydown', stopKeyboardPropagation, true);
    overlay.addEventListener('keyup', stopKeyboardPropagation, true);
    overlay.addEventListener('keypress', stopKeyboardPropagation, true);

    // 自动聚焦到输入框
    setTimeout(() => input.focus(), 100);

    // 清理函数
    const cleanup = () => {
      overlay.removeEventListener('keydown', stopKeyboardPropagation, true);
      overlay.removeEventListener('keyup', stopKeyboardPropagation, true);
      overlay.removeEventListener('keypress', stopKeyboardPropagation, true);
      document.body.removeChild(overlay);
    };

    // 确认按钮点击
    confirmBtn.addEventListener('click', async () => {
      const apiKey = input.value.trim();
      if (apiKey) {
        // 更新本地设置（内部会 await syncToIndexedDB，确保 SW 能拿到最新配置）
        await geminiSettings.update({ apiKey });
        cleanup();
        resolve(apiKey);
      } else {
        input.style.borderColor = '#ff4d4f';
        input.focus();
      }
    });

    // 取消按钮点击
    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    // 回车键确认
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        confirmBtn.click();
      }
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });
  });
}

/**
 * 验证并确保配置有效，如果缺少 API Key 则弹窗获取
 */
export async function validateAndEnsureConfig(
  config: GeminiConfig
): Promise<GeminiConfig> {
  // 检查 baseUrl
  if (!config.baseUrl) {
    throw new Error('Base URL 是必需的');
  }

  // 检查 apiKey，优先从全局设置获取
  if (!config.apiKey) {
    // 首先尝试从全局设置获取
    const globalSettings = geminiSettings.get();
    if (globalSettings.apiKey) {
      // 更新原始config对象
      config.apiKey = globalSettings.apiKey;
      return config;
    }

    // 如果全局设置中也没有，则弹窗获取
    const newApiKey = await promptForApiKey();
    if (!newApiKey) {
      throw new Error('API Key 是必需的，操作已取消');
    }

    // 更新原始config对象
    config.apiKey = newApiKey;
    return config;
  }

  return config;
}

/**
 * 检查字符串是否是占位符格式
 * 如 {key}、${key}、{{key}}、{apiKey} 等
 */
function isPlaceholder(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  // 匹配 {xxx}、${xxx}、{{xxx}} 等占位符格式
  return (
    /^[{$]*\{?\w+\}?\}*$/.test(value) ||
    value.includes('{key}') ||
    value.includes('${')
  );
}

/**
 * 从URL参数中获取apiKey
 */
function getApiKeyFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (isTuziEmbeddedMode()) return null;

  const urlParams = new URLSearchParams(window.location.search);
  const apiKey = urlParams.get('apiKey');

  // 验证 apiKey 不是占位符格式
  if (isPlaceholder(apiKey)) {
    console.warn(
      '[Auth] Detected placeholder in URL apiKey, ignoring:',
      apiKey
    );
    return null;
  }

  return apiKey;
}

/**
 * 从URL参数中获取settings配置
 */
function getSettingsFromUrl(): { apiKey?: string; baseUrl?: string } | null {
  if (typeof window === 'undefined') return null;
  if (isTuziEmbeddedMode()) return null;

  const urlParams = new URLSearchParams(window.location.search);
  const settingsParam = urlParams.get('settings');

  if (!settingsParam) return null;

  try {
    const decoded = decodeURIComponent(settingsParam);
    const settings = JSON.parse(decoded);

    // 验证 apiKey 不是占位符格式
    const apiKey = isPlaceholder(settings.key) ? undefined : settings.key;
    if (settings.key && isPlaceholder(settings.key)) {
      console.warn(
        '[Auth] Detected placeholder in settings.key, ignoring:',
        settings.key
      );
    }

    return {
      apiKey,
      baseUrl: settings.url,
    };
  } catch (error) {
    console.warn('Failed to parse settings parameter:', error);
    return null;
  }
}

/**
 * 从URL中移除apiKey参数
 */
function removeApiKeyFromUrl(): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  let hasChanges = false;

  if (url.searchParams.has('apiKey')) {
    url.searchParams.delete('apiKey');
    hasChanges = true;
  }

  if (url.searchParams.has('settings')) {
    url.searchParams.delete('settings');
    hasChanges = true;
  }

  if (hasChanges) {
    window.history.replaceState({}, document.title, url.toString());
  }
}

/**
 * 初始化设置：从URL获取settings参数并处理
 */
export function initializeSettings(): void {
  if (isTuziEmbeddedMode()) {
    removeApiKeyFromUrl();
    return;
  }
  // 处理settings参数
  const settings = getSettingsFromUrl();
  // 处理单独的apiKey参数
  const apiKey = getApiKeyFromUrl();

  if (settings?.apiKey || settings?.baseUrl || apiKey) {
    geminiSettings.update({
      ...(settings?.apiKey && { apiKey: settings.apiKey }),
      ...(settings?.baseUrl && { baseUrl: settings.baseUrl }),
      ...(apiKey && { apiKey: apiKey }),
    });

    // Remove parameters from URL after processing
    const url = new URL(window.location.href);
    if (settings?.apiKey || settings?.baseUrl) {
      url.searchParams.delete('settings');
    }
    if (apiKey) {
      url.searchParams.delete('apiKey');
    }
    window.history.replaceState({}, '', url.toString());
  }
}

// Initialize settings from URL if present
if (typeof window !== 'undefined') {
  if (isTuziEmbeddedMode()) {
    removeApiKeyFromUrl();
  } else {
    // 处理settings参数
    const settings = getSettingsFromUrl();
    // 处理单独的apiKey参数
    const apiKey = getApiKeyFromUrl();

    if (settings?.apiKey || settings?.baseUrl || apiKey) {
      geminiSettings.update({
        ...(settings?.apiKey && { apiKey: settings.apiKey }),
        ...(settings?.baseUrl && { baseUrl: settings.baseUrl }),
        ...(apiKey && { apiKey: apiKey }),
      });
      removeApiKeyFromUrl();
    }
  }
}
