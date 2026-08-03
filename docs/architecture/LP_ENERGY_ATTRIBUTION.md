# LP Energy Attribution Rule

Extends `OPTIMISATION_ENGINE_DESIGN.md` (Layer 2 — Linear Optimisation / Layer 3 — MILP).
Implemented in `bess-calc/src/optimisation/lpAttribution.ts`, tested in
`bess-calc/src/optimisation/__tests__/lpAttribution.test.ts`.

---

## 1. The problem this rule exists to solve

The rule-based dispatch engine (`src/engine/dispatchEngine.ts`) tags every interval with
exactly **one** `bessAction`. That tag is not cosmetic — **it is the mechanism that
enforces Rule 2 (no double counting)**. Because each interval belongs to one category,
every discharged kWh lands in exactly one avoided-cost bucket, and the savings formulas
can safely add the buckets together.

An LP has no such tag. It emits `dischargeKw`: a number chosen to minimise one scalar
objective, carrying no statement about *why*.

So the LP path could not produce a `SavingsBreakdown` at all without doing one of two
unacceptable things:

- **(a)** credit the same kWh to several categories — the exact double count Rule 2
  forbids, and the failure mode that makes a BESS business case look 30–40 % better than
  it is; or
- **(b)** invent a split with no physical justification.

This document defines the third option: a decomposition rule that is *derived from what
each kWh could physically have avoided*.

---

## 2. The rule

> For each interval `t`, the energy the optimiser discharged is consumed by categories in
> a **fixed cascade**, each step taking at most the quantity it could physically have
> avoided **in that interval**.

### Step 1 — Diesel / backup

```
cap = isOutage(t) ? load(t) · Δt : dgRequired(t) · Δt
```

During a grid outage there is no electricity bill to reduce, so avoided diesel is the
*only* value a discharged kWh can create. Outside an outage, only an explicitly running
generator can be displaced. **This cap is a physical fact, not a preference.**

### Step 2 — Peak shaving

```
cap = max(0, preBessGridImport(t) − achievedBillingPeakKw) · Δt      (non-outage only)
```

where `achievedBillingPeakKw` is the highest post-battery meter-side import the schedule
actually attains across the horizon.

**This is the load-bearing insight of the whole rule.** A demand charge is levied on
exactly one number: the billed peak. Energy discharged in an interval whose import was
*already below* the finally-billed peak moved that number by exactly zero. It created
zero demand-charge value, and must therefore be credited with none. Only the area above
the final peak line was responsible for the reduction.

Outage intervals are excluded because an unmetered interval cannot set or reduce a demand
charge.

### Step 3 — Arbitrage

The residual, monetised at the energy rate.

### Charge side

Charge is attributed to **surplus solar first** (`max(0, solar(t) − load(t))`), remainder
to the grid — identical to the rule-based engine's own solar-first attribution. Grid
charging by a cost-minimising optimiser is arbitrage charge in full: buying energy is the
only reason such an optimiser would ever pay to charge.

---

## 3. Why it satisfies Rule 2

**Exhaustive.** Step 3 absorbs whatever steps 1–2 did not claim, so nothing is dropped.

**Mutually exclusive.** A cascade consumes each kWh once; `remaining` strictly decreases.

Therefore:

```
dgDisplacedKwh + peakShavingKwh + arbitrageDischargeKwh ≡ totalDischargedKwh
```

by construction. That is exactly the invariant
`savingsAggregator.attributionViolations()` checks, and it is asserted on the LP path in
`lpAttribution.test.ts` — including on real solver output, not only on hand-built
schedules.

Critically, the demand-charge **saving** is still computed from the peak delta
(`peakBefore` vs `peakAfter`) in `savingsAggregator`, exactly as on the rule-based path.
The attribution only decides how much energy remains *eligible to be monetised again* as
arbitrage. **That is the mechanism that stops a single kWh earning both a demand credit
and an energy credit.**

---

## 4. What this rule explicitly does NOT claim

