# BESS Profitability & ROI Calculator  
## Evaluation, Calculation Logic, Data Model and Coding Specification

**Reference configuration:** 125 kW / 261 kWh LiFePO₄ BESS  
**Purpose:** Convert the illustrated commercial estimate into a defensible, configurable software calculator for industrial and commercial customers.

---

## 1. Executive Evaluation

The reference calculation is useful as a **sales illustration**, but it should not be implemented directly as production calculation logic. It produces an exceptionally short payback of about **1.06 years** because several assumptions are optimistic, some units are mixed, and multiple savings streams may overlap.

The software should therefore distinguish between:

1. **Indicative estimate** – fast pre-sales calculation using limited inputs.
2. **Engineering estimate** – interval-load-data-based simulation.
3. **Investment-grade estimate** – includes degradation, tariff escalation, financing, taxes, replacement costs, dispatch constraints and scenario analysis.

### Main conclusion

The calculator should retain the three commercial value streams shown in the image:

- demand reduction / peak shaving;
- diesel displacement;
- increased use of surplus solar;

but it must calculate them on a **common time-series dispatch model** so that the same stored energy is not counted more than once.

---

## 2. Evaluation of the Reference Calculation

### 2.1 Correct or useful elements

- BESS power and energy are separately identified: **125 kW / 261 kWh**.
- Backup duration is correctly presented as a nominal ratio:

\[
\text{Nominal duration} = \frac{261\text{ kWh}}{125\text{ kW}} = 2.088\text{ hours}
\]

- Demand-charge, diesel-saving and solar-utilisation value streams are commercially relevant.
- Project cost, annual saving, payback and ROI are easy for a customer to understand.
- The example is suitable as an initial lead-generation or screening tool.

### 2.2 Issues that must be corrected before coding

#### A. kW and kVA are treated as interchangeable

The example gives:

- contract demand: 300 kVA;
- demand charge: ₹450/kVA/month;
- peak load: 300 kW;
- post-BESS peak: 175 kW.

Demand billing is normally based on **kVA**, not kW. The reduction depends on power factor.

\[
\text{kVA} = \frac{\text{kW}}{\text{Power Factor}}
\]

The calculator must either:

- receive interval kVA directly; or
- receive interval kW and power factor and derive kVA.

#### B. The assumed peak reduction may be physically possible but not necessarily billable

A 125 kW BESS can reduce instantaneous real-power demand by at most approximately 125 kW, subject to:

- PCS output limit;
- state of charge;
- discharge duration;
- inverter efficiency;
- reserve-SOC setting;
- site power factor;
- tariff demand-window rules.

The bill saving cannot be determined from one peak value alone. It depends on whether the BESS can sustain output through the utility’s demand integration window and every relevant peak during the billing period.

#### C. Diesel saving overstates usable discharge energy

The illustration uses the full 261 kWh nameplate capacity every day.

Production logic should use:

\[
E_{\text{deliverable}} =
E_{\text{nameplate}}
\times \text{usable DoD}
\times \eta_{\text{discharge}}
\times \text{availability}
\]

If 261 kWh is nameplate capacity, 90% usable depth of discharge and 95% discharge efficiency are assumed:

\[
261 \times 0.90 \times 0.95 \approx 223.2\text{ kWh}
\]

This is before degradation and reserve-SOC requirements.

#### D. Diesel fuel consumption should not be a fixed universal factor

The image assumes **0.28 litre/kWh**. Actual specific fuel consumption varies materially with:

- DG loading;
- DG size and efficiency;
- age and maintenance;
- ambient conditions;
- start-stop losses;
- auxiliary consumption.

The calculator should support a load-dependent fuel curve or, at minimum, a configurable litre/kWh value with a confidence range.

#### E. Diesel displacement is limited by actual DG operation

The image assumes one full battery discharge every day, while also stating DG operation of 180 hours/month.

The battery can displace DG only when:

- an outage occurs;
- DG would otherwise be running;
- the battery has sufficient SOC;
- the site load is within BESS power capability;
- minimum DG loading and operational rules allow the DG to shut down or reduce fuel use.

A monthly or time-series outage profile is therefore required.

#### F. Solar utilisation is expressed in kW where energy should be in kWh

“Solar generation 240 kWh/day” is energy.  
“Load 120 kW” is power.

The statement “excess solar = 240 − 120 = 120 kW” is dimensionally invalid unless the two values refer to the same interval and both are power values.

