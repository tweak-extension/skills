/*
 * A stand-in for tweak's page API (`window.__TWEAK_SDK__`, reference/browser.md) that a browser
 * eval case scripts through a scenario and that records every call for the graders.
 *
 * It is NOT the extension's builder: it refuses what the skill's own contract says tweak refuses
 * (url, redirect target, plan gates, GLOBAL from a page, a field outside the type's vocabulary,
 * a Modify rule that changes nothing, a header row the browser or the page API would refuse)
 * and nothing more. Whether tweak accepts the skill's examples is
 * the contract tests' job (src/__tests__/agent-skills.test.js in tweak-extension/tweak).
 */
import {
  APPENDABLE_REQUEST_HEADERS,
  EDIT_BEFORE_SEND_STAGES,
  FIELDS,
  GUARDED_HEADERS,
  OPERATIONS,
  PLACEMENT,
  isInert,
} from '../../skills/tweak-creating-rules/scripts/validate-rules.mjs'

const FEATURES = [
  'MOCK_RULES',
  'MODIFY_RULES',
  'HEADER_RULES',
  'REDIRECT_RULES',
  'HOOKS',
  'EDIT_BEFORE_SEND',
  'COLLECTIONS',
  'VARIABLES',
]
const PREMIUM_FEATURES = ['HOOKS', 'EDIT_BEFORE_SEND', 'COLLECTIONS', 'MODIFY_RULES', 'VARIABLES']
// what version 6 added: Edit before send, and a form body handed out as its fields
const V6_FIELDS = ['isEditBeforeSendEnabled', 'editBeforeSendStage']
const FORM_URLENCODED = /application\/x-www-form-urlencoded/i
const NOT_IN_SDK = ['VARIABLES']
// what a build at API version 1 had, the "older build" row of browser.md step 0
const V1_METHODS = ['version', 'status', 'createRules', 'createMockRule', 'createRedirectRule', 'listRules', 'help']
// what version 5 added: Modify and header rules
const V5_METHODS = ['createModifyRule', 'createHeaderRule']
const V5_TYPES = ['PATCH', 'MODIFY_HEADERS']

/** A urlencoded body as its fields, a repeated one as a list: what version 6 hands out. */
function formFields(body) {
  const fields = {}
  new URLSearchParams(body).forEach((value, name) => {
    const seen = fields[name]
    fields[name] = seen === undefined ? value : [...(Array.isArray(seen) ? seen : [seen]), value]
  })
  return fields
}

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const fail = (code, message) => ({ ok: false, error: { code, message } })

const isListed = (name, names, prefixes) => names.includes(name) || prefixes.some((prefix) => name.startsWith(prefix))

/** The first reason tweak would refuse a header rule's rows, or null. */
function headerRowsProblem(rule, where) {
  const rows = [
    ...(rule.requestHeaders ?? []).map((row) => ({ row, isRequest: true })),
    ...(rule.responseHeaders ?? []).map((row) => ({ row, isRequest: false })),
  ]
  if (!rows.some(({ row }) => row?.active !== false)) {
    return fail('INVALID_RULE', `${where}: "requestHeaders" or "responseHeaders" needs at least one active header row`)
  }
  for (const { row, isRequest } of rows) {
    const name = String(row?.header ?? '').trim().toLowerCase()
    const operation = row?.operation ?? 'set'
    const guarded = isRequest
      ? isListed(name, GUARDED_HEADERS.request, GUARDED_HEADERS.requestPrefixes)
      : isListed(name, GUARDED_HEADERS.response, GUARDED_HEADERS.responsePrefixes)
    if (!name || typeof row.value !== 'string' || !OPERATIONS.includes(operation)) {
      return fail('INVALID_RULE', `${where}: every header row is { header, value, operation: set | append | remove }`)
    }
    if (guarded) {
      return fail(
        'UNSUPPORTED_FIELD',
        `${where}: "${row.header}" guards how sites trust each other, so a page cannot change it through ` +
          'window.tweak. Hand the user the rule as an import file instead, or ask them to add it in tweak.',
      )
    }
    if (operation !== 'remove' && !row.value.trim()) {
      return fail('INVALID_RULE', `${where}: "${row.header}" needs a value; "operation": "remove" strips the header`)
    }
    if (operation === 'append' && isRequest && !APPENDABLE_REQUEST_HEADERS.some((h) => h.toLowerCase() === name)) {
      return fail('INVALID_RULE', `${where}: "${row.header}" cannot be appended to; use "set"`)
    }
  }
  return null
}

