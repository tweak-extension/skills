/*
 * Runs one eval case once: a fresh project directory carrying only the skill under test, the
 * Claude Code CLI headless in it, and a transcript reduced to what the graders read.
 *
 * Isolation is the point. `--setting-sources project` keeps the user's own skills (an older
 * installed copy of tweak-creating-rules would otherwise answer instead of this one) and
 * `--strict-mcp-config` keeps every MCP server out but the fake tab.
 */
import { spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PAGE_SERVER = path.join(HERE, 'page-server.mjs')
const DEVTOOLS_SERVER = path.join(HERE, 'devtools-server.mjs')
// a browser-automation MCP server the user has installed and allowed: it launches its own browser
export const DEVTOOLS_TOOL_PREFIX = 'mcp__chrome-devtools__'
const PAGE_TOOL = 'mcp__browser__run_page_script'
const FILE_TOOLS = ['Skill', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(node:*)', 'Bash(cat:*)', 'Bash(ls:*)']
// the browser agent has no shell: Claude in Chrome does not either, and a shell invites the file path
const BROWSER_TOOLS = ['Skill', 'Read', 'Glob', 'Grep', PAGE_TOOL]
const DISALLOWED = ['WebFetch', 'WebSearch', 'Agent', 'Task']
const MAX_TURNS = { trigger: 2, file: 25, browser: 40 }

/** Reduces a stream-json transcript to what a grader asks about. */
export function parseTranscript(lines) {
  const events = lines.filter(Boolean).map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  })
  const init = events.find((event) => event?.type === 'system' && event.subtype === 'init')
  const result = events.find((event) => event?.type === 'result')
  const toolUses = events
    .filter((event) => event?.type === 'assistant')
    .flatMap((event) => event.message?.content ?? [])
    .filter((block) => block.type === 'tool_use')
    .map(({ name, input }) => ({ name, input }))
  const toolResults = events
    .filter((event) => event?.type === 'user')
    .flatMap((event) => (Array.isArray(event.message?.content) ? event.message.content : []))
    .filter((block) => block.type === 'tool_result')
    .map((block) => ({
      isError: Boolean(block.is_error),
      text: Array.isArray(block.content)
        ? block.content.map((part) => part.text ?? '').join('')
        : String(block.content ?? ''),
    }))
  const texts = events
    .filter((event) => event?.type === 'assistant')
    .flatMap((event) => event.message?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)

  return {
    skillsLoaded: init?.skills ?? [],
    model: Object.keys(result?.modelUsage ?? {})[0] ?? init?.model ?? null,
    toolUses,
    toolResults,
    // every text block, not only the last: the JSON is often in an earlier message
    text: texts.join('\n\n'),
    finalText: result?.result ?? texts.at(-1) ?? '',
    turns: result?.num_turns ?? null,
    costUsd: result?.total_cost_usd ?? 0,
    isError: Boolean(result?.is_error),
    stopReason: result?.subtype ?? 'no result',
  }
}

/** True when the agent loaded the skill, through the Skill tool or by reading SKILL.md itself. */
export function skillWasInvoked(toolUses, skillName) {
  return toolUses.some(
    ({ name, input }) =>
      (name === 'Skill' &&
        String(input?.skill ?? '')
          .split(':')
          .pop() === skillName) ||
      (name === 'Read' && String(input?.file_path ?? '').endsWith(`${skillName}/SKILL.md`)),
  )
}

/** The files the agent wrote or changed: a fixture the case seeded and nobody touched is not one. */
function readWorkdirFiles(dir, seeded) {
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => !name.startsWith('.') && statSync(path.join(dir, name)).isFile())
      .map((name) => [name, readFileSync(path.join(dir, name), 'utf8')])
      .filter(([name, content]) => seeded[name] !== content),
  )
}

function readLog(file) {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []
}

/**
 * Runs `testCase` once against the skill directory `skillDir`. Resolves the run the graders
 * read; never rejects (a CLI failure is a failed run, with `error` set).
 */
