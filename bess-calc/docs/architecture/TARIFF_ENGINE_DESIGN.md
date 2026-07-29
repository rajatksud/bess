# BESS Tariff Engine Design

## Objective

Create a flexible tariff modelling system that converts electricity billing structures into BESS optimisation inputs.

For C&I customers, tariff intelligence is a core differentiator.

## Tariff Components

### Energy Charges

- kWh charges;
- TOD rates;
- seasonal variations.

### Demand Charges

- maximum demand;
- billing window;
- contract demand;
- demand ratchet rules.

### Renewable Integration

- export credits;
- net metering;
- banking;
- open access settlement.

## Data Model

Tariff entity:

```
Utility
State
Consumer Category
Effective Date
Energy Charges
Demand Charges
TOD Rules
Export Rules
```

## India Focus

Initial database should support:

- state DISCOM tariffs;
- industrial HT consumers;
- solar plus storage economics;
- DG replacement economics.

## Calculation Role

The tariff engine provides:

- baseline bill;
- post-BESS bill;
- avoided cost;
- optimisation signals.

## Future Capability

Integrate:

- tariff database;
- automated regulatory updates;
- customer-specific billing models.
