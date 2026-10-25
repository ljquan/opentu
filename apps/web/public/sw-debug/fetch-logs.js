/**
 * SW Debug Panel - Fetch Logs
 * Fetch 日志渲染和操作功能模块
 */

import { state, elements } from './state.js';
import { isBlacklistedUrl, filterByTimeRange, getSpeedClass } from './common.js';
import { createLogEntry } from './log-entry.js';

/**
 * Toggle pause state
 */
export function togglePause() {
  state.isPaused = !state.isPaused;
  updatePauseButton();
  
  if (!state.isPaused && state.pendingLogs.length > 0) {
    // Apply pending logs when resuming
    state.pendingLogs.forEach(log => {
      addOrUpdateLog(log, true); // true = skip render
    });
    state.pendingLogs = [];
    renderLogs();
  }
}

/**
 * Update pause button appearance
 */
export function updatePauseButton() {
  const btn = elements.togglePauseBtn;
  if (!btn) return;
  
  if (state.isPaused) {
    btn.textContent = `⏸️ 暂停`;
    if (state.pendingLogs.length > 0) {
      btn.textContent += ` (${state.pendingLogs.length})`;
    }
    btn.classList.add('paused');
  } else {
    btn.textContent = '▶️ 实时';
    btn.classList.remove('paused');
  }
}

/**
 * Toggle slow request filter
 */
export function toggleSlowRequestFilter() {
  state.filterSlowOnly = !state.filterSlowOnly;
  updateSlowRequestsUI();
  renderLogs();
}

/**
 * Update slow requests UI (highlight when filter is active)
 */
function updateSlowRequestsUI() {
  const wrapper = elements.statSlowRequestsWrapper;
  if (wrapper) {
    if (state.filterSlowOnly) {
      wrapper.classList.add('active');
    } else {
      wrapper.classList.remove('active');
    }
  }
}

/**
 * Update fetch statistics panel
 */
export function updateFetchStats() {
  const logs = state.logs.filter(l => !isBlacklistedUrl(l.url));
  
  // Total requests
  if (elements.statTotalRequests) {
    elements.statTotalRequests.textContent = logs.length;
  }
  
  // Success rate
  if (elements.statSuccessRate) {
    const successCount = logs.filter(l => l.status >= 200 && l.status < 400).length;
    const rate = logs.length > 0 ? ((successCount / logs.length) * 100).toFixed(1) : 0;
    elements.statSuccessRate.textContent = `${rate}%`;
    elements.statSuccessRate.style.color = rate >= 95 ? 'var(--success-color)' : (rate >= 80 ? 'var(--warning-color)' : 'var(--error-color)');
  }
  
  // Average duration
  if (elements.statAvgDuration) {
    const durations = logs.filter(l => l.duration > 0).map(l => l.duration);
    const avg = durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    elements.statAvgDuration.textContent = avg > 0 ? `${Math.round(avg)}ms` : '-';
    elements.statAvgDuration.style.color = avg < 500 ? 'var(--success-color)' : (avg < 1000 ? 'var(--warning-color)' : 'var(--error-color)');
  }
  
  // Cache hit rate
  if (elements.statCacheHit) {
    const cachedCount = logs.filter(l => l.cached).length;
    const rate = logs.length > 0 ? ((cachedCount / logs.length) * 100).toFixed(1) : 0;
    elements.statCacheHit.textContent = `${rate}%`;
  }
  
  // Slow requests count
  if (elements.statSlowRequests) {
    const slowCount = logs.filter(l => l.duration >= 1000).length;
    elements.statSlowRequests.textContent = slowCount;
    elements.statSlowRequests.style.color = slowCount === 0 ? 'var(--success-color)' : 'var(--warning-color)';
  }
  
  // Duration distribution chart
  updateDurationChart(logs);
}

/**
 * Update duration distribution chart
 */
