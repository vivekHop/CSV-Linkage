import React, { useState, useEffect, useRef } from 'react';
import { X, MessageSquare } from 'lucide-react';
import { useStore, useReactFlow, useViewport } from 'reactflow';
import type { Node, Edge } from 'reactflow';
import type { Relationship, Asset } from '../types';
import { CSVNode } from './CSVNode';

interface CustomMiniMapProps {
  nodes: Node[];
  edges: Edge[];
  selectedAssetId?: string | null;
  selectedColumnId?: string | null;
  selectedEdgeId?: string | null;
  relationships?: Relationship[];
  assets?: Asset[];
  onClose?: () => void;
}

export const CustomMiniMap: React.FC<CustomMiniMapProps> = ({
  nodes = [],
  edges = [],
  selectedAssetId = null,
  selectedColumnId = null,
  selectedEdgeId = null,
  relationships = [],
  assets = [],
  onClose,
}) => {
  const { setViewport } = useReactFlow();
  const { x, y, zoom } = useViewport();
  
  // Fetch actual canvas viewport dimensions from React Flow store
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);

  // Bounding box of viewport in canvas coordinates
  const vpLeft = (0 - x) / zoom;
  const vpTop = (0 - y) / zoom;
  const vpWidth = width / zoom;
  const vpHeight = height / zoom;
  const vpRight = vpLeft + vpWidth;
  const vpBottom = vpTop + vpHeight;

  const minimapContainerRef = useRef<HTMLDivElement>(null);

  // Dragging state for the viewport plate
  const [isDraggingViewport, setIsDraggingViewport] = useState(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, viewportX: 0, viewportY: 0 });

  // Compute highlighted nodes/columns dynamically based on selected edge
  const highlightedNodeIds: string[] = [];
  const highlightedColumnIds: string[] = [];
  const highlightedEdgeIds: string[] = [];

  if (selectedEdgeId && relationships.length > 0) {
    const selectedRel = relationships.find((r) => r.id === selectedEdgeId);
    if (selectedRel) {
      highlightedEdgeIds.push(selectedRel.id);
      const destId = selectedRel.destination_node_id;
      
      const findUpstreamSources = (targetId: string) => {
        relationships.forEach((rel) => {
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
      } else {
        highlightedNodeIds.push(destId);
      }
      findUpstreamSources(destId);

      if (selectedRel.source_node_type === 'column') {
        if (!highlightedColumnIds.includes(selectedRel.source_node_id)) {
          highlightedColumnIds.push(selectedRel.source_node_id);
        }
      } else {
        if (!highlightedNodeIds.includes(selectedRel.source_node_id)) {
          highlightedNodeIds.push(selectedRel.source_node_id);
        }
      }

      // Highlight parent assets of columns
      highlightedColumnIds.forEach((colId) => {
        const parentAsset = assets.find((a) =>
          a.columns?.some((c) => c.id === colId)
        );
        if (parentAsset && !highlightedNodeIds.includes(parentAsset.id)) {
          highlightedNodeIds.push(parentAsset.id);
        }
      });
    }
  }

  // Calculate bounding box of all nodes and current viewport to auto-scale minimap
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  nodes.forEach((n) => {
    const nx = n.position.x;
    const ny = n.position.y;
    const w = 288; // node width
    const columnsCount = n.data?.columns?.length || 0;
    const h = 56 + columnsCount * 37 + 10;
    
    if (nx < minX) minX = nx;
    if (nx + w > maxX) maxX = nx + w;
    if (ny < minY) minY = ny;
    if (ny + h > maxY) maxY = ny + h;
  });

  // Include current viewport bounds in the bounding box to keep the control plate always visible
  if (vpLeft < minX) minX = vpLeft;
  if (vpRight > maxX) maxX = vpRight;
  if (vpTop < minY) minY = vpTop;
  if (vpBottom > maxY) maxY = vpBottom;

  if (minX === Infinity) {
    minX = 0;
    maxX = 1000;
    minY = 0;
    maxY = 700;
  }

  const padding = 40;
  minX -= padding;
  minY -= padding;
  const contentWidth = (maxX - minX) + padding * 2;
  const contentHeight = (maxY - minY) + padding * 2;

  // MiniMap container sizes: width = 240px, height = 160px
  const containerWidth = 240;
  const containerHeight = 160;

  const scaleX = containerWidth / contentWidth;
  const scaleY = containerHeight / contentHeight;
  const scale = Math.min(scaleX, scaleY, 0.25);

  const offsetX = (containerWidth - contentWidth * scale) / 2 - minX * scale;
  const offsetY = (containerHeight - contentHeight * scale) / 2 - minY * scale;

  // Dragging the Viewport Mask plate
  const handleViewportMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDraggingViewport(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      viewportX: x,
      viewportY: y,
    };
  };

  useEffect(() => {
    if (!isDraggingViewport) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dxMini = e.clientX - dragStartRef.current.mouseX;
      const dyMini = e.clientY - dragStartRef.current.mouseY;

      // canvas_coord = mini_coord / scale
      // Pan shift: nextX = starting_viewport_x - (dxMini / scale) * zoom
      const nextX = dragStartRef.current.viewportX - (dxMini / scale) * zoom;
      const nextY = dragStartRef.current.viewportY - (dyMini / scale) * zoom;

      setViewport({ x: nextX, y: nextY, zoom });
    };

    const handleMouseUp = () => {
      setIsDraggingViewport(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingViewport, scale, zoom, setViewport]);

  // Non-passive Zooming inside the minimap
  useEffect(() => {
    const container = minimapContainerRef.current;
    if (!container) return;

    const handleWheelRaw = (e: WheelEvent) => {
      e.stopPropagation();
      e.preventDefault(); // Non-passive guarantees this successfully blocks browser-level page zooms

      const zoomDelta = -e.deltaY * 0.0035;
      const nextZoom = Math.max(0.15, Math.min(2.5, zoom + zoomDelta));

      const centerX = width / 2;
      const centerY = height / 2;
      const canvasCenterX = (centerX - x) / zoom;
      const canvasCenterY = (centerY - y) / zoom;

      const nextX = centerX - canvasCenterX * nextZoom;
      const nextY = centerY - canvasCenterY * nextZoom;

      setViewport({ x: nextX, y: nextY, zoom: nextZoom });
    };

    container.addEventListener('wheel', handleWheelRaw, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheelRaw);
    };
  }, [width, height, x, y, zoom, setViewport]);

  // Jump to location by clicking on minimap background
  const handleMinimapBackgroundClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const targetCanvasX = (clickX - offsetX) / scale;
    const targetCanvasY = (clickY - offsetY) / scale;

    const nextX = width / 2 - targetCanvasX * zoom;
    const nextY = height / 2 - targetCanvasY * zoom;

    setViewport({ x: nextX, y: nextY, zoom });
  };

  return (
    <div className="absolute bottom-5 right-5 w-[242px] h-[194px] bg-workspace-900/95 border border-workspace-750 rounded-xl shadow-2xl overflow-hidden z-20 flex flex-col select-none">
      {/* Header with Title and Close Button */}
      <div className="px-3 py-2 border-b border-workspace-750 bg-workspace-850 flex items-center justify-between shrink-0">
        <span className="text-[10px] font-bold text-workspace-300 uppercase tracking-wider font-mono">Lineage Map</span>
        <div className="flex items-center space-x-2">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-violet animate-pulse" />
          {onClose && (
            <button
              onClick={onClose}
              className="p-0.5 text-workspace-500 hover:text-workspace-300 rounded hover:bg-workspace-750 transition-colors pointer-events-auto cursor-pointer"
              title="Minimize Map"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      
      {/* Interactive scaled canvas area */}
      <div 
        ref={minimapContainerRef}
        onClick={handleMinimapBackgroundClick}
        className="flex-1 bg-[#090a0d] relative overflow-hidden pointer-events-auto cursor-crosshair"
      >
        <div
          style={{
            position: 'absolute',
            left: offsetX,
            top: offsetY,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
            width: contentWidth,
            height: contentHeight,
            pointerEvents: 'none',
          }}
        >
          {/* High-Fidelity SVG Edges */}
          <svg
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              overflow: 'visible',
            }}
          >
            {edges.map((edge) => {
              const sourceNode = nodes.find((n) => n.id === edge.source);
              const targetNode = nodes.find((n) => n.id === edge.target);
              if (!sourceNode || !targetNode) return null;

              let sourceY = sourceNode.position.y + 28;
              if (edge.sourceHandle && edge.sourceHandle.startsWith('col-')) {
                const colId = edge.sourceHandle.replace('col-source-', '');
                const colIndex = sourceNode.data.columns?.findIndex((c: any) => c.id === colId);
                if (colIndex !== undefined && colIndex !== -1) {
                  sourceY = sourceNode.position.y + 56 + colIndex * 37 + 18.5;
                }
              }

              let targetY = targetNode.position.y + 28;
              if (edge.targetHandle && edge.targetHandle.startsWith('col-')) {
                const colId = edge.targetHandle.replace('col-target-', '');
                const colIndex = targetNode.data.columns?.findIndex((c: any) => c.id === colId);
                if (colIndex !== undefined && colIndex !== -1) {
                  targetY = targetNode.position.y + 56 + colIndex * 37 + 18.5;
                }
              }

              const sourceX = sourceNode.position.x + 288;
              const targetX = targetNode.position.x;

              let path = '';
              if (edge.source === edge.target) {
                const goUp = Math.min(sourceY, targetY) < 220;
                const loopY = goUp ? Math.min(sourceY, targetY) - 45 : Math.max(sourceY, targetY) + 45;
                path = `M ${sourceX} ${sourceY} C ${sourceX + 65} ${sourceY}, ${sourceX + 65} ${loopY}, ${sourceX - 20} ${loopY} L ${targetX + 20} ${loopY} C ${targetX - 65} ${loopY}, ${targetX - 65} ${targetY}, ${targetX} ${targetY}`;
              } else {
                const dx = targetX - sourceX;
                path = `M ${sourceX} ${sourceY} C ${sourceX + dx / 2} ${sourceY} ${sourceX + dx / 2} ${targetY} ${targetX} ${targetY}`;
              }

              const isEdgeHighlighted = highlightedEdgeIds.includes(edge.id);
              const strokeColor = edge.style?.stroke || '#606070';
              const strokeWidth = isEdgeHighlighted || edge.selected ? 12 : 5;
              const opacity = isEdgeHighlighted || edge.selected ? 1.0 : 0.6;

              return (
                <g key={edge.id}>
                  {(isEdgeHighlighted || edge.selected) && (
                    <path
                      d={path}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeWidth + 12}
                      className="opacity-30 blur-sm"
                    />
                  )}
                  <path
                    d={path}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={edge.style?.strokeDasharray}
                    opacity={opacity}
                  />
                </g>
              );
            })}
          </svg>

          {/* High-Fidelity Custom HTML Node Cards */}
          {nodes.map((node) => {
            const isSelected = selectedAssetId === node.id;
            const isHighlighted = highlightedNodeIds.includes(node.id);

            if (node.type === 'commentNode') {
              return (
                <div
                  key={node.id}
                  style={{
                    position: 'absolute',
                    left: node.position.x,
                    top: node.position.y,
                    transform: 'translate(-50%, -100%)',
                    pointerEvents: 'none',
                  }}
                  className="flex items-center justify-center"
                >
                  <div
                    className="w-16 h-16 rounded-full border-[6px] border-white shadow-2xl flex items-center justify-center"
                    style={{ backgroundColor: node.data?.comment?.color || '#ff5e62' }}
                  >
                    <MessageSquare size={32} className="text-white fill-white" />
                  </div>
                </div>
              );
            }

            if (node.type === 'groupNode') {
              const styleWidth = node.style?.width || 450;
              const styleHeight = node.style?.height || 350;
              return (
                <div
                  key={node.id}
                  style={{
                    position: 'absolute',
                    left: node.position.x,
                    top: node.position.y,
                    width: styleWidth,
                    height: styleHeight,
                    border: '6px dashed rgba(138, 43, 226, 0.7)',
                    backgroundColor: 'rgba(138, 43, 226, 0.08)',
                    borderRadius: '24px',
                    pointerEvents: 'none',
                  }}
                />
              );
            }

            if (node.type === 'newCommentNode') {
              return null;
            }

            return (
              <div
                key={node.id}
                style={{
                  position: 'absolute',
                  left: node.position.x,
                  top: node.position.y,
                  width: 288,
                }}
              >
                <CSVNode
                  id={node.id}
                  type="csvNode"
                  data={node.data}
                  isConnectable={false}
                  selected={isSelected || isHighlighted}
                  dragging={false}
                  zIndex={0}
                  xPos={node.position.x}
                  yPos={node.position.y}
                />
              </div>
            );
          })}

          {/* Viewport Mask Plate - Transparent White Controller Plate */}
          <div
            onMouseDown={handleViewportMouseDown}
            style={{
              position: 'absolute',
              left: vpLeft,
              top: vpTop,
              width: vpWidth,
              height: vpHeight,
              border: '2px solid rgba(255, 255, 255, 0.65)',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              borderRadius: '6px',
              cursor: isDraggingViewport ? 'grabbing' : 'grab',
              pointerEvents: 'auto',
              boxShadow: '0 0 12px rgba(255, 255, 255, 0.15)',
              zIndex: 50,
            }}
          />
        </div>
      </div>
    </div>
  );
};
