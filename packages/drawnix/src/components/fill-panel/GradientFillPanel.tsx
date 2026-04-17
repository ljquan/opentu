/**
 * 渐变填充面板组件
 * Gradient Fill Panel Component
 *
 * 使用公共的 GradientEditor 组件
 */

import React, { useState, useEffect, useCallback } from 'react';
import { GradientEditor, generateGradientCSS } from '../gradient-editor';
import type { GradientFillConfig } from '../../types/fill.types';
import { DEFAULT_LINEAR_GRADIENT } from '../../types/fill.types';
import { kvStorageService } from '../../services/kv-storage-service';
import { LS_KEYS_TO_MIGRATE } from '../../constants/storage-keys';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import { useI18n } from '../../i18n';

const CUSTOM_GRADIENTS_KEY = LS_KEYS_TO_MIGRATE.CUSTOM_GRADIENTS;

export interface GradientFillPanelProps {
  value?: GradientFillConfig;
  onChange?: (config: GradientFillConfig) => void;
  /** 内联模式（更紧凑的布局） */
  inline?: boolean;
}

export const GradientFillPanel: React.FC<GradientFillPanelProps> = ({
  value,
  onChange,
  inline = false,
}) => {
  const { language } = useI18n();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [customGradients, setCustomGradients] = useState<Array<{ id: string; css: string }>>([]);
  const [currentConfig, setCurrentConfig] = useState<GradientFillConfig>(
    value || DEFAULT_LINEAR_GRADIENT
  );

  // 从 IndexedDB 加载自定义渐变预设
  useEffect(() => {
    let mounted = true;
    kvStorageService.get<Array<{ id: string; css: string }>>(CUSTOM_GRADIENTS_KEY)
      .then((gradients) => {
        if (!mounted) return;
        if (gradients) setCustomGradients(gradients);
      })
      .catch((e) => {
        console.warn('Failed to load gradient data:', e);
      });
    return () => { mounted = false; };
  }, []);

  // 同步外部 value 变化
  useEffect(() => {
    if (value) {
      setCurrentConfig(value);
    }
  }, [value]);

  // 处理渐变变更
  const handleChange = useCallback((config: GradientFillConfig) => {
    setCurrentConfig(config);
    onChange?.(config);
  }, [onChange]);

  // 保存当前渐变到预设
  const saveCurrentGradient = useCallback(() => {
    const gradientCSS = generateGradientCSS(currentConfig);
    const newGradient = {
      id: `custom-${Date.now()}`,
      css: gradientCSS,
    };
    const updated = [newGradient, ...customGradients].slice(0, 8);
    setCustomGradients(updated);
    kvStorageService.set(CUSTOM_GRADIENTS_KEY, updated).catch((e) => {
      console.warn('Failed to save custom gradients:', e);
    });
  }, [currentConfig, customGradients]);

  // 删除自定义渐变
  const deleteCustomGradient = useCallback(async (index: number) => {
    const gradient = customGradients[index];
    if (!gradient) {
      return;
    }

    const confirmed = await confirm({
      title: language === 'zh' ? '确认删除渐变预设' : 'Delete Gradient Preset',
      description:
        language === 'zh'
          ? '确定要删除这个自定义渐变预设吗？'
          : 'Are you sure you want to delete this custom gradient preset?',
      confirmText: language === 'zh' ? '删除' : 'Delete',
      cancelText: language === 'zh' ? '取消' : 'Cancel',
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    const updated = customGradients.filter(g => g.id !== gradient.id);
    setCustomGradients(updated);
    kvStorageService.set(CUSTOM_GRADIENTS_KEY, updated).catch((e) => {
      console.warn('Failed to save custom gradients:', e);
    });
  }, [confirm, customGradients, language]);

  return (
    <>
      <GradientEditor
        value={currentConfig}
        onChange={handleChange}
        showPresets={true}
        showHistory={true}
        inline={inline}
        customPresets={customGradients.map((g) => g.css)}
        onSavePreset={saveCurrentGradient}
        onDeletePreset={deleteCustomGradient}
      />
      {confirmDialog}
    </>
  );
};

export default GradientFillPanel;
