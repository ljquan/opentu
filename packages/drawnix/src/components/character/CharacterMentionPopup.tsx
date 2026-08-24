/**
 * CharacterMentionPopup Component
 *
 * Popup for selecting characters when user types @ in the prompt input.
 * Shows filtered list of completed characters based on search query.
 */

import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import { useCharacters } from '../../hooks/useCharacters';
import { analytics } from '../../utils/umami-analytics';
import type { SoraCharacter } from '../../types/character.types';
import { CharacterAvatar } from './CharacterAvatar';
import { Z_INDEX } from '../../constants/z-index';
import './character.scss';

export interface CharacterMentionPopupProps {
  /** Whether the popup is visible */
  visible: boolean;
  /** Search query (characters after @) */
  query: string;
  /** Position of the popup (cursor position) */
  position: { top: number; left: number };
  /** Whether to show popup below cursor instead of above */
  showBelow?: boolean;
  /** Index of currently selected item */
  selectedIndex: number;
  /** Callback when a character is selected */
  onSelect: (character: SoraCharacter) => void;
  /** Callback when popup should close */
  onClose: () => void;
}

/**
 * CharacterMentionPopup component - autocomplete for @ mentions
 */
export const CharacterMentionPopup: React.FC<CharacterMentionPopupProps> = ({
  visible,
  query,
  position,
  showBelow = false,
  selectedIndex,
  onSelect,
  onClose,
}) => {
  const { completedCharacters, isLoading } = useCharacters();
  const popupRef = useRef<HTMLDivElement>(null);

  // Filter characters by query
  const filteredCharacters = useMemo(() => {
    if (!query) return completedCharacters;
    const lowerQuery = query.toLowerCase();
    return completedCharacters.filter((c) =>
      c.username.toLowerCase().includes(lowerQuery)
    );
  }, [completedCharacters, query]);

  // Scroll selected item into view
  useEffect(() => {
    if (!visible || !popupRef.current) return;
    const selectedElement = popupRef.current.querySelector(
      '.character-mention-popup__item--selected'
    );
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }, [visible, selectedIndex]);

  // Handle click outside
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [visible, onClose]);

  // Handle character click
  const handleCharacterClick = useCallback(
    (character: SoraCharacter) => {
      // 埋点：角色在提示词中使用
      analytics.track('character_used_in_prompt', {
        characterId: character.id,
        username: character.username,
      });
      onSelect(character);
    },
    [onSelect]
  );

  if (!visible) return null;

  // Popup style - positioned at cursor, above or below based on available space
  const popupStyle: React.CSSProperties = {
    position: 'fixed',
    top: position.top,
    left: position.left,
    transform: showBelow ? 'none' : 'translateY(-100%)',
    zIndex: Z_INDEX.DROPDOWN_PORTAL,
    maxHeight: '200px',
    overflowY: 'auto',
  };

  if (isLoading) {
    return (
      <div
        ref={popupRef}
        className="character-mention-popup"
        style={popupStyle}
      >
        <div className="character-mention-popup__empty">加载中...</div>
      </div>
    );
  }

  if (filteredCharacters.length === 0) {
    return (
      <div
        ref={popupRef}
        className="character-mention-popup"
        style={popupStyle}
      >
        <div className="character-mention-popup__empty">
          {query ? `未找到 "${query}" 相关角色` : '暂无可用角色'}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={popupRef}
      className="character-mention-popup"
      style={popupStyle}
    >
      {filteredCharacters.map((character, index) => (
        <div
          key={character.id}
          className={`character-mention-popup__item ${index === selectedIndex ? 'character-mention-popup__item--selected' : ''}`}
          onClick={() => handleCharacterClick(character)}
          data-track="character_click_mention"
        >
          <div className="character-mention-popup__item-avatar">
            <CharacterAvatar
              characterId={character.id}
              profilePictureUrl={character.profilePictureUrl}
              alt={character.username}
            />
          </div>
          <span className="character-mention-popup__item-name">
            @{character.username}
          </span>
        </div>
      ))}
    </div>
  );
};

export default CharacterMentionPopup;
