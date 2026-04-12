/**
 * Gist Management Module for SW Debug Panel
 * Provides debugging tools for Gist sync system
 */

import {
  decryptToken,
  getGistCredentials,
  decryptGistFile,
  getSyncConfig,
  getShardEnabledStatus,
  getLocalMasterIndex,
  hasCustomPassword,
  getDeviceIdExported,
  getLocalTasks,
  getLocalBoards,
  listCacheStorageMedia,
  getCacheStorageStats,
  querySyncLogs,
  getSyncLogStats,
  getSyncSessions,
  clearSyncLogs,
  exportSyncLogs,
  diagnoseDatabase,
} from './crypto-helper.js';
import { createConsoleEntry } from './console-entry.js';

// ====================================
// State
// ====================================

let elements = {};
let currentGistData = null;
let currentGistId = null;
let currentToken = null;
let currentCustomPassword = null;
let remoteMasterIndex = null;
let localMasterIndex = null;

// Sync Log State
let syncLogCurrentPage = 1;
let syncLogPageSize = 50;
let syncLogTotalEntries = 0;
let syncLogCurrentFilters = {};
let syncLogExpandedIds = new Set(); // 跟踪展开的日志条目
let syncLogAutoRefreshInterval = null; // 自动刷新定时器
let syncLogAutoRefreshEnabled = false; // 自动刷新状态
const AUTO_REFRESH_INTERVAL = 3000; // 3秒刷新间隔

// ====================================
// Initialization
// ====================================

export function initGistManagement() {
  // Cache DOM elements
  elements = {
    // Toolbar
    refreshBtn: document.getElementById('refreshGistBtn'),
    status: document.getElementById('gistStatus'),
    
    // Config section
    tokenStatus: document.getElementById('gistTokenStatus'),
    gistId: document.getElementById('gistId'),
    shardEnabled: document.getElementById('gistShardEnabled'),
    passwordStatus: document.getElementById('gistPasswordStatus'),
    deviceId: document.getElementById('gistDeviceId'),
    lastSync: document.getElementById('gistLastSync'),
    
    // Shard section
    shardTotalCount: document.getElementById('shardTotalCount'),
    shardActiveCount: document.getElementById('shardActiveCount'),
    shardFullCount: document.getElementById('shardFullCount'),
    shardFileCount: document.getElementById('shardFileCount'),
    shardTotalSize: document.getElementById('shardTotalSize'),
    shardList: document.getElementById('gistShardList'),
    
    // Diagnostics - Tasks
    localTaskCount: document.getElementById('localTaskCount'),
    remoteTaskCount: document.getElementById('remoteTaskCount'),
    localOnlyTaskCount: document.getElementById('localOnlyTaskCount'),
    remoteOnlyTaskCount: document.getElementById('remoteOnlyTaskCount'),
    syncedTaskCount: document.getElementById('syncedTaskCount'),
    taskComparisonTable: document.getElementById('taskComparisonTable'),
    
    // Diagnostics - Boards
    localBoardCount: document.getElementById('localBoardCount'),
    remoteBoardCount: document.getElementById('remoteBoardCount'),
    localOnlyBoardCount: document.getElementById('localOnlyBoardCount'),
    remoteOnlyBoardCount: document.getElementById('remoteOnlyBoardCount'),
    boardComparisonTable: document.getElementById('boardComparisonTable'),
    
    // Diagnostics - Media
    localMediaCount: document.getElementById('localMediaCount'),
    remoteMediaCount: document.getElementById('remoteMediaCount'),
    localOnlyMediaCount: document.getElementById('localOnlyMediaCount'),
    remoteOnlyMediaCount: document.getElementById('remoteOnlyMediaCount'),
    mediaComparisonTable: document.getElementById('mediaComparisonTable'),
    
    // Files browser
    fileList: document.getElementById('gistFileList'),
    fileContent: document.getElementById('gistFileContent'),
    previewName: document.getElementById('previewFileName'),
  };

  // Event listeners
  if (elements.refreshBtn) {
    elements.refreshBtn.addEventListener('click', refreshGistData);
  }

  // Section collapse/expand
  document.querySelectorAll('.gist-section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.gist-section');
      section.classList.toggle('collapsed');
      
      const sectionType = header.dataset.section;
      const isExpanded = !section.classList.contains('collapsed');
      
      // Auto-refresh sync logs when section is expanded
      if (sectionType === 'synclogs') {
        if (isExpanded) {
          refreshSyncLogs();
          // Auto-enable auto-refresh when sync logs section is expanded
          if (!syncLogAutoRefreshEnabled) {
            toggleAutoRefresh();
          }
        } else {
          // Stop auto-refresh when sync logs section is collapsed
          if (syncLogAutoRefreshEnabled) {
            toggleAutoRefresh();
          }
        }
      }
      
      // Auto-load diagnostics data when section is expanded
      if (sectionType === 'diagnostics' && isExpanded) {
        loadFullDiagnostics();
      }
    });
  });
  
  // Auto-start sync log refresh if section is already expanded (on page load)
  const syncLogsSection = document.querySelector('[data-section="synclogs"]')?.closest('.gist-section');
  if (syncLogsSection && !syncLogsSection.classList.contains('collapsed')) {
    // Delay to ensure initialization is complete
    setTimeout(() => {
      refreshSyncLogs();
      if (!syncLogAutoRefreshEnabled) {
        toggleAutoRefresh();
      }
    }, 500);
  }
  
  // Auto-load diagnostics if section is already expanded (on page load)
  const diagnosticsSection = document.querySelector('[data-section="diagnostics"]')?.closest('.gist-section');
  if (diagnosticsSection && !diagnosticsSection.classList.contains('collapsed')) {
    setTimeout(() => {
      loadFullDiagnostics();
    }, 600);
  }

  // Sub-tab switching
  document.querySelectorAll('.gist-subtab').forEach(tab => {
    tab.addEventListener('click', () => {
      const subtabName = tab.dataset.subtab;
      switchSubtab(subtabName);
    });
  });
  
  // Refresh local diagnostics button
  document.getElementById('refreshLocalDiagnostics')?.addEventListener('click', () => {
    console.log('[Diagnostics] Manual refresh triggered');
    loadLocalDiagnostics();
  });
  
  // Load remote diagnostics button (triggers full diagnostics including remote)
  document.getElementById('loadRemoteDiagnostics')?.addEventListener('click', () => {
    console.log('[Diagnostics] Loading remote data...');
    loadFullDiagnostics();
  });

  // Debug operation buttons
  initDebugOperations();

  // Load initial local data
  loadLocalConfigInfo();
}

// ====================================
// Sub-tab Management
// ====================================

function switchSubtab(subtabName) {
  // Update tab buttons
  document.querySelectorAll('.gist-subtab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.subtab === subtabName);
  });

  // Update tab content
  document.querySelectorAll('.gist-subtab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${subtabName}Subtab`);
  });
}

// ====================================
// Status Updates
// ====================================

function updateStatus(msg, type = 'info') {
  if (!elements.status) return;
  elements.status.textContent = msg;
  elements.status.style.color = type === 'error' ? 'var(--error-color)' : 
                                type === 'success' ? 'var(--success-color)' : 
                                'var(--text-secondary)';
}

// ====================================
// Local Config Info
// ====================================

async function loadLocalConfigInfo() {
  try {
    // Device ID
    const deviceId = getDeviceIdExported();
    if (elements.deviceId) {
      elements.deviceId.textContent = deviceId ? deviceId.substring(0, 16) + '...' : '-';
      elements.deviceId.title = deviceId || '';
    }

    // Sync config
    const config = await getSyncConfig();
    if (config) {
      if (elements.gistId) {
        elements.gistId.textContent = config.gistId ? 
          config.gistId.substring(0, 12) + '...' : '未配置';
        elements.gistId.title = config.gistId || '';
        elements.gistId.classList.toggle('warning', !config.gistId);
      }
      
      if (elements.lastSync) {
        elements.lastSync.textContent = config.lastSyncTime ? 
          formatTime(config.lastSyncTime) : '从未同步';
        elements.lastSync.classList.toggle('warning', !config.lastSyncTime);
      }
    }

    // Shard enabled
    const shardEnabled = await getShardEnabledStatus();
    if (elements.shardEnabled) {
      elements.shardEnabled.textContent = shardEnabled ? '已启用' : '未启用';
      elements.shardEnabled.classList.toggle('success', shardEnabled);
      elements.shardEnabled.classList.toggle('warning', !shardEnabled);
    }

    // Password status
    const hasPassword = await hasCustomPassword();
    if (elements.passwordStatus) {
      elements.passwordStatus.textContent = hasPassword ? '已设置' : '未设置';
      elements.passwordStatus.classList.toggle('success', hasPassword);
    }

    // Local master index
    localMasterIndex = await getLocalMasterIndex();
    if (localMasterIndex) {
      renderShardStats(localMasterIndex);
    }

  } catch (error) {
    console.error('Failed to load local config:', error);
  }
}

// ====================================
// Main Refresh
// ====================================

async function refreshGistData() {
  updateStatus('正在加载...', 'info');
  
  try {
    // 1. Get Token
    const encryptedToken = localStorage.getItem('github_sync_token');
    if (!encryptedToken) {
      throw new Error('未找到 GitHub Token');
    }
    
    try {
      currentToken = await decryptToken(encryptedToken);
      if (elements.tokenStatus) {
        elements.tokenStatus.textContent = '已解密';
        elements.tokenStatus.classList.add('success');
      }
    } catch (e) {
      if (elements.tokenStatus) {
        elements.tokenStatus.textContent = '解密失败';
        elements.tokenStatus.classList.add('error');
      }
      throw new Error('Token 解密失败');
    }

    // 2. Get Credentials
    const creds = await getGistCredentials();
    currentGistId = creds.gistId;
    currentCustomPassword = creds.customPassword;
    
    if (!currentGistId) {
      throw new Error('未配置 Gist ID');
    }

    // 3. Reload local config
    await loadLocalConfigInfo();

    // 4. Fetch main Gist
    updateStatus('正在获取 Gist 数据...', 'info');
    const gist = await fetchGist(currentGistId);
    currentGistData = gist;

    // 5. Parse master-index.json
    if (gist.files && gist.files['master-index.json']) {
      updateStatus('正在解析分片索引...', 'info');
      remoteMasterIndex = await parseGistFile(gist.files['master-index.json']);
      if (remoteMasterIndex) {
        renderShardStats(remoteMasterIndex);
      }
    }

    // 6. Render remote files list
    renderFileList(gist.files || {});

    // 7. Run diagnostics
    updateStatus('正在对比数据...', 'info');
    await runDiagnostics(gist);

    updateStatus('加载完成', 'success');

  } catch (error) {
    console.error('Gist Refresh Error:', error);
    updateStatus(error.message, 'error');
  }
}

// ====================================
// GitHub API
// ====================================

async function fetchGist(gistId) {
  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      'Authorization': `token ${currentToken}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API 错误: ${response.status}`);
  }

  return response.json();
}

