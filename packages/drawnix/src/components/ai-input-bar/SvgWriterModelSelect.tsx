import React, { useRef } from 'react';
import { Select } from 'tdesign-react';
import { ATTACHED_ELEMENT_CLASS_NAME } from '@plait/core';
import { Z_INDEX } from '../../constants/z-index';

interface SvgWriterModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  language?: 'zh' | 'en';
}

export function SvgWriterModelSelect({
  value,
  onChange,
  disabled,
  language = 'zh',
}: SvgWriterModelSelectProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The general model catalog is not an SVG capability list. Recommend only
  // the documented example; other IDs remain explicit user choices.
  const currentValue = value || 'gpt-5.5';
  const options = [{
    value: 'gpt-5.5',
    label: language === 'zh' ? 'gpt-5.5（渠道示例）' : 'gpt-5.5 (documented example)',
  }];
  if (currentValue !== 'gpt-5.5') {
    options.push({ value: currentValue, label: `${currentValue} (${language === 'zh' ? '自定义，未验证' : 'custom, unverified'})` });
  }

  return (
    <div ref={containerRef} onKeyDown={(event) => event.stopPropagation()}>
      <label>
        <span className="parameters-dropdown__visually-hidden">
          {language === 'zh' ? 'SVG 编写模型' : 'SVG writer model'}
        </span>
        <Select
          value={currentValue}
          options={options}
          filterable
          creatable
          disabled={disabled}
          placeholder={language === 'zh' ? '搜索或输入自定义模型 ID' : 'Search or enter a custom model ID'}
          popupProps={{
            attach: () => containerRef.current || document.body,
            overlayClassName: ATTACHED_ELEMENT_CLASS_NAME,
            zIndex: Z_INDEX.DROPDOWN_PORTAL,
            // Escape the parameter menu's scroll clipping while keeping
            // option clicks inside its outside-click boundary.
            popperOptions: { strategy: 'fixed' },
          }}
          onChange={(next) => {
            if (typeof next === 'string' && next.trim()) onChange(next.trim());
          }}
        />
      </label>
      <div className="parameters-dropdown__section-description" role="note">
        {language === 'zh'
          ? '推荐项来自渠道 SVG 示例；其他模型可输入 ID 创建选项，需自行确认 SVG 接口支持。'
          : 'Recommendations follow the provider SVG example. Enter a custom ID for other models; SVG support must be confirmed.'}
      </div>
    </div>
  );
}
