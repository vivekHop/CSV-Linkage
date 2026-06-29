import React from 'react';
import { useReactFlow } from 'reactflow';

interface CollaborativeCursorsProps {
  otherCursors: Record<
    string,
    { x: number; y: number; name: string; color: string; lastUpdate: number }
  >;
}

export const CollaborativeCursors: React.FC<CollaborativeCursorsProps> = ({ otherCursors }) => {
  const { getViewport } = useReactFlow();

  return (
    <>
      {Object.entries(otherCursors).map(([id, cursor]) => {
        const { x: vx, y: vy, zoom: vZoom } = getViewport();
        // Project back from absolute canvas coordinate space to local screen space
        const screenX = cursor.x * vZoom + vx;
        const screenY = cursor.y * vZoom + vy;

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
    </>
  );
};
