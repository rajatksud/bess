# BESS Platform Product Strategy

## From Simple Energy Savings Calculator to Intelligent Energy Storage Digital Twin

## Vision

Build the most accessible and trusted platform for evaluating, designing, optimising and operating Battery Energy Storage Systems (BESS).

The platform follows an onion architecture:

```
Free Assessment
        ↓
C&I Savings Calculator
        ↓
Professional BESS Designer
        ↓
Investment Grade Simulation
        ↓
Engineering Digital Twin
        ↓
Autonomous Energy Optimisation Platform
```

## Product Philosophy

Users should receive value immediately while the underlying platform progressively adds engineering depth.

A user may start with simple inputs:
- electricity bill
- demand information
- solar capacity
- diesel usage

and progressively move to:
- interval simulation
- tariff optimisation
- battery degradation modelling
- lifecycle financial analysis
- real-time EMS optimisation

## Product Layers

### Layer 1 — Free BESS Assessment

Purpose: adoption and lead generation.

Provides:
- indicative BESS sizing
- estimated savings
- payback estimate
- carbon reduction

### Layer 2 — C&I Savings Calculator

Adds:
- load profile upload
- demand charge analysis
- diesel displacement
- solar optimisation

### Layer 3 — Professional BESS Designer

Adds:
- system sizing
- scenarios
- CAPEX/OPEX modelling
- NPV
- IRR
- LCOS

### Layer 4 — Professional Energy Platform

Adds:
- multi-site management
- asset database
- tariff database
- reporting
- measurement and verification

### Layer 5 — Engineering Digital Twin

Adds:
- time-series simulation
- battery degradation models
- optimisation engines
- EMS integration
- MPC-based dispatch

## Technology Direction

The platform should use a common calculation foundation:

```
Frontend
   |
API Layer
   |
Calculation Engine
   |
Simulation Engine
   |
Optimisation Engine
   |
Financial Engine
   |
Battery Model Engine
```

Recommended ecosystem:
- Python optimisation and scientific computing
- React frontend
- PostgreSQL/time-series storage
- API-first architecture

## Development Roadmap

Phase 1: Free assessment and market adoption.

Phase 2: Commercial C&I proposal calculator.

Phase 3: Professional BESS design platform.

Phase 4: Engineering simulation and investment-grade modelling.

Phase 5: Digital twin and operational optimisation.

## Strategic Differentiation

The platform differentiates through:

1. Simplicity — anyone can start.
2. India-specific intelligence — tariffs, DG economics and industrial use cases.
3. Engineering credibility — progressive depth from calculator to simulation.
4. Lifecycle value — optimise storage performance over its complete life.

## North Star

This is not only a calculator. It is a platform that evolves from helping customers answer:

"Is BESS worth considering?"

into answering:

"How should my battery operate every 15 minutes for the next 20 years to maximise value?"
