/**
 * SW Debug Panel - Main Application
 * 主入口文件 - 组织各模块并初始化应用
 */

// Core modules
import { state, elements, cacheElements } from './state.js';
import { downloadJson, formatTime } from './utils.js';
import { escapeHtml } from './common.js';

// Log entry components
import { createLogEntry } from './log-entry.js';
import { createConsoleEntry } from './console-entry.js';
import { createPostMessageEntry } from './postmessage-entry.js';

// Panel components
import {
  updateSwStatus,
  updateStatusPanel,
  updateDebugButton,
} from './status-panel.js';
import { extractUniqueTypes, updateTypeSelectOptions } from './log-panel.js';

// SW Communication
import {
  enableDebug,
  disableDebug,
  refreshStatus,
  loadFetchLogs,
  clearFetchLogs,
  clearConsoleLogs,
  loadConsoleLogs,
  loadPostMessageLogs,
  clearPostMessageLogs as clearPostMessageLogsInSW,
  loadCacheStats,
  checkSwReady,
  registerMessageHandlers,
  onControllerChange,
  setPostMessageLogCallback,
  ensureDuplexInitialized,
} from './sw-communication.js';

// Feature modules
import { performBackup } from './backup.js';
import { triggerRestoreDialog, handleRestoreFile } from './backup-restore.js';
import {
  toggleAnalysisMode,
  updateAnalysisModeUI,
  showImportPrompt,
  triggerImportDialog,
  handleLogImport,
  setAnalysisModeCallbacks,
} from './analysis-mode.js';
import {
  toggleTheme,
  loadTheme,
  showSettingsModal,
  closeSettingsModal,
  saveSettings,
  loadSettings,
  showShortcutsModal,
  closeShortcutsModal,
  setThemeSettingsCallbacks,
} from './theme-settings.js';
import {
  loadLLMApiLogs,
  handleClearLLMApiLogs,
  handleCopyLLMApiLogs,
  handleExportLLMApiLogs,
  renderLLMApiLogs,
  toggleLLMApiSelectMode,
  selectAllLLMApiLogs,
  batchDeleteLLMApiLogs,
  onFilterChange as onLLMApiFilterChange,
} from './llmapi-logs.js';
import { initGistManagement } from './gist-management.js';
import {
  loadCrashLogs,
  handleClearCrashLogs,
  handleCopyCrashLogs,
  handleExportCrashLogs,
  renderCrashLogs,
  updateCrashCount,
  updateMemoryDisplay,
  startMemoryMonitoring,
  stopMemoryMonitoring,
} from './memory-logs.js';
import {
  openExportModal,
  closeExportModal,
  setupExportModalCheckboxes,
  exportLogs,
} from './export-modal.js';
import {
  renderLogs,
  togglePause,
  toggleSlowRequestFilter,
  updateFetchStats,
  getFilteredFetchLogs,
  addOrUpdateLog,
  toggleBookmark,
  saveBookmarks,
  loadBookmarks,
  toggleSelectMode,
  selectAllLogs,
  batchBookmarkLogs,
  batchDeleteLogs,
  exportFetchCSV,
  handleCopyFetchLogs,
  toggleLogSelection,
} from './fetch-logs.js';

import { showToast } from './toast.js';
import { filterByTimeRange } from './common.js';

// ==================== Console Logs ====================

/**
 * Render console logs
 */
function renderConsoleLogs() {
  const levelFilter = elements.filterConsoleLevel?.value || '';
  const textFilter = (elements.filterConsoleText?.value || '').toLowerCase();

  let filteredLogs = state.consoleLogs;

  if (levelFilter) {
    filteredLogs = filteredLogs.filter((l) => l.logLevel === levelFilter);
  }

  if (textFilter) {
    filteredLogs = filteredLogs.filter(
      (l) =>
        l.logMessage?.toLowerCase().includes(textFilter) ||
        l.logStack?.toLowerCase().includes(textFilter)
    );
  }

  // Update count
  updateConsoleCount();

  if (filteredLogs.length === 0) {
    elements.consoleLogsContainer.innerHTML = `
      <div class="empty-state">
        <span class="icon">📝</span>
        <p>暂无控制台日志</p>
      </div>
    `;
    return;
  }

  elements.consoleLogsContainer.innerHTML = '';
  filteredLogs.slice(0, 200).forEach((log) => {
    const isExpanded = state.expandedStackIds.has(log.id);
    const entry = createConsoleEntry(log, isExpanded, (id, expanded) => {
      if (expanded) {
        state.expandedStackIds.add(id);
      } else {
        state.expandedStackIds.delete(id);
      }
    });
    elements.consoleLogsContainer.appendChild(entry);
  });
}

/**
 * Update console log count indicator
 */
function updateConsoleCount() {
  const errorCount = state.consoleLogs.filter(
    (l) => l.logLevel === 'error'
  ).length;
  const warnCount = state.consoleLogs.filter(
    (l) => l.logLevel === 'warn'
  ).length;

  if (errorCount > 0) {
    elements.consoleCountEl.innerHTML = `(<span style="color:var(--error-color)">${errorCount} errors</span>)`;
  } else if (warnCount > 0) {
    elements.consoleCountEl.innerHTML = `(<span style="color:var(--warning-color)">${warnCount} warns</span>)`;
  } else {
    elements.consoleCountEl.textContent = `(${state.consoleLogs.length})`;
  }
}

