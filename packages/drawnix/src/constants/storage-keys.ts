/**
 * 存储常量统一管理
 *
 * 集中管理所有 LocalStorage 和 IndexedDB 的键名、数据库名等
 * 避免硬编码分散在各处，便于维护和追踪
 */

// ====================================
// LocalStorage Keys
// ====================================

/**
 * LocalStorage 键名常量
 * 按功能模块分组，便于管理
 */
export const LS_KEYS = {
  // ---- 应用核心 ----
  /** 应用设置（加密存储 API Key 等） */
  SETTINGS: 'drawnix_settings',
  /** 设备唯一标识符 */
  DEVICE_ID: 'drawnix_device_id',

  // ---- AI 生成 ----
  /** AI 图片生成预览缓存 */
  AI_IMAGE_PREVIEW_CACHE: 'ai_image_generation_preview_cache',
  /** AI 视频生成预览缓存 */
  AI_VIDEO_PREVIEW_CACHE: 'ai_video_generation_preview_cache',
  /** AI 图片生成模式（单图/批量） */
  AI_IMAGE_MODE: 'ai-image-generation-mode',
  /** 图片生成数量记忆 */
  AI_IMAGE_QUANTITY: 'aitu_image_generation_quantity',
  /** 视频生成数量记忆 */
  AI_VIDEO_QUANTITY: 'aitu_video_generation_quantity',
  /** 图片生成后是否自动插入画布 */
  AI_IMAGE_AUTO_INSERT: 'aitu_image_auto_insert_canvas',
  /** 视频生成后是否自动插入画布 */
  AI_VIDEO_AUTO_INSERT: 'aitu_video_auto_insert_canvas',
  /** 底部 AI 输入栏参数偏好 */
  AI_INPUT_PREFERENCES: 'aitu_ai_input_preferences',
  /** AI 图片工具参数偏好 */
  AI_IMAGE_TOOL_PREFERENCES: 'aitu_ai_image_tool_preferences',
  /** AI 视频工具参数偏好 */
  AI_VIDEO_TOOL_PREFERENCES: 'aitu_ai_video_tool_preferences',
  /** 是否显示画布上的 WorkZone 进度卡片 */
  WORKZONE_CARD_VISIBLE: 'aitu_workzone_card_visible',

  // ---- 抽屉状态（轻量 UI 状态，保留在 LocalStorage） ----
  /** 聊天抽屉状态 */
  CHAT_DRAWER_STATE: 'aitu:chat:drawer-state',
  /** 聊天抽屉宽度 */
  CHAT_DRAWER_WIDTH: 'chat-drawer-width',
  /** 任务队列抽屉宽度 */
  TASK_QUEUE_DRAWER_WIDTH: 'task-queue-drawer-width',
  /** 媒体库视图模式 */
  MEDIA_LIBRARY_VIEW_MODE: 'media-library-view-mode',
  /** 知识库排序偏好 */
  KB_SORT_PREFERENCE: 'aitu:kb:sort-preference',
  /** 知识库抽屉宽度 */
  KB_DRAWER_WIDTH: 'aitu:kb:drawer-width',
  /** 知识库已被用户删除的默认目录名称列表（JSON 数组） */
  KB_DELETED_DEFAULT_DIRS: 'aitu:kb:deleted-default-dirs',

  // ---- 迁移标记 ----
  /** 数据库清理完成标记 */
  DB_CLEANUP_DONE: 'db-cleanup-v1-done',
  /** 统一缓存迁移完成标记 */
  CACHE_MIGRATED: 'drawnix_cache_migrated',
  /** 素材迁移 v3 完成标记 */
  ASSET_MIGRATION_V3: 'drawnix_asset_migration_v3',
  /** LocalStorage 到 IndexedDB 迁移完成标记 */
  LS_TO_IDB_MIGRATION_DONE: 'aitu_ls_to_idb_migration_v1',

  // ---- 音频播放器 UI ----
  /** 画布音频播放器位置 */
  AUDIO_PLAYER_POSITION: 'aitu:audio-player-position',
  /** 画布音频播放器布局模式 */
  AUDIO_PLAYER_LAYOUT: 'aitu:audio-player-layout',
  /** 音频播放器播放模式 */
  AUDIO_PLAYER_PLAYBACK_MODE: 'aitu:audio-player-playback-mode',
  /** 音频播放器音频速率 */
  AUDIO_PLAYER_AUDIO_PLAYBACK_RATE: 'aitu:audio-player-audio-playback-rate',

  // ---- 废弃键（仅用于迁移读取后删除） ----
  /** @deprecated 旧版本本地数据，迁移后删除 */
  OLD_LOCAL_DATA: 'drawnix-local-data',
  /** @deprecated 旧版图片历史，已迁移到 IndexedDB */
  OLD_IMAGE_HISTORY: 'ai_image_generation_history',
  /** @deprecated 旧版视频历史，已迁移到 IndexedDB */
  OLD_VIDEO_HISTORY: 'ai_video_generation_history',
} as const;

/**
 * 需要从 LocalStorage 迁移到 IndexedDB 的键
 * 这些数据存在增量风险，不适合存储在 LocalStorage
 */