export function runCase(testCase, { skillDir, model, budgetUsd, timeoutMs, transcriptFile }) {
  const skillName = path.basename(skillDir)
  const work = mkdtempSync(path.join(tmpdir(), `skill-eval-${testCase.id}-`))
  const meta = path.join(work, '.eval')
  mkdirSync(path.join(work, '.claude', 'skills'), { recursive: true })
  mkdirSync(meta)
  cpSync(skillDir, path.join(work, '.claude', 'skills', skillName), { recursive: true })
  Object.entries(testCase.files ?? {}).forEach(([name, content]) => writeFileSync(path.join(work, name), content))

  const sdkLog = path.join(meta, 'sdk-calls.jsonl')
  const args = [
    '-p',
    testCase.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--permission-mode',
    'acceptEdits',
    '--max-turns',
    String(testCase.maxTurns ?? MAX_TURNS[testCase.mode]),
    '--disallowedTools',
    ...DISALLOWED,
    '--allowedTools',
    ...(testCase.mode === 'browser' ? BROWSER_TOOLS : FILE_TOOLS),
    // allowed as a user who installed it would have it: the case grades whether the agent reaches for it
    ...(testCase.devtools ? ['mcp__chrome-devtools'] : []),
  ]
  if (model) {
    args.push('--model', model)
  }
  if (budgetUsd) {
    args.push('--max-budget-usd', String(budgetUsd))
  }
  const devtoolsLog = path.join(meta, 'devtools-calls.jsonl')
  if (testCase.devtools) {
    const config = {
      mcpServers: {
        'chrome-devtools': { command: process.execPath, args: [DEVTOOLS_SERVER], env: { EVAL_DEVTOOLS_LOG: devtoolsLog } },
      },
    }
    args.push('--mcp-config', JSON.stringify(config))
  }
  if (testCase.mode === 'browser') {
    const scenarioFile = path.join(meta, 'scenario.json')
    writeFileSync(scenarioFile, JSON.stringify(testCase.scenario))
    const config = {
      mcpServers: {
        browser: {
          command: process.execPath,
          args: [PAGE_SERVER],
          env: { EVAL_SCENARIO: scenarioFile, EVAL_SDK_LOG: sdkLog },
        },
      },
    }
    args.push('--mcp-config', JSON.stringify(config))
    args.push(
      '--append-system-prompt',
      `You are connected to the user's browser. Their active tab is ${testCase.scenario.url}` +
        `${testCase.scenario.title ? ` ("${testCase.scenario.title}")` : ''}. ` +
        'run_page_script runs JavaScript in that tab. The user cannot answer follow-up questions in this session.',
    )
  }

  return new Promise((resolve) => {
    const started = Date.now()
    const lines = []
    let stderr = ''
    let buffered = ''
    const child = spawn('claude', args, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.stdout.on('data', (chunk) => {
      buffered += chunk
      const parts = buffered.split('\n')
      buffered = parts.pop()
      lines.push(...parts)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const finish = (error) => {
      clearTimeout(timer)
      lines.push(buffered)
      if (transcriptFile) {
        writeFileSync(transcriptFile, lines.filter(Boolean).join('\n'))
      }
      const transcript = parseTranscript(lines)
      const sdkCalls = readLog(sdkLog)
      const devtoolsCalls = readLog(devtoolsLog)
      const files = readWorkdirFiles(work, testCase.files ?? {})
      // everything a grader needs is read; the transcript file is what is left to debug with
      rmSync(work, { recursive: true, force: true })
      resolve({
        ...transcript,
        skillInvoked: skillWasInvoked(transcript.toolUses, skillName),
        sdkCalls,
        devtoolsCalls,
        files,
        durationMs: Date.now() - started,
        error: error ?? (transcript.stopReason === 'no result' ? stderr.trim().slice(-500) || 'no result' : null),
      })
    }
    child.on('error', (error) => finish(error.message))
    child.on('close', () => finish(null))
  })
}
