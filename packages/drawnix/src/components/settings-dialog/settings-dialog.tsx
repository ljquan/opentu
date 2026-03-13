import { Dialog, DialogContent } from '../dialog/dialog';
import { useDrawnix } from '../../hooks/use-drawnix';
import './settings-dialog.scss';
import { useI18n } from '../../i18n';
import { useState, useEffect } from 'react';
import { geminiSettings } from '../../utils/settings-manager';
import { Tooltip, Checkbox } from 'tdesign-react';
import { InfoCircleIcon } from 'tdesign-icons-react';
import { LS_KEYS } from '../../constants/storage-keys';
import { ModelDropdown } from '../ai-input-bar/ModelDropdown';
import { ModelDiscoveryDialog } from './model-discovery-dialog';
import {
  getDefaultImageModel,
  getDefaultVideoModel,
  getDefaultTextModel,
} from '../../constants/model-config';
import { usePreferredModels, useRuntimeModelDiscoveryState } from '../../hooks/use-runtime-models';
import { normalizeModelApiBaseUrl, runtimeModelDiscovery } from '../../utils/runtime-model-discovery';
// 为了向后兼容，重新导出这些常量
export { IMAGE_MODEL_GROUPED_SELECT_OPTIONS as IMAGE_MODEL_GROUPED_OPTIONS } from '../../constants/model-config';
export { VIDEO_MODEL_SELECT_OPTIONS as VIDEO_MODEL_OPTIONS } from '../../constants/model-config';

