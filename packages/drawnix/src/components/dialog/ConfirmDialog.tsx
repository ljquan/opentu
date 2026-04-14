import React from 'react';
import { Button } from 'tdesign-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeading,
} from './dialog';
import './ConfirmDialog.scss';

type ConfirmTheme = 'primary' | 'danger' | 'warning' | 'default';

interface ConfirmDialogFooterRenderProps {
  loading: boolean;
  handleConfirm: () => void;
  handleCancel: () => void;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  confirmText?: React.ReactNode;
  cancelText?: React.ReactNode;
  confirmTheme?: ConfirmTheme;
  danger?: boolean;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  confirmLoading?: boolean;
  footer?:
    | React.ReactNode
    | ((props: ConfirmDialogFooterRenderProps) => React.ReactNode);
  className?: string;
  container?: HTMLElement | null;
  closeOnConfirm?: boolean;
  closeOnCancel?: boolean;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  onOpenChange?: (open: boolean) => void;
}

export interface ConfirmDialogOptions
  extends Omit<
    ConfirmDialogProps,
    'open' | 'onConfirm' | 'onCancel' | 'onOpenChange'
  > {}

function joinClassName(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(' ');
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  children,
  confirmText = '确定',
  cancelText = '取消',
  confirmTheme = 'primary',
  danger = false,
  confirmDisabled = false,
  cancelDisabled = false,
  confirmLoading,
  footer,
  className,
  container,
  closeOnConfirm = true,
  closeOnCancel = true,
  onConfirm,
  onCancel,
  onOpenChange,
}) => {
  const [innerLoading, setInnerLoading] = React.useState(false);
  const skipNextCancelRef = React.useRef(false);
  const loading = confirmLoading ?? innerLoading;
  const resolvedConfirmTheme: ConfirmTheme = danger ? 'danger' : confirmTheme;

  React.useEffect(() => {
    if (!open) {
      setInnerLoading(false);
    }
  }, [open]);

  const requestClose = React.useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  const handleCancel = React.useCallback(() => {
    if (loading) {
      return;
    }

    skipNextCancelRef.current = true;
    onCancel?.();

    if (closeOnCancel) {
      requestClose();
    }
  }, [closeOnCancel, loading, onCancel, requestClose]);

  const handleConfirm = React.useCallback(async () => {
    if (loading || confirmDisabled) {
      return;
    }

    if (!onConfirm) {
      if (closeOnConfirm) {
        requestClose();
      }
      return;
    }

    const result = onConfirm();
    if (result && typeof (result as Promise<void>).then === 'function') {
      setInnerLoading(true);
      try {
        await result;
        if (closeOnConfirm) {
          requestClose();
        }
      } finally {
        setInnerLoading(false);
      }
      return;
    }

    if (closeOnConfirm) {
      requestClose();
    }
  }, [closeOnConfirm, confirmDisabled, loading, onConfirm, requestClose]);

  const handleDialogOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && open && !skipNextCancelRef.current) {
        onCancel?.();
      }
      skipNextCancelRef.current = false;
      onOpenChange?.(nextOpen);
    },
    [onCancel, onOpenChange, open]
  );

  const footerContent =
    typeof footer === 'function'
      ? footer({ loading, handleConfirm, handleCancel })
      : footer;

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        container={container ?? undefined}
        className={joinClassName('Dialog confirm-dialog', className)}
      >
        <DialogHeading className="confirm-dialog__title">{title}</DialogHeading>
        {description ? (
          <DialogDescription className="confirm-dialog__description">
            {description}
          </DialogDescription>
        ) : null}

        {children ? <div className="confirm-dialog__body">{children}</div> : null}

        <div className="confirm-dialog__footer">
          {footerContent ?? (
            <>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={cancelDisabled || loading}
              >
                {cancelText}
              </Button>
              <Button
                theme={resolvedConfirmTheme}
                onClick={() => {
                  void handleConfirm();
                }}
                loading={loading}
                disabled={confirmDisabled}
              >
                {confirmText}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export function useConfirmDialog(defaultOptions: Partial<ConfirmDialogOptions> = {}) {
  const [options, setOptions] = React.useState<ConfirmDialogOptions | null>(null);
  const resolverRef = React.useRef<((confirmed: boolean) => void) | null>(null);
  const defaultOptionsRef = React.useRef(defaultOptions);

  React.useEffect(() => {
    defaultOptionsRef.current = defaultOptions;
  }, [defaultOptions]);

  const resolveConfirm = React.useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  React.useEffect(() => {
    return () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    };
  }, []);

  const confirm = React.useCallback(
    (nextOptions: ConfirmDialogOptions) => {
      resolverRef.current?.(false);

      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setOptions({
          ...defaultOptionsRef.current,
          ...nextOptions,
        });
      });
    },
    []
  );

  const confirmDialog = options ? (
    <ConfirmDialog
      {...options}
      open={true}
      onConfirm={() => resolveConfirm(true)}
      onCancel={() => resolveConfirm(false)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resolveConfirm(false);
        }
      }}
    />
  ) : null;

  return {
    confirm,
    confirmDialog,
    closeConfirmDialog: () => resolveConfirm(false),
  };
}
