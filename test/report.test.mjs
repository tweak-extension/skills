import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { REPORT_MARKER, reportMarkdown } from '../evals/run.mjs'

/*
 * The sticky pull request comment evals.yml posts. The fixtures are hand-written summaries in
 * the shape run.mjs writes; the paid run itself is never part of `npm test`.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = (name) => path.join(ROOT, 'test/fixtures', name)
const load = (name) => JSON.parse(readFileSync(fixture(name), 'utf8'))

describe('report', () => {
  const markdown = reportMarkdown(load('summary-pr.json'), load('summary-baseline.json'), {
    sha: 'abcdef0123456789',
    artifactUrl: 'https://github.com/tweak-extension/skills/actions/runs/1/artifacts/2',
  })
  const tableRows = markdown.split('\n').filter((line) => line.startsWith('| ✅') || line.startsWith('| ❌'))

  it('is marked for upsert and gives the verdict first', () => {
    const [marker, title] = markdown.split('\n')

    assert.equal(marker, REPORT_MARKER)
    assert.equal(title, '## ❌ Skill evals: 3/4 cases passed')
  })

  it('lists every case with the baseline, failures first', () => {
    assert.equal(tableRows.length, 4)
    assert.match(tableRows[0], /^\| ❌ \| `browser-mock-empty-list` \| browser \| 1\/3 \(33%\) \| 3\/3 \(100%\) \|/)
    assert.match(tableRows[1], /`file-mock-500` .* 2\/3 \(67%\) \| 3\/3 \(100%\) \| links the import page ×1 \|$/)
    assert.match(markdown, /`browser-new-case` \| browser \| 3\/3 \(100%\) \| — \|/)
  })

  it('counts the failed checks by name across cases', () => {
    assert.match(markdown, /\| links the import page \| 2 \|\n\| searched existing rules \| 2 \|/)
  })

  it('names the model, trials, cost, duration, head SHA and artifact', () => {
    assert.match(markdown, /\*\*Model:\*\* claude-sonnet-5-5 · \*\*Trials:\*\* 3 · \*\*Cost:\*\* \$11\.02 · \*\*Duration:\*\* 15 min/)
    assert.match(markdown, /\*\*Head:\*\* abcdef0123456789 · \*\*Baseline:\*\* 1a2b3c4d \(2026-10-12\)/)
    assert.match(markdown, /\[results artifact\]\(https:\/\/github\.com\/tweak-extension\/skills\/actions\/runs\/1\/artifacts\/2\)/)
  })

  it('warns about a dropped fake tab only when a run lost it', () => {
    assert.match(markdown, /1 run\(s\) lost the fake tab's MCP connection \(`CONNECTION_CLOSED`/)
    assert.doesNotMatch(reportMarkdown(load('summary-baseline.json'), null), /CONNECTION_CLOSED/)
  })

  it('reads green with no baseline yet', () => {
    const green = reportMarkdown(load('summary-baseline.json'), null)

    assert.match(green, /^## ✅ Skill evals: 3\/3 cases passed$/m)
    assert.match(green, /\*\*Baseline:\*\* none yet/)
  })

  it('is what `run.mjs --summary --compare --report-md` writes, exiting 1 on a failed case', () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'report-')), 'report.md')
    const args = [
      path.join(ROOT, 'evals/run.mjs'),
      '--summary',
      fixture('summary-pr.json'),
      '--compare',
      fixture('summary-baseline.json'),
      '--report-md',
      out,
      '--sha',
      'abcdef0123456789',
    ]

    assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }), { status: 1 })
    assert.equal(readFileSync(out, 'utf8'), reportMarkdown(load('summary-pr.json'), load('summary-baseline.json'), { sha: 'abcdef0123456789' }))
  })
})
