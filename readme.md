# BESS Calculator

A layered battery energy storage system (BESS) design and decision-support platform, progressing from a simple, accessible calculator to engineering-grade optimisation and simulation.

## Product direction

The platform will develop in successive layers:

1. **Quick calculator** — fast, easy-to-use sizing and indicative economics for early decisions.
2. **Project designer** — configurable load, tariff, renewable generation, application, and battery assumptions.
3. **Engineering design** — detailed electrical, thermal, degradation, safety, and balance-of-system calculations.
4. **Optimisation and simulation** — time-series dispatch, multi-objective optimisation, uncertainty analysis, and bankable outputs.

Each layer should remain useful on its own while exposing more control, traceability, and analytical depth to advanced users.

## Design principles

- Transparent calculations and assumptions
- Explicit units, boundaries, and data provenance
- Reproducible scenarios and versioned results
- Technology- and vendor-neutral core models
- Progressive disclosure of advanced inputs
- Validation against standards, research, and field evidence
- Clear separation between indicative results and engineering conclusions

## Repository status

The repository is being bootstrapped. Architecture, data models, calculation specifications, validation datasets, and the implementation stack will be documented before production code is introduced.

## Contribution workflow

Use short-lived branches and pull requests. Calculation changes should include:

- the governing equation or algorithm;
- units and accepted input ranges;
- assumptions and exclusions;
- validation cases and tolerances;
- references or source provenance; and
- tests covering nominal, boundary, and failure conditions.

## Disclaimer

Outputs are decision-support estimates unless explicitly validated and certified for a defined engineering use case. They do not replace project-specific design review, safety assessment, or professional engineering approval.
