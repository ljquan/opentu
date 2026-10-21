import './canvas-image-tools.scss';
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useState,
  type ReactNode,
  type ReactElement,
} from 'react';
import { Ellipsis } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import { ToolButton } from '../../tool-button';
import { ATTACHED_ELEMENT_CLASS_NAME } from '@plait/core';
import {
  IMAGE_TOOLBAR_PREFERENCES_EVENT,
  readImageToolbarPreferences,
} from '../../../utils/image-toolbar-preferences';
export { IMAGE_TOOLBAR_PREFERENCES_KEY } from '../../../utils/image-toolbar-preferences';

type ConfigurableTool = ReactElement<{
  className: string;
  'aria-label': string;
  showAriaLabel?: boolean;
}>;
export function ImageToolbarContents({
  enabled,
  children,
  container,
}: {
  enabled: boolean;
  children: ReactNode;
  container: HTMLElement;
}) {
  const [preferences, setPreferences] = useState(readImageToolbarPreferences);
  useEffect(() => {
    const sync = () => setPreferences(readImageToolbarPreferences());
    window.addEventListener(IMAGE_TOOLBAR_PREFERENCES_EVENT, sync);
    return () =>
      window.removeEventListener(IMAGE_TOOLBAR_PREFERENCES_EVENT, sync);
  }, []);
  const entries = Children.toArray(children);
  if (!enabled) return children;
  const tools = entries.filter(
    (child): child is ConfigurableTool =>
      isValidElement(child) &&
      child.type === ToolButton &&
      !!child.props.className
  );
  const isHidden = (tool: ConfigurableTool) =>
    preferences.hidden.includes(tool.props.className);
  return (
    <>
      {entries.map((child) => {
        if (
          !isValidElement(child) ||
          child.type !== ToolButton ||
          !child.props.className
        )
          return child;
        const tool = child as ConfigurableTool;
        return isHidden(tool)
          ? null
          : cloneElement(tool, { showAriaLabel: preferences.labels });
      })}
      {tools.some(isHidden) && (
        <Popover>
          <PopoverTrigger asChild>
            <ToolButton
              type="icon"
              visible
              aria-label="更多图片工具"
              tooltip="更多图片工具"
              icon={<Ellipsis size={16} />}
            />
          </PopoverTrigger>
          <PopoverContent
            container={container}
            className={ATTACHED_ELEMENT_CLASS_NAME}
          >
            <div className="image-toolbar-options">
              <strong>更多工具</strong>
              {tools
                .filter(isHidden)
                .map((tool) => cloneElement(tool, { showAriaLabel: true }))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
