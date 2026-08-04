import { describe, it, expect } from 'vitest';
import { solarUnitCostPerKwh, solarCapex, priceSolarProcurement, solarProcurementModelOf } from '../solarProcurement';
import { resolveCapexBreakdown } from '../capexModel';
import { runIntervalDispatch } from '../dispatchEngine';
import { validateBessConfig } from '../validationEngine';
import { makeSystem, makeTariff, makeDiesel, makeSolar, makeFinancial, makeInterval } from './fixtures';

// Solar is either invested on site (capacity limited by roof/land, paid once as CapEx)
// or contracted through open access (paid per kWh). Under BOTH routes the entire
// procured capacity is paid for whether or not the site consumes it.
describe('solar procurement', () => {
  const onsite = makeSolar({
    procurementModel: 'onsite_capex',
    installedCapacityKwp: 150,
    maxOnsiteCapacityKwp: 200,
    solarCapexPerKwp: 35000
  });

  const openAccess = makeSolar({
    procurementModel: 'open_access',
    installedCapacityKwp: 150,
    contractedTariffPerKwh: 4.5,
    openAccessChargesPerKwh: 1.8
  });

  it('defaults to the on-site route when no model is declared', () => {
    expect(solarProcurementModelOf(makeSolar())).toBe('onsite_capex');
  });

  describe('on-site route', () => {
    it('prices the array as up-front CapEx and charges nothing per kWh', () => {
      expect(solarCapex(onsite)).toBe(150 * 35000);
      // Charging per kWh as well would bill the same capacity twice.
      expect(solarUnitCostPerKwh(onsite)).toBe(0);
    });

    it('adds the array to the derived turnkey CapEx', () => {
      const system = makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 });
      const financial = makeFinancial({
        initialCapex: 0,
        capexModel: 'derived',
        capexPerKwh: 10000,
        capexPerKw: 8000,
        balanceOfPlantCost: 390000
      });

      const withoutSolar = resolveCapexBreakdown(system, financial);
      const withSolar = resolveCapexBreakdown(system, financial, onsite);

      expect(withoutSolar.solarCapex).toBe(0);
      expect(withSolar.solarCapex).toBe(150 * 35000);
      expect(withSolar.totalCapex).toBe(withoutSolar.totalCapex + 150 * 35000);
    });

    it('does not mark the array up with the BESS EPC markup', () => {
      const system = makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 });
      const financial = makeFinancial({
        initialCapex: 0,
        capexModel: 'derived',
        capexPerKwh: 10000,
        capexPerKw: 8000,
        balanceOfPlantCost: 390000,
        epcMarkupPct: 10
      });

      const breakdown = resolveCapexBreakdown(system, financial, onsite);
      // Markup is 10% of the BESS scope (4,000,000) only, not of the solar package.
      expect(breakdown.epcMarkup).toBeCloseTo(400_000, 6);
    });

    it('leaves a fixed turnkey CapEx untouched', () => {
      const system = makeSystem({ ratedPowerKw: 125, ratedEnergyKwh: 261 });
      const breakdown = resolveCapexBreakdown(system, makeFinancial({ initialCapex: 4_000_000 }), onsite);

      expect(breakdown.totalCapex).toBe(4_000_000);
      expect(breakdown.solarCapex).toBe(0);
    });

    it('flags an array larger than the site can physically host', () => {
      const { warnings } = validateBessConfig(
        makeSystem(), makeTariff(), makeDiesel(),
        makeSolar({ ...onsite, installedCapacityKwp: 250, maxOnsiteCapacityKwp: 200 }),
        makeFinancial(), 'interval'
      );

      expect(warnings.some(w => w.code === 'ONSITE_SOLAR_EXCEEDS_SITE_CAPACITY')).toBe(true);
    });

    it('accepts an array at exactly the site limit', () => {
      const { warnings } = validateBessConfig(
        makeSystem(), makeTariff(), makeDiesel(),
        makeSolar({ ...onsite, installedCapacityKwp: 200, maxOnsiteCapacityKwp: 200 }),
        makeFinancial(), 'interval'
      );

      expect(warnings.some(w => w.code === 'ONSITE_SOLAR_EXCEEDS_SITE_CAPACITY')).toBe(false);
    });
  });

  describe('open-access route', () => {
    it('prices the delivered kWh as contracted tariff plus open-access charges', () => {
      expect(solarUnitCostPerKwh(openAccess)).toBeCloseTo(6.3, 10);
      // Contracted, not built.
      expect(solarCapex(openAccess)).toBe(0);
    });

    it('charges the ENTIRE generation, not just the consumed share', () => {
      const generatedKwh = 100_000;
      const curtailedKwh = 30_000;
      const cost = priceSolarProcurement(openAccess, generatedKwh, curtailedKwh);

      expect(cost.annualEnergyCost).toBeCloseTo(generatedKwh * 6.3, 6);
      // The curtailed share is paid for too - that is the whole point.
      expect(cost.annualCurtailedCost).toBeCloseTo(curtailedKwh * 6.3, 6);
    });

    it('has no site capacity limit', () => {
      const { warnings } = validateBessConfig(
        makeSystem(), makeTariff(), makeDiesel(),
        makeSolar({ ...openAccess, installedCapacityKwp: 5000, maxOnsiteCapacityKwp: 200 }),
        makeFinancial(), 'interval'
      );

      expect(warnings.some(w => w.code === 'ONSITE_SOLAR_EXCEEDS_SITE_CAPACITY')).toBe(false);
    });

    it('flags contracted solar with no tariff, which would appear free', () => {
      const { warnings } = validateBessConfig(
        makeSystem(), makeTariff(), makeDiesel(),
        makeSolar({ procurementModel: 'open_access', contractedTariffPerKwh: 0, openAccessChargesPerKwh: 0 }),
        makeFinancial(), 'interval'
      );

      expect(warnings.some(w => w.code === 'OPEN_ACCESS_SOLAR_WITHOUT_TARIFF')).toBe(true);
    });
  });

  describe('through the dispatch engine', () => {
    const system = makeSystem({ ratedPowerKw: 50, ratedEnergyKwh: 100, initialSocPct: 100, maxSocPct: 100, minSocPct: 0, reserveSocPct: 0 });
    // 200 kW of generation against 50 kW of load, battery already full: 150 kW of
    // surplus with nowhere to go under a zero-export licence.
    const intervals = [makeInterval({ loadKw: 50, solarKw: 200, gridAvailable: true })];

    it('reports total generation, not just the consumed share', () => {
      const { technical } = runIntervalDispatch(
        intervals, system, makeTariff(), makeDiesel({ enableDieselDisplacement: false }),
        makeSolar({ ...openAccess, exportAllowed: false }), makeFinancial(),
        ['solar_self_consumption'], 15
      );

      expect(technical.solarGeneratedKwh).toBeCloseTo(200 * 0.25 * 365, 6);
      expect(technical.curtailedSolarKwh).toBeGreaterThan(0);
    });

    it('prices curtailed contracted energy as a real, reported loss', () => {
      const { savings, technical, assumptions } = runIntervalDispatch(
        intervals, system, makeTariff(), makeDiesel({ enableDieselDisplacement: false }),
        makeSolar({ ...openAccess, exportAllowed: false }), makeFinancial(),
        ['solar_self_consumption'], 15
      );

      expect(savings.solarProcurementCost).toBeCloseTo(technical.solarGeneratedKwh * 6.3, 4);
      expect(savings.solarCurtailmentCost).toBeCloseTo(technical.curtailedSolarKwh * 6.3, 4);
      expect(savings.solarCurtailmentCost).toBeGreaterThan(0);
      expect(assumptions.some(a => a.includes('curtailed but'))).toBe(true);
    });

    it('keeps the procurement cost out of the BESS net operating saving', () => {
      // The same solar cost is incurred with and without the battery, so charging it
      // against the BESS case would misattribute it.
      const { savings } = runIntervalDispatch(
        intervals, system, makeTariff(), makeDiesel({ enableDieselDisplacement: false }),
        makeSolar({ ...openAccess, exportAllowed: false }), makeFinancial(),
        ['solar_self_consumption'], 15
      );

      const expectedNet = savings.grossSaving
        - savings.chargingEnergyCost
        - savings.auxiliaryEnergyCost
        - savings.degradationCost
        - savings.omCost;

      expect(savings.solarProcurementCost).toBeGreaterThan(0);
      expect(savings.netOperatingSaving).toBeCloseTo(expectedNet, 6);
    });

    it('charges nothing per kWh for on-site solar, which is paid through CapEx', () => {
      const { savings } = runIntervalDispatch(
        intervals, system, makeTariff(), makeDiesel({ enableDieselDisplacement: false }),
        makeSolar({ ...onsite, exportAllowed: false }), makeFinancial(),
        ['solar_self_consumption'], 15
      );

      expect(savings.solarProcurementCost).toBe(0);
      expect(savings.solarCurtailmentCost).toBe(0);
    });
  });
});
