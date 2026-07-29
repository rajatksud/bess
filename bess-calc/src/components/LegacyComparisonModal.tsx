import React from 'react';
import { SimulationResult, CurrencySymbol } from '../types/bess';
import { runLegacySalesPitchCalculation } from '../engine/legacyEngine';
import { ShieldAlert, CheckCircle2, XCircle, ArrowRight, AlertTriangle, Scale } from 'lucide-react';

interface LegacyComparisonModalProps {
  result: SimulationResult;
  currency: CurrencySymbol;
}

export const LegacyComparisonModal: React.FC<LegacyComparisonModalProps> = ({ result, currency }) => {
  const legacy = runLegacySalesPitchCalculation(
    result.system,
    result.tariff,
    result.diesel,
    result.solar,
    result.financialInput
  );

  const formatMoney = (val: number) => {
    if (currency === '₹') {
      if (Math.abs(val) >= 10000000) return `${currency}${(val / 10000000).toFixed(2)} Cr`;
      if (Math.abs(val) >= 100000) return `${currency}${(val / 100000).toFixed(2)} Lakhs`;
      return `${currency}${Math.round(val).toLocaleString('en-IN')}`;
    }
    if (Math.abs(val) >= 1000) return `${currency}${(val / 1000).toFixed(1)}k`;
    return `${currency}${Math.round(val)}`;
  };

  const defensibleAnnual = result.savings.netOperatingSaving;
  const defensiblePayback = result.financial.simplePaybackYears || 0;

  const diffAmount = legacy.salesPitchAnnualSavings - defensibleAnnual;
  const overestimationPct = Math.round((diffAmount / Math.max(1, defensibleAnnual)) * 100);

  return (
    <div className="space-y-6">

      {/* Hero Comparison Banner */}
      <div className="bg-gradient-to-r from-amber-950/40 via-slate-900 to-emerald-950/40 border border-amber-500/30 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Sales Pitch vs. Engineering Simulation Audit</h2>
            <p className="text-xs text-slate-300">Comparing unconstrained sales pitch estimates against the single-energy-balance dispatch model.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-2">
          
          {/* Sales Pitch Side */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-rose-500/40 space-y-2">
            <div className="flex items-center justify-between text-rose-400 font-bold border-b border-slate-800 pb-1.5">
              <span className="flex items-center gap-1.5"><XCircle className="w-4 h-4 text-rose-500" /> Naive Sales Pitch Estimate</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 font-mono">Grade D</span>
            </div>
            <div className="space-y-1 font-mono text-slate-300">
              <div className="flex justify-between"><span>Annual Saving:</span> <span className="text-white font-bold">{formatMoney(legacy.salesPitchAnnualSavings)}</span></div>
              <div className="flex justify-between"><span>Payback:</span> <span className="text-rose-400 font-bold">{legacy.salesPitchPaybackYears} Years</span></div>
              <div className="flex justify-between"><span>Energy Balance:</span> <span className="text-rose-400">Unconstrained (Double Counted)</span></div>
            </div>
            <p className="text-[10px] text-slate-400 italic pt-1 border-t border-slate-800/60">
              Allocates 100% capacity independently to demand, diesel, and solar streams on the same day.
            </p>
          </div>

          {/* Defensible Model Side */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-emerald-500/50 space-y-2">
            <div className="flex items-center justify-between text-emerald-400 font-bold border-b border-slate-800 pb-1.5">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Defensible Dispatch Model</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">Grade A/B</span>
            </div>
            <div className="space-y-1 font-mono text-slate-300">
              <div className="flex justify-between"><span>Net Annual Saving:</span> <span className="text-emerald-400 font-bold">{formatMoney(defensibleAnnual)}</span></div>
              <div className="flex justify-between"><span>Payback:</span> <span className="text-emerald-400 font-bold">{defensiblePayback} Years</span></div>
              <div className="flex justify-between"><span>Energy Balance:</span> <span className="text-emerald-400">Strict Single Balance</span></div>
            </div>
            <p className="text-[10px] text-slate-400 italic pt-1 border-t border-slate-800/60">
              Physical dispatch with DoD limits, inverter losses, grid charging costs, and degradation.
            </p>
          </div>

        </div>

        <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl text-xs text-amber-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>The naive sales pitch overestimates annual net savings by <strong className="text-amber-200 font-mono">{overestimationPct}%</strong> ({formatMoney(diffAmount)}).</span>
          </div>
        </div>
      </div>

      {/* Breakdown of 10 Critical Flaws */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-800">
          <ShieldAlert className="w-4 h-4 text-rose-400" />
          <span>The 10 Flaws in the Initial Sales Proposal</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {legacy.flaws.map(f => (
            <div key={f.number} className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1">
              <div className="font-bold text-rose-400 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-mono text-[10px]">
                  {f.number}
                </span>
                <span>{f.title}</span>
              </div>
              <p className="text-slate-300 text-[11px] leading-relaxed pl-7">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
