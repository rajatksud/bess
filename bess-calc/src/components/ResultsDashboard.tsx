import React, { useState } from 'react';
import { SimulationResult, CurrencySymbol } from '../types/bess';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, 
  ComposedChart, Line, CartesianGrid, AreaChart, Area, ReferenceLine 
} from 'recharts';
import { 
  TrendingUp, ShieldCheck, DollarSign, Zap, Fuel, Sun, 
  AlertTriangle, Info, Clock, RefreshCw, BarChart2, Activity 
} from 'lucide-react';

interface ResultsDashboardProps {
  result: SimulationResult;
  currency: CurrencySymbol;
}

export const ResultsDashboard: React.FC<ResultsDashboardProps> = ({ result, currency }) => {
  const { savings, technical, financial, warnings, intervals, confidenceGrade, confidenceGradeReason } = result;

  const [activeChartTab, setActiveChartTab] = useState<'dispatch' | 'waterfall' | 'cashflow'>('dispatch');

  // Format large currency numbers cleanly (e.g., ₹40.0L or $48.0k)
  const formatMoney = (amount: number) => {
    if (currency === '₹') {
      if (Math.abs(amount) >= 10000000) return `${currency}${(amount / 10000000).toFixed(2)} Cr`;
      if (Math.abs(amount) >= 100000) return `${currency}${(amount / 100000).toFixed(2)} Lakhs`;
      return `${currency}${Math.round(amount).toLocaleString('en-IN')}`;
    }
    if (Math.abs(amount) >= 1000000) return `${currency}${(amount / 1000000).toFixed(2)}M`;
    if (Math.abs(amount) >= 1000) return `${currency}${(amount / 1000).toFixed(1)}k`;
    return `${currency}${Math.round(amount).toLocaleString('en-US')}`;
  };

  // Waterfall Chart Data
  const waterfallData = [
    { name: 'Demand Charge', value: savings.demandChargeSaving, type: 'benefit' },
    { name: 'Diesel Saved', value: savings.dieselFuelSaving, type: 'benefit' },
    { name: 'DG Maint.', value: savings.dgMaintenanceSaving, type: 'benefit' },
    { name: 'Solar Absorbed', value: savings.solarSelfConsumptionSaving, type: 'benefit' },
    { name: 'TOU Arbitrage', value: savings.energyArbitrageSaving, type: 'benefit' },
    { name: 'Charging Cost', value: -savings.chargingEnergyCost, type: 'cost' },
    { name: 'Aux HVAC Power', value: -savings.auxiliaryEnergyCost, type: 'cost' },
    { name: 'Degradation', value: -savings.degradationCost, type: 'cost' },
    { name: 'Fixed O&M', value: -savings.omCost, type: 'cost' },
  ];

  // Cash Flow Chart Data
  const cashflowData = financial.annualCashFlows.map(f => ({
    year: `Year ${f.year}`,
    grossSaving: f.grossSaving,
    omCost: f.omCost,
    netCashFlow: f.netCashFlow,
    cumulativeDiscounted: f.cumulativeDiscountedCashFlow
  }));

  return (
    <div className="space-y-6">

      {/* 1. Executive Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        
        {/* Turnkey Capex */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium">
            <span>Turnkey CapEx</span>
            <DollarSign className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-lg font-extrabold text-white font-mono">
            {formatMoney(financial.initialInvestment)}
          </div>
          <div className="text-[10px] text-slate-400">Total Turnkey Investment</div>
        </div>

        {/* 1st Year Net Saving */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium">
            <span>Year 1 Net Saving</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-lg font-extrabold text-emerald-400 font-mono">
            {formatMoney(savings.netOperatingSaving)}
          </div>
          <div className="text-[10px] text-slate-400">After Losses & Costs</div>
        </div>

        {/* Simple Payback */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium">
            <span>Simple Payback</span>
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-lg font-extrabold text-cyan-400 font-mono">
            {financial.simplePaybackYears ? `${financial.simplePaybackYears} Yrs` : 'N/A'}
          </div>
          <div className="text-[10px] text-slate-400">Discounted: {financial.discountedPaybackYears ? `${financial.discountedPaybackYears} Yrs` : 'N/A'}</div>
        </div>

        {/* 10-Year NPV */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium">
            <span>10-Year NPV</span>
            <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className={`text-lg font-extrabold font-mono ${financial.npv >= 0 ? 'text-indigo-400' : 'text-rose-400'}`}>
            {formatMoney(financial.npv)}
          </div>
          <div className="text-[10px] text-slate-400">At {result.financialInput.discountRatePct}% Discount Rate</div>
        </div>

        {/* Project IRR */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium">
            <span>Project IRR</span>
            <Activity className="w-3.5 h-3.5 text-yellow-400" />
          </div>
          <div className="text-lg font-extrabold text-yellow-400 font-mono">
            {financial.irrPct !== null ? `${financial.irrPct}%` : 'N/A'}
          </div>
          <div className="text-[10px] text-slate-400">Internal Rate Return</div>
        </div>

        {/* Confidence Grade */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium">
            <span>Audit Grade</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-lg font-extrabold text-white flex items-center space-x-1.5 font-mono">
            <span className={`px-2 py-0.5 rounded text-sm font-bold ${
              confidenceGrade === 'A' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
              confidenceGrade === 'B' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' :
              confidenceGrade === 'C' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' :
              'bg-rose-500/20 text-rose-400 border border-rose-500/40'
            }`}>
              Grade {confidenceGrade}
            </span>
          </div>
          <div className="text-[10px] text-slate-400 line-clamp-1">{confidenceGradeReason}</div>
        </div>

      </div>

      {/* 2. Visual Charts Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        
        {/* Chart Selector Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-3">
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveChartTab('dispatch')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeChartTab === 'dispatch' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              24-Hour BESS Dispatch & Load Profile
            </button>
            <button
              onClick={() => setActiveChartTab('waterfall')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeChartTab === 'waterfall' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Annual Savings Waterfall
            </button>
            <button
              onClick={() => setActiveChartTab('cashflow')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeChartTab === 'cashflow' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              10-Year Cumulative Cash Flow
            </button>
          </div>

          <div className="text-xs text-slate-400 font-mono">
            {activeChartTab === 'dispatch' && `96 Intervals (15-min) | SOC Range: ${technical.minimumSocPct}% - ${technical.maximumSocPct}%`}
            {activeChartTab === 'waterfall' && `Gross: ${formatMoney(savings.grossSaving)} | Net: ${formatMoney(savings.netOperatingSaving)}`}
            {activeChartTab === 'cashflow' && `Payback Marker: ${financial.simplePaybackYears || 'N/A'} Years`}
          </div>
        </div>

        {/* Chart 1: Dispatch Profile */}
        {activeChartTab === 'dispatch' && (
          <div className="space-y-3">
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={intervals} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="timeLabel" stroke="#64748b" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="power" orientation="left" stroke="#94a3b8" tick={{ fontSize: 11 }} label={{ value: 'Power (kW)', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis yAxisId="soc" orientation="right" stroke="#10b981" domain={[0, 100]} tick={{ fontSize: 11 }} label={{ value: 'SOC (%)', angle: 90, position: 'insideRight', fill: '#10b981', fontSize: 11 }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '12px' }}
                    formatter={(val: any, name: any) => [
                      typeof val === 'number' ? Math.round(val) : val,
                      name
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                  
                  {/* Gross site load: total site demand before any PV set-off or BESS action. */}
                  <Line yAxisId="power" type="monotone" dataKey="grossSiteLoadKw" name="Gross Site Load (kW)" stroke="#f43f5e" strokeWidth={2} dot={false} />

                  {/* Metered grid import: gross load net of PV self-consumption AND the
                      battery. This is the billing quantity the peak KPIs below are taken
                      from - NOT postBessLoadKw, which nets the battery but not solar. */}
                  <Line yAxisId="power" type="monotone" dataKey="postBessGridImportKw" name="Net Grid Import, after PV + BESS (kW)" stroke="#06b6d4" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                  
                  {/* Solar Power */}
                  <Area yAxisId="power" type="monotone" dataKey="solarKw" name="Solar PV (kW)" fill="#eab308" stroke="#eab308" fillOpacity={0.2} />
                  
                  {/* BESS Discharge / Charge Power */}
                  <Bar yAxisId="power" dataKey="bessPowerKw" name="BESS Power (kW)" fill="#10b981" opacity={0.8} />

                  {/* Battery SOC */}
                  <Line yAxisId="soc" type="monotone" dataKey="bessSocPct" name="State of Charge (%)" stroke="#10b981" strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-400 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <div><span className="font-bold text-white">Peak Load Before:</span> {Math.round(technical.peakBeforeKw)} kW ({Math.round(technical.peakBeforeKva)} kVA)</div>
              <div><span className="font-bold text-emerald-400">Peak Load After:</span> {Math.round(technical.peakAfterKw)} kW ({Math.round(technical.peakAfterKva)} kVA)</div>
              <div><span className="font-bold text-cyan-400">Peak Reduction:</span> {Math.round(technical.peakBeforeKva - technical.peakAfterKva)} kVA ({Math.round(((technical.peakBeforeKva - technical.peakAfterKva) / technical.peakBeforeKva) * 100)}%)</div>
            </div>
          </div>
        )}

        {/* Chart 2: Waterfall Breakdown */}
        {activeChartTab === 'waterfall' && (
          <div className="space-y-3">
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={waterfallData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '12px' }}
                    formatter={(val: any) => [formatMoney(Number(val)), 'Annual Amount']}
                  />
                  <ReferenceLine y={0} stroke="#64748b" />
                  <Bar dataKey="value" name="Amount" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Chart 3: Cash Flow */}
        {activeChartTab === 'cashflow' && (
          <div className="space-y-3">
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cashflowData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="year" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '12px' }}
                    formatter={(val: any, name: any) => [formatMoney(Number(val)), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                  <ReferenceLine y={0} stroke="#f43f5e" strokeDasharray="3 3" label={{ value: 'Breakeven', fill: '#f43f5e', fontSize: 11 }} />
                  <Bar dataKey="netCashFlow" name="Annual Net Cash Flow" fill="#06b6d4" />
                  <Line type="monotone" dataKey="cumulativeDiscounted" name="Cumulative Discounted Cash Flow" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

      </div>

      {/* 3. Technical Audit & Energy Balance Grid */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-2">
          <Zap className="w-4 h-4 text-emerald-400" />
          <span>Technical Energy Balance & Operational Audit</span>
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block mb-1">Deliverable Capacity</span>
            <span className="text-base font-bold text-white font-mono">{technical.deliverableCapacityKwh} kWh</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Usable DOD & Inverter efficiency</span>
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block mb-1">Annual Discharged Energy</span>
            <span className="text-base font-bold text-emerald-400 font-mono">{Math.round(technical.energyDischargedKwh).toLocaleString()} kWh</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">{technical.equivalentFullCycles.toFixed(1)} Cycles / Year</span>
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block mb-1">Displaced Diesel Fuel</span>
            <span className="text-base font-bold text-amber-400 font-mono">{Math.round(technical.dgEnergyDisplacedKwh * (result.diesel.specificFuelConsumptionLitrePerKwh || 0.28)).toLocaleString()} Litres</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">{Math.round(technical.dgEnergyDisplacedKwh).toLocaleString()} kWh DG Avoided</span>
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block mb-1">Solar PV Absorbed</span>
            <span className="text-base font-bold text-yellow-400 font-mono">{Math.round(technical.solarEnergyStoredKwh).toLocaleString()} kWh</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Rescued from curtailment</span>
          </div>
        </div>
      </div>

      {/* 4. Validation & Sanity Warnings Center */}
      {warnings.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-800">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>Engineering Audit Warnings & Sanity Checks</span>
          </h3>

          <div className="space-y-2.5">
            {warnings.map(w => (
              <div 
                key={w.id}
                className={`p-3 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-2 ${
                  w.level === 'error' ? 'bg-rose-950/20 border-rose-500/40 text-rose-300' :
                  w.level === 'warning' ? 'bg-amber-950/20 border-amber-500/40 text-amber-300' :
                  'bg-blue-950/20 border-blue-500/40 text-blue-300'
                }`}
              >
                <div>
                  <div className="font-bold flex items-center gap-2">
                    <span className="uppercase text-[10px] px-1.5 py-0.5 rounded font-mono bg-slate-900 border border-slate-700">
                      [{w.code}]
                    </span>
                    <span>{w.message}</span>
                  </div>
                  <div className="text-[11px] opacity-80 mt-1">
                    <span className="font-semibold">Recommendation:</span> {w.recommendation}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
