import React, { createContext, useContext, useState, ReactNode, useMemo } from 'react';

// Define supported languages
export type Language = 'zh' | 'en';

// Define translation keys and their corresponding values
export interface Translations {
  // Toolbar items
  'toolbar.hand': string;
  'toolbar.selection': string;
  'toolbar.lasso': string;
  'toolbar.mind': string;
  'toolbar.text': string;
  'toolbar.pen': string;
  'toolbar.vectorPen': string;
  'toolbar.eraser': string;
  'toolbar.arrow': string;
  'toolbar.shape': string;
  'toolbar.image': string;
  'toolbar.mediaLibrary': string;
  'toolbar.aiImage': string;
  'toolbar.aiVideo': string;
  'toolbar.tasks': string;
  'toolbar.theme': string;
  'toolbar.stroke': string;
  'toolbar.strokeColor': string;
  'toolbar.strokeWidth': string;
  'toolbar.pencilShape': string;
  'toolbar.pencilShape.circle': string;
  'toolbar.pencilShape.square': string;
  'toolbar.eraserSize': string;
  'toolbar.eraserShape': string;
  'toolbar.eraserShape.circle': string;
  'toolbar.eraserShape.square': string;
  'toolbar.laserPointer': string;
  'toolbar.frame': string;
  'toolbar.fillColor': string;
  'toolbar.fontColor': string;
  'toolbar.fontSize': string;
  'toolbar.anchorCorner': string;
  'toolbar.anchorSmooth': string;
  'toolbar.anchorSymmetric': string;
  'toolbar.cornerRadius': string;

  // Zoom controls
  'zoom.in': string;
  'zoom.out': string;
  'zoom.fit': string;
  'zoom.fitFrame': string;
  'zoom.100': string;
  
  // Themes
  'theme.default': string;
  'theme.colorful': string;
  'theme.soft': string;
  'theme.retro': string;
  'theme.dark': string;
  'theme.starry': string;
  
  // General
  'general.undo': string;
  'general.redo': string;
  'general.menu': string;
  'general.duplicate': string;
  'general.delete': string;
  
  // Language
  'language.switcher': string;
  'language.chinese': string;
  'language.english': string;
  
  // Menu items
  'menu.open': string;
  'menu.saveFile': string;
  'menu.exportImage': string;
  'menu.exportImage.png': string;
  'menu.exportImage.jpg': string;
  'menu.cleanBoard': string;
  'menu.github': string;
  'menu.settings': string;
  'menu.backupRestore': string;
  'menu.cloudSync': string;
  'menu.debugPanel': string;
  'menu.version': string;
  'menu.more': string;
  'menu.commandPalette': string;
  'menu.userManual': string;
  'menu.changelog': string;
  'menu.cleanInvalidLinks': string;
  'menu.cleanInvalidLinks.scanning': string;
  'menu.cleanInvalidLinks.success': string;
  'menu.cleanInvalidLinks.noInvalid': string;
  'menu.cleanInvalidLinks.error': string;
  
  // Dialog translations
  'dialog.mermaid.title': string;
  'dialog.mermaid.description': string;
  'dialog.mermaid.flowchart': string;
  'dialog.mermaid.sequence': string;
  'dialog.mermaid.class': string;
  'dialog.mermaid.otherTypes': string;
  'dialog.mermaid.syntax': string;
  'dialog.mermaid.placeholder': string;
  'dialog.mermaid.preview': string;
  'dialog.mermaid.insert': string;
  'dialog.markdown.description': string;
  'dialog.markdown.syntax': string;
  'dialog.markdown.placeholder': string;
  'dialog.markdown.preview': string;
  'dialog.markdown.insert': string;
  'dialog.error.loadMermaid': string;
  
  // Extra tools menu items
  'extraTools.mermaidToDrawnix': string;
  'extraTools.markdownToDrawnix': string;

  // Clean confirm dialog
  'cleanConfirm.title': string;
  'cleanConfirm.description': string;
  'cleanConfirm.cancel': string;
  'cleanConfirm.ok': string;

