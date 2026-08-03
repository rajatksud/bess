import { IntervalRecord, TariffInput, SolarInput } from '../types/bess';

export interface ProfilePreset {
  id: string;
  name: string;
  description: string;
  industry: string;
  /** Reference installed solar capacity (kWp) the hand-tuned curve below was authored against. */
  referenceSolarKwp: number;
  generateIntervals: (resolutionMinutes: number, tariff: TariffInput, solar: SolarInput) => IntervalRecord[];
}

export const PRESET_PROFILES: ProfilePreset[] = [
  {
    id: 'industrial_manufacturing',
    name: 'Industrial Textile / Commercial Manufacturing (Reference Case)',
    industry: 'Commercial & Industrial',
    description: '24/7 heavy base load (~180-300 kW peak), contract 300 kVA, daily 6-hour grid outages requiring DG, midday solar generation surplus.',
    referenceSolarKwp: 150,
    generateIntervals: (resolutionMinutes = 15, tariff, solar) => {
      const intervalsCount = (24 * 60) / resolutionMinutes;
      const records: IntervalRecord[] = [];
      const solarScale = solar.enableSolarIntegration ? (solar.installedCapacityKwp || 0) / 150 : 0;

      for (let i = 0; i < intervalsCount; i++) {
        const minuteOfDay = i * resolutionMinutes;
        const hour = Math.floor(minuteOfDay / 60);
        const mins = minuteOfDay % 60;
        const timeLabel = `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

        // Base load shape (300 kW peak between 14:00 - 18:00, 180 kW night)
        let baseKw = 180;
        if (hour >= 8 && hour < 20) {
          // Daytime surge
          const peakCurve = Math.sin(((hour - 8) / 12) * Math.PI);
          baseKw = 200 + peakCurve * 100; // Peaks at 300 kW at 14:00
        }

        // Solar curve (10:00 - 16:00, peaks at 150 kW at 13:00 for a 150 kWp array)
        let solarKw = 0;
        if (hour >= 9 && hour <= 16) {
          const solarCurve = Math.sin(((hour - 9) / 7) * Math.PI);
          solarKw = Math.max(0, solarCurve * 150) * solarScale;
        }

        // Grid Availability: Grid outages during peak evening 17:00 - 21:00 (4 hrs) + morning 06:00 - 08:00 (2 hrs) = 6 hrs/day
        const isOutage = (hour >= 17 && hour < 21) || (hour >= 6 && hour < 8);
        const gridAvailable = !isOutage;

        // DG requirement if grid is unavailable
        const dgRequiredKw = isOutage ? baseKw : 0;

        // Tariff rate
        let importRate = tariff.energyChargePerKwh;
        let tariffPeriodName = 'Standard';

        if (tariff.enableTou && tariff.touPeriods.length > 0) {
          const activeTou = tariff.touPeriods.find(p => {
            const [sH, sM] = p.startTime.split(':').map(Number);
            const [eH, eM] = p.endTime.split(':').map(Number);
            const currentMins = hour * 60 + mins;
            const startMins = sH * 60 + sM;
            const endMins = eH * 60 + eM;
            return currentMins >= startMins && currentMins < endMins;
          });
          if (activeTou) {
            importRate = activeTou.importRatePerKwh;
            tariffPeriodName = activeTou.name;
          }
        }

        const pf = tariff.powerFactor || 0.90;

        records.push({
          intervalIndex: i,
          timeLabel,
          loadKw: baseKw,
          loadKva: baseKw / pf,
          solarKw,
          gridAvailable,
          dgRequiredKw,
          tariffImportRate: importRate,
          tariffPeriod: tariffPeriodName,
          
          // Defaults before simulation
          bessPowerKw: 0,
          bessSocPct: 80,
          bessEnergyKwh: 200,
          postBessLoadKw: baseKw,
          postBessLoadKva: baseKw / pf,
          postBessDgKw: dgRequiredKw,
          gridImportKw: gridAvailable ? Math.max(0, baseKw - solarKw) : 0,
          gridExportKw: gridAvailable ? Math.max(0, solarKw - baseKw) : 0,
          solarCurtailedKw: 0,
          bessAction: 'Idle',
          grossSiteLoadKw: baseKw,
          solarGenerationKw: solarKw,
          solarGenerationServingLoadKw: Math.min(solarKw, baseKw),
          preBessGridImportKw: Math.max(0, baseKw - Math.min(solarKw, baseKw)),
          postBessGridImportKw: Math.max(0, baseKw - Math.min(solarKw, baseKw)),
          batteryChargeKw: 0,
          batteryDischargeKw: 0,
          gridBatteryChargeKw: 0
        });
      }

      return records;
    }
  },
  {
    id: 'commercial_office_plaza',
    name: 'Commercial Office Plaza (High Peak Demand & TOU Tariff)',
    industry: 'Commercial Office',
    description: 'HVAC-driven daytime load spike (8am-6pm), high peak demand charges (₹600/kVA), 3-tier Time-Of-Use tariff.',
    referenceSolarKwp: 100,
    generateIntervals: (resolutionMinutes = 15, tariff, solar) => {
      const intervalsCount = (24 * 60) / resolutionMinutes;
      const records: IntervalRecord[] = [];
      const solarScale = solar.enableSolarIntegration ? (solar.installedCapacityKwp || 0) / 100 : 0;

      for (let i = 0; i < intervalsCount; i++) {
        const minuteOfDay = i * resolutionMinutes;
        const hour = Math.floor(minuteOfDay / 60);
        const mins = minuteOfDay % 60;
        const timeLabel = `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

        let baseKw = 40; // Overnight base load
        if (hour >= 7 && hour <= 19) {
          const hvacCurve = Math.sin(((hour - 7) / 12) * Math.PI);
          baseKw = 80 + hvacCurve * 220; // Peak 300 kW at 13:00
        }

        // Solar curve peaks at 100 kW for a 100 kWp array
        let solarKw = 0;
        if (hour >= 8 && hour <= 17) {
          solarKw = Math.sin(((hour - 8) / 9) * Math.PI) * 100 * solarScale;
        }

        const gridAvailable = true; // Reliable grid
        const pf = 0.92;

        let importRate = tariff.energyChargePerKwh;
        let tariffPeriodName = 'Standard';
        
        // High TOU during 18:00 - 22:00
        if (hour >= 18 && hour < 22) {
          importRate = tariff.energyChargePerKwh * 1.5;
          tariffPeriodName = 'Peak Surge';
        } else if (hour >= 0 && hour < 6) {
          importRate = tariff.energyChargePerKwh * 0.7;
          tariffPeriodName = 'Off-Peak Discount';
        }

        records.push({
          intervalIndex: i,
          timeLabel,
          loadKw: baseKw,
          loadKva: baseKw / pf,
          solarKw,
          gridAvailable,
          dgRequiredKw: 0,
          tariffImportRate: importRate,
          tariffPeriod: tariffPeriodName,
          bessPowerKw: 0,
          bessSocPct: 80,
          bessEnergyKwh: 200,
          postBessLoadKw: baseKw,
          postBessLoadKva: baseKw / pf,
          postBessDgKw: 0,
          gridImportKw: Math.max(0, baseKw - solarKw),
          gridExportKw: Math.max(0, solarKw - baseKw),
          solarCurtailedKw: 0,
          bessAction: 'Idle',
          grossSiteLoadKw: baseKw,
          solarGenerationKw: solarKw,
          solarGenerationServingLoadKw: Math.min(solarKw, baseKw),
          preBessGridImportKw: Math.max(0, baseKw - Math.min(solarKw, baseKw)),
          postBessGridImportKw: Math.max(0, baseKw - Math.min(solarKw, baseKw)),
          batteryChargeKw: 0,
          batteryDischargeKw: 0,
          gridBatteryChargeKw: 0
        });
      }

      return records;
    }
  },
  {
    id: 'solar_farm_microgrid',
    name: 'Solar-Heavy Agricultural Microgrid',
    industry: 'Agriculture / Microgrid',
    description: '200 kWp rooftop solar array with zero-export grid restriction. Heavy midday curtailment rescued by BESS.',
    referenceSolarKwp: 220,
    generateIntervals: (resolutionMinutes = 15, tariff, solar) => {
      const intervalsCount = (24 * 60) / resolutionMinutes;
      const records: IntervalRecord[] = [];
      const solarScale = solar.enableSolarIntegration ? (solar.installedCapacityKwp || 0) / 220 : 0;

      for (let i = 0; i < intervalsCount; i++) {
        const minuteOfDay = i * resolutionMinutes;
        const hour = Math.floor(minuteOfDay / 60);
        const mins = minuteOfDay % 60;
        const timeLabel = `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

        const baseKw = (hour >= 6 && hour <= 20) ? 90 : 30;

        // Solar curve peaks at 220 kW for a 220 kWp array
        let solarKw = 0;
        if (hour >= 8 && hour <= 17) {
          solarKw = Math.sin(((hour - 8) / 9) * Math.PI) * 220 * solarScale;
        }

        const gridAvailable = true;
        const pf = 0.95;

        records.push({
          intervalIndex: i,
          timeLabel,
          loadKw: baseKw,
          loadKva: baseKw / pf,
          solarKw,
          gridAvailable,
          dgRequiredKw: 0,
          tariffImportRate: tariff.energyChargePerKwh,
          tariffPeriod: 'Standard',
          bessPowerKw: 0,
          bessSocPct: 80,
          bessEnergyKwh: 200,
          postBessLoadKw: baseKw,
          postBessLoadKva: baseKw / pf,
          postBessDgKw: 0,
          gridImportKw: Math.max(0, baseKw - solarKw),
          gridExportKw: Math.max(0, solarKw - baseKw),
          solarCurtailedKw: 0,
          bessAction: 'Idle',
          grossSiteLoadKw: baseKw,
          solarGenerationKw: solarKw,
          solarGenerationServingLoadKw: Math.min(solarKw, baseKw),
          preBessGridImportKw: Math.max(0, baseKw - Math.min(solarKw, baseKw)),
          postBessGridImportKw: Math.max(0, baseKw - Math.min(solarKw, baseKw)),
          batteryChargeKw: 0,
          batteryDischargeKw: 0,
          gridBatteryChargeKw: 0
        });
      }

      return records;
    }
  }
];
