/**
 * SW Debug Panel - Export Modal
 * 导出弹窗功能模块
 */

import { state, elements } from './state.js';
import { downloadJson } from './utils.js';
import { loadLLMApiLogs } from './llmapi-logs.js';
import { loadCrashLogs } from './memory-logs.js';

function isLyricsLLMLog(log) {
  if (!log || typeof log !== 'object') return false;
  if (log.taskType !== 'audio') return false;

  return log.resultType === 'lyrics' ||
    (typeof log.endpoint === 'string' && /\/lyrics(?:\/|$)/i.test(log.endpoint));
}

function getLLMApiCategory(log) {
  if (isLyricsLLMLog(log)) {
    return 'lyrics';
  }
  return log?.taskType || 'other';
}

/**
 * Open export modal
 * Ensures all log data is loaded before export
 */
export function openExportModal() {
  // Ensure LLM API logs are loaded before showing export modal
  // This handles the case where user hasn't visited the LLM API tab yet
  loadLLMApiLogs();
  // Also refresh crash logs to ensure completeness
  loadCrashLogs();
  
  elements.exportModalOverlay?.classList.add('show');
}

/**
 * Close export modal
 */
export function closeExportModal() {
  elements.exportModalOverlay?.classList.remove('show');
}

/**
 * Setup export modal checkbox logic
 */
export function setupExportModalCheckboxes() {
  const modal = elements.exportModalOverlay;
  if (!modal) return;

  const selectAllCheckbox = elements.selectAllExport;
  const sectionCheckboxes = modal.querySelectorAll('[data-section]');
  const allItemCheckboxes = modal.querySelectorAll('input[name]');

  // Update section checkbox state based on its items
  function updateSectionCheckbox(sectionName) {
    const sectionCheckbox = modal.querySelector(`[data-section="${sectionName}"]`);
    const items = modal.querySelectorAll(`input[name="${sectionName}"]`);
    if (!sectionCheckbox || items.length === 0) return;

    const checkedItems = Array.from(items).filter(i => i.checked);
    sectionCheckbox.checked = checkedItems.length === items.length;
    sectionCheckbox.indeterminate = checkedItems.length > 0 && checkedItems.length < items.length;
  }

  // Update select all checkbox state
  function updateSelectAllCheckbox() {
    const allChecked = Array.from(allItemCheckboxes).every(cb => cb.checked);
    const someChecked = Array.from(allItemCheckboxes).some(cb => cb.checked);
    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = someChecked && !allChecked;
  }

  // Select all handler
  selectAllCheckbox?.addEventListener('change', () => {
    const checked = selectAllCheckbox.checked;
    allItemCheckboxes.forEach(cb => cb.checked = checked);
    sectionCheckboxes.forEach(cb => {
      cb.checked = checked;
      cb.indeterminate = false;
    });
  });

  // Section checkbox handlers
  sectionCheckboxes.forEach(sectionCb => {
    sectionCb.addEventListener('change', () => {
      const sectionName = sectionCb.dataset.section;
      const items = modal.querySelectorAll(`input[name="${sectionName}"]`);
      items.forEach(item => item.checked = sectionCb.checked);
      sectionCb.indeterminate = false;
      updateSelectAllCheckbox();
    });
  });

  // Item checkbox handlers
  allItemCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      updateSectionCheckbox(cb.name);
      updateSelectAllCheckbox();
    });
  });
}

/**
 * Get selected export options
 * @returns {object}
 */
export function getExportOptions() {
  const basicTypes = Array.from(
    document.querySelectorAll('input[name="basic"]:checked')
  ).map(el => el.value);
  
  const fetchTypes = Array.from(
    document.querySelectorAll('input[name="fetch"]:checked')
  ).map(el => el.value);
  
  const consoleLevels = Array.from(
    document.querySelectorAll('input[name="console"]:checked')
  ).map(el => el.value);
  
  const postmessageDirections = Array.from(
    document.querySelectorAll('input[name="postmessage"]:checked')
  ).map(el => el.value);
  
  const memoryTypes = Array.from(
    document.querySelectorAll('input[name="memory"]:checked')
  ).map(el => el.value);
  
  const llmapiTypes = Array.from(
    document.querySelectorAll('input[name="llmapi"]:checked')
  ).map(el => el.value);
  
  return { basicTypes, fetchTypes, consoleLevels, postmessageDirections, memoryTypes, llmapiTypes };
}

/**
 * Get current memory info from browser
 */