  // Settings dialog
  'settings.title': string;
  'settings.apiKey': string;
  'settings.apiKeyPlaceholder': string;
  'settings.baseUrl': string;
  'settings.cancel': string;
  'settings.save': string;

  // Chat drawer
  'chat.openDrawer': string;
  'chat.closeDrawer': string;
  'chat.newSession': string;
  'chat.sessionList': string;
  'chat.sendMessage': string;
  'chat.stopGenerate': string;
  'chat.addAttachment': string;
  'chat.copyMessage': string;
  'chat.regenerate': string;
  'chat.deleteSession': string;
  'chat.deleteConfirm': string;
  'chat.emptyState': string;
  'chat.emptyStateHint': string;
  'chat.inputPlaceholder': string;
  'chat.noSessions': string;
  'chat.newChat': string;
  'chat.loading': string;

  // More tools panel
  'toolbar.more': string;
  'toolbar.moreTools': string;
  'toolbar.clickToShow': string;
  'toolbar.doubleClickToShow': string;
  'toolbar.rightClickToHide': string;
  'toolbar.rightClickToAdd': string;
  'toolbar.addToToolbar': string;
  'toolbar.allToolsVisible': string;
  'toolbar.moveUp': string;
  'toolbar.moveDown': string;
  'toolbar.moveToTop': string;
  'toolbar.zoom': string;
  'toolbar.moveToBottom': string;
  'toolbar.openNewWindow': string;
  'toolbar.resetToDefault': string;

  // Text effects
  'textEffect.fontFamily': string;
  'textEffect.shadow': string;
  'textEffect.gradient': string;
  'textEffect.layer': string;

  // Property panel
  'propertyPanel.title': string;
  'propertyPanel.fontSettings': string;
  'propertyPanel.colorSettings': string;
  'propertyPanel.shadowSettings': string;
  'propertyPanel.gradientSettings': string;
  'propertyPanel.fontSize': string;
  'propertyPanel.fontFamily': string;
  'propertyPanel.textColor': string;

  // Alignment
  'toolbar.alignment': string;

  // Distribution
  'toolbar.distribute': string;

  // Boolean operations
  'toolbar.boolean': string;
  'toolbar.speak': string;
  'toolbar.pauseSpeech': string;
  'toolbar.resumeSpeech': string;
}

