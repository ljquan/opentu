/**
 * CharacterList Component
 *
 * Displays a list of characters with management capabilities.
 * Supports filtering by status and provides delete functionality.
 */

import React, { useCallback } from 'react';
import { Button, MessagePlugin, Loading } from 'tdesign-react';
import { RefreshIcon, UserAddIcon } from 'tdesign-icons-react';
import { CharacterCard } from './CharacterCard';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { useCharacters } from '../../hooks/useCharacters';
import type { SoraCharacter } from '../../types/character.types';
import './character.scss';

export interface CharacterListProps {
  /** Callback when a character is selected */
  onSelect?: (character: SoraCharacter) => void;
  /** Whether to show completed characters only */
  completedOnly?: boolean;
  /** Maximum number of characters to display */
  maxItems?: number;
  /** Whether to show the header with title and actions */
  showHeader?: boolean;
  /** Custom title */
  title?: string;
}

/**
 * CharacterList component - displays all characters
 */
export const CharacterList: React.FC<CharacterListProps> = ({
  onSelect,
  completedOnly = false,
  maxItems,
  showHeader = true,
  title = '角色列表',
}) => {
  const {
    characters,
    completedCharacters,
    pendingCharacters,
    isLoading,
    deleteCharacter,
    refreshCharacters,
  } = useCharacters();

  const [deleteConfirmId, setDeleteConfirmId] = React.useState<string | null>(null);

  // Get characters to display
  const displayCharacters = React.useMemo(() => {
    let list = completedOnly ? completedCharacters : characters;
    // Sort by creation time (newest first)
    list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    if (maxItems && list.length > maxItems) {
      list = list.slice(0, maxItems);
    }
    return list;
  }, [completedOnly, characters, completedCharacters, maxItems]);

  // Handle delete confirmation
  const handleDeleteClick = useCallback((id: string) => {
    setDeleteConfirmId(id);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirmId) return;

    const success = await deleteCharacter(deleteConfirmId);
    if (success) {
      MessagePlugin.success('角色已删除');
    } else {
      MessagePlugin.error('删除失败');
    }
    setDeleteConfirmId(null);
  }, [deleteConfirmId, deleteCharacter]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    await refreshCharacters();
    MessagePlugin.success('已刷新');
  }, [refreshCharacters]);

  // Loading state
  if (isLoading) {
    return (
      <div className="character-list__loading">
        <Loading size="small" />
        <span>加载中...</span>
      </div>
    );
  }

  // Empty state
  if (displayCharacters.length === 0) {
    return (
      <div className="character-list">
        {showHeader && (
          <div className="character-list__header">
            <h4>{title}</h4>
            <Button
              size="small"
              variant="text"
              icon={<RefreshIcon />}
              data-track="character_click_refresh"
              onClick={handleRefresh}
            />
          </div>
        )}
        <div className="character-list__empty">
          <div className="character-list__empty-icon">
            <UserAddIcon />
          </div>
          <div>暂无角色</div>
          <div style={{ fontSize: '12px', marginTop: '4px', color: '#999' }}>
            从已完成的 Sora-2 视频中提取角色
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="character-list">
      {showHeader && (
        <div className="character-list__header">
          <h4>
            {title}
            {pendingCharacters.length > 0 && (
              <span style={{ fontWeight: 'normal', fontSize: '12px', color: '#666', marginLeft: '8px' }}>
                ({pendingCharacters.length} 创建中)
              </span>
            )}
          </h4>
          <Button
            size="small"
            variant="text"
            icon={<RefreshIcon />}
            data-track="character_click_refresh"
            onClick={handleRefresh}
          />
        </div>
      )}

      <div className="character-list__items">
        {displayCharacters.map((character) => (
          <CharacterCard
            key={character.id}
            character={character}
            onDelete={handleDeleteClick}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteConfirmId}
        title="确认删除"
        description="确定要删除此角色吗？删除后将无法在提示词中使用该角色。"
        confirmText="删除"
        cancelText="取消"
        danger
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirmId(null);
          }
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
};

export default CharacterList;
