import React, { useMemo, useState } from 'react';
import { SimulationResult, CurrencySymbol } from '../types/bess';
import { buildSensitivityMatrix } from '../report';
import { Sliders, Sparkles, TrendingUp, TrendingDown, RefreshCcw } from 'lucide-react';

interface ScenarioSensitivityProps {
  baseResult: SimulationResult;
  currency: CurrencySymbol;
  onUpdateSensitivities: (multipliers: {
    dieselPriceMult: number;
    demandChargeMult: number;
    capexMult: number;
    degradationMult: number;
  }) => void;
}

export const ScenarioSensitivity: React.FC<ScenarioSensitivityProps> = ({
  baseResult,
  currency,
  onUpdateSensitivities
}) => {
  const [dieselPriceMult, setDieselPriceMult] = useState<number>(1.0);
  const [demandChargeMult, setDemandChargeMult] = useState<number>(1.0);
  const [capexMult, setCapexMult] = useState<number>(1.0);
  const [degradationMult, setDegradationMult] = useState<number>(1.0);

  const handleSliderChange = (type: string, val: number) => {
    let dMult = dieselPriceMult;
    let dcMult = demandChargeMult;
    let cMult = capexMult;
    let degMult = degradationMult;

    if (type === 'diesel') { setDieselPriceMult(val); dMult = val; }
    if (type === 'demand') { setDemandChargeMult(val); dcMult = val; }
    if (type === 'capex') { setCapexMult(val); cMult = val; }
    if (type === 'deg') { setDegradationMult(val); degMult = val; }

    onUpdateSensitivities({
      dieselPriceMult: dMult,
      demandChargeMult: dcMult,
      capexMult: cMult,
      degradationMult: degMult
    });
  };

  const handleReset = () => {
    setDieselPriceMult(1.0);
    setDemandChargeMult(1.0);
    setCapexMult(1.0);
    setDegradationMult(1.0);
    onUpdateSensitivities({
      dieselPriceMult: 1.0,
      demandChargeMult: 1.0,
      capexMult: 1.0,
      degradationMult: 1.0
    });
  };

  const formatMoney = (val: number) => {
    if (currency === '₹') {
      if (Math.abs(val) >= 100000) return `${currency}${(val / 100000).toFixed(2)} L`;
      return `${currency}${Math.round(val).toLocaleString('en-IN')}`;
    }
    if (Math.abs(val) >= 1000) return `${currency}${(val / 1000).toFixed(1)}k`;
    return `${currency}${Math.round(val)}`;
  };

  // Conservative/Base/Optimistic scenarios: each is a real re-run of the financial engine
  // (calculateFinancialMetrics) with perturbed CapEx/tariff-escalation/degradation inputs
  // against the same dispatch output - not a flat multiplier applied to the final saving
  // number. See src/report/sensitivityAnalysis.ts for the full rationale and scenario
  // definitions.
  const sensitivityMatrix = useMemo(() => buildSensitivityMatrix(baseResult), [baseResult]);
  const conservativeScenario = sensitivityMatrix.find(s => s.label === 'conservative')!;
  const optimisticScenario = sensitivityMatrix.find(s => s.label === 'optimistic')!;

  const baseCapex = baseResult.financialInput.initialCapex;
  const conservativeCapex = baseCapex * conservativeScenario.capexMultiplier;
  const optimisticCapex = baseCapex * optimisticScenario.capexMultiplier;

  return (
    <div className="space-y-6">

      {/* Scenario Table Comparison */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Multi-Scenario Financial Matrix</span>
          </h2>
          <span className="text-xs text-slate-400">Conservative, Base Case, and Optimistic Outlooks</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          
          {/* Conservative Scenario */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-rose-500/30 space-y-3">
            <div className="flex items-center justify-between font-bold text-rose-400 border-b border-slate-800 pb-2">
              <span>Conservative Case</span>
              <TrendingDown className="w-4 h-4" />
            </div>
            <div className="space-y-1.5 font-mono">
              <div className="flex justify-between text-slate-400"><span>CapEx (+15%):</span> <span className="text-white">{formatMoney(conservativeCapex)}</span></div>
              <div className="flex justify-between text-slate-400"><span>NPV:</span> <span className="text-white">{formatMoney(conservativeScenario.npv)}</span></div>
              <div className="flex justify-between text-slate-400"><span>Payback:</span> <span className="text-rose-400 font-bold">{conservativeScenario.simplePaybackYears ?? 'N/A'} Years</span></div>
            </div>
            <p className="text-[10px] text-slate-400">Re-runs the financial engine at +15% CapEx, faster degradation, and reduced tariff escalation.</p>
          </div>

          {/* Base Case Scenario */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-emerald-500/50 space-y-3 shadow-lg shadow-emerald-500/5">
            <div className="flex items-center justify-between font-bold text-emerald-400 border-b border-slate-800 pb-2">
              <span>Base Engineering Case</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">Active Model</span>
            </div>
            <div className="space-y-1.5 font-mono">
              <div className="flex justify-between text-slate-400"><span>CapEx:</span> <span className="text-white">{formatMoney(baseCapex)}</span></div>
              <div className="flex justify-between text-slate-400"><span>NPV:</span> <span className="text-emerald-400 font-bold">{formatMoney(baseResult.financial.npv)}</span></div>
              <div className="flex justify-between text-slate-400"><span>Payback:</span> <span className="text-emerald-400 font-bold">{baseResult.financial.simplePaybackYears ?? 'N/A'} Years</span></div>
            </div>
            <p className="text-[10px] text-slate-400">Single-energy-balance dispatch with verified parameters.</p>
          </div>

          {/* Optimistic Scenario */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-cyan-500/30 space-y-3">
            <div className="flex items-center justify-between font-bold text-cyan-400 border-b border-slate-800 pb-2">
              <span>Optimistic Case</span>
              <TrendingUp className="w-4 h-4" />
            </div>
            <div className="space-y-1.5 font-mono">
              <div className="flex justify-between text-slate-400"><span>CapEx (-10%):</span> <span className="text-white">{formatMoney(optimisticCapex)}</span></div>
              <div className="flex justify-between text-slate-400"><span>NPV:</span> <span className="text-white">{formatMoney(optimisticScenario.npv)}</span></div>
              <div className="flex justify-between text-slate-400"><span>Payback:</span> <span className="text-cyan-400 font-bold">{optimisticScenario.simplePaybackYears ?? 'N/A'} Years</span></div>
            </div>
            <p className="text-[10px] text-slate-400">Re-runs the financial engine at -10% CapEx, slower degradation, and increased tariff escalation.</p>
          </div>

        </div>
      </div>

      {/* Interactive Sensitivity Sliders */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <span>Interactive Sensitivity Tornado Sliders</span>
          </h2>
          <button
            onClick={handleReset}
            className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1"
          >
            <RefreshCcw className="w-3 h-3 text-emerald-400" />
            <span>Reset Sliders</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          
          {/* Diesel Price Slider */}
          <div className="space-y-2 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div className="flex justify-between font-semibold">
              <span className="text-slate-300">Diesel Fuel Price Multiplier</span>
              <span className="text-amber-400 font-mono font-bold">{(dieselPriceMult * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.8"
              step="0.05"
              value={dieselPriceMult}
              onChange={e => handleSliderChange('diesel', Number(e.target.value))}
              className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>-50% Price Dip</span>
              <span>Baseline ({currency}{baseResult.diesel.dieselPricePerLitre}/L)</span>
              <span>+80% Fuel Surge</span>
            </div>
          </div>

          {/* Demand Charge Slider */}
          <div className="space-y-2 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div className="flex justify-between font-semibold">
              <span className="text-slate-300">Demand Charge Rate Multiplier</span>
              <span className="text-cyan-400 font-mono font-bold">{(demandChargeMult * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.8"
              step="0.05"
              value={demandChargeMult}
              onChange={e => handleSliderChange('demand', Number(e.target.value))}
              className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>-50% Tariff</span>
              <span>Baseline ({currency}{baseResult.tariff.demandChargePerKvaMonth}/kVA)</span>
              <span>+80% Surcharge</span>
            </div>
          </div>

          {/* CapEx Slider */}
          <div className="space-y-2 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div className="flex justify-between font-semibold">
              <span className="text-slate-300">BESS Turnkey CapEx Multiplier</span>
              <span className="text-indigo-400 font-mono font-bold">{(capexMult * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0.6"
              max="1.5"
              step="0.05"
              value={capexMult}
              onChange={e => handleSliderChange('capex', Number(e.target.value))}
              className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>-40% Battery Cost</span>
              <span>Baseline</span>
              <span>+50% EPC Cost</span>
            </div>
          </div>

          {/* Degradation Rate Slider */}
          <div className="space-y-2 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <div className="flex justify-between font-semibold">
              <span className="text-slate-300">Annual Degradation Rate Multiplier</span>
              <span className="text-rose-400 font-mono font-bold">{(degradationMult * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={degradationMult}
              onChange={e => handleSliderChange('deg', Number(e.target.value))}
              className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>0.5x Degradation</span>
              <span>Baseline ({baseResult.system.annualDegradationPct}%/yr)</span>
              <span>2.0x Accelerated</span>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
};
