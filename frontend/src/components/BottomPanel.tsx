import React, { useState } from 'react';
import { Network, History, Trash2, ArrowRight, Clock, Database, Columns, PlusCircle, AlertCircle, RefreshCw } from 'lucide-react';
import type { Asset, Relationship, ActivityLog } from '../types';

interface BottomPanelProps {
  assets: Asset[];
  relationships: Relationship[];
  activities: ActivityLog[];
  onDeleteRelationship: (relId: string) => void;
}

export const BottomPanel: React.FC<BottomPanelProps> = ({
  assets,
  relationships,
  activities,
  onDeleteRelationship,
}) => {
  const [activeTab, setActiveTab] = useState<'lineage' | 'activity'>('lineage');

  // Helper: resolves asset or column ID to human-readable path
  const resolveNodeName = (nodeType: 'asset' | 'column', nodeId: string): string => {
    if (nodeType === 'asset') {
      const asset = assets.find((a) => a.id === nodeId);
      return asset ? asset.name : `CSV [${nodeId.slice(0, 5)}]`;
    } else {
      // Find column in all assets
      for (const asset of assets) {
        if (asset.columns) {
          const col = asset.columns.find((c) => c.id === nodeId);
          if (col) {
            return `${asset.name}.${col.name}`;
          }
        }
      }
      return `Col [${nodeId.slice(0, 5)}]`;
    }
  };

  const getRelationshipBadgeColor = (type: string) => {
    switch (type) {
      case 'DERIVES_FROM':
        return 'bg-brand-coral/10 text-brand-coral border border-brand-coral/20';
      case 'MAPS_TO':
        return 'bg-brand-violet/10 text-brand-violet border border-brand-violet/20';
      case 'LOOKUP_FROM':
        return 'bg-brand-emerald/10 text-brand-emerald border border-brand-emerald/20';
      case 'COPIED_FROM':
        return 'bg-blue-900/20 text-blue-300 border border-blue-800/40';
      default:
        return 'bg-workspace-700 text-workspace-300 border border-workspace-600';
    }
  };

  const getRelationshipTypeLabel = (type: string) => {
    switch (type) {
      case 'DERIVES_FROM':
        return 'derives from';
      case 'MAPS_TO':
        return 'maps to';
      case 'LOOKUP_FROM':
        return 'looks up from';
      case 'COPIED_FROM':
        return 'copied from';
      default:
        return 'connected to';
    }
  };

  // Convert raw activities with UUIDs into human-readable details
  const makeDetailsHumanReadable = (details: string): string => {
    let readable = details
      .replace(/MAPS_TO/g, 'maps to')
      .replace(/DERIVES_FROM/g, 'derives from')
      .replace(/LOOKUP_FROM/g, 'looks up from')
      .replace(/COPIED_FROM/g, 'copied from');

    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    readable = readable.replace(uuidRegex, (match) => {
      // Resolve as column first
      for (const asset of assets) {
        if (asset.columns) {
          const col = asset.columns.find((c) => c.id === match);
          if (col) {
            return `${asset.name}.${col.name}`;
          }
        }
      }
      // Resolve as asset
      const asset = assets.find((a) => a.id === match);
      if (asset) return asset.name;

      return match;
    });

    // Clean up "column (Table.Col)" -> "Table.Col"
    readable = readable.replace(/(column|asset)\s*\(([^)]+)\)/gi, '$2');
    return readable;
  };

  return (
    <div className="w-full h-full bg-workspace-850 border-t border-workspace-750 flex flex-col z-10 select-none overflow-hidden">
      {/* Bottom Tabs */}
      <div className="flex border-b border-workspace-750 shrink-0 text-xs font-semibold px-4">
        <button
          onClick={() => setActiveTab('lineage')}
          className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
            activeTab === 'lineage'
              ? 'border-brand-teal text-brand-teal bg-workspace-800/20'
              : 'border-transparent text-workspace-600 hover:text-workspace-400'
          }`}
        >
          <Network size={13} />
          <span>Active Lineage Edges ({relationships.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
            activeTab === 'activity'
              ? 'border-brand-teal text-brand-teal bg-workspace-800/20'
              : 'border-transparent text-workspace-600 hover:text-workspace-400'
          }`}
        >
          <History size={13} />
          <span>Recent Activity Feed ({activities.length})</span>
        </button>
      </div>

      {/* Panel Scroll Container */}
      <div className="flex-1 overflow-y-auto p-4">
        
        {/* LINEAGE RELATIONSHIPS LIST */}
        {activeTab === 'lineage' && (
          <div className="h-full">
            {relationships.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <Network className="text-workspace-700 mb-1.5" size={22} />
                <p className="text-xs text-workspace-600 font-mono">No active lineage relationships</p>
                <p className="text-[10px] text-workspace-600 font-mono mt-0.5">
                  Drag connections between columns or assets on the canvas to build lineage.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-workspace-750 text-[10px] text-workspace-600 uppercase font-bold tracking-wider font-mono">
                      <th className="pb-2">Source Node</th>
                      <th className="pb-2">Lineage Link Type</th>
                      <th className="pb-2">Destination Node</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-workspace-750/30">
                    {relationships.map((rel) => {
                      const isSourceCol = rel.source_node_type === 'column';
                      const isDestCol = rel.destination_node_type === 'column';
                      return (
                        <tr key={rel.id} className="hover:bg-workspace-800/30 transition-colors group">
                          <td className="py-2.5 pr-4 text-workspace-200">
                            <div className="flex items-center space-x-1.5">
                              {isSourceCol ? (
                                <Columns size={12} className="text-brand-violet shrink-0" />
                              ) : (
                                <Database size={12} className="text-brand-teal shrink-0" />
                              )}
                              <span className="font-mono text-[11px] truncate max-w-sm">
                                {resolveNodeName(rel.source_node_type, rel.source_node_id)}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center space-x-2">
                              {rel.relationship_type ? (
                                <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider ${getRelationshipBadgeColor(rel.relationship_type)}`}>
                                  {getRelationshipTypeLabel(rel.relationship_type)}
                                </span>
                              ) : (
                                <span className="text-[10px] text-workspace-600 font-mono italic">-</span>
                              )}
                              <ArrowRight size={10} className="text-workspace-600 shrink-0" />
                            </div>
                          </td>
                          <td className="py-2.5 pr-4 text-workspace-200">
                            <div className="flex items-center space-x-1.5">
                              {isDestCol ? (
                                <Columns size={12} className="text-brand-violet shrink-0" />
                              ) : (
                                <Database size={12} className="text-brand-teal shrink-0" />
                              )}
                              <span className="font-mono text-[11px] truncate max-w-sm">
                                {resolveNodeName(rel.destination_node_type, rel.destination_node_id)}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              onClick={() => onDeleteRelationship(rel.id)}
                              className="p-1 hover:bg-workspace-750 text-workspace-600 hover:text-brand-coral rounded transition-all opacity-0 group-hover:opacity-100"
                              title="Remove lineage edge"
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* RECENT ACTIVITY FEED */}
        {activeTab === 'activity' && (
          <div className="h-full">
            {activities.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center p-6">
                <Clock className="text-workspace-700 mr-2" size={16} />
                <span className="text-xs text-workspace-600 font-mono">No recent workspace activities</span>
              </div>
            ) : (
              <div className="space-y-2">
                {activities.map((act) => {
                  const dateStr = new Date(act.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  });

                  let icon = <Clock size={13} className="text-workspace-500" />;
                  if (act.activity_type.includes('created')) {
                    icon = <PlusCircle size={13} className="text-brand-teal" />;
                  } else if (act.activity_type.includes('updated')) {
                    icon = <RefreshCw size={13} className="text-brand-violet animate-spin-slow" />;
                  } else if (act.activity_type.includes('deleted')) {
                    icon = <AlertCircle size={13} className="text-brand-coral" />;
                  }

                  return (
                    <div
                      key={act.id}
                      className="flex items-start justify-between bg-workspace-900 border border-workspace-750/30 p-2.5 rounded-lg text-xs hover:border-workspace-700 transition"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className="shrink-0">{icon}</div>
                        <p className="text-workspace-200 truncate pr-4 font-medium" title={act.details}>
                          {makeDetailsHumanReadable(act.details)}
                        </p>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0 text-workspace-600 font-mono text-[10px]">
                        <span>{dateStr}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
