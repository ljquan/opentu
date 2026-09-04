# OpenTu AI 语义分层服务

这是不依赖 Seedream 5.0 Pro 的本地混合分层服务。它复用 OpenTu 视觉模型传入的候选框（也支持本地 YOLO 检测），使用本地 SAM2 分割、OpenCV 边缘精修/背景修补和真实重合成质量评估生成透明 PNG 图层。不下载模型权重，也不把 mock 或未校验结果伪装成真实推理结果。

## 异步 API

`POST /api/layer-decompositions` 支持两种输入：

- `application/json`：`image` 为公网 HTTP(S) URL 或任意 image/\* data URL。
- `multipart/form-data`：`image` 为任意 Pillow 可解码的栅格图片文件（PNG、JPEG、GIF、WebP、BMP、TIFF 等，具体取决于已安装解码器）；画布端应优先使用该形式，避免 Base64 常驻内存。

两种形式均支持最长 4096 字符的 `prompt`、`auto|prompt` 模式和 1 至 16 的 `max_layers`。`prompt` 模式必须提供非空提示词；可在提示中附带 `<bbox>x1 y1 x2 y2</bbox>`（0–1000 归一化坐标）以优先处理指定区域。接受后返回 `202`：

```json
{ "task_id": "c052fc9e436941699b8d393e313d1407", "status": "pending", "phase": "queued", "progress": 0 }
```

`GET /api/layer-decompositions/{task_id}` 返回 `pending`、`running`、`correcting`、`completed`、`failed`、`cancelled` 或 `stopped`，并始终包含 `phase` 和 `progress`。完成结果位于 `data`：

```json
{
  "task_id": "c052fc9e436941699b8d393e313d1407",
  "status": "completed",
  "phase": "completed",
  "progress": 1,
  "data": {
    "group_id": "group-c052fc9e436941699b8d393e313d1407",
    "width": 1024,
    "height": 768,
    "background": {
      "url": "https://assets.example.com/background.png",
      "z_index": 0,
      "bounding_box": { "absolute": [0, 0, 1024, 768], "normalized": [0, 0, 1000, 1000] },
      "name": "background",
      "description": "Inpainted background",
      "confidence": 0.97
    },
    "layers": [
      {
        "url": "https://assets.example.com/person.png",
        "z_index": 1,
        "bounding_box": { "absolute": [120, 80, 680, 720], "normalized": [117, 104, 664, 938] },
        "name": "人物",
        "description": "画面中央的人物",
        "confidence": 0.96
      }
    ],
    "quality": { "ssim": 0.9995, "channel_error_within_one_ratio": 0.9996, "passed": true },
    "result_kind": "inference",
    "decisions": []
  },
  "error": null
}
```

`result_kind` 用于区分真实模型推理和测试响应：生产后端必须返回 `inference`；仅用于接口联调的 `LAYER_DECOMPOSER_ENV=test` 会返回 `test` 和占位素材。客户端会拒绝把 `test` 结果写入画布，因此不会用绿色占位图覆盖源图片。

- `POST /api/layer-decompositions/{task_id}/cancel`：取消 pending/running/correcting 任务并清理未提交产物。
- `POST /api/layer-decompositions/{task_id}/correct`：以 `prompt`、`layer_z_index`、0–1000 归一化 `bbox`、图片 `mask` 中至少一项重新排队，可选 `action` 为 `add`、`remove` 或 `replace`。JSON `mask` 可为受检 URL/data URL，本地蒙版使用 multipart 文件；服务按块写入任务目录，并通过 `BackendRequest.mask_path` 交给 SAM2 适配器。
- `GET /healthz`：报告后端是否就绪；未配置真实后端时健康检查和提交均返回 `503 backend_unavailable`。

服务不会自动读取或回退到 `LAYER_DECOMPOSER_ARK_API_KEY`，也不会默认调用
`doubao-seedream-5-0-pro-260628`。方舟适配器仅作为显式兼容模块保留；生产配置应指向本地工厂：

```bash
export LAYER_DECOMPOSER_BACKEND_FACTORY="layer_decomposer.local_backend:create_local_backend"
export LAYER_DECOMPOSER_LOCAL_DETECTOR_WEIGHTS="/models/yolo11x.pt"
export LAYER_DECOMPOSER_LOCAL_SEGMENTER_WEIGHTS="/models/sam2_b.pt"
export LAYER_DECOMPOSER_LOCAL_DEVICE="cpu" # 有 CUDA 时可改为 cuda:0
```

本地工厂需要安装可选依赖：

```bash
.venv/bin/pip install -e '.[local]'
```

