import { useState } from 'react';
import { Checkbox, MessagePlugin } from 'tdesign-react';
import {
  IMAGE_TOOLBAR_OPTIONS,
  readImageToolbarPreferences,
  writeImageToolbarPreferences,
  type ImageToolbarPreferences,
} from '../../utils/image-toolbar-preferences';

export function ImageToolbarSettings() {
  const [imageToolbarPreferences, setImageToolbarPreferences] = useState(
    readImageToolbarPreferences
  );
  const updateImageToolbarPreferences = (next: ImageToolbarPreferences) => {
    try {
      writeImageToolbarPreferences(next);
      setImageToolbarPreferences(next);
    } catch (error) {
      console.error('Failed to persist image toolbar preferences:', error);
      MessagePlugin.error('图片工具栏配置保存失败，请重试');
    }
  };

  return (
    <div className="settings-dialog__image-toolbar-settings">
      <div className="settings-dialog__toggle-copy">
        <span className="settings-dialog__toggle-title">图片工具栏</span>
        <span className="settings-dialog__toggle-desc">
          选择哪些图片工具固定显示在工具栏，未固定的工具可从更多菜单打开。
        </span>
      </div>
      <div className="settings-dialog__image-tool-grid">
        {IMAGE_TOOLBAR_OPTIONS.map((tool) => {
          const checked = !imageToolbarPreferences.hidden.includes(tool.id);
          return (
            <Checkbox
              key={tool.id}
              checked={checked}
              onChange={(checked) =>
                updateImageToolbarPreferences({
                  ...imageToolbarPreferences,
                  hidden: checked
                    ? imageToolbarPreferences.hidden.filter(
                        (id) => id !== tool.id
                      )
                    : [...imageToolbarPreferences.hidden, tool.id],
                })
              }
            >
              {tool.label}
            </Checkbox>
          );
        })}
      </div>
      <Checkbox
        className="settings-dialog__image-label-toggle"
        checked={imageToolbarPreferences.labels}
        onChange={(checked) =>
          updateImageToolbarPreferences({
            ...imageToolbarPreferences,
            labels: checked,
          })
        }
      >
        显示工具文字
      </Checkbox>
    </div>
  );
}