// Translation data
const translations: Record<Language, Translations> = {
  zh: {
    // Toolbar items
    'toolbar.hand': '手形工具 — H',
    'toolbar.selection': '选择 — V',
    'toolbar.lasso': '套索选择 — Q',
    'toolbar.mind': '思维导图 — M',
    'toolbar.text': '文本 — T',
    'toolbar.pen': '画笔 — P',
    'toolbar.vectorPen': '钢笔 — Shift+P',
    'toolbar.eraser': '橡皮擦 — E',
    'toolbar.anchorCorner': '角点',
    'toolbar.anchorSmooth': '平滑点',
    'toolbar.anchorSymmetric': '对称点',
    'toolbar.cornerRadius': '圆角',
    'toolbar.arrow': '箭头 — A',
    'toolbar.shape': '形状',
    'toolbar.image': '图片 — Cmd+U',
    'toolbar.mediaLibrary': '素材库',
    'toolbar.aiImage': 'AI 图片生成',
    'toolbar.aiVideo': 'AI 视频生成',
    'toolbar.tasks': '任务',
    'toolbar.theme': '主题色',
    'toolbar.stroke': '描边',
    'toolbar.strokeColor': '画笔颜色',
    'toolbar.strokeWidth': '画笔大小',
    'toolbar.pencilShape': '画笔形状',
    'toolbar.pencilShape.circle': '圆形',
    'toolbar.pencilShape.square': '方形',
    'toolbar.eraserSize': '橡皮擦大小',
    'toolbar.eraserShape': '橡皮擦形状',
    'toolbar.eraserShape.circle': '圆形',
    'toolbar.eraserShape.square': '方形',
    'toolbar.laserPointer': '激光笔 — L',
    'toolbar.frame': 'Frame 容器 — F',
    'toolbar.fillColor': '填充颜色',
    'toolbar.fontColor': '字体颜色',
    'toolbar.fontSize': '字体样式',

    // Zoom controls
    'zoom.in': '放大 — Cmd++',
    'zoom.out': '缩小 — Cmd+-',
    'zoom.fit': '自适应',
    'zoom.fitFrame': '自适应 Frame',
    'zoom.100': '缩放至 100%',
    
    // Themes
    'theme.default': '默认',
    'theme.colorful': '缤纷',
    'theme.soft': '柔和',
    'theme.retro': '复古',
    'theme.dark': '暗夜',
    'theme.starry': '星空',
    
    // General
    'general.undo': '撤销',
    'general.redo': '重做',
    'general.menu': '应用菜单',
    'general.duplicate': '复制',
    'general.delete': '删除',
    
    // Language
    'language.switcher': '语言',
    'language.chinese': '中文',
    'language.english': 'English',
    
    // Menu items
    'menu.open': '打开',
    'menu.saveFile': '保存文件',
    'menu.exportImage': '导出图片',
    'menu.exportImage.png': 'PNG',
    'menu.exportImage.jpg': 'JPG',
    'menu.cleanBoard': '清除画布',
    'menu.github': 'GitHub',
    'menu.settings': '设置',
    'menu.backupRestore': '备份 / 恢复',
    'menu.cloudSync': '云端同步',
    'menu.debugPanel': '日志 / 调试',
    'menu.version': '版本',
    'menu.more': '更多',
    'menu.commandPalette': '快捷命令',
    'menu.userManual': '用户手册',
    'menu.changelog': '日志',
    'menu.cleanInvalidLinks': '清除失效媒体',
    'menu.cleanInvalidLinks.scanning': '正在扫描失效媒体...',
    'menu.cleanInvalidLinks.success': '已清除 {count} 个失效媒体',
    'menu.cleanInvalidLinks.noInvalid': '未发现失效媒体',
    'menu.cleanInvalidLinks.error': '清除失败',
    
    // Dialog translations
    'dialog.mermaid.title': 'Mermaid 转 Drawnix',
    'dialog.mermaid.description': '目前仅支持',
    'dialog.mermaid.flowchart': '流程图',
    'dialog.mermaid.sequence': '序列图',
    'dialog.mermaid.class': '类图',
    'dialog.mermaid.otherTypes': '。其他类型在 Drawnix 中将以图片呈现。',
    'dialog.mermaid.syntax': 'Mermaid 语法',
    'dialog.mermaid.placeholder': '在此处编写 Mermaid 图表定义...',
    'dialog.mermaid.preview': '预览',
    'dialog.mermaid.insert': '插入',
    'dialog.markdown.description': '支持 Markdown 语法自动转换为思维导图。',
    'dialog.markdown.syntax': 'Markdown 语法',
    'dialog.markdown.placeholder': '在此处编写 Markdown 文本定义...',
    'dialog.markdown.preview': '预览',
    'dialog.markdown.insert': '插入',
    'dialog.error.loadMermaid': '加载 Mermaid 库失败',
    
    // Extra tools menu items
    'extraTools.mermaidToDrawnix': 'Mermaid 到 Drawnix',
    'extraTools.markdownToDrawnix': 'Markdown 到 Drawnix',

    // Clean confirm dialog
    'cleanConfirm.title': '清除画布',
    'cleanConfirm.description': '这将会清除整个画布。你是否要继续?',
    'cleanConfirm.cancel': '取消',
    'cleanConfirm.ok': '确认',

    // Settings dialog
    'settings.title': '设置',
    'settings.apiKey': 'API Key',
    'settings.apiKeyPlaceholder': '请输入您的 API Key',
    'settings.baseUrl': 'Base URL',
    'settings.cancel': '取消',
    'settings.save': '保存',

    // Chat drawer
    'chat.openDrawer': '打开对话',
    'chat.closeDrawer': '关闭对话',
    'chat.newSession': '新对话',
    'chat.sessionList': '会话列表',
    'chat.sendMessage': '发送消息',
    'chat.stopGenerate': '停止生成',
    'chat.addAttachment': '添加附件',
    'chat.copyMessage': '复制消息',
    'chat.regenerate': '重新生成',
    'chat.deleteSession': '删除会话',
    'chat.deleteConfirm': '确定删除此会话？',
    'chat.emptyState': '开始对话吧',
    'chat.emptyStateHint': '输入消息与AI助手交流',
    'chat.inputPlaceholder': '输入消息...',
    'chat.noSessions': '暂无会话',
    'chat.newChat': '新建',
    'chat.loading': '加载中...',

    // More tools panel
    'toolbar.more': '更多',
    'toolbar.moreTools': '更多工具',
    'toolbar.clickToShow': '点击添加到工具栏',
    'toolbar.doubleClickToShow': '双击添加到工具栏',
    'toolbar.rightClickToHide': '移除',
    'toolbar.rightClickToAdd': '右键添加到工具栏',
    'toolbar.addToToolbar': '添加到工具栏',
    'toolbar.allToolsVisible': '所有工具已显示在工具栏中',
    'toolbar.moveUp': '上移',
    'toolbar.moveDown': '下移',
    'toolbar.moveToTop': '置顶',
    'toolbar.moveToBottom': '置底',
    'toolbar.openNewWindow': '新窗口打开',
    'toolbar.resetToDefault': '重置为默认',
    'toolbar.zoom': '缩放',

    // Text effects
    'textEffect.fontFamily': '艺术字体',
    'textEffect.shadow': '光影效果',
    'textEffect.gradient': '渐变色',
    'textEffect.layer': '图层顺序',

    // Property panel
    'propertyPanel.title': '属性设置',
    'propertyPanel.fontSettings': '字体设置',
    'propertyPanel.colorSettings': '颜色设置',
    'propertyPanel.shadowSettings': '阴影效果',
    'propertyPanel.gradientSettings': '渐变效果',
    'propertyPanel.fontSize': '字号',
    'propertyPanel.fontFamily': '字体',
    'propertyPanel.textColor': '文字颜色',

    // Alignment
    'toolbar.alignment': '对齐',

    // Distribution
    'toolbar.distribute': '间距',

    // Boolean operations
    'toolbar.boolean': '组合',
    'toolbar.speak': '语音朗读',
    'toolbar.pauseSpeech': '暂停朗读',
    'toolbar.resumeSpeech': '继续朗读',
  },
  en: {
    // Toolbar items
    'toolbar.hand': 'Hand — H',
    'toolbar.selection': 'Selection — V',
    'toolbar.lasso': 'Lasso Select — Q',
    'toolbar.mind': 'Mind — M',
    'toolbar.text': 'Text — T',
    'toolbar.pen': 'Pen — P',
    'toolbar.vectorPen': 'Vector Pen — Shift+P',
    'toolbar.eraser': 'Eraser — E',
    'toolbar.anchorCorner': 'Corner',
    'toolbar.anchorSmooth': 'Smooth',
    'toolbar.anchorSymmetric': 'Symmetric',
    'toolbar.cornerRadius': 'Corner Radius',
    'toolbar.arrow': 'Arrow — A',
    'toolbar.shape': 'Shape',
    'toolbar.image': 'Image — Cmd+U',
    'toolbar.mediaLibrary': 'Media Library',
    'toolbar.aiImage': 'AI Image Generation',
    'toolbar.aiVideo': 'AI Video Generation',
    'toolbar.tasks': 'Tasks',
    'toolbar.theme': 'Theme',
    'toolbar.stroke': 'Stroke',
    'toolbar.strokeColor': 'Pen Color',
    'toolbar.strokeWidth': 'Pen Size',
    'toolbar.pencilShape': 'Pen Shape',
    'toolbar.pencilShape.circle': 'Circle',
    'toolbar.pencilShape.square': 'Square',
    'toolbar.eraserSize': 'Eraser Size',
    'toolbar.eraserShape': 'Eraser Shape',
    'toolbar.eraserShape.circle': 'Circle',
    'toolbar.eraserShape.square': 'Square',
    'toolbar.laserPointer': 'Laser Pointer — L',
    'toolbar.frame': 'Frame Container — F',
    'toolbar.fillColor': 'Fill Color',
    'toolbar.fontColor': 'Font Color',
    'toolbar.fontSize': 'Font Style',

    // Zoom controls
    'zoom.in': 'Zoom In — Cmd++',
    'zoom.out': 'Zoom Out — Cmd+-',
    'zoom.fit': 'Fit to Screen',
    'zoom.fitFrame': 'Fit Frame',
    'zoom.100': 'Zoom to 100%',
    
    // Themes
    'theme.default': 'Default',
    'theme.colorful': 'Colorful',
    'theme.soft': 'Soft',
    'theme.retro': 'Retro',
    'theme.dark': 'Dark',
    'theme.starry': 'Starry',
    
    // General
    'general.undo': 'Undo',
    'general.redo': 'Redo',
    'general.menu': 'App Menu',
    'general.duplicate': 'Duplicate',
    'general.delete': 'Delete',
    
    // Language
    'language.switcher': 'Language',
    'language.chinese': '中文',
    'language.english': 'English',
    
    // Menu items
    'menu.open': 'Open',
    'menu.saveFile': 'Save File',
    'menu.exportImage': 'Export Image',
    'menu.exportImage.png': 'PNG',
    'menu.exportImage.jpg': 'JPG',
    'menu.cleanBoard': 'Clear Board',
    'menu.github': 'GitHub',
    'menu.settings': 'Settings',
    'menu.backupRestore': 'Backup / Restore',
    'menu.cloudSync': 'Cloud Sync',
    'menu.debugPanel': 'Log / Debug',
    'menu.version': 'Version',
    'menu.more': 'More',
    'menu.commandPalette': 'Commands',
    'menu.userManual': 'User Manual',
    'menu.changelog': 'Log',
    'menu.cleanInvalidLinks': 'Clean Invalid Media',
    'menu.cleanInvalidLinks.scanning': 'Scanning invalid media...',
    'menu.cleanInvalidLinks.success': 'Cleaned {count} invalid media',
    'menu.cleanInvalidLinks.noInvalid': 'No invalid media found',
    'menu.cleanInvalidLinks.error': 'Clean failed',
    
    // Dialog translations
    'dialog.mermaid.title': 'Mermaid to Drawnix',
    'dialog.mermaid.description': 'Currently supports',
    'dialog.mermaid.flowchart': 'flowcharts',
    'dialog.mermaid.sequence': 'sequence diagrams', 
    'dialog.mermaid.class': 'class diagrams',
    'dialog.mermaid.otherTypes': ', and other diagram types (rendered as images).',
    'dialog.mermaid.syntax': 'Mermaid Syntax',
    'dialog.mermaid.placeholder': 'Write your Mermaid chart definition here...',
    'dialog.mermaid.preview': 'Preview',
    'dialog.mermaid.insert': 'Insert',
    'dialog.markdown.description': 'Supports automatic conversion of Markdown syntax to mind map.',
    'dialog.markdown.syntax': 'Markdown Syntax',
    'dialog.markdown.placeholder': 'Write your Markdown text definition here...',
    'dialog.markdown.preview': 'Preview',
    'dialog.markdown.insert': 'Insert',
    'dialog.error.loadMermaid': 'Failed to load Mermaid library',
    
    // Extra tools menu items
    'extraTools.mermaidToDrawnix': 'Mermaid to Drawnix',
    'extraTools.markdownToDrawnix': 'Markdown to Drawnix',

    // Clean confirm dialog
    'cleanConfirm.title': 'Clear Board',
    'cleanConfirm.description': 'This will clear the entire board. Do you want to continue?',
    'cleanConfirm.cancel': 'Cancel',
    'cleanConfirm.ok': 'OK',

    // Settings dialog
    'settings.title': 'Settings',
    'settings.apiKey': 'API Key',
    'settings.apiKeyPlaceholder': 'Please enter your API Key',
    'settings.baseUrl': 'Base URL',
    'settings.cancel': 'Cancel',
    'settings.save': 'Save',

    // Chat drawer
    'chat.openDrawer': 'Open Chat',
    'chat.closeDrawer': 'Close Chat',
    'chat.newSession': 'New Session',
    'chat.sessionList': 'Session List',
    'chat.sendMessage': 'Send Message',
    'chat.stopGenerate': 'Stop Generating',
    'chat.addAttachment': 'Add Attachment',
    'chat.copyMessage': 'Copy Message',
    'chat.regenerate': 'Regenerate',
    'chat.deleteSession': 'Delete Session',
    'chat.deleteConfirm': 'Are you sure you want to delete this session?',
    'chat.emptyState': 'Start a conversation',
    'chat.emptyStateHint': 'Send a message to chat with AI assistant',
    'chat.inputPlaceholder': 'Type a message...',
    'chat.noSessions': 'No sessions yet',
    'chat.newChat': 'New',
    'chat.loading': 'Loading...',

    // More tools panel
    'toolbar.more': 'More',
    'toolbar.moreTools': 'More Tools',
    'toolbar.clickToShow': 'Click to add to toolbar',
    'toolbar.doubleClickToShow': 'Double-click to add to toolbar',
    'toolbar.rightClickToHide': 'Remove',
    'toolbar.rightClickToAdd': 'Right-click to add to toolbar',
    'toolbar.addToToolbar': 'Add to Toolbar',
    'toolbar.allToolsVisible': 'All tools are visible in toolbar',
    'toolbar.moveUp': 'Move Up',
    'toolbar.moveDown': 'Move Down',
    'toolbar.moveToTop': 'Move to Top',
    'toolbar.moveToBottom': 'Move to Bottom',
    'toolbar.openNewWindow': 'Open in New Window',
    'toolbar.resetToDefault': 'Reset to Default',
    'toolbar.zoom': 'Zoom',

    // Text effects
    'textEffect.fontFamily': 'Art Font',
    'textEffect.shadow': 'Shadow Effect',
    'textEffect.gradient': 'Gradient',
    'textEffect.layer': 'Layer Order',

    // Property panel
    'propertyPanel.title': 'Properties',
    'propertyPanel.fontSettings': 'Font Settings',
    'propertyPanel.colorSettings': 'Color Settings',
    'propertyPanel.shadowSettings': 'Shadow Effect',
    'propertyPanel.gradientSettings': 'Gradient Effect',
    'propertyPanel.fontSize': 'Font Size',
    'propertyPanel.fontFamily': 'Font Family',
    'propertyPanel.textColor': 'Text Color',

    // Alignment
    'toolbar.alignment': 'Align',

    // Distribution
    'toolbar.distribute': 'Distribute',

    // Boolean operations
    'toolbar.boolean': 'Boolean',
    'toolbar.speak': 'Read Aloud',
    'toolbar.pauseSpeech': 'Pause Reading',
    'toolbar.resumeSpeech': 'Resume Reading',
  },
};