function updateDurationChart(logs) {
  const logsWithDuration = logs.filter(l => l.duration > 0);
  const total = logsWithDuration.length;
  
  if (total === 0) {
    if (elements.chartFast) elements.chartFast.style.width = '0%';
    if (elements.chartMedium) elements.chartMedium.style.width = '0%';
    if (elements.chartSlow) elements.chartSlow.style.width = '0%';
    if (elements.chartVerySlow) elements.chartVerySlow.style.width = '0%';
    return;
  }
  
  // Categorize by duration
  const fast = logsWithDuration.filter(l => l.duration < 100).length;
  const medium = logsWithDuration.filter(l => l.duration >= 100 && l.duration < 500).length;
  const slow = logsWithDuration.filter(l => l.duration >= 500 && l.duration < 1000).length;
  const verySlow = logsWithDuration.filter(l => l.duration >= 1000).length;
  
  // Calculate percentages
  const fastPct = (fast / total) * 100;
  const mediumPct = (medium / total) * 100;
  const slowPct = (slow / total) * 100;
  const verySlowPct = (verySlow / total) * 100;
  
  // Update chart bars
  if (elements.chartFast) {
    elements.chartFast.style.width = `${fastPct}%`;
    elements.chartFast.title = `<100ms: ${fast} (${fastPct.toFixed(1)}%)`;
  }
  if (elements.chartMedium) {
    elements.chartMedium.style.width = `${mediumPct}%`;
    elements.chartMedium.title = `100-500ms: ${medium} (${mediumPct.toFixed(1)}%)`;
  }
  if (elements.chartSlow) {
    elements.chartSlow.style.width = `${slowPct}%`;
    elements.chartSlow.title = `500ms-1s: ${slow} (${slowPct.toFixed(1)}%)`;
  }
  if (elements.chartVerySlow) {
    elements.chartVerySlow.style.width = `${verySlowPct}%`;
    elements.chartVerySlow.title = `>1s: ${verySlow} (${verySlowPct.toFixed(1)}%)`;
  }
}

/**
 * Get filtered fetch logs based on current filters
 */
export function getFilteredFetchLogs() {
  const typeFilter = elements.filterType?.value || '';
  const statusFilter = elements.filterStatus?.value || '';
  const urlFilter = (elements.filterUrl?.value || '').toLowerCase();

  let filteredLogs = state.logs.filter(l => !isBlacklistedUrl(l.url));

  if (typeFilter) {
    filteredLogs = filteredLogs.filter(l => l.requestType === typeFilter);
  }

  if (statusFilter) {
    if (statusFilter === '500') {
      filteredLogs = filteredLogs.filter(l => l.status >= 500);
    } else {
      filteredLogs = filteredLogs.filter(l => l.status === parseInt(statusFilter));
    }
  }

  if (urlFilter) {
    filteredLogs = filteredLogs.filter(l => l.url?.toLowerCase().includes(urlFilter));
  }

  return filteredLogs;
}

/**
 * Render fetch logs
 */
