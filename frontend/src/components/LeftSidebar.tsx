import React, { useState, useRef } from 'react';
import { Upload, Search, FileSpreadsheet, Loader2, Focus, Trash2, Tag, BookOpen, User } from 'lucide-react';
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
  
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      await api.uploadAssets(files);
      onRefreshAssets();
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload and profile Excel workbook.');
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
    <aside className="w-full h-full bg-workspace-850 border-r border-workspace-750 flex flex-col z-10 select-none overflow-hidden">
      {/* Platform Logo */}
      <div className="px-6 py-4 border-b border-workspace-750 flex items-center space-x-2 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-brand-teal-dark to-brand-teal flex items-center justify-center text-workspace-950 font-bold text-lg shadow-glow-teal">
          C
        </div>
        <div>
          <h1 className="text-md font-bold tracking-tight bg-gradient-to-r from-workspace-50 to-workspace-200 bg-clip-text text-transparent">
            CSV Linkage
          </h1>
          <p className="text-[10px] text-workspace-600 font-medium tracking-wide uppercase">
            Lineage & Profiling Studio
          </p>
        </div>
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
