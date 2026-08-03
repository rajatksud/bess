import { BillingInterval, ExportRuleDefinition, ChargeLine, BillingWarning } from './types';

export interface ExportCreditResult {
  totalExportKwh: number;
  totalCredit: number;
  breakdown: ChargeLine[];
  warnings: BillingWarning[];
}

/** Computes export credit/revenue for a series of intervals under the given export policy. */
export function calculateExportCredit(
  intervals: BillingInterval[],
  exportRules: ExportRuleDefinition,
  useField: 'baselineGridExportKw' | 'postBessGridExportKw' = 'postBessGridExportKw'
): ExportCreditResult {
  const warnings: BillingWarning[] = [];
  const rawExportKwh = intervals.reduce((sum, inv) => sum + (inv[useField] ?? 0) * inv.durationHours, 0);

  switch (exportRules.policy) {
    case 'prohibited': {
      if (rawExportKwh > 0) {
        warnings.push({
          code: 'EXPORT_PROHIBITED_BUT_PRESENT',
          level: 'warning',
          message: `Export is prohibited under this tariff, but ${rawExportKwh.toFixed(2)} kWh of export was present in the interval data. This energy must be curtailed at the site, not exported; no credit is applied.`
        });
      }
      return { totalExportKwh: 0, totalCredit: 0, breakdown: [], warnings };
    }

    case 'zero_value': {
      return {
        totalExportKwh: rawExportKwh,
        totalCredit: 0,
        breakdown: [{ label: 'Export (zero-value)', quantity: rawExportKwh, unit: 'kWh', rate: 0, amount: 0 }],
        warnings
      };
    }

    case 'curtailed': {
      const limitKw = exportRules.curtailmentLimitKw ?? 0;
      let curtailedKwh = 0;
      let exportedKwh = 0;
      for (const inv of intervals) {
        const exportKw = inv[useField] ?? 0;
        const allowedKw = Math.min(exportKw, limitKw);
        exportedKwh += allowedKw * inv.durationHours;
        curtailedKwh += Math.max(0, exportKw - limitKw) * inv.durationHours;
      }
      const rate = exportRules.creditPerKwh ?? 0;
      const amount = exportedKwh * rate;
      if (curtailedKwh > 0) {
        warnings.push({
          code: 'EXPORT_CURTAILED',
          level: 'info',
          message: `${curtailedKwh.toFixed(2)} kWh of generation exceeded the export curtailment limit (${limitKw} kW) and was curtailed rather than exported.`
        });
      }
      return {
        totalExportKwh: exportedKwh,
        totalCredit: amount,
        breakdown: [{ label: 'Curtailed export credit', quantity: exportedKwh, unit: 'kWh', rate, amount }],
        warnings
      };
    }

    case 'fixed_credit':
    case 'net_metering':
    case 'banking': {
      const rate = exportRules.creditPerKwh ?? 0;
      const amount = rawExportKwh * rate;
      const label = exportRules.policy === 'net_metering'
        ? 'Net metering credit'
        : exportRules.policy === 'banking'
          ? 'Banked energy credit'
          : 'Fixed export credit';
      if (exportRules.policy === 'banking' && exportRules.bankingSettlementMonths !== undefined) {
        warnings.push({
          code: 'BANKING_SETTLEMENT_NOT_MODELLED',
          level: 'info',
          message: `Banked export credit assumes immediate settlement; this calculation does not model the ${exportRules.bankingSettlementMonths}-month banking settlement/expiry cycle.`
        });
      }
      return {
        totalExportKwh: rawExportKwh,
        totalCredit: amount,
        breakdown: [{ label, quantity: rawExportKwh, unit: 'kWh', rate, amount }],
        warnings
      };
    }

    default:
      return { totalExportKwh: rawExportKwh, totalCredit: 0, breakdown: [], warnings };
  }
}