/**
 * Add a console log entry (real-time)
 * @param {object} entry
 */
function addConsoleLog(entry) {
  // In analysis mode, save to liveLogs buffer instead of display state
  if (state.isAnalysisMode) {
    // Check for duplicates in liveLogs
    if (state.liveLogs.consoleLogs.some((l) => l.id === entry.id)) {
      return;
    }
    state.liveLogs.consoleLogs.unshift(entry);
    if (state.liveLogs.consoleLogs.length > 500) {
      state.liveLogs.consoleLogs.pop();
    }
    return;
  }

  // Check for duplicates (in case of race condition with initial load)
  if (state.consoleLogs.some((l) => l.id === entry.id)) {
    return;
  }

  state.consoleLogs.unshift(entry);
  if (state.consoleLogs.length > 500) {
    state.consoleLogs.pop();
  }

  if (state.activeTab === 'console') {
    renderConsoleLogs();
  } else {
    updateConsoleCount();
    // Update error dot if new error
    if (entry.logLevel === 'error') {
      updateErrorDots();
    }
  }
}

// ==================== PostMessage Logs ====================

/**
 * Update message type select options based on current logs
 */
function updateMessageTypeOptions() {
  const types = extractUniqueTypes(state.postmessageLogs, 'messageType');
  if (elements.filterMessageTypeSelect) {
    updateTypeSelectOptions(elements.filterMessageTypeSelect, types);
  }
}

/**
 * Render postmessage logs
 */
function renderPostmessageLogs() {
  const sourceFilter = elements.filterMessageSource?.value || '';
  const typeSelectFilter = elements.filterMessageTypeSelect?.value || '';
  const timeRangeFilter = elements.filterPmTimeRange?.value || '';
  const typeFilter = (elements.filterMessageType?.value || '').toLowerCase();

  let filteredLogs = state.postmessageLogs;

  // 按来源过滤（从 SW 角度：receive = 应用页面发送, send = SW 发送）
  if (sourceFilter === 'main') {
    filteredLogs = filteredLogs.filter((l) => l.direction === 'receive');
  } else if (sourceFilter === 'sw') {
    filteredLogs = filteredLogs.filter((l) => l.direction === 'send');
  }

  // 下拉选择器过滤（精确匹配）
  if (typeSelectFilter) {
    filteredLogs = filteredLogs.filter(
      (l) => l.messageType === typeSelectFilter
    );
  }

  // 时间范围过滤
  filteredLogs = filterByTimeRange(filteredLogs, timeRangeFilter);

  // 搜索框过滤（模糊匹配）
  if (typeFilter) {
    filteredLogs = filteredLogs.filter((l) =>
      l.messageType?.toLowerCase().includes(typeFilter)
    );
  }

  // Update count
  updatePostmessageCount();

  if (filteredLogs.length === 0) {
    elements.postmessageLogsContainer.innerHTML = `
      <div class="empty-state">
        <span class="icon">📨</span>
        <p>暂无 PostMessage 日志</p>
        <p style="font-size: 12px; opacity: 0.7;">记录主线程与 Service Worker 之间的消息通信</p>
      </div>
    `;
    return;
  }

  elements.postmessageLogsContainer.innerHTML = '';
  filteredLogs.slice(0, 200).forEach((log) => {
    const isExpanded = state.expandedPmIds.has(log.id);
    const entry = createPostMessageEntry(log, isExpanded, (id, expanded) => {
      if (expanded) {
        state.expandedPmIds.add(id);
      } else {
        state.expandedPmIds.delete(id);
      }
    });
    elements.postmessageLogsContainer.appendChild(entry);
  });
}

/**
 * Update postmessage log count indicator
 */
function updatePostmessageCount() {
  // 从 SW 角度：receive = 应用页面发送，send = SW 发送
  const mainCount = state.postmessageLogs.filter(
    (l) => l.direction === 'receive'
  ).length;
  const swCount = state.postmessageLogs.filter(
    (l) => l.direction === 'send'
  ).length;

  if (state.postmessageLogs.length > 0) {
    elements.postmessageCountEl.innerHTML = `(<span style="color:var(--success-color)">应用${mainCount}</span> <span style="color:var(--primary-color)">SW${swCount}</span>)`;
  } else {
    elements.postmessageCountEl.textContent = '(0)';
  }
}

/**
 * Add or update a postmessage log entry
 * @param {object} entry
 */
