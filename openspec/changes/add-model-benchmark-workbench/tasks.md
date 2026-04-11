## 1. Implementation
- [x] 1.1 Add sandboxed benchmark workbench tool: manifest, component, window plumbing, previews per modality.
- [x] 1.2 Implement benchmark session service/storage capturing status, timings, cost, preview, manual rating, favorite flag.
- [x] 1.3 Wire settings dialog provider/model list so “快捷测试” buttons open workbench with context.
- [x] 1.4 Ensure workbench consumes runtime model discovery/presets and reuses adapter routing to execute tests per modality with default prompts.
- [x] 1.5 Add UI sorting/filtering and ranking (“速度优先”, “成本优先”, “综合”) plus manual rating controls.
- [x] 1.6 Document new capability in specs delta and update design.md as needed.

## 2. Verification
- [ ] 2.1 Benchmarks can run for image/video/audio/text with selected provider/model.
- [ ] 2.2 Settings quick test buttons correctly pre-fill and open workbench.
- [ ] 2.3 Benchmark results stay in independent store and do not appear in task history.
- [x] 2.4 Ranking modes reorder results as expected.
