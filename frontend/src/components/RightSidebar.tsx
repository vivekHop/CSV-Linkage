import React, { useState, useEffect } from 'react';
import { FileSpreadsheet, Columns, User, Calendar, Plus, Trash2, Eye, Tag, FileClock, CheckCircle, Database, Loader2, AlertCircle, Clock } from 'lucide-react';
import { api } from '../api';
import type { Asset, Column, VersionHistory, Relationship } from '../types';
import { useCustomDialog } from './CustomDialog';

// ─── IST date formatter (India Standard Time, UTC+5:30) ───────────────────────
// Backend stores UTC timestamps WITHOUT 'Z' suffix. Browsers treat strings without
// a timezone designator as LOCAL time — appending 'Z' forces UTC interpretation
// so Intl.DateTimeFormat can then correctly convert to Asia/Kolkata (+5:30).
const toUtcIso = (s: string): string => {
  if (!s) return s;
  // Already has timezone info
  if (s.endsWith('Z') || s.includes('+') || /[Tt]\d{2}:\d{2}:\d{2}[-+]/.test(s)) return s;
  return s + 'Z';
};

const fmtIST = (isoStr: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string => {
  if (!isoStr) return 'N/A';
  try {
    const base: Intl.DateTimeFormatOptions = {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    };
    return new Intl.DateTimeFormat('en-IN', { ...base, ...opts }).format(new Date(toUtcIso(isoStr)));
  } catch {
    return isoStr;
  }
};

// Keys stored in custom_attributes for internal canvas use — not user-editable
const SYSTEM_ATTR_KEYS = new Set(['position', 'color', 'width', 'height', 'createdAt']);

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
  showToast?: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

const getTableReferenceName = (assetName: string): string => {
  const bracketMatch = assetName.match(/^(.+?)\s*\[([^\]]+)\]$/);
  if (bracketMatch) {
    const bookName = bracketMatch[1].trim().replace(/\.(xlsx|xls|ods)$/i, '');
    const sheetName = bracketMatch[2].trim();
    return `${bookName}.${sheetName}`;
  }
  return assetName.replace(/\.(csv|xlsx|xls|ods|tsv)$/i, '');
};

const matchesTableName = (assetName: string, tableName: string): boolean => {
  const nameLower = assetName.toLowerCase();
  const queryLower = tableName.toLowerCase().trim();
  
  if (nameLower === queryLower) return true;
  
  // Try to parse workbook and sheet name if they exist in "Workbook.xlsx [Sheet1]" format
  const bracketMatch = assetName.match(/^(.+?)\s*\[([^\]]+)\]$/);
  if (bracketMatch) {
    const bookName = bracketMatch[1].trim();
    const sheetName = bracketMatch[2].trim();
    const bookNameNoExt = bookName.replace(/\.(xlsx|xls|ods|csv|tsv)$/i, '');
    
    const possibleCombinedNames = [
      `${bookName}.${sheetName}`.toLowerCase(),
      `${bookNameNoExt}.${sheetName}`.toLowerCase(),
      sheetName.toLowerCase(),
      assetName.toLowerCase()
    ];
    if (possibleCombinedNames.includes(queryLower)) {
      return true;
    }
  }
  
  // Strip extensions like .csv, .xlsx, .ods, .tsv from the asset name
  const strippedName = nameLower.replace(/\.(csv|xlsx|ods|tsv)$/i, '');
  if (strippedName === queryLower) return true;
  
  // If the asset name without extension contains the table name as a whole word
  if (strippedName.includes(queryLower)) return true;

  return false;
};

interface FormulaInputProps {
  value: string;
  onChange: (val: string) => void;
  assets: Asset[];
  currentAssetId: string | null;
  placeholder?: string;
  rows?: number;
}

