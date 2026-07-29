import React, { useState, useMemo } from 'react';
import { 
  BessSystemInput, 
  TariffInput, 
  DieselInput, 
  SolarInput, 
  FinancialInput, 
  CurrencySymbol, 
  DispatchPriorityType,
  SimulationResult 
} from './types/bess';
import { Header } from './components/Header';
import { QuickEstimateWizard } from './components/QuickEstimateWizard';
import { IntervalSimulationConfig } from './components/IntervalSimulation';
import { ResultsDashboard } from './components/ResultsDashboard';
import { ScenarioSensitivity } from './components/ScenarioSensitivity';
import { LegacyComparisonModal } from './components/LegacyComparisonModal';
import { ExportReportModal } from './components/ExportReportModal';
import { PRESET_PROFILES, ProfilePreset } from './engine/presetProfiles';
import { validateBessConfig } from './engine/validationEngine';
import { runIntervalDispatch } from './engine/dispatchEngine';
import { calculateFinancialMetrics } from './engine/financialEngine';

// Default Reference Configuration (125 kW / 261 kWh LiFePO4 BESS)
const INITIAL_SYSTEM: BessSystemInput = {
  ratedPowerKw: 125,
  ratedEnergyKwh: 261,
  batteryChemistry: 'LFP',
  usableDodPct: 90,
  minSocPct: 10,
  maxSocPct: 100,
  initialSocPct: 80,
  reserveSocPct: 15,
  chargeEfficiencyPct: 95,
  dischargeEfficiencyPct: 95,
  availabilityPct: 98,
  auxiliaryLoadKw: 2.0,
  annualDegradationPct: 2.0,
  projectLifeYears: 10,
  cycleLife: 6000
};

const INITIAL_TARIFF: TariffInput = {
  currency: '₹',
  energyChargePerKwh: 9.5,
  demandChargePerKvaMonth: 450,
  contractDemandKva: 300,
  billingDemandWindowMinutes: 15,
  powerFactor: 0.90,
  exportCreditPerKwh: 3.0,
  minimumBillingDemandPct: 75,
  demandRatchetPct: 80,
  enableTou: true,
  touPeriods: [
    { id: '1', name: 'Off-Peak Discount', startTime: '00:00', endTime: '06:00', importRatePerKwh: 7.0 },
    { id: '2', name: 'Standard', startTime: '06:00', endTime: '18:00', importRatePerKwh: 9.5 },
    { id: '3', name: 'Peak Surge', startTime: '18:00', endTime: '22:00', importRatePerKwh: 14.0 },
    { id: '4', name: 'Standard', startTime: '22:00', endTime: '24:00', importRatePerKwh: 9.5 }
  ]
};

const INITIAL_DIESEL: DieselInput = {
  enableDieselDisplacement: true,
  dgCapacityKva: 250,
  dieselPricePerLitre: 92,
  specificFuelConsumptionLitrePerKwh: 0.28,
  fixedFuelLitresPerHour: 5.0,
  variableFuelLitresPerKwh: 0.24,
  maintenanceCostPerRunHour: 150,
  outageHoursPerMonth: 180,
  avgOutageLoadKw: 120
};

const INITIAL_SOLAR: SolarInput = {
  enableSolarIntegration: true,
  installedCapacityKwp: 150,
  dailySurplusSolarKwh: 240,
  exportAllowed: false,
  exportCreditPerKwh: 3.0,
  curtailmentEnabled: true
};

const INITIAL_FINANCIAL: FinancialInput = {
  initialCapex: 4000000,
  fixedAnnualOm: 200000,
  variableOmPerKwhThroughput: 0.15,
  annualOmEscalationPct: 5.0,
  tariffEscalationPct: 4.0,
  dieselEscalationPct: 5.0,
  discountRatePct: 12.0,
  taxRatePct: 25.0,
  residualValuePct: 10.0,
  replacementYear: 8,
  replacementCapexAmount: 1200000
};

