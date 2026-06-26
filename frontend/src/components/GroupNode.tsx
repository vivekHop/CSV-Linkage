import React, { useState } from 'react';
import { Trash2, Edit2, Check } from 'lucide-react';

interface GroupNodeProps {
  id: string;
  data: {
    id: string;
    name: string;
    onUpdateName: (newName: string) => void;
    onDelete: () => void;
  };
}

export const GroupNode: React.FC<GroupNodeProps> = ({ id, data }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState(data.name);

  const handleSaveName = () => {
    if (nameInput.trim()) {
      data.onUpdateName(nameInput.trim());
      setIsEditing(false);
    }
  };

  return (
    <div className="w-full h-full min-w-[200px] min-h-[150px] bg-workspace-800/10 border-2 border-dashed border-brand-teal/30 hover:border-brand-teal/50 rounded-2xl p-4 flex flex-col justify-between select-none relative group transition-all duration-300">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-workspace-900/60 backdrop-blur-md border border-workspace-750 px-3 py-1.5 rounded-lg shrink-0 pointer-events-auto">
        {isEditing ? (
          <div className="flex items-center space-x-1">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="bg-workspace-800 border border-workspace-700 text-workspace-50 px-2 py-0.5 text-xs rounded outline-none focus:border-brand-teal w-28 font-semibold"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
            />
            <button
              onClick={handleSaveName}
              className="p-1 text-brand-teal hover:bg-workspace-750 rounded transition-colors"
            >
              <Check size={12} />
            </button>
          </div>
        ) : (
          <div className="flex items-center space-x-1.5">
            <span className="text-xs font-bold text-workspace-100 uppercase tracking-wider font-mono">
              {data.name}
            </span>
            <button
              onClick={() => setIsEditing(true)}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-workspace-400 hover:text-brand-teal rounded transition-all"
            >
              <Edit2 size={10} />
            </button>
          </div>
        )}

        <button
          onClick={data.onDelete}
          className="p-1 text-workspace-400 hover:text-brand-coral rounded transition-colors cursor-pointer"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Decorative center watermarked name */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03]">
        <span className="text-4xl font-extrabold uppercase font-mono tracking-widest text-workspace-50">
          {data.name}
        </span>
      </div>
    </div>
  );
};
