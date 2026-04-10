import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface KeyboardDropdownRenderProps {
  isOpen: boolean;
  setIsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  menuRef: React.RefObject<HTMLDivElement>;
  portalPosition: { top: number; left: number; width: number; bottom: number };
  handleTriggerKeyDown: (event: React.KeyboardEvent) => void;
}

export interface KeyboardDropdownProps {
  isOpen: boolean;
  setIsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  disabled?: boolean;
  openKeys?: string[];
  onOpenKey?: (key: string) => boolean;
  trackPosition?: boolean;
  children: (props: KeyboardDropdownRenderProps) => React.ReactNode;
}

const INPUT_TEXTAREA_CLASS = 'ai-input-bar__input';

function isComposingEvent(
  event: Pick<KeyboardEvent, 'isComposing'> & { keyCode?: number }
): boolean {
  return event.isComposing || event.keyCode === 229;
}

export const KeyboardDropdown: React.FC<KeyboardDropdownProps> = ({
  isOpen,
  setIsOpen,
  disabled = false,
  openKeys = [],
  onOpenKey,
  trackPosition = true,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [portalPosition, setPortalPosition] = useState({ top: 0, left: 0, width: 0, bottom: 0 });

  const handleTriggerKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (isComposingEvent(event.nativeEvent)) {
      return;
    }

    if (isOpen) {
      if (!onOpenKey) return;
      const handled = onOpenKey(event.key);
      if (handled) {
        event.preventDefault();
      }
      return;
    }

    if (openKeys.includes(event.key)) {
      event.preventDefault();
      if (!disabled) {
        setIsOpen(true);
      }
    }
  }, [isOpen, onOpenKey, openKeys, disabled, setIsOpen]);

  // 菜单打开时，全局监听键盘事件（支持保持输入框焦点）
  useEffect(() => {
    if (!isOpen || !onOpenKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isComposingEvent(event)) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isInputTextarea = !!target?.classList?.contains(INPUT_TEXTAREA_CLASS);
      if (event.defaultPrevented && !isInputTextarea) return;
      const handled = onOpenKey(event.key);
      if (handled) {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onOpenKey]);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, setIsOpen]);

  // 计算菜单位置（仅当使用 Portal 时）
  useLayoutEffect(() => {
    if (!trackPosition || !isOpen) return;
    const updatePosition = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setPortalPosition({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        bottom: rect.bottom
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, trackPosition]);

  return (
    <>
      {children({
        isOpen,
        setIsOpen,
        containerRef,
        menuRef,
        portalPosition,
        handleTriggerKeyDown
      })}
    </>
  );
};

export default KeyboardDropdown;
