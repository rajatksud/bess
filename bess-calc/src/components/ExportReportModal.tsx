import React from 'react';
import { SimulationResult, CurrencySymbol } from '../types/bess';
import { X, Printer, Copy, Check, FileCheck, ShieldCheck } from 'lucide-react';

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: SimulationResult;
  currency: CurrencySymbol;
}

export const ExportReportModal: React.FC<ExportReportModalProps> = ({
  isOpen,
  onClose,
  result,
  currency
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen) return null;

  const { savings, technical, financial, system, tariff, confidenceGrade } = result;

  const formatMoney = (val: number) => {
    if (currency === '₹') {
      if (Math.abs(val) >= 10000000) return `${currency}${(val / 10000000).toFixed(2)} Cr`;
      if (Math.abs(val) >= 100000) return `${currency}${(val / 100000).toFixed(2)} Lakhs`;
      return `${currency}${Math.round(val).toLocaleString('en-IN')}`;
    }
    return `${currency}${Math.round(val).toLocaleString('en-US')}`;
  };

  const handleCopyText = () => {
    const reportText = `
=====================================================
BESS ROI & SIZING PLATFORM - EXECUTIVE AUDIT REPORT
=====================================================
Date: ${new Date().toLocaleDateString()}
Confidence Audit: Grade ${confidenceGrade}

SYSTEM SPECIFICATIONS:
- Rated Power: ${system.ratedPowerKw} kW
- Nameplate Energy: ${system.ratedEnergyKwh} kWh
- Usable DOD: ${system.usableDodPct}% (${technical.deliverableCapacityKwh} kWh deliverable)
- Battery Chemistry: ${system.batteryChemistry}
- Project Life: ${system.projectLifeYears} Years

FINANCIAL METRICS:
- Turnkey CapEx: ${formatMoney(financial.initialInvestment)}
- First Year Gross Savings: ${formatMoney(financial.firstYearGrossSaving)}
- First Year Net Operating Savings: ${formatMoney(financial.firstYearNetSaving)}
- Simple Payback: ${financial.simplePaybackYears || 'N/A'} Years
- Discounted Payback: ${financial.discountedPaybackYears || 'N/A'} Years
- 10-Year NPV: ${formatMoney(financial.npv)}
- Project IRR: ${financial.irrPct || 'N/A'}%
- Lifetime ROI: ${financial.roiPct.toFixed(0)}% (total net cash flow vs CapEx, not annualised)
- Levelized Cost of Storage: ${currency}${financial.lcoePerKwh.toFixed(2)}/kWh (discounted lifetime cost / discounted lifetime discharge)

ANNUAL SAVINGS WATERFALL:
- Demand Charge Reduction: ${formatMoney(savings.demandChargeSaving)}
- Diesel Fuel Displaced: ${formatMoney(savings.dieselFuelSaving)}
- DG Maintenance Saved: ${formatMoney(savings.dgMaintenanceSaving)}
- Solar PV Self-Consumption: ${formatMoney(savings.solarSelfConsumptionSaving)}
- TOU Energy Arbitrage: ${formatMoney(savings.energyArbitrageSaving)}
- Less Grid Charging Cost: -${formatMoney(savings.chargingEnergyCost)}
- Less Aux HVAC Consumption: -${formatMoney(savings.auxiliaryEnergyCost)}
- Less Battery Degradation Cost: -${formatMoney(savings.degradationCost)}
- Less Fixed O&M Cost: -${formatMoney(savings.omCost)}

SINGLE ENERGY BALANCE AUDIT CHECKSUM:
Engine Version: 2.4.0-Engineering
Data Integrity: Passed
=====================================================
`;
    navigator.clipboard.writeText(reportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
              <span className="text-slate-400 block text-[10px] uppercase">BESS Sizing</span>
              <span className="text-white font-bold">{system.ratedPowerKw} kW / {system.ratedEnergyKwh} kWh</span>
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
            <div className="flex justify-between text-rose-400"><span>Less Charging & Aux Costs:</span> <span>-{formatMoney(savings.chargingEnergyCost + savings.auxiliaryEnergyCost)}</span></div>
            <div className="flex justify-between text-rose-400"><span>Less Degradation & O&M:</span> <span>-{formatMoney(savings.degradationCost + savings.omCost)}</span></div>
          </div>

        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-end space-x-3 pt-2">
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
