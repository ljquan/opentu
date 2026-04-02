/**
 * 参数下拉选择器组件
 *
 * 平铺展示当前模型所有可配置参数，每种参数分段显示其所有可选值
 * 支持键盘导航：上下键切换参数组，左右键切换选项，Tab/Enter 确认
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Settings2 } from 'lucide-react';
import { ATTACHED_ELEMENT_CLASS_NAME } from '@plait/core';
import {
  getCompatibleParams,
  type ParamConfig,
} from '../../constants/model-config';
import { Z_INDEX } from '../../constants/z-index';
import { useControllableState } from '../../hooks/useControllableState';
import './parameters-dropdown.scss';
import { KeyboardDropdown } from './KeyboardDropdown';

function getCompactEnumSummaryLabel(paramId: string, value: string, label: string): string {
  if (paramId === 'size') {
    return label.split('(')[0].trim();
  }

  if (paramId === 'duration') {
    return `${value}s`;
  }

  if (paramId === 'klingAction2') {
    return value === 'image2video' ? '图生' : '文生';
  }

  if (paramId === 'mode') {
    return value;
  }

  return label;
}

export interface ParametersDropdownProps {
  /** 当前选中的参数值映射 (id -> value) */
  selectedParams: Record<string, string>;
  /** 参数变更回调 */
  onParamChange: (
    paramId: string,
    value: string,
    options?: { keepOpen?: boolean }
  ) => void;
  /** 预先计算好的兼容参数列表（可选，传入则跳过内部计算） */
  compatibleParams?: ParamConfig[];
  /** 当前选中的模型 ID */
  modelId: string;
  /** 语言 */
  language?: 'zh' | 'en';
  /** 是否禁用 */
  disabled?: boolean;
  /** 受控的打开状态 */
  isOpen?: boolean;
  /** 打开状态变化回调 */
  onOpenChange?: (open: boolean) => void;
  /** 排除的参数 ID 列表（已有专用 UI 的参数，如 size、duration） */
  excludeParamIds?: string[];
}

/**
 * 参数下拉选择器
 */
