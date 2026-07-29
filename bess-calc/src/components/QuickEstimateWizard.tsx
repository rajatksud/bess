import React from 'react';
import { 
  BessSystemInput, 
  TariffInput, 
  DieselInput, 
  SolarInput, 
  FinancialInput, 
  CurrencySymbol 
} from '../types/bess';
import { Battery, Zap, Fuel, Sun, DollarSign, SlidersHorizontal, Info } from 'lucide-react';

interface QuickEstimateWizardProps {
  currency: CurrencySymbol;
  system: BessSystemInput;
  setSystem: React.Dispatch<React.SetStateAction<BessSystemInput>>;
  tariff: TariffInput;
  setTariff: React.Dispatch<React.SetStateAction<TariffInput>>;
  diesel: DieselInput;
  setDiesel: React.Dispatch<React.SetStateAction<DieselInput>>;
  solar: SolarInput;
  setSolar: React.Dispatch<React.SetStateAction<SolarInput>>;
  financial: FinancialInput;
  setFinancial: React.Dispatch<React.SetStateAction<FinancialInput>>;
  onResetToReference: () => void;
}

export const QuickEstimateWizard: React.FC<QuickEstimateWizardProps> = ({
  currency,
  system,
  setSystem,
  tariff,
  setTariff,
  diesel,
  setDiesel,
  solar,
  setSolar,
  financial,
  setFinancial,
  onResetToReference
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-6">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
            <span>Sizing & Financial Input Configuration</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Adjust system capacity, grid tariffs, outages, solar surplus, and financial parameters.
          </p>
        </div>
        <button
          onClick={onResetToReference}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 font-medium border border-slate-700 transition-all flex items-center gap-1.5"
        >
          <Info className="w-3.5 h-3.5" />
          <span>Reset Reference 125kW / 261kWh Case</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

        {/* 1. BESS Physical System */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
          <div className="flex items-center space-x-2 text-emerald-400 font-semibold text-xs uppercase tracking-wider pb-2 border-b border-slate-800/60">
            <Battery className="w-4 h-4" />
            <span>1. Battery & PCS Specifications</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Rated Power (kW)</label>
              <input
                type="number"
                value={system.ratedPowerKw}
                onChange={e => setSystem({ ...system, ratedPowerKw: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Nameplate Energy (kWh)</label>
              <input
                type="number"
                value={system.ratedEnergyKwh}
                onChange={e => setSystem({ ...system, ratedEnergyKwh: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Usable DoD (%)</label>
              <input
                type="number"
                value={system.usableDodPct}
                onChange={e => setSystem({ ...system, usableDodPct: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Reserve SOC (%)</label>
              <input
                type="number"
                value={system.reserveSocPct}
                onChange={e => setSystem({ ...system, reserveSocPct: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Inverter Efficiency (%)</label>
              <input
                type="number"
                value={system.dischargeEfficiencyPct}
                onChange={e => setSystem({ ...system, dischargeEfficiencyPct: Number(e.target.value), chargeEfficiencyPct: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Annual Degradation (%)</label>
              <input
                type="number"
                step="0.1"
                value={system.annualDegradationPct}
                onChange={e => setSystem({ ...system, annualDegradationPct: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="pt-2 text-[11px] text-slate-400 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
            Effective Deliverable Capacity: <span className="text-emerald-400 font-bold font-mono">{Math.round(system.ratedEnergyKwh * (system.usableDodPct / 100) * (system.dischargeEfficiencyPct / 100))} kWh</span> per cycle
          </div>
        </div>

        {/* 2. Utility Tariff & Peak Demand */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
          <div className="flex items-center space-x-2 text-cyan-400 font-semibold text-xs uppercase tracking-wider pb-2 border-b border-slate-800/60">
            <Zap className="w-4 h-4" />
            <span>2. Utility Tariff & Demand Charges</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Energy Charge ({currency}/kWh)</label>
              <input
                type="number"
                step="0.1"
                value={tariff.energyChargePerKwh}
                onChange={e => setTariff({ ...tariff, energyChargePerKwh: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Demand Charge ({currency}/kVA/mo)</label>
              <input
                type="number"
                value={tariff.demandChargePerKvaMonth}
                onChange={e => setTariff({ ...tariff, demandChargePerKvaMonth: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Contract Demand (kVA)</label>
              <input
                type="number"
                value={tariff.contractDemandKva}
                onChange={e => setTariff({ ...tariff, contractDemandKva: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Site Power Factor (0-1)</label>
              <input
                type="number"
                step="0.01"
                value={tariff.powerFactor}
                onChange={e => setTariff({ ...tariff, powerFactor: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-slate-400 mb-1">Demand Window & Ratchet Rule</label>
              <div className="flex items-center space-x-2 text-slate-300 text-[11px]">
                <span className="bg-slate-900 px-2 py-1 rounded border border-slate-700">{tariff.billingDemandWindowMinutes} Min Window</span>
                <span className="bg-slate-900 px-2 py-1 rounded border border-slate-700">Min Billing: {tariff.minimumBillingDemandPct}% Contract kVA</span>
              </div>
            </div>
          </div>
          <div className="pt-2 text-[11px] text-slate-400 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
            {system.ratedPowerKw} kW BESS reduces peak by <span className="text-cyan-400 font-bold font-mono">{Math.round(system.ratedPowerKw / tariff.powerFactor)} kVA</span> at {tariff.powerFactor} PF
          </div>
        </div>

        {/* 3. Diesel Generator & Outages */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
          <div className="flex items-center space-x-2 text-amber-400 font-semibold text-xs uppercase tracking-wider pb-2 border-b border-slate-800/60">
            <Fuel className="w-4 h-4" />
            <span>3. Diesel Displacement Parameters</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Diesel Price ({currency}/Litre)</label>
              <input
                type="number"
                value={diesel.dieselPricePerLitre}
                onChange={e => setDiesel({ ...diesel, dieselPricePerLitre: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Specific Fuel (L/kWh)</label>
              <input
                type="number"
                step="0.01"
                value={diesel.specificFuelConsumptionLitrePerKwh}
                onChange={e => setDiesel({ ...diesel, specificFuelConsumptionLitrePerKwh: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Outage Hours/Month</label>
              <input
                type="number"
                value={diesel.outageHoursPerMonth}
                onChange={e => setDiesel({ ...diesel, outageHoursPerMonth: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">DG Capacity (kVA)</label>
              <input
                type="number"
                value={diesel.dgCapacityKva}
                onChange={e => setDiesel({ ...diesel, dgCapacityKva: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="pt-2 text-[11px] text-slate-400 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
            Displacing 1 kWh DG saves <span className="text-amber-400 font-bold font-mono">{currency}{Math.round(diesel.dieselPricePerLitre * diesel.specificFuelConsumptionLitrePerKwh * 100) / 100}</span> in diesel fuel
          </div>
        </div>

        {/* 4. Solar PV Integration */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
          <div className="flex items-center space-x-2 text-yellow-400 font-semibold text-xs uppercase tracking-wider pb-2 border-b border-slate-800/60">
            <Sun className="w-4 h-4" />
            <span>4. Solar PV Absorption</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Daily Surplus Solar (kWh)</label>
              <input
                type="number"
                value={solar.dailySurplusSolarKwh}
                onChange={e => setSolar({ ...solar, dailySurplusSolarKwh: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Export Credit ({currency}/kWh)</label>
              <input
                type="number"
                step="0.5"
                value={solar.exportCreditPerKwh}
                onChange={e => setSolar({ ...solar, exportCreditPerKwh: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div className="col-span-2 flex items-center justify-between pt-1">
              <span className="text-slate-400">Zero-Export Constraint</span>
              <button
                onClick={() => setSolar({ ...solar, exportAllowed: !solar.exportAllowed })}
                className={`px-3 py-1 rounded text-xs font-semibold ${
                  !solar.exportAllowed ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {!solar.exportAllowed ? 'Zero Export Active' : 'Export Permitted'}
              </button>
            </div>
          </div>
          <div className="pt-2 text-[11px] text-slate-400 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
            Absorbing surplus solar saves <span className="text-yellow-400 font-bold font-mono">{currency}{tariff.energyChargePerKwh - solar.exportCreditPerKwh} / kWh</span> vs import grid power
          </div>
        </div>

        {/* 5. Financial CapEx & O&M */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3 col-span-1 md:col-span-2 lg:col-span-2">
          <div className="flex items-center space-x-2 text-indigo-400 font-semibold text-xs uppercase tracking-wider pb-2 border-b border-slate-800/60">
            <DollarSign className="w-4 h-4" />
            <span>5. Financial Investment & Project Parameters</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Turnkey CapEx ({currency})</label>
              <input
                type="number"
                value={financial.initialCapex}
                onChange={e => setFinancial({ ...financial, initialCapex: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Fixed Annual O&M ({currency})</label>
              <input
                type="number"
                value={financial.fixedAnnualOm}
                onChange={e => setFinancial({ ...financial, fixedAnnualOm: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Discount Rate (%)</label>
              <input
                type="number"
                value={financial.discountRatePct}
                onChange={e => setFinancial({ ...financial, discountRatePct: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Tariff Escalation (%/yr)</label>
              <input
                type="number"
                value={financial.tariffEscalationPct}
                onChange={e => setFinancial({ ...financial, tariffEscalationPct: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
