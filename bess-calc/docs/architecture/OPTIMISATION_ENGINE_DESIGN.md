# BESS Optimisation Engine Design

## Objective

Define the progression from simple dispatch rules to advanced autonomous optimisation.

## Optimisation Layers

## Layer 1 — Rule Based Dispatch

Purpose:

Fast commercial calculations.

Examples:

- discharge during peak demand;
- charge from solar surplus;
- preserve backup reserve.

Advantages:

- transparent;
- easy to validate.

## Layer 2 — Linear Optimisation

Use for:

- tariff optimisation;
- simple dispatch scheduling.

## Layer 3 — MILP Optimisation

Use for:

- optimal BESS sizing;
- investment decisions;
- multiple operating constraints.

Variables:

- charge power;
- discharge power;
- SOC;
- installation size.

Constraints:

- inverter limits;
- battery capacity;
- tariff rules;
- operating requirements.

## Layer 4 — Model Predictive Control

Use for operational optimisation.

Inputs:

- load forecast;
- solar forecast;
- tariff forecast;
- SOC.

The controller repeatedly optimises a rolling time horizon.

## Layer 5 — AI Optimisation

Future capability:

- market bidding;
- portfolio optimisation;
- adaptive control.

## Recommended Implementation

Initial release:

Rule engine + LP/MILP framework.

Future:

MPC service integrated with live EMS data.

## Open Source Candidates

- Pyomo
- PyPSA
- OR-Tools
- CasADi

These should be evaluated before custom optimisation development.
