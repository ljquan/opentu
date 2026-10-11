# 实施清单：Top 50 媒体模型参数

用户已批准实施和提交 PR。Image 2 扩展和本次新增水印按最新要求取消，保留已有能力。实际测试结果见 docs/qa-top50-media-model-parameters.md。

## 已完成实现

- [x] 核对既定 21 图片/5 视频精确 ID、基线与请求消费者。
- [x] 保留 Image 2/2 VIP/2-1k 基线及 Image 2.5 已有能力。
- [x] 四个 Gemini 精确别名复用参数元数据，保留请求 ID 和供应商身份。
- [x] 撤回 Seedream、Seedance 2.0/Fast 和 H3 本次新增水印，保留 Seedance 2.5 等已有水印。
- [x] Veo 四项高级参数直接开放；默认/关闭/开启控件与类型校验接通。
- [x] Veo 两条既有 multipart 路径写入 camelCase metadata，保留 false/0/缺省。
- [x] 原生工作流消费者、白名单及可选渠道取值限制同步。
- [x] 视频偏好按 profile/model 保存，任务能力快照过滤凭据。
- [x] Seedance 2.5 删除 draft/priority，保留原有 watermark/output_format。
- [x] 清理已取消功能测试和临时 skip，保留原有失败断言。

## 最终交付

- [x] 最终定向回归、类型和构建检查；792 通过、4 个基线失败单列。
- [x] 同步最新 origin/develop df1715ab，保留双方文档冲突条目，合并后检查完成。
- [x] 更新 QA/DOC、审查完整差异并提交。
- [ ] 推送功能分支并创建 PR；不合并。

## 不在本次交付

- [ ] 真实供应商、生产渠道及浏览器验收；没有执行收费请求。
- [ ] Seedream 提示词优化、序列生成和 Lite 图层拆解。
- [ ] Seedance 任务控制、帧数和尾帧结果消费。
- [ ] H3 参考音频及专属参考模式。
- [ ] 原生 Gemini 视频高级参数、Tuzi Veo 尾帧和参考图转换。
