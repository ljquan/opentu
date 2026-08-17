## ADDED Requirements

### Requirement: PPTX Import SHALL Validate Untrusted Input Safely

系统 SHALL 根据 ZIP/OOXML 结构而不只依赖扩展名或 MIME 验证用户上传的 PPTX。

#### Scenario: Accept a structurally valid PPTX

- **GIVEN** 文件包含有效的 PPTX package、presentation 和至少一个 slide relationship
- **WHEN** 用户选择该文件作为演示来源
- **THEN** 系统 SHALL 接受并开始可取消的导入
- **AND** SHALL 保留原始文件名、页序和页面比例元数据

#### Scenario: Reject invalid PPTX without partial writes

- **WHEN** 文件损坏、加密、伪装成 PPTX、缺少 presentation 或没有页面
- **THEN** 系统 SHALL 停止导入并显示具体错误
- **AND** SHALL 清理临时缓存、Worker 和对象 URL
- **AND** SHALL NOT 创建可提交的讲解任务

#### Scenario: Reject malicious package structure

- **WHEN** OOXML package 包含路径穿越、异常压缩比、异常绝对展开资源量、过多 ZIP 部件、无界关系循环或其他结构攻击
- **THEN** 系统 SHALL 中止解析并释放资源
- **AND** 结构安全拒绝 SHALL 与普通产品大小限制区分展示

### Requirement: PPTX Import SHALL Produce Ordered Page Sources

系统 SHALL 将 PPTX 转换为与原页序对应的可预览页面来源，并提取可用备注。

#### Scenario: Render slides in order

- **WHEN** 系统导入一个有效 PPTX
- **THEN** 每个成功页面 SHALL 带有从 1 开始的 pageIndex 和稳定 cache URL
- **AND** 页面 SHALL 保持源比例，不强制固定为 1920x1080

#### Scenario: Extract speaker notes

- **GIVEN** PPTX 页面关联了 notes slide
- **WHEN** 该页被解析
- **THEN** 系统 SHALL 提取可读讲者备注供讲稿规划使用
- **AND** 缺少 notes SHALL NOT 导致页面失败

#### Scenario: Report unsupported slide content

- **GIVEN** 页面包含渲染器不支持或只能降级的 Office 特性
- **WHEN** 系统渲染该页
- **THEN** 系统 SHALL 记录逐页 diagnostics
- **AND** SHALL NOT 静默丢弃整页
- **AND** 无法得到可用页面快照时 SHALL 在供应商 submit 前停止

### Requirement: PPTX Import SHALL Process Pages Incrementally

系统 SHALL 使用隔离 Worker、全局串行导入、逐页输出和及时清理，避免多个大型演示同时解压和渲染造成内存峰值。当前渲染器需要在 Worker 内把完整源 Blob 物化为字节缓冲，因此本要求不代表端到端流式解析或上传。

#### Scenario: Import a large valid deck

- **GIVEN** PPTX 超过先前建议的页数或文件大小
- **WHEN** 浏览器实际资源允许继续处理
- **THEN** 系统 SHALL 排队并逐页解析、渲染、缓存和释放页面资源
- **AND** SHALL NOT 仅因固定页数或字节阈值拒绝文件
- **AND** ZIP 部件数量与声明展开量的结构安全预算 SHALL NOT 被描述为产品页数或原文件大小限制

#### Scenario: Cancel during import

- **WHEN** 用户在解压、渲染或缓存过程中取消
- **THEN** 系统 SHALL 终止 Worker 和后续页面处理
- **AND** SHALL 释放 reader、ImageBitmap、对象 URL、临时页面和事件监听器

#### Scenario: Environment cannot continue

- **WHEN** 浏览器存储配额、内存或解码能力不足
- **THEN** 系统 SHALL 停止在当前页面并保留已完成轻量状态供重试
- **AND** SHALL 报告实际环境错误而不分配更大的内存缓冲重试

#### Scenario: Renderer requires the complete source buffer

- **GIVEN** 当前 PPTX 解析和渲染器需要完整 package 字节
- **WHEN** 系统开始验证或逐页渲染
- **THEN** 完整源缓冲 SHALL 只在隔离 Worker 内物化，且多个导入 SHALL 全局串行
- **AND** 系统 SHALL NOT 把该实现描述为完全流式处理
- **AND** 源文件级内存不足 SHALL 作为实际环境错误返回，不得通过分配更大缓冲自动重试

### Requirement: PPTX Import SHALL Support Recovery Without Persisting Large Payloads In Tasks

系统 SHALL 把原 PPTX 和页面 Blob 放在媒体缓存中，并只在任务记录中保存轻量 cache URL、页序、诊断和校验身份。

#### Scenario: Refresh before the first import checkpoint

- **GIVEN** 用户已通过能力预检并选择有效的非空 PPTX
- **WHEN** 系统创建根任务或浏览器在首个 Worker checkpoint 前刷新
- **THEN** 原 PPTX SHALL 已保存到内部媒体缓存
- **AND** 根任务 SHALL 只保存文件名、MIME、缓存 URL 和任务级占位身份
- **AND** 恢复 SHALL 从缓存源继续验证而不依赖内存中的 `File`

#### Scenario: Resume from cached input

- **GIVEN** 导入在部分页面完成后刷新且原 PPTX 缓存仍存在
- **WHEN** 系统恢复根任务
- **THEN** 系统 SHALL 跳过已完成页面并从下一未完成页面继续
- **AND** SHALL NOT 把文件或页面 base64 写进任务记录

#### Scenario: Cached input is missing

- **GIVEN** 任务记录存在但原 PPTX 缓存已被清理
- **WHEN** 用户恢复任务
- **THEN** 系统 SHALL 请求重新选择原文件或重新开始导入
- **AND** SHALL 保留讲解配置和已完成的轻量诊断
