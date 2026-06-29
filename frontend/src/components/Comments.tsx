import React, { useState, useRef } from 'react';
import { MessageSquare, X, Send, MessageCircle, ChevronRight, ChevronUp, ChevronDown, Trash2, Minus } from 'lucide-react';

export interface CanvasComment {
  id: string;
  x: number; // canvas coordinates
  y: number;
  text: string;
  author: string;
  createdAt: string;
  color: string;
  isOpen?: boolean;
}

// React Flow Custom Node for comments
export const CommentNode: React.FC<{
  data: {
    comment: CanvasComment;
    onDelete: (id: string) => void;
    onToggleOpen: (isOpenVal?: boolean) => void;
  };
}> = ({ data }) => {
  const { comment, onDelete, onToggleOpen } = data;
  const isOpen = comment.isOpen || false;

  return (
    <div 
      className="relative select-none"
      style={{ transform: 'translate(-50%, -100%)' }}
    >
      {/* Pin bubble */}
      <div
        className="comment-pin flex flex-col items-center cursor-pointer hover:scale-110 transition-transform duration-200"
        onClick={(e) => {
          e.stopPropagation();
          onToggleOpen();
        }}
      >
        <div
          className="w-8 h-8 rounded-full border-2 border-white/50 shadow-lg flex items-center justify-center"
          style={{ backgroundColor: comment.color }}
        >
          <MessageSquare size={13} className="text-white" />
        </div>
        {/* Tiny pointer */}
        <div
          className="w-0 h-0"
          style={{
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: `7px solid ${comment.color}`,
            marginTop: '-1px',
          }}
        />
      </div>

      {/* Expanded note popup */}
      {isOpen && (
        <div
          className="absolute left-10 top-0 w-56 bg-workspace-850 border border-workspace-700 rounded-xl shadow-2xl p-3 text-xs z-50 cursor-default nodrag nopan"
          style={{ minWidth: 200 }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-workspace-100" style={{ color: comment.color }}>
              {comment.author}
            </span>
            <div className="flex items-center space-x-1.5">
              <span className="text-workspace-600 text-[9px]">
                {new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleOpen(false);
                }}
                title="Minimize comment"
                className="text-workspace-600 hover:text-workspace-200 transition-colors cursor-pointer p-0.5"
              >
                <Minus size={11} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Delete this comment permanently?")) {
                    onDelete(comment.id);
                  }
                }}
                title="Delete comment"
                className="text-workspace-600 hover:text-brand-coral transition-colors cursor-pointer p-0.5"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
          <p className="text-workspace-200 leading-relaxed whitespace-pre-wrap break-words">{comment.text}</p>
        </div>
      )}
    </div>
  );
};

// React Flow Custom Node for comment creation dialog
export const NewCommentNode: React.FC<{
  data: {
    authorName: string;
    authorColor: string;
    onSubmit: (text: string) => void;
    onCancel: () => void;
  };
}> = ({ data }) => {
  const { authorName, authorColor, onSubmit, onCancel } = data;
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim());
    }
  };

  return (
    <div 
      className="relative z-50 pointer-events-auto select-none nodrag nopan"
      style={{ transform: 'translate(-50%, -100%)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-workspace-850 border border-workspace-700 rounded-xl shadow-2xl p-3 w-60">
        {/* Header */}
        <div className="flex items-center space-x-2 mb-2 pb-1 border-b border-workspace-750/30">
          <div className="w-5 h-5 rounded-full border-2 border-white/30 flex items-center justify-center" style={{ backgroundColor: authorColor }}>
            <MessageSquare size={9} className="text-white" />
          </div>
          <span className="text-[10px] font-bold" style={{ color: authorColor }}>{authorName}</span>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }} 
            className="ml-auto text-workspace-600 hover:text-workspace-300 cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type comment..."
          rows={2}
          className="w-full bg-workspace-800 border border-workspace-700 text-workspace-100 text-[11px] px-2 py-1.5 rounded-lg outline-none focus:border-brand-teal/50 resize-none placeholder:text-workspace-600 leading-relaxed"
          onKeyDown={(e) => {
            e.stopPropagation(); // Stop React Flow from using shortcuts like Backspace
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[8px] text-workspace-600">Ctrl+Enter to post</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSubmit();
            }}
            disabled={!text.trim()}
            className="flex items-center space-x-1 px-2.5 py-1 bg-brand-teal/20 text-brand-teal rounded-lg text-[10px] font-bold hover:bg-brand-teal/30 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <Send size={10} />
            <span>Post</span>
          </button>
        </div>
      </div>
      {/* Arrow pointer */}
      <div className="flex justify-center mt-[-1px]">
        <div className="w-0 h-0" style={{
          borderLeft: '8px solid transparent',
          borderRight: '8px solid transparent',
          borderTop: '8px solid var(--color-workspace-700, #343444)',
        }} />
      </div>
    </div>
  );
};