async function parseGistFile(fileData) {
  try {
    let content = fileData.content;
    if (fileData.truncated) {
      console.log('[parseGistFile] File is truncated, fetching from raw_url...');
      const res = await fetch(fileData.raw_url);
      content = await res.text();
    }
    
    console.log('[parseGistFile] Content length:', content?.length, 'preview:', content?.substring(0, 100));
    const decrypted = await decryptGistFile(content, currentGistId, currentCustomPassword);
    console.log('[parseGistFile] Decrypted length:', decrypted?.length, 'preview:', decrypted?.substring(0, 100));
    const parsed = JSON.parse(decrypted);
    console.log('[parseGistFile] Parsed result type:', typeof parsed, Array.isArray(parsed) ? 'array' : 'object');
    return parsed;
  } catch (e) {
    console.error('[parseGistFile] Failed to parse gist file:', e);
    return null;
  }
}

// ====================================
// Shard Stats Rendering
// ====================================

function renderShardStats(masterIndex) {
  if (!masterIndex) return;

  const stats = masterIndex.stats || {};
  const shards = masterIndex.shards || {};
  const shardList = Object.values(shards);

  // Update stat cards
  if (elements.shardTotalCount) {
    elements.shardTotalCount.textContent = shardList.length;
  }
  if (elements.shardActiveCount) {
    elements.shardActiveCount.textContent = stats.activeShards || 
      shardList.filter(s => s.status === 'active').length;
  }
  if (elements.shardFullCount) {
    elements.shardFullCount.textContent = stats.fullShards || 
      shardList.filter(s => s.status === 'full').length;
  }
  if (elements.shardFileCount) {
    elements.shardFileCount.textContent = stats.totalFiles || 
      Object.keys(masterIndex.fileIndex || {}).length;
  }
  if (elements.shardTotalSize) {
    elements.shardTotalSize.textContent = formatSize(stats.totalSize || 0);
  }

  // Render shard list
  if (elements.shardList) {
    if (shardList.length === 0) {
      elements.shardList.innerHTML = '<div class="empty-state" style="padding: 20px;">无分片数据</div>';
      return;
    }

    elements.shardList.innerHTML = shardList.map(shard => `
      <div class="gist-shard-item">
        <span class="gist-shard-id">${escapeHtml(shard.alias || shard.gistId?.substring(0, 8))}</span>
        <span class="gist-shard-info">
          <span>${shard.fileCount || 0} 文件</span>
          <span>${formatSize(shard.totalSize || 0)}</span>
        </span>
        <span class="gist-shard-status ${shard.status}">${shard.status}</span>
      </div>
    `).join('');
  }
}

// ====================================
// Remote Files Browser
// ====================================

