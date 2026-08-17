import { useEffect, useRef, useState } from 'react';
import { useSharedTaskState } from '../../hooks/useTaskQueue';
import { taskQueueService } from '../../services/task-queue';
import type { TaskPetSettings } from '../../utils/settings-manager';
import {
  TaskPetCoordinator,
  type TaskPetPresentation,
} from './task-pet-coordinator';
import { speakTaskPetMessage } from './task-pet-speech';

const TERMINAL_AGGREGATION_WINDOW_MS = 500;
const TERMINAL_FEEDBACK_DURATION_MS = 3000;
const IDLE_PRESENTATION: TaskPetPresentation = {
  state: 'idle',
  message: '',
  activeCount: 0,
};

export function useTaskPetController(
  settings: TaskPetSettings
): TaskPetPresentation {
  const { enabled, speechEnabled, taskTypes } = settings;
  const { image, text, video } = taskTypes;
  const { tasks, isLoading } = useSharedTaskState();
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const [presentation, setPresentation] =
    useState<TaskPetPresentation>(IDLE_PRESENTATION);

  useEffect(() => {
    if (!enabled || isLoading || (!image && !text && !video)) {
      setPresentation(IDLE_PRESENTATION);
      return;
    }

    const coordinator = new TaskPetCoordinator({ image, text, video });
    let aggregateTimer: ReturnType<typeof setTimeout> | null = null;
    let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const publish = (next: TaskPetPresentation) => {
      if (disposed) return;
      setPresentation(next);
      if (speechEnabled && next.speechText) {
        speakTaskPetMessage(next.speechText);
      }
    };

    publish(coordinator.initialize(tasksRef.current));

    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        const result = coordinator.handleEvent(event);
        if (result.presentation) {
          if (feedbackTimer) {
            clearTimeout(feedbackTimer);
            feedbackTimer = null;
          }
          publish(result.presentation);
        }

        if (result.terminalPending && !aggregateTimer) {
          aggregateTimer = setTimeout(() => {
            aggregateTimer = null;
            const terminalPresentation = coordinator.flushTerminalAggregate();
            if (!terminalPresentation) return;
            publish(terminalPresentation);
            if (feedbackTimer) clearTimeout(feedbackTimer);
            feedbackTimer = setTimeout(() => {
              feedbackTimer = null;
              publish(coordinator.getCurrentPresentation());
            }, TERMINAL_FEEDBACK_DURATION_MS);
          }, TERMINAL_AGGREGATION_WINDOW_MS);
        }
      });

    return () => {
      disposed = true;
      subscription.unsubscribe();
      if (aggregateTimer) clearTimeout(aggregateTimer);
      if (feedbackTimer) clearTimeout(feedbackTimer);
      coordinator.clear();
    };
  }, [isLoading, enabled, image, speechEnabled, text, video]);

  return presentation;
}
