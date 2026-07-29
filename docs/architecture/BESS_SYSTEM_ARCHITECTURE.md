# BESS System Architecture

## Purpose

Define the technical architecture for a next-generation BESS platform that evolves from a simple calculator into an engineering-grade simulation and optimisation platform.

## Architectural Principles

1. Progressive complexity: simple user experience with increasing engineering depth.
2. Common calculation foundation across all product layers.
3. Separation of planning, simulation and operational optimisation.
4. API-first design.
5. Auditability of every calculation.

## High-Level Architecture

```
Frontend Applications
        |
        v
API Gateway
        |
        +----------------+
        | Domain Services |
        +----------------+
        |
Calculation Engine
Simulation Engine
Optimisation Engine
Financial Engine
Battery Model Engine
Tariff Engine
        |
        v
Data Platform
(PostgreSQL + Time Series Storage)
```

## Core Services

### Calculation Engine

Responsible for:
- energy balance calculations;
- savings calculations;
- battery constraints;
- scenario execution.

### Simulation Engine

Responsible for:
- interval based simulation;
- load profiles;
- solar generation;
- DG operation;
- grid interaction.

Supported resolutions:
- hourly;
- 15 minute;
- 5 minute;
- real time.

### Optimisation Engine

Progression:

Level 1: Rule based dispatch

Level 2: LP/MILP optimisation

Level 3: MPC based control

Level 4: AI assisted optimisation

### Financial Engine

Calculates:
- CAPEX;
- OPEX;
- lifecycle cost;
- NPV;
- IRR;
- LCOS.

### Battery Model Engine

Progression:

Level 1:
Simple degradation assumptions.

Level 2:
Cycle and calendar ageing models.

Level 3:
Physics based digital twin models.

## Data Architecture

Core entities:

- Customer
- Site
- Load Profile
- Tariff
- BESS Asset
- Battery Model
- Scenario
- Simulation Run
- Financial Model
- Optimisation Result

## Technology Direction

Frontend:
React / Next.js

Backend:
Python services for scientific computing and optimisation.

Database:
PostgreSQL with time-series capability.

## Future Integration

The architecture supports:

- SCADA integration;
- Modbus;
- IEC 61850;
- EMS controllers;
- IoT gateways;
- live performance monitoring.