Surplus solar must be calculated interval by interval:

\[
P_{\text{surplus},t} =
\max(P_{\text{solar},t} - P_{\text{load},t}, 0)
\]

Stored energy then depends on charge power, remaining battery capacity and charging efficiency.

#### G. Savings streams may be double counted

The same 261 kWh battery cannot independently deliver:

- a full cycle for diesel saving;
- another 200 kWh for solar utilisation;
- and unrestricted peak shaving,

on the same day unless the dispatch schedule, charging opportunity and cycle limits support all three.

The production calculator must dispatch one battery against all value streams in priority order.

#### H. Charging cost is omitted

When the battery is charged from grid power, the cost of charging must be deducted.

\[
\text{Net arbitrage value} =
E_{\text{discharged}}\times T_{\text{avoided}}
-
E_{\text{charged}}\times T_{\text{charging}}
\]

Round-trip efficiency also increases the required charging energy.

#### I. Ten-year profit is not a ten-year cash-flow model

The image multiplies first-year net savings by ten. It omits:

- battery degradation;
- tariff and diesel escalation;
- O&M escalation;
- insurance;
- availability losses;
- augmentation or cell replacement;
- inverter/PCS replacement;
- financing costs;
- taxes and depreciation;
- residual value;
- discount rate.

The result should not be labelled “10-year net profit” without these adjustments.

#### J. ROI definition is incomplete

\[
\frac{\text{annual saving}}{\text{investment}}\times100
\]

is a simple annual return, not a complete investment return measure.

The software should report:

- simple payback;
- discounted payback;
- net present value;
- internal rate of return;
- project IRR;
- equity IRR, where financing is modelled;
- levelised cost of storage, where required.

---

## 3. Recommended Product Modes

### 3.1 Quick Estimate

Use for first customer discussions.

Required inputs:

- BESS kW and kWh;
- project cost;
- demand charge;
- estimated peak reduction;
- diesel hours and fuel consumption;
- diesel price;
- estimated surplus solar;
- electricity tariff;
- operating days.

Output must be labelled **Indicative – subject to interval-data validation**.

### 3.2 Detailed Monthly Model

Uses monthly values for:

- maximum demand;
- peak-period duration;
- DG energy;
- solar surplus;
- tariffs;
- seasonality.

Suitable for a preliminary proposal.

### 3.3 Interval Simulation

Recommended production mode.

Input resolution:

- 15-minute intervals by default;
- configurable to 5, 30 or 60 minutes.

Required series:

- site kW;
- site kVA or power factor;
- solar generation;
- grid availability / outage;
- tariff period;
- optional DG output and fuel use.

This mode provides defensible savings and prevents double counting.

---

## 4. Core Calculation Model

## 4.1 BESS Parameters

| Field | Unit | Description |
|---|---:|---|
| ratedPowerKw | kW | Maximum continuous charge/discharge power |
| ratedEnergyKwh | kWh | Nameplate energy |
| usableDodPct | % | Maximum usable depth of discharge |
| minSocPct | % | Minimum SOC |
| maxSocPct | % | Maximum SOC |
| initialSocPct | % | SOC at start of simulation |
| chargeEfficiencyPct | % | AC-to-stored efficiency |
| dischargeEfficiencyPct | % | Stored-to-AC efficiency |
| roundTripEfficiencyPct | % | Optional validation field |
| availabilityPct | % | Expected technical availability |
| auxiliaryLoadKw | kW | HVAC/BMS/PCS auxiliary demand |
| annualDegradationPct | %/year | Simplified degradation |
| cycleLife | cycles | Cycle-life reference |
| calendarLifeYears | years | Calendar-life reference |
| reserveSocPct | % | Backup reserve not available for economic dispatch |

### Available energy

\[
E_{\text{usable},y}
=
E_{\text{nameplate}}
\times (SOC_{\max}-SOC_{\min})
\times (1-d_y)
\]

where \(d_y\) is cumulative degradation in year \(y\).

### Discharge limit for interval \(t\)

\[
E_{\text{discharge,max},t}
=
\min
\left(
P_{\text{rated}}\Delta t,
(SOC_t-SOC_{\min}-SOC_{\text{reserve}})E_{\text{effective}}
\right)
\]

---

## 4.2 State-of-Charge Update

For charging:

