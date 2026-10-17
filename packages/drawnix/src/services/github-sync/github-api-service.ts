/**
 * GitHub Gist API 服务
 * 封装所有与 GitHub Gist API 的交互
 */

import { tokenService } from './token-service';
import {
  GITHUB_API_BASE,
  GIST_DESCRIPTION,
  LEGACY_GIST_DESCRIPTIONS,
  GistResponse,
  CreateGistRequest,
  UpdateGistRequest,
  SYNC_FILES,
} from './types';
import { SHARD_FILES } from './shard-types';
import { logInfo, logWarning, logError } from './sync-log-service';

/** API 错误 */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

/**
 * Gist 缓存项
 */
interface GistCacheEntry {
  response: GistResponse;
  timestamp: number;
}

/**
 * GitHub Gist API 服务
 */
class GitHubApiService {
  private gistId: string | null = null;
  
  // Gist 响应缓存（页面会话级，整个页面生命周期有效，只有更新 Gist 后才清除）
  private gistCache: Map<string, GistCacheEntry> = new Map();
  // 进行中的请求，用于并发去重
  private pendingGistRequests: Map<string, Promise<GistResponse>> = new Map();

  private isSyncGistDescription(description: string | null): boolean {
    return (
      description === GIST_DESCRIPTION ||
      LEGACY_GIST_DESCRIPTIONS.some((legacyDescription) => description === legacyDescription)
    );
  }

  /**
   * 设置 Gist ID
   */
  setGistId(gistId: string | null): void {
    this.gistId = gistId;
  }

  /**
   * 获取当前 Gist ID
   */
  getGistId(): string | null {
    return this.gistId;
  }

  /**
   * 检查是否已设置 Gist ID
   */
  hasGistId(): boolean {
    return !!this.gistId;
  }

  /**
   * 获取请求头
   */
  private async getHeaders(): Promise<Headers> {
    const token = await tokenService.getToken();
    if (!token) {
      throw new GitHubApiError('未配置 GitHub Token', 401);
    }

    return new Headers({
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    });
  }

  /**
   * 发起 API 请求
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers = await this.getHeaders();
    
    const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        errorData = await response.text();
      }

      // 记录详细错误信息用于调试
      logError('API 请求失败', undefined, {
        status: response.status,
        endpoint,
        errorData: String(errorData).substring(0, 200), // 截断避免过长
      });

      const message = this.getErrorMessage(response.status, errorData);
      throw new GitHubApiError(message, response.status, errorData);
    }

    // 对于 DELETE 请求，可能没有响应体
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  /**
   * 获取错误消息
   */
  private getErrorMessage(status: number, data: unknown): string {
    // 对于 422 错误，尝试提取更详细的信息
    if (status === 422 && data && typeof data === 'object') {
      const errorData = data as { message?: string; errors?: Array<{ message?: string; resource?: string; field?: string }> };
      if (errorData.errors && errorData.errors.length > 0) {
        const errorDetails = errorData.errors.map(e => e.message || `${e.resource}.${e.field}`).join(', ');
        return `请求数据无效: ${errorDetails}`;
      }
      if (errorData.message) {
        return `请求数据无效: ${errorData.message}`;
      }
    }

    const messages: Record<number, string> = {
      401: 'Token 无效或已过期，请重新配置',
      403: '权限不足，请确保 Token 具有 gist 权限',
      404: '资源不存在',
      422: '请求数据无效',
      500: 'GitHub 服务器错误，请稍后重试',
    };

    if (messages[status]) {
      return messages[status];
    }

    if (data && typeof data === 'object' && 'message' in data) {
      return (data as { message: string }).message;
    }

    return `请求失败 (${status})`;
  }

