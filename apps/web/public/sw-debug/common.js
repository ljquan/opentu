/**
 * SW Debug Panel - Common Utilities
 * 公共工具函数
 */

/**
 * Escape HTML special characters
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Truncate URL for display
 * @param {string} url
 * @param {number} maxLen
 * @returns {string}
 */
export function truncateUrl(url, maxLen) {
  if (url.length <= maxLen) return url;
  return url.substring(0, maxLen - 3) + '...';
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Parse User-Agent string to extract browser and OS info
 * @param {string} ua - User-Agent string
 * @returns {{browser: string, os: string}}
 */
export function parseUserAgent(ua) {
  let browser = '未知';
  let os = '未知';

  // Detect browser
  if (ua.includes('Chrome') && !ua.includes('Edg')) {
    const match = ua.match(/Chrome\/(\d+)/);
    browser = match ? `Chrome ${match[1]}` : 'Chrome';
  } else if (ua.includes('Edg')) {
    const match = ua.match(/Edg\/(\d+)/);
    browser = match ? `Edge ${match[1]}` : 'Edge';
  } else if (ua.includes('Firefox')) {
    const match = ua.match(/Firefox\/(\d+)/);
    browser = match ? `Firefox ${match[1]}` : 'Firefox';
  } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
    const match = ua.match(/Version\/(\d+)/);
    browser = match ? `Safari ${match[1]}` : 'Safari';
  }

  // Detect OS
  if (ua.includes('Windows NT 10')) {
    os = 'Windows 10/11';
  } else if (ua.includes('Windows NT')) {
    os = 'Windows';
  } else if (ua.includes('Mac OS X')) {
    const match = ua.match(/Mac OS X (\d+[._]\d+)/);
    os = match ? `macOS ${match[1].replace('_', '.')}` : 'macOS';
  } else if (ua.includes('Linux')) {
    os = 'Linux';
  } else if (ua.includes('Android')) {
    const match = ua.match(/Android (\d+)/);
    os = match ? `Android ${match[1]}` : 'Android';
  } else if (ua.includes('iPhone') || ua.includes('iPad')) {
    const match = ua.match(/OS (\d+)/);
    os = match ? `iOS ${match[1]}` : 'iOS';
  }

  return { browser, os };
}

// Domain blacklist - requests from these domains will be hidden
export const DOMAIN_BLACKLIST = [
  'umami.tu-zi.com',
  'google-analytics.com',
  'googletagmanager.com',
];

/**
 * Check if URL is in the domain blacklist
 * @param {string} url
 * @returns {boolean}
 */