export function App() {
  const [currency, setCurrency] = useState<CurrencySymbol>('₹');
  const [system, setSystem] = useState<BessSystemInput>(INITIAL_SYSTEM);
  const [tariff, setTariff] = useState<TariffInput>(INITIAL_TARIFF);
  const [diesel, setDiesel] = useState<DieselInput>(INITIAL_DIESEL);
  const [solar, setSolar] = useState<SolarInput>(INITIAL_SOLAR);
  const [financial, setFinancial] = useState<FinancialInput>(INITIAL_FINANCIAL);

  const [activeTab, setActiveTab] = useState<'quick' | 'interval' | 'comparison' | 'scenario'>('quick');
  const [selectedPreset, setSelectedPreset] = useState<ProfilePreset>(PRESET_PROFILES[0]);
  const [intervalResolution, setIntervalResolution] = useState<number>(15);
  const [dispatchPriorities, setDispatchPriorities] = useState<DispatchPriorityType[]>([
    'backup_reserve',
    'peak_shaving',
    'solar_self_consumption',
    'diesel_displacement',
    'tou_arbitrage'
  ]);

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // Sensitivity Multipliers
  const [sensitivityMults, setSensitivityMults] = useState({
    dieselPriceMult: 1.0,
    demandChargeMult: 1.0,
    capexMult: 1.0,
    degradationMult: 1.0
  });

  // Handle currency change with typical defaults
  const handleCurrencyChange = (newCurrency: CurrencySymbol) => {
    setCurrency(newCurrency);
    if (newCurrency === '$') {
      setTariff(prev => ({ ...prev, energyChargePerKwh: 0.14, demandChargePerKvaMonth: 18 }));
      setDiesel(prev => ({ ...prev, dieselPricePerLitre: 1.15 }));
      setFinancial(prev => ({ ...prev, initialCapex: 48000, fixedAnnualOm: 2400 }));
    } else if (newCurrency === '₹') {
      setTariff(prev => ({ ...prev, energyChargePerKwh: 9.5, demandChargePerKvaMonth: 450 }));
      setDiesel(prev => ({ ...prev, dieselPricePerLitre: 92 }));
      setFinancial(prev => ({ ...prev, initialCapex: 4000000, fixedAnnualOm: 200000 }));
    }
  };

  const resetToReferenceCase = () => {
    setSystem(INITIAL_SYSTEM);
    setTariff(INITIAL_TARIFF);
    setDiesel(INITIAL_DIESEL);
    setSolar(INITIAL_SOLAR);
    setFinancial(INITIAL_FINANCIAL);
    setSelectedPreset(PRESET_PROFILES[0]);
  };

  // Run calculation simulation
  const simulationResult = useMemo<SimulationResult>(() => {
    // Apply sensitivity multipliers
    const adjustedSystem: BessSystemInput = {
      ...system,
      annualDegradationPct: system.annualDegradationPct * sensitivityMults.degradationMult
    };

    const adjustedTariff: TariffInput = {
      ...tariff,
      demandChargePerKvaMonth: tariff.demandChargePerKvaMonth * sensitivityMults.demandChargeMult
    };

    const adjustedDiesel: DieselInput = {
      ...diesel,
      dieselPricePerLitre: diesel.dieselPricePerLitre * sensitivityMults.dieselPriceMult
    };

    const adjustedFinancial: FinancialInput = {
      ...financial,
      initialCapex: financial.initialCapex * sensitivityMults.capexMult
    };

    // 1. Validation & Audit
    const mode = activeTab === 'comparison' ? 'legacy' : activeTab === 'quick' ? 'quick' : 'interval';
    const { warnings, confidenceGrade, gradeReason } = validateBessConfig(
      adjustedSystem,
      adjustedTariff,
      adjustedDiesel,
      solar,
      adjustedFinancial,
      mode
    );

    // 2. Generate interval dataset from profile
    const rawIntervals = selectedPreset.generateIntervals(intervalResolution, adjustedTariff, solar);

    // 3. Run Single-Balance Dispatch Engine
    const { simulatedIntervals, savings, technical } = runIntervalDispatch(
      rawIntervals,
      adjustedSystem,
      adjustedTariff,
      adjustedDiesel,
      solar,
      adjustedFinancial,
      dispatchPriorities,
      intervalResolution
    );

    // 4. Run Financial Cash Flow Engine
    const financialMetrics = calculateFinancialMetrics(
      savings,
      technical,
      adjustedFinancial,
      adjustedSystem
    );

    return {
      mode,
      confidenceGrade,
      confidenceGradeReason: gradeReason,
      system: adjustedSystem,
      tariff: adjustedTariff,
      diesel: adjustedDiesel,
      solar,
      financialInput: adjustedFinancial,
      dispatchPriorities,
      savings,
      technical,
      financial: financialMetrics,
      warnings,
      intervals: simulatedIntervals
    };
  }, [system, tariff, diesel, solar, financial, selectedPreset, intervalResolution, dispatchPriorities, activeTab, sensitivityMults]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      
      {/* Header */}
      <Header
        currency={currency}
        onCurrencyChange={handleCurrencyChange}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        confidenceGrade={simulationResult.confidenceGrade}
      />

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Tab 1: Quick Sizing & Config */}
        {activeTab === 'quick' && (
          <div className="space-y-6">
            <QuickEstimateWizard
              currency={currency}
              system={system}
              setSystem={setSystem}
              tariff={tariff}
              setTariff={setTariff}
              diesel={diesel}
              setDiesel={setDiesel}
              solar={solar}
              setSolar={setSolar}
              financial={financial}
              setFinancial={setFinancial}
              onResetToReference={resetToReferenceCase}
            />

            <ResultsDashboard
              result={simulationResult}
              currency={currency}
            />
          </div>
        )}

        {/* Tab 2: Interval Simulation & Dispatch */}
        {activeTab === 'interval' && (
          <div className="space-y-6">
            <IntervalSimulationConfig
              selectedPresetId={selectedPreset.id}
              onSelectPreset={setSelectedPreset}
              priorities={dispatchPriorities}
              onReorderPriorities={setDispatchPriorities}
              intervalResolution={intervalResolution}
              onIntervalResolutionChange={setIntervalResolution}
              tariff={tariff}
            />

            <ResultsDashboard
              result={simulationResult}
              currency={currency}
            />
          </div>
        )}

        {/* Tab 3: Scenarios & Sensitivity */}
        {activeTab === 'scenario' && (
          <div className="space-y-6">
            <ScenarioSensitivity
              baseResult={simulationResult}
              currency={currency}
              onUpdateSensitivities={setSensitivityMults}
            />

            <ResultsDashboard
              result={simulationResult}
              currency={currency}
            />
          </div>
        )}

        {/* Tab 4: Sales Pitch Audit Comparison */}
        {activeTab === 'comparison' && (
          <div className="space-y-6">
            <LegacyComparisonModal
              result={simulationResult}
              currency={currency}
            />

            <ResultsDashboard
              result={simulationResult}
              currency={currency}
            />
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/60 py-4 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>BESS Profitability & ROI Platform • Single-Energy Balance Dispatch Specification</span>
          <span className="font-mono text-slate-400">Reference: 125 kW / 261 kWh LiFePO4 BESS Architecture</span>
        </div>
      </footer>

      {/* Export Report Modal */}
      <ExportReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        result={simulationResult}
        currency={currency}
      />

    </div>
  );
}

export default App;