function addPostmessageLog(entry) {
  // In analysis mode, save to liveLogs buffer instead of display state
  if (state.isAnalysisMode) {
    // Check for existing entry to update (when response is linked to request)
    const existingIndex = state.liveLogs.postmessageLogs.findIndex(
      (l) => l.id === entry.id
    );
    if (existingIndex !== -1) {
      // Update existing entry (merge response data)
      state.liveLogs.postmessageLogs[existingIndex] = {
        ...state.liveLogs.postmessageLogs[existingIndex],
        ...entry,
      };
      return;
    }
    state.liveLogs.postmessageLogs.unshift(entry);
    if (state.liveLogs.postmessageLogs.length > 500) {
      state.liveLogs.postmessageLogs.pop();
    }
    return;
  }

  // If paused, add to pending queue
  if (state.isPmPaused) {
    state.pendingPmLogs.push(entry);
    updatePmPauseButton();
    return;
  }

  // Check for existing entry to update (when response is linked to request)
  const existingIndex = state.postmessageLogs.findIndex(
    (l) => l.id === entry.id
  );
  if (existingIndex !== -1) {
    // Update existing entry (merge response data)
    const wasExpanded = state.expandedPmLogs?.has(entry.id);
    state.postmessageLogs[existingIndex] = {
      ...state.postmessageLogs[existingIndex],
      ...entry,
    };
    // Re-render to show updated data
    if (state.activeTab === 'postmessage') {
      renderPostmessageLogs();
    }
    return;
  }

  state.postmessageLogs.unshift(entry);
  if (state.postmessageLogs.length > 500) {
    state.postmessageLogs.pop();
  }

  // 更新消息类型下拉选项
  updateMessageTypeOptions();

  if (state.activeTab === 'postmessage') {
    renderPostmessageLogs();
  } else {
    updatePostmessageCount();
  }
}

/**
 * Toggle PostMessage logs pause state
 */
function togglePmPause() {
  state.isPmPaused = !state.isPmPaused;
  updatePmPauseButton();

  if (!state.isPmPaused && state.pendingPmLogs.length > 0) {
    // Apply pending logs when resuming
    state.pendingPmLogs.forEach((entry) => {
      if (!state.postmessageLogs.some((l) => l.id === entry.id)) {
        state.postmessageLogs.unshift(entry);
      }
    });
    // Trim to max
    if (state.postmessageLogs.length > 500) {
      state.postmessageLogs.length = 500;
    }
    state.pendingPmLogs = [];
    updateMessageTypeOptions();
    renderPostmessageLogs();
  }
}

/**
 * Update PostMessage pause button appearance
 */
function updatePmPauseButton() {
  const btn = elements.togglePmPauseBtn;
  if (!btn) return;

  const playIcon =
    '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  const pauseIcon =
    '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

  if (state.isPmPaused) {
    let text = '暂停';
    if (state.pendingPmLogs.length > 0) {
      text += ` (${state.pendingPmLogs.length})`;
    }
    btn.innerHTML = `${pauseIcon} ${text}`;
    btn.classList.add('paused');
  } else {
    btn.innerHTML = `${playIcon} 实时`;
    btn.classList.remove('paused');
  }
}

/**
 * Clear postmessage logs
 */
function handleClearPostmessageLogs() {
  state.postmessageLogs = [];
  clearPostMessageLogsInSW(); // Also clear in SW
  renderPostmessageLogs();
}

/**
 * Get filtered postmessage logs based on current filters
 */
function getFilteredPostmessageLogs() {
  const sourceFilter = elements.filterMessageSource?.value || '';
  const typeSelectFilter = elements.filterMessageTypeSelect?.value || '';
  const typeFilter = (elements.filterMessageType?.value || '').toLowerCase();

  let filteredLogs = state.postmessageLogs;

  // 按来源过滤
  if (sourceFilter === 'main') {
    filteredLogs = filteredLogs.filter((l) => l.direction === 'receive');
  } else if (sourceFilter === 'sw') {
    filteredLogs = filteredLogs.filter((l) => l.direction === 'send');
  }

  if (typeSelectFilter) {
    filteredLogs = filteredLogs.filter(
      (l) => l.messageType === typeSelectFilter
    );
  }

  if (typeFilter) {
    filteredLogs = filteredLogs.filter((l) =>
      l.messageType?.toLowerCase().includes(typeFilter)
    );
  }

  return filteredLogs;
}

/**
 * Copy filtered postmessage logs to clipboard
 */