export const ParametersDropdown: React.FC<ParametersDropdownProps> = ({
  selectedParams,
  onParamChange,
  compatibleParams: compatibleParamsProp,
  modelId,
  language = 'zh',
  disabled = false,
  isOpen: controlledIsOpen,
  onOpenChange,
  excludeParamIds,
}) => {
  const { value: isOpen, setValue: setIsOpen } = useControllableState({
    controlledValue: controlledIsOpen,
    defaultValue: false,
    onChange: onOpenChange,
  });

  // 键盘导航状态：当前高亮的参数组索引和选项索引
  const [highlightedParamIndex, setHighlightedParamIndex] = useState(0);
  const [highlightedOptionIndex, setHighlightedOptionIndex] = useState(0);

  // 获取当前模型兼容的所有参数（排除已有专用 UI 的参数）
  const compatibleParams = useMemo(() => {
    const params = compatibleParamsProp ?? getCompatibleParams(modelId);
    if (excludeParamIds && excludeParamIds.length > 0) {
      return params.filter(p => !excludeParamIds.includes(p.id));
    }
    return params;
  }, [compatibleParamsProp, modelId, excludeParamIds]);

  // 打开时重置高亮索引
  useEffect(() => {
    if (isOpen && compatibleParams.length > 0) {
      setHighlightedParamIndex(0);
      // 高亮当前选中的选项
      const firstParam = compatibleParams[0];
      const currentValue = selectedParams[firstParam.id];
      const optionIndex = firstParam.options?.findIndex(opt => opt.value === currentValue) ?? 0;
      setHighlightedOptionIndex(optionIndex >= 0 ? optionIndex : 0);
    }
  }, [isOpen, compatibleParams, selectedParams]);

  // 获取触发器按钮上的概览文本
  const triggerLabel = useMemo(() => {
    if (compatibleParams.length === 0) return language === 'zh' ? '参数' : 'Params';

    const summaryParts: string[] = [];

    // 按顺序检查常见参数进行概览显示
    compatibleParams.forEach(param => {
      const value = selectedParams[param.id];
      if (value) {
        if (param.valueType === 'enum') {
          const option = param.options?.find(opt => opt.value === value);
          if (option) {
            summaryParts.push(
              getCompactEnumSummaryLabel(param.id, value, option.label)
            );
          }
        } else {
          const displayValue = value.length > 10 ? `${value.slice(0, 10)}…` : value;
          summaryParts.push(`${param.shortLabel || param.label}:${displayValue}`);
        }
      }
    });

    if (summaryParts.length === 0) return language === 'zh' ? '配置参数' : 'Settings';
    return summaryParts.join(', ');
  }, [compatibleParams, selectedParams, language]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // 阻止触发输入框失焦
    if (disabled) return;
    setIsOpen(!isOpen);
  }, [disabled, isOpen, setIsOpen]);

  const handleOpenKey = useCallback((key: string) => {
    if (key === 'Escape') {
      setIsOpen(false);
      return true;
    }

    const currentParam = compatibleParams[highlightedParamIndex];
    const optionsCount = currentParam?.options?.length ?? 0;

    if (key === 'ArrowDown') {
      // 切换到下一个参数组
      setHighlightedParamIndex(prev => {
        const next = prev < compatibleParams.length - 1 ? prev + 1 : 0;
        // 重置选项索引到当前选中项或第一项
        const nextParam = compatibleParams[next];
        const currentValue = selectedParams[nextParam.id];
        const optIndex = nextParam.options?.findIndex(opt => opt.value === currentValue) ?? 0;
        setHighlightedOptionIndex(optIndex >= 0 ? optIndex : 0);
        return next;
      });
      return true;
    }

    if (key === 'ArrowUp') {
      // 切换到上一个参数组
      setHighlightedParamIndex(prev => {
        const next = prev > 0 ? prev - 1 : compatibleParams.length - 1;
        // 重置选项索引到当前选中项或第一项
        const nextParam = compatibleParams[next];
        const currentValue = selectedParams[nextParam.id];
        const optIndex = nextParam.options?.findIndex(opt => opt.value === currentValue) ?? 0;
        setHighlightedOptionIndex(optIndex >= 0 ? optIndex : 0);
        return next;
      });
      return true;
    }

    if (key === 'ArrowRight') {
      // 在当前参数组内切换到下一个选项
      setHighlightedOptionIndex(prev => (prev < optionsCount - 1 ? prev + 1 : 0));
      return true;
    }

    if (key === 'ArrowLeft') {
      // 在当前参数组内切换到上一个选项
      setHighlightedOptionIndex(prev => (prev > 0 ? prev - 1 : optionsCount - 1));
      return true;
    }

    if (key === 'Enter' || key === ' ' || key === 'Tab') {
      // 选中当前高亮的选项
      const option = currentParam?.options?.[highlightedOptionIndex];
      if (option) {
        onParamChange(currentParam.id, option.value);
      }
      return true;
    }

    return false;
  }, [compatibleParams, highlightedParamIndex, highlightedOptionIndex, selectedParams, onParamChange]);

  const handleValueSelect = useCallback((paramId: string, value: string) => {
    onParamChange(paramId, value);
  }, [onParamChange]);

  const handleFieldInput = useCallback(
    (paramId: string, value: string) => {
      onParamChange(paramId, value, { keepOpen: true });
    },
    [onParamChange]
  );

  if (compatibleParams.length === 0) return null;

  return (
    <KeyboardDropdown
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      disabled={disabled}
      openKeys={['Enter', ' ', 'ArrowDown', 'ArrowUp']}
      onOpenKey={handleOpenKey}
    >
      {({ containerRef, menuRef, portalPosition, handleTriggerKeyDown }) => (
        <div className="parameters-dropdown" ref={containerRef}>
          <button
            className={`parameters-dropdown__trigger ${isOpen ? 'parameters-dropdown__trigger--open' : ''}`}
            onMouseDown={handleToggle}
            onKeyDown={handleTriggerKeyDown}
            type="button"
            disabled={disabled}
            title={`${triggerLabel} (↑↓ Tab)`}
          >
            <span className="parameters-dropdown__label">{triggerLabel}</span>
            <ChevronDown size={14} className={`parameters-dropdown__icon ${isOpen ? 'parameters-dropdown__icon--open' : ''}`} />
          </button>
          {isOpen && createPortal(
            <div
              ref={menuRef}
              className={`parameters-dropdown__menu parameters-dropdown__menu--flat ${ATTACHED_ELEMENT_CLASS_NAME}`}
              style={{
                position: 'fixed',
                zIndex: Z_INDEX.DROPDOWN_PORTAL,
                left: portalPosition.left,
                bottom: window.innerHeight - portalPosition.top + 8,
                maxHeight: Math.max(
                  240,
                  Math.min(420, portalPosition.top - 12)
                ),
                overflowY: 'auto',
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="parameters-dropdown__header">
                <Settings2 size={14} />
                <span>{language === 'zh' ? '设置生成参数 (↑↓←→ Tab)' : 'Parameters (↑↓←→ Tab)'}</span>
              </div>

              <div className="parameters-dropdown__sections">
                {compatibleParams.map((param, paramIndex) => {
                  const currentValue = selectedParams[param.id];
                  const isParamHighlighted = paramIndex === highlightedParamIndex;
                  return (
                    <div
                      key={param.id}
                      className={`parameters-dropdown__section ${isParamHighlighted ? 'parameters-dropdown__section--highlighted' : ''}`}
                    >
                      <div className="parameters-dropdown__section-title">
                        {param.label}
                      </div>
                      {param.valueType === 'enum' ? (
                        <div className="parameters-dropdown__options">
                          {param.options?.map((option, optionIndex) => {
                            const isSelected = currentValue === option.value;
                            const isOptionHighlighted = isParamHighlighted && optionIndex === highlightedOptionIndex;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                className={`parameters-dropdown__option ${isSelected ? 'parameters-dropdown__option--selected' : ''} ${isOptionHighlighted ? 'parameters-dropdown__option--highlighted' : ''}`}
                                onClick={() => handleValueSelect(param.id, option.value)}
                                onMouseEnter={() => {
                                  setHighlightedParamIndex(paramIndex);
                                  setHighlightedOptionIndex(optionIndex);
                                }}
                              >
                                <span className="parameters-dropdown__option-label">
                                  {option.label.split('(')[0].trim()}
                                </span>
                                {isSelected && <Check size={12} className="parameters-dropdown__option-check" />}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="parameters-dropdown__field">
                          <input
                            type={param.valueType === 'number' ? 'number' : 'text'}
                            className="parameters-dropdown__field-input"
                            value={currentValue || ''}
                            placeholder={param.description || param.label}
                            min={param.valueType === 'number' ? param.min : undefined}
                            max={param.valueType === 'number' ? param.max : undefined}
                            step={param.valueType === 'number' ? param.step : undefined}
                            onChange={(event) =>
                              handleFieldInput(param.id, event.target.value)
                            }
                            onMouseDown={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>,
            document.body
          )}
        </div>
      )}
    </KeyboardDropdown>
  );
};