export const LS_KEYS_TO_MIGRATE = {
  /** 提示词历史记录（无限制条数，内容可能很长） */
  PROMPT_HISTORY: 'aitu_prompt_history',
  /** 视频描述历史记录（无限制条数） */
  VIDEO_PROMPT_HISTORY: 'aitu_video_prompt_history',
  /** 图片描述历史记录（无限制条数） */
  IMAGE_PROMPT_HISTORY: 'aitu_image_prompt_history',
  /** 预设提示词设置（置顶/删除状态） */
  PRESET_SETTINGS: 'aitu-prompt-preset-settings',
  /** 批量图片生成缓存（包含任务列表和图片数据） */
  BATCH_IMAGE_CACHE: 'batch-image-generation-cache',
  /** 最近使用的文本颜色 */
  RECENT_TEXT_COLORS: 'aitu-recent-text-colors',
  /** 自定义渐变预设 */
  CUSTOM_GRADIENTS: 'aitu-custom-gradients',
  /** 自定义字体（包含字体二进制数据） */
  CUSTOM_FONTS: 'custom-fonts',
  /** 工具栏配置（按钮顺序和显示状态） */
  TOOLBAR_CONFIG: 'toolbar_config',
} as const;

/**
 * 需要清理的废弃 LocalStorage 键
 */
export const LS_KEYS_DEPRECATED = [
  'aitu-recent-colors-shadow', // 遗留数据
  'drawnix-local-data', // 旧版本本地数据
  'ai_image_generation_history', // 已迁移到 IndexedDB
  'ai_video_generation_history', // 已迁移到 IndexedDB
] as const;

// ====================================
// IndexedDB Databases
// ====================================

/**
 * IndexedDB 数据库配置
 * 统一管理所有数据库名称、版本和 store 名称
 */
export const IDB_DATABASES = {
  /** 统一缓存（图片/视频媒体） */
  UNIFIED_CACHE: {
    NAME: 'drawnix-unified-cache',
    VERSION: 1,
    STORES: {
      MEDIA: 'media',
    },
  },

  /** 工作区数据（文件夹、画板、状态） - 版本由运行时动态检测 */
  WORKSPACE: {
    NAME: 'aitu-workspace',
    MIN_VERSION: 8,
    STORES: {
      FOLDERS: 'folders',
      BOARDS: 'boards',
      STATE: 'state',
    },
  },

  /** 素材库元数据 */
  ASSETS: {
    NAME: 'aitu-assets',
    VERSION: 1,
    STORES: {
      ASSETS: 'assets',
    },
  },

  /** 聊天会话和消息 */
  CHAT: {
    NAME: 'aitu-chat',
    VERSION: 1,
    STORES: {
      SESSIONS: 'sessions',
      MESSAGES: 'messages',
    },
  },

  /**
   * 任务队列（主线程）
   * @deprecated 已废弃，仅用于历史数据迁移。新代码请使用 SW_TASK_QUEUE。
   */
  TASK_QUEUE: {
    NAME: 'aitu-task-queue',
    VERSION: 1,
    STORES: {
      TASKS: 'tasks',
    },
  },

  /** 任务队列（Service Worker） */
  SW_TASK_QUEUE: {
    NAME: 'sw-task-queue',
    VERSION: 2,
    STORES: {
      TASKS: 'tasks',
      CONFIG: 'config',
      WORKFLOWS: 'workflows',
      CHAT_WORKFLOWS: 'chat-workflows',
      PENDING_TOOL_REQUESTS: 'pending-tool-requests',
    },
  },

  /** 角色系统（Sora 角色和头像） */
  CHARACTERS: {
    NAME: 'drawnix',
    VERSION: 1,
    STORES: {
      CHARACTERS: 'characters',
      AVATARS: 'character-avatars',
    },
  },

  /** 埋点事件缓存 */
  TRACKING: {
    NAME: 'aitu-tracking',
    VERSION: 1,
  },

  /**
   * 通用键值存储（用于迁移后的数据）
   * 存储从 LocalStorage 迁移过来的数据
   */
  KEY_VALUE_STORE: {
    NAME: 'aitu-storage',
    VERSION: 1,
    STORES: {
      /** 通用键值存储 */
      DATA: 'data',
    },
  },

  /** 知识库（目录、笔记、标签、正文、图片） */
  KNOWLEDGE_BASE: {
    NAME: 'aitu-knowledge-base',
    VERSION: 1,
    STORES: {
      DIRECTORIES: 'directories',
      NOTES: 'notes',
      TAGS: 'tags',
      NOTE_TAGS: 'noteTags',
      NOTE_CONTENTS: 'noteContents',
      NOTE_IMAGES: 'noteImages',
    },
  },
} as const;

// ====================================
// Cache API (Service Worker)
// ====================================

/**
 * Cache API 缓存名称
 */
export const CACHE_NAMES = {
  /** 图片二进制数据缓存 */
  IMAGES: 'drawnix-images',
  /** 字体文件缓存 */
  FONTS: 'drawnix-fonts',
} as const;

// ====================================
// 类型导出
// ====================================

/** LocalStorage 键类型 */
export type LSKey = (typeof LS_KEYS)[keyof typeof LS_KEYS];

/** 待迁移的 LocalStorage 键类型 */
export type LSKeyToMigrate =
  (typeof LS_KEYS_TO_MIGRATE)[keyof typeof LS_KEYS_TO_MIGRATE];

/** 废弃的 LocalStorage 键类型 */
export type LSKeyDeprecated = (typeof LS_KEYS_DEPRECATED)[number];

/** IndexedDB 数据库名类型 */
export type IDBDatabaseName =
  (typeof IDB_DATABASES)[keyof typeof IDB_DATABASES]['NAME'];
