import React from 'react';
import { DispatchPriorityType, TariffInput } from '../types/bess';
import { PRESET_PROFILES, ProfilePreset } from '../engine/presetProfiles';
import { Layers, ArrowUpDown, Clock, CheckCircle2, Factory, Building2, Sun } from 'lucide-react';

interface IntervalSimulationProps {
  selectedPresetId: string;
  onSelectPreset: (preset: ProfilePreset) => void;
  priorities: DispatchPriorityType[];
  onReorderPriorities: (newPriorities: DispatchPriorityType[]) => void;
  intervalResolution: number;
  onIntervalResolutionChange: (mins: number) => void;
  tariff: TariffInput;
}

const PRIORITY_LABELS: Record<DispatchPriorityType, { title: string; desc: string }> = {
  backup_reserve: {
    title: '1. Backup Reserve Protection',
    desc: 'Discharges battery during grid outages to supply critical site load and avoid DG power.'
  },
  peak_shaving: {
    title: '2. Demand-Charge Peak Shaving',
    desc: 'Discharges battery when site load exceeds contract target to lower monthly billing kVA.'
  },
  solar_self_consumption: {
    title: '3. Surplus Solar Absorption',
    desc: 'Charges battery using excess rooftop solar PV energy that would otherwise be curtailed.'
  },
  diesel_displacement: {
    title: '4. Diesel Generator Fuel Savings',
    desc: 'Displaces operating diesel generators during microgrid or off-grid operation.'
  },
  tou_arbitrage: {
    title: '5. Time-Of-Use Tariff Arbitrage',
    desc: 'Charges during off-peak discount rate windows and discharges during peak surge periods.'
  }
};

export const IntervalSimulationConfig: React.FC<IntervalSimulationProps> = ({
  selectedPresetId,
  onSelectPreset,
  priorities,
  onReorderPriorities,
  intervalResolution,
  onIntervalResolutionChange,
  tariff
}) => {
  const handleMovePriority = (index: number, direction: 'up' | 'down') => {
    const newArr = [...priorities];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newArr.length) return;
    const temp = newArr[index];
    newArr[index] = newArr[targetIdx];
    newArr[targetIdx] = temp;
    onReorderPriorities(newArr);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-6">
      
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <span>Interval Profile & Dispatch Priority Manager</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Select a representative 8760/interval site load profile and configure the single-energy-balance priority sequence.
          </p>
        </div>

        {/* Resolution selector */}
        <div className="flex items-center space-x-2 text-xs font-medium">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400">Resolution:</span>
          {[15, 30, 60].map(mins => (
            <button
              key={mins}
              onClick={() => onIntervalResolutionChange(mins)}
              className={`px-2.5 py-1 rounded-lg border text-xs transition-all ${
                intervalResolution === mins
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 font-bold'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
              }`}
            >
              {mins} min ({ (24 * 60) / mins } pts/day)
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Preset Load Profiles Selection */}
        <div className="lg:col-span-2 space-y-3">
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Select Site Load Profile Archetype
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PRESET_PROFILES.map(p => {
              const isSelected = p.id === selectedPresetId;
              return (
                <div
                  key={p.id}
                  onClick={() => onSelectPreset(p)}
                  className={`cursor-pointer p-4 rounded-xl border transition-all flex flex-col justify-between space-y-2 ${
                    isSelected
                      ? 'bg-emerald-950/30 border-emerald-500 shadow-lg shadow-emerald-500/10'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        {p.id.includes('industrial') && <Factory className="w-3.5 h-3.5 text-emerald-400" />}
                        {p.id.includes('commercial') && <Building2 className="w-3.5 h-3.5 text-cyan-400" />}
                        {p.id.includes('solar') && <Sun className="w-3.5 h-3.5 text-yellow-400" />}
                        {p.industry}
                      </span>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    </div>
                    <p className="text-[11px] text-slate-300 font-medium">{p.name}</p>
                    <p className="text-[10px] text-slate-400 mt-1 line-clamp-3 leading-relaxed">{p.description}</p>
                  </div>
                  <div className="text-[10px] text-emerald-400 font-mono font-semibold pt-1 border-t border-slate-800/80">
                    {isSelected ? 'Active Dataset' : 'Click to Load'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dispatch Priority Re-orderer */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between pb-1 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-emerald-400" />
              <span>Dispatch Priority Rule Order</span>
            </span>
            <span className="text-[10px] text-slate-400">Higher = First claim</span>
          </div>

          <div className="space-y-2">
            {priorities.map((itemKey, idx) => {
              const info = PRIORITY_LABELS[itemKey];
              return (
                <div
                  key={itemKey}
                  className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="text-xs font-bold text-white">{info.title}</div>
                    <div className="text-[10px] text-slate-400 line-clamp-1">{info.desc}</div>
                  </div>

                  <div className="flex flex-col space-y-1">
                    <button
                      disabled={idx === 0}
                      onClick={() => handleMovePriority(idx, 'up')}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      disabled={idx === priorities.length - 1}
                      onClick={() => handleMovePriority(idx, 'down')}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 italic">
            Single-Energy Balance Constraint: The BESS will dispatch capacity according to this priority order. No double-counting allowed.
          </p>
        </div>

      </div>
    </div>
  );
};
