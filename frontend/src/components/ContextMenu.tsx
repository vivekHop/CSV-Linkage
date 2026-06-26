import React, { useEffect, useRef } from 'react';
import {
  Undo2,
  Redo2,
  Copy,
  Clipboard,
  CopyPlus,
  Scissors,
  Boxes,
  Trash2,
  MessageSquare,
  Download,
  MousePointer,
  PlusSquare,
} from 'lucide-react';

interface ContextMenuAction {
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: false;
}

interface ContextMenuSeparator {
  separator: true;
}

type ContextMenuItem = ContextMenuAction | ContextMenuSeparator;

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  // Actions
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onDelete: () => void;
  onAddComment: () => void;
  onExport: () => void;
  onSetModeSelect: () => void;
  onSetModeMultiselect: () => void;
  onSetModeEdgeCut: () => void;
  // State
  canPaste: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  onClose,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  onDuplicate,
  onGroup,
  onDelete,
  onAddComment,
  onExport,
  onSetModeSelect,
  onSetModeMultiselect,
  onSetModeEdgeCut,
  canPaste,
  canUndo,
  canRedo,
  hasSelection,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust to keep menu inside viewport
  const menuWidth = 220;
  const menuHeight = 400;
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 8);

  const items: ContextMenuItem[] = [
    {
      label: 'Select Mode',
      icon: <MousePointer size={13} />,
      shortcut: 'V',
      onClick: () => { onSetModeSelect(); onClose(); },
    },
    {
      label: 'Multi-Select Mode',
      icon: <PlusSquare size={13} />,
      shortcut: 'M',
      onClick: () => { onSetModeMultiselect(); onClose(); },
    },
    {
      label: 'Edge Cut Mode',
      icon: <Scissors size={13} />,
      shortcut: 'C',
      onClick: () => { onSetModeEdgeCut(); onClose(); },
    },
    { separator: true },
    {
      label: 'Undo',
      icon: <Undo2 size={13} />,
      shortcut: 'Ctrl+Z',
      onClick: () => { onUndo(); onClose(); },
      disabled: !canUndo,
    },
    {
      label: 'Redo',
      icon: <Undo2 size={13} className="scale-x-[-1]" />,
      shortcut: 'Ctrl+Y',
      onClick: () => { onRedo(); onClose(); },
      disabled: !canRedo,
    },
    { separator: true },
    {
      label: 'Copy',
      icon: <Copy size={13} />,
      shortcut: 'Ctrl+C',
      onClick: () => { onCopy(); onClose(); },
      disabled: !hasSelection,
    },
    {
      label: 'Cut',
      icon: <Scissors size={13} />,
      shortcut: 'Ctrl+X',
      onClick: () => { onCut(); onClose(); },
      disabled: !hasSelection,
    },
    {
      label: 'Paste',
      icon: <Clipboard size={13} />,
      shortcut: 'Ctrl+V',
      onClick: () => { onPaste(); onClose(); },
      disabled: !canPaste,
    },
    {
      label: 'Duplicate',
      icon: <CopyPlus size={13} />,
      shortcut: 'Ctrl+D',
      onClick: () => { onDuplicate(); onClose(); },
      disabled: !hasSelection,
    },
    {
      label: 'Group Selection',
      icon: <Boxes size={13} />,
      shortcut: 'Ctrl+G',
      onClick: () => { onGroup(); onClose(); },
      disabled: !hasSelection,
    },
    { separator: true },
    {
      label: 'Add Comment Here',
      icon: <MessageSquare size={13} />,
      onClick: () => { onAddComment(); onClose(); },
    },
    { separator: true },
    {
      label: 'Export OpenMetadata',
      icon: <Download size={13} />,
      shortcut: 'Ctrl+E',
      onClick: () => { onExport(); onClose(); },
    },
    {
      label: 'Delete Selected',
      icon: <Trash2 size={13} />,
      onClick: () => { onDelete(); onClose(); },
      disabled: !hasSelection,
      danger: true,
    },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-workspace-850/95 backdrop-blur-xl border border-workspace-700 rounded-xl shadow-2xl py-1.5 overflow-hidden"
      style={{
        left: adjustedX,
        top: adjustedY,
        minWidth: menuWidth,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      {items.map((item, idx) => {
        if ('separator' in item && item.separator) {
          return <div key={idx} className="my-1 border-t border-workspace-750/60 mx-2" />;
        }
        const action = item as ContextMenuAction;
        return (
          <button
            key={idx}
            onClick={action.disabled ? undefined : action.onClick}
            disabled={action.disabled}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors duration-100 group ${
              action.disabled
                ? 'opacity-30 cursor-not-allowed text-workspace-500'
                : action.danger
                ? 'text-brand-coral hover:bg-brand-coral/10 cursor-pointer'
                : 'text-workspace-200 hover:bg-workspace-750 hover:text-workspace-50 cursor-pointer'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <span className={action.danger ? 'text-brand-coral' : 'text-workspace-400 group-hover:text-workspace-200'}>
                {action.icon}
              </span>
              <span className="font-medium">{action.label}</span>
            </div>
            {action.shortcut && (
              <span className="text-[9px] font-mono text-workspace-600 bg-workspace-800 px-1.5 py-0.5 rounded ml-4">
                {action.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
