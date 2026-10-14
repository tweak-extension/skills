# Contributing

Thanks for helping. A skill is prose an agent follows, so a one-word edit can change what the
agent does. That shapes how changes land here.

## Evals first

Following the platform's [authoring guidance](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
("Build evaluations first"): before you change the skill, add the eval case that shows the
problem, and watch it fail on the current text.

- **Every bug becomes a case.** When a real session goes wrong, add its prompt to
  `evals/cases/` with a check that names what went wrong. See
  [evals/README.md](evals/README.md#adding-a-case).
- **Prove the case measures something.** Run it on the unchanged skill several times before you
  trust it: `npm run eval -- --filter <id> --trials 5`. A case that fails one run in three on an
  unchanged skill is measuring noise.
- **Compare pass rates, not single runs.** The model is not deterministic:
  `npm run eval -- --ref main --out evals/results/main`, then
  `npm run eval -- --compare evals/results/main/summary.json`.
- Keep prose changes and moves apart: a pure move or rename should not change behaviour.

## Running things

Node from [`.nvmrc`](.nvmrc). There are no dependencies to install.

```bash
npm test               # the harness, the lint and the report, no model calls
npm run lint:skills    # the authoring checklist and the example rules
npm run pack           # dist/<skill>.zip, never committed
npm run eval           # the paid evals: needs the `claude` CLI and a key or login
```

If you have your own Anthropic API key (or a signed-in `claude` CLI), you can run the evals
locally. A full run is 51 cases × 3 trials, about $11 on Sonnet and 15 minutes. Keep
`--concurrency` at 4 or below.

## The `run-checks` label

The free checks (`ci`) run on every pull request. The paid evals run only when a maintainer
applies the **`run-checks`** label, and only a repository admin can apply it. Why:

- the evals spend a real API budget;
- they run the pull request's own cases and graders next to the API key, so a maintainer reviews
  the diff before labeling. The label approves that exact commit: a new push removes it.

Results arrive as a sticky comment with each case's pass rate next to `main`'s baseline. You
don't need to ask for the label on a docs-only change.

## License

Contributions are accepted under the [Apache License 2.0](LICENSE): by section 5 of that
license, anything you submit for inclusion is under the same terms, so there is no CLA to sign.
