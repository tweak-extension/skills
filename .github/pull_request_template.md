## What and why

<!-- What changes, and the session or bug that prompted it. -->

## Evals

<!-- For a change to SKILL.md, reference/ or the description: -->

- [ ] A case in `evals/cases/` shows the problem (or this change has no behavioural effect)
- [ ] `npm test && npm run lint:skills` pass locally

You don't run the paid evals: if a maintainer takes the change forward, they apply `run-checks`
and CI runs them at the project's expense. Results arrive as a comment; a new push removes the label.
