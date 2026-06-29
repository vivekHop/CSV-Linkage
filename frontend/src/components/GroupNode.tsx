import React, { useState } from 'react';
import { Trash2, Edit2, Check } from 'lucide-react';

interface GroupNodeProps {
  id: string;
  selected?: boolean;
  data: {
    id: string;
    name: string;
    color?: 'teal' | 'violet' | 'coral' | 'emerald' | 'yellow';
    onUpdateName: (newName: string) => void;
    onUpdateColor?: (newColor: string) => void;
    onDelete: () => void;
  };
}

const COLOR_PRESETS = {
  teal: {
    bg: 'bg-brand-teal/15 border-brand-teal/40 hover:border-brand-teal/60',
    bgSelected: 'bg-brand-teal/25 border-brand-teal shadow-glow-teal ring-1 ring-brand-teal/30',
    dot: 'bg-brand-teal hover:scale-125',
    activeDot: 'ring-2 ring-brand-teal/50 scale-110',
  },
  violet: {
    bg: 'bg-brand-violet/15 border-brand-violet/40 hover:border-brand-violet/60',
    bgSelected: 'bg-brand-violet/25 border-brand-violet shadow-glow-violet ring-1 ring-brand-violet/30',
    dot: 'bg-brand-violet hover:scale-125',
    activeDot: 'ring-2 ring-brand-violet/50 scale-110',
  },
  coral: {
    bg: 'bg-brand-coral/15 border-brand-coral/40 hover:border-brand-coral/60',
    bgSelected: 'bg-brand-coral/25 border-brand-coral shadow-glow-coral ring-1 ring-brand-coral/30',
    dot: 'bg-brand-coral hover:scale-125',
    activeDot: 'ring-2 ring-brand-coral/50 scale-110',
  },
  emerald: {
    bg: 'bg-brand-emerald/15 border-brand-emerald/40 hover:border-brand-emerald/60',
    bgSelected: 'bg-brand-emerald/25 border-brand-emerald shadow-glow-emerald ring-1 ring-brand-emerald/30',
    dot: 'bg-brand-emerald hover:scale-125',
    activeDot: 'ring-2 ring-brand-emerald/50 scale-110',
  },
  yellow: {
    bg: 'bg-yellow-500/10 border-yellow-500/30 hover:border-yellow-500/50',
    bgSelected: 'bg-yellow-500/20 border-yellow-500 shadow-glow-yellow ring-1 ring-yellow-500/30',
    dot: 'bg-yellow-500 hover:scale-125',
    activeDot: 'ring-2 ring-yellow-500/50 scale-110',
  },
};

export const GroupNode: React.FC<GroupNodeProps> = ({ id, selected, data }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState(data.name);

  const activePresetKey = data.color || 'teal';
  const preset = COLOR_PRESETS[activePresetKey] || COLOR_PRESETS.teal;

  const handleSaveName = () => {
    if (nameInput.trim()) {
      data.onUpdateName(nameInput.trim());
      setIsEditing(false);
    }
  };

  return (
    <div
      className={`w-full h-full min-w-[200px] min-h-[150px] border-2 border-dashed rounded-2xl p-4 flex flex-col justify-between select-none relative group transition-all duration-300 ${
        selected ? preset.bgSelected : preset.bg
      }`}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between bg-workspace-900/90 backdrop-blur-md border border-workspace-750 px-3 py-1.5 rounded-xl shrink-0 pointer-events-auto shadow-lg space-x-4">
        {isEditing ? (
          <div className="flex items-center space-x-1">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="bg-workspace-800 border border-workspace-700 text-workspace-50 px-2 py-0.5 text-xs rounded outline-none focus:border-brand-teal w-28 font-semibold"
              autoFocus
              onBlur={handleSaveName}
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
          <div className="flex items-center space-x-1.5 min-w-0">
            <span 
              className="text-xs font-bold text-workspace-100 uppercase tracking-wider font-mono truncate max-w-[120px]"
              title={data.name}
              onDoubleClick={() => setIsEditing(true)}
            >
              {data.name}
            </span>
            <button
              onClick={() => setIsEditing(true)}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-workspace-400 hover:text-brand-teal rounded transition-all"
              title="Edit Name"
            >
              <Edit2 size={10} />
            </button>
          </div>
        )}

        {/* Preset Colors & Dissolve Group Actions */}
        <div className="flex items-center space-x-2.5">
          {/* Preset Color Circles */}
          {data.onUpdateColor && (
            <div className="flex items-center space-x-1 border-r border-workspace-750 pr-2.5">
              {(Object.keys(COLOR_PRESETS) as Array<keyof typeof COLOR_PRESETS>).map((presetKey) => {
                const isCurrent = presetKey === activePresetKey;
                return (
                  <button
                    key={presetKey}
                    onClick={() => data.onUpdateColor?.(presetKey)}
                    className={`w-2.5 h-2.5 rounded-full transition-all border border-workspace-950 ${COLOR_PRESETS[presetKey].dot} ${
                      isCurrent ? COLOR_PRESETS[presetKey].activeDot : 'opacity-60 hover:opacity-100'
                    }`}
                    title={`Style Group (${presetKey})`}
                  />
                );
              })}
            </div>
          )}

          <button
            onClick={data.onDelete}
            className="p-1 text-workspace-400 hover:text-brand-coral rounded transition-colors cursor-pointer"
            title="Dissolve Group"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Background Watermark Removed */}
    </div>
  );
};