\[
SOC_{t+1}
=
SOC_t
+
\frac{E_{\text{charge},t}\eta_c}{E_{\text{effective}}}
\]

For discharging:

\[
SOC_{t+1}
=
SOC_t
-
\frac{E_{\text{discharge},t}/\eta_d}{E_{\text{effective}}}
\]

SOC must remain between configured minimum and maximum limits.

---

## 4.3 Peak-Shaving Logic

### Inputs

- interval site kW;
- interval kVA or power factor;
- demand-charge rate;
- billing demand window;
- contract demand;
- ratchet/minimum-billing-demand rules;
- target grid demand;
- BESS limits.

### Dispatch rule

For each interval:

\[
P_{\text{required},t}
=
\max(P_{\text{site},t}-P_{\text{target}},0)
\]

\[
P_{\text{BESS},t}
=
\min(P_{\text{required},t},P_{\text{rated}},P_{\text{SOC-limit},t})
\]

After dispatch:

\[
P_{\text{grid},t}
=
P_{\text{site},t}-P_{\text{BESS},t}
\]

Convert to kVA using measured kVA or power factor.

### Monthly demand saving

\[
S_{\text{demand},m}
=
(\text{BilledDemandBefore}_m-\text{BilledDemandAfter}_m)
\times R_{\text{demand},m}
\]

The billing-demand function must support configurable utility rules.

---

## 4.4 Diesel-Displacement Logic

### Preferred method

Use interval outage data and calculate what the DG would have supplied.

For each outage interval:

1. Determine site load.
2. Discharge BESS subject to power and SOC limits.
3. Determine residual DG energy.
4. Convert avoided DG energy to fuel saving using the configured fuel curve.
5. Deduct any additional charging cost used to restore SOC.

### Simplified method

\[
L_{\text{saved}}
=
E_{\text{DG displaced}}
\times \text{specific fuel consumption}
\]

\[
S_{\text{diesel}}
=
L_{\text{saved}}\times \text{diesel price}
-
\text{incremental charging cost}
\]

Optional additional benefits:

- avoided DG maintenance per running hour;
- avoided lubricant consumption;
- avoided start/stop events;
- reduced emissions.

These should be separate line items, not silently included.

---

## 4.5 Solar Self-Consumption Logic

For each interval:

\[
P_{\text{surplus},t}
=
\max(P_{\text{solar},t}-P_{\text{load},t},0)
\]

\[
P_{\text{charge},t}
=
\min(
P_{\text{surplus},t},
P_{\text{charge-rated}},
P_{\text{capacity-limit},t}
)
\]

Solar later discharged to load:

\[
S_{\text{solar},t}
=
E_{\text{solar-discharge},t}
\times
(T_{\text{import},t}-T_{\text{export/opportunity},t})
\]

The avoided import tariff must be compared with:

- export tariff;
- net-metering credit;
- banking value;
- curtailment value;
- open-access settlement value.

If exported solar already receives full retail credit, storage may create little or no solar-utilisation benefit.

---

## 4.6 Energy-Arbitrage Logic

Where time-of-day tariffs apply:

\[
S_{\text{arbitrage}}
=
\sum_t
(E_{\text{discharge},t}T_{\text{high},t})
-
\sum_t
(E_{\text{charge},t}T_{\text{low},t})
\]

The optimisation should consider efficiency losses and degradation cost.

---

## 4.7 Degradation Cost

A simple throughput-based degradation cost may be used:

\[
C_{\text{degradation}}
=
E_{\text{throughput}}
\times C_{\text{degradation per kWh}}
\]

A more advanced model may use:

- cycle depth;
- average SOC;
- temperature;
- C-rate;
- calendar ageing;
- manufacturer warranty curve.

Dispatch should reject an economic action where gross savings are lower than marginal degradation and operating cost.

---

## 5. Dispatch Priority

The user must be able to configure priority. Example:

1. Backup reserve protection.
2. Demand-charge reduction.
3. Diesel displacement.
4. Solar self-consumption.
5. time-of-day arbitrage.
6. ancillary or demand-response revenue.

An optimisation mode may maximise total net benefit while respecting all constraints.

### Critical rule

Every interval must have one consolidated energy balance. A separate calculator for each saving stream must not independently allocate the full battery capacity.

---

## 6. Financial Model

### 6.1 Capital Cost

Include configurable heads:

