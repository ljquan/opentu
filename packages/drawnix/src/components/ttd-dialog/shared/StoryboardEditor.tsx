/**
 * StoryboardEditor Component
 *
 * Multi-scene editor for storyboard mode in video generation.
 * Supports adding/removing scenes, duration control, and prompt input.
 * Inspired by storyflow-lite design with timeline visualization.
 */

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { Button, Switch, Select } from 'tdesign-react';
import { AddIcon, DeleteIcon, TimeIcon, ChevronRightIcon } from 'tdesign-icons-react';
import type { StoryboardScene } from '../../../types/video.types';
import { createEmptyScene } from '../../../utils/storyboard-utils';
import { ScenePromptInput } from './ScenePromptInput';
import './StoryboardEditor.scss';

interface StoryboardEditorProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  totalDuration: number;
  maxScenes: number;
  minSceneDuration: number;
  scenes: StoryboardScene[];
  onScenesChange: (scenes: StoryboardScene[]) => void;
  disabled?: boolean;
}

export const StoryboardEditor: React.FC<StoryboardEditorProps> = ({
  enabled,
  onEnabledChange,
  totalDuration,
  maxScenes,
  minSceneDuration,
  scenes,
  onScenesChange,
  disabled = false,
}) => {
  // Selected scene state for expanded view
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const scenesEndRef = useRef<HTMLDivElement>(null);
  const sceneIdsSignature = scenes.map((scene) => scene.id).join('|');

  // Auto-select first scene when enabled
  useEffect(() => {
    if (!enabled || scenes.length === 0) {
      return;
    }

    const selectedSceneStillExists = selectedSceneId
      ? scenes.some((scene) => scene.id === selectedSceneId)
      : false;

    if (!selectedSceneStillExists && selectedSceneId !== scenes[0].id) {
      setSelectedSceneId(scenes[0].id);
    }
  }, [enabled, sceneIdsSignature, scenes, selectedSceneId]);

  // Handle adding a new scene - preserve existing durations, allocate from remaining time
  const handleAddScene = useCallback(() => {
    if (scenes.length >= maxScenes) return;

    // Calculate total used duration by existing scenes
    const usedDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
    const remainingDuration = totalDuration - usedDuration;

    // New scene gets half of remaining duration (minimum is minSceneDuration)
    let newSceneDuration = Math.max(minSceneDuration, remainingDuration / 2);
    // Round to 1 decimal place
    newSceneDuration = parseFloat(newSceneDuration.toFixed(1));

    // If not enough remaining time, use minimum duration
    if (newSceneDuration < minSceneDuration) {
      newSceneDuration = minSceneDuration;
    }

    // Add new scene with calculated duration (keep existing scenes unchanged)
    const newScene = createEmptyScene(scenes.length + 1, newSceneDuration);
    onScenesChange([...scenes, newScene]);

    // Auto-select new scene and scroll to it
    setSelectedSceneId(newScene.id);
    setTimeout(() => {
      scenesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, [scenes, maxScenes, totalDuration, minSceneDuration, onScenesChange]);

  // Handle removing a scene - preserve existing durations, only update order
  const handleRemoveScene = useCallback(
    (sceneId: string) => {
      if (scenes.length <= 1) return;

      const filteredScenes = scenes.filter(s => s.id !== sceneId);

      // Only update order, preserve existing durations
      const updatedScenes = filteredScenes.map((scene, index) => ({
        ...scene,
        order: index + 1,
      }));

      onScenesChange(updatedScenes);

      // Select previous or first scene
      if (selectedSceneId === sceneId) {
        setSelectedSceneId(updatedScenes[0]?.id || null);
      }
    },
    [scenes, onScenesChange, selectedSceneId]
  );

  // Calculate the maximum available duration for a specific scene
  const getMaxDurationForScene = useCallback(
    (sceneId: string) => {
      // Sum of all other scenes' durations
      const otherScenesDuration = scenes
        .filter(s => s.id !== sceneId)
        .reduce((sum, s) => sum + s.duration, 0);
      // Max available = total - others, but at least minSceneDuration
      return Math.max(minSceneDuration, totalDuration - otherScenesDuration);
    },
    [scenes, totalDuration, minSceneDuration]
  );

  // Generate duration options for a specific scene (respecting max available)
  // Use 0.1s step for full range
  const getDurationOptionsForScene = useCallback(
    (sceneId: string) => {
      const maxAvailable = getMaxDurationForScene(sceneId);
      const options = [];
      const step = 0.1;

      // Generate options from minSceneDuration to maxAvailable with 0.1s step
      for (let i = minSceneDuration; i <= maxAvailable + 0.001; i += step) {
        const value = parseFloat(i.toFixed(1));
        if (value <= maxAvailable) {
          options.push({
            label: `${value}`,
            value: value,
          });
        }
      }

      return options;
    },
    [minSceneDuration, getMaxDurationForScene]
  );

  // Handle scene duration change
  const handleDurationChange = useCallback(
    (sceneId: string, value: number | string) => {
      const newDuration = typeof value === 'string' ? parseFloat(value) : value;
      if (isNaN(newDuration)) return;

      // Calculate max available for this scene
      const maxAvailable = getMaxDurationForScene(sceneId);

      const updatedScenes = scenes.map(scene => {
        if (scene.id === sceneId) {
          // Clamp duration: min is minSceneDuration, max is maxAvailable
          const clampedDuration = Math.max(
            minSceneDuration,
            Math.min(newDuration, maxAvailable)
          );
          // Round to 1 decimal place for cleaner display
          const rounded = parseFloat(clampedDuration.toFixed(1));
          if (rounded === scene.duration) {
            return scene;
          }
          return { ...scene, duration: rounded };
        }
        return scene;
      });

      if (
        updatedScenes.every((scene, index) => scene === scenes[index])
      ) {
        return;
      }

      onScenesChange(updatedScenes);
    },
    [scenes, minSceneDuration, getMaxDurationForScene, onScenesChange]
  );

  // Handle scene prompt change
  const handlePromptChange = useCallback(
    (sceneId: string, newPrompt: string) => {
      const currentScene = scenes.find((scene) => scene.id === sceneId);
      if (currentScene?.prompt === newPrompt) {
        return;
      }

      const updatedScenes = scenes.map(scene => {
        if (scene.id === sceneId) {
          return { ...scene, prompt: newPrompt };
        }
        return scene;
      });
      onScenesChange(updatedScenes);
    },
    [scenes, onScenesChange]
  );

  // Handle toggle enabled
  const handleToggleEnabled = useCallback(
    (value: boolean) => {
      onEnabledChange(value);
      if (value && scenes.length === 0) {
        // Initialize with first scene when enabled
        const firstScene = createEmptyScene(1, totalDuration);
        onScenesChange([firstScene]);
        setSelectedSceneId(firstScene.id);
      }
    },
    [scenes, totalDuration, onEnabledChange, onScenesChange]
  );

  // Handle scene selection
  const handleSelectScene = useCallback((sceneId: string) => {
    setSelectedSceneId(sceneId);
  }, []);

  const canAddMore = scenes.length < maxScenes;

  return (
    <div className="storyboard-editor">
      {/* Toggle switch header */}
      <div className="storyboard-editor__header">
        <div className="storyboard-editor__toggle">
          <Switch
            value={enabled}
            onChange={handleToggleEnabled}
            disabled={disabled}
            size="small"
          />
          <div className="storyboard-editor__title">
            <span className="storyboard-editor__title-text">故事场景模式</span>
            <span className="storyboard-editor__title-desc">
              定义多个场景及其时长
            </span>
          </div>
        </div>
        {enabled && (
          <span className="storyboard-editor__new-badge">NEW</span>
        )}
      </div>

      {/* Scenes list */}
      {enabled && (
        <div className="storyboard-editor__content">
          {/* Section title */}
          <div className="storyboard-editor__section-header">
            <span className="storyboard-editor__section-title">场景列表</span>
            <span className="storyboard-editor__section-hint">
              共 {scenes.length} 个场景，已用 {scenes.reduce((sum, s) => sum + s.duration, 0).toFixed(1)} 秒 / 总时长 {totalDuration} 秒
            </span>
          </div>

          {/* Scene cards with timeline */}
          <div className="storyboard-editor__scenes">
            {scenes.map((scene, index) => {
              const isSelected = selectedSceneId === scene.id;
              const isLast = index === scenes.length - 1;

              return (
                <div
                  key={scene.id}
                  className={`storyboard-editor__scene-wrapper ${isSelected ? 'is-selected' : ''}`}
                >
                  {/* Timeline connector line */}
                  <div className={`storyboard-editor__timeline-line ${isLast ? 'is-last' : ''}`} />

                  {/* Timeline node */}
                  <div className={`storyboard-editor__timeline-node ${isSelected ? 'is-selected' : ''}`}>
                    {isSelected ? index + 1 : ''}
                  </div>

                  {/* Scene card - Compact view */}
                  {!isSelected && (
                    <div
                      className="storyboard-editor__scene storyboard-editor__scene--compact"
                      onClick={() => handleSelectScene(scene.id)}
                    >
                      <span className="storyboard-editor__scene-index">{index + 1}</span>
                      <div className="storyboard-editor__scene-preview">
                        <p className="storyboard-editor__scene-preview-text">
                          {scene.prompt || '暂无场景描述...'}
                        </p>
                      </div>
                      <div className="storyboard-editor__scene-duration-badge">
                        <TimeIcon size="12px" />
                        <span>{scene.duration}s</span>
                      </div>
                      <ChevronRightIcon className="storyboard-editor__scene-arrow" size="14px" />
                    </div>
                  )}

                  {/* Scene card - Expanded view */}
                  {isSelected && (
                    <div className="storyboard-editor__scene storyboard-editor__scene--expanded">
                      <div className="storyboard-editor__scene-header">
                        <div className="storyboard-editor__scene-info">
                          <span className="storyboard-editor__scene-label">
                            <span className="storyboard-editor__active-indicator" />
                            场景 {index + 1}
                          </span>
                        </div>
                        <div className="storyboard-editor__scene-controls">
                          <TimeIcon className="storyboard-editor__time-icon" />
                          <Select
                            value={parseFloat(scene.duration.toFixed(1))}
                            onChange={value => handleDurationChange(scene.id, value as number)}
                            disabled={disabled}
                            className="storyboard-editor__duration-select"
                            size="small"
                            options={getDurationOptionsForScene(scene.id)}
                            filterable
                            creatable
                            popupProps={{ overlayClassName: 'storyboard-editor__duration-popup' }}
                          />
                          {scenes.length > 1 && (
                            <Button
                              theme="default"
                              variant="text"
                              size="small"
                              icon={<DeleteIcon />}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveScene(scene.id);
                              }}
                              disabled={disabled}
                              className="storyboard-editor__scene-delete"
                            />
                          )}
                        </div>
                      </div>
                      <div className="storyboard-editor__scene-prompt">
                        <ScenePromptInput
                          value={scene.prompt}
                          onChange={value => handlePromptChange(scene.id, value)}
                          placeholder={`描述场景 ${index + 1} 的内容，输入 @ 可引用角色`}
                          disabled={disabled}
                          autoFocus={true}
                          enableMention={true}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={scenesEndRef} />
          </div>

          {/* Add scene button */}
          {canAddMore && (
            <Button
              theme="default"
              variant="dashed"
              size="medium"
              icon={<AddIcon />}
              onClick={handleAddScene}
              disabled={disabled}
              className="storyboard-editor__add-btn"
              block
            >
              添加场景
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default StoryboardEditor;