async function handleCopyPostmessageLogs() {
  const filteredLogs = getFilteredPostmessageLogs();

  if (filteredLogs.length === 0) {
    alert('没有可复制的日志');
    return;
  }

  // Format logs as text
  const logText = filteredLogs
    .map((log) => {
      const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', {
        hour12: false,
      });
      // 从 SW 角度：receive = 应用页面发送，send = SW 发送
      const source = log.direction === 'receive' ? '应用页面' : 'SW';
      const type = log.messageType || 'unknown';
      const data = log.data ? JSON.stringify(log.data, null, 2) : '';
      const response =
        log.response !== undefined
          ? `\n  响应: ${JSON.stringify(log.response, null, 2)}`
          : '';
      const error = log.error ? `\n  错误: ${log.error}` : '';
      return `${time} [${source}] ${type}\n  数据: ${data}${response}${error}`;
    })
    .join('\n\n');

  try {
    await navigator.clipboard.writeText(logText);
    // Visual feedback
    const btn = elements.copyPostmessageLogsBtn;
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

// ==================== Error Dots ====================

/**
 * Update error dot indicators
 */
function updateErrorDots() {
  // Console errors
  if (elements.consoleErrorDot) {
    const hasErrors = state.consoleLogs.some((l) => l.logLevel === 'error');
    elements.consoleErrorDot.style.display =
      hasErrors && state.activeTab !== 'console' ? 'inline-block' : 'none';
  }

  // LLM API errors
  if (elements.llmapiErrorDot) {
    const hasErrors = state.llmapiLogs.some((l) => l.status === 'error');
    elements.llmapiErrorDot.style.display =
      hasErrors && state.activeTab !== 'llmapi' ? 'inline-block' : 'none';
  }

  // Crash/memory errors
  if (elements.crashErrorDot) {
    const hasErrors = state.crashLogs.some(
      (l) =>
        l.type === 'error' || l.type === 'freeze' || l.type === 'whitescreen'
    );
    elements.crashErrorDot.style.display =
      hasErrors && state.activeTab !== 'crash' ? 'inline-block' : 'none';
  }
}

// ==================== Console Log Handlers ====================

/**
 * Clear console logs only
 */
function handleClearConsoleLogs() {
  clearConsoleLogs();
  state.consoleLogs = [];
  renderConsoleLogs();
}

/**
 * Copy filtered console logs to clipboard
 */
async function handleCopyConsoleLogs() {
  const levelFilter = elements.filterConsoleLevel?.value || '';
  const textFilter = (elements.filterConsoleText?.value || '').toLowerCase();

  let filteredLogs = state.consoleLogs;

  if (levelFilter) {
    filteredLogs = filteredLogs.filter((l) => l.logLevel === levelFilter);
  }

  if (textFilter) {
    filteredLogs = filteredLogs.filter(
      (l) =>
        l.logMessage?.toLowerCase().includes(textFilter) ||
        l.logStack?.toLowerCase().includes(textFilter)
    );
  }

  if (filteredLogs.length === 0) {
    alert('没有可复制的日志');
    return;
  }

  // Format logs as text with all details
  const logText = filteredLogs
    .map((log) => {
      const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', {
        hour12: false,
      });
      const level = `[${log.logLevel.toUpperCase()}]`;
      const message = log.logMessage || '';
      const source = log.logSource ? `\n  来源: ${log.logSource}` : '';
      const url = log.url ? `\n  页面: ${log.url}` : '';
      const stack = log.logStack
        ? `\n  堆栈:\n    ${log.logStack.split('\n').join('\n    ')}`
        : '';
      return `${time} ${level} ${message}${source}${url}${stack}`;
    })
    .join('\n\n');

  try {
    await navigator.clipboard.writeText(logText);
    // Visual feedback
    const btn = elements.copyConsoleLogsBtn;
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

// ==================== Debug Toggle and Clear ====================

/**
 * Toggle debug mode
 */
function toggleDebug() {
  if (state.debugEnabled) {
    disableDebug();
  } else {
    enableDebug();
  }
}

/**
 * Clear all logs (Fetch, Console, PostMessage, and Memory logs)
 * Note: LLM API logs are NOT cleared here as they are important for cost tracking
 */
function handleClearLogs() {
  // Clear Fetch logs
  clearFetchLogs();
  state.logs = [];
  renderLogs();

  // Clear Console logs
  clearConsoleLogs();
  state.consoleLogs = [];
  renderConsoleLogs();

  // Clear PostMessage logs
  clearPostMessageLogsInSW();
  state.postmessageLogs = [];
  renderPostmessageLogs();

  // Clear Memory logs (crash snapshots)
  handleClearCrashLogs();
}

// ==================== Tab Switching ====================

/**
 * Switch active tab
 * @param {string} tabName
 * @param {boolean} updateUrl - Whether to update URL parameter (default: true)
 */
function switchTab(tabName, updateUrl = true) {
  state.activeTab = tabName;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach((c) => {
    c.classList.toggle('active', c.id === tabName + 'Tab');
  });

  // Update URL parameter
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabName);
    window.history.replaceState({}, '', url.toString());
  }

  // Update error dots (hide dot for active tab)
  updateErrorDots();

  if (tabName === 'fetch') {
    renderLogs();
  } else if (tabName === 'console') {
    renderConsoleLogs();
  } else if (tabName === 'postmessage') {
    renderPostmessageLogs();
  } else if (tabName === 'llmapi') {
    loadLLMApiLogs();
  } else if (tabName === 'crash') {
    loadCrashLogs();
  } else if (tabName === 'gist') {
    // Gist data is loaded manually via refresh button
  }
}

// ==================== Status Update Handler ====================

/**
 * Handle SW status update
 * Supports both RPC format { status: {...} } and native message format { debugModeEnabled, swVersion, ... }
 * @param {object} data
 */
function handleStatusUpdate(data) {
  // Normalize: RPC returns { status: {...} }, native message returns flat object
  let status;
  if (data.status) {
    // RPC format
    status = data.status;
  } else if (
    data.debugModeEnabled !== undefined ||
    data.swVersion !== undefined
  ) {
    // Native message format - normalize field names
    status = {
      ...data,
      version: data.swVersion || data.version,
    };
  } else {
    // Unknown format, use data directly
    status = data;
  }

  updateSwStatus(elements.swStatus, true, status?.version);
  state.debugEnabled = updateStatusPanel(status, elements);
  state.swStatus = status; // Store for export
  updateDebugButton(elements.toggleDebugBtn, state.debugEnabled);
  try {
    sessionStorage.setItem('sw-debug-enabled', String(state.debugEnabled));
  } catch (err) {
    void err;
  }
}

