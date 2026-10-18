import * as React from 'react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  useMergeRefs,
  Placement,
  FloatingPortal,
  FloatingFocusManager,
} from '@floating-ui/react';

interface PopoverOptions {
  initialOpen?: boolean;
  placement?: Placement;
  modal?: boolean;
  open?: boolean;
  sideOffset?: number;
  crossAxisOffset?: number;
  onOpenChange?: (open: boolean) => void;
}

export function usePopover({
  initialOpen = false,
  placement = 'bottom',
  modal,
  sideOffset,
  crossAxisOffset,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: PopoverOptions = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(initialOpen);
  const [labelId, setLabelId] = React.useState<string | undefined>();
  const [descriptionId, setDescriptionId] = React.useState<
    string | undefined
  >();

  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = setControlledOpen ?? setUncontrolledOpen;

  const data = useFloating({
    placement,
    open,
    onOpenChange: setOpen,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset({
        mainAxis: sideOffset || 4,
        crossAxis: crossAxisOffset || 0,
      }),
      flip({
        crossAxis: placement.includes('-'),
        fallbackAxisSideDirection: 'end',
        padding: 5,
      }),
      shift({ padding: 5 }),
    ],
  });

  const context = data.context;

  const click = useClick(context, {
    enabled: controlledOpen == null,
  });
  const dismiss = useDismiss(context, {
    // 自定义外部点击判断，排除 TDesign Dialog 和其他弹出层
    outsidePress: (event) => {
      const target = event.target as HTMLElement;
      // 检查点击目标是否在 TDesign Dialog 内部
      // TDesign Dialog 使用多层包装结构，需要检查所有可能的类名
      // 也排除素材库弹窗（.media-library-modal）和 Plait 附属元素
      // 以及 ReferenceImageUpload 组件内部的按钮
      const isInAttachedElement = target.closest('.plait-board-attached') ||
                                  target.closest('.t-dialog__ctx') ||
                                  target.closest('.t-dialog') ||
                                  target.closest('.t-dialog__wrap') ||
                                  target.closest('.t-dialog__position') ||
                                  target.closest('.t-dialog__modal') ||
                                  target.closest('.t-popup') ||
                                  target.closest('.t-drawer') ||
                                  target.closest('.media-library-modal') ||
                                  target.closest('.reference-image-upload') ||
                                  target.closest('.fill-panel') ||
                                  target.closest('[class*="t-dialog"]');

      // 额外检查：如果文档中有打开的 TDesign Dialog，也不关闭 Popover
      // 这是为了处理事件目标不在 Dialog DOM 树中但 Dialog 实际可见的情况
      const hasOpenDialog = document.querySelector('.t-dialog__ctx') !== null ||
                            document.querySelector('.media-library-modal') !== null;

      // 如果点击在附属元素或弹出层内部，或有打开的弹窗，不关闭 Popover
      return !isInAttachedElement && !hasOpenDialog;
    },
  });
  const role = useRole(context);

  const interactions = useInteractions([click, dismiss, role]);

  return React.useMemo(
    () => ({
      open,
      setOpen,
      ...interactions,
      ...data,
      modal,
      labelId,
      descriptionId,
      setLabelId,
      setDescriptionId,
    }),
    [open, setOpen, interactions, data, modal, labelId, descriptionId]
  );
}

type ContextType =
  | (ReturnType<typeof usePopover> & {
      setLabelId: React.Dispatch<React.SetStateAction<string | undefined>>;
      setDescriptionId: React.Dispatch<
        React.SetStateAction<string | undefined>
      >;
    })
  | null;

const PopoverContext = React.createContext<ContextType>(null);

export const usePopoverContext = () => {
  const context = React.useContext(PopoverContext);

  if (context == null) {
    throw new Error('Popover components must be wrapped in <Popover />');
  }

  return context;
};

export function Popover({
  children,
  modal = false,
  ...restOptions
}: {
  children: React.ReactNode;
} & PopoverOptions) {
  // This can accept any props as options, e.g. `placement`,
  // or other positioning options.
  const popover = usePopover({ modal, ...restOptions });
  return (
    <PopoverContext.Provider value={popover}>
      {children}
    </PopoverContext.Provider>
  );
}

interface PopoverTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

export const PopoverTrigger = React.forwardRef<
  HTMLElement,
  React.HTMLProps<HTMLElement> & PopoverTriggerProps
>(function PopoverTrigger({ children, asChild = false, ...props }, propRef) {
  const context = usePopoverContext();
  const childrenRef = (children as React.ReactElement & { ref?: React.Ref<HTMLElement> }).ref;
  const ref = useMergeRefs([context.refs.setReference, propRef, childrenRef]);

  // `asChild` allows the user to pass any element as the anchor
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(
      children,
      context.getReferenceProps({
        ref,
        ...props,
        ...children.props,
        'data-state': context.open ? 'open' : 'closed',
      })
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      // The user can style the trigger based on the state
      data-state={context.open ? 'open' : 'closed'}
      {...context.getReferenceProps(props)}
    >
      {children}
    </button>
  );
});

export const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLProps<HTMLDivElement> & {
    container?: HTMLElement | null;
    initialFocus?: number;
  }
>(function PopoverContent({ container, style, initialFocus, ...props }, propRef) {
  const { context: floatingContext, ...context } = usePopoverContext();
  const ref = useMergeRefs([context.refs.setFloating, propRef]);

  if (!floatingContext.open) return null;

  return (
    <FloatingPortal root={container}>
      <FloatingFocusManager
        context={floatingContext}
        modal={context.modal}
        initialFocus={initialFocus}
      >
        <div
          ref={ref}
          style={{ ...context.floatingStyles, ...style, zIndex: 5000 }}
          aria-labelledby={context.labelId}
          aria-describedby={context.descriptionId}
          {...context.getFloatingProps(props)}
        >
          {props.children}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
});
