import React, { useState, useEffect } from 'react';
import { 
  X, Check, Trash2, Plus, FileSpreadsheet, 
  Sparkles, Save, FileText, AlertCircle, ArrowRight
} from 'lucide-react';
import { api } from '../api';
import type { ImportDraft } from '../types';
import { useCustomDialog } from './CustomDialog';

// IST date+time formatter
// Backend returns UTC without 'Z' — append it so browsers parse as UTC, not local time.
const toUtcIso = (s: string): string => {
  if (!s) return s;
  if (s.endsWith('Z') || s.includes('+') || /[Tt]\d{2}:\d{2}:\d{2}[-+]/.test(s)) return s;
  return s + 'Z';
};
const fmtIST = (isoStr: string | null | undefined): string => {
  if (!isoStr) return 'N/A';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date(toUtcIso(isoStr)));
  } catch { return isoStr; }
};

interface ImportPreviewModalProps {
  isOpen: boolean;
  onClose: (savedDraft?: boolean) => void;
  onImportComplete: () => void;
  initialData?: {
    assets: any[];
    relationships: any[];
  };
  files?: FileList | File[] | null;
  showToast?: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export const ImportPreviewModal: React.FC<ImportPreviewModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
  initialData,
  files,
  showToast
}) => {
  const dialog = useCustomDialog();
  const [assets, setAssets] = useState<any[]>([]);
  const [relationships, setRelationships] = useState<any[]>([]);
  const [selectedAssetIdx, setSelectedAssetIdx] = useState<number>(0);
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState('STRING');
  const [isDirty, setIsDirty] = useState(false);
  const [existingColumns, setExistingColumns] = useState<any[]>([]);
  const [showAllLineages, setShowAllLineages] = useState(false);
  
  // Draft management
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [showDraftsList, setShowDraftsList] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [showSaveDraftPrompt, setShowSaveDraftPrompt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);

  // Levenshtein-based similarity matching (ratio from 0 to 100)
  const calcSimilarity = (s1: string, s2: string): number => {
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1].toLowerCase() === s2[j - 1].toLowerCase()) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + 1
          );
        }
      }
    }

    const distance = dp[m][n];
    const maxLen = Math.max(m, n);
    if (maxLen === 0) return 100;
    return ((maxLen - distance) / maxLen) * 100;
  };

  // Initialize data when modal opens
  useEffect(() => {
    if (isOpen) {
      setLoadedDraftId(null);
      if (initialData && initialData.assets.length > 0) {
        setAssets(JSON.parse(JSON.stringify(initialData.assets)));
        setRelationships(JSON.parse(JSON.stringify(initialData.relationships)));
        setIsDirty(true); // New file loaded, prompt to save if close
      } else {
        setAssets([]);
        setRelationships([]);
        setIsDirty(false);
      }
      setSelectedAssetIdx(0);
      setError(null);
      setShowSaveDraftPrompt(false); // Reset prompt overlay
      setShowDraftsList(false); // Reset drafts panel
      setDraftName(''); // Reset draft name input
      fetchDrafts();

      // Fetch all existing workspace columns for manual column fuzzy matching
      api.getAssets().then(assetsList => {
        const cols: any[] = [];
        assetsList.forEach(asset => {
          if (asset.columns) {
            asset.columns.forEach(col => {
              cols.push({
                id: col.id,
                name: col.name,
                assetName: asset.name
              });
            });
          }
        });
        setExistingColumns(cols);
      }).catch(err => {
        console.error("Failed to load existing columns for fuzzy matching:", err);
      });
    }
  }, [isOpen, initialData]);

  const fetchDrafts = async () => {
    try {
      const data = await api.getDrafts();
      setDrafts(data);
    } catch (err: any) {
      console.error('Failed to load drafts:', err);
    }
  };

  if (!isOpen) return null;

  const currentAsset = assets[selectedAssetIdx] || null;

  // Toggle Asset selection status (for bulk import choice)
  const toggleAssetEnabled = (idx: number) => {
    const newAssets = [...assets];
    newAssets[idx]._disabled = !newAssets[idx]._disabled;
    setAssets(newAssets);
    setIsDirty(true);
  };

  // Remove an asset entirely from the import plan
  const removeAsset = (idx: number) => {
    const assetToRemove = assets[idx];
    const newAssets = assets.filter((_, i) => i !== idx);
    setAssets(newAssets);
    setIsDirty(true);
    
    // Clean up associated relationships
    if (assetToRemove) {
      const colIds = (assetToRemove.columns || []).map((c: any) => c.temp_id);
      setRelationships(relationships.filter(rel => 
        rel.source_node_id !== assetToRemove.temp_id &&
        rel.destination_node_id !== assetToRemove.temp_id &&
        !colIds.includes(rel.source_node_id) &&
        !colIds.includes(rel.destination_node_id)
      ));
    }
    
    if (selectedAssetIdx >= newAssets.length) {
      setSelectedAssetIdx(Math.max(0, newAssets.length - 1));
    }
  };

  // Toggle individual column selection
  const toggleColumnEnabled = (colIdx: number) => {
    if (!currentAsset) return;
    const newAssets = [...assets];
    const cols = [...newAssets[selectedAssetIdx].columns];
    cols[colIdx]._disabled = !cols[colIdx]._disabled;
    newAssets[selectedAssetIdx].columns = cols;
    setAssets(newAssets);
    setIsDirty(true);
  };

  // Remove a column entirely
  const removeColumn = (colIdx: number) => {
    if (!currentAsset) return;
    const newAssets = [...assets];
    const cols = [...newAssets[selectedAssetIdx].columns];
    const colToRemove = cols[colIdx];
    const updatedCols = cols.filter((_, i) => i !== colIdx);
    newAssets[selectedAssetIdx].columns = updatedCols;
    setAssets(newAssets);
    setIsDirty(true);

    // Clean up relationships
    if (colToRemove) {
      setRelationships(relationships.filter(rel => 
        rel.source_node_id !== colToRemove.temp_id && rel.destination_node_id !== colToRemove.temp_id
      ));
    }
  };

  // Add new column manually
  const handleAddColumn = () => {
    if (!currentAsset || !newColName.trim()) return;
    
    const tempColId = `temp_column_manual_${Math.random().toString(36).substr(2, 9)}`;
    const newCol = {
      temp_id: tempColId,
      name: newColName.trim(),
      datatype: newColType,
      nullable_percentage: 0.0,
      distinct_count: 0,
      duplicate_count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      sample_values: [],
      description: `Manually added column '${newColName.trim()}'`,
      notes: '',
      tags: ['manual'],
      custom_attributes: {}
    };

    const newAssets = [...assets];
    newAssets[selectedAssetIdx].columns = [...newAssets[selectedAssetIdx].columns, newCol];
    setAssets(newAssets);
    setIsDirty(true);

    // Run fuzzy similarity matching against existing DB columns
    const proposedRels: any[] = [];
    existingColumns.forEach(existCol => {
      const score = calcSimilarity(newCol.name, existCol.name);
      if (score >= 80) {
        proposedRels.push({
          source_node_type: 'column',
          source_node_id: existCol.id,
          destination_node_type: 'column',
          destination_node_id: tempColId,
          relationship_type: 'COPIED_FROM',
          metadata_json: {
            similarity: score,
            matched_from: existCol.name,
            source_table: existCol.assetName
          }
        });
      }
    });

    if (proposedRels.length > 0) {
      setRelationships(prev => [...prev, ...proposedRels]);
    }
    
    setNewColName('');
  };

  // Helper to check if a node (table or column) is enabled
  const isNodeEnabled = (id: string): boolean => {
    // Check if it's an asset (table)
    const asset = assets.find(a => a.temp_id === id);
    if (asset) {
      return !asset._disabled;
    }
    
    // Check if it's a column in one of the assets
    for (const a of assets) {
      if (a._disabled) continue;
      const col = a.columns?.find((c: any) => c.temp_id === id);
      if (col) {
        return !col._disabled;
      }
    }
    
    return true;
  };

  // Check if a node ID belongs to the currently selected asset (either the asset itself or one of its columns)
  const isNodeOfSelectedAsset = (id: string): boolean => {
    if (!currentAsset) return false;
    if (currentAsset.temp_id === id) return true;
    return (currentAsset.columns || []).some((c: any) => c.temp_id === id);
  };

  // Dynamically filter relationships based on enabled assets/columns and selected asset filter
  const visibleRelationships = relationships.filter(rel => {
    const enabled = isNodeEnabled(rel.source_node_id) && isNodeEnabled(rel.destination_node_id);
    if (!enabled) return false;
    
    // If "Show All" is selected, don't filter by selected asset
    if (showAllLineages) return true;
    
    // Otherwise, it must involve the selected asset (source or destination)
    return isNodeOfSelectedAsset(rel.source_node_id) || isNodeOfSelectedAsset(rel.destination_node_id);
  });

  // Toggle proposed relationship selection
  const toggleRelationshipEnabled = (relIdxInVisible: number) => {
    const rel = visibleRelationships[relIdxInVisible];
    const actualIdx = relationships.findIndex(r => r === rel);
    if (actualIdx !== -1) {
      const newRels = [...relationships];
      newRels[actualIdx]._disabled = !newRels[actualIdx]._disabled;
      setRelationships(newRels);
      setIsDirty(true);
    }
  };

  // Helper to find column name by ID (either in new tables or existing db)
  const getColNameById = (id: string): string => {
    // Search in proposed assets
    for (const asset of assets) {
      for (const col of asset.columns || []) {
        if (col.temp_id === id) {
          const sheetName = asset.name.split(' [')[1]?.slice(0, -1) || asset.name;
          return `${sheetName}.${col.name}`;
        }
      }
    }
    // Search in existing DB columns
    const existCol = existingColumns.find(c => c.id === id);
    if (existCol) {
      return `${existCol.assetName}.${existCol.name}`;
    }
    // Return display name or ID
    return id;
  };

  // Save as Draft
  const handleSaveDraft = async () => {
    if (!draftName.trim()) return;
    setLoading(true);
    if (showToast) showToast('Saving draft...', 'info');
    try {
      await api.saveDraft({
        name: draftName.trim(),
        draft_json: {
          assets: assets,
          relationships: relationships
        }
      });
      
      setShowSaveDraftPrompt(false);
      setDraftName('');
      setIsDirty(false);
      fetchDrafts();
      if (showToast) {
        showToast('Import draft saved successfully!', 'success');
      } else {
        await dialog.alert('Success', 'Draft saved successfully!', 'success');
      }
      onClose(true); // Close the modal
    } catch (err: any) {
      setError(err.message || 'Failed to save draft');
      if (showToast) showToast('Failed to save draft.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Load Draft
  const handleLoadDraft = (draft: ImportDraft) => {
    setAssets(JSON.parse(JSON.stringify(draft.draft_json.assets || [])));
    setRelationships(JSON.parse(JSON.stringify(draft.draft_json.relationships || [])));
    setSelectedAssetIdx(0);
    setShowDraftsList(false);
    setIsDirty(false); // Clean after loading saved draft
    setError(null);
    setLoadedDraftId(draft.id);
    if (showToast) showToast('Loaded import draft.', 'success');
  };

  // Delete Draft
  const handleDeleteDraft = async (draftId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await dialog.confirm('Delete Draft', 'Are you sure you want to delete this draft?', 'danger');
    if (!confirmed) return;
    if (showToast) showToast('Deleting draft...', 'info');
    try {
      await api.deleteDraft(draftId);
      fetchDrafts();
      if (showToast) showToast('Draft successfully deleted.', 'success');
    } catch (err: any) {
      if (showToast) {
        showToast('Failed to delete draft: ' + err.message, 'error');
      } else {
        await dialog.alert('Error', 'Failed to delete draft: ' + err.message, 'danger');
      }
    }
  };

  // Finalize & Persist
  const handleFinalize = async () => {
    setLoading(true);
    setError(null);
    if (showToast) showToast('Saving workspace to database...', 'info');
    try {
      // Filter out disabled assets, columns
      const activeAssets = assets
        .filter(a => !a._disabled)
        .map(a => ({
          ...a,
          columns: (a.columns || []).filter((c: any) => !c._disabled)
        }));

      // Only save relationships where both source and destination are enabled
      const activeRelationships = relationships.filter(rel => 
        !rel._disabled && isNodeEnabled(rel.source_node_id) && isNodeEnabled(rel.destination_node_id)
      );

      if (activeAssets.length === 0) {
        throw new Error('Please select at least one sheet/table to import.');
      }

      await api.finalizeImport({
        assets: activeAssets,
        relationships: activeRelationships
      });

      // If we loaded a saved draft, delete it from drafts since it is now persistent workspace data
      if (loadedDraftId) {
        try {
          await api.deleteDraft(loadedDraftId);
        } catch (err) {
          console.error("Failed to delete draft on finalize:", err);
        }
      }

      onImportComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to finalize import');
      if (showToast) showToast('Failed to finalize import.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Handles close click (ask to save as draft only if there's unsaved/dirty data)
  const handleCloseAttempt = () => {
    if (isDirty && assets.length > 0) {
      setShowSaveDraftPrompt(true);
    } else {
      onClose(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-workspace-950/80 backdrop-blur-md">
      <div className="relative flex flex-col w-11/12 max-w-7xl h-[85vh] bg-workspace-900 border border-workspace-800 rounded-2xl shadow-2xl text-workspace-100 overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-workspace-950/50 border-b border-workspace-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-white">Excel Sheet Import Studio</h2>
              <p className="text-xs text-workspace-400">Configure tables, columns, and auto-discovered lineages before saving</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowDraftsList(!showDraftsList)}
              className="px-3.5 py-1.5 rounded-lg border border-workspace-700 bg-workspace-850 hover:bg-workspace-800 text-xs font-semibold flex items-center space-x-1.5 transition duration-150"
            >
              <FileText size={14} />
              <span>Drafts ({drafts.length})</span>
            </button>
            <button
              onClick={handleCloseAttempt}
              className="p-1.5 rounded-lg hover:bg-workspace-800 text-workspace-400 hover:text-white transition duration-150"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content Layout */}
        <div className="flex-1 flex overflow-x-auto overflow-y-hidden min-h-0">
          
          {/* List of Drafts Overlay Panel */}
          {showDraftsList && (
            <div className="absolute inset-y-0 right-0 z-10 w-96 bg-workspace-950 border-l border-workspace-800 shadow-2xl flex flex-col p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-white text-sm">Saved Import Drafts</h3>
                <button 
                  onClick={() => setShowDraftsList(false)}
                  className="p-1 rounded-md hover:bg-workspace-800 text-workspace-400"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2">
                {drafts.length === 0 ? (
                  <p className="text-xs text-workspace-500 text-center py-8">No saved drafts found.</p>
                ) : (
                  drafts.map(draft => (
                    <div
                      key={draft.id}
                      onClick={() => handleLoadDraft(draft)}
                      className="p-3 rounded-lg border border-workspace-800 bg-workspace-900/50 hover:bg-workspace-800 cursor-pointer flex items-center justify-between group transition"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="text-xs font-semibold text-white truncate">{draft.name}</p>
                        <p className="text-[10px] text-workspace-400">
                          {fmtIST(draft.created_at)}
                        </p>
                      </div>
                      <button
                        onClick={(e) => handleDeleteDraft(draft.id, e)}
                        className="p-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 opacity-0 group-hover:opacity-100 transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Left Column: Tables / Sheets list */}
          <div className="w-[300px] shrink-0 border-r border-workspace-800 bg-workspace-950/20 flex flex-col min-h-0">
            <div className="p-4 border-b border-workspace-800 bg-workspace-950/30">
              <span className="text-[10px] font-bold uppercase tracking-wider text-workspace-400">Tables (Sheets)</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {assets.length === 0 ? (
                <div className="text-center py-10 text-xs text-workspace-500">
                  No sheets detected. Select an Excel file to begin.
                </div>
              ) : (
                assets.map((asset, idx) => (
                  <div
                    key={asset.temp_id || idx}
                    onClick={() => setSelectedAssetIdx(idx)}
                    className={`p-3 rounded-lg border flex items-center justify-between cursor-pointer group transition ${
                      selectedAssetIdx === idx
                        ? 'border-indigo-500 bg-indigo-500/10 text-white'
                        : asset._disabled
                        ? 'border-workspace-800/50 opacity-50 bg-workspace-950/10'
                        : 'border-workspace-850 bg-workspace-900/40 hover:bg-workspace-850 text-workspace-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                      <input 
                        type="checkbox"
                        checked={!asset._disabled}
                        onChange={() => toggleAssetEnabled(idx)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-workspace-700 bg-workspace-800 text-indigo-500 focus:ring-0 cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate text-workspace-100">
                          {asset.name.split(' [')[1]?.slice(0, -1) || asset.name}
                        </p>
                        <p className="text-[10px] text-workspace-400">
                          {asset.columns?.length || 0} cols • {asset.row_count || 0} rows
                        </p>
                      </div>
                    </div>
                    
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAsset(idx);
                      }}
                      className="p-1 rounded hover:bg-red-500/20 text-workspace-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Middle Column: Columns editor */}
          <div className="w-[450px] shrink-0 flex flex-col border-r border-workspace-800 bg-workspace-900/30 min-h-0">
            <div className="p-4 border-b border-workspace-800 bg-workspace-950/30 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-workspace-400">Columns Editor</span>
                {currentAsset && (
                  <h3 className="text-xs font-semibold text-white mt-0.5">
                    {currentAsset.name.split(' [')[1]?.slice(0, -1) || currentAsset.name}
                  </h3>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {!currentAsset ? (
                <div className="h-full flex items-center justify-center text-xs text-workspace-500">
                  Select a sheet from the left to view columns.
                </div>
              ) : (
                currentAsset.columns.map((col: any, cIdx: number) => (
                  <div
                    key={col.temp_id || cIdx}
                    className={`flex items-center justify-between p-2.5 rounded-lg border transition ${
                      col._disabled 
                        ? 'border-workspace-800 bg-workspace-950/10 opacity-50' 
                        : 'border-workspace-800 bg-workspace-900/60 hover:bg-workspace-850'
                    }`}
                  >
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <input 
                        type="checkbox"
                        checked={!col._disabled}
                        onChange={() => toggleColumnEnabled(cIdx)}
                        className="rounded border-workspace-700 bg-workspace-800 text-indigo-500 focus:ring-0 cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-semibold text-white truncate">{col.name}</span>
                          <span className="px-1.5 py-0.5 rounded bg-workspace-800 text-[9px] font-mono text-workspace-400">
                            {col.datatype}
                          </span>
                        </div>
                        {col.custom_attributes?.formula && (
                          <div className="text-[10px] text-green-400 font-mono mt-1 truncate bg-green-500/5 px-1.5 py-0.5 rounded border border-green-500/10">
                            f = {col.custom_attributes.formula}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <button
                      onClick={() => removeColumn(cIdx)}
                      className="p-1 rounded hover:bg-red-500/10 text-workspace-500 hover:text-red-400 transition"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Add Column Input Form */}
            {currentAsset && (
              <div className="p-4 border-t border-workspace-800 bg-workspace-950/20 flex items-center space-x-2">
                <input
                  type="text"
                  placeholder="New column name..."
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  className="flex-1 bg-workspace-900 border border-workspace-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-workspace-500 focus:outline-none focus:border-indigo-500"
                />
                <select
                  value={newColType}
                  onChange={(e) => setNewColType(e.target.value)}
                  className="bg-workspace-900 border border-workspace-700 rounded-lg px-2 py-1.5 text-xs text-workspace-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="STRING">STRING</option>
                  <option value="INTEGER">INTEGER</option>
                  <option value="FLOAT">FLOAT</option>
                  <option value="BOOLEAN">BOOLEAN</option>
                  <option value="DATETIME">DATETIME</option>
                </select>
                <button
                  onClick={handleAddColumn}
                  className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Proposed Lineages */}
          <div className="w-[490px] shrink-0 bg-workspace-950/10 flex flex-col min-h-0">
            <div className="p-4 border-b border-workspace-800 bg-workspace-950/30 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-workspace-400">Proposed Lineage Links</span>
              <label className="flex items-center space-x-1.5 text-xs text-workspace-400 hover:text-white cursor-pointer select-none">
                <input 
                  type="checkbox"
                  checked={showAllLineages}
                  onChange={(e) => setShowAllLineages(e.target.checked)}
                  className="rounded border-workspace-700 bg-workspace-800 text-indigo-500 focus:ring-0 cursor-pointer"
                />
                <span>Show All</span>
              </label>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {visibleRelationships.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-4">
                  <Sparkles size={24} className="text-workspace-600 mb-2" />
                  <p className="text-xs text-workspace-50">No formula derivations or high-similarity column matches found for selected columns.</p>
                </div>
              ) : (
                visibleRelationships.map((rel, relIdx) => {
                  const isFormula = rel.relationship_type === 'DERIVES_FROM';
                  
                  return (
                    <div
                      key={relIdx}
                      className={`p-3 rounded-lg border transition ${
                        rel._disabled
                          ? 'border-workspace-800 bg-workspace-950/10 opacity-50'
                          : 'border-workspace-800 bg-workspace-900/60'
                      }`}
                    >
                      <div className="flex items-start space-x-2.5">
                        <input
                          type="checkbox"
                          checked={!rel._disabled}
                          onChange={() => toggleRelationshipEnabled(relIdx)}
                          className="mt-0.5 rounded border-workspace-700 bg-workspace-800 text-indigo-500 focus:ring-0 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-workspace-300">
                            <span className="font-semibold text-white break-all" title={getColNameById(rel.source_node_id)}>
                              {getColNameById(rel.source_node_id)}
                            </span>
                            <ArrowRight size={12} className="text-workspace-500 shrink-0" />
                            <span className="font-semibold text-white break-all" title={getColNameById(rel.destination_node_id)}>
                              {getColNameById(rel.destination_node_id)}
                            </span>
                          </div>

                          <div className="flex items-center space-x-2 mt-2">
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wide font-mono ${
                              isFormula 
                                ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                            }`}>
                              {rel.relationship_type}
                            </span>
                            {!isFormula && rel.metadata_json?.similarity && (
                              <span className="text-[10px] text-indigo-400 font-semibold font-mono">
                                {Math.round(rel.metadata_json.similarity)}% Match
                              </span>
                            )}
                          </div>

                          {isFormula && rel.metadata_json?.formula && (
                            <div className="text-[10px] font-mono text-green-400 bg-green-500/5 px-2 py-1 rounded border border-green-500/10 mt-2 break-all whitespace-normal">
                              {rel.metadata_json.formula}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-workspace-950/50 border-t border-workspace-800 flex items-center justify-between">
          <div className="flex items-center text-xs text-workspace-400">
            {error ? (
              <span className="text-red-400 flex items-center space-x-1">
                <AlertCircle size={14} />
                <span>{error}</span>
              </span>
            ) : (
              <span className="flex items-center space-x-1.5">
                <Sparkles size={14} className="text-indigo-400 animate-pulse" />
                <span>Double-check formula mappings and fuzzy links before completing import.</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={handleCloseAttempt}
              className="px-4 py-2 rounded-lg border border-workspace-700 bg-workspace-805 hover:bg-workspace-700 text-xs font-semibold transition"
            >
              Cancel
            </button>
            <button
              onClick={handleFinalize}
              disabled={loading}
              className="px-4.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-650 text-xs font-bold text-white shadow-lg flex items-center space-x-1.5 transition duration-150"
            >
              {loading ? (
                <span>Persisting...</span>
              ) : (
                <>
                  <Check size={14} />
                  <span>Accept Import</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Save Draft Prompt Dialog */}
        {showSaveDraftPrompt && (
          <div className="absolute inset-0 bg-workspace-950/90 flex items-center justify-center p-4 z-40">
            <div className="w-full max-w-md bg-workspace-900 border border-workspace-800 rounded-xl p-5 shadow-2xl text-workspace-100">
              <h3 className="text-sm font-bold text-white mb-2 flex items-center space-x-2">
                <Save size={16} className="text-indigo-400" />
                <span>Save Import Draft?</span>
              </h3>
              <p className="text-xs text-workspace-400 mb-4 leading-relaxed">
                You are closing the import preview with unfinalized sheets. Save this import state as a draft so you or other team members can load it later.
              </p>
              
              <input
                type="text"
                placeholder="Draft name (e.g. Sales Q2 Draft)..."
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-full bg-workspace-950 border border-workspace-700 rounded-lg px-3 py-2 text-xs text-white placeholder-workspace-500 focus:outline-none focus:border-indigo-500 mb-5"
              />

              <div className="flex items-center justify-end space-x-2 text-xs">
                <button
                  onClick={() => onClose(false)}
                  className="px-3.5 py-2 rounded-lg hover:bg-workspace-800 border border-workspace-700 font-semibold"
                >
                  Discard Draft
                </button>
                <button
                  onClick={handleSaveDraft}
                  disabled={!draftName.trim() || loading}
                  className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-55 text-white font-bold flex items-center space-x-1.5 transition"
                >
                  <Save size={13} />
                  <span>Save Draft</span>
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
