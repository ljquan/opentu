import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Placement } from '@floating-ui/react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../popover/popover';

interface HoverPopoverProps {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: Placement;
  sideOffset?: number;
  crossAxisOffset?: number;
  contentClassName?: string;
  closeDelay?: number;
}

function composeHandler<E>(
  original: ((event: E) => void) | undefined,
  next: (event: E) => void
) {
  return (event: E) => {
    original?.(event);
    next(event);
  };
}

export const HoverPopover: React.FC<HoverPopoverProps> = ({
  content,
  children,
  placement = 'bottom',
  sideOffset = 8,
  crossAxisOffset = 0,
  contentClassName,
  closeDelay = 100,
}) => {
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const openPopover = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const closePopover = useCallback(() => {
    clearCloseTimer();
    closeTimeoutRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimeoutRef.current = null;
    }, closeDelay);
  }, [clearCloseTimer, closeDelay]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const child = React.cloneElement(children, {
    onMouseEnter: composeHandler(children.props.onMouseEnter, openPopover),
    onMouseLeave: composeHandler(children.props.onMouseLeave, closePopover),
  });

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement={placement}
      sideOffset={sideOffset}
      crossAxisOffset={crossAxisOffset}
    >
      <PopoverTrigger asChild>{child}</PopoverTrigger>
      <PopoverContent
        className={contentClassName || 'viewer-popover'}
        onMouseEnter={openPopover}
        onMouseLeave={closePopover}
      >
        {content}
      </PopoverContent>
    </Popover>
  );
};

export default HoverPopover;
