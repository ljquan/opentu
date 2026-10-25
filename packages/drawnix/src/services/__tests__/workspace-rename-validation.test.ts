/**
 * Workspace Rename Validation Tests
 * 工作区重命名验证测试
 */

import { workspaceService } from '../workspace-service';
import {
  ValidationError,
  WORKSPACE_DEFAULTS,
} from '../../types/workspace.types';

describe('Workspace Rename Validation', () => {
  beforeEach(async () => {
    // 初始化工作区
    await workspaceService.initialize();
  });

  describe('Board Rename Validation', () => {
    it('应该拒绝空名称', async () => {
      const board = await workspaceService.createBoard({ name: '测试画板' });

      await expect(workspaceService.renameBoard(board.id, '')).rejects.toThrow(
        ValidationError
      );

      await expect(
        workspaceService.renameBoard(board.id, '   ')
      ).rejects.toThrow('画板名称不能为空');
    });

    it('应该拒绝过长名称', async () => {
      const board = await workspaceService.createBoard({ name: '测试画板' });
      const longName = 'a'.repeat(101);

      await expect(
        workspaceService.renameBoard(board.id, longName)
      ).rejects.toThrow('不能超过100个字符');
    });

    it('应该拒绝同级重名（根目录）', async () => {
      await workspaceService.createBoard({ name: '设计稿', folderId: null });
      const board2 = await workspaceService.createBoard({
        name: '其他画板',
        folderId: null,
      });

      await expect(
        workspaceService.renameBoard(board2.id, '设计稿')
      ).rejects.toThrow(/同名画板/);
    });

    it('应该拒绝同级重名（同一文件夹内）', async () => {
      const folder = await workspaceService.createFolder({ name: '项目A' });

      await workspaceService.createBoard({
        name: '设计稿',
        folderId: folder.id,
      });
      const board2 = await workspaceService.createBoard({
        name: '其他画板',
        folderId: folder.id,
      });

      await expect(
        workspaceService.renameBoard(board2.id, '设计稿')
      ).rejects.toThrow(/同名画板/);
    });

    it('应该允许不同文件夹同名', async () => {
      const folder1 = await workspaceService.createFolder({ name: '项目A' });
      const folder2 = await workspaceService.createFolder({ name: '项目B' });

      await workspaceService.createBoard({
        name: '设计稿',
        folderId: folder1.id,
      });
      const board2 = await workspaceService.createBoard({
        name: '其他',
        folderId: folder2.id,
      });

      // 这应该成功（不同文件夹）
      await expect(
        workspaceService.renameBoard(board2.id, '设计稿')
      ).resolves.not.toThrow();

      const renamedBoard = workspaceService.getBoard(board2.id);
      expect(renamedBoard?.name).toBe('设计稿');
    });

    it('应该自动 trim 空格', async () => {
      const board = await workspaceService.createBoard({ name: '测试' });

      await workspaceService.renameBoard(board.id, '  新名称  ');

      const updatedBoard = workspaceService.getBoard(board.id);
      expect(updatedBoard?.name).toBe('新名称');
    });

    it('应该允许重命名为相同名称（不是真正的重名）', async () => {
      const board = await workspaceService.createBoard({ name: '设计稿' });

      // 重命名为自己的名字应该成功
      await expect(
        workspaceService.renameBoard(board.id, '设计稿')
      ).resolves.not.toThrow();
    });
  });

  describe('Board creation and move naming', () => {
    it('应该为默认名称自动添加序号避免重名', async () => {
      const folder = await workspaceService.createFolder({
        name: '默认名称测试',
      });

      const board1 = await workspaceService.createBoard({
        folderId: folder.id,
      });
      const board2 = await workspaceService.createBoard({
        folderId: folder.id,
      });
      const board3 = await workspaceService.createBoard({
        folderId: folder.id,
      });

      expect(board1.name).toBe(WORKSPACE_DEFAULTS.DEFAULT_BOARD_NAME);
      expect(board2.name).toBe(`${WORKSPACE_DEFAULTS.DEFAULT_BOARD_NAME} (2)`);
      expect(board3.name).toBe(`${WORKSPACE_DEFAULTS.DEFAULT_BOARD_NAME} (3)`);
    });

    it('移动到存在同名画板的文件夹时应被拒绝', async () => {
      const targetFolder = await workspaceService.createFolder({
        name: '目标文件夹',
      });
      const sourceFolder = await workspaceService.createFolder({
        name: '来源文件夹',
      });

      await workspaceService.createBoard({
        name: '设计稿',
        folderId: targetFolder.id,
      });
      const boardToMove = await workspaceService.createBoard({
        name: '设计稿',
        folderId: sourceFolder.id,
      });

      await expect(
        workspaceService.moveBoard(boardToMove.id, targetFolder.id)
      ).rejects.toThrow(/同名画板/);

      // 失败后应保持在原文件夹
      const persistedBoard = workspaceService.getBoard(boardToMove.id);
      expect(persistedBoard?.folderId).toBe(sourceFolder.id);
    });
  });

  describe('Folder Rename Validation', () => {
    it('默认文件夹名称应该自动添加序号避免重名', async () => {
      const folder1 = await workspaceService.createFolder({});
      const folder2 = await workspaceService.createFolder({});
      const folder3 = await workspaceService.createFolder({});

      expect(folder1.name).toBe(WORKSPACE_DEFAULTS.DEFAULT_FOLDER_NAME);
      expect(folder2.name).toBe(
        `${WORKSPACE_DEFAULTS.DEFAULT_FOLDER_NAME} (2)`
      );
      expect(folder3.name).toBe(
        `${WORKSPACE_DEFAULTS.DEFAULT_FOLDER_NAME} (3)`
      );
    });

    it('应该拒绝空名称', async () => {
      const folder = await workspaceService.createFolder({
        name: '测试文件夹',
      });

      await expect(
        workspaceService.renameFolder(folder.id, '')
      ).rejects.toThrow(ValidationError);

      await expect(
        workspaceService.renameFolder(folder.id, '   ')
      ).rejects.toThrow('文件夹名称不能为空');
    });

    it('应该拒绝过长名称', async () => {
      const folder = await workspaceService.createFolder({
        name: '测试文件夹',
      });
      const longName = 'a'.repeat(101);

      await expect(
        workspaceService.renameFolder(folder.id, longName)
      ).rejects.toThrow('不能超过100个字符');
    });

    it('应该拒绝同级重名（根目录）', async () => {
      await workspaceService.createFolder({ name: '项目A', parentId: null });
      const folder2 = await workspaceService.createFolder({
        name: '项目B',
        parentId: null,
      });

      await expect(
        workspaceService.renameFolder(folder2.id, '项目A')
      ).rejects.toThrow(/同名文件夹/);
    });

    it('应该拒绝同级重名（同一父文件夹内）', async () => {
      const parent = await workspaceService.createFolder({ name: '父文件夹' });

      await workspaceService.createFolder({
        name: '子文件夹A',
        parentId: parent.id,
      });
      const folder2 = await workspaceService.createFolder({
        name: '子文件夹B',
        parentId: parent.id,
      });

      await expect(
        workspaceService.renameFolder(folder2.id, '子文件夹A')
      ).rejects.toThrow(/同名文件夹/);
    });

    it('移动到存在同名文件夹的目录时应被拒绝', async () => {
      const targetParent = await workspaceService.createFolder({
        name: '目标',
      });
      const sourceParent = await workspaceService.createFolder({
        name: '来源',
      });

      await workspaceService.createFolder({
        name: '资料',
        parentId: targetParent.id,
      });
      const folderToMove = await workspaceService.createFolder({
        name: '资料',
        parentId: sourceParent.id,
      });

      await expect(
        workspaceService.moveFolder(folderToMove.id, targetParent.id)
      ).rejects.toThrow(/同名文件夹/);

      const persistedFolder = workspaceService.getFolder(folderToMove.id);
      expect(persistedFolder?.parentId).toBe(sourceParent.id);
    });

    it('应该允许不同父文件夹同名', async () => {
      const parent1 = await workspaceService.createFolder({
        name: '父文件夹1',
      });
      const parent2 = await workspaceService.createFolder({
        name: '父文件夹2',
      });

      await workspaceService.createFolder({
        name: '子文件夹',
        parentId: parent1.id,
      });
      const folder2 = await workspaceService.createFolder({
        name: '其他',
        parentId: parent2.id,
      });

      // 这应该成功（不同父文件夹）
      await expect(
        workspaceService.renameFolder(folder2.id, '子文件夹')
      ).resolves.not.toThrow();

      const renamedFolder = workspaceService.getFolder(folder2.id);
      expect(renamedFolder?.name).toBe('子文件夹');
    });

    it('应该自动 trim 空格', async () => {
      const folder = await workspaceService.createFolder({ name: '测试' });

      await workspaceService.renameFolder(folder.id, '  新名称  ');

      const updatedFolder = workspaceService.getFolder(folder.id);
      expect(updatedFolder?.name).toBe('新名称');
    });
  });

  describe('Cross-type Naming', () => {
    it('应该允许文件夹和画板同名（不同类型）', async () => {
      // 在根目录创建
      await workspaceService.createFolder({ name: '项目A', parentId: null });
      const board = await workspaceService.createBoard({
        name: '其他',
        folderId: null,
      });

      // 画板重命名为与文件夹同名应该成功（不同类型）
      await expect(
        workspaceService.renameBoard(board.id, '项目A')
      ).resolves.not.toThrow();
    });

    it('应该允许同一文件夹内的子文件夹和画板同名', async () => {
      const folder = await workspaceService.createFolder({ name: '父文件夹' });

      await workspaceService.createFolder({
        name: '设计稿',
        parentId: folder.id,
      });
      const board = await workspaceService.createBoard({
        name: '其他',
        folderId: folder.id,
      });

      // 画板重命名为与子文件夹同名应该成功（不同类型）
      await expect(
        workspaceService.renameBoard(board.id, '设计稿')
      ).resolves.not.toThrow();
    });
  });
});
