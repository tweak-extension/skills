# Contributing

Thanks for helping. A skill is prose an agent follows, so a one-word edit can change what the
agent does. That shapes how changes land here.

## You never pay for evals

**You don't need an API key, and you never run the paid evals on your own budget.** Open your pull
request with the free checks green (`npm test && npm run lint:skills`). If a maintainer decides to
take the change forward, they review it and run the evals on CI, at the project's expense, by
applying the `run-checks` label. The results arrive as a comment on your pull request.

## Evals first

Following the platform's [authoring guidance](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
("Build evaluations first"), a change to the skill comes with the eval case that shows the problem.
Write the case; the maintainer's CI run proves it fails on the current text and passes on yours.

- **Every bug becomes a case.** When a real session goes wrong, add its prompt to
  `evals/cases/` with a check that names what went wrong. See
  [evals/README.md](evals/README.md#adding-a-case). `npm test` checks that every case loads and
  grades without a model.
- **A case must measure something.** Before trusting a new case, the maintainer runs it several
  times on the unchanged skill (`--filter <id> --trials 5`): one that fails one run in three on an
  unchanged skill is measuring noise.
- **Pass rates, not single runs.** The model is not deterministic, so CI compares each case's pass
  rate with `main`'s.
- Keep prose changes and moves apart: a pure move or rename should not change behaviour.

## Running things

Node from [`.nvmrc`](.nvmrc). There are no dependencies to install.

```bash
npm test               # the harness, the lint and the report, no model calls
npm run lint:skills    # the authoring checklist and the example rules
npm run pack           # dist/<skill>.zip, never committed
```

`npm run eval` runs the paid evals locally (it needs the `claude` CLI and a key). It's there for
maintainers; contributors don't need it.

## The `run-checks` label

The free checks (`ci`) run on every pull request. The paid evals run only when a repository admin
applies the **`run-checks`** label, because:

- they spend the project's API budget;
- they run the pull request's own cases and graders next to the API key, so the maintainer
  reviews the diff first. The label approves that exact commit: a new push removes it, and a
  maintainer re-applies it.

Docs-only changes never need it.

## License

Contributions are accepted under the [Apache License 2.0](LICENSE): by section 5 of that
license, anything you submit for inclusion is under the same terms, so there is no CLA to sign.
