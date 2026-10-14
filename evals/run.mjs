#!/usr/bin/env node
/*
 * Behavioural and triggering evals for skills/tweak-creating-rules. Each case runs the Claude Code
 * CLI headless against the skill, several times, and is graded by code. See README.md.
 *
 *   npm run eval                                  # every case, 3 trials each
 *   npm run eval -- --filter browser --trials 5
 *   npm run eval -- --ref main --out evals/results/main   # the skill as it is on main
 *   npm run eval -- --compare evals/results/main/summary.json
 *   npm run eval -- --list
 *   node evals/run.mjs --summary pr/summary.json --compare main/summary.json --report-md report.md
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { runCase } from './lib/agent.mjs'
import { createChecker } from './lib/grade.mjs'
import browserCases from './cases/browser.mjs'
import fileCases from './cases/file.mjs'
import triggerCases from './cases/triggers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const SKILL_PATH = 'skills/tweak-creating-rules'
// where the skill lived before a move or rename, so `--ref` still reaches a commit from then. Empty:
// this repository's history starts at skills/tweak-creating-rules (earlier history is in tweak's repo).
const LEGACY_SKILL_PATHS = []
// the fake tab's MCP connection dropping: such a run reads as a behaviour failure (README.md)
export const CONNECTION_CLOSED = 'CONNECTION_CLOSED'

export const CASES = [...triggerCases, ...fileCases, ...browserCases]
// a case passes when at least this share of its trials passed every check
export const DEFAULT_MIN_PASS_RATE = 2 / 3

/** Grades one run: the case's own checks plus the ones every non-trigger run must pass. */
export function grade(testCase, run) {
  const { check, results } = createChecker()
  if (run.error) {
    check('agent produced a result', false, run.error)
  } else {
    // an installed copy of the skill would answer instead of this one, and the run means nothing
    check(
      'only the skill under test is loaded',
      run.skillsLoaded.filter((name) => /tweak/.test(name)).length === 1,
      run.skillsLoaded,
    )
    if (testCase.mode !== 'trigger') {
      check('skill invoked', run.skillInvoked)
      check('finished within its turn budget', run.stopReason === 'success', run.stopReason)
    }
    try {
      testCase.grade(run, { check })
    } catch (error) {
      check('grader ran', false, error.message)
    }
  }
  return { pass: results.every((result) => result.pass), checks: results }
}

/** Per-case pass rates from graded runs. */
export function summarize(graded, minPassRate = DEFAULT_MIN_PASS_RATE) {
  const cases = {}
  graded.forEach(({ testCase, pass, checks }) => {
    const entry = (cases[testCase.id] ??= {
      mode: testCase.mode,
      passes: 0,
      trials: 0,
      minPassRate: testCase.minPassRate ?? minPassRate,
      failedChecks: {},
    })
    entry.trials += 1
    entry.passes += pass ? 1 : 0
    checks
      .filter((result) => !result.pass)
      .forEach(({ name }) => {
        entry.failedChecks[name] = (entry.failedChecks[name] ?? 0) + 1
      })
  })
  Object.values(cases).forEach((entry) => {
    entry.passRate = entry.passes / entry.trials
    entry.ok = entry.passRate >= entry.minPassRate - 1e-9
  })
  return cases
}

function selectCases({ filter, mode }) {
  const needles = (filter ?? '').split(',').filter(Boolean)
  return CASES.filter((testCase) => !mode || testCase.mode === mode).filter(
    (testCase) =>
      !needles.length || needles.some((needle) => testCase.id.includes(needle) || testCase.tags?.includes(needle)),
  )
}

