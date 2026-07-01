import React from 'react';
import { Users } from 'lucide-react';

interface CanvasHeaderProps {
  backendStatus: 'connecting' | 'connected' | 'error';
  wsConnected: boolean;
  activeUsersCount: number;
  globalUsersCount?: number;
}

export const CanvasHeader: React.FC<CanvasHeaderProps> = ({
  backendStatus,
  wsConnected,
  activeUsersCount,
  globalUsersCount,
}) => {
  return (
    <header className="h-14 border-b border-workspace-750 bg-workspace-850 px-6 flex items-center justify-between z-10 select-none shrink-0">
      <div 
        className="flex items-center space-x-2.5 cursor-help"
        title={
          backendStatus === 'connecting'
            ? 'connecting backend...'
            : backendStatus === 'error'
            ? 'offline (retrying connection)...'
            : !wsConnected
            ? 'connected to backend but not syncing..'
            : 'connected and syncing in real-time.'
        }
      >
        {backendStatus === 'connected' ? (
          <>
            <span className={`w-2 h-2 rounded-full bg-brand-emerald ${wsConnected ? 'animate-ping' : 'animate-pulse'}`} />
            <span className="text-xs font-semibold text-workspace-200 font-mono">
              {wsConnected ? 'Shared Studio Session (Live)' : 'Shared Studio Session (Connecting sync...)'}
            </span>
          </>
        ) : backendStatus === 'connecting' ? (
          <>
            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            <span className="text-xs font-semibold text-workspace-300 font-mono">Connecting to backend...</span>
          </>
        ) : (
          <>
            <span className="w-2 h-2 rounded-full bg-brand-coral animate-pulse" />
            <span className="text-xs font-semibold text-brand-coral font-mono">Offline (Retrying connection...)</span>
          </>
        )}
      </div>
      <div className="flex items-center space-x-4">
        {/* Active User Badges */}
        <div className="flex items-center space-x-3 bg-workspace-800 border border-workspace-750 px-2.5 py-1 rounded-lg">
          <div className="flex items-center space-x-1.5" title="Users in this workspace">
            <Users size={12} className="text-brand-teal" />
            <span className="text-[10px] font-mono text-workspace-200 font-bold">
              {activeUsersCount} Workspace
            </span>
          </div>
          {globalUsersCount !== undefined && (
            <>
              <span className="w-[1px] h-3 bg-workspace-700" />
              <div className="flex items-center space-x-1.5" title="Total users across all workspaces">
                <Users size={12} className="text-workspace-500" />
                <span className="text-[10px] font-mono text-workspace-400 font-medium">
                  {globalUsersCount} Global
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