// a Modify rule's defaults forward everything: one that names nothing changes nothing
const modifyChangesSomething = (rule) =>
  (rule.status ?? 0) !== 0 ||
  rule.delay > 0 ||
  !!rule.responsePayload ||
  !!rule.outgoingRequestPayload ||
  (rule.responseHeaders ?? []).length > 0 ||
  (rule.requestHeaders ?? []).length > 0 ||
  !!rule.responseHook ||
  !!rule.requestHook ||
  // the user changes it by hand, live
  rule.isEditBeforeSendEnabled === true

/** The rule summary `listRules`/`created` answer: never a payload. */
const summary = ({ id, type, url, label, enabled, collection }) => ({ id, type, url, label, enabled, collection })

/**
 * Builds the fake SDK for one scenario. `log` receives `{ method, args, result }` for every call,
 * in call order, after it resolved.
 */
export function createFakeTweak(scenario = {}, log = () => {}) {
  const state = {
    enabled: scenario.enabled ?? true,
    running: scenario.running ?? false,
    capturing: scenario.capturing ?? false,
    // requests made before capture was switched on were never captured: a reload is what fills it
    captured: scenario.capturing ?? false,
    premium: scenario.premium ?? false,
    rules: clone(scenario.rules ?? []).map((rule) => ({ enabled: true, ...rule })),
    failNextCreate: scenario.failFirstCreate ?? null,
    nextId: 1,
  }
  const version = scenario.version ?? 6

  const featureEntry = (name) => {
    if (NOT_IN_SDK.includes(name)) {
      return { feature: name, available: false, reason: 'NOT_IN_SDK', message: `${name} cannot be created by an agent` }
    }
    if (PREMIUM_FEATURES.includes(name) && !state.premium) {
      return { feature: name, available: false, reason: 'PLAN', message: `${name} needs tweak premium` }
    }
    return { feature: name, available: true }
  }

  const checkRule = (rule, index, forcedType) => {
    const where = `rule ${index + 1}`
    if (!rule || typeof rule !== 'object') {
      return { error: fail('INVALID_RULE', `${where}: not an object`) }
    }
    const type = forcedType ?? rule.interceptionPolicy ?? 'MOCK'
    if (!FIELDS[type] || (version < 5 && V5_TYPES.includes(type))) {
      const known = version < 5 ? 'MOCK and REDIRECT' : Object.keys(FIELDS).join(', ')
      return { error: fail('UNSUPPORTED_RULE_TYPE', `${where}: only ${known} rules can be created`) }
    }
    if (typeof rule.url !== 'string' || !rule.url.trim()) {
      return { error: fail('INVALID_RULE', `${where}: "url" is required`) }
    }
    const isForwarded = type === 'PATCH' && rule.status === 0
    if (
      rule.status !== undefined &&
      !isForwarded &&
      !(Number.isInteger(rule.status) && rule.status >= 100 && rule.status <= 599)
    ) {
      return { error: fail('INVALID_RULE', `${where}: "status" must be an integer from 100 to 599`) }
    }
    if (type === 'PATCH') {
      if (!state.premium) {
        return {
          error: fail('PREMIUM_REQUIRED', `${where}: Modify rules need tweak premium; a MOCK rule is the free way`),
        }
      }
      if (!modifyChangesSomething(rule)) {
        return { error: fail('INVALID_RULE', `${where}: a Modify rule must change something`) }
      }
    }
    if (type === 'MODIFY_HEADERS') {
      const problem = headerRowsProblem(rule, where)
      if (problem) {
        return { error: problem }
      }
      if (rule.headerRuleScope === 'GLOBAL') {
        return { error: fail('INVALID_RULE', `${where}: "headerRuleScope" GLOBAL cannot be set from a page`) }
      }
    }
    if (type === 'REDIRECT') {
      const target = rule.redirectUrl
      if (typeof target !== 'string' || !(/^https?:\/\//i.test(target) || /^[/?#]/.test(target))) {
        return {
          error: fail('INVALID_RULE', `${where}: "redirectUrl" must be an http(s) url, or start with "/", "?" or "#"`),
        }
      }
      if (rule.headerRuleScope === 'GLOBAL') {
        return { error: fail('INVALID_RULE', `${where}: "headerRuleScope" GLOBAL cannot be set from a page`) }
      }
    }
    if ((rule.responseHook || rule.requestHook) && !state.premium) {
      return {
        error: fail('PREMIUM_REQUIRED', `${where}: hooks need tweak premium; write the values into responsePayload`),
      }
    }
    if (version < 6 && V6_FIELDS.some((key) => !isInert(rule[key]))) {
      return {
        error: fail('UNSUPPORTED_FIELD', `${where}: "isEditBeforeSendEnabled" cannot be set on a ${type} rule by an agent`),
      }
    }
    if (rule.editBeforeSendStage !== undefined && !EDIT_BEFORE_SEND_STAGES.includes(rule.editBeforeSendStage)) {
      return {
        error: fail('INVALID_RULE', `${where}: "editBeforeSendStage" must be ${EDIT_BEFORE_SEND_STAGES.join(', ')}`),
      }
    }
    if (rule.isEditBeforeSendEnabled === true && !state.premium) {
      return { error: fail('PREMIUM_REQUIRED', `${where}: Edit before send needs tweak premium`) }
    }
    if (rule.requestPayloadMatchPolicy === 'PARTIAL' && !state.premium) {
      return { error: fail('PREMIUM_REQUIRED', `${where}: PARTIAL body matching needs tweak premium`) }
    }
    // the vocabulary is validate-rules.mjs's, which tweak's tests hold to src/@schema
    const unsupported = Object.keys(rule).filter(
      (key) => !FIELDS[type].includes(key) && !PLACEMENT.includes(key) && !isInert(rule[key]),
    )
    if (unsupported.length) {
      const names = unsupported.map((key) => `"${key}"`).join(', ')
      return { error: fail('UNSUPPORTED_FIELD', `${where}: ${names} cannot be set on a ${type} rule by an agent`) }
    }
    return { type, warnings: [] }
  }

  const create = (input, forcedType) => {
    if (!state.enabled) {
      return fail('AGENT_ACCESS_DISABLED', 'AI Agents is off in tweak > Settings > Preferences')
    }
    const rules = Array.isArray(input) ? input : Array.isArray(input?.configurations) ? input.configurations : [input]
    if (rules.length > 20) {
      return fail('INVALID_RULE', 'at most 20 rules per call')
    }
    if (state.failNextCreate) {
      const message = state.failNextCreate
      state.failNextCreate = null
      return fail('INVALID_RULE', message)
    }
    const checked = rules.map((rule, index) => checkRule(rule, index, forcedType))
    const refused = checked.find((entry) => entry.error)
    if (refused) {
      return refused.error
    }
    const collection = state.premium ? 'AI Generated' : undefined
    const created = rules.map((rule, index) => {
      const stored = {
        ...clone(rule),
        id: `agent-${state.nextId++}`,
        type: checked[index].type,
        enabled: true,
        agentCreated: true,
        collection,
      }
      state.rules.push(stored)
      return summary(stored)
    })
    return { ok: true, created, collection, warnings: checked.flatMap((entry) => entry.warnings) }
  }

  const catches = (rule, requestUrl) => {
    if (!requestUrl) {
      return false
    }
    if (rule.isRgx) {
      try {
        return new RegExp(rule.url).test(requestUrl)
      } catch {
        return false
      }
    }
    return requestUrl.includes(rule.url)
  }

  const findRule = (id) => state.rules.find((rule) => rule.id === id)

  const methods = {
    help: () => Object.keys(sdk),
    signIn: (name) => ({ ok: true, agent: name }),
    status: async () => ({
      ok: true,
      enabled: state.enabled,
      running: state.running,
      capturing: state.capturing,
      premium: state.premium,
      ruleSlotsLeft: (state.premium ? 200 : 12) - state.rules.length,
    }),
    features: async () => ({
      ok: true,
      premium: state.premium,
      features: Object.fromEntries(FEATURES.map((name) => [name, featureEntry(name)])),
      redirectTargetTypes: ['ALL', 'XHR', 'DOCUMENT', 'IFRAME', 'SCRIPT', 'STYLESHEET', 'IMAGE', 'MEDIA', 'FONT'],
    }),
    isFeatureAvailable: async (name) => ({ ok: true, ...featureEntry(name) }),
    setRequestCapture: async (on) => {
      state.capturing = Boolean(on)
      return { ok: true, capturing: state.capturing }
    },
    searchRequests: async (query = {}) => {
      if (!state.enabled) {
        return fail('AGENT_ACCESS_DISABLED', 'AI Agents is off in tweak > Settings > Preferences')
      }
      const requests = (state.capturing && state.captured ? (scenario.requests ?? []) : [])
        .filter((request) => !query.url || request.url.includes(query.url))
        .filter((request) => !query.method || request.method === query.method)
        .slice(0, query.limit ?? 20)
        .map((request) => {
          const limit = query.payloadChars ?? 2000
          const body =
            typeof request.responsePayload === 'string'
              ? request.responsePayload
              : JSON.stringify(request.responsePayload)
          const sent = typeof request.requestPayload === 'string' ? request.requestPayload.slice(0, limit) : ''
          const isForm = version >= 6 && FORM_URLENCODED.test(request.requestContentType ?? '')
          return {
            ...clone(request),
            ...(isForm ? { requestPayload: formFields(sent) } : {}),
            responsePayload: body.slice(0, limit),
            truncated: body.length > limit,
          }
        })
      return { ok: true, capturing: state.capturing, total: requests.length, requests }
    },
    createRules: async (rules) => create(rules),
    createMockRule: async (rule) => create([rule], 'MOCK'),
    createModifyRule: async (rule) => create([rule], 'PATCH'),
    createHeaderRule: async (rule) => create([rule], 'MODIFY_HEADERS'),
    createRedirectRule: async (rule) => create([rule], 'REDIRECT'),
    updateRule: async (id, changes = {}) => {
      const rule = findRule(id)
      if (!rule) {
        return fail('RULE_NOT_FOUND', `no rule ${id}`)
      }
      const fields = Object.fromEntries(Object.entries(rule).filter(([key]) => FIELDS[rule.type].includes(key)))
      const checked = checkRule({ ...fields, ...changes }, 0, rule.type)
      if (checked.error) {
        return checked.error
      }
      Object.assign(rule, clone(changes))
      return { ok: true, rule: summary(rule), warnings: [] }
    },
    listRules: async (query = {}) => ({
      ok: true,
      rules: state.rules
        .filter((rule) => !query.url || rule.url.includes(query.url) || query.url.includes(rule.url))
        .filter((rule) => !query.label || (rule.label ?? '').toLowerCase().includes(query.label.toLowerCase()))
        .filter((rule) => !query.type || rule.type === query.type)
        .filter((rule) => query.enabled === undefined || rule.enabled === query.enabled)
        .map(summary),
    }),
    searchRules: async (query = {}) => {
      const words = (query.text ?? '')
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 2)
      const answering = state.rules.find(
        (rule) => rule.enabled && ['MOCK', 'PATCH'].includes(rule.type) && catches(rule, query.requestUrl),
      )
      const rules = state.rules
        .map((rule) => {
          const hit = catches(rule, query.requestUrl)
          const text = `${rule.label ?? ''} ${rule.notes ?? ''}`.toLowerCase()
          const score = (hit ? 10 : 0) + words.filter((word) => text.includes(word)).length
          return { rule, hit, score }
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, query.limit ?? 10)
        .map(({ rule, hit }) => ({
          ...summary(rule),
          notes: rule.notes ?? '',
          status: rule.status,
          delay: rule.delay ?? 0,
          hooks: Boolean(rule.responseHook || rule.requestHook),
          ...(rule.isEditBeforeSendEnabled ? { editBeforeSend: rule.editBeforeSendStage ?? 'REQUEST' } : {}),
          catches: hit,
          answers: rule === answering,
          ...(['PATCH', 'MODIFY_HEADERS'].includes(rule.type)
            ? {
                headers: {
                  request: (rule.requestHeaders ?? []).map(({ header, operation }) => ({ header, operation })),
                  response: (rule.responseHeaders ?? []).map(({ header, operation }) => ({ header, operation })),
                },
              }
            : {}),
          ...(hit && rule.type !== 'MODIFY_HEADERS' ? { responsePayload: rule.responsePayload } : {}),
        }))
      return { ok: true, total: rules.length, rules }
    },
    setRuleEnabled: async (id, on) => {
      const rule = findRule(id)
      if (!rule) {
        return fail('RULE_NOT_FOUND', `no rule ${id}`)
      }
      rule.enabled = Boolean(on)
      return { ok: true, rule: summary(rule) }
    },
    deleteRule: async (id) => {
      const rule = findRule(id)
      if (!rule) {
        return fail('RULE_NOT_FOUND', `no rule ${id}`)
      }
      if (!rule.agentCreated) {
        return fail('NOT_DELETABLE', 'only rules an agent created can be deleted')
      }
      state.rules = state.rules.filter((entry) => entry !== rule)
      return { ok: true, deleted: id }
    },
    setRunning: async (on) => {
      state.running = Boolean(on)
      return { ok: true, running: state.running }
    },
  }

  const sdk = { version }
  Object.entries(methods)
    .filter(([name]) => (version >= 4 || V1_METHODS.includes(name)) && (version >= 5 || !V5_METHODS.includes(name)))
    .forEach(([name, method]) => {
      sdk[name] = (...args) => {
        const result = method(...args)
        const record = (value) => {
          log({ method: name, args: clone(args), result: clone(value) })
          return value
        }
        return result instanceof Promise ? result.then(record) : record(result)
      }
    })

  return {
    sdk,
    state,
    // a reload re-captures every request the page makes, when capture is on by then
    reload: () => {
      state.captured = state.capturing
      log({ method: 'location.reload', args: [], result: { capturing: state.capturing } })
    },
  }
}
