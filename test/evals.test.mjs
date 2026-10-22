import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseTranscript, skillWasInvoked } from '../evals/lib/agent.mjs'
import { createBrowser, TOOLS } from '../evals/lib/devtools-server.mjs'
import { createFakeTweak } from '../evals/lib/fake-tweak.mjs'
import { createdRules, deliveredRules } from '../evals/lib/grade.mjs'
import { createPage } from '../evals/lib/page-server.mjs'
import { CASES, grade, summarize } from '../evals/run.mjs'
import { assertMatches, assertSomeMatch, stringContaining } from './helpers.mjs'

/*
 * The eval harness itself (evals/), without a model: the case catalogue, the fake tab the
 * browser cases drive, and the graders. A wrong fake or grader would make every eval run green
 * or red for nothing, and those runs cost money. See AGENTS.md.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EVALS = path.join(ROOT, 'evals')
const BROWSER_MD = path.join(ROOT, 'skills/tweak-creating-rules/reference/browser.md')
const RULE = { interceptionPolicy: 'MOCK', url: '/api/cart', status: 500, responsePayload: '{}' }

const run = (overrides = {}) => ({
  skillsLoaded: ['tweak-creating-rules'],
  skillInvoked: true,
  toolUses: [],
  toolResults: [],
  text: '',
  finalText: '',
  stopReason: 'success',
  sdkCalls: [],
  files: {},
  error: null,
  ...overrides,
})

const jsBlocks = (markdown) => markdown.match(/```js\n([\s\S]*?)```/g).map((block) => block.slice(6, -3))

describe('cases', () => {
  it('have unique ids, a known mode, a prompt and a grader', () => {
    assert.equal(new Set(CASES.map((testCase) => testCase.id)).size, CASES.length)
    CASES.forEach((testCase) => {
      assert.ok(['trigger', 'file', 'browser'].includes(testCase.mode), testCase.id)
      assert.ok(testCase.prompt.length > 10, testCase.id)
      assert.equal(typeof testCase.grade, 'function')
    })
  })

  it('route both ways: as many prompts that must not trigger as prompts that must', () => {
    const triggers = CASES.filter((testCase) => testCase.mode === 'trigger')
    const yes = triggers.filter((testCase) => testCase.id.startsWith('trigger-yes-'))

    assert.ok(yes.length >= 5)
    assert.equal(triggers.length - yes.length, yes.length)
  })

  it('give every browser case a tab', () => {
    CASES.filter((testCase) => testCase.mode === 'browser').forEach((testCase) => {
      assert.match(testCase.scenario.url, /^https:\/\//)
    })
  })

  // a grader that throws on an empty run would report "grader ran" instead of what regressed
  CASES.forEach((testCase) => {
    it(`${testCase.id} grades an empty run without throwing`, () => {
      const { pass, checks } = grade(testCase, run())

      assert.equal(
        checks.find((entry) => entry.name === 'grader ran'),
        undefined,
      )
      assert.equal(typeof pass, 'boolean')
    })
  })
})

describe('fake tweak', () => {
  const fake = (scenario = {}) => {
    const log = []
    return {
      ...createFakeTweak(
        { requests: [{ url: 'https://a.test/api/cart', method: 'GET', responsePayload: { items: [] } }], ...scenario },
        (entry) => log.push(entry),
      ),
      log,
    }
  }

  it('captures nothing until capture is on AND the page reloaded', async () => {
    const { sdk, reload } = fake()

    await sdk.setRequestCapture(true)
    assert.equal((await sdk.searchRequests({ url: 'cart' })).total, 0)
    reload()
    assertMatches((await sdk.searchRequests({ url: 'cart' })).requests[0], { responsePayload: '{"items":[]}' })
  })

  it("refuses what the skill's contract says tweak refuses", async () => {
    const { sdk } = fake()

    assert.equal((await sdk.createRules([{ ...RULE, url: '' }])).error.code, 'INVALID_RULE')
    assert.equal((await sdk.createRules([{ ...RULE, responseHook: 'return response' }])).error.code, 'PREMIUM_REQUIRED')
    assert.equal((await sdk.createRedirectRule({ url: 'a', redirectUrl: 'ftp://x' })).error.code, 'INVALID_RULE')
    assert.equal(
      (await sdk.createRedirectRule({ url: 'a', redirectUrl: '/b', headerRuleScope: 'GLOBAL' })).error.code,
      'INVALID_RULE',
    )
    assert.equal((await sdk.createRules([{ ...RULE, interceptionPolicy: 'BLOCK' }])).error.code, 'UNSUPPORTED_RULE_TYPE')
    // as window.tweak does: an unknown field is refused, an export's leftovers are dropped
    assertMatches(await sdk.createRules([{ ...RULE, bogus: 1 }]), {
      ok: false,
      error: { code: 'UNSUPPORTED_FIELD', message: stringContaining('"bogus"') },
    })
    assertMatches(await sdk.createRules([{ ...RULE, id: 'x', enabled: false, isBreakpointEnabled: false }]), {
      ok: true,
      warnings: [],
    })
    assertMatches(await sdk.createRedirectRule({ url: 'a', redirectUrl: '/b', responsePayload: '{}' }), { ok: true })
  })

  it('takes Modify rules only when the scenario includes them, and only when they change something', async () => {
    const modify = { url: '/api/account', responseHook: 'response.plan = "free"; return response;' }

    assert.equal((await fake().sdk.createModifyRule(modify)).error.code, 'PREMIUM_REQUIRED')
    assertMatches(await fake({ unavailable: [] }).sdk.createModifyRule(modify), { ok: true })
    assert.equal((await fake({ unavailable: [] }).sdk.createModifyRule({ url: '/a', status: 0 })).error.code, 'INVALID_RULE')
  })

  it('refuses each feature outside the free list on its own, and lists only the entries a build has', async () => {
    const { sdk } = fake({ unavailable: ['PARTIAL_MATCHING'], omitFeatures: ['PARTIAL_MATCHING', 'LOGPOINT'] })
    const graphql = { url: '/graphql', method: 'POST', requestPayload: '{"operationName":"getProduct"}' }

    assertMatches(await sdk.createModifyRule({ url: '/a', status: 500 }), { ok: true })
    assertMatches(await sdk.createMockRule({ ...graphql, requestPayloadMatchPolicy: 'PARTIAL' }), {
      error: { code: 'PREMIUM_REQUIRED' },
    })
    assertMatches(await sdk.createMockRule({ url: '/b', isLogpointEnabled: false }), { ok: true })
    const { features } = await sdk.features()
    assert.equal(features.PARTIAL_MATCHING, undefined)
    assert.equal(features.LOGPOINT, undefined)
    assertMatches(features.MODIFY_RULES, { available: true })
    assert.equal((await sdk.isFeatureAvailable('LOGPOINT')).error.code, 'INVALID_ARGUMENT')
    assertMatches((await fake().sdk.features()).features.LOGPOINT, { available: false, reason: 'PLAN' })
  })

  it('takes header rules, refusing what the browser or the page API would', async () => {
    const { sdk } = fake()
    const headers = (rows) => sdk.createHeaderRule({ url: 'api.a.test', ...rows })

    assertMatches(await headers({ requestHeaders: [{ header: 'X-Debug', value: '1' }] }), { ok: true })
    assert.equal((await headers({ requestHeaders: [] })).error.code, 'INVALID_RULE')
    assert.equal(
      (await headers({ requestHeaders: [{ header: 'X-Debug', value: '1', operation: 'append' }] })).error.code,
      'INVALID_RULE',
    )
    assertMatches((await headers({ responseHeaders: [{ header: 'Access-Control-Allow-Origin', value: '*' }] })).error, {
      code: 'UNSUPPORTED_FIELD',
      message: stringContaining('import file'),
    })
  })

  it('has no way to delete a rule', () => {
    assert.equal(fake().sdk.deleteRule, undefined)
  })

  it('an API version 4 build has neither Modify nor header rules', async () => {
    const { sdk } = fake({ version: 4, unavailable: [] })

    assert.equal(sdk.createHeaderRule, undefined)
    assert.equal(sdk.createModifyRule, undefined)
    assert.equal(
      (
        await sdk.createRules([
          { interceptionPolicy: 'MODIFY_HEADERS', url: 'a', requestHeaders: [{ header: 'X', value: '1' }] },
        ])
      ).error.code,
      'UNSUPPORTED_RULE_TYPE',
    )
  })

  it('updates a rule it created without refusing its own bookkeeping', async () => {
    const { sdk } = fake()
    const [created] = (await sdk.createRules([RULE])).created

    assertMatches(await sdk.updateRule(created.id, { status: 404 }), { ok: true })
    assert.equal((await sdk.updateRule(created.id, { bogus: 1 })).error.code, 'UNSUPPORTED_FIELD')
  })

  it('fails the first create once when the scenario says so', async () => {
    const { sdk } = fake({ failFirstCreate: 'label too long' })

    assert.deepEqual((await sdk.createRules([RULE])).error, { code: 'INVALID_RULE', message: 'label too long' })
    assert.equal((await sdk.createRules([RULE])).ok, true)
  })

  it('finds the rule that catches a request, and which one answers', async () => {
    const { sdk } = fake({ rules: [{ id: 'u1', type: 'MOCK', url: '/api/cart', label: 'Cart', enabled: false }] })
    const { rules } = await sdk.searchRules({ requestUrl: 'https://a.test/api/cart' })

    assertMatches(rules[0], { id: 'u1', catches: true, answers: false })
  })

  it('an API version 1 build lacks what browser.md step 0 says it lacks', () => {
    const { sdk } = fake({ version: 1 })

    assert.equal(sdk.searchRules, undefined)
    assert.equal(sdk.setRunning, undefined)
    assert.equal(typeof sdk.createRules, 'function')
  })

  it('logs every call with its answer', async () => {
    const { sdk, log } = fake()

    await sdk.status()
    sdk.signIn('Claude')
    assert.deepEqual(
      log.map((entry) => entry.method),
      ['status', 'signIn'],
    )
    assertMatches(log[0].result, { enabled: true })
  })
})

describe('fake tab', () => {
  // the skill's snippets are what an agent pastes into the page, so the tab must run them as written
  jsBlocks(readFileSync(BROWSER_MD, 'utf8')).forEach((snippet) => {
    it(`runs browser.md's snippet ${snippet.slice(0, 40).replace(/\s+/g, ' ')}`, async () => {
      const page = createPage({ url: 'https://shop.example.com/products' }, () => {})

      assert.equal(typeof (await page.run(snippet)), 'string')
    })
  })

  // a form body, as the session that went blind on one met it
  const FORM_TAB = {
    url: 'https://a.test/',
    capturing: true,
    blocksQueryStrings: true,
    requests: [
      {
        url: 'https://a.test/newsletter/subscribe',
        method: 'POST',
        requestContentType: 'application/x-www-form-urlencoded',
        requestPayload: 'email=a%40b.test&consent=&tag=x&tag=y',
        responsePayload: '{}',
      },
    ],
  }
  const SEARCH = "(async () => JSON.stringify(await window.__TWEAK_SDK__.searchRequests({ url: 'subscribe' })))()"

  it('hands a form body out as its fields from version 6, and raw before', async () => {
    const v6 = JSON.parse(await createPage(FORM_TAB, () => {}).run(SEARCH))

    assert.deepEqual(v6.requests[0].requestPayload, { email: 'a@b.test', consent: '', tag: ['x', 'y'] })
    assert.equal(await createPage({ ...FORM_TAB, version: 5 }, () => {}).run(SEARCH), '[BLOCKED: Cookie/query string data]')
  })

  it("decodes a raw form body with browser.md's own snippet, which the tool then prints", async () => {
    const snippet = jsBlocks(readFileSync(BROWSER_MD, 'utf8')).find((block) => block.includes('URLSearchParams'))
    const [request] = JSON.parse(await createPage({ ...FORM_TAB, version: 5 }, () => {}).run(snippet))

    assertMatches(request.fields, { email: 'a@b.test', consent: '' })
  })

  it('takes Edit before send from version 6, only when the scenario includes it', async () => {
    const rule = { url: '/products/1', isEditBeforeSendEnabled: true, editBeforeSendStage: 'RESPONSE' }

    assertMatches(await createFakeTweak({ unavailable: [] }).sdk.createModifyRule(rule), { ok: true })
    assertMatches(await createFakeTweak({}).sdk.createMockRule(rule), {
      error: { code: 'PREMIUM_REQUIRED' },
    })
    assertMatches(await createFakeTweak({ unavailable: [], version: 5 }).sdk.createModifyRule(rule), {
      error: { code: 'UNSUPPORTED_FIELD' },
    })
  })

  it('answers missing: true when the tab has no page API', async () => {
    const page = createPage({ url: 'https://a.test/', missingSdk: true }, () => {})

    assert.deepEqual(JSON.parse(await page.run('(async () => JSON.stringify({ missing: !window.__TWEAK_SDK__ }))()')), {
      missing: true,
    })
  })

  it('serves run_page_script over MCP stdio and logs the SDK calls', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'page-server-'))
    const scenario = path.join(dir, 'scenario.json')
    const log = path.join(dir, 'calls.jsonl')
    writeFileSync(scenario, JSON.stringify({ url: 'https://a.test/' }))
    const child = spawn(process.execPath, [path.join(EVALS, 'lib/page-server.mjs')], {
      env: { ...process.env, EVAL_SCENARIO: scenario, EVAL_SDK_LOG: log },
    })
    const answers = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
    const ask = async (id, method, params) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      return JSON.parse((await answers.next()).value)
    }

    try {
      assert.deepEqual((await ask(1, 'initialize', { protocolVersion: '2025-06-18' })).result.capabilities, {
        tools: {},
      })
      assert.deepEqual(
        (await ask(2, 'tools/list')).result.tools.map((tool) => tool.name),
        ['run_page_script'],
      )
      const call = await ask(3, 'tools/call', {
        name: 'run_page_script',
        arguments: { code: '(async () => JSON.stringify(await window.tweak.status()))()' },
      })
      assertMatches(JSON.parse(call.result.content[0].text), { enabled: true })
      assert.equal((await ask(4, 'tools/call', { arguments: { code: 'nope(' } })).result.isError, true)
      assertMatches(JSON.parse(readFileSync(log, 'utf8').trim()), { method: 'status' })
    } finally {
      child.kill()
    }
  })
})

describe('fake devtools browser', () => {
  it('offers the tools Chrome DevTools MCP does, and has no tweak in its pages', async () => {
    const browser = createBrowser()

    assert.ok(['new_page', 'evaluate_script', 'take_snapshot'].every((name) => TOOLS.some((t) => t.name === name)))
    await browser('new_page', { url: 'https://shop.test/' })
    assert.equal(await browser('list_pages'), '0: https://shop.test/ [selected]')
    assert.equal(
      await browser('evaluate_script', { function: '() => ({ tweak: typeof window.__TWEAK_SDK__ })' }),
      '{"tweak":"undefined"}',
    )
  })

  it('gives the devtools cases the server, allowed', () => {
    const cases = CASES.filter((testCase) => testCase.devtools)

    assert.ok(cases.length >= 2)
    cases.forEach((testCase) => assert.equal(testCase.mode, 'file'))
  })
})

describe('graders', () => {
  it('read the delivered rules from the file first, then the last rule block of the answer', () => {
    const text = '```json\n{"configurations":[{"interceptionPolicy":"MOCK","url":"/x"}]}\n```'

    assert.deepEqual(deliveredRules(run({ text })), [{ interceptionPolicy: 'MOCK', url: '/x' }])
    assert.deepEqual(deliveredRules(run({ text, files: { 'tweak-rules.json': JSON.stringify([RULE]) } })), [RULE])
    assert.equal(deliveredRules(run()), null)
  })

  it('read the rules tweak accepted, typed by the method that created them', () => {
    const sdkCalls = [
      { method: 'createRedirectRule', args: [{ url: 'a', redirectUrl: '/b' }], result: { ok: true } },
      { method: 'createRules', args: [[RULE]], result: { ok: false } },
    ]

    assert.deepEqual(createdRules(run({ sdkCalls })), [{ interceptionPolicy: 'REDIRECT', url: 'a', redirectUrl: '/b' }])
  })

  it('fail a devtools case that opened its own browser', () => {
    const testCase = CASES.find((entry) => entry.id === 'file-devtools-installed')
    const opened = run({ toolUses: [{ name: 'mcp__chrome-devtools__new_page', input: { url: 'https://a.test' } }] })

    assertSomeMatch(grade(testCase, opened).checks, { name: 'never opens a browser of its own', pass: false })
    assertSomeMatch(grade(testCase, run()).checks, { name: 'never opens a browser of its own', pass: true })
  })

  it('fail a run that loaded another copy of the skill, or never finished', () => {
    const [testCase] = CASES.filter((entry) => entry.mode === 'file')

    assertSomeMatch(
      grade(testCase, run({ skillsLoaded: ['tweak-creating-rules', 'anthropic-skills:tweak-creating-rules'] })).checks,
      { name: 'only the skill under test is loaded', pass: false },
    )
    assertSomeMatch(grade(testCase, run({ stopReason: 'error_max_turns' })).checks, {
      name: 'finished within its turn budget',
      pass: false,
    })
  })

  it('pass a case at its minimum pass rate, and count which checks failed', () => {
    const testCase = { id: 'c', mode: 'file' }
    const failing = { testCase, pass: false, checks: [{ name: 'status 500', pass: false }] }
    const cases = summarize([{ testCase, pass: true, checks: [] }, { testCase, pass: true, checks: [] }, failing])

    assertMatches(cases.c, { passes: 2, trials: 3, ok: true, failedChecks: { 'status 500': 1 } })
    assert.equal(summarize([failing, failing, { testCase, pass: true, checks: [] }]).c.ok, false)
  })
})

describe('transcript', () => {
  const lines = [
    { type: 'system', subtype: 'init', skills: ['tweak-creating-rules'], model: 'm' },
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'tweak-creating-rules' } }] },
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', is_error: true, content: [{ type: 'text', text: 'boom' }] }] },
    },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
    { type: 'result', subtype: 'success', result: 'done', total_cost_usd: 0.1, num_turns: 2, modelUsage: { m: {} } },
  ].map((event) => JSON.stringify(event))

  it('reduces stream-json to what a grader reads', () => {
    assertMatches(parseTranscript([...lines, 'not json']), {
      skillsLoaded: ['tweak-creating-rules'],
      model: 'm',
      toolResults: [{ isError: true, text: 'boom' }],
      finalText: 'done',
      costUsd: 0.1,
      stopReason: 'success',
    })
  })

  it('counts the Skill tool, a plugin-namespaced one, or reading SKILL.md as loading the skill', () => {
    assert.equal(skillWasInvoked([{ name: 'Skill', input: { skill: 'tweak-creating-rules' } }], 'tweak-creating-rules'), true)
    assert.equal(skillWasInvoked([{ name: 'Skill', input: { skill: 'x:tweak-creating-rules' } }], 'tweak-creating-rules'), true)
    assert.equal(
      skillWasInvoked(
        [{ name: 'Read', input: { file_path: '/w/.claude/skills/tweak-creating-rules/SKILL.md' } }],
        'tweak-creating-rules',
      ),
      true,
    )
    assert.equal(skillWasInvoked([{ name: 'Skill', input: { skill: 'pdf' } }], 'tweak-creating-rules'), false)
  })
})