export const SettingsDialog = ({
  container,
}: {
  container: HTMLElement | null;
}) => {
  const { appState, setAppState } = useDrawnix();
  const { t, language } = useI18n();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [imageModelName, setImageModelName] = useState('');
  const [videoModelName, setVideoModelName] = useState('');
  const [textModelName, setTextModelName] = useState('');
  const [showWorkZoneCard, setShowWorkZoneCard] = useState(true);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [discoveryDialogOpen, setDiscoveryDialogOpen] = useState(false);
  const runtimeState = useRuntimeModelDiscoveryState();
  const imageModels = usePreferredModels('image');
  const videoModels = usePreferredModels('video');
  const textModels = usePreferredModels('text');
  const addedImageModels = runtimeState.models.filter((model) => model.type === 'image');
  const addedVideoModels = runtimeState.models.filter((model) => model.type === 'video');
  const addedTextModels = runtimeState.models.filter((model) => model.type === 'text');
  const addedModelGroups = [
    { title: '图片模型', models: addedImageModels },
    { title: '视频模型', models: addedVideoModels },
    { title: '文本模型', models: addedTextModels },
  ];

  // 加载当前配置
  useEffect(() => {
    if (appState.openSettings) {
      const config = geminiSettings.get();
      setApiKey(config.apiKey || '');
      setBaseUrl(config.baseUrl || 'https://api.tu-zi.com/v1');
      setImageModelName(config.imageModelName || getDefaultImageModel());
      setVideoModelName(config.videoModelName || getDefaultVideoModel());
      setTextModelName(config.textModelName || getDefaultTextModel());
      try {
        setShowWorkZoneCard(localStorage.getItem(LS_KEYS.WORKZONE_CARD_VISIBLE) !== 'false');
      } catch {
        setShowWorkZoneCard(true);
      }
      setSyncMessage(null);
      setDiscoveryDialogOpen(false);
    }
  }, [appState.openSettings]);

  const handleSave = async () => {
    const trimmedApiKey = apiKey.trim();
    const trimmedBaseUrl = normalizeModelApiBaseUrl(baseUrl.trim() || 'https://api.tu-zi.com/v1');
    const trimmedImageModel = imageModelName.trim() || imageModels[0]?.id || getDefaultImageModel();
    const trimmedVideoModel = videoModelName.trim() || videoModels[0]?.id || getDefaultVideoModel();
    const trimmedTextModel = textModelName.trim() || textModels[0]?.id || getDefaultTextModel();

    runtimeModelDiscovery.invalidateIfConfigChanged(trimmedBaseUrl, trimmedApiKey);
    
    // 使用全局设置管理器更新配置（必须等待完成）
    await geminiSettings.update({
      apiKey: trimmedApiKey,
      baseUrl: trimmedBaseUrl,
      imageModelName: trimmedImageModel,
      videoModelName: trimmedVideoModel,
      textModelName: trimmedTextModel,
    });

    // 配置随任务传递，无需同步到 SW

    // 保存 WorkZone 卡片显示设置
    try {
      localStorage.setItem(LS_KEYS.WORKZONE_CARD_VISIBLE, String(showWorkZoneCard));
      window.dispatchEvent(new CustomEvent('workzone-visibility-changed'));
    } catch {
      // localStorage not available
    }

    // 关闭弹窗
    setAppState({ ...appState, openSettings: false });
  };

  const handleCancel = () => {
    setAppState({ ...appState, openSettings: false });
  };

  const handleFetchModels = async () => {
    const trimmedApiKey = apiKey.trim();
    const normalizedBaseUrl = normalizeModelApiBaseUrl(baseUrl.trim() || 'https://api.tu-zi.com/v1');

    if (!trimmedApiKey) {
      setSyncMessage('请先填写 API Key');
      return;
    }

    try {
      const discovered = await runtimeModelDiscovery.discover(normalizedBaseUrl, trimmedApiKey);
      setBaseUrl(normalizedBaseUrl);
      setSyncMessage(`已获取 ${discovered.length} 个模型，请选择需要添加的模型`);
      setDiscoveryDialogOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型同步失败';
      runtimeModelDiscovery.setError(message);
      setSyncMessage(message);
    }
  };

  const handleApplySelectedModels = (selectedModelIds: string[]) => {
    const selectedModels = runtimeModelDiscovery.applySelection(selectedModelIds);
    const nextImageModels = selectedModels.filter((model) => model.type === 'image');
    const nextVideoModels = selectedModels.filter((model) => model.type === 'video');
    const nextTextModels = selectedModels.filter((model) => model.type === 'text');
    const discoveredImageIds = runtimeState.discoveredModels
      .filter((model) => model.type === 'image')
      .map((model) => model.id);
    const discoveredVideoIds = runtimeState.discoveredModels
      .filter((model) => model.type === 'video')
      .map((model) => model.id);
    const discoveredTextIds = runtimeState.discoveredModels
      .filter((model) => model.type === 'text')
      .map((model) => model.id);

    if (!nextImageModels.some((model) => model.id === imageModelName) && discoveredImageIds.includes(imageModelName)) {
      setImageModelName(nextImageModels[0]?.id || getDefaultImageModel());
    }
    if (!nextVideoModels.some((model) => model.id === videoModelName) && discoveredVideoIds.includes(videoModelName)) {
      setVideoModelName(nextVideoModels[0]?.id || getDefaultVideoModel());
    }
    if (!nextTextModels.some((model) => model.id === textModelName) && discoveredTextIds.includes(textModelName)) {
      setTextModelName(nextTextModels[0]?.id || getDefaultTextModel());
    }

    setSyncMessage(
      selectedModels.length > 0
        ? `已添加 ${selectedModels.length} 个模型`
        : '已清空添加模型，当前仍使用内置模型'
    );
    setDiscoveryDialogOpen(false);
  };

  const handleRemoveAddedModel = (modelId: string) => {
    handleApplySelectedModels(runtimeState.selectedModelIds.filter((id) => id !== modelId));
  };

  const handleClearAddedModels = () => {
    handleApplySelectedModels([]);
  };

  return (
    <Dialog
      open={appState.openSettings}
      onOpenChange={(open) => {
        if (!open && discoveryDialogOpen) {
          return;
        }
        setAppState({ ...appState, openSettings: open });
      }}
    >
      <DialogContent className="settings-dialog" container={container} data-testid="settings-dialog">
        <h2 className="settings-dialog__title">{t('settings.title')}</h2>
        <form className="settings-dialog__form" onSubmit={(e) => e.preventDefault()}>
          <div className="settings-dialog__field">
            <div className="settings-dialog__label-with-tooltip">
              <label className="settings-dialog__label" htmlFor="apiKeyInput">
                API Key
              </label>
              <Tooltip
              content={
                  <div>
                    您可以从以下地址获取 API Key:
                    <br />
                    <a
                      href="https://api.tu-zi.com/token"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#F39C12', textDecoration: 'none' }}
                    >
                      api.tu-zi.com/token
                    </a>
                    <br />
                    <a
                      href="https://www.bilibili.com/video/BV1k4PqzPEKz/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        marginTop: 6,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 10px',
                        background: '#fb7299',
                        color: '#fff',
                        borderRadius: 4,
                        fontSize: 12,
                        textDecoration: 'none',
                      }}
                    >
                      ▶ 观看视频教程 (B站)
                    </a>
                  </div>
                }
                placement="top"
                theme="light"
                showArrow={false}
              >
                <InfoCircleIcon className="settings-dialog__tooltip-icon" />
              </Tooltip>
            </div>
            <input
              type="password"
              id="apiKeyInput"
              className="settings-dialog__input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('settings.apiKeyPlaceholder')}
              autoComplete="off"
            />
          </div>
          <div className="settings-dialog__field">
            <label className="settings-dialog__label">Base URL</label>
            <div className="settings-dialog__stack">
              <input
                type="text"
                className="settings-dialog__input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.tu-zi.com/v1"
              />
              <div className="settings-dialog__helper-row">
                <button
                  type="button"
                  className="settings-dialog__button settings-dialog__button--save"
                  onClick={handleFetchModels}
                  disabled={runtimeState.status === 'loading'}
                  style={{ minWidth: 104 }}
                >
                  {runtimeState.status === 'loading' ? '获取中...' : '获取模型'}
                </button>
                <span className="settings-dialog__helper-text">
                  {syncMessage ||
                    (runtimeState.discoveredAt
                      ? `已添加 ${runtimeState.models.length} / 已获取 ${runtimeState.discoveredModels.length}`
                      : '支持从 /v1/models 获取模型列表')}
                </span>
              </div>
            </div>
          </div>
          <div className="settings-dialog__field settings-dialog__field--top">
            <label className="settings-dialog__label">已添加</label>
            <div className="settings-dialog__stack">
              {runtimeState.models.length > 0 ? (
                <>
                  <div className="settings-dialog__added-summary">
                    <span>图片 {addedImageModels.length}</span>
                    <span>视频 {addedVideoModels.length}</span>
                    <span>文本 {addedTextModels.length}</span>
                    <button
                      type="button"
                      className="settings-dialog__link-button"
                      onClick={handleClearAddedModels}
                    >
                      清空全部
                    </button>
                  </div>
                  {addedModelGroups.map(({ title, models }) =>
                    models.length > 0 ? (
                      <div key={title} className="settings-dialog__added-group">
                        <div className="settings-dialog__added-group-title">{title}</div>
                        <div className="settings-dialog__added-list">
                          {models.map((model) => (
                            <span key={model.id} className="settings-dialog__added-chip">
                              <span className="settings-dialog__added-chip-label">
                                {model.shortLabel || model.label}
                              </span>
                              <button
                                type="button"
                                className="settings-dialog__added-chip-remove"
                                onClick={() => handleRemoveAddedModel(model.id)}
                                aria-label={`移除 ${model.id}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null
                  )}
                </>
              ) : (
                <div className="settings-dialog__empty-state">
                  还没有添加模型，当前仍使用系统内置模型。
                </div>
              )}
            </div>
          </div>
          <div className="settings-dialog__field">
            <div className="settings-dialog__label-with-tooltip">
              <label className="settings-dialog__label">图片模型</label>
              <Tooltip
                content="图片生成使用接口 /v1/images/generations"
                placement="top"
                theme="light"
                showArrow={false}
              >
                <InfoCircleIcon className="settings-dialog__tooltip-icon" />
              </Tooltip>
            </div>
            <div className="settings-dialog__model-dropdown-container">
              <ModelDropdown
                selectedModel={imageModelName}
                onSelect={(value) => setImageModelName(value)}
                language={language}
                models={imageModels}
                placement="down"
                variant="form"
              />
            </div>
          </div>
          <div className="settings-dialog__field">
            <div className="settings-dialog__label-with-tooltip">
              <label className="settings-dialog__label">视频模型</label>
              <Tooltip
                content="视频生成使用接口 /v1/videos"
                placement="top"
                theme="light"
                showArrow={false}
              >
                <InfoCircleIcon className="settings-dialog__tooltip-icon" />
              </Tooltip>
            </div>
            <div className="settings-dialog__model-dropdown-container">
              <ModelDropdown
                selectedModel={videoModelName}
                onSelect={(value) => setVideoModelName(value)}
                language={language}
                models={videoModels}
                placement="down"
                variant="form"
              />
            </div>
          </div>
          <div className="settings-dialog__field">
            <div className="settings-dialog__label-with-tooltip">
              <label className="settings-dialog__label">文本模型</label>
              <Tooltip
                content="Agent 模式使用，接口 /v1/chat/completions"
                placement="top"
                theme="light"
                showArrow={false}
              >
                <InfoCircleIcon className="settings-dialog__tooltip-icon" />
              </Tooltip>
            </div>
            <div className="settings-dialog__model-dropdown-container">
              <ModelDropdown
                selectedModel={textModelName}
                onSelect={(value) => setTextModelName(value)}
                language={language}
                models={textModels}
                placement="down"
                variant="form"
              />
            </div>
          </div>

          <div className="settings-dialog__divider" />
          <div className="settings-dialog__field">
            <label className="settings-dialog__label">画布显示</label>
            <Checkbox
              checked={showWorkZoneCard}
              onChange={(checked) => setShowWorkZoneCard(checked as boolean)}
            >
              显示任务进度卡片
            </Checkbox>
          </div>

        </form>
        <div className="settings-dialog__actions">
          <button
            className="settings-dialog__button settings-dialog__button--cancel"
            data-track="settings_click_cancel"
            onClick={handleCancel}
          >
            {t('settings.cancel')}
          </button>
          <button
            className="settings-dialog__button settings-dialog__button--save"
            data-track="settings_click_save"
            onClick={handleSave}
          >
            {t('settings.save')}
          </button>
        </div>
      </DialogContent>
      <ModelDiscoveryDialog
        open={discoveryDialogOpen}
        container={container}
        models={runtimeState.discoveredModels}
        selectedModelIds={runtimeState.selectedModelIds}
        onClose={() => setDiscoveryDialogOpen(false)}
        onConfirm={handleApplySelectedModels}
      />
    </Dialog>
  );
};
