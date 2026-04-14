
import React, { useState, useRef, useEffect } from 'react';
import { Dialog, Input, Button, MessagePlugin } from 'tdesign-react';
import { Plus, X, Trash2, Edit2, Check } from 'lucide-react';
import type { KBTag, KBTagWithCount } from '../../types/knowledge-base.types';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import './kb-tag-management-dialog.scss';

interface KBTagManagementDialogProps {
  visible: boolean;
  onClose: () => void;
  allTags: KBTagWithCount[];
  onCreateTag: (name: string) => Promise<KBTag>;
  onUpdateTag: (id: string, name: string) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
  onSelectTag?: (tagId: string) => void;
}

export const KBTagManagementDialog: React.FC<KBTagManagementDialogProps> = ({
  visible,
  onClose,
  allTags,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onSelectTag,
}) => {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const inputRef = useRef<any>(null);

  useEffect(() => {
    if (isCreating && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isCreating]);

  const handleCreate = async () => {
    if (!newTagName.trim()) {
      setIsCreating(false);
      return;
    }
    try {
      await onCreateTag(newTagName.trim());
      setNewTagName('');
      setIsCreating(false);
      MessagePlugin.success('标签创建成功');
    } catch (error) {
      MessagePlugin.error('标签创建失败');
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editingName.trim()) {
      setEditingTagId(null);
      return;
    }
    try {
      await onUpdateTag(id, editingName.trim());
      setEditingTagId(null);
      MessagePlugin.success('标签更新成功');
    } catch (error) {
      MessagePlugin.error('标签更新失败');
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const tag = allTags.find((item) => item.id === id);
      const confirmed = await confirm({
        title: '确认删除标签',
        description: `确定要删除标签「${tag?.name || '未命名标签'}」吗？此操作不可撤销。`,
        confirmText: '删除',
        cancelText: '取消',
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      await onDeleteTag(id);
      MessagePlugin.success('标签删除成功');
    } catch (error) {
      MessagePlugin.error('标签删除失败');
    }
  };

  const startEditing = (e: React.MouseEvent, tag: KBTag) => {
    e.stopPropagation();
    setEditingTagId(tag.id);
    setEditingName(tag.name);
  };

  return (
    <Dialog
      header="管理标签"
      visible={visible}
      onClose={onClose}
      footer={null}
      width={400}
      className="kb-tag-management-dialog"
    >
      <div className="kb-tag-list">
        {/* Create Button / Input */}
        {isCreating ? (
          <div className="kb-tag-item kb-tag-item--creating">
            <Input
              ref={inputRef}
              value={newTagName}
              onChange={(v) => setNewTagName(v)}
              onEnter={handleCreate}
              onBlur={handleCreate}
              placeholder="输入标签名称..."
              size="small"
            />
          </div>
        ) : (
          <div 
            className="kb-tag-item kb-tag-item--create-btn"
            onClick={() => setIsCreating(true)}
          >
            <Plus size={16} />
            <span>新建标签</span>
          </div>
        )}

        {/* Tag List */}
        {allTags.map((tag) => (
          <div 
            key={tag.id} 
            className="kb-tag-item"
            onClick={() => {
              if (onSelectTag && !editingTagId) {
                onSelectTag(tag.id);
                onClose();
              }
            }}
          >
            {editingTagId === tag.id ? (
              <div className="kb-tag-item__editing" onClick={(e) => e.stopPropagation()}>
                <Input
                  value={editingName}
                  onChange={(v) => setEditingName(v)}
                  onEnter={() => handleUpdate(tag.id)}
                  size="small"
                  autofocus
                />
                <Button 
                  shape="circle" 
                  variant="text" 
                  size="small" 
                  onClick={() => handleUpdate(tag.id)}
                >
                  <Check size={14} />
                </Button>
                <Button 
                  shape="circle" 
                  variant="text" 
                  size="small" 
                  onClick={() => setEditingTagId(null)}
                >
                  <X size={14} />
                </Button>
              </div>
            ) : (
              <>
                <span 
                  className="kb-tag-item__dot"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="kb-tag-item__name">{tag.name}</span>
                <span className="kb-tag-item__count">
                  {tag.count ? `(${tag.count} 个笔记)` : '(0 个笔记)'}
                </span>
                
                <div className="kb-tag-item__actions">
                  <button 
                    className="kb-tag-item__action-btn"
                    onClick={(e) => startEditing(e, tag)}
                    title="重命名"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button 
                    className="kb-tag-item__action-btn kb-tag-item__action-btn--delete"
                    onClick={(e) => handleDelete(e, tag.id)}
                    title="删除"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {confirmDialog}
    </Dialog>
  );
};