function renderFileList(files) {
  if (!elements.fileList) return;
  
  const fileNames = Object.keys(files).sort();
  
  if (fileNames.length === 0) {
    elements.fileList.innerHTML = '<div class="empty-state" style="padding: 20px;">无文件</div>';
    return;
  }

  elements.fileList.innerHTML = fileNames.map(fileName => {
    let type = 'Text';
    if (fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
      type = 'Image';
    } else if (fileName.startsWith('board_') && fileName.endsWith('.json')) {
      type = 'Board';
    } else if (fileName.endsWith('.drawnix')) {
      type = 'Canvas';
    } else if (fileName === 'tasks.json' || fileName === 'master-index.json' || fileName === 'workspace.json' || fileName === 'prompts.json') {
      type = 'Data';
    } else if (fileName === 'shard-manifest.json') {
      type = 'Manifest';
    } else if (fileName.startsWith('media_') && fileName.endsWith('.json')) {
      type = 'Media';
    }
    
    return `
      <div class="gist-file-item" data-filename="${escapeHtml(fileName)}">
        <span class="file-name">${escapeHtml(fileName)}</span>
        <span class="file-type">${type}</span>
      </div>
    `;
  }).join('');

  // Add click handlers
  elements.fileList.querySelectorAll('.gist-file-item').forEach(item => {
    item.addEventListener('click', () => {
      // Update active state
      elements.fileList.querySelectorAll('.gist-file-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      const fileName = item.dataset.filename;
      showFileContent(fileName, files[fileName]);
    });
  });
}

async function showFileContent(fileName, fileData) {
  if (!elements.previewName || !elements.fileContent) return;
  
  elements.previewName.textContent = fileName;
  elements.fileContent.innerHTML = '<div class="loading-state">正在加载...</div>';
  
  try {
    let content = fileData.content;
    if (fileData.truncated) {
      const res = await fetch(fileData.raw_url);
      content = await res.text();
    }

    // Try decrypt
    let decryptedContent = content;
    let decryptFailed = false;
    try {
      decryptedContent = await decryptGistFile(content, currentGistId, currentCustomPassword);
    } catch (e) {
      console.warn('Decryption failed, showing raw', e);
      decryptFailed = true;
    }
    
    // Parse JSON if possible
    let parsedData = null;
    try {
      parsedData = JSON.parse(decryptedContent);
    } catch {}
    
    // Render based on file type
    if (fileName.startsWith('media_') && fileName.endsWith('.json') && parsedData) {
      renderMediaFilePreview(parsedData, decryptFailed);
    } else if (fileName.startsWith('board_') && fileName.endsWith('.json') && parsedData) {
      renderBoardFilePreview(parsedData, decryptFailed);
    } else if (fileName === 'tasks.json' && parsedData) {
      renderTasksFilePreview(parsedData, decryptFailed);
    } else if (fileName === 'workspace.json' && parsedData) {
      renderWorkspaceFilePreview(parsedData, decryptFailed);
    } else if (fileName === 'master-index.json' && parsedData) {
      renderMasterIndexPreview(parsedData, decryptFailed);
    } else {
      // Default: show formatted JSON or raw text
      let displayContent = parsedData ? JSON.stringify(parsedData, null, 2) : decryptedContent;
      if (decryptFailed) {
        displayContent = content + '\n\n[解密失败]';
      }
      elements.fileContent.innerHTML = `<pre class="file-raw-content">${escapeHtml(displayContent)}</pre>`;
    }
  } catch (e) {
    elements.fileContent.innerHTML = `<div class="error-state">加载失败: ${escapeHtml(e.message)}</div>`;
  }
}

/**
 * Render media file preview (media_*.json)
 */
function renderMediaFilePreview(data, decryptFailed) {
  const url = data.url || data.originalUrl || '';
  const isVideo = isVideoUrl(url);
  const mimeType = data.mimeType || (isVideo ? 'video/*' : 'image/*');
  const size = data.size ? formatSize(data.size) : '未知';
  
  // Get preview URL - use the stored data URL if available
  let previewUrl = '';
  if (data.data && data.data.startsWith('data:')) {
    previewUrl = data.data;
  } else if (url.startsWith('/__aitu_cache__/')) {
    previewUrl = url;
  } else {
    previewUrl = url;
  }
  
  const previewHtml = isVideo ? `
    <video 
      class="media-file-preview" 
      src="${escapeHtml(previewUrl)}" 
      controls 
      muted
      onerror="this.outerHTML='<div class=\\'preview-error\\'>视频加载失败</div>'"
    ></video>
  ` : `
    <img 
      class="media-file-preview" 
      src="${escapeHtml(previewUrl)}" 
      onerror="this.outerHTML='<div class=\\'preview-error\\'>图片加载失败</div>'"
    />
  `;
  
  elements.fileContent.innerHTML = `
    <div class="file-preview-card">
      <div class="preview-section">
        ${previewHtml}
      </div>
      <div class="preview-info">
        <div class="info-row">
          <span class="info-label">类型</span>
          <span class="info-value">${isVideo ? '视频' : '图片'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">MIME</span>
          <span class="info-value">${escapeHtml(mimeType)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">大小</span>
          <span class="info-value">${size}</span>
        </div>
        <div class="info-row">
          <span class="info-label">原始 URL</span>
          <span class="info-value url-value" title="${escapeHtml(url)}">${escapeHtml(url)}</span>
        </div>
        ${decryptFailed ? '<div class="warning-badge">解密失败，显示原始数据</div>' : ''}
      </div>
    </div>
  `;
}

/**
 * Render board file preview (board_*.json)
 */
function renderBoardFilePreview(data, decryptFailed) {
  const name = data.name || '未命名画板';
  const id = data.id || '';
  const createdAt = data.createdAt ? formatTime(data.createdAt) : '未知';
  const updatedAt = data.updatedAt ? formatTime(data.updatedAt) : '未知';
  
  // Count elements
  const elements_arr = data.elements || [];
  let imageCount = 0;
  let videoCount = 0;
  let textCount = 0;
  let shapeCount = 0;
  let otherCount = 0;
  
  elements_arr.forEach(el => {
    const type = el.type || '';
    if (type === 'image' || type.includes('image')) {
      imageCount++;
    } else if (type === 'video' || type.includes('video')) {
      videoCount++;
    } else if (type === 'text' || type.includes('text')) {
      textCount++;
    } else if (type === 'geometry' || type === 'line' || type === 'arrow' || type.includes('shape')) {
      shapeCount++;
    } else {
      otherCount++;
    }
  });
  
  const totalElements = elements_arr.length;
  
  elements.fileContent.innerHTML = `
    <div class="file-preview-card">
      <div class="preview-header">
        <h3 class="board-name">${escapeHtml(name)}</h3>
        <span class="board-id">${escapeHtml(id)}</span>
      </div>
      <div class="preview-stats">
        <div class="stat-card">
          <span class="stat-value">${totalElements}</span>
          <span class="stat-label">元素总数</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${imageCount}</span>
          <span class="stat-label">图片</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${videoCount}</span>
          <span class="stat-label">视频</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${textCount}</span>
          <span class="stat-label">文本</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${shapeCount}</span>
          <span class="stat-label">形状</span>
        </div>
      </div>
      <div class="preview-info">
        <div class="info-row">
          <span class="info-label">创建时间</span>
          <span class="info-value">${createdAt}</span>
        </div>
        <div class="info-row">
          <span class="info-label">更新时间</span>
          <span class="info-value">${updatedAt}</span>
        </div>
        ${decryptFailed ? '<div class="warning-badge">解密失败，显示原始数据</div>' : ''}
      </div>
      <details class="raw-data-toggle">
        <summary>查看原始数据</summary>
        <pre class="file-raw-content">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
      </details>
    </div>
  `;
}

/**
 * Render tasks file preview (tasks.json)
 */
function renderTasksFilePreview(data, decryptFailed) {
  const tasks = data.completedTasks || (Array.isArray(data) ? data : []);
  const taskCount = tasks.length;
  
  // Count by type
  let imageTaskCount = 0;
  let videoTaskCount = 0;
  
  tasks.forEach(task => {
    if (task.type === 'image') imageTaskCount++;
    else if (task.type === 'video') videoTaskCount++;
  });
  
  // Show recent tasks
  const recentTasks = tasks.slice(-5).reverse();
  
  elements.fileContent.innerHTML = `
    <div class="file-preview-card">
      <div class="preview-header">
        <h3>任务数据</h3>
      </div>
      <div class="preview-stats">
        <div class="stat-card">
          <span class="stat-value">${taskCount}</span>
          <span class="stat-label">任务总数</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${imageTaskCount}</span>
          <span class="stat-label">图片任务</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${videoTaskCount}</span>
          <span class="stat-label">视频任务</span>
        </div>
      </div>
      ${recentTasks.length > 0 ? `
        <div class="preview-list">
          <h4>最近任务</h4>
          ${recentTasks.map(task => `
            <div class="list-item">
              <span class="item-type ${task.type || 'other'}">${task.type === 'image' ? '图片' : task.type === 'video' ? '视频' : '其他'}</span>
              <span class="item-name" title="${escapeHtml(task.name || task.prompt || '')}">${escapeHtml((task.name || task.prompt || '').substring(0, 50))}</span>
              <span class="item-time">${task.completedAt ? formatTime(task.completedAt) : ''}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${decryptFailed ? '<div class="warning-badge">解密失败</div>' : ''}
      <details class="raw-data-toggle">
        <summary>查看原始数据</summary>
        <pre class="file-raw-content">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
      </details>
    </div>
  `;
}

/**
 * Render workspace file preview (workspace.json)
 */
function renderWorkspaceFilePreview(data, decryptFailed) {
  const folders = data.folders || [];
  const boardMetadata = data.boardMetadata || [];
  const currentBoardId = data.currentBoardId || '无';
  
  elements.fileContent.innerHTML = `
    <div class="file-preview-card">
      <div class="preview-header">
        <h3>工作区数据</h3>
      </div>
      <div class="preview-stats">
        <div class="stat-card">
          <span class="stat-value">${folders.length}</span>
          <span class="stat-label">文件夹</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${boardMetadata.length}</span>
          <span class="stat-label">画板</span>
        </div>
      </div>
      <div class="preview-info">
        <div class="info-row">
          <span class="info-label">当前画板</span>
          <span class="info-value">${escapeHtml(currentBoardId)}</span>
        </div>
      </div>
      ${boardMetadata.length > 0 ? `
        <div class="preview-list">
          <h4>画板列表</h4>
          ${boardMetadata.slice(0, 10).map(board => `
            <div class="list-item">
              <span class="item-name">${escapeHtml(board.name || board.id || '未命名')}</span>
              <span class="item-time">${board.updatedAt ? formatTime(board.updatedAt) : ''}</span>
            </div>
          `).join('')}
          ${boardMetadata.length > 10 ? `<div class="list-more">还有 ${boardMetadata.length - 10} 个...</div>` : ''}
        </div>
      ` : ''}
      ${decryptFailed ? '<div class="warning-badge">解密失败</div>' : ''}
      <details class="raw-data-toggle">
        <summary>查看原始数据</summary>
        <pre class="file-raw-content">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
      </details>
    </div>
  `;
}

/**
 * Render master-index file preview
 */
function renderMasterIndexPreview(data, decryptFailed) {
  const boards = data.boards ? Object.keys(data.boards).length : 0;
  const devices = data.devices ? Object.keys(data.devices).length : 0;
  const version = data.version || '未知';
  const appVersion = data.appVersion || '未知';
  const updatedAt = data.updatedAt ? formatTime(data.updatedAt) : '未知';
  
  elements.fileContent.innerHTML = `
    <div class="file-preview-card">
      <div class="preview-header">
        <h3>主索引</h3>
      </div>
      <div class="preview-stats">
        <div class="stat-card">
          <span class="stat-value">${boards}</span>
          <span class="stat-label">画板</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${devices}</span>
          <span class="stat-label">设备</span>
        </div>
      </div>
      <div class="preview-info">
        <div class="info-row">
          <span class="info-label">同步版本</span>
          <span class="info-value">${version}</span>
        </div>
        <div class="info-row">
          <span class="info-label">应用版本</span>
          <span class="info-value">${escapeHtml(appVersion)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">最后更新</span>
          <span class="info-value">${updatedAt}</span>
        </div>
      </div>
      ${decryptFailed ? '<div class="warning-badge">解密失败</div>' : ''}
      <details class="raw-data-toggle">
        <summary>查看原始数据</summary>
        <pre class="file-raw-content">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
      </details>
    </div>
  `;
}

// ====================================
// Diagnostics
// ====================================

/**
 * Load full diagnostics (local + remote)
 * Automatically tries to get remote data if Token is available
 */
async function loadFullDiagnostics() {
  console.log('[Diagnostics] Loading full diagnostics (local + remote)...');
  
  // First load local data immediately
  await loadLocalDiagnostics();
  
  // Then try to load remote data
  try {
    // Check if Token is available
    const encryptedToken = localStorage.getItem('github_sync_token');
    if (!encryptedToken) {
      console.log('[Diagnostics] No GitHub Token configured, skipping remote data');
      updateRemoteStatus('未配置 Token');
      return;
    }
    
    // Try to decrypt token
    let token;
    try {
      token = await decryptToken(encryptedToken);
      currentToken = token;
      console.log('[Diagnostics] Token decrypted successfully');
    } catch (e) {
      console.warn('[Diagnostics] Failed to decrypt token:', e);
      updateRemoteStatus('Token 解密失败');
      return;
    }
    
    // Get Gist credentials
    const creds = await getGistCredentials();
    if (!creds.gistId) {
      console.log('[Diagnostics] No Gist ID configured');
      updateRemoteStatus('未配置 Gist');
      return;
    }
    
    currentGistId = creds.gistId;
    currentCustomPassword = creds.customPassword;
    
    // Update status
    updateRemoteStatus('正在加载...');
    
    // Fetch Gist data
    console.log('[Diagnostics] Fetching Gist data...');
    const gist = await fetchGist(currentGistId);
    currentGistData = gist;
    
    // Parse master-index.json if exists
    if (gist.files && gist.files['master-index.json']) {
      console.log('[Diagnostics] Parsing master-index.json...');
      remoteMasterIndex = await parseGistFile(gist.files['master-index.json']);
      console.log('[Diagnostics] Parsed master-index:', remoteMasterIndex);
      if (remoteMasterIndex) {
        console.log('[Diagnostics] master-index.boards:', remoteMasterIndex.boards);
        console.log('[Diagnostics] master-index keys:', Object.keys(remoteMasterIndex));
      }
    } else {
      console.log('[Diagnostics] No master-index.json found in gist files');
    }
    
    // Run full diagnostics comparison
    await runDiagnostics(gist);
    
    // Render remote files list
    renderFileList(gist.files || {});
    
    console.log('[Diagnostics] Full diagnostics loaded successfully');
    updateRemoteStatus(null); // Clear status
    
  } catch (error) {
    console.error('[Diagnostics] Failed to load remote data:', error);
    updateRemoteStatus(`加载失败: ${error.message}`);
  }
}

/**
 * Update remote data status indicator
 */
function updateRemoteStatus(message) {
  const remoteTaskCountEl = document.getElementById('remoteTaskCount');
  const remoteBoardCountEl = document.getElementById('remoteBoardCount');
  const remoteMediaCountEl = document.getElementById('remoteMediaCount');
  
  if (message) {
    if (remoteTaskCountEl) remoteTaskCountEl.textContent = message;
    if (remoteBoardCountEl) remoteBoardCountEl.textContent = message;
    if (remoteMediaCountEl) remoteMediaCountEl.textContent = message;
  }
}

/**
 * Load local diagnostics data (without remote)
 * Called when diagnostics section is expanded
 */
async function loadLocalDiagnostics() {
  console.log('[Diagnostics] Loading local diagnostics data...');
  
  // Get elements directly instead of relying on cached elements
  const localTaskCountEl = document.getElementById('localTaskCount');
  const localBoardCountEl = document.getElementById('localBoardCount');
  const localMediaCountEl = document.getElementById('localMediaCount');
  const remoteTaskCountEl = document.getElementById('remoteTaskCount');
  const remoteBoardCountEl = document.getElementById('remoteBoardCount');
  const remoteMediaCountEl = document.getElementById('remoteMediaCount');
  const localOnlyTaskCountEl = document.getElementById('localOnlyTaskCount');
  const remoteOnlyTaskCountEl = document.getElementById('remoteOnlyTaskCount');
  const syncedTaskCountEl = document.getElementById('syncedTaskCount');
  const localOnlyBoardCountEl = document.getElementById('localOnlyBoardCount');
  const remoteOnlyBoardCountEl = document.getElementById('remoteOnlyBoardCount');
  const localOnlyMediaCountEl = document.getElementById('localOnlyMediaCount');
  const remoteOnlyMediaCountEl = document.getElementById('remoteOnlyMediaCount');
  const taskComparisonTableEl = document.getElementById('taskComparisonTable');
  const boardComparisonTableEl = document.getElementById('boardComparisonTable');
  const mediaComparisonTableEl = document.getElementById('mediaComparisonTable');
  
  console.log('[Diagnostics] Elements found:', {
    localTaskCount: !!localTaskCountEl,
    localBoardCount: !!localBoardCountEl,
    localMediaCount: !!localMediaCountEl,
    taskComparisonTable: !!taskComparisonTableEl,
  });
  
  try {
    // First, diagnose the databases to understand the structure
    const dbDiagnosis = {};
    try {
      dbDiagnosis.workspace = await diagnoseDatabase('aitu-workspace');
      dbDiagnosis.taskQueue = await diagnoseDatabase('sw-task-queue');
      console.log('[Diagnostics] Database structure:', dbDiagnosis);
    } catch (e) {
      console.warn('[Diagnostics] Failed to diagnose databases:', e);
    }
    
    // Load local tasks
    const localTasks = await getLocalTasks();
    console.log('[Diagnostics] Local tasks:', localTasks.length, localTasks.slice(0, 2));
    if (localTaskCountEl) {
      localTaskCountEl.textContent = localTasks.length;
    }
    
    // Load local boards
    const localBoards = await getLocalBoards();
    console.log('[Diagnostics] Local boards:', localBoards.length, localBoards.slice(0, 2));
    if (localBoardCountEl) {
      localBoardCountEl.textContent = localBoards.length;
    }
    
    // Load local media
    const localMedia = await listCacheStorageMedia();
    console.log('[Diagnostics] Local media:', localMedia.length);
    if (localMediaCountEl) {
      localMediaCountEl.textContent = localMedia.length;
    }
    
    // Show local-only data in tables
    if (localTasks.length > 0) {
      renderLocalOnlyTable(taskComparisonTableEl, localTasks.slice(0, 20), 'task');
    } else {
      if (taskComparisonTableEl) {
        const dbInfo = dbDiagnosis.taskQueue ? 
          `数据库信息: ${JSON.stringify(dbDiagnosis.taskQueue.stores, null, 2)}` : '';
        taskComparisonTableEl.innerHTML = `<div class="empty-state" style="padding: 20px;">本地无任务数据${dbInfo ? '<pre style="text-align:left;font-size:10px;margin-top:10px;white-space:pre-wrap;">' + escapeHtml(dbInfo) + '</pre>' : ''}</div>`;
      }
    }
    
    if (localBoards.length > 0) {
      renderLocalOnlyTable(boardComparisonTableEl, localBoards.slice(0, 20), 'board');
    } else {
      if (boardComparisonTableEl) {
        const dbInfo = dbDiagnosis.workspace ? 
          `数据库信息: ${JSON.stringify(dbDiagnosis.workspace.stores, null, 2)}` : '';
        boardComparisonTableEl.innerHTML = `<div class="empty-state" style="padding: 20px;">本地无画板数据${dbInfo ? '<pre style="text-align:left;font-size:10px;margin-top:10px;white-space:pre-wrap;">' + escapeHtml(dbInfo) + '</pre>' : ''}</div>`;
      }
    }
    
    if (localMedia.length > 0) {
      renderLocalOnlyMediaTable(mediaComparisonTableEl, localMedia.slice(0, 30));
    } else {
      if (mediaComparisonTableEl) {
        mediaComparisonTableEl.innerHTML = '<div class="empty-state" style="padding: 20px;">本地无缓存媒体</div>';
      }
    }
    
    // Update remote counts to show "未加载"
    if (remoteTaskCountEl) remoteTaskCountEl.textContent = '未加载';
    if (remoteBoardCountEl) remoteBoardCountEl.textContent = '未加载';
    if (remoteMediaCountEl) remoteMediaCountEl.textContent = '未加载';
    if (localOnlyTaskCountEl) localOnlyTaskCountEl.textContent = '-';
    if (remoteOnlyTaskCountEl) remoteOnlyTaskCountEl.textContent = '-';
    if (syncedTaskCountEl) syncedTaskCountEl.textContent = '-';
    if (localOnlyBoardCountEl) localOnlyBoardCountEl.textContent = '-';
    if (remoteOnlyBoardCountEl) remoteOnlyBoardCountEl.textContent = '-';
    if (localOnlyMediaCountEl) localOnlyMediaCountEl.textContent = '-';
    if (remoteOnlyMediaCountEl) remoteOnlyMediaCountEl.textContent = '-';
    
    console.log('[Diagnostics] Local diagnostics loaded successfully');
    
  } catch (error) {
    console.error('[Diagnostics] Failed to load local data:', error);
    if (taskComparisonTableEl) {
      taskComparisonTableEl.innerHTML = `<div class="empty-state" style="padding: 20px; color: var(--error-color);">加载失败: ${escapeHtml(error.message)}</div>`;
    }
  }
}

/**
 * Render local-only data table
 */
function renderLocalOnlyTable(container, items, type) {
  if (!container) return;
  
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 20px;">无数据</div>';
    return;
  }
  
  container.innerHTML = items.map(item => {
    const id = item.id || '';
    const details = getItemDetails(item, type);
    return `
      <div class="gist-comparison-row">
        <span class="item-id" title="${escapeHtml(id)}">${escapeHtml(truncateId(id))}</span>
        <span class="item-details">${escapeHtml(details)}</span>
        <span class="item-status local-only">本地</span>
      </div>
    `;
  }).join('');
  
  if (items.length >= 20) {
    container.innerHTML += `
      <div class="gist-comparison-row" style="justify-content: center; color: var(--text-muted); font-style: italic;">
        点击"刷新 Gist 数据"获取远程数据进行完整对比
      </div>
    `;
  }
}

/**
 * Render local-only media table
 */
function renderLocalOnlyMediaTable(container, items) {
  if (!container) return;
  
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 20px;">无缓存媒体</div>';
    return;
  }
  
  container.innerHTML = items.map(item => {
    const filename = item.filename || extractFilename(item.url) || item.url;
    return `
      <div class="gist-comparison-row">
        <span class="item-id" title="${escapeHtml(item.url)}">${escapeHtml(filename)}</span>
        <span class="item-details"></span>
        <span class="item-status local-only">本地缓存</span>
      </div>
    `;
  }).join('');
  
  if (items.length >= 30) {
    container.innerHTML += `
      <div class="gist-comparison-row" style="justify-content: center; color: var(--text-muted); font-style: italic;">
        点击"刷新 Gist 数据"获取远程数据进行完整对比
      </div>
    `;
  }
}

async function runDiagnostics(gist) {
  await Promise.all([
    compareTasksData(gist),
    compareBoardsData(gist),
    compareMediaData(),
  ]);
}

// --- Tasks Comparison ---

async function compareTasksData(gist) {
  // Get elements directly
  const localTaskCountEl = document.getElementById('localTaskCount');
  const remoteTaskCountEl = document.getElementById('remoteTaskCount');
  const localOnlyTaskCountEl = document.getElementById('localOnlyTaskCount');
  const remoteOnlyTaskCountEl = document.getElementById('remoteOnlyTaskCount');
  const syncedTaskCountEl = document.getElementById('syncedTaskCount');
  const taskComparisonTableEl = document.getElementById('taskComparisonTable');
  
  try {
    // Get local tasks
    const localTasks = await getLocalTasks();
    const localTaskMap = new Map(localTasks.map(t => [t.id, t]));
    console.log('[Diagnostics] compareTasksData - Local tasks:', localTasks.length);

    // Get remote tasks
    let remoteTasks = [];
    if (gist.files && gist.files['tasks.json']) {
      console.log('[Diagnostics] Found tasks.json, parsing...');
      const tasksData = await parseGistFile(gist.files['tasks.json']);
      console.log('[Diagnostics] Parsed tasks.json:', tasksData);
      // TasksData 结构: { completedTasks: Task[] }
      if (tasksData && Array.isArray(tasksData.completedTasks)) {
        remoteTasks = tasksData.completedTasks;
        console.log('[Diagnostics] Extracted completedTasks:', remoteTasks.length);
      } else if (Array.isArray(tasksData)) {
        // 兼容旧格式（直接数组）
        remoteTasks = tasksData;
        console.log('[Diagnostics] Using legacy array format:', remoteTasks.length);
      }
    } else {
      console.log('[Diagnostics] No tasks.json found in gist files:', Object.keys(gist.files || {}));
    }
    const remoteTaskMap = new Map(remoteTasks.map(t => [t.id, t]));
    console.log('[Diagnostics] compareTasksData - Remote tasks:', remoteTasks.length);

    // Compare
    const localIds = new Set(localTaskMap.keys());
    const remoteIds = new Set(remoteTaskMap.keys());
    
    const localOnly = [...localIds].filter(id => !remoteIds.has(id));
    const remoteOnly = [...remoteIds].filter(id => !localIds.has(id));
    const synced = [...localIds].filter(id => remoteIds.has(id));

    // Update summary (use direct element references)
    if (localTaskCountEl) localTaskCountEl.textContent = localTasks.length;
    if (remoteTaskCountEl) remoteTaskCountEl.textContent = remoteTasks.length;
    if (localOnlyTaskCountEl) localOnlyTaskCountEl.textContent = localOnly.length;
    if (remoteOnlyTaskCountEl) remoteOnlyTaskCountEl.textContent = remoteOnly.length;
    if (syncedTaskCountEl) syncedTaskCountEl.textContent = synced.length;

    // Render comparison table
    renderComparisonTable(taskComparisonTableEl, {
      localOnly: localOnly.map(id => ({ id, data: localTaskMap.get(id) })),
      remoteOnly: remoteOnly.map(id => ({ id, data: remoteTaskMap.get(id) })),
      synced: synced.map(id => ({
        id,
        local: localTaskMap.get(id),
        remote: remoteTaskMap.get(id),
      })),
    }, 'task');

  } catch (error) {
    console.error('Task comparison failed:', error);
    if (taskComparisonTableEl) {
      taskComparisonTableEl.innerHTML = `<div class="empty-state" style="padding: 20px;">对比失败: ${error.message}</div>`;
    }
  }
}

// --- Boards Comparison ---

async function compareBoardsData(gist) {
  // Get elements directly
  const localBoardCountEl = document.getElementById('localBoardCount');
  const remoteBoardCountEl = document.getElementById('remoteBoardCount');
  const localOnlyBoardCountEl = document.getElementById('localOnlyBoardCount');
  const remoteOnlyBoardCountEl = document.getElementById('remoteOnlyBoardCount');
  const boardComparisonTableEl = document.getElementById('boardComparisonTable');
  
  try {
    // Get local boards
    const localBoards = await getLocalBoards();
    const localBoardMap = new Map(localBoards.map(b => [b.id, b]));
    console.log('[Diagnostics] compareBoardsData - Local boards:', localBoards.length);

    // Get remote boards from gist files (board_{id}.json format)
    const remoteBoards = [];
    
    if (gist.files) {
      const fileNames = Object.keys(gist.files);
      console.log('[Diagnostics] Gist files:', fileNames);
      
      // 查找 board_{id}.json 格式的文件
      for (const [fileName, fileData] of Object.entries(gist.files)) {
        if (fileName.startsWith('board_') && fileName.endsWith('.json')) {
          // 提取 board ID: board_{id}.json -> {id}
          const boardId = fileName.replace('board_', '').replace('.json', '');
          remoteBoards.push({ id: boardId, fileName, fileData });
        }
      }
      console.log('[Diagnostics] Remote boards (board_*.json):', remoteBoards.length, remoteBoards.map(b => b.fileName));
    }
    
    const remoteBoardMap = new Map(remoteBoards.map(b => [b.id, b]));
    console.log('[Diagnostics] compareBoardsData - Total remote boards:', remoteBoards.length);

    // Compare
    const localIds = new Set(localBoardMap.keys());
    const remoteIds = new Set(remoteBoardMap.keys());
    
    const localOnly = [...localIds].filter(id => !remoteIds.has(id));
    const remoteOnly = [...remoteIds].filter(id => !localIds.has(id));
    const synced = [...localIds].filter(id => remoteIds.has(id));

    // Update summary (use direct element references)
    if (localBoardCountEl) localBoardCountEl.textContent = localBoards.length;
    if (remoteBoardCountEl) remoteBoardCountEl.textContent = remoteBoards.length;
    if (localOnlyBoardCountEl) localOnlyBoardCountEl.textContent = localOnly.length;
    if (remoteOnlyBoardCountEl) remoteOnlyBoardCountEl.textContent = remoteOnly.length;

    // Render comparison table
    renderComparisonTable(boardComparisonTableEl, {
      localOnly: localOnly.map(id => ({ id, data: localBoardMap.get(id) })),
      remoteOnly: remoteOnly.map(id => ({ id, data: remoteBoardMap.get(id) })),
      synced: synced.map(id => ({
        id,
        local: localBoardMap.get(id),
        remote: remoteBoardMap.get(id),
      })),
    }, 'board');

  } catch (error) {
    console.error('Board comparison failed:', error);
    if (boardComparisonTableEl) {
      boardComparisonTableEl.innerHTML = `<div class="empty-state" style="padding: 20px;">对比失败: ${error.message}</div>`;
    }
  }
}

// --- Media Comparison ---

async function compareMediaData() {
  // Get elements directly
  const localMediaCountEl = document.getElementById('localMediaCount');
  const remoteMediaCountEl = document.getElementById('remoteMediaCount');
  const localOnlyMediaCountEl = document.getElementById('localOnlyMediaCount');
  const remoteOnlyMediaCountEl = document.getElementById('remoteOnlyMediaCount');
  const mediaComparisonTableEl = document.getElementById('mediaComparisonTable');
  
  try {
    // Get local cache media
    const localMedia = await listCacheStorageMedia();
    const localUrls = new Set(localMedia.map(m => m.url));
    console.log('[Diagnostics] compareMediaData - Local media:', localMedia.length);

    // Get remote media from master index
    const masterIndex = remoteMasterIndex || localMasterIndex;
    const remoteMedia = masterIndex?.fileIndex ? Object.keys(masterIndex.fileIndex) : [];
    const remoteUrls = new Set(remoteMedia);
    console.log('[Diagnostics] compareMediaData - Remote media (from master index):', remoteMedia.length);

    // Compare
    const localOnly = [...localUrls].filter(url => !remoteUrls.has(url));
    const remoteOnly = [...remoteUrls].filter(url => !localUrls.has(url));
    const synced = [...localUrls].filter(url => remoteUrls.has(url));

    // Update summary (use direct element references)
    if (localMediaCountEl) localMediaCountEl.textContent = localMedia.length;
    if (remoteMediaCountEl) remoteMediaCountEl.textContent = remoteMedia.length;
    if (localOnlyMediaCountEl) localOnlyMediaCountEl.textContent = localOnly.length;
    if (remoteOnlyMediaCountEl) remoteOnlyMediaCountEl.textContent = remoteOnly.length;

    // Render comparison table
    renderMediaComparisonTable(mediaComparisonTableEl, {
      localOnly,
      remoteOnly,
      synced,
      masterIndex,
    });

  } catch (error) {
    console.error('Media comparison failed:', error);
    if (mediaComparisonTableEl) {
      mediaComparisonTableEl.innerHTML = `<div class="empty-state" style="padding: 20px;">对比失败: ${error.message}</div>`;
    }
  }
}

// ====================================
// Comparison Table Rendering
// ====================================

function renderComparisonTable(container, data, type) {
  if (!container) return;

  const rows = [];

  // Local only items
  data.localOnly.forEach(item => {
    rows.push({
      id: item.id,
      status: 'local-only',
      statusText: '仅本地',
      details: getItemDetails(item.data, type),
    });
  });

  // Remote only items
  data.remoteOnly.forEach(item => {
    rows.push({
      id: item.id,
      status: 'remote-only',
      statusText: '仅远程',
      details: getItemDetails(item.data, type),
    });
  });

  // Synced items (show first 10 to avoid overwhelming)
  data.synced.slice(0, 10).forEach(item => {
    const hasConflict = checkConflict(item.local, item.remote);
    rows.push({
      id: item.id,
      status: hasConflict ? 'conflict' : 'synced',
      statusText: hasConflict ? '冲突' : '已同步',
      details: getItemDetails(item.local, type),
    });
  });

  if (rows.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 20px;">无数据</div>';
    return;
  }

  // Sort: local-only first, then remote-only, then conflicts, then synced
  const statusOrder = { 'local-only': 0, 'remote-only': 1, 'conflict': 2, 'synced': 3 };
  rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  container.innerHTML = rows.map(row => `
    <div class="gist-comparison-row">
      <span class="item-id" title="${escapeHtml(row.id)}">${escapeHtml(truncateId(row.id))}</span>
      <span class="item-details">${escapeHtml(row.details)}</span>
      <span class="item-status ${row.status}">${row.statusText}</span>
    </div>
  `).join('');

  // Add note if there are more synced items
  if (data.synced.length > 10) {
    container.innerHTML += `
      <div class="gist-comparison-row" style="justify-content: center; color: var(--text-muted); font-style: italic;">
        还有 ${data.synced.length - 10} 个已同步项未显示
      </div>
    `;
  }
}

function renderMediaComparisonTable(container, data) {
  if (!container) return;

  const rows = [];

  // Synced (show first 20, priority display)
  data.synced.slice(0, 20).forEach(url => {
    rows.push({
      url,
      status: 'synced',
      statusText: '已同步',
    });
  });

  // Local only
  data.localOnly.slice(0, 20).forEach(url => {
    rows.push({
      url,
      status: 'local-only',
      statusText: '仅本地',
    });
  });

  // Remote only
  data.remoteOnly.slice(0, 20).forEach(url => {
    const fileInfo = data.masterIndex?.fileIndex?.[url];
    rows.push({
      url,
      status: 'remote-only',
      statusText: '仅远程',
      shard: fileInfo?.shardId,
    });
  });

  if (rows.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 20px;">无媒体数据</div>';
    return;
  }

  // Sort: synced first, then local-only, then remote-only
  const statusOrder = { 'synced': 0, 'local-only': 1, 'remote-only': 2 };
  rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  container.innerHTML = rows.map(row => {
    const isVideo = isVideoUrl(row.url);
    const previewHtml = getMediaPreviewHtml(row.url, isVideo);
    const filename = extractFilename(row.url);
    
    return `
      <div class="gist-comparison-row media-row">
        <div class="media-preview-container">
          ${previewHtml}
        </div>
        <div class="media-info">
          <span class="item-id" title="${escapeHtml(row.url)}">${escapeHtml(filename)}</span>
          <span class="item-details">${row.shard ? `分片: ${row.shard}` : ''}</span>
        </div>
        <span class="item-status ${row.status}">${row.statusText}</span>
      </div>
    `;
  }).join('');

  // Add notes for truncated lists
  const totalHidden = 
    Math.max(0, data.localOnly.length - 20) + 
    Math.max(0, data.remoteOnly.length - 20) + 
    Math.max(0, data.synced.length - 10);
    
  if (totalHidden > 0) {
    container.innerHTML += `
      <div class="gist-comparison-row" style="justify-content: center; color: var(--text-muted); font-style: italic;">
        还有 ${totalHidden} 个项未显示
      </div>
    `;
  }
}

// ====================================
// Helper Functions
// ====================================

function getItemDetails(item, type) {
  if (!item) return '';
  
  if (type === 'task') {
    const status = item.status || 'unknown';
    const taskType = item.type || '';
    return `${taskType} - ${status}`;
  }
  
  if (type === 'board') {
    const name = item.name || item.title || '';
    return name;
  }
  
  return '';
}

function checkConflict(local, remote) {
  if (!local || !remote) return false;
  // Simple conflict check: different updatedAt
  if (local.updatedAt && remote.updatedAt) {
    return local.updatedAt !== remote.updatedAt;
  }
  return false;
}

function truncateId(id) {
  if (!id) return '';
  if (id.length <= 24) return id;
  return id.substring(0, 12) + '...' + id.substring(id.length - 8);
}

function extractFilename(url) {
  if (!url) return '';
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').pop() || url;
  } catch {
    return url.split('/').pop() || url;
  }
}

