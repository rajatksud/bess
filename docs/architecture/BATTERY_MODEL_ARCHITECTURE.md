# Battery Model Architecture

## Objective

Define the progressive battery modelling strategy from commercial calculator to digital twin.

## Modelling Philosophy

The model complexity should increase only when required by the use case.

## Level 1 — Commercial Model

Purpose:
Free and proposal calculators.

Includes:

- rated energy;
- usable SOC range;
- efficiency;
- annual degradation.

## Level 2 — Engineering Model

Includes:

- cycle ageing;
- calendar ageing;
- depth of discharge impact;
- C-rate impact;
- temperature effects.

Used for:

- investment cases;
- warranty assessment.

## Level 3 — Digital Twin

Includes:

- electrochemical models;
- thermal models;
- detailed ageing prediction.

Potential technologies:

- PyBaMM;
- BattMo.

## Required Parameters

Battery:

- chemistry;
- capacity;
- power rating;
- SOC limits;
- efficiency.

Ageing:

- cycle life;
- calendar life;
- temperature profile;
- degradation curves.

## Integration

Battery models must provide:

- available capacity;
- degradation cost;
- operational constraints.

The optimisation engine uses these outputs to maximise lifecycle value.
