/**
 * 数据序列化服务
 * 负责收集本地数据并序列化为 Gist 文件格式
 */

import { workspaceStorageService } from '../workspace-storage-service';
import {
  getAllWorkspaceBoardMetadata,
  getWorkspaceState,
  reloadWorkspace,
} from '../workspace-runtime-bridge';
import {
  getPromptHistory,
  getVideoPromptHistory,
  getImagePromptHistory,
  initPromptStorageCache,
  mergePromptHistory,
  mergeVideoPromptHistory,
  mergeImagePromptHistory,
} from '../prompt-storage-service';
import { taskStorageReader } from '../task-storage-reader';
import { taskQueueService } from '../task-queue';
import { isVirtualMediaUrl } from '../../utils/virtual-media-url';
import { logDebug, logWarning } from './sync-log-service';
import { TaskStatus, TaskType, Task } from '../../types/task.types';
import { DRAWNIX_DEVICE_ID_KEY } from '../../constants/storage';
import { VERSIONS } from '../../constants';
import {
  SyncManifest,
  WorkspaceData,
  BoardData,
  PromptsData,
  TasksData,
  SYNC_VERSION,
  SYNC_FILES,
  SYNC_FILES_PAGED,
  BoardSyncInfo,
  PromptTombstone,
  TaskTombstone,
  TaskIndex,
  TaskPage,
  WorkflowIndex,
  WorkflowPage,
  KnowledgeBaseData,
} from './types';
import { convertTasksToPagedFormat } from './task-sync-service';
import { convertWorkflowsToPagedFormat } from './workflow-sync-service';
import { workflowStorageReader } from '../workflow-storage-reader';
import { knowledgeBaseSyncService } from './knowledge-base-sync-service';
import type { Board, BoardMetadata } from '../../types/workspace.types';
import { cryptoService, isEncryptedData } from './crypto-service';
import { yieldToMain } from '@aitu/utils';

/**
 * 计算字符串的简单校验和
 */
