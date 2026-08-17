import { useCallback, useEffect, useState } from 'react';
import { Switch } from 'tdesign-react';
import {
  taskPetSettings,
  type TaskPetSettings,
} from '../../utils/settings-manager';
import './task-pet.scss';

const FALLBACK_SETTINGS: TaskPetSettings = {
  version: 1,
  enabled: true,
  motionEnabled: true,
  speechEnabled: false,
  taskTypes: {
    text: true,
    image: true,
    video: true,
  },
};

function normalizeSettings(settings?: TaskPetSettings | null): TaskPetSettings {
  return settings || FALLBACK_SETTINGS;
}

interface SettingRowProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const SettingRow = ({
  title,
  description,
  checked,
  onChange,
}: SettingRowProps) => (
  <div className="task-pet-settings__row">
    <div className="task-pet-settings__copy">
      <span className="task-pet-settings__title">{title}</span>
      <span className="task-pet-settings__description">{description}</span>
    </div>
    <Switch
      size="small"
      value={checked}
      aria-label={title}
      onChange={(value) => onChange(value as boolean)}
    />
  </div>
);

export const TaskPetSettingsPanel = () => {
  const [settings, setSettings] = useState<TaskPetSettings>(() =>
    normalizeSettings(taskPetSettings.get())
  );

  useEffect(() => {
    const handleSettingsChange = (nextSettings: TaskPetSettings) => {
      setSettings(normalizeSettings(nextSettings));
    };

    taskPetSettings.addListener(handleSettingsChange);
    return () => taskPetSettings.removeListener(handleSettingsChange);
  }, []);

  const persist = useCallback((nextSettings: TaskPetSettings) => {
    setSettings(nextSettings);
    void taskPetSettings.update(nextSettings);
  }, []);

  const updateRootSetting = useCallback(
    (key: 'enabled' | 'motionEnabled' | 'speechEnabled', value: boolean) => {
      persist({
        ...settings,
        [key]: value,
      });
    },
    [persist, settings]
  );

  const updateTaskType = useCallback(
    (key: keyof TaskPetSettings['taskTypes'], value: boolean) => {
      persist({
        ...settings,
        taskTypes: {
          ...settings.taskTypes,
          [key]: value,
        },
      });
    },
    [persist, settings]
  );

  return (
    <div className="settings-dialog__workspace settings-dialog__workspace--single">
      <div className="settings-dialog__content-panel task-pet-settings">
        <section className="task-pet-settings__section">
          <div className="task-pet-settings__heading">
            <img src="/logo-tuzi.png" alt="" draggable={false} />
            <div>
              <h3>任务灵宠</h3>
              <p>在左侧工具栏跟进任务状态。</p>
            </div>
          </div>

          <SettingRow
            title="显示灵宠"
            description="在左侧工具栏显示兔子灵宠入口。"
            checked={settings.enabled}
            onChange={(checked) => updateRootSetting('enabled', checked)}
          />
          <SettingRow
            title="动作提醒"
            description="任务状态变化时显示对应动作。"
            checked={settings.motionEnabled}
            onChange={(checked) => updateRootSetting('motionEnabled', checked)}
          />
          <SettingRow
            title="语音播报"
            description="使用浏览器语音简短播报任务开始和结果。"
            checked={settings.speechEnabled}
            onChange={(checked) => updateRootSetting('speechEnabled', checked)}
          />
        </section>

        <section className="task-pet-settings__section">
          <div className="task-pet-settings__section-header">
            <h3>提醒任务类型</h3>
          </div>
          <SettingRow
            title="文本任务"
            description="包含对话与文本分析任务。"
            checked={settings.taskTypes.text}
            onChange={(checked) => updateTaskType('text', checked)}
          />
          <SettingRow
            title="生图任务"
            description="图片生成和图片编辑任务。"
            checked={settings.taskTypes.image}
            onChange={(checked) => updateTaskType('image', checked)}
          />
          <SettingRow
            title="生视频任务"
            description="视频生成与视频编辑任务。"
            checked={settings.taskTypes.video}
            onChange={(checked) => updateTaskType('video', checked)}
          />
        </section>
      </div>
    </div>
  );
};

export default TaskPetSettingsPanel;
