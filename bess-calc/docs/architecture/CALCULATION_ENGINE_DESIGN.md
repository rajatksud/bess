# BESS Calculation Engine Design

## Objective

The calculation engine is the common foundation powering every layer of the BESS platform.

A simple free calculator and an engineering simulation must use the same underlying principles.

## Design Principles

- No isolated saving calculators.
- One battery energy balance.
- All benefits must respect physical constraints.
- Every result must be traceable to assumptions.

## Calculation Flow

```
Input Data
   |
Validation
   |
Normalisation
   |
Battery Simulation
   |
Savings Calculation
   |
Financial Analysis
   |
Report Generation
```

## Input Categories

### Site

- load profile;
- demand;
- power factor;
- operating hours.

### Tariff

- energy charges;
- demand charges;
- TOD periods;
- export credits.

### BESS

- power rating;
- energy capacity;
- SOC limits;
- efficiency;
- degradation.

### Financial

- CAPEX;
- OPEX;
- discount rate;
- escalation assumptions.

## Core Calculations

### Energy Balance

The engine tracks:

```
Load
+ Solar
+ Grid
+ DG
+ Battery
= Energy Balance
```

### Battery State

Track:

- SOC;
- charge energy;
- discharge energy;
- cycle count;
- degradation.

## Savings Modules

### Demand Reduction

Calculate reduction in billable demand using tariff rules.

### Diesel Avoidance

Calculate:

- avoided DG energy;
- fuel savings;
- maintenance savings.

### Solar Optimisation

Calculate increased self-consumption and avoided export.

### Arbitrage

Calculate time-of-use energy shifting.

## Outputs

Technical:

- peak reduction;
- energy throughput;
- cycles;
- SOC profile.

Financial:

- annual savings;
- NPV;
- IRR;
- payback;
- LCOS.

## Validation

The engine must prevent:

- impossible SOC values;
- excessive cycling;
- double counting benefits;
- unrealistic savings.
