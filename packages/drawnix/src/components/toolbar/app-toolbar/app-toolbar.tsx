import { useBoard } from '@plait-board/react-board';
import Stack from '../../stack';
import { ToolButton } from '../../tool-button';
import { MenuIcon, RedoIcon, UndoIcon } from '../../icons';
import classNames from 'classnames';
import { ATTACHED_ELEMENT_CLASS_NAME, PlaitBoard } from '@plait/core';
import { Island } from '../../island';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import { useState } from 'react';
import {
  CleanBoard,
  OpenFile,
  SaveAsImage,
  SaveToFile,
  Settings,
  BackupRestore,
  CloudSync,
  DebugPanel,
  QuickCommands,
  UserManual,
  VersionInfo,
  CleanInvalidLinks,
  WorkflowModeMenuItem,
} from './app-menu-items';
import { GithubIcon } from '../../icons';
import { LanguageSwitcherMenu } from './language-switcher-menu';
import Menu from '../../menu/menu';
import MenuSeparator from '../../menu/menu-separator';
import { useI18n } from '../../../i18n';
import { Z_INDEX } from '../../../constants/z-index';
import { ToolbarSectionProps } from '../toolbar.types';
import { useToolbarConfig } from '../../../hooks/use-toolbar-config';
import { ToolbarContextMenu } from '../toolbar-context-menu';

export interface AppToolbarProps extends ToolbarSectionProps {
  onOpenBackupRestore?: () => void;
  onOpenCloudSync?: () => void;
  onOpenWorkflowMode?: () => void;
}

export const AppToolbar: React.FC<AppToolbarProps> = ({
  embedded = false,
  iconMode = false,
  onOpenBackupRestore,
  onOpenCloudSync,
  onOpenWorkflowMode,
}) => {
  const board = useBoard();
  const { t } = useI18n();
  const { isButtonVisible, visibleButtons } = useToolbarConfig();
  const container = PlaitBoard.getBoardContainer(board);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const isUndoDisabled = board.history.undos.length <= 0;
  const isRedoDisabled = board.history.redos.length <= 0;

  // 检查撤销/重做按钮是否可见
  const showUndo = isButtonVisible('undo');
  const showRedo = isButtonVisible('redo');

  // 获取按钮在可见列表中的索引
  const undoVisibleIndex = visibleButtons.findIndex((btn) => btn.id === 'undo');
  const redoVisibleIndex = visibleButtons.findIndex((btn) => btn.id === 'redo');

  const content = (
    <Stack.Row gap={1}>
      <Popover
        key={0}
        sideOffset={12}
        open={appMenuOpen}
        onOpenChange={(open) => {
          setAppMenuOpen(open);
        }}
        placement={embedded ? 'right-start' : 'bottom-start'}
      >
        <PopoverTrigger asChild>
          <ToolButton
            type="icon"
            visible={true}
            selected={appMenuOpen}
            icon={<MenuIcon />}
            tooltip={appMenuOpen ? undefined : t('general.menu')}
            tooltipPlacement={embedded ? 'right' : 'bottom'}
            aria-label={t('general.menu')}
            data-track="toolbar_click_menu"
            onPointerDown={() => {
              setAppMenuOpen(!appMenuOpen);
            }}
          />
        </PopoverTrigger>
        <PopoverContent
          container={container}
          style={{ zIndex: Z_INDEX.POPOVER_APP }}
        >
          <Menu
            onSelect={() => {
              setAppMenuOpen(false);
            }}
            onClose={() => {
              setAppMenuOpen(false);
            }}
          >
            <OpenFile></OpenFile>
            <SaveToFile></SaveToFile>
            <SaveAsImage></SaveAsImage>
            <CleanBoard></CleanBoard>
            <CleanInvalidLinks></CleanInvalidLinks>
            <MenuSeparator />
            <LanguageSwitcherMenu />
            <BackupRestore
              onOpenBackupRestore={() => {
                setAppMenuOpen(false);
                onOpenBackupRestore?.();
              }}
            />
            <DebugPanel />
            <CloudSync
              onOpenCloudSync={() => {
                setAppMenuOpen(false);
                onOpenCloudSync?.();
              }}
            />
            <WorkflowModeMenuItem
              onOpenWorkflowMode={() => {
                setAppMenuOpen(false);
                onOpenWorkflowMode?.();
              }}
            />
            <Settings />
            <MenuSeparator />
            <QuickCommands />
            <UserManual />
            <VersionInfo />
          </Menu>
        </PopoverContent>
      </Popover>
      {showUndo && (
        <ToolbarContextMenu
          buttonId="undo"
          isVisible={true}
          visibleIndex={undoVisibleIndex}
        >
          <ToolButton
            key={1}
            type="icon"
            icon={<UndoIcon />}
            visible={true}
            tooltip={t('general.undo')}
            tooltipPlacement={embedded ? 'right' : 'bottom'}
            aria-label={t('general.undo')}
            data-track="toolbar_click_undo"
            onPointerUp={() => {
              board.undo();
            }}
            disabled={isUndoDisabled}
          />
        </ToolbarContextMenu>
      )}
      {showRedo && (
        <ToolbarContextMenu
          buttonId="redo"
          isVisible={true}
          visibleIndex={redoVisibleIndex}
        >
          <ToolButton
            key={2}
            type="icon"
            icon={<RedoIcon />}
            visible={true}
            tooltip={t('general.redo')}
            tooltipPlacement={embedded ? 'right' : 'bottom'}
            aria-label={t('general.redo')}
            data-track="toolbar_click_redo"
            onPointerUp={() => {
              board.redo();
            }}
            disabled={isRedoDisabled}
          />
        </ToolbarContextMenu>
      )}
    </Stack.Row>
  );
  if (embedded) {
    return (
      <div
        className={classNames('app-toolbar', {
          'app-toolbar--embedded': embedded,
          'app-toolbar--icon-only': iconMode,
        })}
      >
        {content}
        <ToolButton
          type="icon"
          icon={<GithubIcon />}
          visible={true}
          tooltip={t('menu.github')}
          tooltipPlacement="right"
          aria-label={t('menu.github')}
          data-track="toolbar_click_github"
          onPointerUp={() => {
            window.open('https://github.com/ljquan/aitu', '_blank');
          }}
        />
      </div>
    );
  }

  return (
    <Island
      padding={1}
      className={classNames('app-toolbar', ATTACHED_ELEMENT_CLASS_NAME, {
        'app-toolbar--embedded': embedded,
        'app-toolbar--icon-only': iconMode,
      })}
    >
      {content}
    </Island>
  );
};