// ==================== Event Listeners Setup ====================

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Analysis mode event listeners
  elements.toggleAnalysisModeBtn?.addEventListener('click', toggleAnalysisMode);
  elements.importLogsBtn?.addEventListener('click', triggerImportDialog);
  elements.importLogsInput?.addEventListener('change', handleLogImport);

  // Backup button event listener
  elements.backupDataBtn?.addEventListener('click', performBackup);

  // Restore button event listeners
  elements.restoreBackupBtn?.addEventListener('click', triggerRestoreDialog);
  elements.restoreBackupInput?.addEventListener('change', handleRestoreFile);

  elements.toggleDebugBtn?.addEventListener('click', toggleDebug);
  elements.exportLogsBtn?.addEventListener('click', openExportModal);
  elements.doExportBtn?.addEventListener('click', exportLogs);
  elements.closeExportModalBtn?.addEventListener('click', closeExportModal);
  elements.cancelExportBtn?.addEventListener('click', closeExportModal);
  elements.clearLogsBtn.addEventListener('click', handleClearLogs);

  // Close modal when clicking overlay
  elements.exportModalOverlay?.addEventListener('click', (e) => {
    if (e.target === elements.exportModalOverlay) {
      closeExportModal();
    }
  });

  // Setup export modal checkboxes
  setupExportModalCheckboxes();

  elements.refreshStatusBtn.addEventListener('click', async () => {
    refreshStatus();
    loadFetchLogs();
  });
  elements.refreshCacheBtn.addEventListener('click', refreshStatus);
  elements.enableDebugBtn?.addEventListener('click', toggleDebug);
  elements.clearConsoleLogsBtn?.addEventListener(
    'click',
    handleClearConsoleLogs
  );
  elements.copyConsoleLogsBtn?.addEventListener('click', handleCopyConsoleLogs);

  elements.filterType?.addEventListener('change', renderLogs);
  elements.filterStatus?.addEventListener('change', renderLogs);
  elements.filterTimeRange?.addEventListener('change', renderLogs);
  elements.filterUrl?.addEventListener('input', renderLogs);

  // 慢请求点击过滤
  elements.statSlowRequestsWrapper?.addEventListener('click', () => {
    toggleSlowRequestFilter();
  });
  elements.togglePauseBtn?.addEventListener('click', togglePause);
  elements.toggleSelectModeBtn?.addEventListener('click', toggleSelectMode);
  elements.selectAllBtn?.addEventListener('click', selectAllLogs);
  elements.batchBookmarkBtn?.addEventListener('click', batchBookmarkLogs);
  elements.batchDeleteBtn?.addEventListener('click', batchDeleteLogs);
  elements.filterUrlRegex?.addEventListener('change', renderLogs);
  elements.copyFetchLogsBtn?.addEventListener('click', handleCopyFetchLogs);
  elements.exportFetchCSVBtn?.addEventListener('click', exportFetchCSV);
  elements.showShortcutsBtn?.addEventListener('click', showShortcutsModal);
  elements.showBookmarksOnly?.addEventListener('change', (e) => {
    state.showBookmarksOnly = e.target.checked;
    renderLogs();
  });
  elements.closeShortcutsModalBtn?.addEventListener(
    'click',
    closeShortcutsModal
  );
  elements.shortcutsModalOverlay?.addEventListener('click', (e) => {
    if (e.target === elements.shortcutsModalOverlay) {
      closeShortcutsModal();
    }
  });
  elements.toggleThemeBtn?.addEventListener('click', toggleTheme);
  elements.showSettingsBtn?.addEventListener('click', showSettingsModal);
  elements.closeSettingsModalBtn?.addEventListener('click', closeSettingsModal);
  elements.saveSettingsBtn?.addEventListener('click', saveSettings);
  elements.settingsModalOverlay?.addEventListener('click', (e) => {
    if (e.target === elements.settingsModalOverlay) {
      closeSettingsModal();
    }
  });
  elements.filterConsoleLevel?.addEventListener('change', renderConsoleLogs);
  elements.filterConsoleText?.addEventListener('input', renderConsoleLogs);
  elements.autoScrollCheckbox?.addEventListener('change', (e) => {
    state.autoScroll = e.target.checked;
  });

  // PostMessage log event listeners
  elements.togglePmPauseBtn?.addEventListener('click', togglePmPause);
  elements.filterMessageSource?.addEventListener(
    'change',
    renderPostmessageLogs
  );
  elements.filterMessageTypeSelect?.addEventListener(
    'change',
    renderPostmessageLogs
  );
  elements.filterPmTimeRange?.addEventListener('change', renderPostmessageLogs);
  elements.filterMessageType?.addEventListener('input', renderPostmessageLogs);
  elements.clearPostmessageLogsBtn?.addEventListener(
    'click',
    handleClearPostmessageLogs
  );
  elements.copyPostmessageLogsBtn?.addEventListener(
    'click',
    handleCopyPostmessageLogs
  );

  // LLM API log event listeners
  elements.filterLLMApiType?.addEventListener('change', onLLMApiFilterChange);
  elements.filterLLMApiStatus?.addEventListener('change', onLLMApiFilterChange);
  elements.refreshLLMApiLogsBtn?.addEventListener('click', loadLLMApiLogs);
  elements.copyLLMApiLogsBtn?.addEventListener('click', handleCopyLLMApiLogs);
  elements.exportLLMApiLogsBtn?.addEventListener(
    'click',
    handleExportLLMApiLogs
  );
  elements.clearLLMApiLogsBtn?.addEventListener('click', handleClearLLMApiLogs);
  // LLM API select mode
  elements.toggleLLMApiSelectModeBtn?.addEventListener(
    'click',
    toggleLLMApiSelectMode
  );
  elements.llmapiSelectAllBtn?.addEventListener('click', selectAllLLMApiLogs);
  elements.llmapiBatchDeleteBtn?.addEventListener(
    'click',
    batchDeleteLLMApiLogs
  );

  // Crash log event listeners
  elements.filterCrashType?.addEventListener('change', renderCrashLogs);
  elements.refreshCrashLogsBtn?.addEventListener('click', loadCrashLogs);
  elements.copyCrashLogsBtn?.addEventListener('click', handleCopyCrashLogs);
  elements.clearCrashLogsBtn?.addEventListener('click', handleClearCrashLogs);
  elements.exportCrashLogsBtn?.addEventListener('click', handleExportCrashLogs);

  // Tab switching
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Mobile status panel toggle
  const toggleStatusPanelBtn = document.getElementById('toggleStatusPanel');
  const leftPanel = document.querySelector('.left-panel');
  if (toggleStatusPanelBtn && leftPanel) {
    toggleStatusPanelBtn.addEventListener('click', () => {
      const isVisible = leftPanel.classList.toggle('mobile-visible');
      toggleStatusPanelBtn.classList.toggle('active', isVisible);
    });

    // Close panel when clicking outside (on logs area)
    document.querySelector('.logs-panel')?.addEventListener('click', () => {
      if (leftPanel.classList.contains('mobile-visible')) {
        leftPanel.classList.remove('mobile-visible');
        toggleStatusPanelBtn.classList.remove('active');
      }
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ignore if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    // Space - Toggle pause (when in fetch tab)
    if (e.code === 'Space' && state.activeTab === 'fetch') {
      e.preventDefault();
      togglePause();
    }

    // Number keys 1-5 to switch tabs
    const tabMap = {
      1: 'fetch',
      2: 'console',
      3: 'postmessage',
      4: 'llmapi',
      5: 'crash',
      6: 'gist',
    };
    if (tabMap[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      switchTab(tabMap[e.key]);
    }

    // Escape - Close any open modals
    if (e.key === 'Escape') {
      closeExportModal();
      closeShortcutsModal();
    }

    // ? - Show shortcuts help
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      showShortcutsModal();
    }

    // Ctrl/Cmd + L - Clear current tab logs
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      if (state.activeTab === 'fetch') {
        handleClearLogs();
      } else if (state.activeTab === 'console') {
        handleClearConsoleLogs();
      } else if (state.activeTab === 'postmessage') {
        handleClearPostmessageLogs();
      } else if (state.activeTab === 'llmapi') {
        handleClearLLMApiLogs();
      } else if (state.activeTab === 'crash') {
        handleClearCrashLogs();
      }
    }
  });
}

