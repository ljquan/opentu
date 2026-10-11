import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceService } from '../workspace-service';
import type { Board, BoardChangeData } from '../../types/workspace.types';

const storage = vi.hoisted(() => ({ loadBoard: vi.fn(), saveBoard: vi.fn() }));
vi.mock('../workspace-storage-service', () => ({ workspaceStorageService: storage }));
vi.mock('../github-sync/sync-log-service', () => ({ logDebug: vi.fn(), logWarning: vi.fn(), logError: vi.fn() }));

const runtime = workspaceService as unknown as {
    initialized: boolean; loadedBoards: Map<string, Board>; boards: Map<string, Board>;
    boardMetadata: Map<string, Omit<Board, 'elements'>>; unsavedBoards: Map<string, object>;
    state: { currentBoardId: string | null };
};
const board = (id: string) => ({ id, name: id, elements: [{ id: `element-${id}` }], updatedAt: 1 } as unknown as Board);
beforeEach(() => {
    vi.clearAllMocks();
    runtime.initialized = true;
    runtime.loadedBoards.clear(); runtime.boards.clear(); runtime.boardMetadata.clear(); runtime.unsavedBoards.clear();
    runtime.state.currentBoardId = 'current';
    for (const id of ['current', 'a', 'b', 'c', 'd']) {
        const item = board(id);
        const { elements, ...metadata } = item;
        runtime.boardMetadata.set(id, metadata);
        runtime.boards.set(id, { ...metadata, elements: [] });
    }
    storage.loadBoard.mockImplementation(async id => board(id));
    storage.saveBoard.mockResolvedValue(undefined);
});

describe('workspace full-board retention', () => {
    it('reloads and empty checks share a bounded cache while retaining the current board', async () => {
        await workspaceService.reloadBoard('current');
        await workspaceService.reloadBoard('a');
        await workspaceService.reloadBoard('b');
        expect(await workspaceService.isBoardEmptyAsync('c')).toBe(false);
        await workspaceService.reloadBoard('d');
        expect(runtime.loadedBoards.size).toBe(3);
        expect(workspaceService.getBoard('current')?.elements).toHaveLength(1);
        expect(workspaceService.getBoard('a')?.elements).toEqual([]);
        expect(storage.loadBoard).toHaveBeenCalledWith('c');
    });

    it('a failed save retains unsaved content across subsequent cache pressure and a retry', async () => {
        await workspaceService.reloadBoard('a');
        storage.saveBoard.mockRejectedValueOnce(new Error('quota'));
        const data = { children: [{ id: 'unsaved' }], viewport: {}, theme: {} } as unknown as BoardChangeData;
        await expect(workspaceService.saveBoard('a', data)).rejects.toThrow('quota');
        for (const id of ['current', 'b', 'c', 'd']) await workspaceService.reloadBoard(id);
        expect(workspaceService.getBoard('a')?.elements).toEqual(data.children);
        await workspaceService.saveBoard('a', data);
        expect(runtime.unsavedBoards.has('a')).toBe(false);
        expect(runtime.loadedBoards.size).toBeLessThanOrEqual(3);
    });

    it('a successful explicit reload releases the discarded dirty board exemption', async () => {
        await workspaceService.reloadBoard('a');
        storage.saveBoard.mockRejectedValueOnce(new Error('quota'));
        await expect(workspaceService.saveBoard('a', { children: [{ id: 'unsaved' }] } as unknown as BoardChangeData)).rejects.toThrow('quota');
        storage.loadBoard.mockRejectedValueOnce(new Error('read failed'));
        await expect(workspaceService.reloadBoard('a')).rejects.toThrow('read failed');
        expect(runtime.unsavedBoards.has('a')).toBe(true);
        await workspaceService.reloadBoard('a');
        expect(runtime.unsavedBoards.has('a')).toBe(false);
        for (const id of ['current', 'b', 'c', 'd']) await workspaceService.reloadBoard(id);
        expect(runtime.loadedBoards.size).toBeLessThanOrEqual(3);
    });
});
