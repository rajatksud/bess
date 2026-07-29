import { 
  BessSystemInput, 
  TariffInput, 
  DieselInput, 
  SolarInput, 
  FinancialInput, 
  IntervalRecord, 
  SavingsBreakdown, 
  TechnicalResult, 
  DispatchPriorityType
} from '../types/bess';

export function runIntervalDispatch(
  intervals: IntervalRecord[],
  system: BessSystemInput,
  tariff: TariffInput,
  diesel: DieselInput,
  solar: SolarInput,
  financial: FinancialInput,
  priorities: DispatchPriorityType[] = ['backup_reserve', 'peak_shaving', 'solar_self_consumption', 'diesel_displacement', 'tou_arbitrage'],
  intervalMinutes = 15
): {
  simulatedIntervals: IntervalRecord[];
  savings: SavingsBreakdown;
  technical: TechnicalResult;
} {
  const dtHours = intervalMinutes / 60;
  const etaCharge = system.chargeEfficiencyPct / 100;
  const etaDischarge = system.dischargeEfficiencyPct / 100;
  const effectiveCapacityKwh = system.ratedEnergyKwh * (system.usableDodPct / 100);
  
  let currentSocPct = system.initialSocPct;
  const minUsableSocPct = Math.max(system.minSocPct, system.minSocPct + system.reserveSocPct);
  const maxUsableSocPct = system.maxSocPct;

  let totalChargedKwh = 0;
  let totalDischargedKwh = 0;
  let totalSolarStoredKwh = 0;
  let totalDgDisplacedKwh = 0;
  let totalUnservedBackupKwh = 0;
  let totalCurtailedSolarKwh = 0;
  let totalGridChargedKwh = 0;

  // Rule 2 (no double counting): each kWh discharged is attributed to exactly ONE
  // avoided-cost category based on the bessAction tag assigned in the priority loop
  // below. These per-category accumulators are the ONLY inputs the savings
  // calculation may use for peak-shaving/arbitrage energy. Do not derive per-category
  // savings from the aggregate totalDischargedKwh/totalChargedKwh above — those two
  // remain valid ONLY for physical/degradation purposes (SOC, cycle counting),
  // because they intentionally mix energy from every avoided-cost category.
  let totalArbitrageDischargedKwh = 0;
  let totalArbitrageChargedKwh = 0;

  // Find Peak Before BESS across the profile
  let peakBeforeKw = 0;
  let peakBeforeKva = 0;
  intervals.forEach(inv => {
    if (inv.loadKw > peakBeforeKw) peakBeforeKw = inv.loadKw;
    if (inv.loadKva > peakBeforeKva) peakBeforeKva = inv.loadKva;
  });

  // Calculate target grid demand for peak shaving (e.g., target 60-70% of peak, bounded by battery rated kW)
  // Max achievable peak shaving in kW = min(system.ratedPowerKw, peakBeforeKw * 0.4)
  const targetPeakKw = Math.max(0, peakBeforeKw - system.ratedPowerKw);

  const simulatedIntervals: IntervalRecord[] = [];

  intervals.forEach(inv => {
    let loadKw = inv.loadKw;
    let solarKw = inv.solarKw;
    const pf = tariff.powerFactor || 0.90;
    const gridAvailable = inv.gridAvailable;
    
    let bessPowerKw = 0; // Positive = discharging, Negative = charging
    let bessAction = 'Idle';
    let solarCurtailedKw = 0;

    // Remaining capacity in battery for this interval
    const currentStoredKwh = (currentSocPct / 100) * system.ratedEnergyKwh;
    const minStoredKwh = (minUsableSocPct / 100) * system.ratedEnergyKwh;
    const maxStoredKwh = (maxUsableSocPct / 100) * system.ratedEnergyKwh;

    const availableDischargeKwh = Math.max(0, currentStoredKwh - minStoredKwh);
    const maxDischargeKwPossible = Math.min(system.ratedPowerKw, availableDischargeKwh / dtHours);

    const availableChargeKwh = Math.max(0, maxStoredKwh - currentStoredKwh);
    const maxChargeKwPossible = Math.min(system.ratedPowerKw, availableChargeKwh / dtHours);

    let remainingDischargeKw = maxDischargeKwPossible;
    let remainingChargeKw = maxChargeKwPossible;

    // Process priorities
    for (const priority of priorities) {
      if (bessPowerKw !== 0) continue; // Battery occupied in this interval

      if (priority === 'backup_reserve' && !gridAvailable && loadKw > 0) {
        // Discharging during grid outage to supply load & displace DG
        const dischargeKw = Math.min(loadKw, remainingDischargeKw);
        if (dischargeKw > 0) {
          bessPowerKw = dischargeKw; // discharging
          bessAction = 'Backup / DG Displacement';
          totalDgDisplacedKwh += dischargeKw * dtHours;
        }
      }

      else if (priority === 'peak_shaving' && gridAvailable && loadKw > targetPeakKw) {
        const requiredShaveKw = loadKw - targetPeakKw;
        const dischargeKw = Math.min(requiredShaveKw, remainingDischargeKw);
        if (dischargeKw > 0) {
          bessPowerKw = dischargeKw;
          bessAction = 'Peak Shaving';
        }
      }

      else if (priority === 'solar_self_consumption' && gridAvailable && solarKw > loadKw) {
        const excessSolarKw = solarKw - loadKw;
        const chargeKw = Math.min(excessSolarKw, remainingChargeKw);
        if (chargeKw > 0) {
          bessPowerKw = -chargeKw; // negative = charging
          bessAction = 'Solar Surplus Charging';
          totalSolarStoredKwh += chargeKw * dtHours;
        }
      }

      else if (priority === 'diesel_displacement' && inv.dgRequiredKw > 0 && bessPowerKw === 0) {
        const dischargeKw = Math.min(inv.dgRequiredKw, remainingDischargeKw);
        if (dischargeKw > 0) {
          bessPowerKw = dischargeKw;
          bessAction = 'Diesel Displacement';
          totalDgDisplacedKwh += dischargeKw * dtHours;
        }
      }

      else if (priority === 'tou_arbitrage' && gridAvailable && bessPowerKw === 0) {
        // Charge off-peak (if rate < standard or during night), Discharge peak
        if (inv.tariffPeriod === 'Peak Surge' || inv.tariffImportRate > tariff.energyChargePerKwh * 1.2) {
          const dischargeKw = Math.min(loadKw, remainingDischargeKw);
          if (dischargeKw > 0) {
            bessPowerKw = dischargeKw;
            bessAction = 'TOU Arbitrage Discharge';
            totalArbitrageDischargedKwh += dischargeKw * dtHours;
          }
        } else if (inv.tariffPeriod === 'Off-Peak Discount' || inv.tariffImportRate < tariff.energyChargePerKwh * 0.8) {
          const chargeKw = remainingChargeKw;
          if (chargeKw > 0) {
            bessPowerKw = -chargeKw;
            bessAction = 'TOU Off-Peak Charge';
            totalGridChargedKwh += chargeKw * dtHours;
            totalArbitrageChargedKwh += chargeKw * dtHours;
          }
        }
      }
    }

    // Update state of charge
    let netEnergyKwhChange = 0;
    if (bessPowerKw > 0) {
      // Discharging
      const dischargedEnergyKwh = bessPowerKw * dtHours;
      netEnergyKwhChange = -(dischargedEnergyKwh / etaDischarge);
      totalDischargedKwh += dischargedEnergyKwh;
    } else if (bessPowerKw < 0) {
      // Charging
      const chargedEnergyKwh = Math.abs(bessPowerKw) * dtHours;
      netEnergyKwhChange = chargedEnergyKwh * etaCharge;
      totalChargedKwh += chargedEnergyKwh;
    }

    const nextStoredKwh = Math.min(maxStoredKwh, Math.max(minStoredKwh, currentStoredKwh + netEnergyKwhChange));
    currentSocPct = (nextStoredKwh / system.ratedEnergyKwh) * 100;

    // Calculate post-BESS grid load, kVA, DG load
    const postBessLoadKw = Math.max(0, loadKw - (bessPowerKw > 0 ? bessPowerKw : 0));
    const postBessLoadKva = postBessLoadKw / pf;
    
    let postBessDgKw = 0;
    if (!gridAvailable) {
      postBessDgKw = Math.max(0, loadKw - (bessPowerKw > 0 ? bessPowerKw : 0));
      if (postBessDgKw > 0) {
        totalUnservedBackupKwh += postBessDgKw * dtHours;
      }
    }

    // Excess unabsorbed solar
    if (solarKw > loadKw + Math.abs(bessPowerKw < 0 ? bessPowerKw : 0)) {
      solarCurtailedKw = solarKw - loadKw - Math.abs(bessPowerKw < 0 ? bessPowerKw : 0);
      totalCurtailedSolarKwh += solarCurtailedKw * dtHours;
    }

    const gridImportKw = gridAvailable ? Math.max(0, postBessLoadKw - solarKw + Math.abs(bessPowerKw < 0 ? bessPowerKw : 0)) : 0;
    const gridExportKw = gridAvailable ? Math.max(0, solarKw - postBessLoadKw - Math.abs(bessPowerKw < 0 ? bessPowerKw : 0)) : 0;

    simulatedIntervals.push({
      ...inv,
      bessPowerKw,
      bessSocPct: currentSocPct,
      bessEnergyKwh: nextStoredKwh,
      postBessLoadKw,
      postBessLoadKva,
      postBessDgKw,
      gridImportKw,
      gridExportKw,
      solarCurtailedKw,
      bessAction
    });
  });

  // Find Peak After BESS
  let peakAfterKw = 0;
  let peakAfterKva = 0;
  simulatedIntervals.forEach(inv => {
    if (inv.postBessLoadKw > peakAfterKw) peakAfterKw = inv.postBessLoadKw;
    if (inv.postBessLoadKva > peakAfterKva) peakAfterKva = inv.postBessLoadKva;
  });

  // Calculate annual multiplier (e.g. 365 days if 24-hr profile is simulated)
  const daysInYear = 365;
  
  // 1. Demand Charge Saving
  const billedKvaBefore = Math.min(tariff.contractDemandKva, peakBeforeKva);
  const billedKvaAfter = Math.min(tariff.contractDemandKva, Math.max(peakAfterKva, tariff.contractDemandKva * (tariff.minimumBillingDemandPct / 100)));
  const kvaReduced = Math.max(0, billedKvaBefore - billedKvaAfter);
  const annualDemandSaving = kvaReduced * tariff.demandChargePerKvaMonth * 12;

  // 2. Diesel Displacement Saving
  const annualDgEnergyDisplacedKwh = totalDgDisplacedKwh * daysInYear;
  const fuelFactorLPerKwh = diesel.specificFuelConsumptionLitrePerKwh || 0.28;
  const annualLitresSaved = annualDgEnergyDisplacedKwh * fuelFactorLPerKwh;
  const annualDieselFuelSaving = annualLitresSaved * diesel.dieselPricePerLitre;
  
  // DG maintenance saving (approx. run hours reduced)
  const avgOutageLoad = diesel.avgOutageLoadKw || 120;
  const avoidedDgRunHours = annualDgEnergyDisplacedKwh / Math.max(10, avgOutageLoad);
  const annualDgMaintenanceSaving = avoidedDgRunHours * (diesel.maintenanceCostPerRunHour || 150);

  // 3. Solar Self-Consumption Saving
  const annualSolarStoredKwh = totalSolarStoredKwh * daysInYear;
  const avoidedImportTariff = tariff.energyChargePerKwh;
  const exportCredit = solar.exportCreditPerKwh || 3.0;
  const netSolarBenefitPerKwh = Math.max(0, avoidedImportTariff - exportCredit);
  const annualSolarSelfConsumptionSaving = annualSolarStoredKwh * netSolarBenefitPerKwh;

  // 4. Energy Arbitrage Saving
  //
  // Rule 2 (no double counting): this MUST be computed only from energy the dispatch
  // loop actually tagged 'TOU Arbitrage Discharge' / 'TOU Off-Peak Charge'
  // (totalArbitrageDischargedKwh / totalArbitrageChargedKwh). Using the aggregate
  // totalDischargedKwh here would re-monetize kWh already credited to demand-charge
  // reduction (peak shaving) and diesel-fuel saving (backup/DG displacement) above,
  // because those categories share the same physical battery and are mutually
  // exclusive per interval, but totalDischargedKwh sums across ALL of them.
  const annualDischargedKwh = totalDischargedKwh * daysInYear;
  const annualChargedKwh = totalChargedKwh * daysInYear;
  const annualArbitrageDischargedKwh = totalArbitrageDischargedKwh * daysInYear;
  const annualArbitrageChargedKwh = totalArbitrageChargedKwh * daysInYear;
  // Net arbitrage value = (peak-rate energy discharged x peak rate) - (off-peak energy
  // charged x off-peak rate), consistent with CALCULATION_ENGINE_DESIGN.md section on
  // Arbitrage and the coding spec's net-arbitrage-value formula. Falls back to the
  // standard energy charge if no TOU periods are configured for this interval set.
  const peakRate = tariff.enableTou
    ? Math.max(tariff.energyChargePerKwh, ...tariff.touPeriods.map(p => p.importRatePerKwh))
    : tariff.energyChargePerKwh;
  const offPeakRate = tariff.enableTou && tariff.touPeriods.length > 0
    ? Math.min(...tariff.touPeriods.map(p => p.importRatePerKwh))
    : tariff.energyChargePerKwh;
  // This is the GROSS arbitrage saving (avoided peak-rate import only). The cost of
  // the off-peak grid energy used to charge is deducted once, below, via
  // annualChargingCost - it must not also be netted out here or it would be
  // subtracted from net savings twice.
  const annualEnergyArbitrageSaving = Math.max(0, annualArbitrageDischargedKwh * peakRate);

  // Costs
  // All grid (non-solar) charging in this simulation currently originates from the
  // TOU off-peak-charge branch, so annualGridChargedKwh === annualArbitrageChargedKwh.
  // Priced at the actual off-peak tariff rather than an approximated 0.8x factor.
  const annualGridChargedKwh = totalGridChargedKwh * daysInYear;
  const annualChargingCost = annualGridChargedKwh * offPeakRate;

  const annualAuxiliaryKwh = system.auxiliaryLoadKw * 24 * daysInYear;
  const annualAuxiliaryCost = annualAuxiliaryKwh * tariff.energyChargePerKwh;

  const totalAnnualThroughputKwh = annualDischargedKwh;
  const degradationCostPerKwh = financial.variableOmPerKwhThroughput || 0.15;
  const annualDegradationCost = totalAnnualThroughputKwh * degradationCostPerKwh;

  const annualOmCost = financial.fixedAnnualOm;

  const grossSaving = annualDemandSaving + annualDieselFuelSaving + annualDgMaintenanceSaving + annualSolarSelfConsumptionSaving + annualEnergyArbitrageSaving;
  const netOperatingSaving = grossSaving - annualChargingCost - annualAuxiliaryCost - annualDegradationCost - annualOmCost;

  const equivalentFullCycles = annualDischargedKwh / Math.max(1, system.ratedEnergyKwh);

  return {
    simulatedIntervals,
    savings: {
      demandChargeSaving: annualDemandSaving,
      dieselFuelSaving: annualDieselFuelSaving,
      dgMaintenanceSaving: annualDgMaintenanceSaving,
      solarSelfConsumptionSaving: annualSolarSelfConsumptionSaving,
      energyArbitrageSaving: annualEnergyArbitrageSaving,
      exportRevenueChange: 0,
      chargingEnergyCost: annualChargingCost,
      auxiliaryEnergyCost: annualAuxiliaryCost,
      degradationCost: annualDegradationCost,
      omCost: annualOmCost,
      grossSaving,
      netOperatingSaving
    },
    technical: {
      peakBeforeKw,
      peakAfterKw,
      peakBeforeKva,
      peakAfterKva,
      energyChargedKwh: annualChargedKwh,
      energyDischargedKwh: annualDischargedKwh,
      solarEnergyStoredKwh: annualSolarStoredKwh,
      dgEnergyDisplacedKwh: annualDgEnergyDisplacedKwh,
      equivalentFullCycles,
      minimumSocPct: minUsableSocPct,
      maximumSocPct: maxUsableSocPct,
      unservedBackupEnergyKwh: totalUnservedBackupKwh * daysInYear,
      curtailedSolarKwh: totalCurtailedSolarKwh * daysInYear,
      deliverableCapacityKwh: effectiveCapacityKwh
    }
  };
}
