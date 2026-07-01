import React, { useState, useEffect, useRef } from 'react';
import { Upload, Search, FileSpreadsheet, Loader2, Focus, Trash2, Tag, BookOpen, User, FileText, ChevronDown, Plus, LayoutGrid, Check } from 'lucide-react';
import { api } from '../api';
import type { Asset, SearchResultItem } from '../types';
import { CommentsPanel } from './Comments';
import type { CanvasComment } from './Comments';

interface LeftSidebarProps {
  assets: Asset[];
  isLoadingAssets: boolean;
  onRefreshAssets: () => void;
  onFocusNode: (assetId: string, columnId?: string) => void;
  selectedAssetId?: string | null;
  onSelectAssetHeader?: (assetId: string) => void;
  onShowImportPreview?: (previewData: { assets: any[]; relationships: any[] }) => void;
  
  // Workspace props
  activeWorkspace: string;
  workspaces: string[];
  onSelectWorkspace: (workspaceId: string) => void;
  onAddWorkspace: (name: string) => void;
  onRenameWorkspace: (oldName: string, newName: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  
  // Comments props
  comments: CanvasComment[];
  isCommentMode: boolean;
  onToggleCommentMode: () => void;
  onDeleteComment: (id: string) => void;
  onFocusComment: (comment: CanvasComment) => void;
  onToggleCommentOpen: (id: string, isOpen?: boolean) => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  assets,
  isLoadingAssets,
  onRefreshAssets,
  onFocusNode,
  selectedAssetId,
  onSelectAssetHeader,
  onShowImportPreview,
  activeWorkspace,
  workspaces,
  onSelectWorkspace,
  onAddWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  comments,
  isCommentMode,
  onToggleCommentMode,
  onDeleteComment,
  onFocusComment,
  onToggleCommentOpen,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [commentsExpanded, setCommentsExpanded] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleAddNewWorkspace = () => {
    const name = prompt("Enter new workspace name:");
    if (name && name.trim()) {
      onAddWorkspace(name.trim());
      setDropdownOpen(false);
    }
  };

  const handleRenameWorkspace = (ws: string) => {
    const newName = prompt(`Rename workspace "${ws}" to:`, ws);
    if (newName && newName.trim() && newName.trim() !== ws) {
      onRenameWorkspace(ws, newName.trim());
    }
  };

  const handleDeleteWorkspace = (ws: string) => {
    if (confirm(`Are you sure you want to permanently delete workspace "${ws}"? This will delete all its tables, relationships, and history.`)) {
      onDeleteWorkspace(ws);
    }
  };

  // Handle live search
  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    
    if (query.trim().length === 0) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const data = await api.search(query);
      setSearchResults(data.results);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle CSV file upload
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Filter files to only Excel workbooks
    const allowedExtensions = ['.xlsx', '.xls', '.xlsm'];
    const invalidFiles = Array.from(files).filter(file => {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      return !allowedExtensions.includes(ext);
    });

    if (invalidFiles.length > 0) {
      setUploadError('Only Excel workbooks (.xlsx, .xls, .xlsm) are allowed.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    setIsUploading(true);
    setUploadError(null);
    try {
      const previewData = await api.profilePreview(files);
      if (onShowImportPreview) {
        onShowImportPreview(previewData);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setUploadError(err.message || 'Failed to profile Excel workbook.');
    } finally {
      setIsUploading(false);
    }
  };

  // Drag and drop events
  const [dragOver, setDragOver] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => {
    setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  };

  return (
    <aside className="w-full h-full bg-workspace-850 border-r border-workspace-750 flex flex-col z-10 select-none overflow-hidden font-sans">
      {/* Workspace Selector Dropdown Header */}
      <div className="relative px-4 py-3.5 border-b border-workspace-750 shrink-0 z-50" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full flex items-center justify-between p-2 rounded-xl bg-workspace-800 hover:bg-workspace-750 border border-workspace-700/80 hover:border-brand-teal/40 transition-all duration-200 group text-left cursor-pointer"
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-brand-teal/80 to-brand-teal flex items-center justify-center text-workspace-950 font-bold text-sm shadow-glow-teal shrink-0 select-none">
              {activeWorkspace.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-workspace-50 truncate leading-tight">
                {activeWorkspace}
              </span>
              <span className="block text-[9px] text-workspace-500 font-medium tracking-wide uppercase">
                Active Workspace
              </span>
            </div>
          </div>
          <ChevronDown size={14} className={`text-workspace-400 group-hover:text-workspace-200 transition-transform duration-200 shrink-0 ${dropdownOpen ? 'rotate-180 text-brand-teal' : ''}`} />
        </button>

        {dropdownOpen && (
          <div className="absolute left-4 right-4 top-full mt-1.5 bg-workspace-900 border border-workspace-750 rounded-xl shadow-2xl p-1.5 z-50 flex flex-col space-y-0.5 animate-fadeIn">
            <div className="px-2.5 py-1.5 text-[9px] font-bold text-workspace-500 uppercase tracking-wider select-none">
              Switch Workspace
            </div>
            
            <div className="max-h-48 overflow-y-auto space-y-0.5 pr-1">
              {workspaces.map((ws) => {
                const isSelected = ws === activeWorkspace;
                return (
                  <div
                    key={ws}
                    className={`group/item flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-brand-teal/10 text-brand-teal border border-brand-teal/20'
                        : 'text-workspace-300 hover:bg-workspace-800 hover:text-workspace-50 border border-transparent'
                    }`}
                  >
                    <button
                      onClick={() => {
                        onSelectWorkspace(ws);
                        setDropdownOpen(false);
                      }}
                      className="flex-1 min-w-0 flex items-center space-x-2 truncate text-left cursor-pointer"
                    >
                      <LayoutGrid size={12} className={isSelected ? 'text-brand-teal' : 'text-workspace-500'} />
                      <span className="truncate">{ws}</span>
                    </button>
                    
                    <div className="flex items-center space-x-1 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
                      {/* Edit Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameWorkspace(ws);
                        }}
                        title="Rename Workspace"
                        className="p-1 hover:bg-workspace-700 rounded text-workspace-400 hover:text-brand-teal transition-colors cursor-pointer"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-2.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      
                      {/* Delete Button */}
                      {workspaces.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteWorkspace(ws);
                          }}
                          title="Delete Workspace"
                          className="p-1 hover:bg-workspace-700 rounded text-workspace-400 hover:text-red-400 transition-colors cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    {isSelected && <Check size={12} className="text-brand-teal shrink-0 ml-1.5 group-hover/item:hidden" />}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-workspace-750/60 my-1 pt-1">
              <button
                onClick={handleAddNewWorkspace}
                className="w-full flex items-center space-x-2 px-2.5 py-2 rounded-lg text-xs font-semibold text-brand-teal hover:bg-brand-teal/10 transition-all text-left cursor-pointer"
              >
                <Plus size={14} />
                <span>Create New Workspace</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* CSV Upload Section */}
      <div className="p-4 border-b border-workspace-750 shrink-0">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`h-24 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all duration-200 p-4 ${
            dragOver
              ? 'border-brand-teal bg-brand-teal/5 shadow-glow-teal'
              : 'border-workspace-750 hover:border-workspace-600 hover:bg-workspace-800'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => handleFileUpload(e.target.files)}
            className="hidden"
            accept=".xlsx,.xls,.xlsm"
            multiple
          />
          {isUploading ? (
            <div className="flex flex-col items-center space-y-2">
              <Loader2 className="animate-spin text-brand-teal" size={20} />
              <span className="text-xs text-workspace-200 font-medium">Profiling spreadsheets in-memory...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center space-y-1">
              <Upload className="text-brand-teal mb-1" size={20} />
              <span className="text-xs font-semibold text-workspace-200">Drag & Drop Excel workbooks</span>
              <span className="text-[9px] text-workspace-600">Accepts Excel workbooks (.xlsx, .xls, .xlsm)</span>
            </div>
          )}
        </div>
        
        <button
          onClick={() => onShowImportPreview?.({ assets: [], relationships: [] })}
          className="w-full mt-2 py-1.5 rounded bg-workspace-800 hover:bg-workspace-750 border border-workspace-750 text-[10px] text-workspace-300 font-semibold flex items-center justify-center space-x-1.5 transition"
        >
          <FileText size={12} className="text-indigo-400" />
          <span>Open Saved Import Drafts</span>
        </button>

        {uploadError && (
          <p className="text-[10px] text-brand-coral mt-2 font-medium bg-brand-coral/5 border border-brand-coral/10 p-2 rounded-lg">
            {uploadError}
          </p>
        )}
      </div>

      {/* Search Section */}
      <div className="p-4 border-b border-workspace-750 flex flex-col space-y-3 shrink-0">
        <div className="relative">
          <input
            type="text"
            placeholder="Search tables, columns, notes..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full bg-workspace-800 border border-workspace-750 hover:border-workspace-600 focus:border-brand-teal rounded-lg pl-9 pr-4 py-1.5 text-xs text-workspace-50 outline-none transition-all placeholder-workspace-600"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-workspace-600" size={14} />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-brand-teal" size={12} />
          )}
        </div>

        {/* Search Results */}
        {searchQuery.trim().length > 0 && (
          <div className="max-h-48 overflow-y-auto bg-workspace-900 border border-workspace-750 rounded-lg p-1.5 space-y-1">
            {searchResults.length === 0 ? (
              <p className="text-[10px] text-workspace-600 text-center py-4 font-mono">No matches found</p>
            ) : (
              searchResults.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onFocusNode(item.asset_id!, item.type === 'column' ? item.id : undefined)}
                  className="p-2 hover:bg-workspace-800 rounded-md cursor-pointer border border-transparent hover:border-workspace-750 transition-all flex flex-col space-y-0.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-workspace-50 truncate max-w-[160px]">
                      {item.name}
                    </span>
                    <span className={`text-[8px] px-1 py-0.5 rounded font-mono uppercase font-bold ${
                      item.type === 'asset' ? 'bg-brand-teal/10 text-brand-teal' : 'bg-brand-violet/10 text-brand-violet'
                    }`}>
                      {item.type === 'asset' ? 'table' : 'column'}
                    </span>
                  </div>
                  {item.type === 'column' && (
                    <span className="text-[9px] text-workspace-600 font-medium">
                      in {item.asset_name}
                    </span>
                  )}
                  <div className="flex items-center space-x-1.5 mt-1 text-[9px] text-workspace-400">
                    {item.match_field === 'tags' && <Tag size={8} className="text-brand-violet" />}
                    {item.match_field.includes('notes') && <BookOpen size={8} className="text-brand-teal" />}
                    {item.match_field === 'owner' && <User size={8} className="text-workspace-600" />}
                    <span className="capitalize font-medium text-workspace-600">{item.match_field}:</span>
                    <span className="truncate max-w-[180px] font-mono text-workspace-400">{item.match_value}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Uploaded Assets List */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col space-y-2 min-h-0">
        <h3 className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider mb-1">
          Profiled Tables ({assets.length})
        </h3>
        
        {isLoadingAssets ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-workspace-600" size={20} />
          </div>
        ) : assets.length === 0 ? (
          <div className="text-center py-12 px-4 border border-dashed border-workspace-750 rounded-xl">
            <FileSpreadsheet className="text-workspace-700 mx-auto mb-2" size={24} />
            <p className="text-xs text-workspace-600 font-mono">Workspace is empty. Upload a CSV to get started.</p>
          </div>
        ) : (
          assets.map((asset) => {
            const isSelected = selectedAssetId === asset.id;
            return (
              <div
                key={asset.id}
                onClick={() => {
                  if (onSelectAssetHeader) {
                    onSelectAssetHeader(asset.id);
                  }
                }}
                className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 flex items-center justify-between group ${
                  isSelected
                    ? 'bg-workspace-800 border-brand-teal shadow-glow-teal'
                    : 'bg-workspace-900 border-workspace-750 hover:bg-workspace-800 hover:border-workspace-600'
                }`}
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <FileSpreadsheet size={15} className={isSelected ? "text-brand-teal" : "text-workspace-400"} />
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-workspace-50 truncate">
                      {asset.name}
                    </h4>
                    <p className="text-[9px] text-workspace-600 font-mono">
                      v{asset.version} • {asset.column_count} cols • {asset.row_count?.toLocaleString()} rows
                    </p>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onFocusNode(asset.id);
                  }}
                  className="p-1.5 bg-workspace-750 text-workspace-400 hover:text-brand-teal rounded-md transition-all hover:bg-workspace-700 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title="Locate on canvas"
                >
                  <Focus size={11} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Pinned Comments Section at the Bottom */}
      <div className="border-t border-workspace-750 shrink-0">
        <CommentsPanel
          comments={comments}
          isCommentMode={isCommentMode}
          onToggleMode={onToggleCommentMode}
          onDeleteComment={onDeleteComment}
          onFocusComment={onFocusComment}
          onToggleCommentOpen={onToggleCommentOpen}
          expanded={commentsExpanded}
          onToggleExpanded={() => setCommentsExpanded(!commentsExpanded)}
        />
      </div>
    </aside>
  );
};
