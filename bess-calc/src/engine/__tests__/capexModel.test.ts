import { describe, it, expect } from 'vitest';
import { resolveCapexBreakdown, resolveTurnkeyCapex, withResolvedCapex } from '../capexModel';
import { calculateFinancialMetrics } from '../financialEngine';
import { makeSystem, makeFinancial } from './fixtures';
import { SavingsBreakdown, TechnicalResult } from '../../types/bess';

/** A flat, positive savings stream so payback/NPV respond only to the CapEx under test. */
function makeSavings(): SavingsBreakdown {
  return {
    demandChargeSaving: 800_000,
    dieselFuelSaving: 0,
    dgMaintenanceSaving: 0,
    solarSelfConsumptionSaving: 0,
    energyArbitrageSaving: 0,
    exportRevenueChange: 0,
    chargingEnergyCost: 0,
    auxiliaryEnergyCost: 0,
    degradationCost: 0,
    omCost: 0,
    solarProcurementCost: 0,
    solarCurtailmentCost: 0,
    grossSaving: 800_000,
    netOperatingSaving: 800_000
  };
}

function makeTechnical(): TechnicalResult {
  return {
    peakBeforeKw: 0,
    peakAfterKw: 0,
    peakBeforeKva: 0,
    peakAfterKva: 0,
    energyChargedKwh: 0,
    energyDischargedKwh: 0,
    solarGeneratedKwh: 0,
    solarEnergyStoredKwh: 0,
    dgEnergyDisplacedKwh: 0,
    equivalentFullCycles: 0,
    minimumSocPct: 0,
    maximumSocPct: 100,
    unservedBackupEnergyKwh: 0,
    curtailedSolarKwh: 0,
    deliverableCapacityKwh: 0
  };
}