const FormulaInput: React.FC<FormulaInputProps> = ({
  value,
  onChange,
  assets,
  currentAssetId,
  placeholder = "e.g., [Table1][Col1] + [Table2][Col2] * 1.5",
  rows = 2
}) => {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<{ label: string; value: string; type: 'table' | 'column' }[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const checkSuggestions = (text: string, position: number) => {
    const textBeforeCursor = text.slice(0, position);
    const lastOpenBracket = textBeforeCursor.lastIndexOf('[');
    const lastCloseBracket = textBeforeCursor.lastIndexOf(']');
    
    if (lastOpenBracket !== -1 && lastOpenBracket > lastCloseBracket) {
      const query = textBeforeCursor.slice(lastOpenBracket + 1);
      const prefix = textBeforeCursor.slice(0, lastOpenBracket).trim();
      const isColumnQuery = prefix.endsWith(']');
      
      if (isColumnQuery) {
        // Find corresponding open bracket of the table name
        const prevOpenBracket = prefix.lastIndexOf('[');
        if (prevOpenBracket !== -1) {
          const tableName = prefix.slice(prevOpenBracket + 1, prefix.length - 1).trim();
          
          // Find matching asset
          const asset = assets.find(a => matchesTableName(a.name, tableName));
          if (asset && asset.columns) {
            const cols = asset.columns
              .filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
              .map(c => ({
                label: c.name,
                value: c.name + ']',
                type: 'column' as const
              }));
            setSuggestions(cols);
            setActiveIndex(0);
            setShowSuggestions(cols.length > 0);
          } else {
            setSuggestions([]);
            setShowSuggestions(false);
          }
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } else {
        // Typing a table name (only show tables)
        const tableSuggestions = assets
          .filter(a => a.asset_type !== 'group' && (
            a.name.toLowerCase().includes(query.toLowerCase()) ||
            getTableReferenceName(a.name).toLowerCase().includes(query.toLowerCase())
          ))
          .map(a => {
            const cleanName = getTableReferenceName(a.name);
            return {
              label: cleanName,
              value: cleanName + ']',
              type: 'table' as const
            };
          });
        setSuggestions(tableSuggestions);
        setActiveIndex(0);
        setShowSuggestions(tableSuggestions.length > 0);
      }
    } else {
      setShowSuggestions(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(prev => (prev + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectSuggestion(suggestions[activeIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
      }
    }
  };

  const selectSuggestion = (suggestion: { label: string; value: string; type: 'table' | 'column' }) => {
    if (!textareaRef.current) return;
    const text = value;
    const textBeforeCursor = text.slice(0, cursorPos);
    const textAfterCursor = text.slice(cursorPos);
    
    const lastOpenBracket = textBeforeCursor.lastIndexOf('[');
    const newTextBefore = textBeforeCursor.slice(0, lastOpenBracket + 1) + suggestion.value;
    const newValue = newTextBefore + textAfterCursor;
    
    onChange(newValue);
    setShowSuggestions(false);
    
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newPos = newTextBefore.length;
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  return (
    <div className="relative w-full">
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          const pos = e.target.selectionStart;
          setCursorPos(pos);
          checkSuggestions(e.target.value, pos);
        }}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Click'].includes(e.key)) {
            const pos = (e.target as HTMLTextAreaElement).selectionStart;
            setCursorPos(pos);
            checkSuggestions(value, pos);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full bg-workspace-800 border border-workspace-750 focus:border-brand-teal rounded-lg px-3 py-2 text-xs font-mono text-workspace-50 outline-none resize-none placeholder-workspace-600"
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute left-0 bottom-full mb-1 w-full max-h-44 overflow-y-auto bg-workspace-900 border border-workspace-700 rounded-lg shadow-xl z-50 p-1 divide-y divide-workspace-800">
          <div className="px-2 py-1 text-[9px] font-bold text-workspace-500 uppercase tracking-wider font-mono">
            Suggestions (Enter to select)
          </div>
          {suggestions.map((suggestion, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => selectSuggestion(suggestion)}
              className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between text-xs font-mono transition-colors ${
                idx === activeIndex
                  ? 'bg-brand-teal/20 text-brand-teal font-bold'
                  : 'text-workspace-200 hover:bg-workspace-800'
              }`}
            >
              <span>{suggestion.label}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${
                suggestion.type === 'table' 
                  ? 'bg-brand-violet/10 text-brand-violet border border-brand-violet/20' 
                  : 'bg-brand-teal/10 text-brand-teal border border-brand-teal/20'
              }`}>
                {suggestion.type}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

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
  showToast,
}) => {
  const dialog = useCustomDialog();
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
  const [columnFormula, setColumnFormula] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

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

  // Keep track of the currently loaded asset/column ID to prevent resetting user edits
  const [prevAssetId, setPrevAssetId] = useState<string | null>(null);
  const [prevColumnId, setPrevColumnId] = useState<string | null>(null);

  // Sync state when selection changes
  useEffect(() => {
    if (selectedAsset) {
      if (selectedAsset.id !== prevAssetId) {
        setAssetName(selectedAsset.name || '');
        setAssetOwner(selectedAsset.owner || '');
        setAssetDesc(selectedAsset.description || '');
        setAssetNotes(selectedAsset.notes || '');
        setAssetTags(selectedAsset.tags || []);
        setPrevAssetId(selectedAsset.id);
        
        // Parse custom attributes — skip internal system keys
        const customAttrs: Record<string, string> = {};
        if (selectedAsset.custom_attributes) {
          Object.entries(selectedAsset.custom_attributes).forEach(([k, v]) => {
            if (!SYSTEM_ATTR_KEYS.has(k)) {
              customAttrs[k] = String(v);
            }
          });
        }
        setAssetCustom(customAttrs);
        setActiveTab('metadata');
        setSelectedVersionSnapshot(null);
        
        // Fetch version history
        fetchVersionHistory(selectedAsset.id);
      }
    } else {
      setPrevAssetId(null);
    }
  }, [selectedAsset, prevAssetId]);

  useEffect(() => {
    if (selectedColumn) {
      if (selectedColumn.id !== prevColumnId) {
        setColumnDesc(selectedColumn.description || '');
        setColumnNotes(selectedColumn.notes || '');
        setColumnTags(selectedColumn.tags || []);
        setColumnFormula(selectedColumn.custom_attributes?.formula || '');
        setPrevColumnId(selectedColumn.id);
      }
    } else {
      setPrevColumnId(null);
    }
  }, [selectedColumn, prevColumnId]);

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
  const handleSaveAsset = async () => {
    if (!selectedAsset) return;

    // Check if anything actually changed before calling backend
    const noChange =
      assetName === (selectedAsset.name || '') &&
      assetOwner === (selectedAsset.owner || '') &&
      assetDesc === (selectedAsset.description || '') &&
      assetNotes === (selectedAsset.notes || '') &&
      JSON.stringify(assetTags) === JSON.stringify(selectedAsset.tags || []) &&
      JSON.stringify(assetCustom) === JSON.stringify(
        Object.fromEntries(
          Object.entries(selectedAsset.custom_attributes || {}).map(([k, v]) => [k, String(v)])
        )
      );

    if (noChange) {
      if (showToast) showToast('No changes to save.', 'info');
      return;
    }

    setIsSaving(true);
    setSaveStatus('saving');

    try {
      await onUpdateAsset(selectedAsset.id, {
        name: assetName,
        owner: assetOwner,
        description: assetDesc,
        notes: assetNotes,
        tags: assetTags,
        custom_attributes: assetCustom,
      });
      setSaveStatus('saved');
      if (showToast) showToast('Table metadata saved!', 'success');
      // Refresh version history to reflect new entry
      fetchVersionHistory(selectedAsset.id);
    } catch (err) {
      setSaveStatus('error');
      if (showToast) showToast('Failed to save table metadata.', 'error');
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveStatus('idle'), 2500);
    }
  };

  const handleSaveColumn = async () => {
    if (!selectedColumn) return;

    // Check if anything actually changed before calling backend
    const noChange =
      columnDesc === (selectedColumn.description || '') &&
      columnNotes === (selectedColumn.notes || '') &&
      JSON.stringify(columnTags) === JSON.stringify(selectedColumn.tags || []) &&
      columnFormula === (selectedColumn.custom_attributes?.formula || '');

    if (noChange) {
      if (showToast) showToast('No changes to save.', 'info');
      return;
    }

    setIsSaving(true);
    setSaveStatus('saving');

    try {
      await onUpdateColumn(selectedColumn.id, {
        description: columnDesc,
        notes: columnNotes,
        tags: columnTags,
        custom_attributes: {
          ...(selectedColumn.custom_attributes || {}),
          formula: columnFormula,
        },
      });
      setSaveStatus('saved');
      if (showToast) showToast('Column metadata saved!', 'success');
    } catch (err) {
      setSaveStatus('error');
      if (showToast) showToast('Failed to save column metadata.', 'error');
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveStatus('idle'), 2500);
    }
  };

  const handleSaveRelationship = async () => {
    if (!selectedEdgeId || !onUpdateRelationship) return;
    const rel = relationships.find((r) => r.id === selectedEdgeId);
    if (rel) {
      setIsSaving(true);
      setSaveStatus('saving');

      const savePromise = onUpdateRelationship(selectedEdgeId, {
        metadata_json: {
          ...rel.metadata_json,
          description: relDesc,
        },
      });

      if (showToast) {
        showToast('Saving relationship metadata...', 'info');
      }

      setTimeout(() => {
        setSaveStatus('saved');
        setIsSaving(false);
        setTimeout(() => setSaveStatus('idle'), 2000);
        if (showToast) {
          showToast('Relationship metadata saved successfully!', 'success');
        }
      }, 200);

      try {
        await savePromise;
      } catch (err) {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
        if (showToast) {
          showToast('Failed to save relationship metadata.', 'error');
        }
      }
    }
  };

  const getSaveButtonClass = () => {
    const base = "w-full font-bold py-2 rounded-lg flex items-center justify-center space-x-2 transition-all duration-300 cursor-pointer ";
    if (saveStatus === 'saving') {
      return base + "bg-brand-teal/40 text-workspace-300 cursor-wait border border-workspace-700";
    }
    if (saveStatus === 'saved') {
      return base + "bg-brand-emerald hover:bg-brand-emerald/90 text-workspace-950 shadow-lg shadow-brand-emerald/20 border border-brand-emerald/40";
    }
    if (saveStatus === 'error') {
      return base + "bg-brand-coral hover:bg-brand-coral/90 text-workspace-950 shadow-lg shadow-brand-coral/20 border border-brand-coral/40";
    }
    return base + "bg-brand-teal hover:bg-brand-teal/90 text-workspace-950 shadow-glow-teal border border-brand-teal/40";
  };

  const renderSaveButtonContent = (defaultText: string) => {
    if (saveStatus === 'saving') {
      return (
        <>
          <Loader2 className="animate-spin text-brand-teal" size={15} />
          <span>Saving to Database...</span>
        </>
      );
    }
    if (saveStatus === 'saved') {
      return (
        <>
          <CheckCircle size={15} />
          <span>Changes Saved!</span>
        </>
      );
    }
    if (saveStatus === 'error') {
      return (
        <>
          <AlertCircle size={15} />
          <span>Error Saving!</span>
        </>
      );
    }
    return (
      <>
        <CheckCircle size={15} />
        <span>{defaultText}</span>
      </>
    );
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
                  onClick={async () => {
                    const confirmed = await dialog.confirm('Delete Link', 'Are you sure you want to delete this lineage connection?', 'danger');
                    if (confirmed) {
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
                  disabled={isSaving}
                  className="w-full font-bold py-2 rounded-lg flex items-center justify-center space-x-2 transition-all duration-300 cursor-pointer bg-brand-emerald hover:bg-brand-emerald/90 text-workspace-950 shadow-lg shadow-brand-emerald/20 border border-brand-emerald/40 disabled:bg-workspace-750 disabled:text-workspace-500 disabled:cursor-wait"
                >
                  {saveStatus === 'saving' ? (
                    <>
                      <Loader2 className="animate-spin text-workspace-950" size={15} />
                      <span>Saving to Database...</span>
                    </>
                  ) : saveStatus === 'saved' ? (
                    <>
                      <CheckCircle size={15} />
                      <span>Changes Saved!</span>
                    </>
                  ) : saveStatus === 'error' ? (
                    <>
                      <AlertCircle size={15} />
                      <span>Error Saving!</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={15} />
                      <span>Save Annotation</span>
                    </>
                  )}
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
                Viewing Version v{selectedVersionSnapshot.version} {selectedVersionSnapshot.is_diff ? 'Changes' : 'Snapshot'}
              </h4>
              <button
                onClick={() => setSelectedVersionSnapshot(null)}
                className="text-[10px] text-workspace-400 hover:text-brand-coral font-medium border border-workspace-750 hover:border-workspace-600 px-2 py-0.5 rounded transition-all"
              >
                Back to Active
              </button>
            </div>
            
            {selectedVersionSnapshot.is_diff ? (
              <div className="bg-workspace-900 border border-workspace-750 rounded-lg p-3 space-y-3 font-mono text-[10px]">
                <span className="text-[10px] font-bold text-workspace-400 block mb-1">Changed Properties:</span>
                <div className="space-y-2">
                  {selectedVersionSnapshot.changes && selectedVersionSnapshot.changes.length > 0 ? (
                    selectedVersionSnapshot.changes.map((change: any, cIdx: number) => (
                      <div key={cIdx} className="border-b border-workspace-750/30 pb-2 last:border-b-0">
                        <span className="text-brand-teal block font-semibold">{change.field}</span>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[9px]">
                          <span className="text-red-400 line-through bg-red-950/20 px-1.5 py-0.5 rounded break-all whitespace-normal" title={change.old}>
                            {change.old || '(empty)'}
                          </span>
                          <span className="text-workspace-500 font-bold">&rarr;</span>
                          <span className="text-green-400 bg-green-950/20 px-1.5 py-0.5 rounded break-all whitespace-normal" title={change.new}>
                            {change.new || '(empty)'}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <span className="text-workspace-500">No changes detected</span>
                  )}
                </div>
              </div>
            ) : (
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
            )}
            <p className="text-[9px] text-workspace-600 italic text-center">
              {selectedVersionSnapshot.is_diff ? 'Diff represents only what changed in this version.' : 'Snapshots represent historical metadata dumps. They are read-only.'}
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
                    <span className="text-workspace-200 truncate max-w-[140px]" title={selectedAsset.created_at}>
                      {fmtIST(selectedAsset.created_at)}
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
                  disabled={isSaving}
                  className={getSaveButtonClass()}
                >
                  {renderSaveButtonContent(`Save Metadata (v${selectedAsset.version})`)}
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
                    {versions.map((ver) => {
                      const istDate = fmtIST(ver.created_at, { day: '2-digit', month: 'short', year: 'numeric', hour12: false });
                      const istTime = fmtIST(ver.created_at, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                      return (
                        <div
                          key={ver.id}
                          className="p-3 bg-workspace-900 border border-workspace-750 hover:border-workspace-600 rounded-lg flex flex-col space-y-1.5 transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-brand-teal font-mono">Version v{ver.version_number}</span>
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="text-[9px] text-workspace-500 font-mono">{istDate}</span>
                              <span className="flex items-center gap-1 text-[9px] text-workspace-600 font-mono">
                                <Clock size={8} />{istTime} IST
                              </span>
                            </div>
                          </div>
                          <p className="text-[10px] text-workspace-200">
                            {ver.change_summary || 'Metadata edit'}
                          </p>
                          <button
                            onClick={() => setSelectedVersionSnapshot(ver.metadata_snapshot)}
                            className="self-end text-[9px] text-brand-teal hover:underline flex items-center space-x-1 mt-1"
                          >
                            <Eye size={10} />
                            <span>View changes</span>
                          </button>
                        </div>
                      );
                    })}
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
                                const newType = e.target.value as any;
                                if (onUpdateRelationship) {
                                  const updates: Partial<Relationship> = {
                                    relationship_type: newType || null,
                                  };
                                  if (newType === 'DERIVES_FROM') {
                                    updates.metadata_json = {
                                      ...(rel.metadata_json || {}),
                                      formula: rel.metadata_json?.formula || columnFormula || ''
                                    };
                                  }
                                  onUpdateRelationship(rel.id, updates);
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

                    {incomingRels.some((r) => r.relationship_type === 'DERIVES_FROM') && (
                      <div className="mt-3 space-y-1.5 p-3 bg-workspace-900 border border-workspace-750 rounded-xl">
                        <label className="text-[10px] font-bold text-brand-teal uppercase tracking-wider block font-mono">
                          Derivation Formula / Expression
                        </label>
                        <FormulaInput
                          value={columnFormula}
                          onChange={setColumnFormula}
                          assets={assets}
                          currentAssetId={selectedAsset ? selectedAsset.id : null}
                          placeholder="e.g., [TableA][ColA] + [TableB][ColB] * 1.5"
                          rows={2}
                        />
                        <span className="text-[9px] text-workspace-500 font-mono block leading-normal mt-1">
                          Define how this column is calculated from its sources. Use <code className="text-brand-teal bg-workspace-800 px-1 py-0.5 rounded">[Table][Column]</code> format.
                        </span>
                      </div>
                    )}
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
                  disabled={isSaving}
                  className={getSaveButtonClass()}
                >
                  {renderSaveButtonContent('Save Column Metadata')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
