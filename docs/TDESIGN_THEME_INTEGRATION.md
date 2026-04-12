# TDesign 主题集成 - Opentu 品牌色彩

本文档说明了如何在项目中集成 TDesign 组件库并应用 Opentu 品牌色彩系统。

## 🎨 品牌色彩系统

### 主品牌色 - 橙金色系
```css
--brand-primary: #F39C12          /* 主品牌色 */
--brand-primary-dark: #E67E22      /* 深色变体 */
--brand-primary-darker: #D35400    /* 更深色变体 */
--brand-primary-light: #FEF5E7     /* 浅色变体 */
--brand-primary-light-darker: #FDE68A /* 中等浅色变体 */
```

### 辅助品牌色 - 蓝紫色系
```css
--brand-secondary: #5A4FCF         /* 辅助色 */
--brand-secondary-light: #7B68EE   /* 浅色变体 */
--brand-secondary-lighter: #9966CC /* 更浅色变体 */
```

### 创作激活色 - 玫红色系
```css
--accent-create: #E91E63           /* 创作激活色 */
--accent-create-light: #F06292     /* 浅色变体 */
```

### 渐变色
```css
--brand-gradient: linear-gradient(135deg, #F39C12 0%, #E67E22 30%, #5A4FCF 70%, #E91E63 100%);
--brush-gradient: linear-gradient(135deg, #5A4FCF 0%, #7B68EE 50%, #E91E63 100%);
```

## 📁 文件结构

```
packages/drawnix/src/styles/
├── index.scss              # 主样式入口文件
├── tdesign-theme.scss      # TDesign 主题配置
├── theme.scss              # 应用主题变量
└── variables.module.scss   # SCSS 变量和混入

apps/web/src/
└── styles.scss             # 全局样式文件
```

## 🔧 配置说明

### 1. TDesign 主题配置

在 `tdesign-theme.scss` 中，我们覆盖了 TDesign 的默认 CSS 变量：

```scss
:root {
  /* 主品牌色映射到 TDesign 变量 */
  --td-brand-color: #F39C12;
  --td-brand-color-hover: #E67E22;
  --td-brand-color-active: #D35400;
  
  /* 功能色彩 */
  --td-success-color: #00B894;
  --td-warning-color: #E67E22;
  --td-error-color: #E91E63;
}
```

### 2. 组件样式定制

针对特定 TDesign 组件的样式定制：

```scss
.drawnix {
  /* 按钮组件 */
  .t-button--theme-primary {
    background: linear-gradient(135deg, var(--td-brand-color) 0%, var(--td-brand-color-6) 100%);
  }
  
  /* 输入框组件 */
  .t-input:focus {
    border-color: var(--td-brand-color);
    box-shadow: 0 0 0 2px rgba(243, 156, 18, 0.2);
  }
}
```

### 3. 全局样式配置

在 `apps/web/src/styles.scss` 中定义了全局品牌样式：

```scss
:root {
  --aitu-brand-primary: #F39C12;
  --aitu-gradient-primary: linear-gradient(135deg, #F39C12 0%, #E67E22 30%, #5A4FCF 70%, #E91E63 100%);
}
```

## 🎯 使用方法

### 1. 在 React 组件中使用 TDesign

```tsx
import { Button, Dialog } from 'tdesign-react';

function MyComponent() {
  return (
    <div>
      {/* 主要按钮会自动应用品牌色 */}
      <Button theme="primary">创建项目</Button>
      
      {/* 次要按钮 */}
      <Button variant="outline">取消</Button>
    </div>
  );
}
```

### 2. 使用品牌色彩 CSS 变量

```scss
.my-custom-component {
  background: var(--brand-primary);
  color: white;
  
  &:hover {
    background: var(--brand-primary-dark);
  }
}
```

### 3. 使用渐变色

```scss
.gradient-background {
  background: var(--brand-gradient);
}

.gradient-text {
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

### 4. 使用预定义的品牌样式类

```tsx
function MyComponent() {
  return (
    <div>
      {/* 使用品牌按钮样式 */}
      <button className="aitu-button-primary">主要操作</button>
      <button className="aitu-button-secondary">次要操作</button>
      
      {/* 使用渐变背景 */}
      <div className="aitu-gradient-bg">渐变背景</div>
      
      {/* 使用渐变文字 */}
      <h1 className="aitu-gradient-text">Opentu</h1>
    </div>
  );
}
```

## 🔍 支持的 TDesign 组件

以下 TDesign 组件已经配置了品牌色彩：

- ✅ Button（按钮）
- ✅ Dialog（对话框）
- ✅ Input（输入框）
- ✅ Tabs（标签页）
- ✅ Switch（开关）
- ✅ Checkbox（复选框）
- ✅ Radio（单选框）
- ✅ Select（选择器）
- ✅ Progress（进度条）
- ✅ Loading（加载中）
- ✅ Tag（标签）
- ✅ Badge（徽章）
- ✅ Notification（通知）
- ✅ Message（消息）
- ✅ Slider（滑块）
- ✅ DatePicker（日期选择器）
- ✅ TimePicker（时间选择器）
- ✅ Upload（上传）
- ✅ Steps（步骤条）
- ✅ Anchor（锚点）
- ✅ BackTop（回到顶部）

## 🌙 深色模式支持

项目已经配置了基础的深色模式支持：

```scss
@media (prefers-color-scheme: dark) {
  :root {
    --td-bg-color-page: #1a1a1a;
    --td-bg-color-container: #2d2d2d;
    --td-text-color-primary: #ffffff;
    --td-text-color-secondary: #b3b3b3;
  }
}
```

## 📱 响应式设计

品牌色彩系统支持响应式设计，在移动端会自动调整：

```scss
@media (max-width: 768px) {
  .drawnix-console {
    width: 150px;
    height: 150px;
    font-size: 10px;
  }
}
```

## 🎨 设计原则

1. **一致性**：所有 TDesign 组件都使用统一的品牌色彩
2. **可访问性**：确保色彩对比度符合 WCAG 标准
3. **渐进增强**：支持深色模式和减少动画偏好
4. **性能优化**：使用 CSS 变量实现主题切换

## 🔄 更新主题色

如需更新品牌色彩，只需修改以下文件中的 CSS 变量：

1. `packages/drawnix/src/styles/tdesign-theme.scss` - TDesign 组件主题
2. `packages/drawnix/src/styles/theme.scss` - 应用主题变量
3. `apps/web/src/styles.scss` - 全局样式变量

## 🐛 故障排除

### 问题：TDesign 组件没有应用品牌色彩

**解决方案**：
1. 确保 `tdesign-theme.scss` 在 `tdesign.css` 之后引入
2. 检查 CSS 变量名是否正确
3. 确保组件被 `.drawnix` 类包裹

### 问题：渐变色不显示

**解决方案**：
1. 检查浏览器是否支持 CSS 渐变
2. 确保 CSS 变量定义正确
3. 检查是否有其他样式覆盖

### 问题：深色模式不生效

**解决方案**：
1. 检查系统是否设置为深色模式
2. 确保媒体查询语法正确
3. 检查 CSS 变量是否被正确覆盖

---

*文档更新时间：2025-01-09*  
*版本：v1.0*
