# Opentu 编码规范

本文档定义了Aitu项目的编码标准和最佳实践，确保代码质量、可维护性和团队协作效率。

## 目录

- [总体原则](#总体原则)
- [文件结构与命名](#文件结构与命名)
- [TypeScript 规范](#typescript-规范)
- [React 组件规范](#react-组件规范)
- [CSS/SCSS 规范](#cssscss-规范)
- [测试规范](#测试规范)
- [Git 提交规范](#git-提交规范)
- [性能优化](#性能优化)
- [安全规范](#安全规范)
- [文档规范](#文档规范)

## 总体原则

### 代码哲学
- **简洁性**: 代码应该清晰、简洁、易于理解
- **一致性**: 保持整个项目的编码风格一致
- **可维护性**: 编写易于维护和扩展的代码
- **性能**: 在保证可读性的前提下追求性能
- **安全**: 始终考虑安全性，避免引入安全漏洞

### 文件大小限制
- **单个文件不超过500行** (包括空行和注释)
- 超过500行的文件应该进行合理拆分
- 例外情况需要在代码审查中说明理由

## 文件结构与命名

### 目录结构
```
packages/drawnix/src/
├── components/          # 可复用组件
│   ├── ui/             # 基础UI组件
│   ├── icons/          # 图标组件
│   └── feature/        # 功能性组件
├── hooks/              # 自定义 Hooks
├── utils/              # 工具函数
├── constants/          # 常量定义
├── types/              # TypeScript 类型定义
├── styles/             # 全局样式
├── plugins/            # Plait 插件
└── transforms/         # 数据变换逻辑
```

### 命名约定

#### 文件命名
- **组件文件**: `PascalCase.tsx` (如 `ImageCropPopup.tsx`)
- **Hook文件**: `camelCase.ts` (如 `useImageCrop.ts`)
- **工具文件**: `kebab-case.ts` (如 `image-utils.ts`)
- **类型文件**: `kebab-case.types.ts` (如 `image-crop.types.ts`)
- **常量文件**: `UPPER_SNAKE_CASE.ts` (如 `STORAGE_KEYS.ts`)

#### 变量命名
```typescript
// ✅ 推荐
const userName = 'alice';
const isLoading = true;
const API_BASE_URL = 'https://api.example.com';
const MAX_RETRY_COUNT = 3;

// ❌ 不推荐
const user_name = 'alice';
const loading = true;
const apiBaseUrl = 'https://api.example.com';
```

#### 组件命名
```typescript
// ✅ 推荐
const ImageCropPopup: React.FC<ImageCropPopupProps> = () => {};
const UserProfile = () => {};

// ❌ 不推荐
const imageCropPopup = () => {};
const userProfile = () => {};
```

## TypeScript 规范

### 类型定义

#### 接口定义
```typescript
// ✅ 推荐 - 使用 interface
interface User {
  readonly id: string;
  name: string;
  email: string;
  createdAt: Date;
  avatar?: string; // 可选属性放在最后
}

// ✅ 推荐 - Props 接口
interface ImageCropPopupProps {
  visible: boolean;
  onClose: () => void;
  onCropSelect: (shape: CropShape) => void;
  children?: React.ReactNode;
}
```

#### 类型别名
```typescript
// ✅ 推荐 - 联合类型使用 type
type CropShape = 'rectangle' | 'circle' | 'ellipse';
type ButtonVariant = 'primary' | 'secondary' | 'outline';

// ✅ 推荐 - 复杂类型组合
type ApiResponse<T> = {
  data: T;
  status: 'success' | 'error';
  message?: string;
};
```

#### 泛型使用
```typescript
// ✅ 推荐
interface Repository<T> {
  findById(id: string): Promise<T | null>;
  create(entity: Omit<T, 'id'>): Promise<T>;
  update(id: string, updates: Partial<T>): Promise<T>;
}

// ✅ 推荐 - 泛型约束
interface Identifiable {
  id: string;
}

function updateEntity<T extends Identifiable>(entity: T, updates: Partial<T>): T {
  return { ...entity, ...updates };
}
```

### 严格模式配置
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

## React 组件规范

### 组件结构
```typescript
// ✅ 推荐的组件结构
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from 'tdesign-react';
import { useI18n } from '../../hooks/use-i18n';
import './ComponentName.scss';

// 1. 类型定义
interface ComponentProps {
  title: string;
  onAction: (data: string) => void;
  disabled?: boolean;
}

// 2. 常量定义
const DEFAULT_CONFIG = {
  timeout: 5000,
  retryCount: 3,
};

// 3. 主组件
export const ComponentName: React.FC<ComponentProps> = ({
  title,
  onAction,
  disabled = false,
}) => {
  // 4. Hooks (固定顺序)
  const { language } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  
  // 5. Effect hooks
  useEffect(() => {
    // 副作用逻辑
  }, []);
  
  // 6. 事件处理函数
  const handleClick = useCallback(() => {
    if (disabled) return;
    onAction(title);
  }, [disabled, onAction, title]);
  
  // 7. 渲染逻辑
  return (
    <div className="component-name">
      <Button onClick={handleClick} disabled={disabled || isLoading}>
        {title}
      </Button>
    </div>
  );
};
```

### Hooks 使用规范

#### 自定义 Hooks
```typescript
// ✅ 推荐
export const useImageCrop = (initialShape: CropShape = 'rectangle') => {
  const [cropShape, setCropShape] = useState<CropShape>(initialShape);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const applyCrop = useCallback(async (imageUrl: string) => {
    setIsProcessing(true);
    try {
      // 裁剪逻辑
      return processedImageUrl;
    } finally {
      setIsProcessing(false);
    }
  }, [cropShape]);
  
  return {
    cropShape,
    setCropShape,
    isProcessing,
    applyCrop,
  };
};
```

#### 依赖数组规范
```typescript
// ✅ 推荐 - 完整依赖
useEffect(() => {
  fetchUserData(userId);
}, [userId, fetchUserData]);

// ✅ 推荐 - useCallback 优化
const fetchUserData = useCallback(async (id: string) => {
  // 实现
}, []);

// ❌ 不推荐 - 缺少依赖
useEffect(() => {
  fetchUserData(userId);
}, []); // 缺少 userId 依赖
```

### 状态管理
```typescript
// ✅ 推荐 - 简单状态
const [user, setUser] = useState<User | null>(null);

// ✅ 推荐 - 复杂状态使用 useReducer
interface FormState {
  values: Record<string, any>;
  errors: Record<string, string>;
  isSubmitting: boolean;
}

type FormAction = 
  | { type: 'SET_FIELD'; field: string; value: any }
  | { type: 'SET_ERROR'; field: string; error: string }
  | { type: 'SET_SUBMITTING'; isSubmitting: boolean };

const formReducer = (state: FormState, action: FormAction): FormState => {
  switch (action.type) {
    case 'SET_FIELD':
      return {
        ...state,
        values: { ...state.values, [action.field]: action.value }
      };
    // 其他 case...
    default:
      return state;
  }
};
```

## CSS/SCSS 规范

### 样式架构
```scss
// ✅ 推荐的组件样式结构
.image-crop-popup {
  // 1. 位置相关
  position: relative;
  z-index: 999;
  
  // 2. 盒模型
  width: 300px;
  padding: 16px;
  margin: 0 auto;
  
  // 3. 外观
  background: var(--color-bg-container);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  
  // 4. 字体
  font-family: var(--font-family);
  color: var(--color-text);
  
  // 5. 动画
  transition: all 0.2s ease-out;
  
  // 6. 嵌套选择器
  &__header {
    margin-bottom: 12px;
    font-weight: 600;
  }
  
  &__content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  // 7. 状态修饰符
  &--visible {
    opacity: 1;
    transform: translateY(0);
  }
  
  &--hidden {
    opacity: 0;
    transform: translateY(-10px);
  }
  
  // 8. 响应式
  @media (max-width: 768px) {
    width: calc(100vw - 32px);
    padding: 12px;
  }
}
```

### 设计系统变量
```scss
// 使用设计系统定义的变量
:root {
  // 品牌色彩
  --brand-primary: #F39C12;
  --brand-secondary: #5A4FCF;
  --brand-accent: #E91E63;
  
  // 渐变
  --gradient-brand: linear-gradient(135deg, #F39C12 0%, #E67E22 30%, #5A4FCF 70%, #E91E63 100%);
  --gradient-brush: linear-gradient(135deg, #5A4FCF 0%, #7B68EE 50%, #E91E63 100%);
  
  // 间距
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  
  // 字体
  --font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-base: 16px;
  --font-size-lg: 18px;
  
  // 圆角
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  
  // 阴影
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12);
  --shadow-md: 0 4px 20px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.15);
}
```

### BEM 命名规范
```scss
// ✅ 推荐 - BEM 命名
.image-crop {           // Block
  &__popup {            // Element
    &--visible {        // Modifier
      opacity: 1;
    }
  }
  
  &__button {           // Element
    &--primary {        // Modifier
      background: var(--gradient-brand);
    }
    
    &--disabled {       // Modifier
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}
```

## 测试规范

### 单元测试
```typescript
// ✅ 推荐的测试结构
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImageCropPopup } from './ImageCropPopup';

describe('ImageCropPopup', () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    onCropSelect: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('渲染行为', () => {
    it('应该正确渲染裁剪选项', () => {
      render(<ImageCropPopup {...defaultProps} />);
      
      expect(screen.getByText('方形裁剪')).toBeInTheDocument();
      expect(screen.getByText('圆形裁剪')).toBeInTheDocument();
      expect(screen.getByText('椭圆形裁剪')).toBeInTheDocument();
    });

    it('当 visible 为 false 时应该隐藏', () => {
      render(<ImageCropPopup {...defaultProps} visible={false} />);
      
      expect(screen.queryByText('方形裁剪')).not.toBeInTheDocument();
    });
  });

  describe('交互行为', () => {
    it('点击裁剪选项应该调用 onCropSelect', async () => {
      render(<ImageCropPopup {...defaultProps} />);
      
      fireEvent.click(screen.getByText('圆形裁剪'));
      
      await waitFor(() => {
        expect(defaultProps.onCropSelect).toHaveBeenCalledWith('circle');
        expect(defaultProps.onClose).toHaveBeenCalled();
      });
    });
  });
});
```

### E2E 测试
```typescript
// ✅ Playwright E2E 测试示例
import { test, expect } from '@playwright/test';

test.describe('图片裁剪功能', () => {
  test('用户可以成功裁剪图片', async ({ page }) => {
    await page.goto('/');
    
    // 上传图片
    await page.setInputFiles('input[type="file"]', 'test-image.png');
    
    // 选择图片
    await page.click('[data-testid="uploaded-image"]');
    
    // 打开裁剪菜单
    await page.click('[data-testid="crop-button"]');
    
    // 选择圆形裁剪
    await page.click('text=圆形裁剪');
    
    // 验证裁剪效果
    const image = page.locator('[data-testid="cropped-image"]');
    await expect(image).toHaveClass(/crop-circle/);
  });
});
```

## Git 提交规范

### 提交消息格式
```
<type>(<scope>): <subject>

<body>

<footer>
```

### 类型说明
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式调整（不影响功能）
- `refactor`: 重构代码
- `test`: 添加或修改测试
- `chore`: 构建过程或辅助工具的变动
- `perf`: 性能优化
- `ci`: CI/CD 相关

### 示例
```bash
# ✅ 推荐
feat(crop): 添加图片圆形和椭圆形裁剪功能

- 实现三种裁剪形状：方形、圆形、椭圆形
- 添加裁剪预览功能
- 更新相关TypeScript类型定义

Closes #123

# ✅ 推荐
fix(api): 修复图片上传失败的问题

当文件大小超过5MB时，上传会失败并显示错误消息

Fixes #456

# ❌ 不推荐
update stuff
fix bug
add feature
```

## 性能优化

### 代码分割
```typescript
// ✅ 推荐 - 路由级别的代码分割
const ImageEditor = React.lazy(() => import('./ImageEditor'));
const VideoEditor = React.lazy(() => import('./VideoEditor'));

// ✅ 推荐 - 组件级别的懒加载
const HeavyComponent = React.lazy(() => 
  import('./HeavyComponent').then(module => ({
    default: module.HeavyComponent
  }))
);
```

### React 性能优化
```typescript
// ✅ 推荐 - React.memo 优化
const ExpensiveComponent = React.memo<Props>(({ data, onUpdate }) => {
  return <div>{/* 渲染逻辑 */}</div>;
}, (prevProps, nextProps) => {
  // 自定义比较逻辑
  return prevProps.data.id === nextProps.data.id;
});

// ✅ 推荐 - useMemo 优化计算
const expensiveValue = useMemo(() => {
  return computeExpensiveValue(data);
}, [data]);

// ✅ 推荐 - useCallback 优化函数
const handleClick = useCallback((id: string) => {
  onItemClick(id);
}, [onItemClick]);
```

### 图片优化
```typescript
// ✅ 推荐 - 图片预加载
const preloadImage = (src: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = src;
  });
};

// ✅ 推荐 - 响应式图片
const ResponsiveImage: React.FC<{
  src: string;
  alt: string;
  sizes: string;
}> = ({ src, alt, sizes }) => (
  <img
    src={src}
    alt={alt}
    sizes={sizes}
    loading="lazy"
    decoding="async"
  />
);
```

## 安全规范

### 输入验证
```typescript
// ✅ 推荐 - 严格的输入验证
const validateImageFile = (file: File): boolean => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const maxSize = 10 * 1024 * 1024; // 10MB
  
  if (!allowedTypes.includes(file.type)) {
    throw new Error('不支持的文件类型');
  }
  
  if (file.size > maxSize) {
    throw new Error('文件大小超过限制');
  }
  
  return true;
};

// ✅ 推荐 - XSS 防护
const sanitizeInput = (input: string): string => {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};
```

### API 安全
```typescript
// ✅ 推荐 - 安全的 API 调用
const apiClient = {
  async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    return response.json();
  }
};

// ✅ 推荐 - 敏感信息处理
const logSafeError = (error: Error, context?: Record<string, any>) => {
  const safeContext = context ? {
    ...context,
    apiKey: context.apiKey ? '[REDACTED]' : undefined,
    password: context.password ? '[REDACTED]' : undefined,
  } : {};
  
  console.error('Application error:', {
    message: error.message,
    stack: error.stack,
    context: safeContext,
  });
};
```

### 环境变量管理
```typescript
// ✅ 推荐 - 类型安全的环境变量
interface EnvironmentConfig {
  apiBaseUrl: string;
  enableDebug: boolean;
  geminiApiKey?: string;
}

const getEnvironmentConfig = (): EnvironmentConfig => {
  const config: EnvironmentConfig = {
    apiBaseUrl: process.env.VITE_API_BASE_URL || 'http://localhost:3000',
    enableDebug: process.env.NODE_ENV === 'development',
    geminiApiKey: process.env.VITE_GEMINI_API_KEY,
  };
  
  // 验证必需的环境变量
  if (!config.apiBaseUrl) {
    throw new Error('VITE_API_BASE_URL is required');
  }
  
  return config;
};
```

## 文档规范

### JSDoc 注释
```typescript
/**
 * 图片裁剪工具类
 * @example
 * ```typescript
 * const cropper = new ImageCropper();
 * const result = await cropper.crop(imageUrl, 'circle');
 * ```
 */
export class ImageCropper {
  /**
   * 裁剪图片
   * @param imageUrl - 图片URL
   * @param shape - 裁剪形状
   * @param options - 裁剪选项
   * @returns 裁剪后的图片URL
   * @throws {Error} 当图片格式不支持时
   */
  async crop(
    imageUrl: string, 
    shape: CropShape, 
    options?: CropOptions
  ): Promise<string> {
    // 实现逻辑
  }
}
```

### README 模板
```markdown
# 组件名称

## 概述
简要描述组件的用途和功能。

## 安装
\`\`\`bash
npm install @aitu/component-name
\`\`\`

## 使用示例
\`\`\`typescript
import { ComponentName } from '@aitu/component-name';

const App = () => (
  <ComponentName 
    prop1="value1"
    onEvent={handleEvent}
  />
);
\`\`\`

## API 文档

### Props
| 属性名 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| prop1  | string | - | 属性描述 |
| prop2  | boolean | false | 属性描述 |

### 事件
| 事件名 | 参数 | 描述 |
|--------|------|------|
| onEvent | (data: string) => void | 事件描述 |

## 开发指南
本地开发和测试说明。
```

## 代码审查清单

### 提交前检查
- [ ] 代码通过 TypeScript 类型检查
- [ ] 代码通过 ESLint 检查
- [ ] 代码通过单元测试
- [ ] 单个文件不超过 500 行
- [ ] 添加了必要的注释和文档
- [ ] 遵循了命名约定
- [ ] 没有硬编码的配置值
- [ ] 没有 console.log 等调试代码
- [ ] 安全性检查通过

### 性能检查
- [ ] 组件使用了适当的优化（memo, useMemo, useCallback）
- [ ] 图片资源进行了优化
- [ ] 避免了不必要的重新渲染
- [ ] 长列表使用了虚拟化

### 可访问性检查
- [ ] 添加了适当的 ARIA 标签
- [ ] 支持键盘导航
- [ ] 颜色对比度满足要求
- [ ] 支持屏幕阅读器

---

*本文档是活跃的，会随着项目发展持续更新。如有疑问或建议，请提交 Issue 或 PR。*