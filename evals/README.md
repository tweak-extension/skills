# Evals for `tweak-creating-rules`

The skill is prose an agent follows, so a one-word edit can change what it does. These evals run
the real agent against the skill and grade what it did, so an edit that regresses behaviour
fails before it ships.

## Four layers

| Layer       | What                                                                                     | Where                                    | Runs                       |
| ----------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------- |
| 1. Static   | frontmatter, size, links, contents tables, the authoring checklist                       | `scripts/lint-skills.mjs`                | `npm run lint:skills`, every PR |
| 2. Contract | every example passes `validate-rules.mjs`, which agrees with `rule.schema.json`          | `scripts/lint-skills.mjs`                | `npm run lint:skills`, every PR |
|             | ...and `window.tweak`'s builder and the import page (needs the extension)                | tweak's `src/__tests__/agent-skills.test.js` | tweak's `pnpm test`     |
| 3. Trigger  | the description routes: asks that must load the skill, near misses that must not         | `cases/triggers.mjs`                     | `npm run eval`, `run-checks` |
| 4. Behaviour| the agent delivers the right rule, the right way, in a file and in a browser             | `cases/file.mjs`, `cases/browser.mjs`    | `npm run eval`, `run-checks` |

Layers 1 and 2 are free and deterministic. Layers 3 and 4 call a model and cost money. Run them
when you change the skill (`SKILL.md`, `reference/`, the description), not on every commit. The
harness itself is unit tested without a model (`test/evals.test.mjs`, in `npm test`).

## Running

Needs the `claude` CLI on the PATH, signed in or with `ANTHROPIC_API_KEY` set. Keep
`--concurrency` at 4 or below: around 12 concurrent agents the fake tab's MCP connection starts
dropping (`CONNECTION_CLOSED` in the transcript), and those runs read as behaviour failures.

```bash
npm run eval                                            # every case, 3 trials each
npm run eval -- --filter browser                        # ids or tags containing "browser"
npm run eval -- --filter trigger --trials 5
npm run eval -- --mode file --model claude-opus-5-5     # default model is claude-sonnet-5-5
npm run eval -- --list                                  # what would run, no model calls
```

Results go to `evals/results/<timestamp>/` (gitignored; `--out` to choose):

- `summary.json`: pass rate per case, failed checks counted by name, models, cost, duration,
  and how many runs lost the fake tab (`connectionClosed`).
- `runs.jsonl`: one line per run.
- `transcripts/<case>-<trial>.jsonl`: the CLI's full stream-json. Read this when a check fails.

The command exits 1 when any case passes fewer than two thirds of its trials
(`--min-pass-rate`, or `minPassRate` on a case).

### Before and after an edit

The model is not deterministic, so "it passed once" proves little. Compare pass rates against
the skill as it was:

```bash
npm run eval -- --ref main --out evals/results/main
npm run eval -- --compare evals/results/main/summary.json
```

`--ref` evaluates the skill from any git ref of this repository with the current cases and
graders (`LEGACY_SKILL_PATHS` in `run.mjs` lists older paths, should the skill move). The
skill's history before this repository lives in tweak's: to evaluate a copy from there, check it
out and pass its directory with `--skill <dir>`. The report prints each case's previous pass rate
next to the new one.

### Reporting on a finished run

`--summary` reads a `summary.json` instead of running anything, so it costs nothing:

```bash
node evals/run.mjs --summary evals/results/pr/summary.json \
  --compare evals/results/main/summary.json --report-md report.md
```

`--report-md` (also on a normal run) writes the markdown the CI posts as the pull request's
sticky comment: the verdict, each case's pass rate next to the baseline (failures first), the
failed checks counted by name, model, trials, cost and duration, and a warning when a run lost
the fake tab.

## In CI

`.github/workflows/evals.yml` runs the full suite (Sonnet, 3 trials) on a pull request when an
admin applies the `run-checks` label. It never runs on a push or merge to `main`. A new push to
the pull request removes the label: the approval is for one commit. `workflow_dispatch` runs
another model or a subset; run on `main` with default inputs, it produces the baseline PRs are
compared against (`skill-evals-baseline`, kept 90 days). The workflow's header explains the trust boundary.

## How a run works

`lib/agent.mjs` creates a fresh directory holding only the skill (`.claude/skills/tweak-creating-rules`)
and runs `claude -p` in it:

- **`--setting-sources project`**: your own installed skills do not load. An installed older
  copy of the skill (under this name or an old one, `creating-tweak-rules` or `tweak-rules`) would otherwise answer instead of the one under test. Every run checks
  for this (`only the skill under test is loaded`).
- **`--strict-mcp-config`**: no MCP server loads except the fake tab.
- **No web access**, and a fixed turn budget per mode.

The three modes:

- **`trigger`**: stops after two turns. The only question is whether the skill loaded.
- **`file`**: no browser, so the skill must hand over JSON and the import page link. Graded on
  `tweak-rules.json`, or on the last rule JSON block in the answer when no file was written.
  Every rule must pass `validate-rules.mjs`. A case with `devtools: true` also gets a fake Chrome DevTools MCP
  server (`lib/devtools-server.mjs`): a browser of the agent's own, without tweak, that it must
  not open.
- **`browser`**: an MCP server (`lib/page-server.mjs`) exposes `run_page_script`, standing in
  for Claude in Chrome. The tab's `window.__TWEAK_SDK__` is `lib/fake-tweak.mjs`, scripted by
  the case's `scenario`: plan, run and capture state, existing rules, captured requests,
  version, and a forced first-create error. Every SDK call is logged, so graders check what the
  agent did, not what it said it did.

The fake tweak enforces the skill's contract (`browser.md`) and nothing more. Whether the real
extension accepts the skill's examples is layer 2's job.

## Adding a case

Every bug becomes a case. When a real session goes wrong, add its prompt and a check that
names what went wrong.

```js
// cases/browser.mjs
{
  id: 'browser-graphql-one-operation',      // unique; filters match ids and tags
  mode: 'browser',                          // 'trigger' | 'file' | 'browser'
  tags: ['mock', 'graphql'],
  prompt: 'Use tweak to make the getCart query fail with a 500.',
  scenario: shop({ requests: [...] }),      // browser only: the fake tab
  files: { 'schema.graphql': '...' },       // optional: seeded into the project directory
  devtools: true,                           // optional, file mode: a fake Chrome DevTools MCP is installed and allowed
  minPassRate: 1,                           // optional: stricter than the default 2/3
  grade: (run, { check }) => {
    check('a PARTIAL body match', createdRules(run)[0]?.requestPayloadMatchPolicy === 'PARTIAL')
  },
}
```

Graders are code. `lib/grade.mjs` has the helpers: `createdRules`, `calls`, `firstCall`,
`deliveredRules`, `validateDelivered`, `payload` and `mentions`. Give each check a name that
says what regressed, because the summary counts failures by name. Pass a third argument (the
actual value) so the failure shows it. Keep a text check (`mentions`) loose: it is there to
catch a missing instruction, not to pin wording.

Run the new case on its own a few times (`--filter <id> --trials 5`) before you rely on it. A
case that fails one run in three on an unchanged skill is measuring noise.