权重文件必须已经下载到本机。服务不会静默下载权重；任一依赖、权重或设备不可用时，
`GET /healthz` 返回 `503` 并给出具体原因。候选识别由 OpenTu 现有视觉模型完成时，
前端可把 `__opentu_layer_candidates__` 加 JSON 传给 `prompt`，格式为
`{"candidates":[{"id":"...","name":"...","description":"...","bbox":[0,0,1000,1000],"confidence":0.9}]}`，
其中 bbox 是 0–1000 归一化坐标；本地检测器会优先使用该结果。

## 模型编排

[`orchestration.py`](src/layer_decomposer/orchestration.py) 定义可替换的 `CandidateDetector`、`Sam2`、`Ocr`、`Matting`、`DepthEstimator`、`Inpainting`、`QualityEvaluator` 和 `ArtifactPublisher` 协议。默认本地实现使用视觉模型候选/YOLO、SAM2 与 OpenCV；标准顺序为：候选定位、SAM2 分割、边缘优化、深度排序、背景修补、重合成质量校验、按 alpha 可见范围裁剪、顺序发布稳定素材。

`QualityEvaluator` 必须真实计算 SSIM 和单通道误差不超过 1 的比例；只有 `SSIM >= 0.999` 且比例 `>= 0.999` 才能完成。低质量或低置信结果进入 `correcting`。`ArtifactPublisher.discard_prefix()` 是取消、失败和替换旧修订时的原子清理钩子。

如需替换模型组件，部署方也可以构造 `OrchestrationComponents` 和 `OrchestrationBackend`，暴露工厂：

```python
def create_backend(settings):
    return OrchestrationBackend(build_deployment_components(settings))
```

再配置：

```bash
export LAYER_DECOMPOSER_BACKEND_FACTORY="my_deployment.layer_backend:create_backend"
```

缺少模型端点、权重、质量校验、对象存储或凭据时，工厂应抛错，服务会保持 503。[`testing.py`](src/layer_decomposer/testing.py) 中的确定性 mock 只有 `LAYER_DECOMPOSER_ENV=test` 才可创建。

## 资源与安全

- 硬限制为 30MB、3600 万像素、16 个前景层和 4096 字符提示词。
- URL 仅允许 HTTP(S) 默认端口；拒绝凭据、片段、非公网 DNS 和 HTTPS 降级跳转。
- 重定向逐跳复查 DNS，并固定到校验后的公网 IP 建连，防止 DNS rebinding/TOCTOU SSRF。
- 下载、Base64 解码、上传、哈希和产物发布均按块或顺序执行；源文件保存在任务临时目录。
- GPU 信号量限制推理并发；任务索引有锁、TTL、数量和源文件总字节上限。
- `LAYER_DECOMPOSER_TASK_TTL_SECONDS`、`LAYER_DECOMPOSER_TASK_MAX_TASKS`、`LAYER_DECOMPOSER_TASK_MAX_STORAGE_BYTES` 和 `LAYER_DECOMPOSER_QUEUE_TIMEOUT_SECONDS` 可调整任务资源边界。
- 取消会停止后台协程、调用产物清理钩子并删除源文件；失败不返回半套结果。
- 生产反向代理仍须配置请求体上限、超时、鉴权和每用户速率限制。

## 运行与测试

### 局域网访问 OpenTu

推荐只把前端开发服务器暴露到局域网，分层服务继续监听本机回环地址；Vite 会把同源的 `/api/layer-decompositions` 请求代理到 `127.0.0.1:8090`。

先启动分层服务（需要 Python 3.11+、本地权重和已安装依赖）：

```bash
cd services/layer-decomposer
.venv/bin/uvicorn layer_decomposer.app:app --host 127.0.0.1 --port 8090
```

启动前请按上文设置本地工厂和权重环境变量。浏览器端只访问本地 `8090`，模型权重不会下发到局域网设备。

再在项目根目录启动局域网前端：

```bash
export OPENTU_HOST=0.0.0.0
export OPENTU_PORT=7200
export VITE_LAYER_DECOMPOSER_PROXY_TARGET=http://127.0.0.1:8090
pnpm start:lan
```

在运行主机上获取局域网地址：

```bash
ipconfig getifaddr en0     # macOS Wi‑Fi，按需替换为 en1
hostname -I                # Linux
```

其他设备访问 `http://<局域网IP>:7200/`。防火墙只需放行 `7200/TCP`；若要让其他设备直连分层服务，才需要额外暴露 `8090/TCP`，不建议在未配置鉴权时这样做。

```bash
cd services/layer-decomposer
python3 -m venv .venv
.venv/bin/pip install -e '.[local,test]'
.venv/bin/uvicorn layer_decomposer.app:app --host 127.0.0.1 --port 8090
.venv/bin/pytest
```

默认启动为未配置状态，这是预期行为。API 返回的图层 URL 必须在 completed 前落到稳定素材存储，不能返回供应商的短期签名 URL。