/**
 * Check if URL is a video
 */
function isVideoUrl(url) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes('video') || 
         lowerUrl.endsWith('.mp4') || 
         lowerUrl.endsWith('.webm') || 
         lowerUrl.endsWith('.mov') ||
         lowerUrl.includes('/v/');
}

/**
 * Generate preview HTML for media
 */
function getMediaPreviewHtml(url, isVideo) {
  if (!url) return '<div class="media-preview-placeholder">?</div>';
  
  // Handle virtual cache URLs
  let previewUrl = url;
  if (url.startsWith('/__aitu_cache__/')) {
    // Virtual URL, use as-is (SW will intercept)
    previewUrl = url;
  }
  
  if (isVideo) {
    return `
      <video 
        class="media-preview" 
        src="${escapeHtml(previewUrl)}" 
        muted 
        preload="metadata"
        onmouseenter="this.play()" 
        onmouseleave="this.pause();this.currentTime=0;"
        onerror="this.outerHTML='<div class=\\'media-preview-placeholder\\'>视频</div>'"
      ></video>
    `;
  } else {
    return `
      <img 
        class="media-preview" 
        src="${escapeHtml(previewUrl)}" 
        loading="lazy"
        onerror="this.outerHTML='<div class=\\'media-preview-placeholder\\'>图片</div>'"
      />
    `;
  }
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ====================================
// Debug Operations
// ====================================

function initDebugOperations() {
  // Connection tests
  document.getElementById('debugTestConnection')?.addEventListener('click', debugTestConnection);
  document.getElementById('debugListGists')?.addEventListener('click', debugListGists);
  
  // Task operations
  document.getElementById('debugPreviewTaskMerge')?.addEventListener('click', debugPreviewTaskMerge);
  document.getElementById('debugImportRemoteTasks')?.addEventListener('click', debugImportRemoteTasks);
  
  // Board operations
  document.getElementById('debugPreviewBoardMerge')?.addEventListener('click', debugPreviewBoardMerge);
  document.getElementById('debugDownloadBoard')?.addEventListener('click', debugDownloadBoard);
  
  // Media operations
  document.getElementById('debugListShardFiles')?.addEventListener('click', debugListShardFiles);
  document.getElementById('debugTestMediaDownload')?.addEventListener('click', debugTestMediaDownload);
  
  // Log diagnostics
  document.getElementById('debugCheckSyncLogDb')?.addEventListener('click', debugCheckSyncLogDb);
  document.getElementById('debugWriteTestLog')?.addEventListener('click', debugWriteTestLog);
  document.getElementById('debugPerformanceTest')?.addEventListener('click', debugPerformanceTest);
  
  // Database diagnostics
  document.getElementById('debugDiagnoseDb')?.addEventListener('click', debugDiagnoseAllDatabases);
  
  // Initialize Sync Log Viewer
  initSyncLogViewer();
}

/**
 * Write debug log to sync logs database (displays in Sync Logs section)
 */
async function debugLog(level, message, details = null) {
  // Map level to sync log level
  const levelMap = {
    'info': 'info',
    'success': 'success',
    'warning': 'warning',
    'error': 'error',
  };
  const syncLevel = levelMap[level] || 'debug';
  
  // Write to IndexedDB sync logs
  const logEntry = {
    id: `debug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    level: syncLevel,
    category: 'sync',
    module: 'debug-panel',
    message: `[调试] ${message}`,
    data: details,
  };
  
  try {
    const db = await openSyncLogDb();
    const tx = db.transaction('logs', 'readwrite');
    const store = tx.objectStore('logs');
    await new Promise((resolve, reject) => {
      const req = store.add(logEntry);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
    
    // Trigger a silent refresh of sync logs if visible
    if (syncLogAutoRefreshEnabled) {
      silentRefreshSyncLogs();
    }
  } catch (e) {
    console.error('[debugLog] Failed to write log:', e);
  }
}

/**
 * Open sync log database
 */
function openSyncLogDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('aitu-unified-logs', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('logs')) {
        const store = db.createObjectStore('logs', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('level', 'level', { unique: false });
      }
    };
  });
}

// --- Connection Tests ---

async function debugTestConnection() {
  debugLog('info', '开始测试 GitHub API 连接...');
  
  try {
    // Check token
    const encryptedToken = localStorage.getItem('github_sync_token');
    if (!encryptedToken) {
      debugLog('error', 'Token 未配置', '请先在应用中配置 GitHub Token');
      return;
    }
    
    const token = await decryptToken(encryptedToken);
    debugLog('success', 'Token 解密成功');
    
    // Test API
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!response.ok) {
      debugLog('error', `API 请求失败: ${response.status}`, await response.text());
      return;
    }
    
    const user = await response.json();
    debugLog('success', `连接成功! 用户: ${user.login}`, {
      id: user.id,
      login: user.login,
      name: user.name,
      email: user.email,
      plan: user.plan?.name,
    });
    
    // Check rate limit
    const rateLimit = {
      limit: response.headers.get('x-ratelimit-limit'),
      remaining: response.headers.get('x-ratelimit-remaining'),
      reset: new Date(parseInt(response.headers.get('x-ratelimit-reset')) * 1000).toLocaleTimeString(),
    };
    debugLog('info', 'API 速率限制', rateLimit);
    
  } catch (error) {
    debugLog('error', `连接测试失败: ${error.message}`);
  }
}

async function debugListGists() {
  debugLog('info', '获取用户的所有 Gists...');
  
  try {
    await ensureToken();
    
    const response = await fetch('https://api.github.com/gists?per_page=100', {
      headers: {
        'Authorization': `token ${currentToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!response.ok) {
      debugLog('error', `获取 Gists 失败: ${response.status}`);
      return;
    }
    
    const gists = await response.json();
    
    // Filter for sync gists
    const syncGists = gists.filter(g => 
      g.description?.includes('Opentu') ||
      Object.keys(g.files).some(f => 
        (f.startsWith('board_') && f.endsWith('.json')) || 
        f.endsWith('.drawnix') || 
        f === 'tasks.json' || 
        f === 'master-index.json'
      )
    );
    
    debugLog('success', `找到 ${syncGists.length} 个同步相关的 Gists`, 
      syncGists.map(g => ({
        id: g.id,
        description: g.description?.substring(0, 50),
        files: Object.keys(g.files).length,
        created: new Date(g.created_at).toLocaleDateString(),
        updated: new Date(g.updated_at).toLocaleDateString(),
      }))
    );
    
  } catch (error) {
    debugLog('error', `获取 Gists 失败: ${error.message}`);
  }
}

// --- Task Operations ---

async function debugPreviewTaskMerge() {
  debugLog('info', '预览任务合并...');
  
  try {
    await ensureToken();
    await ensureGistData();
    
    // Get local tasks
    const localTasks = await getLocalTasks();
    debugLog('info', `本地任务: ${localTasks.length} 个`);
    
    // Get remote tasks (TasksData 结构: { completedTasks: Task[] })
    let remoteTasks = [];
    if (currentGistData?.files?.['tasks.json']) {
      const tasksData = await parseGistFile(currentGistData.files['tasks.json']);
      if (tasksData && Array.isArray(tasksData.completedTasks)) {
        remoteTasks = tasksData.completedTasks;
      } else if (Array.isArray(tasksData)) {
        // 兼容旧格式
        remoteTasks = tasksData;
      }
    }
    debugLog('info', `远程任务: ${remoteTasks.length} 个`);
    
    // Build maps
    const localMap = new Map(localTasks.map(t => [t.id, t]));
    const remoteMap = new Map(remoteTasks.map(t => [t.id, t]));
    
    // Analyze merge
    const mergeResult = {
      localOnly: [],
      remoteOnly: [],
      conflicts: [],
      identical: [],
    };
    
    // Check local tasks
    for (const [id, local] of localMap) {
      const remote = remoteMap.get(id);
      if (!remote) {
        mergeResult.localOnly.push({ id, type: local.type, status: local.status });
      } else {
        // Compare
        const localUpdated = local.updatedAt || local.createdAt || 0;
        const remoteUpdated = remote.updatedAt || remote.createdAt || 0;
        
        if (localUpdated === remoteUpdated && local.status === remote.status) {
          mergeResult.identical.push({ id });
        } else {
          mergeResult.conflicts.push({
            id,
            local: { status: local.status, updated: localUpdated },
            remote: { status: remote.status, updated: remoteUpdated },
            winner: localUpdated > remoteUpdated ? 'local' : 'remote',
          });
        }
      }
    }
    
    // Check remote only
    for (const [id, remote] of remoteMap) {
      if (!localMap.has(id)) {
        mergeResult.remoteOnly.push({ id, type: remote.type, status: remote.status });
      }
    }
    
    debugLog('success', '任务合并预览完成', mergeResult);
    
    if (mergeResult.remoteOnly.length > 0) {
      debugLog('warning', `有 ${mergeResult.remoteOnly.length} 个远程任务在本地不存在，可能需要导入`);
    }
    
  } catch (error) {
    debugLog('error', `预览任务合并失败: ${error.message}`);
  }
}

async function debugImportRemoteTasks() {
  debugLog('info', '开始导入远程任务...');
  
  try {
    await ensureToken();
    await ensureGistData();
    
    // Get local and remote tasks
    const localTasks = await getLocalTasks();
    const localIds = new Set(localTasks.map(t => t.id));
    
    let remoteTasks = [];
    if (currentGistData?.files?.['tasks.json']) {
      const tasksData = await parseGistFile(currentGistData.files['tasks.json']);
      // TasksData 结构: { completedTasks: Task[] }
      if (tasksData && Array.isArray(tasksData.completedTasks)) {
        remoteTasks = tasksData.completedTasks;
      } else if (Array.isArray(tasksData)) {
        // 兼容旧格式
        remoteTasks = tasksData;
      }
    }
    
    // Find tasks to import
    const tasksToImport = remoteTasks.filter(t => !localIds.has(t.id));
    
    if (tasksToImport.length === 0) {
      debugLog('info', '没有需要导入的任务');
      return;
    }
    
    debugLog('info', `将导入 ${tasksToImport.length} 个任务`);
    
    // Import to SW task queue via IndexedDB
    const db = await openDatabase('sw-task-queue', 2, (db) => {
      if (!db.objectStoreNames.contains('tasks')) {
        db.createObjectStore('tasks', { keyPath: 'id' });
      }
    });
    
    const tx = db.transaction('tasks', 'readwrite');
    const store = tx.objectStore('tasks');
    
    for (const task of tasksToImport) {
      store.put(task);
    }
    
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    
    db.close();
    
    debugLog('success', `成功导入 ${tasksToImport.length} 个任务`, 
      tasksToImport.map(t => ({ id: t.id, type: t.type, status: t.status }))
    );
    
  } catch (error) {
    debugLog('error', `导入任务失败: ${error.message}`);
  }
}

// --- Board Operations ---

async function debugPreviewBoardMerge() {
  debugLog('info', '预览画板合并...');
  
  try {
    await ensureToken();
    await ensureGistData();
    
    // Get local boards
    const localBoards = await getLocalBoards();
    debugLog('info', `本地画板: ${localBoards.length} 个`);
    
    // Get remote boards (board_{id}.json format)
    const remoteBoards = [];
    if (currentGistData?.files) {
      for (const [fileName, fileData] of Object.entries(currentGistData.files)) {
        if (fileName.startsWith('board_') && fileName.endsWith('.json')) {
          // 提取 board ID: board_{id}.json -> {id}
          const boardId = fileName.replace('board_', '').replace('.json', '');
          remoteBoards.push({ id: boardId, fileName });
        }
      }
    }
    debugLog('info', `远程画板: ${remoteBoards.length} 个`);
    
    // Build comparison
    const localIds = new Set(localBoards.map(b => b.id));
    const remoteIds = new Set(remoteBoards.map(b => b.id));
    
    const result = {
      localOnly: localBoards.filter(b => !remoteIds.has(b.id)).map(b => ({
        id: b.id,
        name: b.name || b.title,
        elements: b.elements?.length || 0,
      })),
      remoteOnly: remoteBoards.filter(b => !localIds.has(b.id)).map(b => ({
        id: b.id,
        fileName: b.fileName,
      })),
      both: [...localIds].filter(id => remoteIds.has(id)),
    };
    
    debugLog('success', '画板对比完成', result);
    
    if (result.localOnly.length > 0) {
      debugLog('info', `${result.localOnly.length} 个本地画板未同步到远程`);
    }
    if (result.remoteOnly.length > 0) {
      debugLog('warning', `${result.remoteOnly.length} 个远程画板在本地不存在`);
    }
    
  } catch (error) {
    debugLog('error', `预览画板合并失败: ${error.message}`);
  }
}

async function debugDownloadBoard() {
  debugLog('info', '下载画板...');
  
  try {
    await ensureToken();
    await ensureGistData();
    
    // Get available boards (board_{id}.json format)
    const remoteBoards = [];
    if (currentGistData?.files) {
      for (const [fileName] of Object.entries(currentGistData.files)) {
        if (fileName.startsWith('board_') && fileName.endsWith('.json')) {
          remoteBoards.push(fileName);
        }
      }
    }
    
    if (remoteBoards.length === 0) {
      debugLog('warning', '没有可下载的画板');
      return;
    }
    
    // Download first board as example
    const boardFile = remoteBoards[0];
    debugLog('info', `下载画板: ${boardFile}`);
    
    const boardData = await parseGistFile(currentGistData.files[boardFile]);
    
    if (boardData) {
      debugLog('success', `画板下载成功: ${boardFile}`, {
        id: boardData.id,
        name: boardData.name || boardData.title,
        elements: boardData.elements?.length || 0,
        updatedAt: boardData.updatedAt,
      });
      
      // Show element types
      if (boardData.elements?.length > 0) {
        const elementTypes = {};
        boardData.elements.forEach(el => {
          const type = el.type || 'unknown';
          elementTypes[type] = (elementTypes[type] || 0) + 1;
        });
        debugLog('info', '元素类型统计', elementTypes);
      }
    } else {
      debugLog('error', '画板解析失败');
    }
    
  } catch (error) {
    debugLog('error', `下载画板失败: ${error.message}`);
  }
}

// --- Media Operations ---

async function debugListShardFiles() {
  debugLog('info', '获取分片文件列表...');
  
  try {
    await ensureToken();
    
    // Get master index
    const masterIndex = remoteMasterIndex || localMasterIndex || await getLocalMasterIndex();
    
    if (!masterIndex) {
      debugLog('warning', '未找到分片索引');
      return;
    }
    
    const shards = Object.values(masterIndex.shards || {});
    debugLog('info', `找到 ${shards.length} 个分片`);
    
    // List files in each shard
    for (const shard of shards) {
      debugLog('info', `分片 ${shard.alias}: ${shard.fileCount} 文件, ${formatSize(shard.totalSize)}`, {
        gistId: shard.gistId,
        status: shard.status,
        createdAt: formatTime(shard.createdAt),
      });
    }
    
    // List file index
    const fileIndex = masterIndex.fileIndex || {};
    const fileCount = Object.keys(fileIndex).length;
    debugLog('success', `文件索引: ${fileCount} 个文件`);
    
    // Sample files
    const sampleFiles = Object.entries(fileIndex).slice(0, 5);
    if (sampleFiles.length > 0) {
      debugLog('info', '示例文件', sampleFiles.map(([url, info]) => ({
        url: extractFilename(url),
        shard: info.shardId,
        size: formatSize(info.size),
        type: info.type,
      })));
    }
    
  } catch (error) {
    debugLog('error', `获取分片文件失败: ${error.message}`);
  }
}

async function debugTestMediaDownload() {
  debugLog('info', '测试媒体下载...');
  
  try {
    await ensureToken();
    
    // Get master index
    const masterIndex = remoteMasterIndex || localMasterIndex || await getLocalMasterIndex();
    
    if (!masterIndex?.fileIndex) {
      debugLog('warning', '未找到文件索引');
      return;
    }
    
    // Get a sample file
    const files = Object.entries(masterIndex.fileIndex);
    if (files.length === 0) {
      debugLog('warning', '索引中没有文件');
      return;
    }
    
    const [url, fileInfo] = files[0];
    debugLog('info', `测试下载: ${extractFilename(url)}`, fileInfo);
    
    // Get shard info
    const shard = masterIndex.shards?.[fileInfo.shardId];
    if (!shard) {
      debugLog('error', `找不到分片: ${fileInfo.shardId}`);
      return;
    }
    
    // Fetch shard gist
    debugLog('info', `从分片 ${shard.alias} (${shard.gistId}) 下载...`);
    
    const shardGist = await fetchGist(shard.gistId);
    const fileName = fileInfo.filename;
    
    if (!shardGist.files?.[fileName]) {
      debugLog('error', `分片中找不到文件: ${fileName}`);
      return;
    }
    
    const fileData = shardGist.files[fileName];
    debugLog('success', '文件获取成功', {
      filename: fileName,
      size: fileData.size,
      truncated: fileData.truncated,
      type: fileData.type,
    });
    
    // Check if it's base64 encoded
    if (fileData.content) {
      const isBase64 = fileData.content.match(/^[A-Za-z0-9+/=]+$/);
      debugLog('info', `内容格式: ${isBase64 ? 'Base64 编码' : '文本'}`);
    }
    
  } catch (error) {
    debugLog('error', `测试媒体下载失败: ${error.message}`);
  }
}

// --- Log Diagnostics ---

async function debugCheckSyncLogDb() {
  debugLog('info', '检查同步日志数据库...');
  
  try {
    // 1. Check if IndexedDB is available
    if (!window.indexedDB) {
      debugLog('error', 'IndexedDB 不可用');
      return;
    }
    debugLog('success', 'IndexedDB 可用');
    
    // 2. List all databases
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      const dbNames = dbs.map(db => `${db.name} (v${db.version})`);
      debugLog('info', `已有数据库: ${dbs.length} 个`, dbNames);
      
      const hasUnifiedLogDb = dbs.some(db => db.name === 'aitu-unified-logs');
      if (!hasUnifiedLogDb) {
        debugLog('warning', '统一日志数据库 aitu-unified-logs 不存在');
      }
    }
    
    // 3. Try to open the sync log database
    const stats = await getSyncLogStats();
    debugLog('success', '日志数据库连接成功', stats);
    
    // 4. Query recent logs
    const logs = await querySyncLogs({ limit: 5 });
    if (logs.length === 0) {
      debugLog('warning', '日志数据库为空 - 主应用可能尚未写入日志');
    } else {
      debugLog('success', `找到 ${logs.length} 条最新日志`, 
        logs.map(l => ({
          time: new Date(l.timestamp).toLocaleTimeString(),
          level: l.level,
          category: l.category,
          message: l.message.substring(0, 50),
        }))
      );
    }
    
  } catch (error) {
    debugLog('error', `检查日志数据库失败: ${error.message}`);
  }
}