- **It does not claim the optimiser "intended" these categories.** An LP has no intent,
  only an objective function. This is an *ex-post decomposition of realised value*.
- **It is not unique.** Other defensible decompositions exist (see §5). It is chosen for
  three properties: the parts sum to the whole, no part is counted twice, and the cascade
  order matches the rule-based engine's default priority list — so the two paths agree
  about which category a given kWh belongs to whenever they dispatch the same energy.
- **A single interval can split across categories.** `bessAction` is a single string and
  cannot express that. On the LP path the tag names the largest contributor and is
  suffixed `(mixed)`; **the authoritative split is the `DispatchAttribution` record**, and
  the count of mixed intervals is surfaced in the result's `assumptions`.

---

## 5. Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| **Pro-rata by category savings value** | Every kWh gets a slice of every category. Sums correctly but is physically meaningless — it credits demand-charge value to energy discharged at 3 a.m. when the peak is at 7 p.m. |
| **Shadow prices / LP duals** | Theoretically attractive: the dual on each constraint is a genuine marginal value. Rejected because `javascript-lp-solver` does not expose duals, and because MILP duals are not well-defined in the presence of the `isCharging` binary. Revisit if the solver is ever replaced with one exposing a proper LP relaxation. |
| **Re-run the heuristic and copy its tags** | The two schedules differ; tags from one schedule do not describe the other. Would produce attribution that does not sum to the LP's own throughput. |
| **Attribute everything to arbitrage** | Sums correctly and never double counts, but throws away all demand-charge and diesel value, understating the case as badly as double counting overstates it. |
| **Cap peak shaving at `preBessGridImport − targetPeakKw`** (the heuristic's own target) | `targetPeakKw` is a heuristic construct the LP never sees and is not obliged to hit. Using it would credit peak-shaving value for a peak reduction that did not occur. The *achieved* peak is the only defensible line. |

---

## 6. Honest limitations

1. **Order dependence is a modelling choice, not a derivation.** Diesel before peak
   before arbitrage matches the product's default priority list and the relative value of
   the three streams in the target market (Indian C&I, where diesel is the most expensive
   avoided cost per kWh). A site with an unusually high demand charge and cheap diesel
   could argue for a different order. The order is a single constant in the cascade and is
   easy to make configurable — deliberately not done here, because a configurable
   attribution order invites tuning the attribution until the business case looks good.

2. **The billing peak is horizon-scoped.** `achievedBillingPeakKw` is the peak within the
   simulated horizon. If the horizon is shorter than the billing period, the real billed
   peak may be set outside it — `OptimisedDispatchResult.demandChargeScopeNote` already
   warns about this and is carried through into `DispatchDiagnostics`.

3. **Only the discharge side is a genuine cascade.** The charge side is a simple
   solar-then-grid split, which is unambiguous because the physical source is determined
   by what solar was actually available.

4. **This does not make the LP path production-ready end to end.** It makes the LP path
   *expressible* in the same financial terms as the rule-based path. The LP itself still
   optimises grid energy cost plus an optional demand-charge term — it does not optimise
   diesel displacement or solar self-consumption value, so it will not *choose* dispatch
   that maximises those streams even though its output is now correctly credited for
   them. Extending the LP objective to cover all five value streams is a separate,
   larger piece of work.

---

## 7. Status

| Item | State |
|---|---|
| Attribution rule defined and documented | Done |
| Implemented (`lpAttribution.ts`) | Done |
| Rule 2 proven on the LP path by test | Done — including on real solver output |
| LP path produces a full `SavingsBreakdown`/`TechnicalResult` | Done, via the shared `savingsAggregator` |
| Both layers behind one `DispatchOptimizer` interface | Done (`optimizers.ts`) |
| LP objective covers all five value streams | **Not done** — see limitation 4 |
| LP path wired into the persisted simulation pipeline | **Not done** — `POST /simulations` still runs the rule-based engine only |
| MILP / MPC / AI layers | **Not implemented.** Deliberately absent from the optimiser registry rather than stubbed: an entry there is a claim that the layer works. |