function calculateChecksum(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * 获取设备 ID
 */
function getDeviceId(): string {
  let deviceId = localStorage.getItem(DRAWNIX_DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem(DRAWNIX_DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

/**
 * 获取设备名称
 */
function getDeviceName(): string {
  const userAgent = navigator.userAgent;
  
  // 尝试识别设备类型
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    return 'iOS Device';
  }
  if (/Android/.test(userAgent)) {
    return 'Android Device';
  }
  if (/Macintosh|Mac OS X/.test(userAgent)) {
    return 'Mac';
  }
  if (/Windows/.test(userAgent)) {
    return 'Windows PC';
  }
  if (/Linux/.test(userAgent)) {
    return 'Linux';
  }
  
  // @ts-ignore: navigator.platform is deprecated but used as fallback
  return navigator.platform || 'Unknown';
}

/**
 * 数据序列化服务
 */
class DataSerializer {
  /**
   * 收集所有需要同步的数据
   */
  async collectSyncData(): Promise<{
    manifest: SyncManifest;
    workspace: WorkspaceData;
    boards: Map<string, BoardData>;
    prompts: PromptsData;
    tasks: TasksData;
    knowledgeBase: KnowledgeBaseData;
  }> {
    // 并行加载所有数据
    const [folders, boards, state] = await Promise.all([
      workspaceStorageService.loadAllFolders(),
      workspaceStorageService.loadAllBoards(),
      workspaceStorageService.loadState(),
    ]);

    // 初始化提示词缓存
    await initPromptStorageCache();

    // 收集提示词数据
    const promptHistory = getPromptHistory();
    const videoPromptHistory = getVideoPromptHistory();
    const imagePromptHistory = getImagePromptHistory();

    // 从 IndexedDB 获取所有已完成的任务
    const allTasks = await taskStorageReader.getAllTasks();
    const completedTasks = allTasks.filter(
      task => task.status === TaskStatus.COMPLETED &&
        (task.type === TaskType.IMAGE || task.type === TaskType.VIDEO)
    );

    // 收集知识库数据
    const kbData = await knowledgeBaseSyncService.getLocalData();

    // 构建画板索引
    const boardsIndex: Record<string, BoardSyncInfo> = {};
    const boardsMap = new Map<string, BoardData>();

    let processedCount = 0;
    for (const board of boards) {
      const boardJson = JSON.stringify(board.elements);
      boardsIndex[board.id] = {
        name: board.name,
        updatedAt: board.updatedAt,
        checksum: calculateChecksum(boardJson),
      };
      boardsMap.set(board.id, board);
      // 每处理 5 个画板让出主线程，避免 UI 阻塞
      processedCount++;
      if (processedCount % 5 === 0) {
        await yieldToMain();
      }
    }

    // 构建工作区数据
    const workspace: WorkspaceData = {
      folders,
      boardMetadata: boards.map(b => this.extractBoardMetadata(b)),
      currentBoardId: state?.currentBoardId || null,
      expandedFolders: state?.expandedFolderIds || [],
    };

    // 构建 manifest
    const deviceId = getDeviceId();
    const now = Date.now();
    
    const manifest: SyncManifest = {
      version: SYNC_VERSION,
      appVersion: VERSIONS.app,
      createdAt: now,
      updatedAt: now,
      deviceId,
      devices: {
        [deviceId]: {
          name: getDeviceName(),
          lastSyncTime: now,
        },
      },
      boards: boardsIndex,
    };

    return {
      manifest,
      workspace,
      boards: boardsMap,
      prompts: {
        promptHistory,
        videoPromptHistory,
        imagePromptHistory,
      },
      tasks: {
        completedTasks,
      },
      knowledgeBase: kbData,
    };
  }

  /**
   * 收集所有需要同步的数据（分页格式）
   * 用于新的分页同步模式
   */
  async collectSyncDataPaged(): Promise<{
    manifest: SyncManifest;
    workspace: WorkspaceData;
    boards: Map<string, BoardData>;
    prompts: PromptsData;
    taskIndex: TaskIndex;
    taskPages: TaskPage[];
    workflowIndex: WorkflowIndex;
    workflowPages: WorkflowPage[];
    knowledgeBase: KnowledgeBaseData;
  }> {
    // 收集基础数据
    const baseData = await this.collectSyncData();

    // 转换任务为分页格式
    const { index: taskIndex, pages: taskPages } = convertTasksToPagedFormat(
      baseData.tasks.completedTasks
    );

    // 收集并转换工作流为分页格式
    const workflows = await workflowStorageReader.getAllWorkflows();
    const terminalWorkflows = workflows.filter(w => 
      w.status === 'completed' || w.status === 'failed' || w.status === 'cancelled'
    );
    const { index: workflowIndex, pages: workflowPages } = convertWorkflowsToPagedFormat(
      terminalWorkflows
    );

    logDebug('DataSerializer: Collected paged sync data', {
      boards: baseData.boards.size,
      taskPages: taskPages.length,
      taskItems: taskIndex.items.length,
      workflowPages: workflowPages.length,
      workflowItems: workflowIndex.items.length,
      knowledgeBase: baseData.knowledgeBase ? {
        notes: baseData.knowledgeBase.notes.length,
        directories: baseData.knowledgeBase.directories.length,
      } : 'NULL',
    });

    return {
      manifest: baseData.manifest,
      workspace: baseData.workspace,
      boards: baseData.boards,
      prompts: baseData.prompts,
      taskIndex,
      taskPages,
      workflowIndex,
      workflowPages,
      knowledgeBase: baseData.knowledgeBase,
    };
  }

  /**
   * 从 Board 提取元数据
   */
  private extractBoardMetadata(board: Board): BoardMetadata {
    return {
      id: board.id,
      name: board.name,
      folderId: board.folderId,
      order: board.order,
      viewport: board.viewport,
      theme: board.theme,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
    };
  }

  /**
   * 序列化为 Gist 文件格式（明文，用于向后兼容）
   */
  serializeToGistFiles(data: {
    manifest: SyncManifest;
    workspace: WorkspaceData;
    boards: Map<string, BoardData>;
    prompts: PromptsData;
    tasks: TasksData;
    knowledgeBase: KnowledgeBaseData;
  }): Record<string, string> {
    const files: Record<string, string> = {};

    // 序列化 manifest
    files[SYNC_FILES.MANIFEST] = JSON.stringify(data.manifest, null, 2);

    // 序列化 workspace
    files[SYNC_FILES.WORKSPACE] = JSON.stringify(data.workspace, null, 2);

    // 序列化每个画板
    for (const [boardId, board] of data.boards) {
      files[SYNC_FILES.boardFile(boardId)] = JSON.stringify(board, null, 2);
    }

    // 序列化提示词
    files[SYNC_FILES.PROMPTS] = JSON.stringify(data.prompts, null, 2);

    // 序列化知识库
    if (data.knowledgeBase) {
      files[SYNC_FILES.KNOWLEDGE_BASE] = JSON.stringify(data.knowledgeBase, null, 2);
    }

    // 注意：不再生成 tasks.json，改用分页格式同步
    // 任务同步由 taskSyncService.syncTasks() 单独处理

    return files;
  }

  /**
   * 序列化为 Gist 文件格式（加密版本）
   * 所有文件都加密（包括 manifest）
   * @param data 要序列化的数据
   * @param gistId Gist ID，用于派生加密密钥
   * @param customPassword 自定义加密密码（可选，优先使用）
   */
  async serializeToGistFilesEncrypted(
    data: {
      manifest: SyncManifest;
      workspace: WorkspaceData;
      boards: Map<string, BoardData>;
      prompts: PromptsData;
      tasks: TasksData;
      knowledgeBase: KnowledgeBaseData;
    },
    gistId: string,
    customPassword?: string
  ): Promise<Record<string, string>> {
    const files: Record<string, string> = {};

    // manifest 也加密
    const manifestJson = JSON.stringify(data.manifest);
    files[SYNC_FILES.MANIFEST] = await cryptoService.encrypt(manifestJson, gistId, customPassword);

    // 加密 workspace
    const workspaceJson = JSON.stringify(data.workspace);
    files[SYNC_FILES.WORKSPACE] = await cryptoService.encrypt(workspaceJson, gistId, customPassword);

    // 加密每个画板
    let boardProcessedCount = 0;
    for (const [boardId, board] of data.boards) {
      const boardJson = JSON.stringify(board);
      files[SYNC_FILES.boardFile(boardId)] = await cryptoService.encrypt(boardJson, gistId, customPassword);
      // 每处理 3 个画板让出主线程，避免 UI 阻塞
      boardProcessedCount++;
      if (boardProcessedCount % 3 === 0) {
        await yieldToMain();
      }
    }

    // 加密提示词
    const promptsJson = JSON.stringify(data.prompts);
    files[SYNC_FILES.PROMPTS] = await cryptoService.encrypt(promptsJson, gistId, customPassword);

    // 加密知识库
    if (data.knowledgeBase) {
      const kbJson = JSON.stringify(data.knowledgeBase);
      files[SYNC_FILES.KNOWLEDGE_BASE] = await cryptoService.encrypt(kbJson, gistId, customPassword);
    }

    // 注意：不再生成 tasks.json，改用分页格式同步
    // 任务同步由 taskSyncService.syncTasks() 单独处理

    return files;
  }

  /**
   * 序列化为 Gist 文件格式（分页加密版本）
   * 使用分页格式存储任务和工作流
   */
  async serializeToGistFilesPagedEncrypted(
    data: {
      manifest: SyncManifest;
      workspace: WorkspaceData;
      boards: Map<string, BoardData>;
      prompts: PromptsData;
      taskIndex: TaskIndex;
      taskPages: TaskPage[];
      workflowIndex: WorkflowIndex;
      workflowPages: WorkflowPage[];
      knowledgeBase: KnowledgeBaseData;
    },
    gistId: string,
    customPassword?: string
  ): Promise<Record<string, string>> {
    const files: Record<string, string> = {};

    // manifest 加密
    const manifestJson = JSON.stringify(data.manifest);
    files[SYNC_FILES.MANIFEST] = await cryptoService.encrypt(manifestJson, gistId, customPassword);

    // 加密 workspace
    const workspaceJson = JSON.stringify(data.workspace);
    files[SYNC_FILES.WORKSPACE] = await cryptoService.encrypt(workspaceJson, gistId, customPassword);

    // 加密每个画板
    let pagedBoardCount = 0;
    for (const [boardId, board] of data.boards) {
      const boardJson = JSON.stringify(board);
      files[SYNC_FILES.boardFile(boardId)] = await cryptoService.encrypt(boardJson, gistId, customPassword);
      // 每处理 3 个画板让出主线程，避免 UI 阻塞
      pagedBoardCount++;
      if (pagedBoardCount % 3 === 0) {
        await yieldToMain();
      }
    }

    // 加密提示词
    const promptsJson = JSON.stringify(data.prompts);
    files[SYNC_FILES.PROMPTS] = await cryptoService.encrypt(promptsJson, gistId, customPassword);

    // 加密知识库
    if (data.knowledgeBase) {
      const kbJson = JSON.stringify(data.knowledgeBase);
      files[SYNC_FILES.KNOWLEDGE_BASE] = await cryptoService.encrypt(kbJson, gistId, customPassword);
    }

    // 加密任务索引
    const taskIndexJson = JSON.stringify(data.taskIndex);
    files[SYNC_FILES_PAGED.TASK_INDEX] = await cryptoService.encrypt(taskIndexJson, gistId, customPassword);

    // 加密任务分页
    let taskPageCount = 0;
    for (const page of data.taskPages) {
      const pageJson = JSON.stringify(page);
      const filename = SYNC_FILES_PAGED.taskPageFile(page.pageId);
      files[filename] = await cryptoService.encrypt(pageJson, gistId, customPassword);
      // 每处理 3 个分页让出主线程
      taskPageCount++;
      if (taskPageCount % 3 === 0) {
        await yieldToMain();
      }
    }

    // 加密工作流索引
    const workflowIndexJson = JSON.stringify(data.workflowIndex);
    files[SYNC_FILES_PAGED.WORKFLOW_INDEX] = await cryptoService.encrypt(workflowIndexJson, gistId, customPassword);

    // 加密工作流分页
    let workflowPageCount = 0;
    for (const page of data.workflowPages) {
      const pageJson = JSON.stringify(page);
      const filename = SYNC_FILES_PAGED.workflowPageFile(page.pageId);
      files[filename] = await cryptoService.encrypt(pageJson, gistId, customPassword);
      // 每处理 3 个分页让出主线程
      workflowPageCount++;
      if (workflowPageCount % 3 === 0) {
        await yieldToMain();
      }
    }

    logDebug('DataSerializer: Serialized paged files', {
      totalFiles: Object.keys(files).length,
      taskPages: data.taskPages.length,
      workflowPages: data.workflowPages.length,
    });

    return files;
  }

  /**
   * 从 Gist 文件反序列化（明文版本，用于向后兼容）
   */
  deserializeFromGistFiles(files: Record<string, string>): {
    manifest: SyncManifest | null;
    workspace: WorkspaceData | null;
    boards: Map<string, BoardData>;
    prompts: PromptsData | null;
    tasks: TasksData | null;
    knowledgeBase: KnowledgeBaseData | null;
  } {
    const result = {
      manifest: null as SyncManifest | null,
      workspace: null as WorkspaceData | null,
      boards: new Map<string, BoardData>(),
      prompts: null as PromptsData | null,
      tasks: null as TasksData | null,
      knowledgeBase: null as KnowledgeBaseData | null,
    };

    // 解析 manifest
    if (files[SYNC_FILES.MANIFEST]) {
      try {
        result.manifest = JSON.parse(files[SYNC_FILES.MANIFEST]);
      } catch (e) {
        logWarning('DataSerializer: Failed to parse manifest:', { error: String(e) });
      }
    }

    // 解析 workspace
    if (files[SYNC_FILES.WORKSPACE]) {
      try {
        result.workspace = JSON.parse(files[SYNC_FILES.WORKSPACE]);
      } catch (e) {
        logWarning('DataSerializer: Failed to parse workspace:', { error: String(e) });
      }
    }

    // 解析画板
    for (const [filename, content] of Object.entries(files)) {
      if (filename.startsWith('board_') && filename.endsWith('.json')) {
        try {
          const board: BoardData = JSON.parse(content);
          logDebug(`DataSerializer: Parsed board ${filename}:`, {
            id: board.id,
            name: board.name,
            elements: board.elements?.length || 0,
            hasElements: !!board.elements,
            viewport: board.viewport,
          });
          result.boards.set(board.id, board);
        } catch (e) {
          logWarning(`DataSerializer: Failed to parse board ${filename}:`, { error: String(e) });
        }
      }
    }

    // 解析提示词
    if (files[SYNC_FILES.PROMPTS]) {
      try {
        result.prompts = JSON.parse(files[SYNC_FILES.PROMPTS]);
      } catch (e) {
        logWarning('DataSerializer: Failed to parse prompts:', { error: String(e) });
      }
    }

    // 解析知识库
    if (files[SYNC_FILES.KNOWLEDGE_BASE]) {
      try {
        result.knowledgeBase = JSON.parse(files[SYNC_FILES.KNOWLEDGE_BASE]);
      } catch (e) {
        logWarning('DataSerializer: Failed to parse knowledge base:', { error: String(e) });
      }
    }

    // 注意：tasks 使用分页格式同步，不再解析 tasks.json

    return result;
  }

  /**
   * 从 Gist 文件反序列化（支持加密和明文）
   * 自动检测是否加密，并进行相应处理
   * @param files Gist 文件内容
   * @param gistId Gist ID，用于解密
   * @param customPassword 自定义解密密码（可选）
   * @throws DecryptionError 如果需要密码但未提供
   */
  async deserializeFromGistFilesWithDecryption(
    files: Record<string, string>,
    gistId: string,
    customPassword?: string
  ): Promise<{
    manifest: SyncManifest | null;
    workspace: WorkspaceData | null;
    boards: Map<string, BoardData>;
    prompts: PromptsData | null;
    tasks: TasksData | null;
    knowledgeBase: KnowledgeBaseData | null;
  }> {
    logDebug('DataSerializer: ========== deserializeFromGistFilesWithDecryption START ==========');
    logDebug('DataSerializer: Input files:', {
      fileCount: Object.keys(files).length,
      fileNames: Object.keys(files),
      fileSizes: Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, v?.length || 0])
      ),
    });
    logDebug('DataSerializer: gistId:', { id: gistId?.substring(0, 8) + '...' });
    logDebug('DataSerializer: customPassword:', { status: customPassword ? '***SET***' : 'NOT SET' });
    
    const result = {
      manifest: null as SyncManifest | null,
      workspace: null as WorkspaceData | null,
      boards: new Map<string, BoardData>(),
      prompts: null as PromptsData | null,
      tasks: null as TasksData | null,
      knowledgeBase: null as KnowledgeBaseData | null,
    };

    // 解析 manifest（也加密了）
    if (files[SYNC_FILES.MANIFEST]) {
      logDebug('DataSerializer: Parsing manifest', { encrypted: isEncryptedData(files[SYNC_FILES.MANIFEST]) });
      try {
        const manifestContent = await cryptoService.decryptOrPassthrough(files[SYNC_FILES.MANIFEST], gistId, customPassword);
        result.manifest = JSON.parse(manifestContent);
        logDebug('DataSerializer: Manifest parsed successfully:', {
          version: result.manifest?.version,
          boardsCount: result.manifest?.boards ? Object.keys(result.manifest.boards).length : 0,
          boardIds: result.manifest?.boards ? Object.keys(result.manifest.boards) : [],
        });
      } catch (e) {
        // 重新抛出解密错误
        if (e instanceof Error && e.name === 'DecryptionError') {
          throw e;
        }
        logWarning('DataSerializer: Failed to parse manifest:', { error: String(e) });
      }
    } else {
      logWarning('DataSerializer: Manifest file NOT FOUND in input files!');
    }

    logDebug('DataSerializer: Deserializing with customPassword', { enabled: !!customPassword });

    // 解析 workspace
    if (files[SYNC_FILES.WORKSPACE]) {
      logDebug('DataSerializer: Parsing workspace', { encrypted: isEncryptedData(files[SYNC_FILES.WORKSPACE]) });
      try {
        const content = await cryptoService.decryptOrPassthrough(files[SYNC_FILES.WORKSPACE], gistId, customPassword);
        logDebug('DataSerializer: Workspace decrypted content length', { length: content.length });
        result.workspace = JSON.parse(content);
        logDebug('DataSerializer: Workspace parsed successfully:', {
          currentBoardId: result.workspace?.currentBoardId,
          folders: result.workspace?.folders?.length || 0,
          boardMetadata: result.workspace?.boardMetadata?.length || 0,
          boardMetadataIds: result.workspace?.boardMetadata?.map(m => m.id) || [],
        });
      } catch (e) {
        // 重新抛出解密错误
        if (e instanceof Error && e.name === 'DecryptionError') {
          throw e;
        }
        logWarning('DataSerializer: Failed to parse workspace:', { error: String(e) });
      }
    } else {
      logWarning('DataSerializer: Workspace file NOT FOUND in input files!');
    }

    // 解析画板
    logDebug('DataSerializer: Parsing boards...');
    let boardFilesFound = 0;
    for (const [filename, content] of Object.entries(files)) {
      if (filename.startsWith('board_') && filename.endsWith('.json')) {
        boardFilesFound++;
        logDebug('DataSerializer: Processing board file', { filename, length: content?.length || 0 });
        try {
          const decryptedContent = await cryptoService.decryptOrPassthrough(content, gistId, customPassword);
          logDebug('DataSerializer: Board decrypted', { filename, length: decryptedContent.length });
          const board: BoardData = JSON.parse(decryptedContent);
          logDebug(`DataSerializer: Parsed board ${filename}:`, {
            id: board.id,
            name: board.name,
            elements: board.elements?.length || 0,
            hasElements: !!board.elements,
            viewport: board.viewport,
          });
          result.boards.set(board.id, board);
        } catch (e) {
          // 重新抛出解密错误
          if (e instanceof Error && e.name === 'DecryptionError') {
            throw e;
          }
          logWarning(`DataSerializer: Failed to parse board ${filename}:`, { error: String(e) });
        }
      }
    }
    logDebug('DataSerializer: Board files found', { found: boardFilesFound, parsed: result.boards.size });

    // 解析提示词
    if (files[SYNC_FILES.PROMPTS]) {
      logDebug('DataSerializer: Parsing prompts', { encrypted: isEncryptedData(files[SYNC_FILES.PROMPTS]) });
      try {
        const content = await cryptoService.decryptOrPassthrough(files[SYNC_FILES.PROMPTS], gistId, customPassword);
        result.prompts = JSON.parse(content);
        logDebug('DataSerializer: Prompts parsed successfully:', {
          promptHistory: result.prompts?.promptHistory?.length || 0,
          videoPromptHistory: result.prompts?.videoPromptHistory?.length || 0,
          imagePromptHistory: result.prompts?.imagePromptHistory?.length || 0,
        });
      } catch (e) {
        // 重新抛出解密错误
        if (e instanceof Error && e.name === 'DecryptionError') {
          throw e;
        }
        logWarning('DataSerializer: Failed to parse prompts:', { error: String(e) });
      }
    } else {
      logWarning('DataSerializer: Prompts file NOT FOUND in input files!');
    }

    // 解析知识库
    if (files[SYNC_FILES.KNOWLEDGE_BASE]) {
      logDebug('DataSerializer: Parsing knowledge base', { encrypted: isEncryptedData(files[SYNC_FILES.KNOWLEDGE_BASE]) });
      try {
        const content = await cryptoService.decryptOrPassthrough(files[SYNC_FILES.KNOWLEDGE_BASE], gistId, customPassword);
        result.knowledgeBase = JSON.parse(content);
        logDebug('DataSerializer: Knowledge base parsed successfully:', {
          directories: result.knowledgeBase?.directories?.length || 0,
          notes: result.knowledgeBase?.notes?.length || 0,
        });
      } catch (e) {
        // 重新抛出解密错误
        if (e instanceof Error && e.name === 'DecryptionError') {
          throw e;
        }
        logWarning('DataSerializer: Failed to parse knowledge base:', { error: String(e) });
      }
    }

    // 注意：tasks 使用分页格式同步，不再解析 tasks.json

    logDebug('DataSerializer: ========== deserializeFromGistFilesWithDecryption END ==========');
    logDebug('DataSerializer: Final result:', {
      hasManifest: !!result.manifest,
      hasWorkspace: !!result.workspace,
      boardsCount: result.boards.size,
      boardIds: Array.from(result.boards.keys()),
      hasPrompts: !!result.prompts,
      hasTasks: !!result.tasks,
    });
    
    return result;
  }

  /**
   * 从 Gist 文件反序列化（分页加密版本）
   * 支持新的分页格式
   */
  async deserializeFromGistFilesPagedWithDecryption(
    files: Record<string, string>,
    gistId: string,
    customPassword?: string
  ): Promise<{
    manifest: SyncManifest | null;
    workspace: WorkspaceData | null;
    boards: Map<string, BoardData>;
    prompts: PromptsData | null;
    taskIndex: TaskIndex | null;
    taskPages: Map<number, TaskPage>;
    workflowIndex: WorkflowIndex | null;
    workflowPages: Map<number, WorkflowPage>;
    knowledgeBase: KnowledgeBaseData | null;
  }> {
    logDebug('DataSerializer: ========== deserializeFromGistFilesPagedWithDecryption START ==========');
    
    const result = {
      manifest: null as SyncManifest | null,
      workspace: null as WorkspaceData | null,
      boards: new Map<string, BoardData>(),
      prompts: null as PromptsData | null,
      taskIndex: null as TaskIndex | null,
      taskPages: new Map<number, TaskPage>(),
      workflowIndex: null as WorkflowIndex | null,
      workflowPages: new Map<number, WorkflowPage>(),
      knowledgeBase: null as KnowledgeBaseData | null,
    };

    // 解析 manifest
    if (files[SYNC_FILES.MANIFEST]) {
      try {
        const manifestContent = await cryptoService.decryptOrPassthrough(
          files[SYNC_FILES.MANIFEST],
          gistId,
          customPassword
        );
        result.manifest = JSON.parse(manifestContent);
      } catch (e) {
        if (e instanceof Error && e.name === 'DecryptionError') throw e;
        logWarning('DataSerializer: Failed to parse manifest:', { error: String(e) });
      }
    }

    // 解析 workspace
    if (files[SYNC_FILES.WORKSPACE]) {
      try {
        const content = await cryptoService.decryptOrPassthrough(
          files[SYNC_FILES.WORKSPACE],
          gistId,
          customPassword
        );
        result.workspace = JSON.parse(content);
      } catch (e) {
        if (e instanceof Error && e.name === 'DecryptionError') throw e;
        logWarning('DataSerializer: Failed to parse workspace:', { error: String(e) });
      }
    }

    // 解析画板
    for (const [filename, content] of Object.entries(files)) {
      if (filename.startsWith('board_') && filename.endsWith('.json')) {
        try {
          const decrypted = await cryptoService.decryptOrPassthrough(content, gistId, customPassword);
          const board: BoardData = JSON.parse(decrypted);
          result.boards.set(board.id, board);
        } catch (e) {
          if (e instanceof Error && e.name === 'DecryptionError') throw e;
          logWarning(`DataSerializer: Failed to parse board ${filename}:`, { error: String(e) });
        }
      }
    }

    // 解析提示词
    if (files[SYNC_FILES.PROMPTS]) {
      try {
        const content = await cryptoService.decryptOrPassthrough(
          files[SYNC_FILES.PROMPTS],
          gistId,
          customPassword
        );
        result.prompts = JSON.parse(content);
      } catch (e) {
        if (e instanceof Error && e.name === 'DecryptionError') throw e;
        logWarning('DataSerializer: Failed to parse prompts:', { error: String(e) });
      }
    }

    // 解析任务（只支持分页格式）
    // 解析任务索引
    if (files[SYNC_FILES_PAGED.TASK_INDEX]) {
      try {
        const content = await cryptoService.decryptOrPassthrough(
          files[SYNC_FILES_PAGED.TASK_INDEX],
          gistId,
          customPassword
        );
        result.taskIndex = JSON.parse(content);
        logDebug('DataSerializer: Parsed task index:', {
          items: result.taskIndex?.items?.length || 0,
          pages: result.taskIndex?.pages?.length || 0,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'DecryptionError') throw e;
        logWarning('DataSerializer: Failed to parse task index:', { error: String(e) });
      }
    }

    // 解析任务分页
    for (const [filename, content] of Object.entries(files)) {
      if (SYNC_FILES_PAGED.isTaskPageFile(filename)) {
        try {
          const decrypted = await cryptoService.decryptOrPassthrough(content, gistId, customPassword);
          const page: TaskPage = JSON.parse(decrypted);
          result.taskPages.set(page.pageId, page);
        } catch (e) {
          if (e instanceof Error && e.name === 'DecryptionError') throw e;
          logWarning(`DataSerializer: Failed to parse task page ${filename}:`, { error: String(e) });
        }
      }
    }

    // 解析工作流索引
    if (files[SYNC_FILES_PAGED.WORKFLOW_INDEX]) {
      try {
        const content = await cryptoService.decryptOrPassthrough(
          files[SYNC_FILES_PAGED.WORKFLOW_INDEX],
          gistId,
          customPassword
        );
        result.workflowIndex = JSON.parse(content);
        logDebug('DataSerializer: Parsed workflow index:', {
          items: result.workflowIndex?.items?.length || 0,
          pages: result.workflowIndex?.pages?.length || 0,
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'DecryptionError') throw e;
        logWarning('DataSerializer: Failed to parse workflow index:', { error: String(e) });
      }
    }

    // 解析工作流分页
    for (const [filename, content] of Object.entries(files)) {
      if (SYNC_FILES_PAGED.isWorkflowPageFile(filename)) {
        try {
          const decrypted = await cryptoService.decryptOrPassthrough(content, gistId, customPassword);
          const page: WorkflowPage = JSON.parse(decrypted);
          result.workflowPages.set(page.pageId, page);
        } catch (e) {
          if (e instanceof Error && e.name === 'DecryptionError') throw e;
          logWarning(`DataSerializer: Failed to parse workflow page ${filename}:`, { error: String(e) });
        }
      }
    }

    // 解析知识库
    if (files[SYNC_FILES.KNOWLEDGE_BASE]) {
      try {
        const content = await cryptoService.decryptOrPassthrough(
          files[SYNC_FILES.KNOWLEDGE_BASE],
          gistId,
          customPassword
        );
        result.knowledgeBase = JSON.parse(content);
      } catch (e) {
        if (e instanceof Error && e.name === 'DecryptionError') throw e;
        logWarning('DataSerializer: Failed to parse knowledge base:', { error: String(e) });
      }
    }

    logDebug('DataSerializer: ========== deserializeFromGistFilesPagedWithDecryption END ==========');
    logDebug('DataSerializer: Paged result:', {
      hasManifest: !!result.manifest,
      hasWorkspace: !!result.workspace,
      boardsCount: result.boards.size,
      hasPrompts: !!result.prompts,
      hasTaskIndex: !!result.taskIndex,
      taskPagesCount: result.taskPages.size,
      hasWorkflowIndex: !!result.workflowIndex,
      workflowPagesCount: result.workflowPages.size,
      hasKnowledgeBase: !!result.knowledgeBase,
    });

    return result;
  }

  /**
   * 应用同步数据到本地
   */
  async applySyncData(data: {
    workspace: WorkspaceData | null;
    boards: Map<string, BoardData>;
    prompts: PromptsData | null;
    tasks: TasksData | null;
    knowledgeBase?: KnowledgeBaseData | null;
    /** 需要删除的画板 ID 列表 */
    deletedBoardIds?: string[];
    /** 需要删除的提示词 ID 列表 */
    deletedPromptIds?: string[];
    /** 需要删除的任务 ID 列表 */
    deletedTaskIds?: string[];
  }): Promise<{
    boardsApplied: number;
    promptsApplied: number;
    tasksApplied: number;
    knowledgeBaseApplied: number;
    boardsDeleted: number;
    promptsDeleted: number;
    tasksDeleted: number;
    remoteCurrentBoardId?: string | null;
  }> {
    logDebug('DataSerializer: ========== applySyncData START ==========');
    logDebug('DataSerializer: applySyncData called with:', {
      hasWorkspace: !!data.workspace,
      workspace: data.workspace ? {
        currentBoardId: data.workspace.currentBoardId,
        folders: data.workspace.folders?.length || 0,
        boardMetadata: data.workspace.boardMetadata?.length || 0,
        boardMetadataIds: data.workspace.boardMetadata?.map(m => m.id) || [],
      } : 'NULL',
      boardsCount: data.boards.size,
      boardIds: Array.from(data.boards.keys()),
      hasPrompts: !!data.prompts,
      prompts: data.prompts ? {
        promptHistory: data.prompts.promptHistory?.length || 0,
        videoPromptHistory: data.prompts.videoPromptHistory?.length || 0,
        imagePromptHistory: data.prompts.imagePromptHistory?.length || 0,
      } : 'NULL',
      hasTasks: !!data.tasks,
      tasks: data.tasks ? {
        completedTasks: data.tasks.completedTasks?.length || 0,
      } : 'NULL',
      hasKnowledgeBase: !!data.knowledgeBase,
      deletedBoardIds: data.deletedBoardIds?.length || 0,
      deletedPromptIds: data.deletedPromptIds?.length || 0,
      deletedTaskIds: data.deletedTaskIds?.length || 0,
    });

    let boardsApplied = 0;
    let promptsApplied = 0;
    let tasksApplied = 0;
    let knowledgeBaseApplied = 0;
    let boardsDeleted = 0;
    let promptsDeleted = 0;
    let tasksDeleted = 0;

    // 应用文件夹
    if (data.workspace) {
      logDebug('DataSerializer: Applying folders:', { count: data.workspace.folders.length });
      for (const folder of data.workspace.folders) {
        await workspaceStorageService.saveFolder(folder);
      }
    }

    // 应用画板
    logDebug('DataSerializer: Applying boards...');
    for (const [boardId, board] of data.boards) {
      logDebug(`DataSerializer: Saving board: ${boardId} - ${board.name}, elements: ${board.elements?.length || 0}`, {
        folderId: board.folderId,
        viewport: board.viewport,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      });
      await workspaceStorageService.saveBoard(board);
      
      // 验证保存成功
      const savedBoard = await workspaceStorageService.loadBoard(boardId);
      logDebug(`DataSerializer: Verified saved board: ${boardId}`, {
        found: !!savedBoard,
        elements: savedBoard?.elements?.length || 0,
      });
      
      boardsApplied++;
    }
    logDebug('DataSerializer: Boards applied:', { count: boardsApplied });

    // 删除画板（远程已标记为 tombstone 的）
    if (data.deletedBoardIds && data.deletedBoardIds.length > 0) {
      logDebug('DataSerializer: Deleting boards:', { ids: data.deletedBoardIds });
      for (const boardId of data.deletedBoardIds) {
        try {
          await workspaceStorageService.deleteBoard(boardId);
          boardsDeleted++;
          logDebug(`DataSerializer: Deleted board: ${boardId}`);
        } catch (e) {
          logWarning(`DataSerializer: Failed to delete board ${boardId}:`, { error: String(e) });
        }
      }
      logDebug('DataSerializer: Boards deleted:', { count: boardsDeleted });
    }

    // 刷新工作区
    if (boardsApplied > 0) {
      logDebug('DataSerializer: ========== RELOAD WORKSPACE START ==========');
      logDebug('DataSerializer: Calling workspaceService.reload()...');
      await reloadWorkspace();
      logDebug('DataSerializer: workspaceService.reload() completed');
      
      // 验证工作区加载状态
      const allBoards = getAllWorkspaceBoardMetadata();
      logDebug('DataSerializer: Workspace reloaded, boards in memory:', {
        count: allBoards.length,
        ids: allBoards.map(b => b.id),
        names: allBoards.map(b => b.name),
      });
      
      // 验证每个已保存的画板是否能从存储中加载
      logDebug('DataSerializer: Verifying all saved boards in storage...');
      for (const boardId of data.boards.keys()) {
        const loadedBoard = await workspaceStorageService.loadBoard(boardId);
        logDebug(`DataSerializer: VERIFY board ${boardId}:`, {
          foundInStorage: !!loadedBoard,
          name: loadedBoard?.name || 'N/A',
          elements: loadedBoard?.elements?.length || 0,
        });
      }
      
      // 如果有远程 currentBoardId，更新工作区状态
      if (data.workspace?.currentBoardId) {
        logDebug('DataSerializer: Setting currentBoardId from remote:', { id: data.workspace.currentBoardId });
        // 保存工作区状态（包括 currentBoardId）
        const currentState = getWorkspaceState();
        logDebug('DataSerializer: Current state before update:', { state: currentState as unknown as Record<string, unknown> });
        await workspaceStorageService.saveState({
          ...currentState,
          currentBoardId: data.workspace.currentBoardId,
        });
        logDebug('DataSerializer: Saved workspace state with currentBoardId');
        
        // 验证保存成功
        const verifyState = await workspaceStorageService.loadState();
        logDebug('DataSerializer: VERIFY state after save:', {
          currentBoardId: verifyState.currentBoardId,
          match: verifyState.currentBoardId === data.workspace.currentBoardId,
        });
      }
      logDebug('DataSerializer: ========== RELOAD WORKSPACE END ==========');
    }

    // 应用提示词
    if (data.prompts) {
      // 合并通用提示词历史
      if (data.prompts.promptHistory && data.prompts.promptHistory.length > 0) {
        promptsApplied += mergePromptHistory(data.prompts.promptHistory);
      }
      // 合并视频提示词历史
      if (data.prompts.videoPromptHistory && data.prompts.videoPromptHistory.length > 0) {
        promptsApplied += mergeVideoPromptHistory(data.prompts.videoPromptHistory);
      }
      // 合并图片提示词历史
      if (data.prompts.imagePromptHistory && data.prompts.imagePromptHistory.length > 0) {
        promptsApplied += mergeImagePromptHistory(data.prompts.imagePromptHistory);
      }
    }

    // 应用任务（合并远程和本地的已完成任务，基于 ID 去重）
    logDebug('DataSerializer: Applying tasks...', {
      hasTasks: !!data.tasks,
      completedTasksCount: data.tasks?.completedTasks?.length || 0,
    });
    
    if (data.tasks && data.tasks.completedTasks && data.tasks.completedTasks.length > 0) {
      // 从 IndexedDB 获取所有本地任务
      const localTasks = await taskStorageReader.getAllTasks();
      const localTaskMap = new Map(localTasks.map(t => [t.id, t]));
      
      logDebug('DataSerializer: Local tasks:', {
        count: localTasks.length,
        ids: Array.from(localTaskMap.keys()).slice(0, 5), // 只显示前5个
      });
      
      // 基于 ID 去重合并：远程任务优先（如果本地也有相同 ID 的任务，使用更新时间较新的）
      const tasksToRestore: Task[] = [];
      
      for (const remoteTask of data.tasks.completedTasks) {
        const localTask = localTaskMap.get(remoteTask.id);
        
        if (!localTask) {
          // 本地不存在，需要恢复
          tasksToRestore.push(remoteTask);
        } else if (remoteTask.updatedAt && localTask.updatedAt && remoteTask.updatedAt > localTask.updatedAt) {
          // 远程更新时间更新，使用远程版本
          tasksToRestore.push(remoteTask);
        }
        // 如果本地版本更新或相同，保留本地版本（不需要额外操作）
      }
      
      logDebug('DataSerializer: Tasks to restore after merge:', {
        count: tasksToRestore.length,
        ids: tasksToRestore.slice(0, 5).map(t => t.id),
      });
      
      if (tasksToRestore.length > 0) {
        // 标记需要从云端下载媒体的任务（保留原始 URL 不变）
        const processedTasks = tasksToRestore.map(task => {
          // 如果任务有本地缓存 URL，标记为需要下载媒体
          if (task.result?.url && isVirtualMediaUrl(task.result.url)) {
            return {
              ...task,
              result: {
                ...task.result,
                needsMediaDownload: true, // 标记需要下载媒体
              },
            };
          }
          return task;
        });
        
        logDebug('DataSerializer: Calling restoreTasks with tasks', { count: processedTasks.length });
        try {
          await taskQueueService.restoreTasks(processedTasks, {
            allowDeletedTaskRestore: true,
          });
          tasksApplied = processedTasks.length;
          logDebug('DataSerializer: Tasks restored:', { count: tasksApplied });
        } catch (err) {
          // SW 可能未初始化或超时，跳过任务恢复但继续同步
          logWarning('DataSerializer: Failed to restore tasks (SW may not be ready):', { error: String(err) });
          tasksApplied = 0;
        }
      }
    } else {
      logDebug('DataSerializer: No tasks to apply');
    }

    // 应用知识库
    if (data.knowledgeBase) {
      logDebug('DataSerializer: Applying knowledge base...');
      try {
        await knowledgeBaseSyncService.apply(data.knowledgeBase);
        knowledgeBaseApplied = (data.knowledgeBase.notes?.length || 0) + (data.knowledgeBase.directories?.length || 0);
        logDebug('DataSerializer: Knowledge base applied successfully');
      } catch (err) {
        logWarning('DataSerializer: Failed to apply knowledge base:', { error: String(err) });
      }
    }

    const remoteCurrentBoardId = data.workspace?.currentBoardId || null;
    logDebug('DataSerializer: ========== applySyncData END ==========');
    logDebug('DataSerializer: applySyncData completed:', {
      boardsApplied,
      promptsApplied,
      tasksApplied,
      knowledgeBaseApplied,
      boardsDeleted,
      promptsDeleted,
      tasksDeleted,
      remoteCurrentBoardId,
    });
    
    // 最终验证：检查存储中的状态
    const savedState = await workspaceStorageService.loadState();
    logDebug('DataSerializer: Final workspace state in storage:', {
      currentBoardId: savedState.currentBoardId,
      expected: remoteCurrentBoardId,
      match: savedState.currentBoardId === remoteCurrentBoardId,
    });
    
    // 列出存储中所有画板
    const allBoardsInStorage = await workspaceStorageService.loadAllBoards();
    logDebug('DataSerializer: Final boards in storage:', {
      count: allBoardsInStorage.length,
      ids: allBoardsInStorage.map(b => b.id),
      names: allBoardsInStorage.map(b => b.name),
    });
    
    return {
      boardsApplied,
      promptsApplied,
      tasksApplied,
      knowledgeBaseApplied,
      boardsDeleted,
      promptsDeleted,
      tasksDeleted,
      remoteCurrentBoardId,
    };
  }

  /**
   * 计算画板的校验和
   */
  calculateBoardChecksum(board: Board): string {
    const content = JSON.stringify(board.elements);
    return calculateChecksum(content);
  }

  /**
   * 合并两个画板的元素（元素级别合并）
   * 返回合并后的画板和冲突信息
   */
  mergeBoardElements(
    localBoard: Board,
    remoteBoard: Board
  ): {
    mergedBoard: Board;
    hasConflicts: boolean;
    conflictingElements: Array<{
      elementId: string;
      localElement: unknown;
      remoteElement: unknown;
    }>;
    addedFromLocal: number;
    addedFromRemote: number;
    updated: number;
  } {
    const localElements = localBoard.elements || [];
    const remoteElements = remoteBoard.elements || [];
    
    // 创建元素 ID 映射
    const localElementMap = new Map<string, typeof localElements[0]>();
    const remoteElementMap = new Map<string, typeof remoteElements[0]>();
    
    for (const el of localElements) {
      if (el.id) {
        localElementMap.set(el.id, el);
      }
    }
    
    for (const el of remoteElements) {
      if (el.id) {
        remoteElementMap.set(el.id, el);
      }
    }
    
    const mergedElements: typeof localElements = [];
    const conflictingElements: Array<{
      elementId: string;
      localElement: unknown;
      remoteElement: unknown;
    }> = [];
    
    let addedFromLocal = 0;
    let addedFromRemote = 0;
    let updated = 0;
    
    const processedIds = new Set<string>();
    
    // 处理本地元素
    for (const localEl of localElements) {
      if (!localEl.id) {
        mergedElements.push(localEl);
        continue;
      }
      
      processedIds.add(localEl.id);
      const remoteEl = remoteElementMap.get(localEl.id);
      
      if (!remoteEl) {
        // 本地独有的元素，保留
        mergedElements.push(localEl);
        addedFromLocal++;
      } else {
        // 两边都有，比较内容
        const localJson = JSON.stringify(localEl);
        const remoteJson = JSON.stringify(remoteEl);
        
        if (localJson === remoteJson) {
          // 内容相同，使用任一版本
          mergedElements.push(localEl);
        } else {
          // 内容不同，检查是否是真正的冲突
          // 默认使用本地版本（因为用户可能正在编辑）
          // 但记录为潜在冲突
          mergedElements.push(localEl);
          conflictingElements.push({
            elementId: localEl.id,
            localElement: localEl,
            remoteElement: remoteEl,
          });
          updated++;
        }
      }
    }
    
    // 添加远程独有的元素
    for (const remoteEl of remoteElements) {
      if (!remoteEl.id || processedIds.has(remoteEl.id)) {
        continue;
      }
      
      // 远程独有的元素，添加到合并结果
      mergedElements.push(remoteEl);
      addedFromRemote++;
    }
    
    // 创建合并后的画板
    const mergedBoard: Board = {
      ...localBoard,
      elements: mergedElements,
      updatedAt: Math.max(localBoard.updatedAt, remoteBoard.updatedAt),
    };
    
    return {
      mergedBoard,
      hasConflicts: conflictingElements.length > 0,
      conflictingElements,
      addedFromLocal,
      addedFromRemote,
      updated,
    };
  }

  /**
   * 比较本地和远程的画板变更
   */
  compareBoardChanges(
    localBoards: Map<string, BoardData>,
    remoteManifest: SyncManifest,
    lastSyncTime: number | null
  ): {
    toUpload: string[];
    toDownload: string[];
    conflicts: string[];
    toDeleteLocally: string[];
  } {
    const toUpload: string[] = [];
    const toDownload: string[] = [];
    const conflicts: string[] = [];
    const toDeleteLocally: string[] = [];

    const localBoardIds = new Set(localBoards.keys());
    const remoteBoardIds = new Set(Object.keys(remoteManifest.boards));

    // 检查本地画板
    for (const [boardId, board] of localBoards) {
      const remoteInfo = remoteManifest.boards[boardId];
      const localChecksum = this.calculateBoardChecksum(board);

      if (!remoteInfo) {
        // 远程没有，需要上传
        toUpload.push(boardId);
      } else if (remoteInfo.deletedAt) {
        // 远程已标记删除（tombstone），需要删除本地数据
        toDeleteLocally.push(boardId);
      } else if (localChecksum !== remoteInfo.checksum) {
        // 内容不同
        if (!lastSyncTime) {
          // 首次同步
          // 检查本地画板是否为空（只有元数据没有元素，或者元素列表为空）
          const isLocalEmpty = !board.elements || board.elements.length === 0;

          if (isLocalEmpty) {
            // 如果本地为空，总是使用远程版本
            // 这是一个保护机制：防止新设备初始化的空白画板（虽然 updatedAt 可能更新）
            // 覆盖了远程已有的内容画板（当 ID 意外冲突时）
            logDebug(`Sync: Initial sync: Local board ${boardId} is empty, preferring remote version.`);
            toDownload.push(boardId);
          } else if (board.updatedAt > remoteInfo.updatedAt) {
            toUpload.push(boardId);
          } else {
            toDownload.push(boardId);
          }
        } else if (board.updatedAt > lastSyncTime && remoteInfo.updatedAt > lastSyncTime) {
          // 两边都有修改，冲突
          conflicts.push(boardId);
        } else if (board.updatedAt > lastSyncTime) {
          // 只有本地修改
          toUpload.push(boardId);
        } else {
          // 只有远程修改
          toDownload.push(boardId);
        }
      }
    }

    // 检查远程独有的画板
    for (const boardId of remoteBoardIds) {
      if (!localBoardIds.has(boardId)) {
        const remoteInfo = remoteManifest.boards[boardId];
        // 只下载未被删除的画板
        if (!remoteInfo.deletedAt) {
          toDownload.push(boardId);
        }
      }
    }

    return { toUpload, toDownload, conflicts, toDeleteLocally };
  }

  /**
   * 检测本地删除的数据
   * 对比当前本地数据与上次同步的 manifest，找出已删除的项
   */
  detectDeletions(
    localData: { 
      boards: Map<string, BoardData>; 
      prompts: PromptsData; 
      tasks: TasksData 
    },
    lastSyncManifest: SyncManifest | null
  ): {
    deletedBoards: Array<{ id: string; name: string }>;
    deletedPrompts: PromptTombstone[];
    deletedTasks: TaskTombstone[];
  } {
    const deletedBoards: Array<{ id: string; name: string }> = [];
    const deletedPrompts: PromptTombstone[] = [];
    const deletedTasks: TaskTombstone[] = [];

    if (!lastSyncManifest) {
      // 没有上次同步记录，无法检测删除
      return { deletedBoards, deletedPrompts, deletedTasks };
    }

    // 检测已删除的画板
    for (const [boardId, boardInfo] of Object.entries(lastSyncManifest.boards)) {
      // 跳过已经标记为删除的画板
      if (boardInfo.deletedAt) {
        continue;
      }
      // 如果本地不存在这个画板，说明已被删除
      if (!localData.boards.has(boardId)) {
        deletedBoards.push({
          id: boardId,
          name: boardInfo.name,
        });
      }
    }

    // 检测已删除的提示词
    // 需要比较本地提示词列表和远程的提示词列表
    // 由于提示词没有独立的 ID，使用 createdAt 作为唯一标识
    // 注意：这里我们需要远程的提示词数据来比较，但 manifest 中没有存储
    // 所以提示词的删除检测需要在同步时通过比较完整数据来实现
    // 这里暂时跳过，后续在 applySyncData 中处理

    // 检测已删除的任务
    // 同样，任务的删除检测需要比较完整数据
    // 由于 manifest 中只存储了媒体信息，不存储任务列表
    // 所以任务的删除检测也需要在同步时处理

    logDebug('DataSerializer: detectDeletions result:', {
      deletedBoards: deletedBoards.length,
      deletedPrompts: deletedPrompts.length,
      deletedTasks: deletedTasks.length,
    });

    return { deletedBoards, deletedPrompts, deletedTasks };
  }

  /**
   * 将删除的画板标记为 tombstone
   * 更新 manifest 中的 boards 记录，添加 deletedAt 和 deletedBy 字段
   */
  markBoardsAsDeleted(
    manifest: SyncManifest,
    deletedBoards: Array<{ id: string; name: string }>,
    deviceId: string
  ): SyncManifest {
    const now = Date.now();
    const updatedManifest = { ...manifest };
    
    for (const board of deletedBoards) {
      if (updatedManifest.boards[board.id]) {
        // 更新现有记录，添加删除标记
        updatedManifest.boards[board.id] = {
          ...updatedManifest.boards[board.id],
          deletedAt: now,
          deletedBy: deviceId,
        };
      } else {
        // 如果不存在（不应该发生），创建一个带删除标记的记录
        updatedManifest.boards[board.id] = {
          name: board.name,
          updatedAt: now,
          checksum: '',
          deletedAt: now,
          deletedBy: deviceId,
        };
      }
    }
    
    updatedManifest.updatedAt = now;
    return updatedManifest;
  }

  /**
   * 移除画板的删除标记（用于恢复）
   */
  unmarkBoardAsDeleted(
    manifest: SyncManifest,
    boardId: string
  ): SyncManifest {
    const updatedManifest = { ...manifest };
    
    if (updatedManifest.boards[boardId]) {
      const { deletedAt, deletedBy, ...rest } = updatedManifest.boards[boardId];
      updatedManifest.boards[boardId] = rest as BoardSyncInfo;
    }
    
    updatedManifest.updatedAt = Date.now();
    return updatedManifest;
  }

  /**
   * 获取所有已删除的画板（从 manifest 中）
   */
  getDeletedBoards(manifest: SyncManifest): Array<{
    id: string;
    name: string;
    deletedAt: number;
    deletedBy: string;
  }> {
    const deletedBoards: Array<{
      id: string;
      name: string;
      deletedAt: number;
      deletedBy: string;
    }> = [];
    
    for (const [boardId, boardInfo] of Object.entries(manifest.boards)) {
      if (boardInfo.deletedAt && boardInfo.deletedBy) {
        deletedBoards.push({
          id: boardId,
          name: boardInfo.name,
          deletedAt: boardInfo.deletedAt,
          deletedBy: boardInfo.deletedBy,
        });
      }
    }
    
    // 按删除时间倒序排列
    deletedBoards.sort((a, b) => b.deletedAt - a.deletedAt);
    
    return deletedBoards;
  }
}

/** 数据序列化服务单例 */
export const dataSerializer = new DataSerializer();