interface CommentsPanelProps {
  comments: CanvasComment[];
  isCommentMode: boolean;
  onToggleMode: () => void;
  onDeleteComment: (id: string) => void;
  onFocusComment: (comment: CanvasComment) => void;
  onToggleCommentOpen: (id: string, isOpen?: boolean) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export const CommentsPanel: React.FC<CommentsPanelProps> = ({
  comments,
  isCommentMode,
  onToggleMode,
  onDeleteComment,
  onFocusComment,
  onToggleCommentOpen,
  expanded,
  onToggleExpanded,
}) => {
  return (
    <div className="flex flex-col h-full bg-workspace-900">
      <div 
        onClick={onToggleExpanded}
        className="flex items-center justify-between px-4 py-2.5 border-b border-workspace-750 hover:bg-workspace-800 cursor-pointer select-none transition-colors"
      >
        <div className="flex items-center space-x-2">
          <MessageCircle size={14} className={isCommentMode ? 'text-brand-teal' : 'text-workspace-400'} />
          <span className="text-xs font-semibold text-workspace-200">Canvas Comments</span>
          {comments.length > 0 && (
            <span className="text-[10px] bg-workspace-750 text-workspace-300 px-1.5 py-0.5 rounded-full font-mono">
              {comments.length}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onToggleMode}
            title={isCommentMode ? 'Exit comment mode' : 'Enable click-to-comment'}
            className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all cursor-pointer ${
              isCommentMode
                ? 'bg-brand-teal/20 text-brand-teal border border-brand-teal/30'
                : 'bg-workspace-800 text-workspace-400 hover:text-workspace-100 border border-workspace-700'
            }`}
          >
            {isCommentMode ? '● ADDING' : '+ ADD'}
          </button>
          <div onClick={onToggleExpanded} className="text-workspace-400 hover:text-workspace-200 p-0.5">
            {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </div>
        </div>
      </div>

      {expanded && (
        <>
          {isCommentMode && (
            <div className="px-4 py-1.5 bg-brand-teal/5 border-b border-brand-teal/10">
              <p className="text-[9px] text-brand-teal/80 font-mono">
                Click anywhere on the canvas grid to place a note pin.
              </p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto min-h-0 max-h-[220px]">
            {comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-workspace-600 space-y-1.5">
                <MessageSquare size={20} className="opacity-30" />
                <p className="text-[10px] font-mono">No comments placed yet</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {comments.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onFocusComment(c);
                      onToggleCommentOpen(c.id, true);
                    }}
                    className="w-full text-left p-2 rounded-lg bg-workspace-800 hover:bg-workspace-750 border border-workspace-750 hover:border-workspace-700 transition-all group flex flex-col cursor-pointer"
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <div className="flex items-center space-x-1.5 min-w-0">
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: c.color }}
                        />
                        <span className="text-[10px] font-bold text-workspace-200 font-mono truncate">{c.author}</span>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleCommentOpen(c.id, false);
                          }}
                          title="Minimize comment"
                          className="text-workspace-600 hover:text-workspace-200 cursor-pointer p-0.5"
                        >
                          <Minus size={10} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Delete this comment permanently?")) {
                              onDeleteComment(c.id);
                            }
                          }}
                          title="Delete comment"
                          className="text-workspace-600 hover:text-brand-coral cursor-pointer p-0.5"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-workspace-300 line-clamp-2 leading-relaxed pl-3.5">
                      {c.text}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