/** The skill directory to evaluate: the working tree, another directory, or a git ref's copy. */
function resolveSkill({ ref, skill }) {
  if (skill) {
    return path.resolve(skill)
  }
  if (!ref) {
    return path.join(REPO, SKILL_PATH)
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'skill-ref-'))
  const at = [SKILL_PATH, ...LEGACY_SKILL_PATHS].find((candidate) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${ref}:${candidate}`], { cwd: REPO, stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })
  if (!at) {
    throw new Error(`no skill at ${ref}: looked for ${[SKILL_PATH, ...LEGACY_SKILL_PATHS].join(', ')}`)
  }
  const archive = execFileSync('git', ['archive', '--format=tar', ref, at], { cwd: REPO, maxBuffer: 64 << 20 })
  execFileSync('tar', ['-x', '-C', dir], { input: archive })
  return path.join(dir, at)
}

async function pool(items, size, worker) {
  let next = 0
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      await worker(items[index], index)
    }
  })
  await Promise.all(lanes)
}

const percent = (value) => `${Math.round(value * 100)}%`.padStart(4)

function report(cases, baseline) {
  const rows = Object.entries(cases).map(([id, entry]) => {
    const before = baseline?.cases?.[id]
    const delta = before ? ` (was ${percent(before.passRate).trim()})` : ''
    const failed = Object.entries(entry.failedChecks)
      .map(([name, count]) => `${name} ×${count}`)
      .join('; ')
    return `${entry.ok ? 'PASS' : 'FAIL'} ${percent(entry.passRate)} ${entry.passes}/${entry.trials}  ${id}${delta}${failed ? `\n            ${failed}` : ''}`
  })
  return rows.join('\n')
}

export const REPORT_MARKER = '<!-- skill-evals-report -->'

const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const minutes = (ms) => (ms ? `${Math.round(ms / 60000)} min` : 'n/a')

/**
 * The pull request comment for one run: the verdict, each case's pass rate next to the
 * baseline's (failures first), the failed checks counted by name, and what the run cost.
 */
export function reportMarkdown(summary, baseline, { sha, artifactUrl } = {}) {
  const entries = Object.entries(summary.cases).sort(
    ([idA, a], [idB, b]) => Number(a.ok) - Number(b.ok) || a.passRate - b.passRate || idA.localeCompare(idB),
  )
  const ok = summary.failed === 0
  const lines = [
    REPORT_MARKER,
    `## ${ok ? '✅' : '❌'} Skill evals: ${summary.passed}/${summary.passed + summary.failed} cases passed`,
    '',
  ]
  if (summary.connectionClosed) {
    lines.push(
      `> [!WARNING]`,
      `> ${summary.connectionClosed} run(s) lost the fake tab's MCP connection (\`${CONNECTION_CLOSED}\` in the transcript). ` +
        'They read as behaviour failures: check those transcripts before trusting a red case.',
      '',
    )
  }
  lines.push('| | Case | Mode | Pass rate | Baseline | Failed checks |', '| --- | --- | --- | --- | --- | --- |')
  entries.forEach(([id, entry]) => {
    const before = baseline?.cases?.[id]
    const failed = Object.entries(entry.failedChecks)
      .map(([name, count]) => `${cell(name)} ×${count}`)
      .join('<br>')
    lines.push(
      `| ${entry.ok ? '✅' : '❌'} | \`${id}\` | ${entry.mode} | ${entry.passes}/${entry.trials} (${percent(entry.passRate).trim()}) | ${
        before ? `${before.passes}/${before.trials} (${percent(before.passRate).trim()})` : '—'
      } | ${failed || ''} |`,
    )
  })
  const counted = {}
  Object.values(summary.cases).forEach((entry) =>
    Object.entries(entry.failedChecks).forEach(([name, count]) => {
      counted[name] = (counted[name] ?? 0) + count
    }),
  )
  const byCount = Object.entries(counted).sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
  if (byCount.length) {
    lines.push('', '<details><summary>Failed checks, counted by name</summary>', '')
    lines.push('| Check | Failures |', '| --- | --- |')
    byCount.forEach(([name, count]) => lines.push(`| ${cell(name)} | ${count} |`))
    lines.push('', '</details>')
  }
  lines.push(
    '',
    `- **Model:** ${summary.models.join(', ') || 'n/a'} · **Trials:** ${summary.trials} · **Cost:** $${summary.costUsd} · ` +
      `**Duration:** ${minutes(summary.durationMs)}`,
    `- **Head:** ${sha ?? summary.commit}` +
      (baseline ? ` · **Baseline:** ${baseline.commit} (${baseline.date?.slice(0, 10) ?? 'unknown date'})` : ' · **Baseline:** none yet'),
  )
  if (artifactUrl) {
    lines.push(`- **Transcripts:** [results artifact](${artifactUrl})`)
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const { values } = parseArgs({
    // `npm run eval -- --filter x` can hand the script a literal `--`
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      filter: { type: 'string' },
      mode: { type: 'string' },
      trials: { type: 'string', default: '3' },
      concurrency: { type: 'string', default: '4' },
      model: { type: 'string', default: 'claude-sonnet-5-5' },
      ref: { type: 'string' },
      skill: { type: 'string' },
      budget: { type: 'string', default: '2' },
      timeout: { type: 'string', default: '600' },
      'min-pass-rate': { type: 'string' },
      compare: { type: 'string' },
      out: { type: 'string' },
      // report on an existing run instead of running: no model calls
      summary: { type: 'string' },
      'report-md': { type: 'string' },
      sha: { type: 'string' },
      'artifact-url': { type: 'string' },
      list: { type: 'boolean', default: false },
    },
  })
  const baseline =
    values.compare && existsSync(values.compare) ? JSON.parse(readFileSync(values.compare, 'utf8')) : null
  const writeReport = (summary) => {
    if (values['report-md']) {
      writeFileSync(
        values['report-md'],
        reportMarkdown(summary, baseline, { sha: values.sha, artifactUrl: values['artifact-url'] }),
      )
    }
  }
  if (values.summary) {
    const summary = JSON.parse(readFileSync(values.summary, 'utf8'))
    console.log(`${report(summary.cases, baseline)}\n`)
    writeReport(summary)
    process.exit(summary.failed ? 1 : 0)
  }

  const selected = selectCases(values)
  if (values.list || !selected.length) {
    selected.forEach((testCase) =>
      console.log(`${testCase.mode.padEnd(8)} ${testCase.id}  [${(testCase.tags ?? []).join(', ')}]`),
    )
    if (!selected.length) {
      console.error('no case matches')
      process.exit(1)
    }
    return
  }

  const skillDir = resolveSkill(values)
  const trials = Number(values.trials)
  if (!Number.isInteger(trials) || trials < 1) {
    throw new Error(`--trials must be a whole number of at least 1, got ${values.trials}`)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = path.resolve(values.out ?? path.join(HERE, 'results', stamp))
  mkdirSync(path.join(out, 'transcripts'), { recursive: true })
  const started = Date.now()
  const jobs = selected.flatMap((testCase) => Array.from({ length: trials }, (_, trial) => ({ testCase, trial })))

  console.log(`${selected.length} case(s) × ${trials} trial(s) = ${jobs.length} runs, skill: ${values.ref ?? skillDir}`)
  const graded = []
  let costUsd = 0
  let connectionClosed = 0
  const models = new Set()
  await pool(jobs, Number(values.concurrency), async ({ testCase, trial }) => {
    const transcriptFile = path.join(out, 'transcripts', `${testCase.id}-${trial + 1}.jsonl`)
    const run = await runCase(testCase, {
      skillDir,
      model: values.model,
      budgetUsd: Number(values.budget),
      timeoutMs: Number(values.timeout) * 1000,
      transcriptFile,
    })
    const { pass, checks } = grade(testCase, run)
    const dropped = existsSync(transcriptFile) && readFileSync(transcriptFile, 'utf8').includes(CONNECTION_CLOSED)
    connectionClosed += dropped ? 1 : 0
    costUsd += run.costUsd
    if (run.model) {
      models.add(run.model)
    }
    graded.push({ testCase, pass, checks })
    appendFileSync(
      path.join(out, 'runs.jsonl'),
      `${JSON.stringify({
        id: testCase.id,
        trial: trial + 1,
        pass,
        checks,
        model: run.model,
        skillInvoked: run.skillInvoked,
        sdkCalls: run.sdkCalls.map((call) => call.method),
        files: Object.keys(run.files),
        turns: run.turns,
        costUsd: run.costUsd,
        durationMs: run.durationMs,
        stopReason: run.stopReason,
        connectionClosed: dropped,
        error: run.error,
      })}\n`,
    )
    console.log(
      `${pass ? '✓' : '✗'} ${testCase.id} #${trial + 1}  $${run.costUsd.toFixed(2)}  ${Math.round(run.durationMs / 1000)}s`,
    )
  })

  const cases = summarize(graded, values['min-pass-rate'] ? Number(values['min-pass-rate']) : undefined)
  const summary = {
    date: new Date().toISOString(),
    skill: values.ref ? `${path.basename(skillDir)}@${values.ref}` : path.relative(REPO, skillDir) || skillDir,
    commit: execFileSync('git', ['rev-parse', '--short', values.ref ?? 'HEAD'], { cwd: REPO })
      .toString()
      .trim(),
    models: [...models],
    trials,
    costUsd: Number(costUsd.toFixed(2)),
    durationMs: Date.now() - started,
    connectionClosed,
    passed: Object.values(cases).filter((entry) => entry.ok).length,
    failed: Object.values(cases).filter((entry) => !entry.ok).length,
    cases,
  }
  writeFileSync(path.join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeReport(summary)
  console.log(`\n${report(cases, baseline)}\n`)
  console.log(
    `${summary.passed} passed, ${summary.failed} failed, $${summary.costUsd}, ${summary.models.join(', ')} → ${path.relative(process.cwd(), out)}`,
  )
  process.exit(summary.failed ? 1 : 0)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
