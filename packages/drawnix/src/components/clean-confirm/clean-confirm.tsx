import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { useDrawnix } from '../../hooks/use-drawnix';
import { useBoard } from '@plait-board/react-board';
import { useI18n } from '../../i18n';

export const CleanConfirm = ({
  container,
}: {
  container: HTMLElement | null;
}) => {
  const { appState, setAppState } = useDrawnix();
  const { t } = useI18n();
  const board = useBoard();
  return (
    <ConfirmDialog
      open={appState.openCleanConfirm}
      container={container}
      title={t('cleanConfirm.title')}
      description={t('cleanConfirm.description')}
      confirmText={t('cleanConfirm.ok')}
      cancelText={t('cleanConfirm.cancel')}
      danger
      onOpenChange={(open) => {
        setAppState({ ...appState, openCleanConfirm: open });
      }}
      onConfirm={() => {
        board.deleteFragment(board.children);
      }}
    />
  );
};