// ==================== SW Message Handlers ====================

/**
 * Add or update a log entry in the live logs buffer (used in analysis mode)
 * @param {string} logType - The type of log ('logs', 'consoleLogs', etc.)
 * @param {object} entry - The log entry
 */
function addOrUpdateLiveLog(logType, entry) {
  if (!state.liveLogs[logType]) {
    state.liveLogs[logType] = [];
  }
  const existingIndex = state.liveLogs[logType].findIndex(
    (l) => l.id === entry.id
  );
  if (existingIndex >= 0) {
    state.liveLogs[logType][existingIndex] = {
      ...state.liveLogs[logType][existingIndex],
      ...entry,
    };
  } else {
    state.liveLogs[logType].unshift(entry);
  }
}

/**
 * Setup SW message handlers
 * In analysis mode, live logs are stored separately (state.liveLogs) and not displayed.
 * When exiting analysis mode, live logs are restored to the display state.
 */
function setupMessageHandlers() {
  registerMessageHandlers({
    SW_DEBUG_STATUS: handleStatusUpdate,
    SW_DEBUG_ENABLED: () => {
      state.debugEnabled = true;
      try {
        sessionStorage.setItem('sw-debug-enabled', 'true');
      } catch (err) {
        void err;
      }
      updateDebugButton(elements.toggleDebugBtn, true);
      // Update status panel text to show "开启"
      if (elements.debugMode) {
        elements.debugMode.textContent = '开启';
      }
      if (!state.isAnalysisMode) {
        renderLogs(); // Refresh to remove "enable debug" button
      }
      // Refresh status after debug enabled to get latest state
      // This ensures cache stats and other info are up-to-date
      refreshStatus();
    },
    SW_DEBUG_DISABLED: () => {
      state.debugEnabled = false;
      try {
        sessionStorage.setItem('sw-debug-enabled', 'false');
      } catch (err) {
        void err;
      }
      updateDebugButton(elements.toggleDebugBtn, false);
      // Update status panel text to show "关闭"
      if (elements.debugMode) {
        elements.debugMode.textContent = '关闭';
      }
      if (!state.isAnalysisMode) {
        renderLogs(); // Refresh to show "enable debug" button
      }
    },
    SW_DEBUG_LOG: (data) => {
      if (state.isAnalysisMode) {
        // Store in live logs buffer, don't display
        addOrUpdateLiveLog('logs', data.entry);
      } else {
        addOrUpdateLog(data.entry);
      }
    },
    SW_DEBUG_LOGS: (data) => {
      if (state.isAnalysisMode) {
        state.liveLogs.logs = data.logs || [];
      } else {
        state.logs = data.logs || [];
        renderLogs();
      }
    },
    SW_DEBUG_LOGS_CLEARED: () => {
      if (state.isAnalysisMode) {
        state.liveLogs.logs = [];
      } else {
        state.logs = [];
        renderLogs();
      }
    },
    SW_CONSOLE_LOG: (data) => {
      if (state.isAnalysisMode) {
        addOrUpdateLiveLog('consoleLogs', data.entry);
      } else {
        addConsoleLog(data.entry);
      }
    },
    SW_DEBUG_CONSOLE_LOGS: (data) => {
      if (state.isAnalysisMode) {
        state.liveLogs.consoleLogs = data.logs || [];
      } else {
        state.consoleLogs = data.logs || [];
        renderConsoleLogs();
      }
    },
    SW_DEBUG_CONSOLE_LOGS_CLEARED: () => {
      if (state.isAnalysisMode) {
        state.liveLogs.consoleLogs = [];
      } else {
        state.consoleLogs = [];
        renderConsoleLogs();
      }
    },
    SW_POSTMESSAGE_LOG: (data) => {
      if (state.isAnalysisMode) {
        addOrUpdateLiveLog('postmessageLogs', data.entry);
      } else {
        addPostmessageLog(data.entry);
      }
    },
    SW_DEBUG_POSTMESSAGE_LOG_BATCH: (data) => {
      // 处理批量 PostMessage 日志
      const entries = data.entries || [];
      for (const entry of entries) {
        if (state.isAnalysisMode) {
          addOrUpdateLiveLog('postmessageLogs', entry);
        } else {
          addPostmessageLog(entry);
        }
      }
    },
    SW_DEBUG_POSTMESSAGE_LOGS: (data) => {
      if (state.isAnalysisMode) {
        state.liveLogs.postmessageLogs = data.logs || [];
      } else {
        state.postmessageLogs = data.logs || [];
        updateMessageTypeOptions();
        renderPostmessageLogs();
      }
    },
    SW_DEBUG_POSTMESSAGE_LOGS_CLEARED: () => {
      if (state.isAnalysisMode) {
        state.liveLogs.postmessageLogs = [];
      } else {
        state.postmessageLogs = [];
        renderPostmessageLogs();
      }
    },
    SW_DEBUG_CRASH_SNAPSHOTS: (data) => {
      if (state.isAnalysisMode) {
        state.liveLogs.crashLogs = data.snapshots || [];
      } else {
        state.crashLogs = data.snapshots || [];
        renderCrashLogs();
      }
    },
    SW_DEBUG_NEW_CRASH_SNAPSHOT: (data) => {
      if (data.snapshot) {
        if (state.isAnalysisMode) {
          state.liveLogs.crashLogs.unshift(data.snapshot);
          if (state.liveLogs.crashLogs.length > 100) {
            state.liveLogs.crashLogs.pop();
          }
        } else {
          state.crashLogs.unshift(data.snapshot);
          if (state.crashLogs.length > 100) {
            state.crashLogs.pop();
          }
          renderCrashLogs();
        }
      }
    },
    SW_DEBUG_CRASH_SNAPSHOTS_CLEARED: () => {
      if (state.isAnalysisMode) {
        state.liveLogs.crashLogs = [];
      } else {
        state.crashLogs = [];
        renderCrashLogs();
      }
    },
    SW_DEBUG_LLM_API_LOGS: (data) => {
      if (state.isAnalysisMode) {
        state.liveLogs.llmapiLogs = data.logs || [];
      } else {
        state.llmapiLogs = data.logs || [];
        // 更新分页信息
        if (data.page !== undefined) {
          state.llmapiPagination.page = data.page;
          state.llmapiPagination.total = data.total || 0;
          state.llmapiPagination.totalPages = data.totalPages || 0;
          state.llmapiPagination.pageSize = data.pageSize || 20;
        }
        renderLLMApiLogs();
      }
    },
    SW_DEBUG_LLM_API_LOG: (data) => {
      if (data.log) {
        if (state.isAnalysisMode) {
          const existingIndex = state.liveLogs.llmapiLogs.findIndex(
            (l) => l.id === data.log.id
          );
          if (existingIndex >= 0) {
            state.liveLogs.llmapiLogs[existingIndex] = data.log;
          } else {
            state.liveLogs.llmapiLogs.unshift(data.log);
          }
          if (state.liveLogs.llmapiLogs.length > 1000) {
            state.liveLogs.llmapiLogs.pop();
          }
        } else {
          // 实时更新：更新现有日志或在第一页时插入新日志
          const existingIndex = state.llmapiLogs.findIndex(
            (l) => l.id === data.log.id
          );
          if (existingIndex >= 0) {
            // 更新已存在的日志（无论在哪一页）
            state.llmapiLogs[existingIndex] = data.log;
            renderLLMApiLogs();
          } else if (state.llmapiPagination.page === 1) {
            // 只在第一页时插入新日志
            state.llmapiLogs.unshift(data.log);
            if (state.llmapiLogs.length > state.llmapiPagination.pageSize) {
              state.llmapiLogs.pop();
            }
            // 更新总数
            state.llmapiPagination.total++;
            state.llmapiPagination.totalPages = Math.ceil(
              state.llmapiPagination.total / state.llmapiPagination.pageSize
            );
            renderLLMApiLogs();
          } else {
            // 不在第一页，只更新总数，不插入
            state.llmapiPagination.total++;
            state.llmapiPagination.totalPages = Math.ceil(
              state.llmapiPagination.total / state.llmapiPagination.pageSize
            );
            // 可选：刷新分页显示
            renderLLMApiLogs();
          }
        }
      }
    },
    SW_DEBUG_LLM_API_LOGS_CLEARED: () => {
      if (state.isAnalysisMode) {
        state.liveLogs.llmapiLogs = [];
      } else {
        state.llmapiLogs = [];
        state.llmapiPagination = {
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 0,
        };
        renderLLMApiLogs();
      }
    },
    SW_DEBUG_EXPORT_DATA: () => {
      // Handle export data from SW if needed
    },
  });

  onControllerChange(async () => {
    // 等待一段时间让新的 SW 完全接管
    await new Promise((resolve) => setTimeout(resolve, 1000));
    updateSwStatus(elements.swStatus, true);

    // 重新加载所有数据
    refreshStatus();
    loadFetchLogs();
    loadConsoleLogs();
    loadPostMessageLogs();
  });
}