async function debugWriteTestLog() {
  debugLog('info', '写入测试日志到统一日志数据库...');
  
  try {
    const UNIFIED_LOG_DB = 'aitu-unified-logs';
    const UNIFIED_LOG_STORE = 'logs';
    
    // Open database
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(UNIFIED_LOG_DB, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(UNIFIED_LOG_STORE)) {
          const store = database.createObjectStore(UNIFIED_LOG_STORE, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('level', 'level', { unique: false });
          store.createIndex('sessionId', 'sessionId', { unique: false });
          store.createIndex('category_timestamp', ['category', 'timestamp'], { unique: false });
        }
      };
    });
    
    // Write test log (unified log format)
    const testEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: Date.now(),
      category: 'sync',
      level: 'info',
      message: '这是来自 sw-debug 面板的测试日志',
      data: { source: 'sw-debug', test: true },
    };
    
    const tx = db.transaction(UNIFIED_LOG_STORE, 'readwrite');
    const store = tx.objectStore(UNIFIED_LOG_STORE);
    store.add(testEntry);
    
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    
    db.close();
    
    debugLog('success', '测试日志写入成功', testEntry);
    debugLog('info', '请刷新同步日志区域查看');
    
  } catch (error) {
    debugLog('error', `写入测试日志失败: ${error.message}`);
  }
}

