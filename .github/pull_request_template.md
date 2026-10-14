## What and why

<!-- What changes, and the session or bug that prompted it. -->

## Evals

<!-- For a change to SKILL.md, reference/ or the description: -->

- [ ] A case in `evals/cases/` shows the problem (or this change has no behavioural effect)
- [ ] The new case ran `--trials 5` on the unchanged skill, and fails or flakes there as expected
- [ ] `npm test && npm run lint:skills` pass locally

A maintainer applies `run-checks` after reviewing the diff to run the paid evals; results arrive
as a comment. A new push removes the label.