export function renderLogs() {
  const typeFilter = elements.filterType?.value || '';
  const statusFilter = elements.filterStatus?.value || '';
  const timeRangeFilter = elements.filterTimeRange?.value || '';
  const urlFilter = (elements.filterUrl?.value || '').toLowerCase();

  let filteredLogs = state.logs;

  // Filter out blacklisted domains
  filteredLogs = filteredLogs.filter(l => !isBlacklistedUrl(l.url));

  if (typeFilter) {
    filteredLogs = filteredLogs.filter(l => l.requestType === typeFilter);
  }

  if (statusFilter) {
    if (statusFilter === 'error') {
      // Filter failed requests (4xx, 5xx, or has error)
      filteredLogs = filteredLogs.filter(l => l.status >= 400 || l.error);
    } else if (statusFilter === '500') {
      filteredLogs = filteredLogs.filter(l => l.status >= 500);
    } else if (statusFilter === 'slow') {
      // Filter slow requests (> 1 second)
      filteredLogs = filteredLogs.filter(l => l.duration >= 1000);
    } else {
      filteredLogs = filteredLogs.filter(l => l.status === parseInt(statusFilter));
    }
  }

  // Apply time range filter
  filteredLogs = filterByTimeRange(filteredLogs, timeRangeFilter);

  // URL filter with optional regex support
  if (urlFilter) {
    const useRegex = elements.filterUrlRegex?.checked || false;
    if (useRegex) {
      try {
        const regex = new RegExp(urlFilter, 'i');
        filteredLogs = filteredLogs.filter(l => regex.test(l.url || ''));
      } catch (e) {
        // Invalid regex, fall back to simple match
        filteredLogs = filteredLogs.filter(l => l.url?.toLowerCase().includes(urlFilter));
      }
    } else {
      filteredLogs = filteredLogs.filter(l => l.url?.toLowerCase().includes(urlFilter));
    }
  }

  // Bookmarks filter
  if (state.showBookmarksOnly) {
    filteredLogs = filteredLogs.filter(l => state.bookmarkedLogIds.has(l.id));
  }

  // Slow requests filter (via stats bar click)
  if (state.filterSlowOnly) {
    filteredLogs = filteredLogs.filter(l => l.duration >= 1000);
  }

  // Update statistics panel
  updateFetchStats();

  // Update fetch count
  if (elements.fetchCountEl) {
    const slowCount = filteredLogs.filter(l => l.duration >= 1000).length;
    const errorCount = filteredLogs.filter(l => l.status >= 400 || l.error).length;
    let countText = `(${filteredLogs.length})`;
    if (slowCount > 0 || errorCount > 0) {
      const parts = [];
      if (errorCount > 0) parts.push(`<span style="color:var(--error-color)">${errorCount} err</span>`);
      if (slowCount > 0) parts.push(`<span style="color:var(--warning-color)">${slowCount} slow</span>`);
      countText = `(${parts.join(', ')})`;
    }
    elements.fetchCountEl.innerHTML = countText;
  }

  if (filteredLogs.length === 0) {
    elements.logsContainer.innerHTML = `
      <div class="empty-state">
        <span class="icon">📋</span>
        <p>${state.debugEnabled ? '暂无匹配的日志' : '请先启用调试模式'}</p>
        ${!state.debugEnabled ? '<button id="enableDebugBtn2" class="primary">启用调试</button>' : ''}
      </div>
    `;
    const btn = document.getElementById('enableDebugBtn2');
    if (btn) {
      btn.addEventListener('click', () => {
        // This will be handled by the event listener setup
        document.getElementById('toggleDebug')?.click();
      });
    }
    return;
  }

  elements.logsContainer.innerHTML = '';
  filteredLogs.slice(0, 200).forEach(log => {
    const isExpanded = state.expandedLogIds.has(log.id);
    const isBookmarked = state.bookmarkedLogIds.has(log.id);
    const isSelected = state.selectedLogIds.has(log.id);
    const entry = createLogEntry(
      log, 
      isExpanded, 
      (id, expanded) => {
        // Update expanded state
        if (expanded) {
          state.expandedLogIds.add(id);
        } else {
          state.expandedLogIds.delete(id);
        }
      },
      isBookmarked,
      toggleBookmark,
      state.isSelectMode,
      isSelected,
      toggleLogSelection
    );
    
    // Add slow request class for highlighting
    const speedClass = getSpeedClass(log.duration);
    if (speedClass !== 'normal') {
      entry.classList.add('slow-request');
    }
    
    elements.logsContainer.appendChild(entry);
  });
}

/**
 * 判断日志是否为问题请求（错误、慢请求）
 */
function isProblemLog(log) {
  // 错误请求：状态码 >= 400 或有错误信息
  if (log.status >= 400 || log.error) return true;
  // 慢请求：耗时 >= 1秒
  if (log.duration >= 1000) return true;
  return false;
}

/**
 * 裁剪日志，优先保留问题请求和收藏
 */
