/**
 * Chat Storage Service
 *
 * Handles persistence of chat sessions and messages using IndexedDB via localforage.
 */

import localforage from 'localforage';
import { generateUUID } from '../utils/runtime-helpers';
import { CHAT_STORAGE_KEYS, CHAT_CONSTANTS } from '../constants/CHAT_CONSTANTS';
import type {
  ChatSession,
  ChatMessage,
  DrawerState,
} from '../types/chat.types';

// Initialize localforage instances
const sessionsStore = localforage.createInstance({
  name: CHAT_STORAGE_KEYS.DATABASE_NAME,
  storeName: CHAT_STORAGE_KEYS.SESSIONS_STORE,
});

const messagesStore = localforage.createInstance({
  name: CHAT_STORAGE_KEYS.DATABASE_NAME,
  storeName: CHAT_STORAGE_KEYS.MESSAGES_STORE,
});

/** Generate UUID v4 */
function generateId(): string {
  return generateUUID();
}

/** Generate session title from first message */
function generateTitle(content: string): string {
  const cleaned = content.trim().replace(/\n/g, ' ');
  if (cleaned.length <= CHAT_CONSTANTS.MAX_TITLE_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, CHAT_CONSTANTS.MAX_TITLE_LENGTH - 3) + '...';
}

// ============================================================================
// Session Operations
// ============================================================================

export async function createSession(): Promise<ChatSession> {
  const now = Date.now();
  const session: ChatSession = {
    id: generateId(),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };

  await sessionsStore.setItem(session.id, session);
  return session;
}

export async function getSession(id: string): Promise<ChatSession | null> {
  return sessionsStore.getItem<ChatSession>(id);
}

export async function getAllSessions(): Promise<ChatSession[]> {
  const sessions: ChatSession[] = [];
  await sessionsStore.iterate<ChatSession, void>((value) => {
    sessions.push(value);
  });
  // Wait for browser idle time before sorting to avoid blocking
  await new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as Window).requestIdleCallback(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
  // Sort by updatedAt descending (newest first)
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateSession(
  id: string,
  updates: Partial<ChatSession>
): Promise<void> {
  const session = await getSession(id);
  if (session) {
    const updated = { ...session, ...updates, updatedAt: Date.now() };
    await sessionsStore.setItem(id, updated);
  }
}

export async function deleteSession(id: string): Promise<void> {
  // Delete all messages in the session first
  const messages = await getMessages(id);
  for (const message of messages) {
    await messagesStore.removeItem(message.id);
  }
  // Then delete the session
  await sessionsStore.removeItem(id);
}

// ============================================================================
// Message Operations
// ============================================================================

export async function addMessage(message: ChatMessage): Promise<void> {
  await messagesStore.setItem(message.id, message);

  // Update session message count and title if this is the first user message
  const session = await getSession(message.sessionId);
  if (session) {
    const updates: Partial<ChatSession> = {
      messageCount: session.messageCount + 1,
      updatedAt: Date.now(),
    };

    await updateSession(message.sessionId, updates);
  }
}

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  await messagesStore.iterate<ChatMessage, void>((value) => {
    if (value.sessionId === sessionId) {
      messages.push(value);
    }
  });
  // Sort by timestamp ascending (oldest first)
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

export async function updateMessage(
  id: string,
  updates: Partial<ChatMessage>
): Promise<void> {
  const message = await messagesStore.getItem<ChatMessage>(id);
  if (message) {
    const updated = { ...message, ...updates };
    await messagesStore.setItem(id, updated);
  }
}

export async function deleteMessage(id: string): Promise<void> {
  const message = await messagesStore.getItem<ChatMessage>(id);
  if (message) {
    await messagesStore.removeItem(id);
    // Update session message count
    const session = await getSession(message.sessionId);
    if (session) {
      await updateSession(message.sessionId, {
        messageCount: Math.max(0, session.messageCount - 1),
      });
    }
  }
}

// ============================================================================
// Drawer State Operations (localStorage for sync access)
// ============================================================================

const DEFAULT_DRAWER_STATE: DrawerState = {
  isOpen: false,
  width: Math.min(
    CHAT_CONSTANTS.DRAWER_MAX_WIDTH,
    Math.max(
      CHAT_CONSTANTS.DRAWER_MIN_WIDTH,
      window.innerWidth * CHAT_CONSTANTS.DRAWER_DEFAULT_WIDTH_RATIO
    )
  ),
  activeSessionId: null,
};

export function getDrawerState(): DrawerState {
  try {
    const stored = localStorage.getItem(CHAT_STORAGE_KEYS.DRAWER_STATE);
    if (stored) {
      return { ...DEFAULT_DRAWER_STATE, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error('[ChatStorage] Failed to get drawer state:', error);
  }
  return DEFAULT_DRAWER_STATE;
}

export function setDrawerState(state: Partial<DrawerState>): void {
  try {
    const current = getDrawerState();
    const updated = { ...current, ...state };
    localStorage.setItem(
      CHAT_STORAGE_KEYS.DRAWER_STATE,
      JSON.stringify(updated)
    );
  } catch (error) {
    console.error('[ChatStorage] Failed to set drawer state:', error);
  }
}

// ============================================================================
// Cleanup Operations
// ============================================================================

export async function clearAllData(): Promise<void> {
  await sessionsStore.clear();
  await messagesStore.clear();
  localStorage.removeItem(CHAT_STORAGE_KEYS.DRAWER_STATE);
}

export async function clearConversationHistory(): Promise<void> {
  await sessionsStore.clear();
  await messagesStore.clear();
  setDrawerState({ activeSessionId: null });
}

// ============================================================================
// Utility Functions
// ============================================================================

export { generateId, generateTitle };

// Export as service object for easier mocking
export const chatStorageService = {
  createSession,
  getSession,
  getAllSessions,
  updateSession,
  deleteSession,
  addMessage,
  getMessages,
  updateMessage,
  deleteMessage,
  getDrawerState,
  setDrawerState,
  clearAllData,
  clearConversationHistory,
  generateId,
  generateTitle,
};
