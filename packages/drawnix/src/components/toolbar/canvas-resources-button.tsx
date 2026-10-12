import React, { useId, useState } from 'react';
import { useBoard } from '@plait-board/react-board';
import { PlaitBoard } from '@plait/core';
import { ArrowUpRight, Download, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { ToolButton } from '../tool-button';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';
import './canvas-resources-button.scss';

// Keep this announcement ID fixed across future releases, including existing
// acknowledgements, so later app updates cannot trigger it again.
export const CANVAS_RESOURCES_ACK_KEY = 'opentu-canvas-resources-2026-10-seen';
let acknowledgedInSession = false;

function isAcknowledged(): boolean {
  if (acknowledgedInSession) return true;
  try {
    return window.localStorage.getItem(CANVAS_RESOURCES_ACK_KEY) === 'true';
  } catch {
    return false;
  }
}

function markAsShown(): void {
  try {
    window.localStorage.setItem(CANVAS_RESOURCES_ACK_KEY, 'true');
  } catch {
    acknowledgedInSession = true;
  }
}

export const CanvasResourcesButton: React.FC = () => {
  const board = useBoard();
  const { t } = useI18n();
  const titleId = useId();
  const [needsAcknowledgement, setNeedsAcknowledgement] = useState(
    () => !isAcknowledged()
  );
  const [open, setOpen] = useState(needsAcknowledgement);

  React.useEffect(() => {
    if (needsAcknowledgement) {
      // Record this announcement immediately, while keeping the panel open.
      markAsShown();
    }
  }, [needsAcknowledgement]);

  const close = () => {
    if (needsAcknowledgement) {
      setNeedsAcknowledgement(false);
    }
    setOpen(false);
  };

  return (
    <Popover
      placement="right-end"
      sideOffset={12}
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || !needsAcknowledgement) setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <ToolButton
          type="icon"
          icon={<Download size={20} />}
          className="canvas-resources-trigger"
          aria-label={t('resources.title')}
          tooltip={t('resources.title')}
          tooltipPlacement="right"
          selected={open}
          visible={true}
          data-testid="toolbar-resources"
          data-track="toolbar_click_resources"
          onPointerDown={({ event }) => event.stopPropagation()}
          onClick={() => (open ? close() : setOpen(true))}
        />
      </PopoverTrigger>
      <PopoverContent
        container={PlaitBoard.getBoardContainer(board)}
        className="canvas-resources"
        aria-labelledby={titleId}
        data-testid="canvas-resources"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="canvas-resources__header">
          <h2 id={titleId}>{t('resources.title')}</h2>
          <button
            type="button"
            className="canvas-resources__close"
            aria-label={t('resources.close')}
            title={t('resources.close')}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <a
          className="canvas-resources__link"
          href="https://aiw520.github.io/opentuAI/download.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="canvas-resources__icon canvas-resources__icon--download">
            <Download size={20} />
          </span>
          <span className="canvas-resources__text">
            <strong>{t('resources.download')}</strong>
            <span>{t('resources.downloadDescription')}</span>
          </span>
          <ArrowUpRight size={17} aria-hidden="true" />
        </a>
        <a
          className="canvas-resources__link"
          href="https://x.com/shuidiyuAI"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="canvas-resources__icon canvas-resources__icon--x" aria-hidden="true">X</span>
          <span className="canvas-resources__text">
            <strong>{t('resources.follow')}</strong>
            <span>{t('resources.followDescription')}</span>
          </span>
          <ArrowUpRight size={17} aria-hidden="true" />
        </a>
      </PopoverContent>
    </Popover>
  );
};