- battery racks/modules;
- PCS/inverter;
- EMS/BMS;
- transformer and switchgear;
- HVAC/fire protection;
- civil and electrical works;
- metering and communication;
- engineering and commissioning;
- statutory approvals;
- taxes;
- contingency;
- financing fees.

### 6.2 Operating Cost

- fixed annual O&M;
- variable O&M;
- insurance;
- auxiliary electricity;
- software/communications;
- annual testing;
- warranty extension;
- augmentation/replacement.

### 6.3 Annual Cash Flow

\[
\text{NetCashFlow}_y
=
\text{GrossSavings}_y
+
\text{OtherRevenue}_y
-
\text{O\&M}_y
-
\text{ReplacementCapex}_y
-
\text{FinancingCost}_y
-
\text{Taxes}_y
\]

### 6.4 Metrics

#### Simple payback

\[
\text{Payback}
=
\frac{\text{Initial Investment}}
{\text{First-year net saving}}
\]

Use only as an indicative metric.

#### Net present value

\[
NPV
=
-C_0
+
\sum_{y=1}^{N}
\frac{CF_y}{(1+r)^y}
\]

#### IRR

The discount rate at which NPV equals zero.

#### Discounted payback

The first year in which cumulative discounted cash flow becomes non-negative.

### 6.5 Scenario outputs

At minimum:

- conservative;
- base;
- optimistic.

Recommended sensitivity variables:

- diesel price;
- demand charge;
- annual DG hours;
- achievable peak reduction;
- BESS capex;
- battery degradation;
- usable DoD;
- round-trip efficiency;
- electricity tariff escalation;
- solar surplus;
- downtime.

---

## 7. Proposed Input Data Schema

```ts
export interface BessSystemInput {
  ratedPowerKw: number;
  ratedEnergyKwh: number;
  batteryChemistry: "LFP" | "NMC" | "OTHER";
  usableDodPct: number;
  minSocPct: number;
  maxSocPct: number;
  initialSocPct: number;
  reserveSocPct: number;
  chargeEfficiencyPct: number;
  dischargeEfficiencyPct: number;
  availabilityPct: number;
  auxiliaryLoadKw: number;
  annualDegradationPct: number;
  projectLifeYears: number;
}

export interface TariffInput {
  energyChargePerKwh: number;
  demandChargePerKvaMonth: number;
  contractDemandKva?: number;
  billingDemandWindowMinutes: number;
  powerFactor?: number;
  exportCreditPerKwh?: number;
  touPeriods?: Array<{
    name: string;
    startTime: string;
    endTime: string;
    importRatePerKwh: number;
    exportRatePerKwh?: number;
  }>;
  minimumBillingDemandPct?: number;
  demandRatchetPct?: number;
}

export interface DieselInput {
  dgCapacityKva: number;
  dieselPricePerLitre: number;
  specificFuelConsumptionLitrePerKwh?: number;
  fixedFuelLitresPerHour?: number;
  variableFuelLitresPerKwh?: number;
  maintenanceCostPerRunHour?: number;
}

export interface SolarInput {
  installedCapacityKwp?: number;
  exportAllowed: boolean;
  exportCreditPerKwh?: number;
  curtailmentEnabled?: boolean;
}

export interface FinancialInput {
  initialCapex: number;
  fixedAnnualOm: number;
  variableOmPerKwhThroughput?: number;
  annualOmEscalationPct: number;
  tariffEscalationPct: number;
  dieselEscalationPct: number;
  discountRatePct: number;
  taxRatePct?: number;
  replacementSchedule?: Array<{
    year: number;
    amount: number;
  }>;
  residualValue?: number;
}

export interface IntervalRecord {
  timestamp: string;
  loadKw: number;
  loadKva?: number;
  powerFactor?: number;
  solarKw?: number;
  gridAvailable?: boolean;
  dgKw?: number;
  tariffPeriod?: string;
}
```

---

## 8. Output Data Schema

