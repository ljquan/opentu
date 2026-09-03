/**
 * VendorTabPanel - 厂商标签面板
 *
 * 支持两列或三列布局：
 * - 两列：左侧标签栏 | 右侧内容区
 * - 三列：左侧标签栏 | 中间分类栏 | 右侧内容区
 *
 * 用于 ModelDropdown、ModelSelector 等组件的厂商分类展示
 */

import React, { useCallback } from 'react';
import { HoverTip } from './hover';
import './vendor-tab-panel.scss';

export interface VendorTab {
  id: string;
  label: string;
  count: number;
  icon?: React.ReactNode;
}

export interface VendorTabPanelProps {
  /** 第一列标签列表（供应商） */
  tabs: VendorTab[];
  /** 当前激活的第一列标签 */
  activeTab: string | null;
  /** 切换第一列标签回调 */
  onTabChange: (tabId: string) => void;
  /** 中间列标签列表（模型分类），不传则为两列布局 */
  middleTabs?: VendorTab[];
  /** 当前激活的中间列标签 */
  activeMiddleTab?: string | null;
  /** 切换中间列标签回调 */
  onMiddleTabChange?: (tabId: string) => void;
  /** 搜索关键词（非空时标签无激活态，点击清除搜索并切换） */
  searchQuery?: string;
  /** 右侧内容 */
  children: React.ReactNode;
  /** 紧凑模式（标签宽度缩小） */
  compact?: boolean;
  /** 第一列底部扩展区 */
  tabsFooter?: React.ReactNode;
}

export const VendorTabPanel: React.FC<VendorTabPanelProps> = ({
  tabs,
  activeTab,
  onTabChange,
  middleTabs,
  activeMiddleTab,
  onMiddleTabChange,
  searchQuery,
  children,
  compact = false,
  tabsFooter,
}) => {
  const isSearching = !!searchQuery?.trim();
  const hasMiddle = middleTabs && middleTabs.length > 0 && !isSearching;

  const handleTabClick = useCallback(
    (tabId: string) => {
      onTabChange(tabId);
    },
    [onTabChange]
  );

  const handleMiddleTabClick = useCallback(
    (tabId: string) => {
      onMiddleTabChange?.(tabId);
    },
    [onMiddleTabChange]
  );

  return (
    <div
      className={`vendor-tab-panel ${
        compact ? 'vendor-tab-panel--compact' : ''
      } ${hasMiddle ? 'vendor-tab-panel--three-col' : ''}`}
    >
      {!isSearching && (
        <div className="vendor-tab-panel__tabs">
          <div className="vendor-tab-panel__tabs-list">
            {tabs.map(({ id, label, count, icon }) => {
              const isActive = activeTab === id;
              return (
                <HoverTip key={id} content={label} showArrow={false}>
                  <button
                    className={`vendor-tab-panel__tab ${
                      isActive ? 'vendor-tab-panel__tab--active' : ''
                    }`}
                    onClick={() => handleTabClick(id)}
                    type="button"
                  >
                    {icon ? (
                      <span className="vendor-tab-panel__tab-icon">{icon}</span>
                    ) : null}
                    <span className="vendor-tab-panel__tab-label">{label}</span>
                    <span className="vendor-tab-panel__tab-count">{count}</span>
                  </button>
                </HoverTip>
              );
            })}
          </div>
          {tabsFooter ? (
            <div className="vendor-tab-panel__tabs-footer">{tabsFooter}</div>
          ) : null}
        </div>
      )}
      {hasMiddle && (
        <div className="vendor-tab-panel__middle-tabs">
          {middleTabs.map(({ id, label, count, icon }) => {
            const isActive = activeMiddleTab === id;
            return (
              <HoverTip key={id} content={label} showArrow={false}>
                <button
                  className={`vendor-tab-panel__tab ${
                    isActive ? 'vendor-tab-panel__tab--active' : ''
                  }`}
                  onClick={() => handleMiddleTabClick(id)}
                  type="button"
                >
                  {icon ? (
                    <span className="vendor-tab-panel__tab-icon">{icon}</span>
                  ) : null}
                  <span className="vendor-tab-panel__tab-label">{label}</span>
                  <span className="vendor-tab-panel__tab-count">{count}</span>
                </button>
              </HoverTip>
            );
          })}
        </div>
      )}
      <div className="vendor-tab-panel__content">{children}</div>
    </div>
  );
};
