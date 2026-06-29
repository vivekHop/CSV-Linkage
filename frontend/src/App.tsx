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
import { api, WS_URL } from './api';
import type { Asset, Column, Relationship, ActivityLog } from './types';
import { CSVNode } from './components/CSVNode';
import { LeftSidebar } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { BottomPanel } from './components/BottomPanel';
import { LineageEdge } from './components/LineageEdge';
import { CustomConnectionLine } from './components/CustomConnectionLine';
import { CustomMiniMap } from './components/CustomMiniMap';
import { GroupNode } from './components/GroupNode';
import { CommentNode, NewCommentNode, CommentsPanel } from './components/Comments';
import type { CanvasComment } from './components/Comments';
import { ContextMenu } from './components/ContextMenu';
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

export default function App() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [backendStatus, setBackendStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [wsConnected, setWsConnected] = useState(false);

  // Selection states
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

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

      setAssets(fetchedAssets);
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
    loadWorkspaceData();
  }, []);

  // Initialize WebSockets for real-time collaboration with auto-reconnection
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let isUnmounted = false;

    const connect = () => {
      if (isUnmounted) return;

      console.log('Connecting to CSV Linkage WebSocket...');
      ws = new WebSocket(WS_URL);
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

          // Refresh data on CRUD events
          if (
            [
              'asset_created',
              'asset_updated',
              'asset_deleted',
              'column_updated',
              'relationship_created',
              'relationship_deleted',
              'relationship_updated',
            ].includes(event_type)
          ) {
            loadWorkspaceData(true);
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
  }, []);

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
        const newAssetId = Math.random().toString(36).substring(2, 9);
        idMap[asset.id] = newAssetId;

        const currentPos = asset.custom_attributes?.position || { x: 50, y: 50 };
        const pastedPos = { x: currentPos.x + 60, y: currentPos.y + 60 };

        const pastedCols = (asset.columns || []).map((col) => {
          const newColId = Math.random().toString(36).substring(2, 9);
          idMap[col.id] = newColId;
          return {
            ...col,
            id: newColId,
            asset_id: newAssetId,
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
      alert("Please select at least 1 table to form a group.");
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
  const handleAddCommentAt = (canvasX: number, canvasY: number, text: string) => {
    const newComment: CanvasComment = {
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: canvasX,
      y: canvasY,
      text,
      author: USER_NAME,
      createdAt: new Date().toISOString(),
      color: USER_COLOR,
    };
    setComments((prev) => [...prev, newComment]);
    setPendingComment(null);
  };

  const handleDeleteComment = (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  const handleFocusComment = (comment: CanvasComment) => {
    if (reactFlowInstance.current) {
      reactFlowInstance.current.setCenter(comment.x, comment.y, { zoom: 1.2, duration: 600 });
    }
  };

  const handleUpdateCommentPosition = (id: string, x: number, y: number) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, x, y } : c)));
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
    // 1. Identify trace highlights if an edge/relationship is selected
    const highlightedNodeIds: string[] = [];
    const highlightedColumnIds: string[] = [];
    const highlightedEdgeIds: string[] = [];

    if (selectedEdgeId) {
      const selectedRel = allRels.find((r) => r.id === selectedEdgeId);
      if (selectedRel) {
        highlightedEdgeIds.push(selectedRel.id);

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
          highlightedColumnIds.push(destId);
          findUpstreamSources(destId);
        } else {
          highlightedNodeIds.push(destId);
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

        // Highlight parent assets of all active columns in the lineage trace
        highlightedColumnIds.forEach((colId) => {
          const parentAsset = allAssets.find((a) =>
            a.columns?.some((c) => c.id === colId)
          );
          if (parentAsset && !highlightedNodeIds.includes(parentAsset.id)) {
            highlightedNodeIds.push(parentAsset.id);
          }
        });
      }
    } else if (selectedColumnId) {
      // Highlight all edges directly connected to this column (either as source or destination)
      allRels.forEach((rel) => {
        const isSource = rel.source_node_type === 'column' && rel.source_node_id === selectedColumnId;
        const isDest = rel.destination_node_type === 'column' && rel.destination_node_id === selectedColumnId;
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
      if (!highlightedColumnIds.includes(selectedColumnId)) {
        highlightedColumnIds.push(selectedColumnId);
      }
      // Highlight parent assets of columns
      highlightedColumnIds.forEach((colId) => {
        const parentAsset = allAssets.find((a) =>
          a.columns?.some((c) => c.id === colId)
        );
        if (parentAsset && !highlightedNodeIds.includes(parentAsset.id)) {
          highlightedNodeIds.push(parentAsset.id);
        }
      });
    } else if (selectedAssetId) {
      // Find all columns belonging to this asset
      const assetCols = allAssets.find((a) => a.id === selectedAssetId)?.columns?.map((c) => c.id) || [];
      allRels.forEach((rel) => {
        const isSourceAsset = rel.source_node_id === selectedAssetId || (rel.source_node_type === 'column' && assetCols.includes(rel.source_node_id));
        const isDestAsset = rel.destination_node_id === selectedAssetId || (rel.destination_node_type === 'column' && assetCols.includes(rel.destination_node_id));
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
      if (!highlightedNodeIds.includes(selectedAssetId)) {
        highlightedNodeIds.push(selectedAssetId);
      }
      // Highlight parent assets of columns
      highlightedColumnIds.forEach((colId) => {
        const parentAsset = allAssets.find((a) =>
          a.columns?.some((c) => c.id === colId)
        );
        if (parentAsset && !highlightedNodeIds.includes(parentAsset.id)) {
          highlightedNodeIds.push(parentAsset.id);
        }
      });
    }

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
            onUpdateName: (newName: string) => handleUpdateAsset(asset.id, { name: newName }),
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

    // Add active comments as nodes
    comments.forEach((comment) => {
      flowNodes.push({
        id: comment.id,
        type: 'commentNode',
        position: { x: comment.x, y: comment.y },
        dragHandle: '.comment-pin',
        data: {
          comment,
          onDelete: handleDeleteComment,
        },
      });
    });

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
    connectingState,
    comments,
    pendingComment,
  ]);

  // Asset/Column Selection triggers
  const handleSelectAssetHeader = (assetId: string) => {
    setSelectedAssetId(assetId);
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

    try {
      await api.updateAsset(node.id, { custom_attributes: updatedCustom });
      // Update local state positions without full workspace reload to avoid jarring UI resets
      setAssets((prev) =>
        prev.map((a) => (a.id === node.id ? { ...a, custom_attributes: updatedCustom } : a))
      );
    } catch (err) {
      console.error('Failed to save node position:', err);
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

    if (confirm(message)) {
      saveUndoState();
      try {
        await api.deleteAsset(assetId);
        if (selectedAssetId === assetId) {
          setSelectedAssetId(null);
          setSelectedColumnId(null);
        }
        loadWorkspaceData();
      } catch (err) {
        console.error('Failed to delete asset:', err);
      }
    }
  };

  // Metadata Updates (keeps position intact while editing descriptions/notes/properties)
  const handleUpdateAsset = async (assetId: string, updates: Partial<Asset>) => {
    try {
      const existingAsset = assets.find((a) => a.id === assetId);
      if (existingAsset) {
        updates.custom_attributes = {
          ...existingAsset.custom_attributes,
          ...updates.custom_attributes,
        };
      }
      await api.updateAsset(assetId, updates);
      loadWorkspaceData();
    } catch (err) {
      alert('Failed to save table modifications.');
    }
  };

  const handleUpdateColumn = async (columnId: string, updates: Partial<Column>) => {
    try {
      await api.updateColumn(columnId, updates);
      loadWorkspaceData();
    } catch (err) {
      alert('Failed to save column annotations.');
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
    try {
      await api.createRelationship({
        source_node_type: sourceNodeType,
        source_node_id: sourceNodeId,
        destination_node_type: targetNodeType,
        destination_node_id: targetNodeId,
        relationship_type: 'MAPS_TO',
        metadata_json: {},
      });
      loadWorkspaceData();
    } catch (err: any) {
      alert(err.message || 'Failed to create lineage connection.');
    }
  }, [loadWorkspaceData, assets, relationships]);

  const onConnectStart = useCallback((_e: any, { nodeId, handleId, handleType }: { nodeId: string; handleId: string | null; handleType: 'source' | 'target' }) => {
    setConnectingState({ nodeId, handleId, handleType });
  }, []);

  const onConnectEnd = useCallback(() => {
    // Short delay to avoid flickering
    setTimeout(() => {
      setConnectingState(null);
    }, 250);
  }, []);

  const onEdgeClick = useCallback(async (e: React.MouseEvent, edge: Edge) => {
    if (editorMode === 'edgecut') {
      saveUndoState();
      try {
        await api.deleteRelationship(edge.id);
        if (selectedEdgeId === edge.id) {
          setSelectedEdgeId(null);
        }
        loadWorkspaceData();
      } catch (err) {
        console.error('Failed to cut edge:', err);
      }
    } else {
      setSelectedEdgeId(edge.id);
      setSelectedAssetId(null);
      setSelectedColumnId(null);
    }
  }, [editorMode, selectedEdgeId, assets, relationships]);


  const handleDeleteRelationship = async (relId: string) => {
    saveUndoState();
    try {
      await api.deleteRelationship(relId);
      if (selectedEdgeId === relId) {
        setSelectedEdgeId(null);
      }
      loadWorkspaceData();
    } catch (err) {
      console.error('Failed to delete relationship:', err);
    }
  };

  const handleUpdateRelationship = async (relId: string, updates: Partial<Relationship>) => {
    saveUndoState();
    try {
      await api.updateRelationship(relId, updates);
      loadWorkspaceData();
    } catch (err) {
      console.error('Failed to update relationship:', err);
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
            comments={comments}
            isCommentMode={isCommentMode}
            onToggleCommentMode={() => setIsCommentMode((v) => !v)}
            onDeleteComment={handleDeleteComment}
            onFocusComment={handleFocusComment}
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
        <header className="h-14 border-b border-workspace-750 bg-workspace-850 px-6 flex items-center justify-between z-10 select-none shrink-0">
          <div className="flex items-center space-x-2.5">
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
            <div className="flex items-center space-x-1 bg-workspace-800 border border-workspace-750 px-2.5 py-1 rounded-lg">
              <Users size={12} className="text-brand-teal" />
              <span className="text-[10px] font-mono text-workspace-400 font-bold">
                {Object.keys(otherCursors).length + 1} Active
              </span>
            </div>
          </div>
        </header>

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
                  setIsCommentMode((v) => !v);
                }}
                title={isCommentMode ? 'Exit comment placement' : 'Click canvas to add comment'}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer relative ${
                  isCommentMode ? 'bg-brand-teal/20 text-brand-teal' : 'text-workspace-400 hover:text-workspace-100 hover:bg-workspace-800'
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
            onInit={(instance) => {
              reactFlowInstance.current = instance;
            }}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            zoomOnScroll={false}
            panOnDrag={editorMode !== 'multiselect'}
            selectionOnDrag={editorMode === 'multiselect'}
            selectionKeyCode={editorMode === 'multiselect' ? null : 'Shift'}
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
          {Object.entries(otherCursors).map(([id, cursor]) => {
            const { x: vx, y: vy, zoom: vZoom } = getViewport();
            // Project back from absolute canvas coordinate space to local screen space
            const screenX = (cursor as any).x * vZoom + vx;
            const screenY = (cursor as any).y * vZoom + vy;

            // Hide cursor if it's out of bounds of the current viewport container
            if (screenX < 0 || screenY < 0 || screenX > window.innerWidth || screenY > window.innerHeight) {
              return null;
            }

            return (
              <div
                key={id}
                className="absolute pointer-events-none z-30 transition-all duration-75"
                style={{
                  left: screenX,
                  top: screenY,
                }}
              >
                {/* Cursor SVG icon */}
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M5.5 3.21V19.12C5.5 19.68 6.13 19.98 6.57 19.62L11.53 15.54C11.77 15.34 12.09 15.24 12.41 15.26L18.42 15.65C18.99 15.69 19.39 15.08 19.14 14.56L12.35 4.54C12.05 4.1 11.45 4.09 11.14 4.52L5.86 3.25C5.7 3.21 5.5 3.21 5.5 3.21Z"
                    fill={cursor.color}
                    stroke="white"
                    strokeWidth="1.5"
                  />
                </svg>
                {/* Username tag */}
                <div
                  className="px-2 py-0.5 rounded-md text-[9px] font-bold text-workspace-950 font-mono shadow-md mt-1 ml-3"
                  style={{ backgroundColor: cursor.color }}
                >
                  {cursor.name}
                </div>
              </div>
            );
          })}


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
          selectedEdgeId={selectedEdgeId}
          relationships={relationships}
          assets={assets}
          onClearSelection={onPaneClick}
          onDeleteRelationship={handleDeleteRelationship}
        />
      </div>
    </div>
  );
}
