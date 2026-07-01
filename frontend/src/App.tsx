import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactFlow, {
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  useReactFlow,
} from 'reactflow';
import type { Connection, Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { api, WS_URL, setActiveWorkspaceId } from './api';
import type { Asset, Column, Relationship, ActivityLog, Workspace } from './types';
import { CSVNode } from './components/CSVNode';
import { LeftSidebar } from './components/LeftSidebar';
import { ImportPreviewModal } from './components/ImportPreviewModal';
import { useCustomDialog } from './components/CustomDialog';
import { RightSidebar } from './components/RightSidebar';
import { BottomPanel } from './components/BottomPanel';
import { LineageEdge } from './components/LineageEdge';
import { CustomConnectionLine } from './components/CustomConnectionLine';
import { CustomMiniMap } from './components/CustomMiniMap';
import { GroupNode } from './components/GroupNode';
import { CommentNode, NewCommentNode, CommentsPanel } from './components/Comments';
import type { CanvasComment } from './components/Comments';
import { ContextMenu } from './components/ContextMenu';
import { CollaborativeCursors } from './components/CollaborativeCursors';
import { CanvasHeader } from './components/CanvasHeader';
import {
  Share2,
  Users,
  Loader2,
  Undo2,
  Redo2,
  MousePointer,
  PlusSquare,
  Scissors,
  Copy,
  Clipboard,
  CopyPlus,
  Boxes,
  Sun,
  Moon,
  Download,
  MessageSquare,
  XCircle,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';

// Custom node & edge registry
const nodeTypes = {
  csvNode: CSVNode,
  groupNode: GroupNode,
  commentNode: CommentNode,
  newCommentNode: NewCommentNode,
};

const edgeTypes = {
  lineageEdge: LineageEdge,
};

// Generate a random user ID and color for collaborative cursors
const CLIENT_ID = Math.random().toString(36).substring(2, 9);
const USER_NAME = `Collaborator ${Math.floor(Math.random() * 900) + 100}`;
const CURSOR_COLORS = ['#00f2fe', '#8a2be2', '#ff5e62', '#2bcbba', '#ff9f43', '#45aaf2'];
const USER_COLOR = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];

const getDeterministicColor = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 85%, 65%)`;
};

// Helper to check if an asset name matches a reference table/sheet name case-insensitively
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

// Helper to find all column IDs referenced in a formula expression
const findReferencedColumnIds = (
  expression: string,
  destAssetId: string,
  allAssets: Asset[]
): string[] => {
  const referencedIds: string[] = [];
  let cleanedExpr = expression;

  // 1. Search for [tableName][colName] pattern first
  const doubleBracketRegex = /\[([^\]]+)\]\s*\[([^\]]+)\]/g;
  let match;
  while ((match = doubleBracketRegex.exec(expression)) !== null) {
    const tableName = match[1].trim().toLowerCase();
    const colName = match[2].trim().toLowerCase();
    
    const asset = allAssets.find(a => matchesTableName(a.name, tableName));
    
    if (asset) {
      const col = asset.columns?.find(c => c.name.toLowerCase() === colName);
      if (col) {
        referencedIds.push(col.id);
      }
    }
    // Remove to avoid double matching
    cleanedExpr = cleanedExpr.replace(match[0], '');
  }

  // 2. Search for [ref] pattern (can be [table.col] or just [col])
  const singleBracketRegex = /\[([^\]]+)\]/g;
  while ((match = singleBracketRegex.exec(cleanedExpr)) !== null) {
    const ref = match[1].trim();
    if (ref.includes('.')) {
      const parts = ref.split('.');
      const colName = parts[parts.length - 1].trim().toLowerCase();
      const tableName = parts.slice(0, parts.length - 1).join('.').trim().toLowerCase();
      
      const asset = allAssets.find(a => matchesTableName(a.name, tableName));
      
      if (asset) {
        const col = asset.columns?.find(c => c.name.toLowerCase() === colName);
        if (col) {
          referencedIds.push(col.id);
        }
      }
    } else {
      const asset = allAssets.find(a => a.id === destAssetId);
      if (asset) {
        const col = asset.columns?.find(c => c.name.toLowerCase() === ref.toLowerCase());
        if (col) {
          referencedIds.push(col.id);
        }
      }
    }
  }
  
  return Array.from(new Set(referencedIds));
};

// Helper to remove a column reference from a formula string and clean up mathematical operators
const removeReferenceFromFormula = (formula: string, refName: string): string => {
  let cleaned = formula;
  
  const lastDotIndex = refName.lastIndexOf('.');
  if (lastDotIndex !== -1) {
    const table = refName.substring(0, lastDotIndex);
    const col = refName.substring(lastDotIndex + 1);
    
    const escapedCol = col.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const possibleTables = [table];
    
    const bracketMatch = table.match(/^(.+?)\s*\[([^\]]+)\]$/);
    if (bracketMatch) {
      const bookName = bracketMatch[1].trim();
      const sheetName = bracketMatch[2].trim();
      const bookNameNoExt = bookName.replace(/\.(xlsx|xls|ods|csv|tsv)$/i, '');
      possibleTables.push(`${bookName}.${sheetName}`);
      possibleTables.push(`${bookNameNoExt}.${sheetName}`);
      possibleTables.push(sheetName);
    }
    
    for (const t of possibleTables) {
      const escapedTable = t.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(`\\[\\s*${escapedTable}\\s*\\]\\s*\\[\\s*${escapedCol}\\s*\\]`, 'gi'), '');
      cleaned = cleaned.replace(new RegExp(`\\[\\s*${escapedTable}\\.${escapedCol}\\s*\\]`, 'gi'), '');
    }
  } else {
    const escapedRef = refName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`\\[\\s*${escapedRef}\\s*\\]`, 'gi'), '');
  }
  
  cleaned = cleaned
    .replace(/\s*[\+\-\*\/%]\s*(?=[\+\-\*\/%])/g, '')
    .replace(/^\s*[\+\-\*\/%]\s*/, '')
    .replace(/\s*[\+\-\*\/%]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
    
  return cleaned;
};

// Helper to remove all column references of a specific table from a formula string
const removeTableReferencesFromFormula = (formula: string, tableName: string): string => {
  let newFormula = formula;
  
  const possibleTables = [tableName];
  const bracketMatch = tableName.match(/^(.+?)\s*\[([^\]]+)\]$/);
  if (bracketMatch) {
    const bookName = bracketMatch[1].trim();
    const sheetName = bracketMatch[2].trim();
    const bookNameNoExt = bookName.replace(/\.(xlsx|xls|ods|csv|tsv)$/i, '');
    possibleTables.push(`${bookName}.${sheetName}`);
    possibleTables.push(`${bookNameNoExt}.${sheetName}`);
    possibleTables.push(sheetName);
  }
  
  for (const t of possibleTables) {
    const escapedTable = t.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    newFormula = newFormula.replace(new RegExp(`\\[\\s*${escapedTable}\\.[^\\]]+\\s*\\]`, 'gi'), '');
    newFormula = newFormula.replace(new RegExp(`\\[\\s*${escapedTable}\\s*\\]\\s*\\[[^\\]]+\\]`, 'gi'), '');
  }
  
  newFormula = newFormula
    .replace(/\s*[\+\-\*\/%]\s*(?=[\+\-\*\/%])/g, '')
    .replace(/^\s*[\+\-\*\/%]\s*/, '')
    .replace(/\s*[\+\-\*\/%]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
    
  return newFormula;
};

export default function App() {
  const dialog = useCustomDialog();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string>(() => {
    const saved = localStorage.getItem('activeWorkspaceId');
    return saved || '';
  });

  const activeWorkspaceRef = useRef(activeWorkspace);
  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);

  // Load workspaces from backend on mount
  useEffect(() => {
    const fetchWorkspaces = async () => {
      try {
        const list = await api.getWorkspaces();
        setWorkspaces(list);
        
        let currentId = localStorage.getItem('activeWorkspaceId');
        const exists = list.some((w) => w.id === currentId);
        if (!exists && list.length > 0) {
          currentId = list[0].id;
        }
        
        if (currentId) {
          setActiveWorkspace(currentId);
          setActiveWorkspaceId(currentId);
        }
      } catch (err) {
        console.error('Failed to load workspaces:', err);
        showToast('Failed to load workspaces from server', 'error');
      }
    };
    fetchWorkspaces();
  }, []);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [backendStatus, setBackendStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [wsConnected, setWsConnected] = useState(false);
  const [globalUserCount, setGlobalUserCount] = useState(1);
  const [workspaceUserCounts, setWorkspaceUserCounts] = useState<Record<string, number>>({});

  // Toast notifications
  const [toasts, setToasts] = useState<{ id: string; type: 'info' | 'success' | 'warning' | 'error'; message: string }[]>([]);

  const showToast = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const handleSelectWorkspace = (workspaceId: string) => {
    setActiveWorkspace(workspaceId);
    setActiveWorkspaceId(workspaceId);
    
    // Clear selection state
    setSelectedAssetId(null);
    setSelectedColumnId(null);
    setSelectedEdgeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    
    // Load workspace data immediately (which fetches with new X-Workspace-Id header)
    loadWorkspaceData();
  };

  const handleAddWorkspace = async (name: string) => {
    if (workspaces.some((w) => w.name.toLowerCase() === name.toLowerCase())) {
      showToast("Workspace name already exists!", "warning");
      return;
    }
    try {
      const newWs = await api.createWorkspace(name);
      setWorkspaces((prev) => [...prev, newWs]);
      handleSelectWorkspace(newWs.id);
      showToast(`Workspace "${name}" created!`, "success");
    } catch (err: any) {
      showToast(`Failed to create workspace: ${err.message}`, "error");
    }
  };

  const handleRenameWorkspace = async (id: string, newName: string) => {
    try {
      const updatedWs = await api.renameWorkspace(id, newName);
      setWorkspaces((prev) => prev.map((w) => (w.id === id ? updatedWs : w)));
      showToast(`Workspace renamed to "${newName}".`, "success");
    } catch (err: any) {
      showToast(`Failed to rename workspace: ${err.message}`, "error");
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    try {
      const targetWs = workspaces.find((w) => w.id === id);
      const targetName = targetWs ? targetWs.name : 'Workspace';
      await api.deleteWorkspace(id);
      
      const nextWorkspaces = workspaces.filter((w) => w.id !== id);
      setWorkspaces(nextWorkspaces);
      
      if (activeWorkspace === id) {
        const fallbackWs = nextWorkspaces[0];
        if (fallbackWs) {
          handleSelectWorkspace(fallbackWs.id);
        } else {
          setActiveWorkspace('');
          setActiveWorkspaceId('');
        }
      }
      showToast(`Workspace "${targetName}" deleted.`, "success");
    } catch (err: any) {
      showToast(`Failed to delete workspace: ${err.message}`, "error");
    }
  };

  // Selection states
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);

  // Import Preview Modal states
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ assets: any[]; relationships: any[] } | undefined>(undefined);

  // Drag connection tracking
  const [connectingState, setConnectingState] = useState<{ nodeId: string; handleId: string | null; handleType: 'source' | 'target' } | null>(null);

  // Resize widths & heights for sidebars/panels
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(320);
  const [bottomHeight, setBottomHeight] = useState(220);
  
  // Minimap control
  const [showMiniMap, setShowMiniMap] = useState(true);
  
  // React Flow states
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const reactFlowInstance = useRef<any>(null);
  // Must be declared BEFORE any functions that call getViewport() or setViewport()
  const { setViewport, getViewport } = useReactFlow();

  // Undo/Redo tracking
  const undoStackRef = useRef<{ assets: Asset[]; relationships: Relationship[] }[]>([]);
  const redoStackRef = useRef<{ assets: Asset[]; relationships: Relationship[] }[]>([]);

  // Copy/paste/cut/duplicate clipboard
  const clipboardRef = useRef<{ assets: Asset[]; relationships: Relationship[] } | null>(null);

  // Tool Modes and visual theme settings
  const [editorMode, setEditorMode] = useState<'select' | 'multiselect' | 'edgecut'>('select');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Comments system
  const [comments, setComments] = useState<CanvasComment[]>([]);
  const [isCommentMode, setIsCommentMode] = useState(false);
  const [showComments, setShowComments] = useState(true);
  const [pendingComment, setPendingComment] = useState<{ screenX: number; screenY: number; canvasX: number; canvasY: number } | null>(null);

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null);

  // Whether anything is selected for clipboard/group actions
  const hasSelection = !!(selectedAssetId || selectedEdgeId ||
    (reactFlowInstance.current && reactFlowInstance.current.getNodes().some((n: any) => n.selected)));

  // Collaborative cursors
  const [otherCursors, setOtherCursors] = useState<Record<string, { x: number; y: number; name: string; color: string; lastUpdate: number }>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Keep a reference of comments state to avoid stale closures in ws.onmessage
  const commentsRef = useRef<CanvasComment[]>([]);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  // Smooth Resizers Drag handlers
  const startResizeLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftWidth;
    
    const doDrag = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(260, Math.min(480, startWidth + (moveEvent.clientX - startX)));
      setLeftWidth(newWidth);
    };
    
    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };
    
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  }, [leftWidth]);

  const startResizeRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightWidth;
    
    const doDrag = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(260, Math.min(480, startWidth - (moveEvent.clientX - startX)));
      setRightWidth(newWidth);
    };
    
    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };
    
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  }, [rightWidth]);

  const startResizeBottom = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = bottomHeight;
    
    const doDrag = (moveEvent: MouseEvent) => {
      const newHeight = Math.max(140, Math.min(450, startHeight - (moveEvent.clientY - startY)));
      setBottomHeight(newHeight);
    };
    
    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };
    
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  }, [bottomHeight]);

  // Load all initial workspace data
  const loadWorkspaceData = async (isRetry = false) => {
    try {
      if (!isRetry) {
        setBackendStatus('connecting');
      }
      const [fetchedAssets, fetchedRels, fetchedActs] = await Promise.all([
        api.getAssets(),
        api.getRelationships(),
        api.getActivities(30),
      ]);

      // Split fetchedAssets into actual assets (tables/groups) and comments
      const actualAssets = fetchedAssets.filter((a) => a.asset_type !== 'comment');
      const commentAssets = fetchedAssets.filter((a) => a.asset_type === 'comment');

      setAssets(actualAssets);
      setComments((prevComments) => {
        return commentAssets.map((a) => {
          const existing = prevComments.find((c) => c.id === a.id);
          return {
            id: a.id,
            x: a.custom_attributes?.x ?? 0,
            y: a.custom_attributes?.y ?? 0,
            text: a.description ?? '',
            author: a.name ?? 'Unknown',
            createdAt: a.custom_attributes?.createdAt ?? a.created_at ?? new Date().toISOString(),
            color: a.custom_attributes?.color ?? '#ff5e62',
            isOpen: existing ? existing.isOpen : false,
          };
        });
      });
      setRelationships(fetchedRels);
      setActivities(fetchedActs);
      setBackendStatus('connected');
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to load workspace data:', err);
      setBackendStatus('error');
      
      // Auto-retry in 3 seconds
      setTimeout(() => {
        loadWorkspaceData(true);
      }, 3000);
    }
  };

  useEffect(() => {
    if (activeWorkspace) {
      loadWorkspaceData();
    }
  }, [activeWorkspace]);

  // Initialize WebSockets for real-time collaboration with auto-reconnection
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let isUnmounted = false;

    const connect = () => {
      if (isUnmounted) return;

      console.log('Connecting to CSV Linkage WebSocket...');
      ws = new WebSocket(`${WS_URL}?workspace_id=${encodeURIComponent(activeWorkspace)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmounted) {
          ws?.close();
          return;
        }
        console.log('Connected to CSV Linkage WebSocket');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        if (isUnmounted) return;
        try {
          const payload = JSON.parse(event.data);
          const { event_type, data } = payload;

          // Global presence/workspace events (processed regardless of workspace filtering)
          if (event_type === 'presence_stats') {
            setGlobalUserCount(data.global_count || 1);
            setWorkspaceUserCounts(data.workspace_counts || {});
            return;
          }

          if (event_type === 'workspace_created') {
            const { id, name } = data;
            setWorkspaces((prev) => {
              if (prev.some((w) => w.id === id)) return prev;
              return [...prev, { id, name, created_at: '', updated_at: '' }];
            });
            showToast(`Workspace "${name}" was created by another user.`, "info");
            return;
          }

          if (event_type === 'workspace_renamed') {
            const { id, old_name, new_name } = data;
            setWorkspaces((prev) => {
              return prev.map((w) => (w.id === id ? { ...w, name: new_name } : w));
            });
            showToast(`Workspace "${old_name}" was renamed to "${new_name}" by another user.`, "info");
            return;
          }

          if (event_type === 'workspace_deleted') {
            const { workspace_id } = data;
            setWorkspaces((prev) => {
              return prev.filter((w) => w.id !== workspace_id);
            });
            if (activeWorkspaceRef.current === workspace_id) {
              setWorkspaces((currWorkspaces) => {
                const remaining = currWorkspaces.filter((w) => w.id !== workspace_id);
                if (remaining.length > 0) {
                  handleSelectWorkspace(remaining[0].id);
                }
                return remaining;
              });
            }
            showToast(`Active workspace was deleted by another user.`, "info");
            return;
          }

          // Scope workspace events to active workspace
          if (data && data.workspace_id && data.workspace_id !== activeWorkspaceRef.current) {
            return;
          }

          // Handle Figma-style collaborative cursor updates
          if (event_type === 'cursor_move') {
            if (data.clientId !== CLIENT_ID) {
              setOtherCursors((prev) => ({
                ...prev,
                [data.clientId]: {
                  x: data.canvasX, // absolute canvas X
                  y: data.canvasY, // absolute canvas Y
                  name: data.name,
                  color: data.color,
                  lastUpdate: Date.now(),
                },
              }));
            }
            return;
          }

          // Handle real-time node position syncing
          if (event_type === 'node_drag') {
            if (data.clientId !== CLIENT_ID) {
              setNodes((nds) =>
                nds.map((node) => {
                  if (node.id === data.nodeId) {
                    return { ...node, position: data.position };
                  }
                  return node;
                })
              );
            }
            return;
          }

          // Refresh data on CRUD events (non-asset type changes)
          if (
            [
              'column_updated',
              'relationship_created',
              'relationship_deleted',
              'relationship_updated',
            ].includes(event_type)
          ) {
            loadWorkspaceData(true);
          }

          // Handle asset creation selectively
          if (event_type === 'asset_created') {
            api.getAsset(data.id)
              .then((newAsset) => {
                if (newAsset.asset_type === 'comment') {
                  const newComment: CanvasComment = {
                    id: newAsset.id,
                    x: newAsset.custom_attributes?.x ?? 0,
                    y: newAsset.custom_attributes?.y ?? 0,
                    text: newAsset.description ?? '',
                    author: newAsset.name ?? 'Unknown',
                    createdAt: newAsset.custom_attributes?.createdAt ?? newAsset.created_at ?? new Date().toISOString(),
                    color: newAsset.custom_attributes?.color ?? '#ff5e62',
                    isOpen: false,
                  };
                  setComments((prev) => {
                    if (prev.some((c) => c.id === newComment.id)) return prev;
                    return [...prev, newComment];
                  });
                } else {
                  loadWorkspaceData(true);
                }
              })
              .catch((err) => {
                console.error("Failed to fetch new asset:", err);
                loadWorkspaceData(true);
              });
          }

          // Handle asset updates selectively
          if (event_type === 'asset_updated') {
            const updatedId = data.id;
            const updates = data.updates || {};
            const isComment = commentsRef.current.some((c) => c.id === updatedId);
            
            if (isComment) {
              setComments((prev) =>
                prev.map((c) => {
                  if (c.id === updatedId) {
                    const custom = updates.custom_attributes || {};
                    return {
                      ...c,
                      x: custom.x !== undefined ? custom.x : c.x,
                      y: custom.y !== undefined ? custom.y : c.y,
                      text: updates.description !== undefined ? updates.description : c.text,
                      color: custom.color !== undefined ? custom.color : c.color,
                    };
                  }
                  return c;
                })
              );
            } else {
              loadWorkspaceData(true);
            }
          }

          // Handle asset deletion selectively
          if (event_type === 'asset_deleted') {
            const deletedId = data.id;
            const isComment = commentsRef.current.some((c) => c.id === deletedId);
            
            if (isComment) {
              setComments((prev) => prev.filter((c) => c.id !== deletedId));
            } else {
              loadWorkspaceData(true);
            }
          }

          // Append new activities
          if (event_type === 'activity_logged') {
            setActivities((prev) => [data as ActivityLog, ...prev.slice(0, 49)]);
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        if (isUnmounted) return;
        setWsConnected(false);
        console.log('WebSocket disconnected. Reconnecting in 3s...');
        
        // Refresh workspace data to ensure we didn't miss updates while offline
        loadWorkspaceData(true);

        reconnectTimeout = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    };

    connect();

    // Periodically clean stale cursors
    const interval = setInterval(() => {
      const now = Date.now();
      setOtherCursors((prev) => {
        const cleaned = { ...prev };
        let changed = false;
        Object.entries(cleaned).forEach(([id, cursor]) => {
          if (now - cursor.lastUpdate > 5000) {
            delete cleaned[id];
            changed = true;
          }
        });
        return changed ? cleaned : prev;
      });
    }, 2000);

    return () => {
      isUnmounted = true;
      if (ws) {
        ws.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      clearInterval(interval);
    };
  }, [activeWorkspace]);

  // Sync cursor coordinates on mousemove
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !canvasContainerRef.current) return;

    const rect = canvasContainerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const { x, y, zoom } = getViewport();
    
    // Map screen coordinates to absolute canvas coordinate space
    const canvasX = (mouseX - x) / zoom;
    const canvasY = (mouseY - y) / zoom;

    wsRef.current.send(
      JSON.stringify({
        event_type: 'cursor_move',
        data: {
          clientId: CLIENT_ID,
          name: USER_NAME,
          color: USER_COLOR,
          canvasX,
          canvasY,
          workspace_id: activeWorkspaceRef.current,
        },
      })
    );
  };

  // Save an Undo Snapshot
  const saveUndoState = () => {
    const snap = JSON.parse(JSON.stringify({ assets, relationships }));
    undoStackRef.current.push(snap);
    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
  };

  // Undo / Redo Functions
  const handleUndo = async () => {
    if (undoStackRef.current.length === 0) return;
    const previous = undoStackRef.current.pop()!;
    const currentSnap = JSON.parse(JSON.stringify({ assets, relationships }));
    redoStackRef.current.push(currentSnap);

    try {
      await api.syncWorkspace(previous);
      loadWorkspaceData();
    } catch (err) {
      console.error('Failed to undo:', err);
    }
  };

  const handleRedo = async () => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    const currentSnap = JSON.parse(JSON.stringify({ assets, relationships }));
    undoStackRef.current.push(currentSnap);

    try {
      await api.syncWorkspace(next);
      loadWorkspaceData();
    } catch (err) {
      console.error('Failed to redo:', err);
    }
  };

  // Copy / Cut / Paste / Duplicate Functions
  const handleCopy = () => {
    if (!reactFlowInstance.current) return;
    const selectedNodes = reactFlowInstance.current.getNodes().filter((n: any) => n.selected);
    const selectedEdges = reactFlowInstance.current.getEdges().filter((e: any) => e.selected);
    
    if (selectedNodes.length === 0) return;

    const copiedAssets = assets.filter((a) => selectedNodes.some((n: any) => n.id === a.id));
    const copiedRels = relationships.filter((r) => selectedEdges.some((e: any) => e.id === r.id));

    clipboardRef.current = JSON.parse(JSON.stringify({ assets: copiedAssets, relationships: copiedRels }));
  };

  const handleCut = async () => {
    handleCopy();
    if (!clipboardRef.current) return;
    saveUndoState();

    try {
      for (const rel of clipboardRef.current.relationships) {
        await api.deleteRelationship(rel.id);
      }
      for (const asset of clipboardRef.current.assets) {
        await api.deleteAsset(asset.id);
      }
      setSelectedAssetId(null);
      setSelectedColumnId(null);
      setSelectedEdgeId(null);
      loadWorkspaceData();
    } catch (err) {
      console.error('Failed to cut selected items:', err);
    }
  };

  const handlePaste = async () => {
    if (!clipboardRef.current) return;
    saveUndoState();

    const idMap: Record<string, string> = {};
    const pastedAssets: Asset[] = [];

    try {
      for (const asset of clipboardRef.current.assets) {
        const currentPos = asset.custom_attributes?.position || { x: 50, y: 50 };
        const pastedPos = { x: currentPos.x + 60, y: currentPos.y + 60 };

        // Prepare columns for creation (backend will assign database IDs)
        const pastedCols = (asset.columns || []).map((col) => {
          return {
            ...col,
            // Keep original properties, backend creates DB UUIDs
          };
        });

        const newAsset = {
          ...asset,
          name: `${asset.name}_copy`,
          custom_attributes: {
            ...asset.custom_attributes,
            position: pastedPos,
          },
          columns: pastedCols,
        };

        const created = await api.createAsset(newAsset);
        pastedAssets.push(created);

        // Map the old asset ID to the actual DB generated UUID
        idMap[asset.id] = created.id;

        // Map old column IDs to the new actual DB column UUIDs by index
        (asset.columns || []).forEach((oldCol, idx) => {
          const newCol = created.columns?.[idx];
          if (newCol) {
            idMap[oldCol.id] = newCol.id;
          }
        });
      }

      for (const rel of clipboardRef.current.relationships) {
        const newSourceId = idMap[rel.source_node_id] || rel.source_node_id;
        const newDestId = idMap[rel.destination_node_id] || rel.destination_node_id;

        await api.createRelationship({
          source_node_type: rel.source_node_type,
          source_node_id: newSourceId,
          destination_node_type: rel.destination_node_type,
          destination_node_id: newDestId,
          relationship_type: rel.relationship_type,
          metadata_json: rel.metadata_json || {},
        });
      }

      loadWorkspaceData();
    } catch (err) {
      console.error('Failed to paste assets:', err);
    }
  };

  const handleDuplicate = async () => {
    handleCopy();
    if (clipboardRef.current) {
      await handlePaste();
    }
  };

  // Group Selection (works with 1 or more nodes)
  const handleGroupSelection = async () => {
    if (!reactFlowInstance.current) return;
    const selectedNodes = reactFlowInstance.current.getNodes().filter((n: any) => n.selected && n.type !== 'groupNode');
    if (selectedNodes.length < 1) {
      await dialog.alert("Group Selection", "Please select at least 1 table to form a group.", "warning");
      return;
    }

    saveUndoState();

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    selectedNodes.forEach((node: any) => {
      const x = node.position.x;
      const y = node.position.y;
      const w = node.width || 288;
      const h = node.height || 380;

      if (x < minX) minX = x;
      if (x + w > maxX) maxX = x + w;
      if (y < minY) minY = y;
      if (y + h > maxY) maxY = y + h;
    });

    minX -= 40;
    minY -= 60;
    maxX += 40;
    maxY += 40;

    try {
      await api.createAsset({
        name: "Lineage Group",
        asset_type: "group",
        version: 1,
        description: "Custom grouped tables",
        owner: USER_NAME,
        notes: "",
        tags: ["group"],
        custom_attributes: {
          position: { x: minX, y: minY },
          width: maxX - minX,
          height: maxY - minY,
          isGroup: true,
          childNodeIds: selectedNodes.map((n: any) => n.id),
        },
        columns: [],
      });
      loadWorkspaceData();
    } catch (err) {
      console.error('Failed to create group container:', err);
    }
  };

  // Export metadata for OpenMetadata (OM)
  const handleExportOpenMetadata = () => {
    const omTables = assets.filter((a) => a.asset_type !== 'group').map((asset) => ({
      name: asset.name,
      description: asset.description || '',
      owner: asset.owner || '',
      version: asset.version,
      row_count: asset.row_count,
      columns: (asset.columns || []).map((col) => ({
        name: col.name,
        dataType: col.datatype?.toUpperCase() || 'VARCHAR',
        description: col.description || '',
        tags: col.tags || [],
        notes: col.notes || '',
      })),
    }));

    const omLineage = relationships.map((rel) => {
      let sourceName = '';
      let sourceColName = '';
      if (rel.source_node_type === 'column') {
        const parentAsset = assets.find((a) => a.columns?.some((c) => c.id === rel.source_node_id));
        const col = parentAsset?.columns?.find((c) => c.id === rel.source_node_id);
        sourceName = parentAsset ? parentAsset.name : 'Unknown';
        sourceColName = col ? col.name : 'Unknown';
      } else {
        const asset = assets.find((a) => a.id === rel.source_node_id);
        sourceName = asset ? asset.name : 'Unknown';
      }

      let destName = '';
      let destColName = '';
      if (rel.destination_node_type === 'column') {
        const parentAsset = assets.find((a) => a.columns?.some((c) => c.id === rel.destination_node_id));
        const col = parentAsset?.columns?.find((c) => c.id === rel.destination_node_id);
        destName = parentAsset ? parentAsset.name : 'Unknown';
        destColName = col ? col.name : 'Unknown';
      } else {
        const asset = assets.find((a) => a.id === rel.destination_node_id);
        destName = asset ? asset.name : 'Unknown';
      }

      return {
        fromEntity: rel.source_node_type === 'column' ? 'column' : 'table',
        fromName: rel.source_node_type === 'column' ? `${sourceName}.${sourceColName}` : sourceName,
        toEntity: rel.destination_node_type === 'column' ? 'column' : 'table',
        toName: rel.destination_node_type === 'column' ? `${destName}.${destColName}` : destName,
        relationshipType: rel.relationship_type,
        description: rel.metadata_json?.description || '',
      };
    });

    const omExport = {
      serviceName: 'CSV_Lineage_Studio',
      exportTimestamp: new Date().toISOString(),
      tables: omTables,
      lineage: omLineage,
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(omExport, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `openmetadata_export_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // ─── Comments handlers ──────────────────────────────────────────────────
  const handleAddCommentAt = async (canvasX: number, canvasY: number, text: string) => {
    setPendingComment(null);
    setIsCommentMode(false);

    // Generate a client-side temporary ID
    const tempId = `cmt-temp-${Date.now()}`;
    const newComment: CanvasComment = {
      id: tempId,
      x: canvasX,
      y: canvasY,
      text,
      author: USER_NAME,
      createdAt: new Date().toISOString(),
      color: USER_COLOR,
      isOpen: true, // Show instantly as open
    };

    // Optimistically add comment to UI
    setComments((prev) => [...prev, newComment]);

    try {
      const commentAsset = {
        name: USER_NAME,
        asset_type: 'comment',
        description: text,
        version: 1,
        custom_attributes: {
          x: canvasX,
          y: canvasY,
          color: USER_COLOR,
          createdAt: new Date().toISOString(),
        },
        columns: [],
      };
      const createdAsset = await api.createAsset(commentAsset);
      // Promote temporary ID to permanent database UUID
      setComments((prev) =>
        prev.map((c) => (c.id === tempId ? { ...c, id: createdAsset.id } : c))
      );
    } catch (err) {
      console.error('Failed to create comment:', err);
      // Rollback on failure
      setComments((prev) => prev.filter((c) => c.id !== tempId));
    }
  };

  const handleDeleteComment = async (id: string) => {
    const deletedComment = comments.find((c) => c.id === id);

    // Optimistically remove from UI
    setComments((prev) => prev.filter((c) => c.id !== id));

    try {
      await api.deleteAsset(id);
    } catch (err) {
      console.error('Failed to delete comment:', err);
      // Rollback on failure
      if (deletedComment) {
        setComments((prev) => [...prev, deletedComment]);
      }
    }
  };

  const handleFocusComment = (comment: CanvasComment) => {
    if (reactFlowInstance.current) {
      reactFlowInstance.current.setCenter(comment.x, comment.y, { zoom: 1.2, duration: 600 });
    }
  };

  const handleUpdateCommentPosition = async (id: string, x: number, y: number) => {
    // Optimistically update position in UI
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, x, y } : c)));

    try {
      const commentNode = comments.find((c) => c.id === id);
      if (!commentNode) return;

      const updatedCustom = {
        x,
        y,
        color: commentNode.color,
        createdAt: commentNode.createdAt,
      };

      await api.updateAsset(id, { custom_attributes: updatedCustom });
    } catch (err) {
      console.error('Failed to update comment position:', err);
    }
  };

  const handleToggleCommentOpen = (id: string, isOpenVal?: boolean) => {
    setComments((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          return { ...c, isOpen: isOpenVal !== undefined ? isOpenVal : !c.isOpen };
        }
        return c;
      })
    );
  };

  // ─── Right-click context menu ────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canvasContainerRef.current) return;
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const { x: vx, y: vy, zoom } = getViewport();
    const canvasX = (mouseX - vx) / zoom;
    const canvasY = (mouseY - vy) / zoom;
    setContextMenu({ x: e.clientX, y: e.clientY, canvasX, canvasY });
  }, [getViewport]);

  const handleDeleteSelected = async () => {
    if (!reactFlowInstance.current) return;
    const selectedNodes = reactFlowInstance.current.getNodes().filter((n: any) => n.selected);
    const selectedEdges = reactFlowInstance.current.getEdges().filter((e: any) => e.selected);
    saveUndoState();
    try {
      for (const edge of selectedEdges) await api.deleteRelationship(edge.id);
      for (const node of selectedNodes) await api.deleteAsset(node.id);
      setSelectedAssetId(null);
      setSelectedColumnId(null);
      setSelectedEdgeId(null);
      loadWorkspaceData();
    } catch (err) {
      console.error('Failed to delete selected:', err);
    }
  };

  // ─── Canvas click handler (comment placement) ────────────────────────────
  const onPaneClick = useCallback((e: React.MouseEvent) => {
    setSelectedEdgeId(null);
    if (!isCommentMode || !canvasContainerRef.current) return;
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const { x: vx, y: vy, zoom } = getViewport();
    const canvasX = (mouseX - vx) / zoom;
    const canvasY = (mouseY - vy) / zoom;
    setPendingComment({ screenX: e.clientX, screenY: e.clientY, canvasX, canvasY });
  }, [isCommentMode, getViewport]);

  // Bind keydown events for shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true')) {
        return;
      }

      const ctrlOrCmd = e.ctrlKey || e.metaKey;

      if (ctrlOrCmd && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (ctrlOrCmd && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (ctrlOrCmd && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopy();
      } else if (ctrlOrCmd && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        handleCut();
      } else if (ctrlOrCmd && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste();
      } else if (ctrlOrCmd && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicate();
      } else if (ctrlOrCmd && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        handleGroupSelection();
      } else if (ctrlOrCmd && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        handleExportOpenMetadata();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedAssetId(null);
        setSelectedColumnId(null);
        setSelectedEdgeId(null);
        setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));
        setEdges((eds) => eds.map((e) => ({ ...e, selected: false })));
      } else if (e.key.toLowerCase() === 'v') {
        setEditorMode('select');
      } else if (e.key.toLowerCase() === 'm' || e.key === '+') {
        setEditorMode('multiselect');
      } else if (e.key.toLowerCase() === 'c') {
        setEditorMode('edgecut');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [assets, relationships, editorMode]);

  // Bind Light/Dark theme toggling to root HTML element AND body for full coverage
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light-theme');
      document.body.classList.add('light-theme');
    } else {
      root.classList.remove('light-theme');
      document.body.classList.remove('light-theme');
    }
  }, [theme]);


  // Zoom wheel sensitivity listener registered as a non-passive listener to prevent browser page zoom
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const handleWheelRaw = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const { x, y, zoom } = getViewport();

      const canvasX = (mouseX - x) / zoom;
      const canvasY = (mouseY - y) / zoom;

      // Custom multiplier to double the zoom wheel sensitivity
      const zoomDelta = -e.deltaY * 0.005;
      const nextZoom = Math.max(0.15, Math.min(2.5, zoom + zoomDelta));

      // Anchor zoom focus on current cursor location
      const nextX = mouseX - canvasX * nextZoom;
      const nextY = mouseY - canvasY * nextZoom;

      setViewport({ x: nextX, y: nextY, zoom: nextZoom });
    };

    container.addEventListener('wheel', handleWheelRaw, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheelRaw);
    };
  }, [getViewport, setViewport]);

  // Maps Assets and Relationships to React Flow Nodes and Edges
  const buildFlowNodesAndEdges = (allAssets: Asset[], allRels: Relationship[]) => {
    // 1. Identify trace highlights
    const highlightedNodeIds: string[] = [];
    const highlightedColumnIds: string[] = [];
    const highlightedEdgeIds: string[] = [];

    // Collect all active selection points
    const activeSelectedEdgeIds = new Set<string>();
    if (selectedEdgeId) activeSelectedEdgeIds.add(selectedEdgeId);
    selectedEdgeIds.forEach(id => activeSelectedEdgeIds.add(id));

    const activeSelectedAssetIds = new Set<string>();
    if (selectedAssetId && !selectedColumnId) activeSelectedAssetIds.add(selectedAssetId);
    selectedNodeIds.forEach(id => {
      const asset = allAssets.find(a => a.id === id);
      if (asset && asset.asset_type !== 'comment') {
        activeSelectedAssetIds.add(id);
      }
    });

    const activeSelectedColumnIds = new Set<string>();
    if (selectedColumnId) activeSelectedColumnIds.add(selectedColumnId);

    // -- 1. Trace Selected Edges/Relationships --
    activeSelectedEdgeIds.forEach((edgeId) => {
      const selectedRel = allRels.find((r) => r.id === edgeId);
      if (selectedRel) {
        if (!highlightedEdgeIds.includes(selectedRel.id)) highlightedEdgeIds.push(selectedRel.id);

        const destId = selectedRel.destination_node_id;

        // Recursive tracer to find all direct/indirect sources feeding into the destination column/table
        const findUpstreamSources = (targetId: string) => {
          allRels.forEach((rel) => {
            if (rel.destination_node_id === targetId) {
              if (!highlightedEdgeIds.includes(rel.id)) {
                highlightedEdgeIds.push(rel.id);
              }
              if (rel.source_node_type === 'column') {
                if (!highlightedColumnIds.includes(rel.source_node_id)) {
                  highlightedColumnIds.push(rel.source_node_id);
                  findUpstreamSources(rel.source_node_id);
                }
              } else {
                if (!highlightedNodeIds.includes(rel.source_node_id)) {
                  highlightedNodeIds.push(rel.source_node_id);
                }
              }
            }
          });
        };

        if (selectedRel.destination_node_type === 'column') {
          if (!highlightedColumnIds.includes(destId)) highlightedColumnIds.push(destId);
          findUpstreamSources(destId);
        } else {
          if (!highlightedNodeIds.includes(destId)) highlightedNodeIds.push(destId);
        }

        if (selectedRel.source_node_type === 'column') {
          if (!highlightedColumnIds.includes(selectedRel.source_node_id)) {
            highlightedColumnIds.push(selectedRel.source_node_id);
          }
        } else {
          if (!highlightedNodeIds.includes(selectedRel.source_node_id)) {
            highlightedNodeIds.push(selectedRel.source_node_id);
          }
        }
      }
    });

    // -- 2. Trace Selected Columns --
    activeSelectedColumnIds.forEach((colId) => {
      if (!highlightedColumnIds.includes(colId)) highlightedColumnIds.push(colId);

      allRels.forEach((rel) => {
        const isSource = rel.source_node_type === 'column' && rel.source_node_id === colId;
        const isDest = rel.destination_node_type === 'column' && rel.destination_node_id === colId;
        if (isSource || isDest) {
          if (!highlightedEdgeIds.includes(rel.id)) {
            highlightedEdgeIds.push(rel.id);
          }
          // Highlight other ends of the edges
          if (isSource) {
            if (rel.destination_node_type === 'column') {
              if (!highlightedColumnIds.includes(rel.destination_node_id)) highlightedColumnIds.push(rel.destination_node_id);
            } else {
              if (!highlightedNodeIds.includes(rel.destination_node_id)) highlightedNodeIds.push(rel.destination_node_id);
            }
          } else {
            if (rel.source_node_type === 'column') {
              if (!highlightedColumnIds.includes(rel.source_node_id)) highlightedColumnIds.push(rel.source_node_id);
            } else {
              if (!highlightedNodeIds.includes(rel.source_node_id)) highlightedNodeIds.push(rel.source_node_id);
            }
          }
        }
      });
    });

    // -- 3. Trace Selected Assets/Tables --
    activeSelectedAssetIds.forEach((assetId) => {
      if (!highlightedNodeIds.includes(assetId)) highlightedNodeIds.push(assetId);

      const assetCols = allAssets.find((a) => a.id === assetId)?.columns?.map((c) => c.id) || [];
      allRels.forEach((rel) => {
        const isSourceAsset = rel.source_node_id === assetId || (rel.source_node_type === 'column' && assetCols.includes(rel.source_node_id));
        const isDestAsset = rel.destination_node_id === assetId || (rel.destination_node_type === 'column' && assetCols.includes(rel.destination_node_id));
        
        if (isSourceAsset || isDestAsset) {
          if (!highlightedEdgeIds.includes(rel.id)) {
            highlightedEdgeIds.push(rel.id);
          }
          if (isSourceAsset) {
            if (rel.destination_node_type === 'column') {
              if (!highlightedColumnIds.includes(rel.destination_node_id)) highlightedColumnIds.push(rel.destination_node_id);
            } else {
              if (!highlightedNodeIds.includes(rel.destination_node_id)) highlightedNodeIds.push(rel.destination_node_id);
            }
          } else {
            if (rel.source_node_type === 'column') {
              if (!highlightedColumnIds.includes(rel.source_node_id)) highlightedColumnIds.push(rel.source_node_id);
            } else {
              if (!highlightedNodeIds.includes(rel.source_node_id)) highlightedNodeIds.push(rel.source_node_id);
            }
          }
        }
      });
    });

    // -- 4. Post-Process Parent Asset Highlights for all highlighted Columns --
    highlightedColumnIds.forEach((colId) => {
      const parentAsset = allAssets.find((a) =>
        a.columns?.some((c) => c.id === colId)
      );
      if (parentAsset && !highlightedNodeIds.includes(parentAsset.id)) {
        highlightedNodeIds.push(parentAsset.id);
      }
    });

    // 2. Create Nodes
    const flowNodes: Node[] = allAssets.map((asset, index) => {
      const savedPos = asset.custom_attributes?.position as { x: number; y: number } | undefined;
      const defaultPos = { x: 50 + (index % 3) * 350, y: 50 + Math.floor(index / 3) * 450 };

      if (asset.asset_type === 'group') {
        return {
          id: asset.id,
          type: 'groupNode',
          position: savedPos || defaultPos,
          zIndex: -1,
          style: {
            width: asset.custom_attributes?.width || 450,
            height: asset.custom_attributes?.height || 350,
          },
          data: {
            id: asset.id,
            name: asset.name,
            color: asset.custom_attributes?.color || 'teal',
            onUpdateName: (newName: string) => handleUpdateAsset(asset.id, { name: newName }),
            onUpdateColor: (newColor: string) => handleUpdateAsset(asset.id, {
              custom_attributes: {
                ...asset.custom_attributes,
                color: newColor,
              },
            }),
            onDelete: () => handleDeleteAsset(asset.id),
          },
        };
      }

      return {
        id: asset.id,
        type: 'csvNode',
        position: savedPos || defaultPos,
        dragHandle: '.group\\/header', // Drag via header bar
        data: {
          id: asset.id,
          name: asset.name,
          row_count: asset.row_count,
          column_count: asset.column_count,
          columns: asset.columns || [],
          onDeleteAsset: handleDeleteAsset,
          onSelectColumn: handleSelectColumn,
          onSelectAssetHeader: handleSelectAssetHeader,
          selectedAssetId: selectedAssetId,
          selectedColumnId: selectedColumnId,
          connectingState,
          highlightedNodeIds,
          highlightedColumnIds,
        },
      };
    });

    // Add active comments as nodes (if visible)
    if (showComments) {
      comments.forEach((comment) => {
        flowNodes.push({
          id: comment.id,
          type: 'commentNode',
          position: { x: comment.x, y: comment.y },
          dragHandle: '.comment-pin',
          data: {
            comment,
            onDelete: handleDeleteComment,
            onToggleOpen: (isOpenVal?: boolean) => handleToggleCommentOpen(comment.id, isOpenVal),
          },
        });
      });
    }

    // Add pending comment node
    if (pendingComment) {
      flowNodes.push({
        id: 'pending-comment',
        type: 'newCommentNode',
        position: { x: pendingComment.canvasX, y: pendingComment.canvasY },
        draggable: false,
        data: {
          authorName: USER_NAME,
          authorColor: USER_COLOR,
          onSubmit: (text: string) => handleAddCommentAt(pendingComment.canvasX, pendingComment.canvasY, text),
          onCancel: () => setPendingComment(null),
        },
      });
    }

    // 3. Create Edges
    const flowEdges: Edge[] = allRels.map((rel) => {
      let sourceNodeId = rel.source_node_id;
      let sourceHandleId = 'asset-source';

      if (rel.source_node_type === 'column') {
        const parentAsset = allAssets.find((a) =>
          a.columns?.some((c) => c.id === rel.source_node_id)
        );
        if (parentAsset) {
          sourceNodeId = parentAsset.id;
          sourceHandleId = `col-source-${rel.source_node_id}`;
        }
      }

      let targetNodeId = rel.destination_node_id;
      let targetHandleId = 'asset-target';

      if (rel.destination_node_type === 'column') {
        const parentAsset = allAssets.find((a) =>
          a.columns?.some((c) => c.id === rel.destination_node_id)
        );
        if (parentAsset) {
          targetNodeId = parentAsset.id;
          targetHandleId = `col-target-${rel.destination_node_id}`;
        }
      }

      const edgeColor = getDeterministicColor(rel.id);

      const isEdgeHighlighted = highlightedEdgeIds.includes(rel.id);
      const isEdgeSelected = rel.id === selectedEdgeId;

      return {
        id: rel.id,
        type: 'lineageEdge',
        source: sourceNodeId,
        target: targetNodeId,
        sourceHandle: sourceHandleId,
        targetHandle: targetHandleId,
        animated: selectedEdgeId ? isEdgeHighlighted : true,
        selected: isEdgeSelected,
        data: {
          isHighlighted: isEdgeHighlighted,
        },
        style: {
          stroke: edgeColor,
          strokeWidth: isEdgeSelected ? 3.5 : (isEdgeHighlighted ? 2.5 : 1.8),
          opacity: selectedEdgeId ? (isEdgeHighlighted ? 1.0 : 0.15) : 0.85,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 15,
          height: 15,
          color: edgeColor,
        },
      };
    });

    setNodes(flowNodes);
    setEdges(flowEdges);
  };

  // Sync selection, connection, and metadata details to nodes data
  useEffect(() => {
    buildFlowNodesAndEdges(assets, relationships);
  }, [
    assets,
    relationships,
    selectedAssetId,
    selectedColumnId,
    selectedEdgeId,
    selectedNodeIds,
    selectedEdgeIds,
    connectingState,
    comments,
    pendingComment,
    showComments,
  ]);

  // Asset/Column Selection triggers
  const handleSelectAssetHeader = (assetId: string) => {
    if (selectedAssetId === assetId && !selectedColumnId) {
      setSelectedAssetId(null);
    } else {
      setSelectedAssetId(assetId);
    }
    setSelectedColumnId(null);
    setSelectedEdgeId(null);
  };

  const handleSelectColumn = (col: Column) => {
    setSelectedAssetId(col.asset_id);
    setSelectedColumnId(col.id);
    setSelectedEdgeId(null);
  };

  // Focus/Fly-to node on the canvas
  const handleFocusNode = (assetId: string, columnId?: string) => {
    setSelectedAssetId(assetId);
    if (columnId) {
      setSelectedColumnId(columnId);
    } else {
      setSelectedColumnId(null);
    }
    setSelectedEdgeId(null);

    const node = nodes.find((n) => n.id === assetId);
    if (node && reactFlowInstance.current) {
      reactFlowInstance.current.setCenter(node.position.x + 144, node.position.y + 150, {
        zoom: 1.1,
        duration: 800,
      });
    }
  };

  // Dragging node broadcasts position to other users
  const handleNodeDrag = (e: React.MouseEvent, node: Node) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event_type: 'node_drag',
          data: {
            clientId: CLIENT_ID,
            nodeId: node.id,
            position: node.position,
            workspace_id: activeWorkspaceRef.current,
          },
        })
      );
    }
  };

  // Drag stop saves position permanently to asset attributes
  const handleNodeDragStop = async (e: React.MouseEvent, node: Node) => {
    saveUndoState();
    
    // Intercept dragging comments and update local coordinate state
    if (node.id.startsWith('cmt-')) {
      handleUpdateCommentPosition(node.id, node.position.x, node.position.y);
      return;
    }

    const asset = assets.find((a) => a.id === node.id);
    if (!asset) return;

    const currentCustom = asset.custom_attributes || {};
    const updatedCustom = {
      ...currentCustom,
      position: node.position,
    };

    // Optimistically update local state immediately
    setAssets((prev) =>
      prev.map((a) => (a.id === node.id ? { ...a, custom_attributes: updatedCustom } : a))
    );

    try {
      await api.updateAsset(node.id, { custom_attributes: updatedCustom });
    } catch (err) {
      console.error('Failed to save node position:', err);
      // Revert local state
      setAssets((prev) =>
        prev.map((a) => (a.id === node.id ? { ...a, custom_attributes: currentCustom } : a))
      );
    }
  };

  // Delete asset handler
  const handleDeleteAsset = async (assetId: string) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;
    
    const isGroup = asset.asset_type === 'group';
    const message = isGroup
      ? `Are you sure you want to dissolve the group '${asset.name}'?`
      : `Are you sure you want to delete the metadata for '${asset.name}'? All associated lineage connections will be removed.`;

    const confirmed = await dialog.confirm(isGroup ? 'Dissolve Group' : 'Delete Table', message, 'danger');
    if (confirmed) {
      saveUndoState();
      const originalAssets = assets;
      const originalRels = relationships;

      // Optimistically remove asset, scrub table references from other formulas, and remove relationships from state
      setAssets((prev) =>
        prev
          .filter((a) => a.id !== assetId)
          .map((a) => {
            if (!a.columns) return a;
            return {
              ...a,
              columns: a.columns.map((col) => {
                const formula = col.custom_attributes?.formula;
                if (formula) {
                  const updatedFormula = removeTableReferencesFromFormula(formula, asset.name);
                  if (updatedFormula !== formula) {
                    const updatedCustom = {
                      ...(col.custom_attributes || {}),
                      formula: updatedFormula,
                    };
                    api.updateColumn(col.id, { custom_attributes: updatedCustom }).catch(console.error);
                    return { ...col, custom_attributes: updatedCustom };
                  }
                }
                return col;
              }),
            };
          })
      );
      setRelationships((prev) => prev.filter((r) => r.source_node_id !== assetId && r.destination_node_id !== assetId));
      if (selectedAssetId === assetId) {
        setSelectedAssetId(null);
        setSelectedColumnId(null);
      }

      try {
        await api.deleteAsset(assetId);
        api.getActivities(30).then(setActivities).catch(console.error);
      } catch (err) {
        console.error('Failed to delete asset:', err);
        setAssets(originalAssets);
        setRelationships(originalRels);
      }
    }
  };

  // Delete column handler
  const handleDeleteColumn = async (columnId: string) => {
    let colName = 'Column';
    let assetName = '';
    for (const a of assets) {
      const col = a.columns?.find((c) => c.id === columnId);
      if (col) {
        colName = col.name;
        assetName = a.name;
        break;
      }
    }
    const displayName = assetName ? `${assetName}.${colName}` : colName;

    const confirmed = await dialog.confirm('Delete Column', `Are you sure you want to delete column '${displayName}'? All associated lineage connections will be removed.`, 'danger');
    if (confirmed) {
      saveUndoState();
      const originalAssets = assets;
      const originalRels = relationships;

      // Optimistically remove the column from the asset, clean up its formula references, and remove relationships
      setAssets((prev) =>
        prev.map((asset) => {
          const isTargetAsset = asset.columns?.some(c => c.id === columnId);
          const filteredCols = asset.columns ? asset.columns.filter((c) => c.id !== columnId) : [];
          
          return {
            ...asset,
            columns: filteredCols.map((col) => {
              const formula = col.custom_attributes?.formula;
              if (formula) {
                const isSameTable = asset.name === assetName;
                let updatedFormula = removeReferenceFromFormula(formula, `${assetName}.${colName}`);
                if (isSameTable) {
                  updatedFormula = removeReferenceFromFormula(updatedFormula, colName);
                }
                if (updatedFormula !== formula) {
                  const updatedCustom = {
                    ...(col.custom_attributes || {}),
                    formula: updatedFormula,
                  };
                  api.updateColumn(col.id, { custom_attributes: updatedCustom }).catch(console.error);
                  return { ...col, custom_attributes: updatedCustom };
                }
              }
              return col;
            }),
            column_count: isTargetAsset ? filteredCols.length : (asset.columns ? asset.columns.length : 0),
          };
        })
      );
      setRelationships((prev) =>
        prev.filter((r) => r.source_node_id !== columnId && r.destination_node_id !== columnId)
      );

      if (selectedColumnId === columnId) {
        setSelectedColumnId(null);
      }

      try {
        await api.deleteColumn(columnId);
        api.getActivities(30).then(setActivities).catch(console.error);
      } catch (err) {
        console.error('Failed to delete column:', err);
        setAssets(originalAssets);
        setRelationships(originalRels);
      }
    }
  };

  // Metadata Updates (keeps position intact while editing descriptions/notes/properties)
  const handleUpdateAsset = async (assetId: string, updates: Partial<Asset>) => {
    const existingAsset = assets.find((a) => a.id === assetId);
    if (!existingAsset) return;

    const originalAssets = assets;
    const mergedAttributes = {
      ...existingAsset.custom_attributes,
      ...updates.custom_attributes,
    };
    
    const updatedAsset = {
      ...existingAsset,
      ...updates,
      custom_attributes: mergedAttributes,
    };

    // Optimistically update local assets state
    setAssets((prev) => prev.map((a) => (a.id === assetId ? updatedAsset : a)));

    try {
      await api.updateAsset(assetId, updates);
      // Fetch activities in the background to update the log
      api.getActivities(30).then(setActivities).catch(console.error);
    } catch (err) {
      // Revert on failure
      setAssets(originalAssets);
      await dialog.alert('Error', 'Failed to save table modifications.', 'danger');
    }
  };

  const handleUpdateColumn = async (columnId: string, updates: Partial<Column>) => {
    const originalAssets = assets;
    const originalRels = relationships;

    // Check if formula is updated
    if (updates.custom_attributes && 'formula' in updates.custom_attributes) {
      const newFormula = updates.custom_attributes.formula || '';
      
      // Find the asset of this column
      const parentAsset = assets.find(a => a.columns?.some(c => c.id === columnId));
      if (parentAsset) {
        const referencedColIds = findReferencedColumnIds(newFormula, parentAsset.id, assets);
        
        // Find existing DERIVES_FROM relationships to this destination column
        const existingRels = relationships.filter(
          r => r.destination_node_type === 'column' && 
               r.destination_node_id === columnId && 
               r.relationship_type === 'DERIVES_FROM'
        );
        
        const existingSourceIds = existingRels.map(r => r.source_node_id);
        
        // Relationships to delete
        const relsToDelete = existingRels.filter(r => !referencedColIds.includes(r.source_node_id));
        // Relationships to create
        const sourceIdsToCreate = referencedColIds.filter(id => !existingSourceIds.includes(id));
        // Relationships to update (existing ones that are still referenced)
        const relsToUpdate = existingRels.filter(r => referencedColIds.includes(r.source_node_id));
        
        if (relsToDelete.length > 0 || sourceIdsToCreate.length > 0 || relsToUpdate.length > 0) {
          // Perform optimistic relationship update
          setRelationships(prev => {
            let updated = prev.filter(r => !relsToDelete.some(td => td.id === r.id));
            
            // Update formula for existing ones
            updated = updated.map(r => {
              if (relsToUpdate.some(tu => tu.id === r.id)) {
                return {
                  ...r,
                  metadata_json: {
                    ...(r.metadata_json || {}),
                    formula: newFormula
                  }
                };
              }
              return r;
            });

            sourceIdsToCreate.forEach(srcId => {
              const tempId = `temp_rel_${Math.random().toString(36).substring(2, 9)}`;
              updated.push({
                id: tempId,
                source_node_type: 'column',
                source_node_id: srcId,
                destination_node_type: 'column',
                destination_node_id: columnId,
                relationship_type: 'DERIVES_FROM',
                metadata_json: { formula: newFormula },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
            });
            
            return updated;
          });
          
          // Send background updates to server
          relsToDelete.forEach(async (r) => {
            try {
              await api.deleteRelationship(r.id);
            } catch (err) {
              console.error('Failed to delete relationship in background:', err);
            }
          });
          
          sourceIdsToCreate.forEach(async (srcId) => {
            try {
              const created = await api.createRelationship({
                source_node_type: 'column',
                source_node_id: srcId,
                destination_node_type: 'column',
                destination_node_id: columnId,
                relationship_type: 'DERIVES_FROM',
                metadata_json: { formula: newFormula }
              });
              setRelationships((prev) =>
                prev.map((r) =>
                  r.source_node_id === srcId &&
                  r.destination_node_id === columnId &&
                  r.id.startsWith('temp_rel_')
                    ? created
                    : r
                )
              );
            } catch (err) {
              console.error('Failed to create relationship in background:', err);
            }
          });

          relsToUpdate.forEach(async (r) => {
            try {
              await api.updateRelationship(r.id, {
                metadata_json: {
                  ...(r.metadata_json || {}),
                  formula: newFormula
                }
              });
            } catch (err) {
              console.error('Failed to update relationship in background:', err);
            }
          });
        }
      }
    }

    setAssets((prev) =>
      prev.map((asset) => {
        const hasCol = asset.columns?.some((c) => c.id === columnId);
        if (hasCol) {
          return {
            ...asset,
            columns: asset.columns.map((col) => {
              if (col.id === columnId) {
                // Merge custom attributes correctly
                const mergedAttributes = {
                  ...(col.custom_attributes || {}),
                  ...(updates.custom_attributes || {}),
                };
                return { ...col, ...updates, custom_attributes: mergedAttributes };
              }
              return col;
            }),
          };
        }
        return asset;
      })
    );

    try {
      await api.updateColumn(columnId, updates);
      // Fetch activities in the background to update the log
      api.getActivities(30).then(setActivities).catch(console.error);
    } catch (err) {
      // Revert on failure
      setAssets(originalAssets);
      setRelationships(originalRels);
      await dialog.alert('Error', 'Failed to save column annotations.', 'danger');
    }
  };


  // Lineage connection events - Instantly connect as MAPS_TO default type without popup selector
  const onConnect = useCallback(async (connection: Connection) => {
    const { source, target, sourceHandle, targetHandle } = connection;
    if (!source || !target || !sourceHandle || !targetHandle) return;

    const sourceIsColumn = sourceHandle.startsWith('col-');
    const sourceNodeId = sourceIsColumn ? sourceHandle.replace('col-source-', '') : source;
    const sourceNodeType = sourceIsColumn ? 'column' : 'asset';

    const targetIsColumn = targetHandle.startsWith('col-');
    const targetNodeId = targetIsColumn ? targetHandle.replace('col-target-', '') : target;
    const targetNodeType = targetIsColumn ? 'column' : 'asset';

    saveUndoState();

    const tempId = 'temp-rel-' + Math.random().toString(36).substring(2, 9);
    const newRel: Relationship = {
      id: tempId,
      source_node_type: sourceNodeType,
      source_node_id: sourceNodeId,
      destination_node_type: targetNodeType,
      destination_node_id: targetNodeId,
      relationship_type: 'MAPS_TO',
      metadata_json: {},
    };

    // Optimistically update relationships
    setRelationships((prev) => [...prev, newRel]);

    try {
      const created = await api.createRelationship({
        source_node_type: sourceNodeType,
        source_node_id: sourceNodeId,
        destination_node_type: targetNodeType,
        destination_node_id: targetNodeId,
        relationship_type: 'MAPS_TO',
        metadata_json: {},
      });
      // Replace temporary ID with actual DB UUID
      setRelationships((prev) =>
        prev.map((r) => (r.id === tempId ? created : r))
      );
      api.getActivities(30).then(setActivities).catch(console.error);
    } catch (err: any) {
      // Revert on failure
      setRelationships((prev) => prev.filter((r) => r.id !== tempId));
      await dialog.alert('Connection Error', err.message || 'Failed to create lineage connection.', 'danger');
    }
  }, [assets, relationships]);

  const onConnectStart = useCallback((_e: any, { nodeId, handleId, handleType }: { nodeId: string; handleId: string | null; handleType: 'source' | 'target' }) => {
    setConnectingState({ nodeId, handleId, handleType });
  }, []);

  const onConnectEnd = useCallback(() => {
    // Short delay to avoid flickering
    setTimeout(() => {
      setConnectingState(null);
    }, 250);
  }, []);

  const onSelectionChange = useCallback((params: { nodes: Node[]; edges: Edge[] }) => {
    setSelectedNodeIds(params.nodes.map(n => n.id));
    setSelectedEdgeIds(params.edges.map(e => e.id));
  }, []);

  const onEdgeClick = useCallback(async (e: React.MouseEvent, edge: Edge) => {
    if (editorMode === 'edgecut') {
      saveUndoState();
      const originalRels = relationships;
      // Optimistically remove
      setRelationships((prev) => prev.filter((r) => r.id !== edge.id));
      if (selectedEdgeId === edge.id) {
        setSelectedEdgeId(null);
      }
      try {
        await api.deleteRelationship(edge.id);
        api.getActivities(30).then(setActivities).catch(console.error);
      } catch (err) {
        console.error('Failed to cut edge:', err);
        setRelationships(originalRels);
      }
    } else {
      setSelectedEdgeId(edge.id);
      setSelectedAssetId(null);
      setSelectedColumnId(null);
    }
  }, [editorMode, selectedEdgeId, assets, relationships]);


  const handleDeleteRelationship = async (relId: string) => {
    saveUndoState();
    const originalRels = relationships;
    const originalAssets = assets;
    
    // Find relationship details before deleting
    const rel = relationships.find((r) => r.id === relId);
    
    // Optimistically remove
    setRelationships((prev) => prev.filter((r) => r.id !== relId));
    if (selectedEdgeId === relId) {
      setSelectedEdgeId(null);
    }

    // If the relationship is a DERIVES_FROM relationship, update formula references in destination column
    if (
      rel &&
      rel.relationship_type === 'DERIVES_FROM' &&
      rel.source_node_type === 'column' &&
      rel.destination_node_type === 'column'
    ) {
      const srcCol = assets.flatMap((a) => a.columns || []).find((c) => c.id === rel.source_node_id);
      const srcAsset = assets.find((a) => a.columns?.some((c) => c.id === rel.source_node_id));
      const destCol = assets.flatMap((a) => a.columns || []).find((c) => c.id === rel.destination_node_id);
      
      if (srcCol && destCol && srcAsset) {
        const currentFormula = destCol.custom_attributes?.formula || '';
        let updatedFormula = removeReferenceFromFormula(currentFormula, `${srcAsset.name}.${srcCol.name}`);
        updatedFormula = removeReferenceFromFormula(updatedFormula, srcCol.name);
        
        if (updatedFormula !== currentFormula) {
          const updatedCustom = {
            ...(destCol.custom_attributes || {}),
            formula: updatedFormula,
          };
          
          // Optimistically update asset's column custom_attributes in state
          setAssets((prev) =>
            prev.map((asset) => {
              if (asset.columns?.some((c) => c.id === destCol.id)) {
                return {
                  ...asset,
                  columns: asset.columns.map((col) =>
                    col.id === destCol.id ? { ...col, custom_attributes: updatedCustom } : col
                  ),
                };
              }
              return asset;
            })
          );
          
          // Persist update in background
          try {
            await api.updateColumn(destCol.id, { custom_attributes: updatedCustom });
          } catch (err) {
            console.error('Failed to update column formula in background:', err);
          }
        }
      }
    }

    try {
      await api.deleteRelationship(relId);
      api.getActivities(30).then(setActivities).catch(console.error);
    } catch (err) {
      console.error('Failed to delete relationship:', err);
      setRelationships(originalRels);
      setAssets(originalAssets);
    }
  };

  const handleUpdateRelationship = async (relId: string, updates: Partial<Relationship>) => {
    saveUndoState();
    const originalRels = relationships;
    const originalAssets = assets;

    // Find the relationship details before updating
    const rel = relationships.find(r => r.id === relId);

    // Optimistically update relationship state
    setRelationships((prev) =>
      prev.map((r) =>
        r.id === relId
          ? {
              ...r,
              ...updates,
              metadata_json: {
                ...(r.metadata_json || {}),
                ...(updates.metadata_json || {}),
              },
            }
          : r
      )
    );

    // If formula is updated in relationship metadata, propagate to destination column formula
    if (updates.metadata_json && 'formula' in updates.metadata_json && rel && rel.destination_node_type === 'column') {
      const newFormula = updates.metadata_json.formula || '';
      
      setAssets((prev) =>
        prev.map((asset) => {
          if (asset.columns?.some((c) => c.id === rel.destination_node_id)) {
            return {
              ...asset,
              columns: asset.columns.map((col) => {
                if (col.id === rel.destination_node_id) {
                  return {
                    ...col,
                    custom_attributes: {
                      ...(col.custom_attributes || {}),
                      formula: newFormula
                    }
                  };
                }
                return col;
              })
            };
          }
          return asset;
        })
      );
      
      // Update column formula in the background
      const existingCol = originalAssets.flatMap(a => a.columns || []).find(c => c.id === rel.destination_node_id);
      if (existingCol) {
        api.updateColumn(rel.destination_node_id, {
          custom_attributes: {
            ...(existingCol.custom_attributes || {}),
            formula: newFormula
          }
        }).catch(console.error);
      }
    }

    try {
      await api.updateRelationship(relId, updates);
      api.getActivities(30).then(setActivities).catch(console.error);
    } catch (err) {
      console.error('Failed to update relationship:', err);
      setRelationships(originalRels);
      setAssets(originalAssets);
    }
  };

  // Find active asset/column
  const activeAsset = selectedAssetId ? assets.find((a) => a.id === selectedAssetId) || null : null;
  const activeColumn = selectedColumnId && activeAsset
    ? activeAsset.columns?.find((c) => c.id === selectedColumnId) || null
    : null;

  return (
    <div className={`flex h-screen w-screen overflow-hidden bg-workspace-950 text-workspace-50 font-sans select-none ${theme === 'light' ? 'light-theme' : ''}`}>
      
      {/* 1. LEFT SIDEBAR (Upload, Search, Tables List & Pinned Comments) */}
      <div style={{ width: leftWidth }} className="h-full shrink-0 flex flex-col">
        <div className="flex-1 min-h-0">
          <LeftSidebar
            assets={assets}
            isLoadingAssets={isLoading && assets.length === 0}
            onRefreshAssets={loadWorkspaceData}
            onFocusNode={handleFocusNode}
            selectedAssetId={selectedAssetId}
            onSelectAssetHeader={handleSelectAssetHeader}
            onShowImportPreview={(data) => {
              setPreviewData(data);
              setIsPreviewOpen(true);
            }}
            activeWorkspace={activeWorkspace}
            workspaces={workspaces}
            onSelectWorkspace={handleSelectWorkspace}
            onAddWorkspace={handleAddWorkspace}
            onRenameWorkspace={handleRenameWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
            comments={comments}
            isCommentMode={isCommentMode}
            onToggleCommentMode={() => {
              setIsCommentMode((v) => {
                const nextVal = !v;
                if (nextVal) {
                  setShowComments(true);
                }
                return nextVal;
              });
            }}
            onDeleteComment={handleDeleteComment}
            onFocusComment={handleFocusComment}
            onToggleCommentOpen={handleToggleCommentOpen}
          />
        </div>
      </div>

      {/* Left Resize Handle */}
      <div
        onMouseDown={startResizeLeft}
        className="w-1.5 hover:w-2 bg-workspace-750/30 hover:bg-brand-teal/40 cursor-col-resize transition-all shrink-0 z-20"
      />

      {/* 2. CENTER CANVAS & BOTTOM PANEL CONTAINER */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        
        {/* Workspace Canvas Header */}
        <CanvasHeader
          backendStatus={backendStatus}
          wsConnected={wsConnected}
          activeUsersCount={workspaceUserCounts[activeWorkspace] || Object.keys(otherCursors).length + 1}
          globalUsersCount={globalUserCount}
        />

        {/* Canvas Area */}
        <div
          ref={canvasContainerRef}
          onMouseMove={handleMouseMove}
          onContextMenu={handleContextMenu}
          className={`flex-1 min-h-0 relative w-full ${
            isCommentMode
              ? 'cursor-crosshair'
              : editorMode === 'multiselect'
              ? 'cursor-cell'
              : editorMode === 'edgecut'
              ? 'cursor-no-drop'
              : ''
          }`}
        >
          {isLoading && assets.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-workspace-950 z-20">
              <div className="flex flex-col items-center space-y-4 max-w-md text-center px-6">
                <Loader2 className="animate-spin text-brand-teal" size={40} />
                <span className="text-base text-workspace-200 font-semibold font-mono">Loading Lineage Workspace</span>
                {backendStatus === 'error' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-brand-coral font-mono animate-pulse">
                      Connection to server failed. Retrying...
                    </p>
                    <p className="text-[11px] text-workspace-400 leading-relaxed font-mono">
                      This usually happens during database wake-up (Neon serverless cold start). The application will load automatically once the server is ready.
                    </p>
                  </div>
                ) : (
                  <span className="text-xs text-workspace-400 font-mono">Connecting to backend services...</span>
                )}
              </div>
            </div>
          ) : null}

          {/* Sleek Floating Toolbar at Top Center */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-workspace-850/90 backdrop-blur-md border border-workspace-700 rounded-xl px-3 py-1.5 flex items-center space-x-2 shadow-2xl z-30 pointer-events-auto select-none">
            {/* Deselect button */}
            <div className="flex items-center border-r border-workspace-750 pr-2">
              <button
                onClick={() => {
                  setSelectedAssetId(null);
                  setSelectedColumnId(null);
                  setSelectedEdgeId(null);
                  setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));
                  setEdges((eds) => eds.map((e) => ({ ...e, selected: false })));
                }}
                title="Deselect All (ESC)"
                disabled={!selectedAssetId && !selectedColumnId && !selectedEdgeId && !nodes.some(n => n.selected) && !edges.some(e => e.selected)}
                className="p-1.5 rounded-lg text-workspace-400 hover:text-brand-coral hover:bg-workspace-800 disabled:opacity-25 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <XCircle size={14} />
              </button>
            </div>

            {/* Mode selection group */}
            <div className="flex items-center space-x-0.5 border-r border-workspace-750 pr-2">
              <button
                onClick={() => setEditorMode('select')}
                title="Select Mode (V)"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  editorMode === 'select'
                    ? 'bg-brand-teal/20 text-brand-teal'
                    : 'text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800'
                }`}
              >
                <MousePointer size={14} />
              </button>
              <button
                onClick={() => setEditorMode('multiselect')}
                title="Multi-Select Mode (M / +)"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  editorMode === 'multiselect'
                    ? 'bg-brand-teal/20 text-brand-teal'
                    : 'text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800'
                }`}
              >
                <PlusSquare size={14} />
              </button>
              <button
                onClick={() => setEditorMode('edgecut')}
                title="Edge Cut Mode (C) — click an edge to remove"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  editorMode === 'edgecut'
                    ? 'bg-brand-coral/20 text-brand-coral'
                    : 'text-workspace-400 hover:text-brand-coral/80 hover:bg-workspace-800'
                }`}
              >
                <Scissors size={14} />
              </button>
            </div>

            {/* Undo / Redo group */}
            <div className="flex items-center space-x-0.5 border-r border-workspace-750 pr-2">
              <button
                onClick={handleUndo}
                title="Undo (Ctrl+Z)"
                disabled={undoStackRef.current.length === 0}
                className="p-1.5 rounded-lg text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800 disabled:opacity-25 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <Undo2 size={14} />
              </button>
              <button
                onClick={handleRedo}
                title="Redo (Ctrl+Y)"
                disabled={redoStackRef.current.length === 0}
                className="p-1.5 rounded-lg text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800 disabled:opacity-25 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <Redo2 size={14} />
              </button>
            </div>

            {/* Clipboard and layout actions - only enabled when something is selected or clipboard has content */}
            <div className="flex items-center space-x-0.5 border-r border-workspace-750 pr-2">
              <button
                onClick={handleCopy}
                title="Copy (Ctrl+C)"
                disabled={!hasSelection}
                className="p-1.5 rounded-lg text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800 disabled:opacity-25 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={handleCut}
                title="Cut (Ctrl+X)"
                disabled={!hasSelection}
                className="p-1.5 rounded-lg text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800 disabled:opacity-25 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <Scissors size={14} className="rotate-90" />
              </button>
              <button
                onClick={handlePaste}
                title="Paste (Ctrl+V)"
                disabled={!clipboardRef.current}
                className="p-1.5 rounded-lg text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800 disabled:opacity-25 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <Clipboard size={14} />
              </button>
              <button
                onClick={handleDuplicate}
                title="Duplicate (Ctrl+D)"
                disabled={!hasSelection}
                className="p-1.5 rounded-lg text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800 disabled:opacity-25 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <CopyPlus size={14} />
              </button>
              <button
                onClick={handleGroupSelection}
                title="Group (Ctrl+G)"
                disabled={!hasSelection}
                className="p-1.5 rounded-lg text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800 disabled:opacity-25 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <Boxes size={14} />
              </button>
            </div>

            {/* Comments toggle */}
            <div className="flex items-center space-x-0.5 border-r border-workspace-750 pr-2">
              <button
                onClick={() => {
                  setShowComments((v) => !v);
                }}
                title={showComments ? 'Hide comments from canvas & minimap' : 'Show comments'}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer relative ${
                  showComments ? 'bg-brand-teal/20 text-brand-teal' : 'text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800'
                }`}
              >
                <MessageSquare size={14} />
                {comments.length > 0 && (
                  <span className="absolute -top-1 -right-1 text-[8px] bg-brand-teal text-workspace-950 rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
                    {comments.length}
                  </span>
                )}
              </button>
            </div>

            {/* Export and Theme group */}
            <div className="flex items-center space-x-0.5">
              <button
                onClick={handleExportOpenMetadata}
                title="Export OpenMetadata JSON (Ctrl+E)"
                className="p-1.5 rounded-lg text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800 transition-colors cursor-pointer"
              >
                <Download size={14} />
              </button>
              <button
                onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
                className="p-1.5 rounded-lg text-workspace-400 hover:text-brand-teal hover:bg-workspace-800 transition-colors cursor-pointer"
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            </div>
          </div>

          {/* React Flow Editor */}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeDrag={handleNodeDrag}
            onNodeDragStop={handleNodeDragStop}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            connectionLineComponent={CustomConnectionLine}
            onSelectionChange={onSelectionChange}
            onInit={(instance) => {
              reactFlowInstance.current = instance;
            }}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            zoomOnScroll={false}
            panOnScroll={true}
            panOnDrag={editorMode !== 'multiselect'}
            selectionOnDrag={editorMode === 'multiselect'}
            selectionKeyCode={editorMode === 'multiselect' ? null : 'Shift'}
            multiSelectionKeyCode="Shift"
            proOptions={{ hideAttribution: true }}
          >
            <Background color={theme === 'dark' ? '#1f2025' : '#cbd5e1'} gap={24} size={1} />
            <Controls />
            {showMiniMap ? (
              <CustomMiniMap
                nodes={nodes}
                edges={edges}
                selectedAssetId={selectedAssetId}
                selectedColumnId={selectedColumnId}
                selectedEdgeId={selectedEdgeId}
                relationships={relationships}
                assets={assets}
                onClose={() => setShowMiniMap(false)}
              />
            ) : (
              <button
                onClick={() => setShowMiniMap(true)}
                className="absolute bottom-5 right-5 px-3 py-2 bg-workspace-900/95 border border-workspace-750 text-workspace-300 hover:text-workspace-100 hover:bg-workspace-800 rounded-xl shadow-xl flex items-center space-x-1.5 z-20 font-mono text-[10px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer pointer-events-auto"
                title="Restore Map"
              >
                <span>🗺️ Show Map</span>
              </button>
            )}
          </ReactFlow>

          {/* FIGMA STYLE OTHER USERS CURSORS */}
          <CollaborativeCursors otherCursors={otherCursors} />


        </div>

        {/* Right-click Context Menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onCopy={handleCopy}
            onCut={handleCut}
            onPaste={handlePaste}
            onDuplicate={handleDuplicate}
            onGroup={handleGroupSelection}
            onDelete={handleDeleteSelected}
            onAddComment={() => {
              setShowComments(true);
              setIsCommentMode(true);
              setPendingComment({
                screenX: contextMenu.x,
                screenY: contextMenu.y,
                canvasX: contextMenu.canvasX,
                canvasY: contextMenu.canvasY,
              });
            }}
            onExport={handleExportOpenMetadata}
            onSetModeSelect={() => setEditorMode('select')}
            onSetModeMultiselect={() => setEditorMode('multiselect')}
            onSetModeEdgeCut={() => setEditorMode('edgecut')}
            canPaste={!!clipboardRef.current}
            canUndo={undoStackRef.current.length > 0}
            canRedo={redoStackRef.current.length > 0}
            hasSelection={hasSelection}
          />
        )}

        {/* Bottom Resize Handle */}
        <div
          onMouseDown={startResizeBottom}
          className="h-1.5 hover:h-2 bg-workspace-750/30 hover:bg-brand-teal/40 cursor-row-resize transition-all shrink-0 z-20"
        />

        {/* 3. BOTTOM PANEL (Relationships & Recent Activity logs) */}
        <div style={{ height: bottomHeight }} className="w-full shrink-0 flex">
          <BottomPanel
            assets={assets}
            relationships={relationships}
            activities={activities}
            onDeleteRelationship={handleDeleteRelationship}
          />
        </div>
      </main>

      {/* Right Resize Handle */}
      <div
        onMouseDown={startResizeRight}
        className="w-1.5 hover:w-2 bg-workspace-750/30 hover:bg-brand-teal/40 cursor-col-resize transition-all shrink-0 z-20"
      />

      {/* 4. RIGHT SIDEBAR (Metadata Inspector Panel) */}
      <div style={{ width: rightWidth }} className="h-full shrink-0 flex">
        <RightSidebar
          selectedAsset={activeAsset}
          selectedColumn={activeColumn}
          onUpdateAsset={handleUpdateAsset}
          onUpdateColumn={handleUpdateColumn}
          onUpdateRelationship={handleUpdateRelationship}
          onDeleteAsset={handleDeleteAsset}
          onDeleteColumn={handleDeleteColumn}
          selectedEdgeId={selectedEdgeId}
          relationships={relationships}
          assets={assets}
          onClearSelection={onPaneClick}
          onDeleteRelationship={handleDeleteRelationship}
          showToast={showToast}
        />
      </div>

      <ImportPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => {
          setIsPreviewOpen(false);
          setPreviewData(undefined);
        }}
        onImportComplete={() => {
          setIsPreviewOpen(false);
          setPreviewData(undefined);
          loadWorkspaceData();
          showToast('Import completed successfully!', 'success');
        }}
        initialData={previewData}
        showToast={showToast}
      />

      {/* Toast Notification Container */}
      <div className="fixed top-5 right-5 z-[9999] flex flex-col space-y-3 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center space-x-3 px-4 py-2.5 rounded-xl border backdrop-blur-xl transition-all duration-300 shadow-xl max-w-sm ${
              t.type === 'success'
                ? 'bg-brand-emerald/10 border-brand-emerald/30 text-brand-emerald shadow-brand-emerald/5'
                : t.type === 'error'
                ? 'bg-brand-coral/10 border-brand-coral/30 text-brand-coral shadow-brand-coral/5'
                : t.type === 'warning'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-amber-500/5'
                : 'bg-workspace-900/90 border-workspace-750 text-workspace-200 shadow-black/40'
            }`}
          >
            {t.type === 'success' && <CheckCircle size={16} className="shrink-0 text-brand-emerald" />}
            {t.type === 'error' && <XCircle size={16} className="shrink-0 text-brand-coral" />}
            {t.type === 'warning' && <AlertTriangle size={16} className="shrink-0 text-amber-400" />}
            {t.type === 'info' && <Loader2 size={16} className="shrink-0 animate-spin text-brand-teal" />}
            <span className="text-xs font-semibold leading-relaxed font-mono">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