// The derived turnkey CapEx model links project cost to the two things actually being
// bought - rated energy (kWh) and rated power (kW) - instead of a flat fixed number.
describe('turnkey CapEx model', () => {
  const derivedRates = {
    capexModel: 'derived' as const,
    capexPerKwh: 10000,
    capexPerKw: 8000,
    balanceOfPlantCost: 390000,
    epcMarkupPct: 0
  };

  describe('fixed model (default / legacy)', () => {
    it('uses initialCapex verbatim when no model is specified', () => {
      const breakdown = resolveCapexBreakdown(
        makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 }),
        makeFinancial({ initialCapex: 4_000_000 })
      );

      expect(breakdown.model).toBe('fixed');
      expect(breakdown.totalCapex).toBe(4_000_000);
    });

    it('is unaffected by rated power and energy', () => {
      const financial = makeFinancial({ initialCapex: 4_000_000 });
      const small = resolveTurnkeyCapex(makeSystem({ ratedPowerKw: 50, ratedEnergyKwh: 100 }), financial);
      const large = resolveTurnkeyCapex(makeSystem({ ratedPowerKw: 5000, ratedEnergyKwh: 20000 }), financial);

      expect(small).toBe(4_000_000);
      expect(large).toBe(4_000_000);
    });
  });

  describe('derived model', () => {
    it('reproduces the reference case exactly (125 kW / 261 kWh -> 4,000,000)', () => {
      const breakdown = resolveCapexBreakdown(
        makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 }),
        makeFinancial({ initialCapex: 0, ...derivedRates })
      );

      expect(breakdown.energyCapex).toBe(261 * 10000);   // 2,610,000
      expect(breakdown.powerCapex).toBe(125 * 8000);     // 1,000,000
      expect(breakdown.balanceOfPlantCost).toBe(390000);
      expect(breakdown.epcMarkup).toBe(0);
      expect(breakdown.totalCapex).toBe(4_000_000);
    });

    it('scales with rated energy, holding rated power fixed', () => {
      const financial = makeFinancial({ initialCapex: 0, ...derivedRates });
      const base = resolveTurnkeyCapex(makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 }), financial);
      const doubledEnergy = resolveTurnkeyCapex(makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 522 }), financial);

      // Only the energy block scales; power and BOP are unchanged.
      expect(doubledEnergy - base).toBe(261 * 10000);
    });

    it('scales with rated power, holding rated energy fixed', () => {
      const financial = makeFinancial({ initialCapex: 0, ...derivedRates });
      const base = resolveTurnkeyCapex(makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 }), financial);
      const doubledPower = resolveTurnkeyCapex(makeSystem({ ratedPowerKw: 250, ratedEnergyKwh: 261 }), financial);

      expect(doubledPower - base).toBe(125 * 8000);
    });

    it('applies the EPC markup to the sum of all three components', () => {
      const breakdown = resolveCapexBreakdown(
        makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 }),
        makeFinancial({ initialCapex: 0, ...derivedRates, epcMarkupPct: 10 })
      );

      expect(breakdown.epcMarkup).toBeCloseTo(400_000, 6);
      expect(breakdown.totalCapex).toBeCloseTo(4_400_000, 6);
    });

    it('ignores the stale initialCapex field entirely', () => {
      const total = resolveTurnkeyCapex(
        makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 }),
        makeFinancial({ initialCapex: 99_999_999, ...derivedRates })
      );

      expect(total).toBe(4_000_000);
    });

    it('treats missing rates as zero rather than inheriting reference defaults', () => {
      const breakdown = resolveCapexBreakdown(
        makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 }),
        makeFinancial({ initialCapex: 4_000_000, capexModel: 'derived' })
      );

      expect(breakdown.totalCapex).toBe(0);
    });
  });

  describe('withResolvedCapex', () => {
    it('pins the resolved total into initialCapex under a fixed model', () => {
      const resolved = withResolvedCapex(
        makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 }),
        makeFinancial({ initialCapex: 0, ...derivedRates })
      );

      expect(resolved.capexModel).toBe('fixed');
      expect(resolved.initialCapex).toBe(4_000_000);
    });

    it('is idempotent', () => {
      const system = makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 });
      const once = withResolvedCapex(system, makeFinancial({ initialCapex: 0, ...derivedRates }));
      const twice = withResolvedCapex(system, once);

      expect(twice.initialCapex).toBe(once.initialCapex);
    });

    it('keeps a downstream multiplier applied to the derived figure, not the stale field', () => {
      const system = makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 });
      // A scenario whose stale initialCapex disagrees with its derived rates.
      const resolved = withResolvedCapex(system, makeFinancial({ initialCapex: 1_000_000, ...derivedRates }));

      expect(resolved.initialCapex * 1.25).toBe(5_000_000);
    });
  });

  describe('financial engine integration', () => {
    it('invests the derived figure without the caller pre-resolving it', () => {
      const system = makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 });
      const derived = calculateFinancialMetrics(
        makeSavings(),
        makeTechnical(),
        makeFinancial({ initialCapex: 0, ...derivedRates }),
        system
      );
      const fixedEquivalent = calculateFinancialMetrics(
        makeSavings(),
        makeTechnical(),
        makeFinancial({ initialCapex: 4_000_000 }),
        system
      );

      expect(derived.initialInvestment).toBe(4_000_000);
      expect(derived.npv).toBeCloseTo(fixedEquivalent.npv, 6);
      expect(derived.simplePaybackYears).toBe(fixedEquivalent.simplePaybackYears);
    });

    it('a larger battery under the derived model costs more and pays back slower', () => {
      const financial = makeFinancial({ initialCapex: 0, ...derivedRates });
      const small = calculateFinancialMetrics(
        makeSavings(), makeTechnical(), financial,
        makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 })
      );
      const large = calculateFinancialMetrics(
        makeSavings(), makeTechnical(), financial,
        makeSystem({ ratedPowerKw: 250, ratedEnergyKwh: 522 })
      );

      expect(large.initialInvestment).toBeGreaterThan(small.initialInvestment);
      // Same savings stream (dispatch is not re-run here), larger investment.
      expect(large.simplePaybackYears ?? Infinity).toBeGreaterThan(small.simplePaybackYears ?? 0);
    });
  });
});