// I18n context interface
interface I18nContextType {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: keyof Translations) => string;
}

// Create the context
const I18nContext = createContext<I18nContextType | undefined>(undefined);

// Provider props
interface I18nProviderProps {
  children: ReactNode;
  defaultLanguage?: Language;
}

// 全局语言状态（用于非 React 组件）
let globalLanguage: Language = 'zh';

// I18nProvider component
export const I18nProvider: React.FC<I18nProviderProps> = ({ 
  children, 
  defaultLanguage = 'zh' 
}) => {
  const [language, setLanguageState] = useState<Language>(defaultLanguage);

  // 包装 setLanguage 以同步全局状态
  const setLanguage = (lang: Language) => {
    globalLanguage = lang;
    setLanguageState(lang);
  };

  // 初始化时同步全局状态
  React.useEffect(() => {
    globalLanguage = language;
  }, [language]);

  const t = (key: keyof Translations): string => {
    return translations[language][key] || key;
  };

  const value: I18nContextType = useMemo(() => ({
    language,
    setLanguage,
    t,
  }), [language]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
};

// useI18n hook
export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  
  return context;
};

/**
 * 获取翻译（非 React 组件使用）
 * 注意：需要在 I18nProvider 渲染后使用才能获取正确的语言
 */
export const getTranslation = (key: keyof Translations): string => {
  return translations[globalLanguage][key] || key;
};

// Export types for external use
export type { I18nContextType };