  /**
   * 查找现有的同步 Gist
   * 优先查找包含 master-index.json 的分片主 Gist（选择最新更新的）
   */
  async findSyncGist(): Promise<GistResponse | null> {
    try {
      // 列出用户的所有 Gists
      const gists = await this.request<GistResponse[]>('/gists?per_page=100');

      // 查找所有包含 master-index.json 的 Gist（分片主 Gist）
      const masterGists = gists.filter(gist => SHARD_FILES.MASTER_INDEX in gist.files);
      if (masterGists.length > 0) {
        // 选择最新更新的主 Gist
        const latestMasterGist = masterGists.reduce((latest, gist) => {
          const latestTime = new Date(latest.updated_at).getTime();
          const gistTime = new Date(gist.updated_at).getTime();
          return gistTime > latestTime ? gist : latest;
        });
        this.gistId = latestMasterGist.id;
        logInfo('找到主数据库 Gist', { 
          gistId: latestMasterGist.id.substring(0, 8), 
          totalMasterGists: masterGists.length,
          updatedAt: latestMasterGist.updated_at,
        });
        return latestMasterGist;
      }

      // 退化：查找包含 manifest.json 的旧 Gist
      const syncGist = gists.find(gist => {
        const hasManifest = SYNC_FILES.MANIFEST in gist.files;
        const matchDescription = this.isSyncGistDescription(gist.description);
        return hasManifest || matchDescription;
      });

      if (syncGist) {
        this.gistId = syncGist.id;
        return syncGist;
      }

      return null;
    } catch (error) {
      logError('查找同步 Gist 失败', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * 获取所有同步 Gist 列表
   * 包含 master-index.json 或 manifest.json 的 Gist
   */
  async listSyncGists(): Promise<GistResponse[]> {
    try {
      // 列出用户的所有 Gists
      const gists = await this.request<GistResponse[]>('/gists?per_page=100');

      // 筛选同步 Gist（包含 master-index.json、manifest.json 或描述匹配）
      return gists.filter(gist => {
        const hasMasterIndex = SHARD_FILES.MASTER_INDEX in gist.files;
        const hasManifest = SYNC_FILES.MANIFEST in gist.files;
        const matchDescription = this.isSyncGistDescription(gist.description);
        return hasMasterIndex || hasManifest || matchDescription;
      });
    } catch (error) {
      logError('列出同步 Gist 失败', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * 检查 Gist 是否为分片主 Gist（包含 master-index.json）
   */
  isGistMaster(gist: GistResponse): boolean {
    return SHARD_FILES.MASTER_INDEX in gist.files;
  }

  /**
   * 创建新的同步 Gist
   */
  async createSyncGist(initialFiles: Record<string, string>): Promise<GistResponse> {
    const files: Record<string, { content: string }> = {};
    
    for (const [filename, content] of Object.entries(initialFiles)) {
      files[filename] = { content };
    }

    const request: CreateGistRequest = {
      description: GIST_DESCRIPTION,
      public: false,
      files,
    };

    const gist = await this.request<GistResponse>('/gists', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    this.gistId = gist.id;
    return gist;
  }

  /**
   * 查找或创建同步 Gist
   */
  async findOrCreateSyncGist(initialFiles: Record<string, string>): Promise<GistResponse> {
    // 先尝试查找现有的
    const existingGist = await this.findSyncGist();
    if (existingGist) {
      return existingGist;
    }

    // 不存在则创建新的
    return this.createSyncGist(initialFiles);
  }

  /**
   * 获取调用栈信息（用于调试）
   */
  private getCallerInfo(): string {
    const stack = new Error().stack || '';
    const lines = stack.split('\n');
    // 跳过 Error、getCallerInfo、getGist 三行，取第4-6行作为调用来源
    const callerLines = lines.slice(4, 7).map(line => {
      // 提取文件名和行号
      const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/);
      if (match) {
        return `${match[1]} (${match[2].split('/').pop()}:${match[3]})`;
      }
      // 匿名函数的情况
      const anonMatch = line.match(/at\s+(.+?):(\d+):\d+/);
      if (anonMatch) {
        return `${anonMatch[1].split('/').pop()}:${anonMatch[2]}`;
      }
      return line.trim();
    });
    return callerLines.join(' <- ');
  }

  /**
   * 获取 Gist 内容（页面会话级缓存）
   * 整个页面生命周期内只请求一次，更新 Gist 后会自动清除缓存
   */
  async getGist(gistId?: string): Promise<GistResponse> {
    const id = gistId || this.gistId;
    if (!id) {
      throw new GitHubApiError('未指定 Gist ID', 400);
    }

    // 页面会话级缓存：只要有缓存就返回，不检查 TTL
    const cached = this.gistCache.get(id);
    if (cached) {
      return cached.response;
    }

    // 检查是否有进行中的请求（并发去重）
    const pending = this.pendingGistRequests.get(id);
    if (pending) {
      return pending;
    }

    // 发起新请求
    const requestPromise = this.request<GistResponse>(`/gists/${id}`)
      .then((response) => {
        // 缓存响应（页面会话级，不会自动过期）
        this.gistCache.set(id, { response, timestamp: Date.now() });
        this.pendingGistRequests.delete(id);
        return response;
      })
      .catch((error) => {
        this.pendingGistRequests.delete(id);
        throw error;
      });

    this.pendingGistRequests.set(id, requestPromise);
    return requestPromise;
  }

  /**
   * 清除 Gist 缓存
   * 在更新 Gist 后调用，确保下次获取到最新数据
   */
  clearGistCache(gistId?: string): void {
    if (gistId) {
      this.gistCache.delete(gistId);
    } else if (this.gistId) {
      this.gistCache.delete(this.gistId);
    }
  }

  /**
   * 获取 Gist 文件内容
   * 对于被截断的文件，会通过 raw_url 获取完整内容
   */
  async getGistFileContent(filename: string, gistId?: string): Promise<string | null> {
    const gist = await this.getGist(gistId);
    const file = gist.files[filename];

    if (!file) {
      return null;
    }

    // 如果文件被截断，需要通过 raw_url 获取完整内容
    if (file.truncated && file.raw_url) {
      const response = await fetch(file.raw_url);
      if (!response.ok) {
        throw new GitHubApiError(`获取文件内容失败: ${filename}`, response.status);
      }
      return response.text();
    }

    return file.content;
  }

  /**
   * 更新 Gist 文件
   */
  async updateGistFiles(
    files: Record<string, string>,
    gistId?: string
  ): Promise<GistResponse> {
    const id = gistId || this.gistId;
    if (!id) {
      throw new GitHubApiError('未指定 Gist ID', 400);
    }

    const filesPayload: Record<string, { content: string }> = {};
    
    // 收集每个文件的大小信息
    const fileSizes: Array<{ name: string; sizeKB: number }> = [];
    
    for (const [filename, content] of Object.entries(files)) {
      // 验证文件名长度（GitHub 限制约 255 字符）
      if (filename.length > 255) {
        logWarning(`文件名过长 (${filename.length}): ${filename.substring(0, 50)}...`);
        throw new GitHubApiError(`文件名过长: ${filename.length} 字符`, 400);
      }
      // 验证内容不为空
      if (!content || content.length === 0) {
        logWarning(`文件内容为空: ${filename}`);
        throw new GitHubApiError(`文件内容为空: ${filename}`, 400);
      }
      filesPayload[filename] = { content };
      
      const sizeKB = content.length / 1024;
      fileSizes.push({ name: filename, sizeKB });
    }

    // 检查是否有超过 10MB 的文件（GitHub 限制）
    fileSizes.sort((a, b) => b.sizeKB - a.sizeKB);
    const largeFiles = fileSizes.filter(f => f.sizeKB > 10 * 1024);
    if (largeFiles.length > 0) {
      logWarning(`发现 ${largeFiles.length} 个超过 10MB 的文件`, {
        files: largeFiles.map(f => `${f.name} (${(f.sizeKB / 1024).toFixed(2)} MB)`).join(', '),
      });
    }

    const request: UpdateGistRequest = { files: filesPayload };

    const response = await this.request<GistResponse>(`/gists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(request),
    });

    // 更新后用返回的响应刷新缓存（而不是清除），避免后续请求重新发起
    this.gistCache.set(id, { response, timestamp: Date.now() });

    return response;
  }

  /**
   * 删除 Gist 文件
   */
  async deleteGistFiles(filenames: string[], gistId?: string): Promise<GistResponse> {
    const id = gistId || this.gistId;
    if (!id) {
      throw new GitHubApiError('未指定 Gist ID', 400);
    }

    const filesPayload: Record<string, null> = {};
    for (const filename of filenames) {
      filesPayload[filename] = null;
    }

    const request: UpdateGistRequest = { files: filesPayload };

    const response = await this.request<GistResponse>(`/gists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(request),
    });

    // 删除文件后用返回的响应刷新缓存
    this.gistCache.set(id, { response, timestamp: Date.now() });

    return response;
  }

  /**
   * 删除整个 Gist
   */
  async deleteGist(gistId?: string): Promise<void> {
    const id = gistId || this.gistId;
    if (!id) {
      throw new GitHubApiError('未指定 Gist ID', 400);
    }

    await this.request<void>(`/gists/${id}`, {
      method: 'DELETE',
    });

    // 删除 Gist 后清除缓存
    this.clearGistCache(id);

    if (id === this.gistId) {
      this.gistId = null;
    }
  }

  /**
   * 获取 Gist 的所有文件名
   */
  async getGistFileNames(gistId?: string): Promise<string[]> {
    const gist = await this.getGist(gistId);
    return Object.keys(gist.files);
  }

  /**
   * 检查 Gist 是否存在某个文件
   */
  async hasFile(filename: string, gistId?: string): Promise<boolean> {
    const gist = await this.getGist(gistId);
    return filename in gist.files;
  }

  /**
   * 获取 Gist 的 Web URL
   */
  getGistWebUrl(gistId?: string): string | null {
    const id = gistId || this.gistId;
    if (!id) {
      return null;
    }
    return `https://gist.github.com/${id}`;
  }

  /**
   * 验证 Token 并检查 Gist 权限
   */
  async validateConnection(): Promise<{
    valid: boolean;
    hasGistScope: boolean;
    error?: string;
  }> {
    try {
      const isValid = await tokenService.validateToken();
      if (!isValid) {
        return { valid: false, hasGistScope: false, error: 'Token 无效' };
      }

      const hasGistScope = await tokenService.hasGistScope();
      if (!hasGistScope) {
        return { valid: true, hasGistScope: false, error: 'Token 缺少 gist 权限' };
      }

      return { valid: true, hasGistScope: true };
    } catch (error) {
      return {
        valid: false,
        hasGistScope: false,
        error: error instanceof Error ? error.message : '验证失败',
      };
    }
  }
}

/** GitHub API 服务单例 */
export const gitHubApiService = new GitHubApiService();
