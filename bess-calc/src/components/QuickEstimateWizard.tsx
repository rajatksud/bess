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

const FieldLabel: React.FC<{ label: string; tooltip: string }> = ({ label, tooltip }) => (
  <label className="flex items-center gap-1 text-slate-400 mb-1">
    <span>{label}</span>
    <span className="group relative inline-flex">
      <Info className="w-3 h-3 text-slate-600 cursor-help" />
      <span className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-1.5 w-56 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal normal-case text-slate-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
        {tooltip}
      </span>
    </span>
  </label>
);

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
              <FieldLabel label="Rated Power (kW)" tooltip="Maximum continuous charge/discharge power of the battery inverter (PCS). Sets the ceiling on peak shaving and how fast the battery can respond to load." />
              <input
                type="number"
                value={system.ratedPowerKw}
                onChange={e => setSystem({ ...system, ratedPowerKw: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Nameplate Energy (kWh)" tooltip="Total rated energy storage capacity of the battery before any DoD, reserve, or efficiency losses are applied." />
              <input
                type="number"
                value={system.ratedEnergyKwh}
                onChange={e => setSystem({ ...system, ratedEnergyKwh: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Usable DoD (%)" tooltip="Depth of Discharge: the percentage of nameplate energy that can actually be cycled without harming battery life. Reduces effective deliverable capacity below nameplate." />
              <input
                type="number"
                value={system.usableDodPct}
                onChange={e => setSystem({ ...system, usableDodPct: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Reserve SOC (%)" tooltip="Extra state-of-charge held back on top of the minimum SOC floor, e.g. for guaranteed backup runtime. Further reduces usable capacity available for daily dispatch." />
              <input
                type="number"
                value={system.reserveSocPct}
                onChange={e => setSystem({ ...system, reserveSocPct: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Inverter Efficiency (%)" tooltip="Round-trip conversion efficiency applied on both charge and discharge. Lower efficiency means more energy is lost as heat and must be replaced by extra grid charging." />
              <input
                type="number"
                value={system.dischargeEfficiencyPct}
                onChange={e => setSystem({ ...system, dischargeEfficiencyPct: Number(e.target.value), chargeEfficiencyPct: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Annual Degradation (%)" tooltip="Yearly loss of usable battery capacity due to calendar and cycle aging. Compounds each year in the multi-year financial projection, reducing savings over time." />
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
              <FieldLabel label={`Energy Charge (${currency}/kWh)`} tooltip="Per-unit price charged by the utility for imported energy. Drives the value of arbitrage, solar self-consumption, and diesel-displacement savings." />
              <input
                type="number"
                step="0.1"
                value={tariff.energyChargePerKwh}
                onChange={e => setTariff({ ...tariff, energyChargePerKwh: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label={`Demand Charge (${currency}/kVA/mo)`} tooltip="Monthly charge per kVA of billed peak demand. This is what peak shaving directly reduces — multiplied by 12 for the annual demand-charge saving." />
              <input
                type="number"
                value={tariff.demandChargePerKvaMonth}
                onChange={e => setTariff({ ...tariff, demandChargePerKvaMonth: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Contract Demand (kVA)" tooltip="The contracted kVA ceiling with the utility. Billed demand is capped at this value and floored by the minimum billing demand percentage below." />
              <input
                type="number"
                value={tariff.contractDemandKva}
                onChange={e => setTariff({ ...tariff, contractDemandKva: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Site Power Factor (0-1)" tooltip="Ratio of real power (kW) to apparent power (kVA) at the site. Since demand charges bill on kVA, a lower power factor means more kVA is needed to deliver the same kW of shaving." />
              <input
                type="number"
                step="0.01"
                value={tariff.powerFactor}
                onChange={e => setTariff({ ...tariff, powerFactor: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <FieldLabel label="Demand Window & Ratchet Rule" tooltip="The utility's billing interval for measuring peak demand, and the minimum percentage of contract demand you're billed for regardless of actual usage. Configured in the Interval Simulation tab." />
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
              <FieldLabel label={`Diesel Price (${currency}/Litre)`} tooltip="Fuel cost per litre. Combined with specific fuel consumption, this sets the ₹/kWh cost of running the diesel generator that the battery displaces." />
              <input
                type="number"
                value={diesel.dieselPricePerLitre}
                onChange={e => setDiesel({ ...diesel, dieselPricePerLitre: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Specific Fuel (L/kWh)" tooltip="Litres of diesel burned per kWh generated by the DG set. Typical mid-load gensets run around 0.25-0.35 L/kWh." />
              <input
                type="number"
                step="0.01"
                value={diesel.specificFuelConsumptionLitrePerKwh}
                onChange={e => setDiesel({ ...diesel, specificFuelConsumptionLitrePerKwh: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Outage Hours/Month" tooltip="Average grid downtime per month during which load would otherwise run on diesel. Used as a reference figure; the interval simulation tab models the actual outage schedule per preset." />
              <input
                type="number"
                value={diesel.outageHoursPerMonth}
                onChange={e => setDiesel({ ...diesel, outageHoursPerMonth: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="DG Capacity (kVA)" tooltip="Installed diesel generator capacity. Used as a sizing reference to check the battery can realistically cover the backup load during outages." />
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
              <FieldLabel label="Installed Capacity (kWp)" tooltip="Installed rooftop/ground-mount solar array size. This is what actually drives the solar generation curve in the Interval Simulation and dashboard results — scales the preset's hourly solar profile up or down." />
              <input
                type="number"
                value={solar.installedCapacityKwp}
                onChange={e => setSolar({ ...solar, installedCapacityKwp: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Daily Surplus Solar (kWh)" tooltip="Reference daily excess solar energy figure. Note: this only feeds the simplified Comparison (legacy sales-pitch) tab as an illustrative number — it does not affect the Interval Simulation or main dashboard results. Use Installed Capacity (kWp) to change actual solar output there." />
              <input
                type="number"
                value={solar.dailySurplusSolarKwh}
                onChange={e => setSolar({ ...solar, dailySurplusSolarKwh: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label={`Export Credit (${currency}/kWh)`} tooltip="Compensation rate (feed-in tariff) received per kWh of solar exported to the grid. Lower than the energy charge, so self-consuming solar via the battery is usually worth more than exporting it." />
              <input
                type="number"
                step="0.5"
                value={solar.exportCreditPerKwh}
                onChange={e => setSolar({ ...solar, exportCreditPerKwh: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-yellow-500 focus:outline-none"
              />
            </div>
            <div className="col-span-2 flex items-center justify-between pt-1">
              <span className="flex items-center gap-1 text-slate-400">
                Zero-Export Constraint
                <span className="group relative inline-flex">
                  <Info className="w-3 h-3 text-slate-600 cursor-help" />
                  <span className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-1.5 w-56 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal normal-case text-slate-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
                    When active, the site is not permitted to export surplus solar to the grid — any unabsorbed solar must be curtailed instead of earning export credit.
                  </span>
                </span>
              </span>
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
              <FieldLabel label={`Turnkey CapEx (${currency})`} tooltip="Total upfront installed cost of the BESS project (battery, PCS, EPC, integration). The numerator in the simple payback calculation." />
              <input
                type="number"
                value={financial.initialCapex}
                onChange={e => setFinancial({ ...financial, initialCapex: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label={`Fixed Annual O&M (${currency})`} tooltip="Yearly fixed operations & maintenance cost (service contracts, monitoring, insurance), independent of how much the battery is cycled. Subtracted from gross savings each year." />
              <input
                type="number"
                value={financial.fixedAnnualOm}
                onChange={e => setFinancial({ ...financial, fixedAnnualOm: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Discount Rate (%)" tooltip="Annual rate used to discount future cash flows to present value in the NPV/IRR calculation. Reflects the cost of capital or required rate of return." />
              <input
                type="number"
                value={financial.discountRatePct}
                onChange={e => setFinancial({ ...financial, discountRatePct: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel label="Tariff Escalation (%/yr)" tooltip="Assumed annual increase in utility energy/demand rates. Higher escalation increases the value of avoided grid purchases in later years of the project." />
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
