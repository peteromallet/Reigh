# M3 — Scale, Deterministic Testing and Security

## Outcome

Keep extension interaction bounded and deterministic at production densities,
with comprehensive compatibility, accessibility-adjacent unit contracts,
performance budgets, failure recovery and a truthful trusted-code boundary.

## In scope

- Data-lane virtualization at 500/5,000/50,000 items with density summaries,
  keyboard selection and focus retention.
- `localTest=1` mode with no remote/auth noise and fail-closed diagnostics.
- Generated every-pair plus all-together extension compatibility matrix.
- Activation/renderer/command/disposal failure and recovery cases.
- Resource limits, cancellation, backpressure and degraded mode.
- Oversized payload, unsafe URL/injection, traversal and cross-project tests.

## Done criteria

- DOM, latency and memory budgets are executable release gates.
- Unexpected console/page errors fail deterministic E2E.
- Every pair and the full bundled set have deterministic lifecycle evidence.
