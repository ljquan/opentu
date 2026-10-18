import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, MouseEvent } from 'react';
import type { Placement } from '@floating-ui/react';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import { composeHoverHandler, hasUsableHoverContent } from './hover-utils';

export interface HoverCardProps {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: Placement;
  sideOffset?: number;
  crossAxisOffset?: number;
  contentClassName?: string;
  contentStyle?: CSSProperties;
  container?: HTMLElement | null;
  openDelay?: number;
  closeDelay?: number;
  disabled?: boolean;
  /** Disable focus transfer for previews shown while editing text. */
  autoFocus?: boolean;
}

export function HoverCard({
  content,
  children,
  placement = 'bottom',
  sideOffset = 8,
  crossAxisOffset = 0,
  contentClassName,
  contentStyle,
  container,
  openDelay = 40,
  closeDelay = 100,
  disabled = false,
  autoFocus = true,
}: HoverCardProps) {
  const [open, setOpen] = useState(false);
  const openTimeoutRef = useRef<number | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimeoutRef.current !== null) {
      window.clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    if (disabled || !hasUsableHoverContent(content)) {
      return;
    }

    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (openTimeoutRef.current !== null) {
      return;
    }

    openTimeoutRef.current = window.setTimeout(() => {
      setOpen(true);
      openTimeoutRef.current = null;
    }, openDelay);
  }, [content, disabled, openDelay]);

  const scheduleClose = useCallback(() => {
    if (openTimeoutRef.current !== null) {
      window.clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }

    closeTimeoutRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimeoutRef.current = null;
    }, closeDelay);
  }, [closeDelay]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  if (disabled || !hasUsableHoverContent(content)) {
    return children;
  }

  const childProps = children.props as {
    onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
    onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
    onFocus?: (event: FocusEvent<HTMLElement>) => void;
    onBlur?: (event: FocusEvent<HTMLElement>) => void;
  };

  const openFromMouse = (_event: MouseEvent<HTMLElement>) => {
    scheduleOpen();
  };

  const closeFromMouse = (_event: MouseEvent<HTMLElement>) => {
    scheduleClose();
  };

  const openFromFocus = (_event: FocusEvent<HTMLElement>) => {
    scheduleOpen();
  };

  const closeFromBlur = (_event: FocusEvent<HTMLElement>) => {
    scheduleClose();
  };

  const child = React.cloneElement(children, {
    onMouseEnter: composeHoverHandler(childProps.onMouseEnter, openFromMouse),
    onMouseLeave: composeHoverHandler(childProps.onMouseLeave, closeFromMouse),
    onFocus: composeHoverHandler(childProps.onFocus, openFromFocus),
    onBlur: composeHoverHandler(childProps.onBlur, closeFromBlur),
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
        initialFocus={autoFocus ? undefined : -1}
        container={container}
        className={contentClassName}
        style={contentStyle}
        onMouseEnter={openFromMouse}
        onMouseLeave={closeFromMouse}
        onFocus={openFromFocus}
        onBlur={closeFromBlur}
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

export default HoverCard;
