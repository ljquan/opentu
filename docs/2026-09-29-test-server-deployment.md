# 2026-09-29 测试服务器发布记录

## 目标和范围

- 目标：192.168.50.207，Tuzi API 3200，OpenTu 5173。
- 发布标识：opentu-token-reload-20260929-1340。
- OpenTu：当前工作区的分组恢复修复及已确认的已有令牌选择、新建令牌界面。基于 b9fc3a73e785a68ababd43106c436f5555d9d527，包含未提交修改。
- Tuzi API：以服务器 provider-reuse-bridge-20260929-1000 发布目录为基线，仅覆盖 OpenTu 令牌控制器、核验共享逻辑、三个路由及对应测试。保留原 Web 构建。
- 无数据库结构变更。Compose 比较确认仅 image 字段变化，环境、挂载和端口相同。

## 构建和上线证据

- OpenTu 使用 VITE_TUZI_EMBEDDED_MODE=true、VITE_TUZI_API_BASE_URL=http://192.168.50.207:3200、VITE_TUZI_PARENT_ORIGIN=http://192.168.50.207:3200 构建成功。
- 前端压缩包 SHA-256：ff14efcdf1ddcc3ebd20eb7ac4b16fffa03cf2d55d54e37604d2df77e7c7b488，服务器校验通过。
- 后端服务器测试：go test -mod=vendor -p 2 ./controller ./router -run 'Test(OpenTu|VerifyOpenTu)' -count=1，通过。
- 后端镜像构建成功：tuzi-api-local:opentu-token-reload-20260929-1340。
- 服务器随后独立检查确认 tuzi-api-app 正在运行该镜像；OpenTu current 指向 /opt/opentu-test/releases/opentu-token-reload-20260929-1340。
- /api/status 本机请求成功；/api/opentu/tokens 未登录返回 401（发布前为 404）；5173/version.json 返回本次发布标识。
- /readyz 发布前后均为 17 pass、1 fail，失败项仍为 subscription_mutation_gate：subscription purchase counters are not initialized。因此容器仍显示 unhealthy，不能描述为全部健康。
- 后端保留原 APP_VERSION，以匹配现有 Web/PWA 资源版本；本次变化通过镜像标签和 GitCommit=opentu-token-overlay-20260929-1340 标识。

## 真实验收边界

- 本地此前已通过 108 项相关测试和模拟父站/API 的生产构建浏览器回归，详见同目录修复记录。
- 本次尝试对服务器真实 API 注册独立测试账户 persistqa811ae9a9，注册成功。
- 后续真实登录请求反复出现超时、ECONNRESET；HTTP 静态页面也出现响应体传输中途停顿，SSH 多次超时。服务器本机状态请求曾成功。
- 因此未完成真实账户的关联、创建分组、切页返回、刷新浏览器验收，未发送生成计费请求。不能据本次发布认定所有问题已消除。
- 该测试账户可能仍保留在测试库；未修改已有用户数据。

## 回退

- 前端旧目录：/opt/opentu-test/releases/provider-reuse-20260928-1600。
- 后端旧镜像：tuzi-api-local:provider-reuse-bridge-20260929-1000。
- 回退脚本：服务器 /opt/tuzi-api-test/releases/opentu-token-reload-20260929-1340/rollback.sh。
- 新镜像通过原 Compose 文件加 /opt/tuzi-api-test/releases/opentu-token-reload-20260929-1340/docker-compose.opentu-token-reload.yml 启动，项目名 tuzi_credit_monthly_test；后续重建必须保留该覆盖文件，否则会恢复旧镜像。
- 本地临时 SSH 密码辅助脚本已删除。日志 /tmp/opentu-deployment.log 在传输停顿后不完整，以上上线结论来自后续独立 SSH 和 HTTP 检查。
