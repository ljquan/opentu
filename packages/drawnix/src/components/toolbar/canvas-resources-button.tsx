import React, { useState } from 'react';
import { useBoard } from '@plait-board/react-board';
import { PlaitBoard } from '@plait/core';
import { ArrowUpRight, Download } from 'lucide-react';
import { useI18n } from '../../i18n';
import { ToolButton } from '../tool-button';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import './canvas-resources-button.scss';

export const CanvasResourcesButton: React.FC = () => {
  const board = useBoard();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <ToolButton
        type="icon"
        icon={<Download size={20} />}
        className="canvas-resources-trigger"
        aria-label={t('resources.download')}
        tooltip={t('resources.download')}
        tooltipPlacement="right"
        selected={open}
        visible={true}
        data-testid="toolbar-resources"
        data-track="toolbar_click_resources"
        onPointerDown={({ event }) => event.stopPropagation()}
        onClick={() => setOpen(true)}
      />
      <ConfirmDialog
        open={open}
        className="canvas-download-dialog"
        title={
          <>
            <span className="canvas-download-dialog__icon" aria-hidden="true">
              <Download size={26} strokeWidth={1.8} />
            </span>
            {t('resources.download')}
          </>
        }
        description={
          <>
            <span className="canvas-download-dialog__subtitle">
              {t('resources.downloadIncluded')}
            </span>
            <span className="canvas-download-dialog__note">
              <ArrowUpRight size={17} aria-hidden="true" />
              <span>{t('resources.downloadConfirmation')}</span>
            </span>
          </>
        }
        confirmText={t('resources.confirmDownload')}
        cancelText={t('resources.cancel')}
        container={PlaitBoard.getBoardContainer(board)}
        onOpenChange={setOpen}
        onConfirm={() => {
          window.open(
            'https://tuziapi.github.io/tuzi-switch/#td-r0-downloads',
            '_blank',
            'noopener,noreferrer'
          );
        }}
      />
    </>
  );
};
