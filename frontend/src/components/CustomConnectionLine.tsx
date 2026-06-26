import React from 'react';
import type { ConnectionLineComponentProps } from 'reactflow';

export const CustomConnectionLine: React.FC<ConnectionLineComponentProps> = ({
  fromX,
  fromY,
  toX,
  toY,
  fromHandle,
}) => {
  // Determine if source handle is source or target
  const isSource = fromHandle?.id ? fromHandle.id.includes('source') : true;
  
  const fromTag = isSource ? 'Source' : 'Destination';
  const toTag = isSource ? 'Destination' : 'Source';
  
  const fromColorClass = isSource 
    ? 'bg-brand-coral text-workspace-950 font-bold shadow-brand-coral/20' 
    : 'bg-brand-violet text-workspace-50 font-bold shadow-brand-violet/20';
  const toColorClass = isSource 
    ? 'bg-brand-violet text-workspace-50 font-bold shadow-brand-violet/20'
    : 'bg-brand-coral text-workspace-950 font-bold shadow-brand-coral/20';

  // Calculate clean curve
  const dx = toX - fromX;
  const dy = toY - fromY;
  const path = `M${fromX},${fromY} C${fromX + dx / 2},${fromY} ${fromX + dx / 2},${toY} ${toX},${toY}`;

  return (
    <g className="pointer-events-none">
      {/* Glow path */}
      <path
        d={path}
        fill="none"
        stroke={isSource ? '#ff5e62' : '#8a2be2'}
        strokeWidth={4}
        className="opacity-25 blur-sm"
      />
      {/* Main line */}
      <path
        d={path}
        fill="none"
        stroke={isSource ? '#ff5e62' : '#8a2be2'}
        strokeWidth={2}
        strokeDasharray="5,5"
      />
      {/* Start handle circle */}
      <circle
        cx={fromX}
        cy={fromY}
        fill={isSource ? '#ff5e62' : '#8a2be2'}
        r={6}
      />
      {/* End handle circle moving with mouse */}
      <circle
        cx={toX}
        cy={toY}
        fill={isSource ? '#8a2be2' : '#ff5e62'}
        r={6}
      />
      
      {/* foreignObject to render HTML badges */}
      <foreignObject
        x={fromX - 40}
        y={fromY - 30}
        width={100}
        height={25}
        className="overflow-visible pointer-events-none"
      >
        <div className={`px-2 py-0.5 rounded text-[9px] uppercase tracking-wider font-mono shadow-md inline-block whitespace-nowrap text-center ${fromColorClass}`}>
          {fromTag}
        </div>
      </foreignObject>

      <foreignObject
        x={toX - 40}
        y={toY - 30}
        width={100}
        height={25}
        className="overflow-visible pointer-events-none"
      >
        <div className={`px-2 py-0.5 rounded text-[9px] uppercase tracking-wider font-mono shadow-md inline-block whitespace-nowrap text-center animate-pulse ${toColorClass}`}>
          {toTag}
        </div>
      </foreignObject>
    </g>
  );
};