export function isBlacklistedUrl(url) {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return DOMAIN_BLACKLIST.some(domain => 
      urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Filter logs by time range
 * @param {Array} logs
 * @param {string} timeRangeMinutes - Minutes as string, or empty for all
 * @returns {Array}
 */
export function filterByTimeRange(logs, timeRangeMinutes) {
  if (!timeRangeMinutes) return logs;

  const minutes = parseInt(timeRangeMinutes);
  if (isNaN(minutes)) return logs;

  const cutoffTime = Date.now() - (minutes * 60 * 1000);
  return logs.filter(log => log.timestamp >= cutoffTime);
}

/**
 * Check if a request is slow (> 1 second)
 * @param {number} duration - Duration in milliseconds
 * @returns {'normal'|'slow'|'very-slow'}
 */
export function getSpeedClass(duration) {
  if (!duration) return 'normal';
  if (duration >= 3000) return 'very-slow';
  if (duration >= 1000) return 'slow';
  return 'normal';
}

/**
 * 检测字符串是否是 base64 图片数据
 * @param {string} str - 要检测的字符串
 * @returns {boolean}
 */
function isBase64Image(str) {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('data:image/') && str.includes('base64,');
}

/**
 * 从 base64 图片数据中提取信息
 * @param {string} base64Str - base64 图片字符串
 * @returns {{mimeType: string, size: number}}
 */
function getBase64ImageInfo(base64Str) {
  const match = base64Str.match(/^data:image\/([^;]+);base64,(.*)$/);
  if (!match) return { mimeType: 'unknown', size: 0 };

  const mimeType = match[1];
  const base64Data = match[2];
  // 估算原始文件大小（base64 会增加约 33% 的大小）
  const size = Math.round((base64Data.length * 3) / 4);

  return { mimeType, size };
}

/**
 * 生成唯一的图片预览 ID
 */
let imagePreviewCounter = 0;
function generateImagePreviewId() {
  return `img-preview-${Date.now()}-${++imagePreviewCounter}`;
}

/**
 * 将 base64 图片替换为可点击的预览组件 HTML
 * @param {string} base64Str - base64 图片字符串
 * @returns {string} - HTML 字符串
 */
function createBase64ImagePreview(base64Str) {
  const { mimeType, size } = getBase64ImageInfo(base64Str);
  const sizeText = formatBytes(size);
  const previewId = generateImagePreviewId();

  // 创建一个可展开的图片预览组件
  return `<span class="base64-image-preview" data-preview-id="${previewId}">
    <span class="base64-preview-toggle" onclick="toggleBase64Preview('${previewId}')" title="点击展开/收起图片预览">
      🖼️ [image/${mimeType}, ${sizeText}]
    </span>
    <span class="base64-preview-image" id="${previewId}" style="display: none;">
      <img src="${escapeHtml(base64Str)}" style="max-width: 200px; max-height: 200px; border-radius: 4px; margin: 8px 0; cursor: pointer; border: 1px solid var(--border-color);" onclick="window.open(this.src)" title="点击查看原图">
    </span>
  </span>`;
}

/**
 * 递归处理对象，将 base64 图片字符串替换为占位符，并收集图片信息
 * @param {any} obj - 要处理的对象
 * @param {Map} imageMap - 存储图片信息的 Map
 * @param {string} path - 当前路径
 * @returns {any} - 处理后的对象
 */
function processObjectForBase64(obj, imageMap, path = '') {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    if (isBase64Image(obj)) {
      const placeholder = `__BASE64_IMAGE_${imageMap.size}__`;
      imageMap.set(placeholder, obj);
      return placeholder;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) => processObjectForBase64(item, imageMap, `${path}[${index}]`));
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = processObjectForBase64(value, imageMap, `${path}.${key}`);
    }
    return result;
  }

  return obj;
}

/**
 * Format and syntax highlight JSON string
 * 支持将 base64 图片替换为可预览的图片组件
 * @param {string} jsonStr - JSON string to format
 * @returns {string} - HTML with syntax highlighting
 */
export function formatJsonWithHighlight(jsonStr) {
  if (!jsonStr) return '';

  try {
    // Try to parse and re-stringify with indentation
    const parsed = JSON.parse(jsonStr);

    // 收集并替换 base64 图片
    const imageMap = new Map();
    const processedObj = processObjectForBase64(parsed, imageMap);

    const formatted = JSON.stringify(processedObj, null, 2);

    // Apply syntax highlighting
    let highlighted = escapeHtml(formatted)
      .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
      .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
      .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
      .replace(/: (null)/g, ': <span class="json-null">$1</span>');

    // 将占位符替换为图片预览组件
    for (const [placeholder, base64Str] of imageMap) {
      const escapedPlaceholder = escapeHtml(placeholder);
      const imagePreviewHtml = createBase64ImagePreview(base64Str);
      // 替换 JSON 字符串中的占位符（可能被包裹在引号中）
      highlighted = highlighted.replace(
        new RegExp(`"${escapedPlaceholder}"`, 'g'),
        imagePreviewHtml
      );
    }

    return highlighted;
  } catch {
    // If not valid JSON, just escape and return
    return escapeHtml(jsonStr);
  }
}

/**
 * Parse request body and extract key parameters for quick preview
 * @param {string} requestBody - JSON string of request body
 * @returns {object} - Extracted parameters { model, size, response_format, etc. }
 */
export function extractRequestParams(requestBody) {
  if (!requestBody) return {};

  try {
    const parsed = JSON.parse(requestBody);
    return {
      model: parsed.model,
      size: parsed.size,
      response_format: parsed.response_format,
      seconds: parsed.seconds,
      n: parsed.n,
    };
  } catch {
    return {};
  }
}