// ==================== Initialization ====================

/**
 * Initialize the application
 */
async function init() {
  cacheElements();

  // Load saved bookmarks, theme, and settings first (before any early returns)
  loadBookmarks();
  loadTheme();
  loadSettings();

  // Setup callbacks for modules that need render functions
  setAnalysisModeCallbacks({
    renderLogs,
    renderConsoleLogs,
    renderPostmessageLogs,
    renderCrashLogs,
    renderLLMApiLogs,
    updateConsoleCount,
    updatePostmessageCount,
    updateCrashCount,
    updateErrorDots,
    updateMessageTypeOptions,
    loadCrashLogs,
    loadLLMApiLogs,
    updateMemoryDisplay,
  });

  setThemeSettingsCallbacks({
    renderLogs,
  });

  // Setup event listeners (always needed, even in analysis mode)
  setupEventListeners();
  initGistManagement();

  // Check URL parameters
  const urlParams = new URLSearchParams(window.location.search);

  // Activate tab from URL parameter (valid tabs: fetch, console, postmessage, llmapi, gist, crash)
  const validTabs = [
    'fetch',
    'console',
    'postmessage',
    'llmapi',
    'gist',
    'crash',
  ];
  const tabParam = urlParams.get('tab');
  if (tabParam && validTabs.includes(tabParam)) {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => switchTab(tabParam, false), 0);
  }

  // Check if analysis mode should be auto-enabled (e.g., via URL parameter)
  if (urlParams.has('analysis')) {
    state.isAnalysisMode = true;
    updateAnalysisModeUI();
    showImportPrompt();
    return;
  }

  // Check SW availability
  if (!('serviceWorker' in navigator)) {
    alert(
      '此浏览器不支持 Service Worker\n\n提示：您可以使用分析模式导入用户日志进行分析'
    );
    updateSwStatus(elements.swStatus, false);
    return;
  }

  const swReady = await checkSwReady();

  if (!swReady) {
    // SW not ready - offer analysis mode as alternative
    const useAnalysisMode = confirm(
      'Service Worker 未注册或未激活\n\n您可以：\n1. 点击"取消"后访问主应用，然后刷新此页面\n2. 点击"确定"进入分析模式，导入用户日志进行分析'
    );

    if (useAnalysisMode) {
      state.isAnalysisMode = true;
      updateAnalysisModeUI();
      showImportPrompt();
      return;
    }

    updateSwStatus(elements.swStatus, false);
    return;
  }
  updateSwStatus(elements.swStatus, true);

  // Register PostMessage logging callback
  setPostMessageLogCallback(addPostmessageLog);

  setupMessageHandlers();
  const duplexOk = await ensureDuplexInitialized();
  if (!duplexOk) {
    console.warn(
      '[SW Debug] Duplex init failed, console/postmessage logs may not stream'
    );
  }
  enableDebug();

  // Load fetch logs (existing logs from before debug mode was enabled won't exist,
  // but logs generated during this session will be available)
  loadFetchLogs();
  // Load console logs from IndexedDB (independent of debug mode status)
  loadConsoleLogs();
  // Load PostMessage logs from SW
  loadPostMessageLogs();
  // Load crash logs
  loadCrashLogs();
  // Load LLM API logs (ensure data is available for export even without visiting the tab)
  loadLLMApiLogs();
  renderLogs();

  // Start memory monitoring
  startMemoryMonitoring();

  // Clean up on page unload - disable debug mode when page is closed
  window.addEventListener('beforeunload', () => {
    stopMemoryMonitoring();
    // Disable debug mode when debug page is closed
    disableDebug();
  });
}

// ==================== Global Helper Functions ====================

/**
 * 切换 base64 图片预览的显示/隐藏
 * 该函数暴露给 window 用于 inline onclick 调用
 * @param {string} previewId - 预览元素的 ID
 */
window.toggleBase64Preview = function (previewId) {
  const previewEl = document.getElementById(previewId);
  if (previewEl) {
    const isHidden = previewEl.style.display === 'none';
    previewEl.style.display = isHidden ? 'inline-block' : 'none';

    // 更新 toggle 按钮的样式
    const toggleEl = previewEl.parentElement?.querySelector(
      '.base64-preview-toggle'
    );
    if (toggleEl) {
      toggleEl.classList.toggle('expanded', isHidden);
    }
  }
};

// Start the app
init();