```ts
export interface SavingsBreakdown {
  demandChargeSaving: number;
  dieselFuelSaving: number;
  dgMaintenanceSaving: number;
  solarSelfConsumptionSaving: number;
  energyArbitrageSaving: number;
  exportRevenueChange: number;
  chargingEnergyCost: number;
  auxiliaryEnergyCost: number;
  degradationCost: number;
  grossSaving: number;
  netOperatingSaving: number;
}

export interface TechnicalResult {
  peakBeforeKw: number;
  peakAfterKw: number;
  peakBeforeKva: number;
  peakAfterKva: number;
  energyChargedKwh: number;
  energyDischargedKwh: number;
  solarEnergyStoredKwh: number;
  dgEnergyDisplacedKwh: number;
  equivalentFullCycles: number;
  minimumSocPct: number;
  maximumSocPct: number;
  unservedBackupEnergyKwh: number;
  curtailedSolarKwh: number;
}

export interface FinancialResult {
  initialInvestment: number;
  firstYearGrossSaving: number;
  firstYearNetSaving: number;
  simplePaybackYears: number | null;
  discountedPaybackYears: number | null;
  npv: number;
  irrPct: number | null;
  tenYearCumulativeCashFlow: number;
  annualCashFlows: Array<{
    year: number;
    grossSaving: number;
    operatingCost: number;
    replacementCapex: number;
    netCashFlow: number;
    discountedCashFlow: number;
    cumulativeCashFlow: number;
  }>;
}
```

---

## 9. Validation Rules

The application must block or warn on the following:

1. `ratedPowerKw <= 0` or `ratedEnergyKwh <= 0`.
2. SOC limits outside 0–100%.
3. `minSocPct >= maxSocPct`.
4. reserve SOC greater than usable SOC range.
5. efficiency outside a configurable realistic range.
6. project life greater than battery/PCS life without replacement assumption.
7. demand charge entered in ₹/kVA but no kVA or power-factor data.
8. solar energy entered as kW, or solar power entered as kWh.
9. diesel savings exceeding actual DG energy.
10. annual discharged energy exceeding feasible cycles and charging opportunity.
11. simultaneous independent use of full capacity by multiple savings modules.
12. negative tariffs or fuel prices unless explicitly permitted.
13. post-BESS peak lower than physically achievable.
14. annual utilisation above availability-adjusted limits.
15. payback presented where annual net savings are zero or negative.

### Warning classifications

- **Error:** calculation cannot proceed.
- **Material warning:** result may be misleading.
- **Information:** assumption should be validated.

---

## 10. Calculation Workflow

```text
1. Validate user inputs.
2. Normalise units and interval duration.
3. Build effective battery capacity for simulation year.
4. Determine tariff and grid state for each interval.
5. Calculate base-case utility demand, energy import, solar export and DG use.
6. Run consolidated BESS dispatch.
7. Recalculate post-BESS grid demand, import, export and DG use.
8. Calculate each saving stream from before/after differences.
9. Deduct charging, auxiliary, degradation and O&M costs.
10. Repeat for each project year with degradation and escalation.
11. Generate cash flow, NPV, IRR and payback.
12. Run conservative/base/optimistic scenarios.
13. Produce technical and commercial audit trail.
```

---

## 11. Suggested Service Architecture

### Front end

- React or Next.js.
- Guided input wizard.
- Quick and advanced modes.
- CSV upload for interval data.
- Assumption editor.
- Scenario comparison.
- Graphs:
  - load before/after BESS;
  - SOC profile;
  - monthly savings;
  - annual cash flow;
  - sensitivity tornado chart.

### Calculation service

A stateless TypeScript or Python service containing:

- validation engine;
- tariff engine;
- dispatch engine;
- degradation engine;
- financial engine;
- report generator.

### Persistence

Store:

- customer/site;
- tariff version;
- input dataset;
- assumption set;
- calculation-engine version;
- scenario;
- result;
- audit log.

### API endpoints

```http
POST /api/v1/bess/evaluate
POST /api/v1/bess/simulate
POST /api/v1/bess/scenarios
POST /api/v1/bess/reports
GET  /api/v1/bess/calculations/{id}
GET  /api/v1/bess/calculations/{id}/audit
```

### Versioning requirement

Every result must contain:

- calculation engine version;
- tariff version;
- input-data checksum;
- timestamp;
- assumptions used;
- warning list.

---

## 12. Indicative API Request