/**
 * Performance benchmark test
 */
async function debugPerformanceTest() {
  debugLog('info', '开始性能基准测试 (1000 次日志写入)...');
  
  try {
    const UNIFIED_LOG_DB = 'aitu-unified-logs';
    const UNIFIED_LOG_STORE = 'logs';
    const iterations = 1000;
    
    // Open database
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(UNIFIED_LOG_DB, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    
    // Test 1: Memory write speed (sync)
    const memoryLogs = [];
    const memoryStart = performance.now();
    
    for (let i = 0; i < iterations; i++) {
      memoryLogs.push({
        id: `perf-${Date.now()}-${i}`,
        timestamp: Date.now(),
        category: 'sync',
        level: 'info',
        message: `Performance test log #${i}`,
        data: { iteration: i },
      });
    }
    
    const memoryEnd = performance.now();
    const memoryTimeMs = memoryEnd - memoryStart;
    const memoryAvgUs = (memoryTimeMs / iterations) * 1000;
    
    debugLog('success', `内存写入: ${memoryTimeMs.toFixed(2)}ms (${memoryAvgUs.toFixed(2)}μs/条)`, {
      iterations,
      totalMs: memoryTimeMs.toFixed(2),
      avgMicroseconds: memoryAvgUs.toFixed(2),
      logsPerSecond: Math.round(iterations / (memoryTimeMs / 1000)),
    });
    
    // Test 2: IndexedDB write speed (async batch)
    const dbStart = performance.now();
    
    const tx = db.transaction(UNIFIED_LOG_STORE, 'readwrite');
    const store = tx.objectStore(UNIFIED_LOG_STORE);
    
    // Batch write
    for (const log of memoryLogs) {
      store.add(log);
    }
    
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    
    const dbEnd = performance.now();
    const dbTimeMs = dbEnd - dbStart;
    const dbAvgUs = (dbTimeMs / iterations) * 1000;
    
    debugLog('success', `IndexedDB 写入: ${dbTimeMs.toFixed(2)}ms (${dbAvgUs.toFixed(2)}μs/条)`, {
      iterations,
      totalMs: dbTimeMs.toFixed(2),
      avgMicroseconds: dbAvgUs.toFixed(2),
      logsPerSecond: Math.round(iterations / (dbTimeMs / 1000)),
    });
    
    db.close();
    
    // Summary
    const passed = memoryAvgUs < 100; // Target: < 100μs per log
    if (passed) {
      debugLog('success', '性能测试通过 ✓', {
        target: '< 100μs/条',
        actual: `${memoryAvgUs.toFixed(2)}μs/条`,
      });
    } else {
      debugLog('warning', '性能未达标', {
        target: '< 100μs/条',
        actual: `${memoryAvgUs.toFixed(2)}μs/条`,
      });
    }
    
  } catch (error) {
    debugLog('error', `性能测试失败: ${error.message}`);
  }
}

/**
 * Diagnose all relevant databases
 */
async function debugDiagnoseAllDatabases() {
  debugLog('info', '开始诊断所有数据库...');
  
  const dbsToCheck = [
    'aitu-workspace',
    'sw-task-queue',
    'aitu-unified-logs',
    'aitu-storage',
  ];
  
  try {
    // List all databases
    if (indexedDB.databases) {
      const allDbs = await indexedDB.databases();
      debugLog('info', `系统中共有 ${allDbs.length} 个数据库`, 
        allDbs.map(db => `${db.name} (v${db.version})`).join(', ')
      );
    }
    
    // Diagnose each database
    for (const dbName of dbsToCheck) {
      try {
        const diagnosis = await diagnoseDatabase(dbName);
        const storeInfo = Object.entries(diagnosis.stores).map(([name, info]) => ({
          store: name,
          count: info.count,
          keyPath: info.keyPath,
          sampleKeys: info.sampleKeys?.join(', ') || '-',
        }));
        
        debugLog('success', `${dbName} (v${diagnosis.version})`, {
          stores: storeInfo,
        });
      } catch (error) {
        debugLog('warning', `${dbName}: ${error.message}`);
      }
    }
    
    // Test actual data retrieval
    debugLog('info', '测试数据获取...');
    
    const localTasks = await getLocalTasks();
    debugLog('info', `本地任务: ${localTasks.length} 条`, 
      localTasks.slice(0, 3).map(t => ({ id: t.id?.substring(0, 12), type: t.type, status: t.status }))
    );
    
    const localBoards = await getLocalBoards();
    debugLog('info', `本地画板: ${localBoards.length} 个`, 
      localBoards.slice(0, 3).map(b => ({ id: b.id?.substring(0, 12), name: b.name }))
    );
    
    const localMedia = await listCacheStorageMedia();
    debugLog('info', `本地缓存媒体: ${localMedia.length} 个`, 
      localMedia.slice(0, 3).map(m => m.filename)
    );
    
    debugLog('success', '数据库诊断完成');
    
  } catch (error) {
    debugLog('error', `数据库诊断失败: ${error.message}`);
  }
}

// --- Helper Functions for Debug ---

async function ensureToken() {
  if (currentToken) return;
  
  const encryptedToken = localStorage.getItem('github_sync_token');
  if (!encryptedToken) {
    throw new Error('未配置 GitHub Token');
  }
  currentToken = await decryptToken(encryptedToken);
}

async function ensureGistData() {
  if (currentGistData) return;
  
  const creds = await getGistCredentials();
  if (!creds.gistId) {
    throw new Error('未配置 Gist ID');
  }
  currentGistId = creds.gistId;
  currentCustomPassword = creds.customPassword;
  currentGistData = await fetchGist(currentGistId);
}

function openDatabase(name, version, upgradeCallback) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      if (upgradeCallback) {
        upgradeCallback(event.target.result);
      }
    };
  });
}

