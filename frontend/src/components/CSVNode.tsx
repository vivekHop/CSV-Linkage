import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { Table, Trash2 } from 'lucide-react';
import type { Column } from '../types';

interface CSVNodeData {
  id: string;
  name: string;
  row_count?: number;
  column_count?: number;
  columns: Column[];
  onDeleteAsset?: (id: string) => void;
  onSelectColumn?: (col: Column) => void;
  onSelectAssetHeader?: (assetId: string) => void;
  selectedAssetId?: string | null;
  selectedColumnId?: string | null;
  
  // Connection state for interactive UX
  connectingState?: { nodeId: string; handleId: string | null; handleType: 'source' | 'target' } | null;
  
  // Highlight states when tracing edges
  highlightedNodeIds?: string[];
  highlightedColumnIds?: string[];
}

const DataTypeBadge = ({ type }: { type: string }) => {
  let colorClass = 'bg-workspace-700 text-workspace-200';
  if (type === 'INTEGER') colorClass = 'bg-blue-900/40 text-blue-300 border border-blue-800/60';
  else if (type === 'FLOAT') colorClass = 'bg-yellow-900/40 text-yellow-300 border border-yellow-800/60';
  else if (type === 'STRING') colorClass = 'bg-brand-teal/10 text-brand-teal border border-brand-teal/20';
  else if (type === 'BOOLEAN') colorClass = 'bg-brand-emerald/10 text-brand-emerald border border-brand-emerald/20';
  else if (type === 'DATETIME') colorClass = 'bg-brand-violet/10 text-brand-violet border border-brand-violet/20';

  return (
    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold ${colorClass}`}>
      {type}
    </span>
  );
};

export const CSVNode = memo(({ data, isConnectable }: NodeProps<CSVNodeData>) => {
  const {
    id,
    name,
    row_count,
    column_count,
    columns = [],
    onDeleteAsset,
    onSelectColumn,
    onSelectAssetHeader,
    selectedAssetId,
    selectedColumnId,
    connectingState,
    highlightedNodeIds = [],
    highlightedColumnIds = [],
  } = data;

  const isAssetSelected = selectedAssetId === id && !selectedColumnId;
  const isHighlighted = highlightedNodeIds.includes(id);
  const isAnyHighlightActive = highlightedNodeIds.length > 0;

  // Connecting mode variables
  const isConnecting = !!connectingState;
  const isDragOrigin = isConnecting && connectingState?.nodeId === id;
  
  // Determine if this node is acting as Source or Destination
  let connectionRole: 'source' | 'destination' | null = null;
  if (isConnecting && connectingState) {
    if (connectingState.handleType === 'source') {
      connectionRole = isDragOrigin ? 'source' : 'destination';
    } else {
      connectionRole = isDragOrigin ? 'destination' : 'source';
    }
  }

  // Dimming logic
  let dimClass = '';
  if (isConnecting) {
    if (isDragOrigin && connectionRole === 'destination') {
      dimClass = 'opacity-40 scale-[0.98] blur-[0.5px]';
    }
  } else if (isAnyHighlightActive && !isHighlighted) {
    dimClass = 'opacity-30 scale-[0.98] blur-[0.5px]';
  }

  // Border highlighting
  let borderClass = 'border-workspace-750 hover:border-workspace-600';
  if (isConnecting) {
    if (isDragOrigin) {
      borderClass = connectionRole === 'source' 
        ? 'border-brand-coral shadow-glow-coral ring-2 ring-brand-coral/30'
        : 'border-brand-violet shadow-glow-violet ring-2 ring-brand-violet/30';
    } else {
      borderClass = connectionRole === 'destination'
        ? 'border-brand-violet/50 hover:border-brand-violet border-dashed'
        : 'border-brand-coral/50 hover:border-brand-coral border-dashed';
    }
  } else if (isAssetSelected) {
    borderClass = 'border-brand-teal shadow-glow-teal ring-1 ring-brand-teal/50';
  } else if (isHighlighted) {
    borderClass = 'border-brand-emerald shadow-glow-emerald ring-2 ring-brand-emerald/40 animate-pulse';
  }

  return (
    <div
      className={`w-72 bg-workspace-800 border-2 rounded-xl overflow-hidden shadow-2xl transition-all duration-300 relative ${dimClass} ${borderClass}`}
    >
      {/* Node Header (Spacious padding: px-5 py-4) */}
      <div 
        className="relative bg-workspace-850 px-5 py-4 border-b border-workspace-750 flex items-center justify-between cursor-pointer group/header"
        onClick={(e) => {
          e.stopPropagation();
          if (onSelectAssetHeader) {
            onSelectAssetHeader(id);
          }
        }}
      >
        {/* Asset Left Handle (Target, larger: handle-header) */}
        <Handle
          type="target"
          position={Position.Left}
          id="asset-target"
          isConnectable={isConnectable}
          className={`!top-1/2 -translate-y-1/2 handle-header !bg-brand-violet !border-workspace-850 hover:scale-125 transition-all ${
            isConnecting && connectingState?.handleType === 'target' ? 'opacity-0 pointer-events-none' : ''
          }`}
        />

        <div className="flex items-center space-x-3 min-w-0 pr-4">
          <div className="p-1.5 bg-workspace-750 rounded-lg text-brand-teal">
            <Table size={16} />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-workspace-50 truncate group-hover/header:text-brand-teal transition-colors">
              {name}
            </h4>
            <p className="text-[10px] text-workspace-400 font-medium mt-0.5">
              {column_count || columns.length} Cols • {row_count?.toLocaleString() || 0} Rows
            </p>
          </div>
        </div>

        {/* Delete Table Trigger */}
        {onDeleteAsset && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteAsset(id);
            }}
            className="p-1 hover:bg-workspace-750 text-workspace-600 hover:text-brand-coral rounded transition-all opacity-0 group-hover/header:opacity-100"
            title="Delete table metadata"
          >
            <Trash2 size={13} />
          </button>
        )}

        {/* Asset Right Handle (Source, larger: handle-header) */}
        <Handle
          type="source"
          position={Position.Right}
          id="asset-source"
          isConnectable={isConnectable}
          className={`!top-1/2 -translate-y-1/2 handle-header !bg-brand-coral !border-workspace-850 hover:scale-125 transition-all ${
            isConnecting && connectingState?.handleType === 'source' ? 'opacity-0 pointer-events-none' : ''
          }`}
        />
      </div>

      {/* Columns List (Spacious padding: p-2 bg-workspace-800 space-y-1) */}
      <div className="p-2 bg-workspace-800 space-y-1">
        {columns.map((col) => {
          const isColSelected = selectedColumnId === col.id;
          const isColHighlighted = highlightedColumnIds.includes(col.id);
          const hasNotes = !!col.notes;
          const hasTags = col.tags && col.tags.length > 0;

          // Column dimming
          let colDimClass = '';
          if (isAnyHighlightActive && !isColHighlighted) {
            colDimClass = 'opacity-30';
          }

          // Column Highlight Border
          let colBorderClass = 'border-transparent text-workspace-200';
          if (isColSelected) {
            colBorderClass = 'bg-workspace-750 border-brand-teal/30 text-workspace-50 shadow-sm';
          } else if (isColHighlighted) {
            colBorderClass = 'bg-brand-emerald/10 border-brand-emerald/40 text-workspace-50 shadow-sm font-semibold scale-[1.01]';
          }

          return (
            <div
              key={col.id}
              onClick={(e) => {
                e.stopPropagation();
                if (onSelectColumn) {
                  onSelectColumn(col);
                }
              }}
              // Column cell padding (px-4 py-2.5)
              className={`relative px-4 py-2.5 flex items-center justify-between rounded-lg cursor-pointer hover:bg-workspace-750 transition-all border group/col ${colDimClass} ${colBorderClass}`}
            >
              {/* Column Left Handle (Target, larger: handle-column) */}
              <Handle
                type="target"
                position={Position.Left}
                id={`col-target-${col.id}`}
                isConnectable={isConnectable}
                className={`!top-1/2 -translate-y-1/2 handle-column !bg-brand-violet !border-workspace-850 hover:scale-150 transition-all ${
                  isConnecting && connectingState?.handleType === 'target' ? 'opacity-0 pointer-events-none' : ''
                }`}
              />

              <div className="flex items-center space-x-2.5 min-w-0 pr-1">
                <span className="text-xs font-mono truncate font-medium group-hover/col:text-brand-teal transition-colors">
                  {col.name}
                </span>
                
                {/* Visual Indicators for column state */}
                <div className="flex space-x-1 shrink-0">
                  {hasNotes && (
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-teal" title="Has business notes" />
                  )}
                  {hasTags && (
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-violet" title="Has tags" />
                  )}
                </div>
              </div>

              <div className="flex items-center">
                <DataTypeBadge type={col.datatype} />
              </div>

              {/* Column Right Handle (Source, larger: handle-column) */}
              <Handle
                type="source"
                position={Position.Right}
                id={`col-source-${col.id}`}
                isConnectable={isConnectable}
                className={`!top-1/2 -translate-y-1/2 handle-column !bg-brand-coral !border-workspace-850 hover:scale-150 transition-all ${
                  isConnecting && connectingState?.handleType === 'source' ? 'opacity-0 pointer-events-none' : ''
                }`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

CSVNode.displayName = 'CSVNode';