function getCurrentMemoryInfo() {
  const memory = performance.memory;
  if (!memory) return null;
  
  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
    usedMB: Math.round(memory.usedJSHeapSize / 1024 / 1024 * 10) / 10,
    totalMB: Math.round(memory.totalJSHeapSize / 1024 / 1024 * 10) / 10,
    limitMB: Math.round(memory.jsHeapSizeLimit / 1024 / 1024 * 10) / 10,
    usagePercent: Math.round(memory.usedJSHeapSize / memory.jsHeapSizeLimit * 1000) / 10,
  };
}

/**
 * Export logs to JSON file with selected options
 */
export function exportLogs() {
  const options = getExportOptions();
  
  // Build basic info
  let basicInfo = {};
  if (options.basicTypes.includes('swStatus') && state.swStatus) {
    basicInfo.swStatus = {
      version: state.swStatus.version,
      debugModeEnabled: state.swStatus.debugModeEnabled,
      pendingImageRequests: state.swStatus.pendingImageRequests,
      pendingVideoRequests: state.swStatus.pendingVideoRequests,
      videoBlobCacheSize: state.swStatus.videoBlobCacheSize,
      videoBlobCacheTotalBytes: state.swStatus.videoBlobCacheTotalBytes,
      completedImageRequestsSize: state.swStatus.completedImageRequestsSize,
      workflowHandlerInitialized: state.swStatus.workflowHandlerInitialized,
      debugLogsCount: state.swStatus.debugLogsCount,
      failedDomains: state.swStatus.failedDomains,
    };
  }
  if (options.basicTypes.includes('memory')) {
    basicInfo.memory = getCurrentMemoryInfo();
  }
  if (options.basicTypes.includes('cache') && state.swStatus?.cacheStats) {
    basicInfo.cacheStats = state.swStatus.cacheStats;
  }
  
  // Filter fetch logs
  let filteredFetchLogs = [];
  if (options.fetchTypes.length > 0) {
    filteredFetchLogs = state.logs.filter(l => 
      options.fetchTypes.includes(l.requestType)
    );
  }
  
  // Filter console logs
  let filteredConsoleLogs = [];
  if (options.consoleLevels.length > 0) {
    filteredConsoleLogs = state.consoleLogs.filter(l =>
      options.consoleLevels.includes(l.logLevel)
    );
  }
  
  // Filter postmessage logs
  let filteredPostmessageLogs = [];
  if (options.postmessageDirections.length > 0) {
    filteredPostmessageLogs = state.postmessageLogs.filter(l =>
      options.postmessageDirections.includes(l.direction)
    );
  }
  
  // Filter memory logs
  let filteredMemoryLogs = [];
  if (options.memoryTypes.length > 0) {
    filteredMemoryLogs = state.crashLogs.filter(l =>
      options.memoryTypes.includes(l.type)
    );
  }
  
  // Filter LLM API logs
  let filteredLLMApiLogs = [];
  if (options.llmapiTypes.length > 0) {
    filteredLLMApiLogs = state.llmapiLogs.filter(l =>
      options.llmapiTypes.includes(getLLMApiCategory(l))
    );
  }
  
  // Check if anything selected
  const hasBasicInfo = Object.keys(basicInfo).length > 0;
  const hasLogs = filteredFetchLogs.length > 0 || 
                  filteredConsoleLogs.length > 0 || 
                  filteredPostmessageLogs.length > 0 ||
                  filteredMemoryLogs.length > 0 ||
                  filteredLLMApiLogs.length > 0;
  
  if (!hasBasicInfo && !hasLogs) {
    alert('没有选中任何导出项，或选中的类型没有数据');
    return;
  }
  
  const exportData = {
    exportTime: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: location.href,
    exportOptions: options,
    // Basic info at the top level for easy access
    ...basicInfo,
    summary: {
      hasBasicInfo,
      fetchLogs: filteredFetchLogs.length,
      consoleLogs: filteredConsoleLogs.length,
      postmessageLogs: filteredPostmessageLogs.length,
      memoryLogs: filteredMemoryLogs.length,
      llmapiLogs: filteredLLMApiLogs.length,
    },
    fetchLogs: filteredFetchLogs,
    consoleLogs: filteredConsoleLogs,
    postmessageLogs: filteredPostmessageLogs,
    memoryLogs: filteredMemoryLogs,
    llmapiLogs: filteredLLMApiLogs,
  };

  const filename = `sw-debug-logs-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.json`;
  downloadJson(exportData, filename);
  closeExportModal();
}
