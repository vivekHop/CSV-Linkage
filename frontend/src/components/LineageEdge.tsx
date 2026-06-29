import React from 'react';
import { getBezierPath, useReactFlow } from 'reactflow';
import type { EdgeProps } from 'reactflow';

export const LineageEdge: React.FC<EdgeProps> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  data,
}) => {
  const reactFlow = useReactFlow();
  
  const isHighlighted = selected || !!data?.isHighlighted;
  const strokeColor = (style.stroke as string) || '#606070';
  const strokeWidth = isHighlighted ? 3.5 : (style.strokeWidth as number || 1.8);
  const opacity = isHighlighted ? 1.0 : (style.opacity as number ?? 0.82);

  let edgePath = '';
  let midX = 0;
  let midY = 0;
  let midAngle = 0;

  if (source === target) {
    // Self-connection: route OVER the top or UNDER the bottom of the node
    const node = reactFlow.getNode(source);
    
    // Fallbacks if node is not found/measured yet
    const nodeTop = node ? node.position.y : Math.min(sourceY, targetY) - 100;
    const nodeHeight = node?.height || (node?.data?.columns ? 56 + node.data.columns.length * 40 : 200);
    const nodeBottom = nodeTop + nodeHeight;

    const midYPoint = (sourceY + targetY) / 2;
    // Go up if the connections are closer to the top of the node, otherwise go down
    const goUp = midYPoint - nodeTop < nodeBottom - midYPoint;
    const loopY = goUp ? (nodeTop - 45) : (nodeBottom + 45);
    
    // Draw a wide loop clearing the sides and the top/bottom of the node
    edgePath = `M ${sourceX} ${sourceY} C ${sourceX + 65} ${sourceY}, ${sourceX + 65} ${loopY}, ${sourceX - 20} ${loopY} L ${targetX + 20} ${loopY} C ${targetX - 65} ${loopY}, ${targetX - 65} ${targetY}, ${targetX} ${targetY}`;
    
    midX = (sourceX + targetX) / 2;
    midY = loopY;
    
    // Arrow should point left, since flow is from right (source) to left (target)
    midAngle = 180;
  } else {
    // Normal edge: Calculate custom bezier with a guaranteed horizontal shoulder of at least 40px
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    
    // Horizontal shoulder offset for maximum visibility of connection point
    const shoulder = Math.max(45, Math.abs(dx) * 0.35);
    const cx1 = sourceX + shoulder;
    const cy1 = sourceY;
    const cx2 = targetX - shoulder;
    const cy2 = targetY;

    edgePath = `M ${sourceX} ${sourceY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${targetX} ${targetY}`;
    
    // Midpoint for label / chevron
    midX = (sourceX + targetX) / 2;
    midY = (sourceY + targetY) / 2;
    midAngle = Math.atan2(dy, dx) * (180 / Math.PI);
  }

  return (
    <>
      {/* Glow halo when selected or highlighted */}
      {isHighlighted && (
        <path
          d={edgePath}
          fill="none"
          style={{ stroke: strokeColor, strokeWidth: Number(strokeWidth) + 6 }}
          className="opacity-20 blur-sm pointer-events-none"
        />
      )}

      {/* Main visible edge */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        markerEnd={markerEnd}
        style={{ 
          opacity, 
          stroke: strokeColor, 
          strokeWidth, 
          strokeDasharray: style.strokeDasharray 
        }}
        className="react-flow__edge-path transition-all duration-200"
      />

      {/* Wide invisible hit area for easy clicking */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        className="cursor-pointer react-flow__edge-interaction"
      />

      {/* Mid-point directional chevron arrow */}
      <g
        transform={`translate(${midX}, ${midY}) rotate(${midAngle})`}
        style={{ opacity }}
        className="pointer-events-none transition-all duration-200"
      >
        <path
          d="M -6 -4 L 4 0 L -6 4 L -3 0 Z"
          style={{ 
            fill: strokeColor, 
            stroke: strokeColor, 
            strokeWidth: 0.5 
          }}
        />
      </g>
    </>
  );
};