function trimLogsWithPriority(maxLogs) {
  if (state.logs.length <= maxLogs) return;
  
  // 分类日志
  const bookmarked = [];
  const problems = [];
  const normal = [];
  
  state.logs.forEach(log => {
    if (state.bookmarkedLogIds.has(log.id)) {
      bookmarked.push(log);
    } else if (isProblemLog(log)) {
      problems.push(log);
    } else {
      normal.push(log);
    }
  });
  
  // 计算需要保留的数量
  const mustKeep = bookmarked.length + problems.length;
  
  if (mustKeep >= maxLogs) {
    // 问题请求太多，只保留收藏 + 部分问题请求
    const problemsToKeep = Math.max(0, maxLogs - bookmarked.length);
    state.logs = [...bookmarked, ...problems.slice(0, problemsToKeep)];
  } else {
    // 保留所有收藏和问题请求，剩余空间给正常请求
    const normalToKeep = maxLogs - mustKeep;
    state.logs = [...bookmarked, ...problems, ...normal.slice(0, normalToKeep)];
  }
  
  // 按时间排序（最新的在前）
  state.logs.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Add or update a log entry
 * @param {object} entry 
 * @param {boolean} skipRender - Skip rendering (for batch updates)
 */
export function addOrUpdateLog(entry, skipRender = false) {
  // Skip blacklisted URLs
  if (isBlacklistedUrl(entry.url)) {
    return;
  }

  // In analysis mode, save to liveLogs buffer instead of display state
  if (state.isAnalysisMode) {
    addOrUpdateLiveLog('logs', entry);
    return;
  }

  // If paused, add to pending queue
  if (state.isPaused && !skipRender) {
    state.pendingLogs.push(entry);
    updatePauseButton();
    return;
  }

  const existingIndex = state.logs.findIndex(l => l.id === entry.id);
  if (existingIndex !== -1) {
    state.logs[existingIndex] = { ...state.logs[existingIndex], ...entry };
  } else {
    state.logs.unshift(entry);
    // Use configurable max logs limit
    const maxLogs = state.settings?.maxLogs || 500;
    if (state.logs.length > maxLogs) {
      // 优先保留问题请求（错误、慢请求、收藏）
      trimLogsWithPriority(maxLogs);
    }
  }
  
  if (!skipRender) {
    renderLogs();

    if (state.autoScroll) {
      elements.logsContainer.scrollTop = 0;
    }
  }
}

/**
 * Add or update a log entry in the live logs buffer (used in analysis mode)
 * @param {string} logType - The type of log ('logs', 'consoleLogs', etc.)
 * @param {object} entry - The log entry
 */
function addOrUpdateLiveLog(logType, entry) {
  if (!state.liveLogs[logType]) {
    state.liveLogs[logType] = [];
  }
  const existingIndex = state.liveLogs[logType].findIndex(l => l.id === entry.id);
  if (existingIndex >= 0) {
    state.liveLogs[logType][existingIndex] = { ...state.liveLogs[logType][existingIndex], ...entry };
  } else {
    state.liveLogs[logType].unshift(entry);
  }
}

// ==================== Bookmark Functions ====================

/**
 * Toggle bookmark for a log entry
 * @param {string} logId
 */
export function toggleBookmark(logId) {
  if (state.bookmarkedLogIds.has(logId)) {
    state.bookmarkedLogIds.delete(logId);
  } else {
    state.bookmarkedLogIds.add(logId);
  }
  // Save to localStorage
  saveBookmarks();
  renderLogs();
}

/**
 * Save bookmarks to localStorage
 */
export function saveBookmarks() {
  try {
    localStorage.setItem('sw-debug-bookmarks', JSON.stringify([...state.bookmarkedLogIds]));
  } catch (e) {
    console.error('Failed to save bookmarks:', e);
  }
}

/**
 * Load bookmarks from localStorage
 */
export function loadBookmarks() {
  try {
    const saved = localStorage.getItem('sw-debug-bookmarks');
    if (saved) {
      state.bookmarkedLogIds = new Set(JSON.parse(saved));
    }
  } catch (e) {
    console.error('Failed to load bookmarks:', e);
  }
}

// ==================== Selection Functions ====================

/**
 * Toggle select mode for batch operations
 */
export function toggleSelectMode() {
  state.isSelectMode = !state.isSelectMode;
  state.selectedLogIds.clear();
  updateSelectModeUI();
  renderLogs();
}

/**
 * Update select mode UI
 */
function updateSelectModeUI() {
  if (elements.toggleSelectModeBtn) {
    elements.toggleSelectModeBtn.textContent = state.isSelectMode ? '✅ 取消' : '☑️ 选择';
    elements.toggleSelectModeBtn.style.background = state.isSelectMode ? 'var(--primary-color)' : '';
    elements.toggleSelectModeBtn.style.color = state.isSelectMode ? '#fff' : '';
  }
  if (elements.batchActionsEl) {
    elements.batchActionsEl.style.display = state.isSelectMode ? 'flex' : 'none';
  }
  updateSelectedCount();
}

/**
 * Update selected count display
 */
function updateSelectedCount() {
  if (elements.selectedCountEl) {
    elements.selectedCountEl.textContent = `已选 ${state.selectedLogIds.size} 条`;
  }
}

/**
 * Toggle selection of a log entry
 */
export function toggleLogSelection(logId) {
  if (state.selectedLogIds.has(logId)) {
    state.selectedLogIds.delete(logId);
  } else {
    state.selectedLogIds.add(logId);
  }
  updateSelectedCount();
  // Update checkbox in DOM
  const checkbox = document.querySelector(`.log-select-checkbox[data-id="${logId}"]`);
  if (checkbox) {
    checkbox.checked = state.selectedLogIds.has(logId);
  }
}

/**
 * Select all visible logs
 */
export function selectAllLogs() {
  const filteredLogs = getFilteredFetchLogs();
  const allSelected = filteredLogs.every(l => state.selectedLogIds.has(l.id));
  
  if (allSelected) {
    // Deselect all
    filteredLogs.forEach(l => state.selectedLogIds.delete(l.id));
  } else {
    // Select all
    filteredLogs.forEach(l => state.selectedLogIds.add(l.id));
  }
  
  updateSelectedCount();
  renderLogs();
}

/**
 * Batch bookmark selected logs
 */
export function batchBookmarkLogs() {
  if (state.selectedLogIds.size === 0) {
    alert('请先选择日志');
    return;
  }
  
  state.selectedLogIds.forEach(id => {
    state.bookmarkedLogIds.add(id);
  });
  
  saveBookmarks();
  state.selectedLogIds.clear();
  updateSelectedCount();
  renderLogs();
}

/**
 * Batch delete selected logs
 */
export function batchDeleteLogs() {
  if (state.selectedLogIds.size === 0) {
    alert('请先选择日志');
    return;
  }
  
  if (!confirm(`确定要删除选中的 ${state.selectedLogIds.size} 条日志吗？`)) {
    return;
  }
  
  state.logs = state.logs.filter(l => !state.selectedLogIds.has(l.id));
  
  // Also remove from bookmarks
  state.selectedLogIds.forEach(id => {
    state.bookmarkedLogIds.delete(id);
  });
  saveBookmarks();
  
  state.selectedLogIds.clear();
  updateSelectedCount();
  renderLogs();
}

// ==================== CSV Export ====================

/**
 * Export fetch logs as CSV
 */
export function exportFetchCSV() {
  const filteredLogs = getFilteredFetchLogs();
  if (filteredLogs.length === 0) {
    alert('没有可导出的日志');
    return;
  }
  
  // CSV header
  const headers = ['时间', '方法', '状态', 'URL', '耗时(ms)', '类型', '缓存'];
  const rows = [headers.join(',')];
  
  // CSV rows
  filteredLogs.forEach(log => {
    const time = new Date(log.timestamp).toLocaleString('zh-CN', { hour12: false });
    const row = [
      `"${time}"`,
      log.method || 'GET',
      log.status || '-',
      `"${(log.url || '').replace(/"/g, '""')}"`,
      log.duration || '',
      log.requestType || '-',
      log.cached ? '是' : '否'
    ];
    rows.push(row.join(','));
  });
  
  const csvContent = '\uFEFF' + rows.join('\n'); // BOM for Excel
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fetch-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Copy filtered fetch logs to clipboard
 */
export async function handleCopyFetchLogs() {
  const filteredLogs = getFilteredFetchLogs();

  if (filteredLogs.length === 0) {
    alert('没有可复制的日志');
    return;
  }

  // Format logs as text
  const logText = filteredLogs.map(log => {
    const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
    const method = log.method || 'GET';
    const status = log.status || '-';
    const duration = log.duration ? `${log.duration}ms` : '-';
    const cached = log.cached ? ' [缓存]' : '';
    const url = log.url || '-';
    return `${time} ${method} ${status} ${url} (${duration})${cached}`;
  }).join('\n');

  try {
    await navigator.clipboard.writeText(logText);
    const btn = elements.copyFetchLogsBtn;
    const originalText = btn.textContent;
    btn.textContent = '✅ 已复制';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1500);
  } catch (err) {
    console.error('Failed to copy:', err);
    alert('复制失败');
  }
}

// ==================== Related Requests ====================

/**
 * Find related requests based on URL pattern or timing
 * @param {object} log - The log entry to find related requests for
 * @returns {Array} - Array of related log entries
 */
export function findRelatedRequests(log) {
  if (!log.url) return [];
  
  try {
    const urlObj = new URL(log.url);
    const basePath = urlObj.pathname.split('/').slice(0, 3).join('/'); // First 2 path segments
    const timestamp = log.timestamp;
    const timeWindow = 5000; // 5 second window
    
    return state.logs.filter(l => {
      if (l.id === log.id) return false;
      if (!l.url) return false;
      
      try {
        const otherUrl = new URL(l.url);
        
        // Same host
        if (otherUrl.hostname !== urlObj.hostname) return false;
        
        // Similar path OR within time window
        const otherBasePath = otherUrl.pathname.split('/').slice(0, 3).join('/');
        const pathMatch = otherBasePath === basePath;
        const timeMatch = Math.abs(l.timestamp - timestamp) <= timeWindow;
        
        return pathMatch || timeMatch;
      } catch {
        return false;
      }
    }).slice(0, 10); // Limit to 10 related requests
  } catch {
    return [];
  }
}

/**
 * Render related requests section for log details
 * @param {object} log - The log entry
 * @returns {string} - HTML string
 */
export function renderRelatedRequests(log) {
  const related = findRelatedRequests(log);
  if (related.length === 0) return '';
  
  const items = related.map(r => {
    const time = new Date(r.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
    const status = r.status || '...';
    const statusClass = r.status >= 200 && r.status < 400 ? 'success' : (r.status >= 400 ? 'error' : '');
    const duration = r.duration ? `${r.duration}ms` : '-';
    // Show full URL, let CSS handle wrapping
    const displayUrl = r.url || '-';
    
    return `
      <div class="related-request" data-id="${r.id}" style="padding: 4px 8px; cursor: pointer; border-radius: 4px; margin-bottom: 4px; background: var(--bg-tertiary); word-break: break-word;">
        <span style="color: var(--text-muted); font-size: 11px;">${time}</span>
        <span class="log-status ${statusClass}" style="font-size: 11px; margin-left: 8px;">${status}</span>
        <span style="margin-left: 8px; font-size: 12px;">${displayUrl}</span>
        <span style="color: var(--text-muted); font-size: 11px; margin-left: 8px;">${duration}</span>
      </div>
    `;
  }).join('');
  
  return `
    <div class="detail-section" style="margin-top: 12px;">
      <h4>🔗 相关请求 (${related.length})</h4>
      <div class="related-requests-list" style="margin-top: 8px; max-height: 200px; overflow-y: auto;">
        ${items}
      </div>
    </div>
  `;
}

// Make renderRelatedRequests available globally
window.renderRelatedRequests = renderRelatedRequests;
