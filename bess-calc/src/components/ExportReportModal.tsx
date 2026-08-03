import React from 'react';
import { SimulationResult, CurrencySymbol } from '../types/bess';
import { SohForecast } from '../battery';
import { buildEngineeringReport } from '../report';
import { X, Printer, Copy, Check, FileCheck, FileJson } from 'lucide-react';

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: SimulationResult;
  currency: CurrencySymbol;
  /** Interval cadence the simulation ran at; needed for the report's load-profile energy figures. */
  intervalMinutes: number;
  /** Multi-year state-of-health projection, when one was computed. */
  sohForecast?: SohForecast;
}

export const ExportReportModal: React.FC<ExportReportModalProps> = ({
  isOpen,
  onClose,
  result,
  currency,
  intervalMinutes,
  sohForecast
}) => {
  const [copied, setCopied] = React.useState(false);
  const [copiedJson, setCopiedJson] = React.useState(false);

  // buildEngineeringReport is the single source of truth for report content. This
  // component previously hand-rolled its own clipboard string and hardcoded
  // "Engine Version: 2.4.0-Engineering", which disagreed with the server's
  // CALCULATION_ENGINE_VERSION for the very same calculation.
  const report = React.useMemo(
    () => (isOpen ? buildEngineeringReport(result, { intervalMinutes, sohForecast }) : null),
    [isOpen, result, intervalMinutes, sohForecast]
  );

  if (!isOpen || !report) return null;

  const { savings, technical, financial, confidenceGrade } = result;
  const { batteryUtilisation } = report.technicalDesign;
  const { opex } = report.financialAnalysis;

  const formatMoney = (val: number) => {
    if (currency === '₹') {
      if (Math.abs(val) >= 10000000) return `${currency}${(val / 10000000).toFixed(2)} Cr`;
      if (Math.abs(val) >= 100000) return `${currency}${(val / 100000).toFixed(2)} Lakhs`;
      return `${currency}${Math.round(val).toLocaleString('en-IN')}`;
    }
    return `${currency}${Math.round(val).toLocaleString('en-US')}`;
  };

  const summary = report.executiveSummary;
  const design = report.technicalDesign.batteryConfiguration;
  const profile = report.technicalDesign.loadProfile;

  const handleCopyText = () => {
    const sohLines = report.sohForecast
      ? [
          '',
          'BATTERY STATE OF HEALTH FORECAST:',
          `- Convention: ${report.sohForecast.convention}`,
          `- End-of-life threshold: ${report.sohForecast.endOfLifeSohPct}% SOH`,
          `- End-of-life year: ${report.sohForecast.endOfLifeYear ?? 'not reached within the project horizon'}`,
          ...report.sohForecast.years.map(
            y => `  Year ${y.year}: ${y.sohPct.toFixed(1)}% SOH, ${y.usableEnergyKwh.toFixed(1)} kWh usable`
          )
        ]
      : ['', 'BATTERY STATE OF HEALTH FORECAST: not computed for this run.'];

    const reportText = [
      '=====================================================',
      'BESS ROI & SIZING PLATFORM - ENGINEERING REPORT',
      '=====================================================',
      `Generated: ${report.generatedAt}`,
      `Report model: ${report.reportModelVersion}  |  Calculation engine: ${report.calculationEngineVersion}`,
      `Confidence audit: Grade ${summary.confidenceGrade} - ${summary.confidenceGradeReason}`,
      '',
      'SYSTEM SPECIFICATIONS (as configured by the user; no sizing optimiser exists):',
      `- Configured power: ${summary.configuredPowerKw} kW`,
      `- Configured energy: ${summary.configuredEnergyKwh} kWh (nameplate)`,
      `- Usable DoD: ${design.usableDodPct}% (${design.deliverableCapacityKwh.toFixed(1)} kWh deliverable)`,
      `- Chemistry: ${design.chemistry}  |  Project life: ${design.projectLifeYears} years`,
      '',
      'LOAD PROFILE:',
      `- Intervals: ${profile.intervalCount} at ${profile.intervalMinutes} min (${profile.horizonHours} h horizon)`,
      `- Annual gross load: ${Math.round(profile.annualGrossLoadKwh).toLocaleString()} kWh`,
      `- Average load: ${profile.averageLoadKw.toFixed(1)} kW  |  Load factor: ${profile.loadFactorPct.toFixed(1)}%`,
      `- Peak before/after BESS: ${profile.peakBeforeKw.toFixed(1)} / ${profile.peakAfterKw.toFixed(1)} kW (${profile.peakReductionPct.toFixed(1)}% reduction)`,
      `- Annualisation: ${profile.annualisationBasis}`,
      '',
      'BATTERY UTILISATION:',
      `- Active in ${batteryUtilisation.activeIntervalPct.toFixed(1)}% of intervals (${batteryUtilisation.idleIntervalCount} idle of ${batteryUtilisation.intervalCount})`,
      `- SOC observed: ${batteryUtilisation.minSocObservedPct.toFixed(1)}% to ${batteryUtilisation.maxSocObservedPct.toFixed(1)}% (swing ${batteryUtilisation.socSwingPct.toFixed(1)}%)`,
      `- Peak discharge: ${batteryUtilisation.peakDischargeKw.toFixed(1)} kW (${batteryUtilisation.peakDischargeUtilisationPct.toFixed(0)}% of rated power)`,
      `- Throughput-equivalent full cycles/yr: ${batteryUtilisation.throughputEquivalentFullCycles.toFixed(1)}`,
      `- DoD-weighted equivalent full cycles/yr: ${batteryUtilisation.dodWeightedEquivalentFullCyclesPerYear.toFixed(1)}`,
      `  (${batteryUtilisation.cycleCountNote})`,
      '',
      'FINANCIAL METRICS:',
      `- Turnkey CapEx: ${formatMoney(financial.initialInvestment)}`,
      `- First-year gross savings: ${formatMoney(financial.firstYearGrossSaving)}`,
      `- First-year net operating savings: ${formatMoney(financial.firstYearNetSaving)}`,
      `- Simple payback: ${financial.simplePaybackYears ?? 'never within project life'} years`,
      `- Discounted payback: ${financial.discountedPaybackYears ?? 'never within project life'} years`,
      `- NPV: ${formatMoney(financial.npv)}`,
      `- IRR: ${financial.irrPct === null ? 'not solvable' : `${financial.irrPct}%`}`,
      `- Lifetime ROI: ${financial.roiPct.toFixed(0)}% (total net cash flow vs CapEx, not annualised)`,
      `- LCOS: ${currency}${financial.lcoePerKwh.toFixed(2)}/kWh (discounted lifetime cost / discounted lifetime discharge)`,
      '',
      'ANNUAL SAVINGS WATERFALL:',
      `- Demand charge reduction: ${formatMoney(savings.demandChargeSaving)}`,
      `- Diesel fuel displaced: ${formatMoney(savings.dieselFuelSaving)}`,
      `- DG maintenance saved: ${formatMoney(savings.dgMaintenanceSaving)}`,
      `- Solar PV self-consumption: ${formatMoney(savings.solarSelfConsumptionSaving)}`,
      `- TOU energy arbitrage: ${formatMoney(savings.energyArbitrageSaving)}`,
      '',
      'ANNUAL OPERATING COST BREAKDOWN:',
      `- Fixed O&M: ${formatMoney(opex.fixedAnnualOm)}`,
      `- Degradation provision: ${formatMoney(opex.degradationCost)} (at ${currency}${opex.degradationCostRatePerKwhThroughput}/kWh throughput)`,
      `- Grid charging energy: ${formatMoney(opex.chargingEnergyCost)}`,
      `- Auxiliary (HVAC/BMS): ${formatMoney(opex.auxiliaryEnergyCost)}`,
      `- Total annual OPEX: ${formatMoney(opex.totalAnnualOpex)}`,
      ...sohLines,
      '',
      `WARNINGS: ${report.warningCount}`,
      ...report.warnings.map(w => `- [${w.level}] ${w.message}`),
      '====================================================='
    ].join('\n');

    navigator.clipboard.writeText(reportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <FileCheck className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">Investment-Grade Audit Report</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Report Content */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4 text-xs font-mono text-slate-300">
          
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <div className="text-white font-bold text-sm">BESS ROI & Sizing Executive Report</div>
              <div className="text-[10px] text-slate-400">Generated on {new Date().toLocaleDateString()}</div>
            </div>
            <div className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
              Grade {confidenceGrade} Verified
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">BESS Sizing (as configured)</span>
              <span className="text-white font-bold">{summary.configuredPowerKw} kW / {summary.configuredEnergyKwh} kWh</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Turnkey CapEx</span>
              <span className="text-white font-bold">{formatMoney(financial.initialInvestment)}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">1st Year Net Saving</span>
              <span className="text-emerald-400 font-bold">{formatMoney(financial.firstYearNetSaving)}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Simple Payback</span>
              <span className="text-cyan-400 font-bold">{financial.simplePaybackYears} Years</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">10-Year NPV</span>
              <span className="text-indigo-400 font-bold">{formatMoney(financial.npv)}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Project IRR</span>
              <span className="text-yellow-400 font-bold">{financial.irrPct}%</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Lifetime ROI</span>
              <span className="text-emerald-400 font-bold">{financial.roiPct.toFixed(0)}%</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">LCOS</span>
              <span className="text-cyan-400 font-bold">{currency}{financial.lcoePerKwh.toFixed(2)}/kWh</span>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-3 space-y-1">
            <span className="text-slate-400 block text-[10px] uppercase pb-1">Annual Value Stream Breakdown</span>
            <div className="flex justify-between"><span>Demand Charge Saving:</span> <span className="text-white">{formatMoney(savings.demandChargeSaving)}</span></div>
            <div className="flex justify-between"><span>Diesel Displacement:</span> <span className="text-white">{formatMoney(savings.dieselFuelSaving)}</span></div>
            <div className="flex justify-between"><span>Solar Absorption:</span> <span className="text-white">{formatMoney(savings.solarSelfConsumptionSaving)}</span></div>
            <div className="flex justify-between"><span>TOU Energy Arbitrage:</span> <span className="text-white">{formatMoney(savings.energyArbitrageSaving)}</span></div>
          </div>

          <div className="border-t border-slate-800 pt-3 space-y-1">
            <span className="text-slate-400 block text-[10px] uppercase pb-1">Annual Operating Cost Breakdown</span>
            <div className="flex justify-between text-rose-400"><span>Fixed O&amp;M:</span> <span>-{formatMoney(opex.fixedAnnualOm)}</span></div>
            <div className="flex justify-between text-rose-400"><span>Degradation Provision:</span> <span>-{formatMoney(opex.degradationCost)}</span></div>
            <div className="flex justify-between text-rose-400"><span>Grid Charging Energy:</span> <span>-{formatMoney(opex.chargingEnergyCost)}</span></div>
            <div className="flex justify-between text-rose-400"><span>Auxiliary (HVAC/BMS):</span> <span>-{formatMoney(opex.auxiliaryEnergyCost)}</span></div>
            <div className="flex justify-between border-t border-slate-800 pt-1 mt-1"><span className="text-slate-300">Total Annual OPEX:</span> <span className="text-white font-bold">{formatMoney(opex.totalAnnualOpex)}</span></div>
          </div>

          <div className="border-t border-slate-800 pt-3 space-y-1">
            <span className="text-slate-400 block text-[10px] uppercase pb-1">Battery Utilisation</span>
            <div className="flex justify-between"><span>Active Intervals:</span> <span className="text-white">{batteryUtilisation.activeIntervalPct.toFixed(1)}% of {batteryUtilisation.intervalCount}</span></div>
            <div className="flex justify-between"><span>SOC Swing:</span> <span className="text-white">{batteryUtilisation.minSocObservedPct.toFixed(0)}% &ndash; {batteryUtilisation.maxSocObservedPct.toFixed(0)}%</span></div>
            <div className="flex justify-between"><span>Peak Discharge:</span> <span className="text-white">{batteryUtilisation.peakDischargeKw.toFixed(0)} kW ({batteryUtilisation.peakDischargeUtilisationPct.toFixed(0)}% of rating)</span></div>
            <div className="flex justify-between"><span>Cycles/yr (DoD-weighted):</span> <span className="text-white">{batteryUtilisation.dodWeightedEquivalentFullCyclesPerYear.toFixed(0)}</span></div>
            <div className="flex justify-between"><span>Cycles/yr (throughput ratio):</span> <span className="text-slate-400">{batteryUtilisation.throughputEquivalentFullCycles.toFixed(0)}</span></div>
          </div>

          {report.sohForecast && (
            <div className="border-t border-slate-800 pt-3 space-y-1">
              <span className="text-slate-400 block text-[10px] uppercase pb-1">State of Health Forecast</span>
              <div className="flex justify-between">
                <span>End of Life ({report.sohForecast.endOfLifeSohPct}% SOH):</span>
                <span className="text-white">
                  {report.sohForecast.endOfLifeYear === null
                    ? 'not reached in project life'
                    : `year ${report.sohForecast.endOfLifeYear}`}
                </span>
              </div>
              {report.sohForecast.years.slice(-1).map(year => (
                <div key={year.year} className="flex justify-between">
                  <span>SOH at year {year.year}:</span>
                  <span className="text-white">{year.sohPct.toFixed(1)}% ({year.usableEnergyKwh.toFixed(0)} kWh usable)</span>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            onClick={handleCopyJson}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center space-x-1.5 border border-slate-700"
          >
            {copiedJson ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <FileJson className="w-3.5 h-3.5 text-slate-300" />}
            <span>{copiedJson ? 'Copied JSON!' : 'Copy Report JSON'}</span>
          </button>

          <button
            onClick={handleCopyText}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center space-x-1.5 border border-slate-700"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-300" />}
            <span>{copied ? 'Copied to Clipboard!' : 'Copy Summary'}</span>
          </button>

          <button
            onClick={() => window.print()}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center space-x-1.5 shadow-lg shadow-emerald-500/20"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Report</span>
          </button>
        </div>

      </div>
    </div>
  );
};
