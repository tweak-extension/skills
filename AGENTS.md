# AGENTS.md - tweak Agent Skills

Agent Skills for [tweak](https://tweak-extension.com), the browser extension that intercepts a
page's requests. The repo root is also a Claude Code plugin (`tweak`) and its marketplace
(`tweak-extension`). Node only, **no dependencies**: keep it that way (`node:*` built-ins).

## Structure

```
skills/tweak-creating-rules/   THE ONLY THING SHIPPED: SKILL.md, reference/, scripts/validate-rules.mjs
evals/                         paid evals: run.mjs, cases/, lib/ (agent, fake tab, graders), README.md
scripts/lint-skills.mjs        static checks: the authoring checklist + example rules + validator ↔ schema
scripts/pack.mjs               skills/* → dist/<name>.zip (gitignored)
test/                          node:test suites for the harness, the lint and the report
.claude-plugin/                plugin.json + marketplace.json
.github/workflows/             ci.yml (free, every PR), evals.yml (run-checks), release.yml (v* tags)
```

## Definition of done

`npm test && npm run lint:skills` green, on Node from `.nvmrc`. A change to `SKILL.md`,
`reference/` or the description also needs an eval run compared against `main`
(`evals/README.md`, "Before and after an edit").

## Rules

- **Skill moves are behaviour-neutral.** A rename or move never rewrites prose; a prose fix is its
  own change with its own eval run.
- **The zip is never committed.** `npm run pack` builds it; releases attach it. A committed zip
  once went stale and kept shipping an old delivery flow.
- **Never commit** results, transcripts (`evals/results/`) or a key.
- **`rule.schema.json` is generated in tweak** from its `src/@schema`. A schema change lands here
  first (a PR carrying the regenerated file and the matching `validate-rules.mjs`), then tweak
  syncs. tweak keeps a byte-identical mirror of `skills/tweak-creating-rules/` for its contract
  tests (`pnpm run skills:sync`, pinned in its `agent-skills/SKILLS_REF`): **a mirror, not a fork**.
  Never edit the skill in tweak.
- Description budget is 320 characters (stricter than the platform's 1024): it is in every
  conversation's system prompt, loaded or not. `lint-skills.mjs` holds it.

## Eval invariants

- **Isolation or the run means nothing.** Each run is a fresh directory holding only the skill,
  with `--setting-sources project` (no installed user skills) and `--strict-mcp-config` (no MCP
  server but the fake tab). Every run fails if its init event lists more than one `tweak` skill:
  an installed older copy would answer instead of the one under test.
- **Graders are code, never a model's opinion.** A failed check names what regressed, and the
  summary counts failures by name. Text checks (`mentions`) stay loose: they catch a dropped
  instruction, not a reworded one.
- **Pass rate, not pass/fail.** Each case runs 3 trials and passes at ≥ 2/3. A new case runs 5
  times on the unchanged skill first; one that flakes there measures noise. Haiku is the noisy
  model: confirm a Haiku regression with `--trials 5` against `--ref` before changing anything.
- **Browser graders read the SDK call log, not the answer.** "Searched before create" is the
  order of calls in `lib/fake-tweak.mjs`'s log, not a sentence in the reply.
- **The fake enforces the skill's contract, not the extension's.** It refuses what
  `reference/browser.md` says tweak refuses and nothing more; fidelity to the real builder is
  tweak's contract tests' job. A change to `browser.md`'s API table or error codes means updating
  the fake too (`test/evals.test.mjs` runs every `browser.md` snippet in the fake tab). Its field
  vocabulary is imported from `validate-rules.mjs`, never copied.
- **Requests appear only after capture is on AND the page reloaded**, as in tweak: that makes
  "capture → reload → search" observable.
- **Concurrency ≤ 4.** Above that the fake tab's MCP connection drops (`CONNECTION_CLOSED` in the
  transcript) and those runs read as behaviour failures. Grep a red run's transcript for it first.
- Known leak: the scenario file is readable from the run directory (`.eval/scenario.json`).

## CI

- `ci.yml` is the required check: no secrets, read-only.
- `evals.yml` is a `pull_request_target` workflow with a secret: the trust boundary is the
  admin's review before applying `run-checks`, the SHA pin, and a spend-capped key. Read its
  header before changing it. Pin every action to a full commit SHA, declare `permissions:` at
  workflow and job level, keep `${{ }}` out of `run:` scripts (pass through `env:`), and run
  `actionlint` on any workflow change.