```json
{
  "mode": "QUICK_ESTIMATE",
  "currency": "INR",
  "system": {
    "ratedPowerKw": 125,
    "ratedEnergyKwh": 261,
    "batteryChemistry": "LFP",
    "usableDodPct": 90,
    "minSocPct": 10,
    "maxSocPct": 100,
    "initialSocPct": 80,
    "reserveSocPct": 20,
    "chargeEfficiencyPct": 95,
    "dischargeEfficiencyPct": 95,
    "availabilityPct": 98,
    "auxiliaryLoadKw": 2,
    "annualDegradationPct": 2,
    "projectLifeYears": 10
  },
  "tariff": {
    "energyChargePerKwh": 9.5,
    "demandChargePerKvaMonth": 450,
    "contractDemandKva": 300,
    "billingDemandWindowMinutes": 15,
    "powerFactor": 0.95
  },
  "diesel": {
    "dgCapacityKva": 250,
    "dieselPricePerLitre": 92,
    "specificFuelConsumptionLitrePerKwh": 0.28
  },
  "financial": {
    "initialCapex": 4000000,
    "fixedAnnualOm": 200000,
    "annualOmEscalationPct": 5,
    "tariffEscalationPct": 4,
    "dieselEscalationPct": 5,
    "discountRatePct": 12
  }
}
```

---

## 13. User Interface Output

### Customer summary

- proposed BESS size;
- expected demand reduction;
- annual DG energy displaced;
- annual excess solar absorbed;
- annual gross savings;
- annual net savings;
- project cost;
- simple and discounted payback;
- NPV and IRR;
- carbon-emission reduction;
- confidence grade.

### Savings waterfall

```text
Demand-charge saving
+ Diesel-fuel saving
+ DG-maintenance saving
+ Solar self-consumption saving
+ Energy-arbitrage saving
- Lost export credit
- Charging energy cost
- Auxiliary consumption
- Degradation cost
- O&M
= Net annual benefit
```

### Confidence grade

- **A:** complete interval data and verified tariff.
- **B:** interval load data with estimated outage or solar profile.
- **C:** monthly data.
- **D:** customer-stated assumptions only.

The reference illustration would qualify as **Grade D**.

---

## 14. Acceptance Tests

### Physical constraints

1. BESS output never exceeds rated kW.
2. SOC never exceeds configured bounds.
3. charge and discharge do not occur simultaneously.
4. discharged energy cannot exceed stored energy.
5. interval energy equals power multiplied by interval duration.
6. reserve SOC is protected.
7. annual degradation reduces effective capacity correctly.

### Commercial constraints

8. demand saving uses kVA when tariff is in ₹/kVA.
9. demand saving cannot exceed the billable pre-BESS demand charge.
10. diesel saving cannot exceed base-case DG fuel cost.
11. solar benefit accounts for export credit.
12. grid-charging cost is deducted.
13. one unit of battery energy cannot be assigned to more than one use in an interval.
14. negative annual savings produce no payback result.
15. NPV matches an independently verified cash-flow calculation.

### Reference-case test

The image values may be reproduced in a dedicated **legacy illustration mode**, but the result must be marked:

> “Simplified arithmetic reproduction; not an engineering or investment-grade estimate.”

This prevents regression while keeping production logic accurate.

---

## 15. Recommended Development Phases

### Phase 1 – Defensible quick calculator

- structured inputs;
- units and validation;
- corrected usable-energy calculation;
- simple demand, diesel and solar modules;
- prevention of double counting using daily energy allocation;
- annual cash flow;
- scenario analysis;
- PDF/Excel-ready result object.

### Phase 2 – Interval simulation

- CSV import;
- tariff calendar;
- SOC simulation;
- peak-shaving dispatch;
- outage/DG dispatch;
- solar charging;
- charts and audit trail.

### Phase 3 – Optimisation and live integration

- mathematical optimisation;
- meter/EMS data integration;
- forecast-based control;
- ThingsBoard/SCADA integration;
- live savings verification;
- measurement and verification reports;
- battery warranty and degradation tracking.

---

## 16. Final Recommendation

Do not encode the image as a set of isolated formulas. Encode it as a **single constrained BESS dispatch and financial model**.

The image is valuable as a customer communication template, but its headline result—₹37.77 lakh annual savings on a ₹40 lakh system—should be treated as an unverified sales scenario. The coding implementation should make every assumption visible, prevent physical and commercial double counting, and produce a result whose confidence depends on the quality of the supplied data.

The strongest commercial workflow is:

\[
\text{Quick Estimate}
\rightarrow
\text{Interval Data Validation}
\rightarrow
\text{Engineering Simulation}
\rightarrow
\text{Investment Case}
\rightarrow
\text{Post-installation M\&V}
\]

This creates a calculator that can support both sales and technically credible project approval.
