import React, { useState, useEffect } from 'react';
import { FileSpreadsheet, Columns, User, Calendar, Plus, Trash2, Eye, Tag, FileClock, CheckCircle, Database } from 'lucide-react';
import { api } from '../api';
import type { Asset, Column, VersionHistory, Relationship } from '../types';

interface RightSidebarProps {
  selectedAsset: Asset | null;
  selectedColumn: Column | null;
  onUpdateAsset: (assetId: string, updates: Partial<Asset>) => void;
  onUpdateColumn: (columnId: string, updates: Partial<Column>) => void;
  onUpdateRelationship?: (relId: string, updates: Partial<Relationship>) => void;
  onDeleteAsset?: (assetId: string) => void;
  onDeleteColumn?: (columnId: string) => void;
  
  // Edge Selection properties
  selectedEdgeId?: string | null;
  relationships?: Relationship[];
  assets?: Asset[];
  onClearSelection?: () => void;
  onDeleteRelationship?: (relId: string) => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  selectedAsset,
  selectedColumn,
  onUpdateAsset,
  onUpdateColumn,
  onUpdateRelationship,
  onDeleteAsset,
  onDeleteColumn,
  selectedEdgeId,
  relationships = [],
  assets = [],
  onClearSelection,
  onDeleteRelationship,
}) => {
  const [activeTab, setActiveTab] = useState<'metadata' | 'versions'>('metadata');
  
  // Asset state
  const [assetName, setAssetName] = useState('');
  const [assetOwner, setAssetOwner] = useState('');
  const [assetDesc, setAssetDesc] = useState('');
  const [assetNotes, setAssetNotes] = useState('');
  const [assetTags, setAssetTags] = useState<string[]>([]);
  const [newAssetTag, setNewAssetTag] = useState('');
  const [assetCustom, setAssetCustom] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  // Column state
  const [columnDesc, setColumnDesc] = useState('');
  const [columnNotes, setColumnNotes] = useState('');
  const [columnTags, setColumnTags] = useState<string[]>([]);
  const [newColumnTag, setNewColumnTag] = useState('');

  // Relationship state
  const [relDesc, setRelDesc] = useState('');

  // Find incoming relationships for the selected column
  const incomingRels = selectedColumn
    ? relationships.filter(
        (rel) =>
          rel.destination_node_type === 'column' &&
          rel.destination_node_id === selectedColumn.id
      )
    : [];
  
  // Versions
  const [versions, setVersions] = useState<VersionHistory[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [selectedVersionSnapshot, setSelectedVersionSnapshot] = useState<any>(null);

  // Sync state when selection changes
  useEffect(() => {
    if (selectedAsset) {
      setAssetName(selectedAsset.name || '');
      setAssetOwner(selectedAsset.owner || '');
      setAssetDesc(selectedAsset.description || '');
      setAssetNotes(selectedAsset.notes || '');
      setAssetTags(selectedAsset.tags || []);
      
      // Parse custom attributes
      const customAttrs: Record<string, string> = {};
      if (selectedAsset.custom_attributes) {
        Object.entries(selectedAsset.custom_attributes).forEach(([k, v]) => {
          customAttrs[k] = String(v);
        });
      }
      setAssetCustom(customAttrs);
      setActiveTab('metadata');
      setSelectedVersionSnapshot(null);
      
      // Fetch version history
      fetchVersionHistory(selectedAsset.id);
    }
  }, [selectedAsset]);

  useEffect(() => {
    if (selectedColumn) {
      setColumnDesc(selectedColumn.description || '');
      setColumnNotes(selectedColumn.notes || '');
      setColumnTags(selectedColumn.tags || []);
    }
  }, [selectedColumn]);

  useEffect(() => {
    if (selectedEdgeId && relationships.length > 0) {
      const rel = relationships.find((r) => r.id === selectedEdgeId);
      if (rel) {
        setRelDesc(rel.metadata_json?.description || '');
      }
    }
  }, [selectedEdgeId, relationships]);

  const fetchVersionHistory = async (assetId: string) => {
    setIsLoadingVersions(true);
    try {
      const history = await api.getAssetHistory(assetId);
      setVersions(history);
    } catch (err) {
      console.error('Error fetching version history:', err);
    } finally {
      setIsLoadingVersions(false);
    }
  };

  // Save Handlers
  const handleSaveAsset = () => {
    if (!selectedAsset) return;
    onUpdateAsset(selectedAsset.id, {
      name: assetName,
      owner: assetOwner,
      description: assetDesc,
      notes: assetNotes,
      tags: assetTags,
      custom_attributes: assetCustom,
    });
  };

  const handleSaveColumn = () => {
    if (!selectedColumn) return;
    onUpdateColumn(selectedColumn.id, {
      description: columnDesc,
      notes: columnNotes,
      tags: columnTags,
    });
  };

  const handleSaveRelationship = () => {
    if (!selectedEdgeId || !onUpdateRelationship) return;
    const rel = relationships.find((r) => r.id === selectedEdgeId);
    if (rel) {
      onUpdateRelationship(selectedEdgeId, {
        metadata_json: {
          ...rel.metadata_json,
          description: relDesc,
        },
      });
    }
  };

  // Tags Management
  const addAssetTag = () => {
    if (newAssetTag.trim() && !assetTags.includes(newAssetTag.trim())) {
      setAssetTags([...assetTags, newAssetTag.trim()]);
      setNewAssetTag('');
    }
  };

  const removeAssetTag = (tag: string) => {
    setAssetTags(assetTags.filter((t) => t !== tag));
  };

  const addColumnTag = () => {
    if (newColumnTag.trim() && !columnTags.includes(newColumnTag.trim())) {
      setColumnTags([...columnTags, newColumnTag.trim()]);
      setNewColumnTag('');
    }
  };

  const removeColumnTag = (tag: string) => {
    setColumnTags(columnTags.filter((t) => t !== tag));
  };

  // Custom attributes management
  const addCustomAttribute = () => {
    if (newKey.trim() && newValue.trim()) {
      setAssetCustom({
        ...assetCustom,
        [newKey.trim()]: newValue.trim(),
      });
      setNewKey('');
      setNewValue('');
    }
  };

  const removeCustomAttribute = (key: string) => {
    const updated = { ...assetCustom };
    delete updated[key];
    setAssetCustom(updated);
  };

  // Render Selected Edge Details (Trace Lineage view)
  if (selectedEdgeId) {
    const rel = relationships.find((r) => r.id === selectedEdgeId);
    
    // Resolve names helper
    const resolveTableName = (nodeId: string, nodeType: 'asset' | 'column'): string => {
      if (nodeType === 'asset') {
        const a = assets.find((x) => x.id === nodeId);
        return a ? a.name : 'Unknown Table';
      } else {
        const a = assets.find((x) => x.columns?.some((c) => c.id === nodeId));
        return a ? a.name : 'Unknown Table';
      }
    };

    const resolveColumnName = (nodeId: string, nodeType: 'asset' | 'column'): string | null => {
      if (nodeType === 'asset') return null;
      for (const a of assets) {
        const c = a.columns?.find((x) => x.id === nodeId);
        if (c) return c.name;
      }
      return 'Unknown Column';
    };

    if (rel) {
      const sourceTable = resolveTableName(rel.source_node_id, rel.source_node_type);
      const sourceCol = resolveColumnName(rel.source_node_id, rel.source_node_type);
      const destTable = resolveTableName(rel.destination_node_id, rel.destination_node_type);
      const destCol = resolveColumnName(rel.destination_node_id, rel.destination_node_type);

      // Find other source tables with the same destination column
      const otherIncoming = relationships.filter(
        (r) => r.destination_node_id === rel.destination_node_id && r.id !== rel.id
      );

      return (
        <aside className="w-full h-full bg-workspace-850 border-l border-workspace-750 flex flex-col z-10 select-none overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-workspace-750 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-brand-emerald/10 rounded-lg text-brand-emerald animate-pulse">
                <Database size={16} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-workspace-50">Lineage Trace</h3>
                <p className="text-[10px] text-workspace-400 font-mono">Edge Property Viewer</p>
              </div>
            </div>
            {onClearSelection && (
               <button 
                 onClick={onClearSelection}
                 className="text-[10px] text-workspace-400 hover:text-brand-coral border border-workspace-750 px-2 py-0.5 rounded transition-all cursor-pointer"
               >
                 Clear
               </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
            {/* Relationship Type Badge */}
            <div className="flex items-center justify-between">
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider block">Link Type</span>
                <span className="inline-block px-2.5 py-1 bg-brand-emerald/10 border border-brand-emerald/20 text-brand-emerald rounded-lg font-mono font-bold tracking-wide">
                  {rel.relationship_type}
                </span>
              </div>
              {onDeleteRelationship && (
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this lineage connection?')) {
                      onDeleteRelationship(rel.id);
                    }
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-brand-coral/10 hover:bg-brand-coral text-brand-coral hover:text-workspace-950 border border-brand-coral/20 rounded-lg font-semibold transition-all cursor-pointer"
                >
                  <Trash2 size={12} />
                  <span>Delete Link</span>
                </button>
              )}
            </div>

            {/* Description Form */}
            <div className="space-y-2 bg-workspace-900 border border-workspace-750 p-4 rounded-xl">
              <h4 className="text-[10px] font-bold text-workspace-500 uppercase tracking-wider">Lineage Annotation</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-workspace-400 block mb-1 font-medium">Description (Optional)</label>
                  <textarea
                    value={relDesc}
                    onChange={(e) => setRelDesc(e.target.value)}
                    placeholder="Explain the logic behind this connection (e.g. key mapping, transform rule)..."
                    rows={3}
                    className="w-full bg-workspace-850 border border-workspace-700 rounded-lg px-3 py-2 text-workspace-200 placeholder-workspace-500 focus:outline-none focus:border-brand-emerald/50 resize-none font-mono text-[11px] leading-relaxed"
                  />
                </div>
                <button
                  onClick={handleSaveRelationship}
                  className="w-full bg-brand-emerald text-workspace-950 font-bold py-2 rounded-lg hover:bg-brand-emerald-400 transition-all shadow-lg shadow-brand-emerald/10 cursor-pointer"
                >
                  Save Annotation
                </button>
              </div>
            </div>

            {/* Source and Destination flow detail cards */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider">Lineage Mapping Details</h4>
              
              {/* Source Card */}
              <div className="bg-workspace-900 border border-workspace-750 p-3.5 rounded-xl space-y-2 relative overflow-hidden">
                <div className="absolute top-0 right-0 px-2 py-0.5 bg-brand-coral text-workspace-950 font-bold text-[8px] font-mono uppercase tracking-wider rounded-bl-lg">
                  Source Table
                </div>
                <div className="font-semibold text-workspace-50 truncate pr-16">{sourceTable}</div>
                {sourceCol && (
                  <div className="mt-1">
                    <span className="text-[10px] text-workspace-500 font-mono block">Connected Column:</span>
                    <span className="text-xs font-mono font-semibold text-brand-coral">{sourceCol}</span>
                  </div>
                )}
              </div>

              {/* Arrow spacer */}
              <div className="flex justify-center text-workspace-600 font-bold">↓</div>

              {/* Destination Card */}
              <div className="bg-workspace-900 border border-workspace-750 p-3.5 rounded-xl space-y-2 relative overflow-hidden">
                <div className="absolute top-0 right-0 px-2 py-0.5 bg-brand-violet text-workspace-50 font-bold text-[8px] font-mono uppercase tracking-wider rounded-bl-lg">
                  Dest Table
                </div>
                <div className="font-semibold text-workspace-50 truncate pr-16">{destTable}</div>
                {destCol && (
                  <div className="mt-1">
                    <span className="text-[10px] text-workspace-500 font-mono block">Connected Column:</span>
                    <span className="text-xs font-mono font-semibold text-brand-violet">{destCol}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Other Incoming Feeds (mapping to the same destination column) */}
            {destCol && (
              <div className="space-y-3">
                <h4 className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider">
                  Other feeds to {destCol} ({otherIncoming.length})
                </h4>
                
                {otherIncoming.length === 0 ? (
                  <div className="text-[10px] text-workspace-600 font-mono bg-workspace-900/40 p-3 rounded-lg border border-workspace-750/30">
                    No other source tables point to this destination column.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {otherIncoming.map((r) => {
                      const oTable = resolveTableName(r.source_node_id, r.source_node_type);
                      const oCol = resolveColumnName(r.source_node_id, r.source_node_type);
                      return (
                        <div key={r.id} className="p-3 bg-workspace-900/60 border border-workspace-750/50 rounded-lg space-y-1 font-mono text-[10px]">
                          <div className="flex justify-between items-center">
                            <span className="text-workspace-300 font-semibold truncate max-w-[150px]" title={oTable}>
                              {oTable}
                            </span>
                            <span className="text-[8px] bg-workspace-800 text-workspace-400 px-1 py-0.5 rounded">
                              {r.relationship_type}
                            </span>
                          </div>
                          {oCol && (
                            <div className="text-brand-coral font-medium">
                              column: {oCol}
                            </div>
                          )}
                         </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      );
    }
  }

  // If nothing is selected
  if (!selectedAsset && !selectedColumn) {
    return (
      <aside className="w-full h-full bg-workspace-850 border-l border-workspace-750 flex flex-col items-center justify-center p-6 text-center select-none z-10">
        <Database className="text-workspace-700 mb-3 animate-pulse" size={32} />
        <h3 className="text-sm font-semibold text-workspace-200">Properties Panel</h3>
        <p className="text-xs text-workspace-600 font-mono mt-1.5 max-w-[200px]">
          Select a table header, column, or relationship line to inspect lineage statistics, details, and metadata.
        </p>
      </aside>
    );
  }

  return (
    <aside className="w-full h-full bg-workspace-850 border-l border-workspace-750 flex flex-col z-10 select-none overflow-hidden">
      {/* Selection Header */}
      <div className="px-5 py-4 border-b border-workspace-750 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3 min-w-0 flex-1">
          {selectedAsset && !selectedColumn ? (
            <>
              <div className="p-2 bg-brand-teal/10 rounded-lg text-brand-teal shrink-0">
                <FileSpreadsheet size={16} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-workspace-50 truncate" title={selectedAsset.name}>
                  {selectedAsset.name}
                </h3>
                <p className="text-[10px] text-workspace-400 font-mono">v{selectedAsset.version} • CSV File Metadata</p>
              </div>
            </>
          ) : (
            <>
              <div className="p-2 bg-brand-violet/10 rounded-lg text-brand-violet shrink-0">
                <Columns size={16} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-workspace-50 truncate" title={selectedColumn?.name}>
                  {selectedColumn?.name}
                </h3>
                <p className="text-[10px] text-workspace-400 font-mono">Column • {selectedColumn?.datatype}</p>
              </div>
            </>
          )}
        </div>

        {/* Delete button (Table / Column) */}
        {selectedAsset && !selectedColumn && onDeleteAsset && (
          <button
            onClick={() => onDeleteAsset(selectedAsset.id)}
            className="p-1.5 bg-brand-coral/10 hover:bg-brand-coral text-brand-coral hover:text-workspace-950 border border-brand-coral/20 rounded-lg font-semibold transition-all cursor-pointer shrink-0 ml-2"
            title="Delete table metadata"
          >
            <Trash2 size={13} />
          </button>
        )}

        {selectedColumn && onDeleteColumn && (
          <button
            onClick={() => onDeleteColumn(selectedColumn.id)}
            className="p-1.5 bg-brand-coral/10 hover:bg-brand-coral text-brand-coral hover:text-workspace-950 border border-brand-coral/20 rounded-lg font-semibold transition-all cursor-pointer shrink-0 ml-2"
            title="Delete column metadata"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Asset Tabs */}
      {selectedAsset && !selectedColumn && (
        <div className="flex border-b border-workspace-750 shrink-0 text-xs font-semibold">
          <button
            onClick={() => { setActiveTab('metadata'); setSelectedVersionSnapshot(null); }}
            className={`flex-1 py-2.5 text-center border-b-2 transition-all ${
              activeTab === 'metadata' && !selectedVersionSnapshot
                ? 'border-brand-teal text-brand-teal bg-workspace-800/40'
                : 'border-transparent text-workspace-600 hover:text-workspace-400'
            }`}
          >
            Metadata
          </button>
          <button
            onClick={() => setActiveTab('versions')}
            className={`flex-1 py-2.5 text-center border-b-2 transition-all ${
              activeTab === 'versions' || selectedVersionSnapshot
                ? 'border-brand-teal text-brand-teal bg-workspace-800/40'
                : 'border-transparent text-workspace-600 hover:text-workspace-400'
            }`}
          >
            History Log ({versions.length})
          </button>
        </div>
      )}

      {/* Scrollable Contents */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
        
        {/* --- VERSION HISTORICAL SNAPSHOT VIEWER --- */}
        {selectedVersionSnapshot ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-bold text-brand-teal uppercase tracking-wider">
                Viewing Version v{selectedVersionSnapshot.version} Snapshot
              </h4>
              <button
                onClick={() => setSelectedVersionSnapshot(null)}
                className="text-[10px] text-workspace-400 hover:text-brand-coral font-medium border border-workspace-750 hover:border-workspace-600 px-2 py-0.5 rounded transition-all"
              >
                Back to Active
              </button>
            </div>
            
            <div className="bg-workspace-900 border border-workspace-750 rounded-lg p-3 space-y-3 font-mono text-[10px]">
              <div>
                <span className="text-workspace-600 block">Name</span>
                <span className="text-workspace-200">{selectedVersionSnapshot.name}</span>
              </div>
              <div>
                <span className="text-workspace-600 block">Owner</span>
                <span className="text-workspace-200">{selectedVersionSnapshot.owner || 'N/A'}</span>
              </div>
              <div>
                <span className="text-workspace-600 block">Description</span>
                <span className="text-workspace-200 block whitespace-pre-wrap">{selectedVersionSnapshot.description || 'N/A'}</span>
              </div>
              <div>
                <span className="text-workspace-600 block">Business Notes</span>
                <span className="text-workspace-200 block whitespace-pre-wrap">{selectedVersionSnapshot.notes || 'N/A'}</span>
              </div>
              <div>
                <span className="text-workspace-600 block">Tags</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedVersionSnapshot.tags?.map((t: string) => (
                    <span key={t} className="px-1.5 py-0.5 bg-workspace-800 text-workspace-400 rounded text-[9px]">
                      {t}
                    </span>
                  )) || 'None'}
                </div>
              </div>
            </div>
            <p className="text-[9px] text-workspace-600 italic text-center">
              Snapshots represent historical metadata dumps. They are read-only.
            </p>
          </div>
        ) : (
          /* --- ACTIVE EDITORS --- */
          <>
            {/* ASSET METADATA TAB */}
            {selectedAsset && !selectedColumn && activeTab === 'metadata' && (
              <div className="space-y-4">
                {/* File Properties */}
                <div className="bg-workspace-900 border border-workspace-750 rounded-lg p-3 space-y-2.5 font-mono text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-workspace-600">File Size:</span>
                    <span className="text-workspace-200">
                      {selectedAsset.file_size ? `${(selectedAsset.file_size / 1024).toFixed(2)} KB` : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-workspace-600">Rows:</span>
                    <span className="text-workspace-200">{selectedAsset.row_count?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-workspace-600">Columns:</span>
                    <span className="text-workspace-200">{selectedAsset.column_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-workspace-600">Uploaded At:</span>
                    <span className="text-workspace-200 truncate max-w-[120px]" title={selectedAsset.created_at}>
                      {new Date(selectedAsset.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Edit Form */}
                <div className="space-y-3.5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider block">Asset Display Name</label>
                    <input
                      type="text"
                      value={assetName}
                      onChange={(e) => setAssetName(e.target.value)}
                      className="w-full bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg px-3 py-1.5 text-xs text-workspace-50 outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider block">Owner</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={assetOwner}
                        onChange={(e) => setAssetOwner(e.target.value)}
                        placeholder="Owner name or team"
                        className="w-full bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg pl-8 pr-3 py-1.5 text-xs text-workspace-50 outline-none placeholder-workspace-600"
                      />
                      <User className="absolute left-2.5 top-1/2 -translate-y-1/2 text-workspace-600" size={13} />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider block">Description</label>
                    <textarea
                      rows={3}
                      value={assetDesc}
                      onChange={(e) => setAssetDesc(e.target.value)}
                      className="w-full bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg px-3 py-1.5 text-xs text-workspace-50 outline-none resize-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider block">Business Notes</label>
                    <textarea
                      rows={3}
                      value={assetNotes}
                      onChange={(e) => setAssetNotes(e.target.value)}
                      placeholder="Add business definitions or operational instructions..."
                      className="w-full bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg px-3 py-1.5 text-xs text-workspace-50 outline-none resize-none placeholder-workspace-600"
                    />
                  </div>

                  {/* Tags */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider block">Tags</label>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {assetTags.map((tag) => (
                        <span key={tag} className="flex items-center space-x-1 px-2 py-0.5 bg-brand-violet/10 border border-brand-violet/20 text-brand-violet rounded-full text-[10px]">
                          <span>{tag}</span>
                          <button onClick={() => removeAssetTag(tag)} className="hover:text-brand-coral">&times;</button>
                        </span>
                      ))}
                    </div>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={newAssetTag}
                        onChange={(e) => setNewAssetTag(e.target.value)}
                        placeholder="Add tag"
                        onKeyDown={(e) => e.key === 'Enter' && addAssetTag()}
                        className="flex-1 bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg px-2.5 py-1 text-xs text-workspace-50 outline-none"
                      />
                      <button
                        onClick={addAssetTag}
                        className="p-1 bg-workspace-750 hover:bg-workspace-750 text-brand-teal rounded-lg border border-workspace-750 transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Custom attributes (Key Value) */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider block">Custom Properties</label>
                    <div className="space-y-1 mb-2 max-h-36 overflow-y-auto">
                      {Object.entries(assetCustom).map(([key, val]) => (
                        <div key={key} className="flex items-center justify-between bg-workspace-900 border border-workspace-750 px-2.5 py-1.5 rounded-lg text-[10px] font-mono">
                          <span className="text-workspace-400 font-semibold truncate max-w-[100px]">{key}:</span>
                          <span className="text-workspace-200 truncate max-w-[100px]">{val}</span>
                          <button
                            onClick={() => removeCustomAttribute(key)}
                            className="text-workspace-600 hover:text-brand-coral ml-2"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Property name"
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        className="bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg px-2.5 py-1 text-xs text-workspace-50 outline-none"
                      />
                      <input
                        type="text"
                        placeholder="Value"
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        className="bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg px-2.5 py-1 text-xs text-workspace-50 outline-none"
                      />
                    </div>
                    <button
                      onClick={addCustomAttribute}
                      className="w-full mt-1.5 border border-dashed border-workspace-700 hover:border-brand-teal text-workspace-400 hover:text-brand-teal font-semibold rounded-lg py-1 flex items-center justify-center space-x-1.5 transition-colors"
                    >
                      <Plus size={12} />
                      <span>Add Custom Property</span>
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleSaveAsset}
                  className="w-full bg-brand-teal hover:bg-brand-teal/80 text-workspace-950 font-bold py-2 rounded-lg flex items-center justify-center space-x-2 shadow-glow-teal transition-all"
                >
                  <CheckCircle size={15} />
                  <span>Save Metadata (v{selectedAsset.version})</span>
                </button>
              </div>
            )}

            {/* VERSION HISTORY LIST TAB */}
            {selectedAsset && !selectedColumn && activeTab === 'versions' && (
              <div className="space-y-4">
                <h4 className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider">
                  Audit History Logs
                </h4>
                {isLoadingVersions ? (
                  <p className="text-[10px] text-workspace-600 font-mono">Loading history logs...</p>
                ) : versions.length === 0 ? (
                  <p className="text-[10px] text-workspace-600 font-mono">No historical edits found.</p>
                ) : (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto">
                    {versions.map((ver) => (
                      <div
                        key={ver.id}
                        className="p-3 bg-workspace-900 border border-workspace-750 hover:border-workspace-600 rounded-lg flex flex-col space-y-1.5 transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-brand-teal font-mono">Version v{ver.version_number}</span>
                          <span className="text-[9px] text-workspace-600 font-mono">
                            {new Date(ver.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-[10px] text-workspace-200">
                          {ver.change_summary || 'Metadata edit'}
                        </p>
                        <button
                          onClick={() => setSelectedVersionSnapshot(ver.metadata_snapshot)}
                          className="self-end text-[9px] text-brand-teal hover:underline flex items-center space-x-1 mt-1"
                        >
                          <Eye size={10} />
                          <span>View snapshot</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* COLUMN METADATA & PROFILING PANEL */}
            {selectedColumn && (
              <div className="space-y-4">
                {/* Column Profiling Statistics */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider">
                    Profiling Statistics
                  </h4>

                  <div className="bg-workspace-900 border border-workspace-750 rounded-lg p-3.5 space-y-3 font-mono text-[10px]">
                    {/* Nullability bar */}
                    <div>
                      <div className="flex justify-between mb-1.5">
                        <span className="text-workspace-600">Nullable %:</span>
                        <span className="text-brand-coral font-bold">{selectedColumn.nullable_percentage?.toFixed(2)}%</span>
                      </div>
                      <div className="w-full bg-workspace-800 rounded-full h-1.5 overflow-hidden border border-workspace-750">
                        <div
                          className="bg-brand-coral h-full rounded-full"
                          style={{ width: `${selectedColumn.nullable_percentage || 0}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-workspace-600">Distinct Values:</span>
                      <span className="text-workspace-200">{selectedColumn.distinct_count?.toLocaleString()}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-workspace-600">Duplicate Values:</span>
                      <span className="text-workspace-200">{selectedColumn.duplicate_count?.toLocaleString()}</span>
                    </div>

                    <div className="border-t border-workspace-750/50 pt-2.5 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-workspace-600">Min value:</span>
                        <span className="text-workspace-200 truncate max-w-[120px]" title={selectedColumn.min}>
                          {selectedColumn.min !== null && selectedColumn.min !== 'None' ? selectedColumn.min : 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-workspace-600">Max value:</span>
                        <span className="text-workspace-200 truncate max-w-[120px]" title={selectedColumn.max}>
                          {selectedColumn.max !== null && selectedColumn.max !== 'None' ? selectedColumn.max : 'N/A'}
                        </span>
                      </div>
                      {selectedColumn.mean !== null && (
                        <div className="flex justify-between">
                          <span className="text-workspace-600">Mean:</span>
                          <span className="text-workspace-200">{selectedColumn.mean?.toFixed(4)}</span>
                        </div>
                      )}
                      {selectedColumn.median !== null && (
                        <div className="flex justify-between">
                          <span className="text-workspace-600">Median:</span>
                          <span className="text-workspace-200">{selectedColumn.median?.toFixed(4)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Column Sample Values */}
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider">
                    Sample Values
                  </h4>
                  <div className="flex flex-wrap gap-1 bg-workspace-900 border border-workspace-750 p-2.5 rounded-lg">
                    {selectedColumn.sample_values && selectedColumn.sample_values.length > 0 ? (
                      selectedColumn.sample_values.map((val: any, idx: number) => (
                        <span
                          key={idx}
                          className="px-2 py-1 bg-workspace-800 text-workspace-200 font-mono text-[9px] rounded border border-workspace-750 truncate max-w-[110px]"
                          title={String(val)}
                        >
                          {val === null ? 'null' : String(val)}
                        </span>
                      ))
                    ) : (
                      <span className="text-workspace-600 font-mono text-[10px]">No non-null sample values available</span>
                    )}
                  </div>
                </div>

                {/* Lineage Relationship Mapping Type for Destination Column */}
                {incomingRels.length > 0 && (
                  <div className="space-y-3 pt-3 border-t border-workspace-750">
                    <label className="text-[10px] font-bold text-brand-teal uppercase tracking-wider block">
                      Incoming Lineage Mapping Type
                    </label>
                    <div className="space-y-2">
                      {incomingRels.map((rel) => {
                        let sourceLabel = '';
                        if (rel.source_node_type === 'column') {
                          const srcCol = assets
                            .flatMap((a) => a.columns || [])
                            .find((c) => c.id === rel.source_node_id);
                          const srcAsset = assets.find((a) =>
                            a.columns?.some((c) => c.id === rel.source_node_id)
                          );
                          sourceLabel = srcCol && srcAsset 
                            ? `${srcAsset.name}.${srcCol.name}` 
                            : `Col [${rel.source_node_id.slice(0, 5)}]`;
                        } else {
                          const srcAsset = assets.find((a) => a.id === rel.source_node_id);
                          sourceLabel = srcAsset ? srcAsset.name : `Table [${rel.source_node_id.slice(0, 5)}]`;
                        }

                        return (
                          <div key={rel.id} className="space-y-1.5 p-2.5 bg-workspace-900 border border-workspace-750 rounded-lg">
                            <span className="text-[10px] text-workspace-400 font-mono block truncate">
                              Source: {sourceLabel}
                            </span>
                            <select
                              value={rel.relationship_type || ''}
                              onChange={(e) => {
                                if (onUpdateRelationship) {
                                  onUpdateRelationship(rel.id, {
                                    relationship_type: e.target.value as any || null,
                                  });
                                }
                              }}
                              className="w-full bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg px-2 py-1 text-xs text-workspace-50 outline-none"
                            >
                              <option value="">-- Select Lineage Type (Optional) --</option>
                              <option value="MAPS_TO">MAPS_TO (Direct Schema Map)</option>
                              <option value="DERIVES_FROM">DERIVES_FROM (Transformation Formula)</option>
                              <option value="LOOKUP_FROM">LOOKUP_FROM (Reference Lookup)</option>
                              <option value="COPIED_FROM">COPIED_FROM (Replicated Data)</option>
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Column Edits */}
                <div className="space-y-3.5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider block">Description</label>
                    <textarea
                      rows={3}
                      value={columnDesc}
                      onChange={(e) => setColumnDesc(e.target.value)}
                      className="w-full bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg px-3 py-1.5 text-xs text-workspace-50 outline-none resize-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider block">Business Notes</label>
                    <textarea
                      rows={3}
                      value={columnNotes}
                      onChange={(e) => setColumnNotes(e.target.value)}
                      placeholder="Add calculations, lookup sources, validation rules, etc."
                      className="w-full bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg px-3 py-1.5 text-xs text-workspace-50 outline-none resize-none placeholder-workspace-600"
                    />
                  </div>

                  {/* Column Tags */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-workspace-600 uppercase tracking-wider block">Column Tags</label>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {columnTags.map((tag) => (
                        <span key={tag} className="flex items-center space-x-1 px-2 py-0.5 bg-brand-violet/10 border border-brand-violet/20 text-brand-violet rounded-full text-[10px]">
                          <span>{tag}</span>
                          <button onClick={() => removeColumnTag(tag)} className="hover:text-brand-coral">&times;</button>
                        </span>
                      ))}
                    </div>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={newColumnTag}
                        onChange={(e) => setNewColumnTag(e.target.value)}
                        placeholder="Add column tag"
                        onKeyDown={(e) => e.key === 'Enter' && addColumnTag()}
                        className="flex-1 bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg px-2.5 py-1 text-xs text-workspace-50 outline-none"
                      />
                      <button
                        onClick={addColumnTag}
                        className="p-1 bg-workspace-750 hover:bg-workspace-750 text-brand-teal rounded-lg border border-workspace-750 transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSaveColumn}
                  className="w-full bg-brand-teal hover:bg-brand-teal/80 text-workspace-950 font-bold py-2 rounded-lg flex items-center justify-center space-x-2 shadow-glow-teal transition-all"
                >
                  <CheckCircle size={15} />
                  <span>Save Column Metadata</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