// ====================================
// Sync Log Viewer
// ====================================

function initSyncLogViewer() {
  // Refresh button
  document.getElementById('refreshSyncLogs')?.addEventListener('click', refreshSyncLogs);
  
  // Auto-refresh button
  document.getElementById('toggleAutoRefresh')?.addEventListener('click', toggleAutoRefresh);
  
  // Copy button
  document.getElementById('copySyncLogs')?.addEventListener('click', handleCopySyncLogs);
  
  // Export button
  document.getElementById('exportSyncLogs')?.addEventListener('click', handleExportSyncLogs);
  
  // Clear button
  document.getElementById('clearSyncLogs')?.addEventListener('click', handleClearSyncLogs);
  
  // Filters
  document.getElementById('syncLogLevelFilter')?.addEventListener('change', handleSyncLogFilterChange);
  document.getElementById('syncLogCategoryFilter')?.addEventListener('change', handleSyncLogFilterChange);
  document.getElementById('syncLogSessionFilter')?.addEventListener('change', handleSyncLogFilterChange);
  
  // Clickable stat cards for filtering
  document.querySelectorAll('.sync-log-stat.clickable').forEach(card => {
    card.addEventListener('click', () => {
      const filterLevel = card.dataset.filter;
      handleStatCardClick(card, filterLevel);
    });
  });
  
  // Search with debounce
  let searchTimeout;
  document.getElementById('syncLogSearch')?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      syncLogCurrentFilters.search = e.target.value;
      syncLogCurrentPage = 1;
      loadSyncLogs();
    }, 300);
  });
  
  // Pagination
  document.getElementById('syncLogPrevPage')?.addEventListener('click', () => {
    if (syncLogCurrentPage > 1) {
      syncLogCurrentPage--;
      loadSyncLogs();
    }
  });
  
  document.getElementById('syncLogNextPage')?.addEventListener('click', () => {
    const totalPages = Math.ceil(syncLogTotalEntries / syncLogPageSize);
    if (syncLogCurrentPage < totalPages) {
      syncLogCurrentPage++;
      loadSyncLogs();
    }
  });
}

