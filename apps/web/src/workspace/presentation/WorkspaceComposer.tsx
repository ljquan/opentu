import {
  ChevronDown,
  ImagePlus,
  Send,
  SlidersHorizontal,
  Video,
  WandSparkles,
} from 'lucide-react';
import type { FormEvent, KeyboardEvent, RefObject } from 'react';

export type WorkspaceCreationMode = 'image' | 'video';

interface WorkspaceComposerProps {
  prompt: string;
  mode: WorkspaceCreationMode;
  model: string;
  modelOptions: Array<{ value: string; label: string }>;
  ratio: string;
  resolution: string;
  count: number;
  inputRef: RefObject<HTMLInputElement>;
  onPromptChange: (value: string) => void;
  onModeChange: (mode: WorkspaceCreationMode) => void;
  onModelChange: (model: string) => void;
  onRatioChange: (ratio: string) => void;
  onResolutionChange: (resolution: string) => void;
  onCountChange: (count: number) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}

export function WorkspaceComposer({
  prompt,
  mode,
  model,
  modelOptions,
  ratio,
  resolution,
  count,
  inputRef,
  onPromptChange,
  onModeChange,
  onModelChange,
  onRatioChange,
  onResolutionChange,
  onCountChange,
  onSubmit,
  onClose,
}: WorkspaceComposerProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit(event);
    }
  };

  return (
    <div className="next-workspace__composer-wrap">
      <div className="next-workspace__composer-label">
        <WandSparkles size={14} /> AI 创作助手 <span>将结果放入当前画布</span>
        <button type="button" aria-label="收起 AI 创作助手" title="收起" onClick={onClose}>
          <ChevronDown size={15} />
        </button>
      </div>
      <div
        className="next-workspace__composer-modes"
        role="tablist"
        aria-label="创作类型"
      >
        <button
          className={mode === 'image' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={mode === 'image'}
          onClick={() => onModeChange('image')}
        >
          <ImagePlus size={13} /> 图片
        </button>
        <button
          className={mode === 'video' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={mode === 'video'}
          onClick={() => onModeChange('video')}
        >
          <Video size={13} /> 视频
        </button>
      </div>
      <form className="next-workspace__composer" onSubmit={onSubmit}>
        <div className="next-workspace__composer-prompt-row">
          <SparklesMark />
          <input
            ref={inputRef}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想创作或修改的内容…"
            aria-label="AI 创作描述"
          />
          <button
            className="next-workspace__composer-submit"
            type="submit"
            aria-label="提交创作任务"
          >
            <Send size={17} />
          </button>
        </div>
        <div className="next-workspace__composer-settings">
          <label>
            <span className="sr-only">生成模型</span>
            <select
              aria-label="生成模型"
              value={model}
              onChange={(event) => onModelChange(event.target.value)}
            >
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
          {mode === 'image' && (
            <>
              <label>
                <span className="sr-only">画面比例</span>
                <select
                  aria-label="画面比例"
                  value={ratio}
                  onChange={(event) => onRatioChange(event.target.value)}
                >
                  <option value="1x1">1:1</option>
                  <option value="4x3">4:3</option>
                  <option value="3x4">3:4</option>
                  <option value="16x9">16:9</option>
                  <option value="9x16">9:16</option>
                </select>
                <ChevronDown size={13} />
              </label>
              <label>
                <span className="sr-only">输出分辨率</span>
                <select
                  aria-label="输出分辨率"
                  value={resolution}
                  onChange={(event) => onResolutionChange(event.target.value)}
                >
                  <option value="1k">1K</option>
                  <option value="2k">2K</option>
                  <option value="4k">4K</option>
                </select>
                <ChevronDown size={13} />
              </label>
            </>
          )}
          <label>
            <span className="sr-only">生成数量</span>
            <select
              aria-label="生成数量"
              value={count}
              onChange={(event) => onCountChange(Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value} 张
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
          <span className="next-workspace__composer-settings-icon" title="生成参数已同步">
            <SlidersHorizontal size={15} />
          </span>
        </div>
      </form>
    </div>
  );
}

function SparklesMark() {
  return (
    <span className="next-workspace__composer-spark" aria-hidden="true">
      <WandSparkles size={18} />
    </span>
  );
}
