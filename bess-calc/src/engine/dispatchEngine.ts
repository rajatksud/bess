import {
  BessSystemInput,
  TariffInput,
  DieselInput,
  SolarInput,
  FinancialInput,
  IntervalRecord,
  SavingsBreakdown,
  TechnicalResult,
  DispatchPriorityType,
  ReactivePowerBasis
} from '../types/bess';

/**
 * Resolves the kW -> kVA billing basis per the deterministic reactive-power policy
 * (Objective A): measured kVA > measured PF > configured site PF > unavailable.
 * The MVP only ever has a configured site PF (tariff.powerFactor) or nothing;
 * measured-kVA/measured-PF inputs are accepted here so a future CSV import that
 * supplies per-interval PF/kVA can be wired through without changing this contract.
 */
export function resolveReactivePowerBasis(
  measuredKva: number | undefined,
  measuredPf: number | undefined,
  configuredPf: number | undefined
): ReactivePowerBasis {
  if (measuredKva !== undefined && measuredKva >= 0) return 'measured_kva';
  if (measuredPf !== undefined && measuredPf > 0 && measuredPf <= 1) return 'measured_pf';
  if (configuredPf !== undefined && configuredPf > 0 && configuredPf <= 1) return 'configured_pf';
  return 'unavailable';
}

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
  reactivePowerBasis: ReactivePowerBasis;
  assumptions: string[];
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

  // Reactive-power (kW -> kVA) billing basis, resolved once for the whole profile per
  // the deterministic policy: measured kVA > measured PF > configured site PF >
  // unavailable. The MVP only ever supplies tariff.powerFactor (configured), so solar
  // and BESS inverters are assumed unity PF unless a future measured basis is wired
  // through generateIntervals/CSV import. This assumption is surfaced explicitly in
  // `assumptions` and, when no basis at all is available, in `warnings`-worthy output.
  const reactivePowerBasis = resolveReactivePowerBasis(undefined, undefined, tariff.powerFactor);
  const pf = reactivePowerBasis !== 'unavailable' ? tariff.powerFactor : undefined;
  const assumptions: string[] = [];
  if (reactivePowerBasis === 'configured_pf') {
    assumptions.push(
      'kVA billing quantities are derived from the configured site power factor ' +
      `(${tariff.powerFactor}), not measured per-interval kVA or PF. Solar and BESS ` +
      'inverters are assumed to operate at unity power factor.'
    );
  } else if (reactivePowerBasis === 'unavailable') {
    assumptions.push(
      'No power-factor or kVA basis is available (configured site PF is missing or ' +
      'invalid). kVA-based billing quantities cannot be calculated; kW-only figures ' +
      'are reported instead.'
    );
  }

  // Pre-BESS meter-side grid import, per interval: max(grossLoad - solarServingLoad, 0).
  // This is the physically correct peak-shaving target — NOT gross site load — because
  // solar already reduces what the grid meter would see before any battery acts.
  const preBessGridImportSeries: number[] = intervals.map(inv => {
    const solarServingLoad = Math.min(Math.max(inv.solarKw, 0), Math.max(inv.loadKw, 0));
    return Math.max(inv.loadKw - solarServingLoad, 0);
  });

  // Find Peak Before BESS across the profile, based on meter-side (net-of-solar) import,
  // not gross site load. peakBeforeKva is derived from the same net kW peak via the
  // resolved reactive-power basis (undefined PF => kVA figures stay at 0 / unavailable).
  let peakBeforeKw = 0;
  intervals.forEach((inv, i) => {
    if (preBessGridImportSeries[i] > peakBeforeKw) peakBeforeKw = preBessGridImportSeries[i];
  });
  const peakBeforeKva = pf ? peakBeforeKw / pf : 0;

  // Calculate target grid demand for peak shaving (bounded by battery rated kW).
  //
  // Bug fixed here: max(0, peakBeforeKw - ratedPowerKw) collapses to 0 whenever the
  // battery is rated at or above the profile's peak load (a battery "big enough to
  // shave the whole peak"). With target = 0, the peak_shaving priority below would
  // then match EVERY interval with any net import at all, discharging the battery
  // against ordinary base load that was never actually a demand-charge problem -
  // starving every lower-priority use (solar charging, arbitrage) of any opportunity
  // to claim the battery, and typically flattening SOC to its floor well before
  // intervals that genuinely need it (e.g. an evening outage or TOU-peak window later
  // the same day).
  //
  // Fix: shave down toward the NEXT-highest distinct net-import level actually observed
  // in the profile, not toward zero. This correctly distinguishes a genuine, rare peak
  // spike (a profile with one dominant maximum - shave it down as far as the battery
  // allows, per the original single-peak intent) from a profile with several recurring
  // load levels through the day (e.g. a low midday base load and a higher evening
  // load) - ordinary recurring load levels are never treated as "the peak" needing to
  // be shaved toward zero. Target is now computed against NET (meter-side) import so
  // that solar's own load-serving contribution isn't double-counted as "peak shaved by
  // the battery" - the general net-load fix beyond the earlier
  // battery-larger-than-peak special case.
  // When the profile has no second distinct net-import level (a flat/uniform profile,
  // or too few intervals to observe one) AND the battery is rated at or above the
  // whole peak, there is no "ordinary recurring load level" to fall back to below the
  // single observed level - pin the target at peakBeforeKw itself (i.e. "this level is
  // the baseline, not a peak to shave toward zero"). When the battery is genuinely
  // smaller than the peak, fall back to 0 so `peakBeforeKw - ratedPowerKw` (a strictly
  // positive, real shave amount) still applies instead of being masked by the pin.
  const distinctNetImportLevelsDesc = Array.from(new Set(preBessGridImportSeries)).sort((a, b) => b - a);
  const batteryCoversWholePeak = system.ratedPowerKw >= peakBeforeKw;
  const singleLevelFallbackKw = batteryCoversWholePeak ? peakBeforeKw : 0;
  const nextHighestNetImportLevelKw = distinctNetImportLevelsDesc.length > 1 ? distinctNetImportLevelsDesc[1] : singleLevelFallbackKw;
  const targetPeakKw = Math.max(nextHighestNetImportLevelKw, peakBeforeKw - system.ratedPowerKw);

  const simulatedIntervals: IntervalRecord[] = [];

  intervals.forEach((inv, intervalIdx) => {
    let loadKw = inv.loadKw;
    let solarKw = inv.solarKw;
    const gridAvailable = inv.gridAvailable;
    const preBessGridImportKw = preBessGridImportSeries[intervalIdx];
    const solarGenerationServingLoadKw = Math.min(Math.max(solarKw, 0), Math.max(loadKw, 0));

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

      else if (priority === 'peak_shaving' && gridAvailable && preBessGridImportKw > targetPeakKw) {
        const requiredShaveKw = preBessGridImportKw - targetPeakKw;
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

    const batteryDischargeKw = bessPowerKw > 0 ? bessPowerKw : 0;
    const batteryChargeKw = bessPowerKw < 0 ? Math.abs(bessPowerKw) : 0;
    // Charging is attributed to solar first (bessAction === 'Solar Surplus Charging'
    // is the only priority branch that charges from surplus solar; every other
    // charge branch, e.g. TOU off-peak, draws from the grid). This keeps
    // gridBatteryChargeKw consistent with the totalGridChargedKwh/totalSolarStoredKwh
    // accumulators already tracked per-category above (Rule 2: no double counting).
    const solarSourcedChargeKw = bessAction === 'Solar Surplus Charging' ? batteryChargeKw : 0;
    const gridBatteryChargeKw = batteryChargeKw - solarSourcedChargeKw;

    // Post-BESS meter-side grid import: max(grossLoad - solarServingLoad - batteryDischarge + gridBatteryCharge, 0).
    const postBessGridImportKw = Math.max(
      loadKw - solarGenerationServingLoadKw - batteryDischargeKw + gridBatteryChargeKw,
      0
    );
    // postBessLoadKw is retained for backward compatibility with existing UI/tests as
    // the net demand on load after battery discharge only (pre-existing field shape);
    // meter-side billing must use postBessGridImportKw instead.
    const postBessLoadKw = Math.max(0, loadKw - batteryDischargeKw);
    const postBessLoadKva = pf ? postBessGridImportKw / pf : 0;

    let postBessDgKw = 0;
    if (!gridAvailable) {
      postBessDgKw = Math.max(0, loadKw - batteryDischargeKw);
      if (postBessDgKw > 0) {
        totalUnservedBackupKwh += postBessDgKw * dtHours;
      }
    }

    // Excess unabsorbed solar: generation beyond what load consumes directly and what
    // the battery absorbs into charge from solar.
    const solarAbsorbedKw = solarGenerationServingLoadKw + solarSourcedChargeKw;
    if (solarKw > solarAbsorbedKw) {
      solarCurtailedKw = solarKw - solarAbsorbedKw;
      totalCurtailedSolarKwh += solarCurtailedKw * dtHours;
    }

    // Export only when the grid is available and generation, net of what load and the
    // battery consumed, still exceeds zero. Export is deliberately NOT netted against
    // postBessGridImportKw - the two are physically mutually exclusive within an
    // interval (a meter cannot import and export simultaneously), so at most one of
    // them is nonzero given the solar/battery accounting above.
    const gridImportKw = gridAvailable ? postBessGridImportKw : 0;
    const gridExportKw = gridAvailable ? Math.max(0, solarKw - solarAbsorbedKw - postBessGridImportKw) : 0;

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
      bessAction,
      grossSiteLoadKw: loadKw,
      solarGenerationKw: solarKw,
      solarGenerationServingLoadKw,
      preBessGridImportKw,
      postBessGridImportKw,
      batteryChargeKw,
      batteryDischargeKw,
      gridBatteryChargeKw,
      preBessGridImportKva: pf ? preBessGridImportKw / pf : undefined,
      postBessGridImportKva: pf ? postBessGridImportKw / pf : undefined
    });
  });

  // Find Peak After BESS - billing-relevant peak is the METER-SIDE grid import
  // (postBessGridImportKw/Kva), not raw post-battery load, since demand charges are
  // levied on what the grid meter actually sees.
  let peakAfterKw = 0;
  let peakAfterKva = 0;
  simulatedIntervals.forEach(inv => {
    if (inv.postBessGridImportKw > peakAfterKw) peakAfterKw = inv.postBessGridImportKw;
    if (pf && (inv.postBessGridImportKva ?? 0) > peakAfterKva) peakAfterKva = inv.postBessGridImportKva ?? 0;
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
    },
    reactivePowerBasis,
    assumptions
  };
}