/**
 * Handle stat card click for filtering
 */
function handleStatCardClick(clickedCard, filterLevel) {
  // Update active state
  document.querySelectorAll('.sync-log-stat.clickable').forEach(card => {
    card.classList.remove('active');
  });
  clickedCard.classList.add('active');
  
  // Update dropdown filter to match
  const levelFilter = document.getElementById('syncLogLevelFilter');
  if (levelFilter) {
    levelFilter.value = filterLevel;
  }
  
  // Apply filter
  syncLogCurrentFilters.level = filterLevel;
  syncLogCurrentPage = 1;
  loadSyncLogs();
}

/**
 * Copy sync logs to clipboard
 */
async function handleCopySyncLogs() {
  try {
    // Query all logs with current filters (no pagination limit)
    const query = { ...syncLogCurrentFilters, limit: 10000 };
    Object.keys(query).forEach(key => {
      if (!query[key]) delete query[key];
    });
    
    const logs = await querySyncLogs(query);
    
    if (logs.length === 0) {
      alert('没有可复制的日志');
      return;
    }
    
    // Format logs for clipboard
    const formattedLogs = logs.map(log => {
      const time = new Date(log.timestamp).toLocaleString('zh-CN');
      const level = log.level?.toUpperCase() || 'INFO';
      const category = log.category || '';
      const message = log.message || '';
      const data = log.data ? JSON.stringify(log.data) : '';
      const error = log.error ? `\n  Error: ${log.error.message || log.error}` : '';
      
      return `[${time}] [${level}]${category ? ` [${category}]` : ''} ${message}${data ? `\n  Data: ${data}` : ''}${error}`;
    }).join('\n\n');
    
    await navigator.clipboard.writeText(formattedLogs);
    debugLog('success', `已复制 ${logs.length} 条日志到剪贴板`);
    
  } catch (error) {
    console.error('Failed to copy logs:', error);
    debugLog('error', `复制日志失败: ${error.message}`);
  }
}

/**
 * Toggle auto-refresh for sync logs
 */
function toggleAutoRefresh() {
  syncLogAutoRefreshEnabled = !syncLogAutoRefreshEnabled;
  
  const btn = document.getElementById('toggleAutoRefresh');
  const label = document.getElementById('autoRefreshLabel');
  
  if (syncLogAutoRefreshEnabled) {
    // Start auto-refresh
    syncLogAutoRefreshInterval = setInterval(async () => {
      console.log('[SyncLogViewer] Auto-refreshing...');
      await silentRefreshSyncLogs();
    }, AUTO_REFRESH_INTERVAL);
    
    // Update UI
    btn?.classList.add('active');
    if (label) label.textContent = '停止';
    
    // Initial refresh
    silentRefreshSyncLogs();
  } else {
    // Stop auto-refresh
    if (syncLogAutoRefreshInterval) {
      clearInterval(syncLogAutoRefreshInterval);
      syncLogAutoRefreshInterval = null;
    }
    
    // Update UI
    btn?.classList.remove('active');
    if (label) label.textContent = '自动';
  }
}

/**
 * Silent refresh - updates logs without resetting filters/page
 */
async function silentRefreshSyncLogs() {
  try {
    // Load stats
    const stats = await getSyncLogStats();
    updateSyncLogStats(stats);
    
    // Check if there are new logs
    if (stats.total !== syncLogTotalEntries && syncLogCurrentPage === 1) {
      syncLogTotalEntries = stats.total;
      await loadSyncLogs();
    }
    
  } catch (error) {
    console.error('Failed to auto-refresh sync logs:', error);
  }
}

async function refreshSyncLogs() {
  console.log('[SyncLogViewer] Refreshing sync logs...');
  try {
    // Load stats
    const stats = await getSyncLogStats();
    console.log('[SyncLogViewer] Stats:', stats);
    updateSyncLogStats(stats);
    
    // Load sessions for filter
    const sessions = await getSyncSessions();
    console.log('[SyncLogViewer] Sessions:', sessions.length);
    populateSessionFilter(sessions);
    
    // Reset to first page and load logs
    syncLogCurrentPage = 1;
    syncLogTotalEntries = stats.total;
    await loadSyncLogs();
    
  } catch (error) {
    console.error('Failed to refresh sync logs:', error);
  }
}

function updateSyncLogStats(stats) {
  document.getElementById('syncLogTotal').textContent = stats.total || 0;
  document.getElementById('syncLogErrors').textContent = stats.byLevel?.error || 0;
  document.getElementById('syncLogWarnings').textContent = stats.byLevel?.warning || 0;
  document.getElementById('syncLogSuccesses').textContent = stats.byLevel?.success || 0;
  document.getElementById('syncLogSessions').textContent = stats.sessionCount || 0;
}

function populateSessionFilter(sessions) {
  const select = document.getElementById('syncLogSessionFilter');
  if (!select) return;
  
  // Keep first option
  select.innerHTML = '<option value="">全部会话</option>';
  
  // Add sessions (most recent first)
  sessions.slice(0, 20).forEach(session => {
    const option = document.createElement('option');
    option.value = session.sessionId;
    const date = new Date(session.startTime);
    const dateStr = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    option.textContent = `${dateStr} ${timeStr} (${session.logCount}条${session.hasErrors ? ', 有错误' : ''})`;
    select.appendChild(option);
  });
}

function handleSyncLogFilterChange() {
  syncLogCurrentFilters = {
    level: document.getElementById('syncLogLevelFilter')?.value || '',
    category: document.getElementById('syncLogCategoryFilter')?.value || '',
    sessionId: document.getElementById('syncLogSessionFilter')?.value || '',
    search: document.getElementById('syncLogSearch')?.value || '',
  };
  syncLogCurrentPage = 1;
  loadSyncLogs();
}

async function loadSyncLogs() {
  const container = document.getElementById('syncLogList');
  if (!container) return;
  
  try {
    const query = {
      ...syncLogCurrentFilters,
      limit: syncLogPageSize * syncLogCurrentPage, // We'll slice later
    };
    
    // Remove empty filters
    Object.keys(query).forEach(key => {
      if (!query[key]) delete query[key];
    });
    
    const allLogs = await querySyncLogs(query);
    
    // Calculate pagination
    const startIndex = (syncLogCurrentPage - 1) * syncLogPageSize;
    const logs = allLogs.slice(startIndex, startIndex + syncLogPageSize);
    syncLogTotalEntries = allLogs.length;
    
    if (logs.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding: 40px;">没有找到匹配的日志</div>';
      updatePagination();
      return;
    }
    
    // 使用 createConsoleEntry 渲染日志（复用控制台日志组件）
    container.innerHTML = '';
    logs.forEach(log => {
      const isExpanded = syncLogExpandedIds.has(log.id);
      const entry = createConsoleEntry(log, isExpanded, (id, expanded) => {
        if (expanded) {
          syncLogExpandedIds.add(id);
        } else {
          syncLogExpandedIds.delete(id);
        }
      }, {
        showDate: true,      // 同步日志显示日期
        showLevelLabel: true // 同步日志显示中文级别标签
      });
      container.appendChild(entry);
    });
    updatePagination();
    
  } catch (error) {
    console.error('Failed to load sync logs:', error);
    container.innerHTML = `<div class="empty-state" style="padding: 40px;">加载日志失败: ${error.message}</div>`;
  }
}

function updatePagination() {
  const totalPages = Math.ceil(syncLogTotalEntries / syncLogPageSize) || 1;
  
  document.getElementById('syncLogPageInfo').textContent = 
    `第 ${syncLogCurrentPage} / ${totalPages} 页 (共 ${syncLogTotalEntries} 条)`;
  
  const prevBtn = document.getElementById('syncLogPrevPage');
  const nextBtn = document.getElementById('syncLogNextPage');
  
  if (prevBtn) prevBtn.disabled = syncLogCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = syncLogCurrentPage >= totalPages;
}

async function handleExportSyncLogs() {
  try {
    const json = await exportSyncLogs(syncLogCurrentFilters);
    
    // Create download
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sync-logs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    debugLog('success', '日志导出成功');
    
  } catch (error) {
    console.error('Failed to export logs:', error);
    debugLog('error', `日志导出失败: ${error.message}`);
  }
}

async function handleClearSyncLogs() {
  if (!confirm('确定要清空所有同步日志吗？此操作不可恢复。')) {
    return;
  }
  
  try {
    await clearSyncLogs();
    debugLog('success', '日志已清空');
    await refreshSyncLogs();
    
  } catch (error) {
    console.error('Failed to clear logs:', error);
    debugLog('error', `清空日志失败: ${error.message}`);
  }
}
