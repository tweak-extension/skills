/*
 * What a case's `checks` are written with. Every grader is code: an assertion over the run,
 * never a model's opinion of it, so a failure names the field that regressed.
 */
import { readRules, validateRules } from '../../skills/tweak-creating-rules/scripts/validate-rules.mjs'

const FORCED_TYPE = {
  createMockRule: 'MOCK',
  createModifyRule: 'PATCH',
  createHeaderRule: 'MODIFY_HEADERS',
  createRedirectRule: 'REDIRECT',
}
export const CREATE_METHODS = ['createRules', ...Object.keys(FORCED_TYPE)]

/** Every ```json block of `text` that parses, in order. */
export function jsonBlocks(text) {
  return [...String(text).matchAll(/```json\s*\n([\s\S]*?)```/g)].flatMap(([, block]) => {
    try {
      return [JSON.parse(block)]
    } catch {
      return []
    }
  })
}

/**
 * The rules a file-mode run delivered: the JSON file it wrote when there is one, otherwise the
 * last JSON block in its answer that carries rules. `null` when it delivered none.
 */
export function deliveredRules(run) {
  const file = Object.entries(run.files).find(([name]) => name.endsWith('.json'))
  if (file) {
    try {
      return readRules(JSON.parse(file[1]))
    } catch {
      return []
    }
  }
  const block = jsonBlocks(run.text)
    .filter((value) => readRules(value).some((rule) => rule?.interceptionPolicy))
    .at(-1)
  return block ? readRules(block) : null
}

/** The validator's verdict on what a file-mode run delivered. */
export function validateDelivered(run) {
  const rules = deliveredRules(run)
  return rules ? validateRules(rules) : { errors: ['no rules delivered'], warnings: [] }
}

/** SDK calls by method name; with no name, every call. */
export function calls(run, method) {
  return method ? run.sdkCalls.filter((call) => call.method === method) : run.sdkCalls
}

/** Index of the first call to any of `methods`, or -1. */
export function firstCall(run, ...methods) {
  return run.sdkCalls.findIndex((call) => methods.includes(call.method))
}

/** Every create call, in order. */
export function createCalls(run) {
  return run.sdkCalls.filter((call) => CREATE_METHODS.includes(call.method))
}

/** The rules tweak accepted from the agent, as it wrote them (type filled in). */
export function createdRules(run) {
  return createCalls(run)
    .filter((call) => call.result?.ok)
    .flatMap((call) => {
      const [input] = call.args
      const rules = call.method === 'createRules' ? readRules(input) : [input]
      return rules.map((rule) => ({ interceptionPolicy: FORCED_TYPE[call.method] ?? 'MOCK', ...rule }))
    })
}

/** A response payload as data, whether the agent wrote a string or an object. */
export function payload(rule) {
  const value = rule?.responsePayload
  if (typeof value !== 'string') {
    return value
  }
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** True when `text` mentions any of `needles`, case-insensitively. */
export function mentions(text, ...needles) {
  const haystack = String(text).toLowerCase()
  return needles.some((needle) => haystack.includes(needle.toLowerCase()))
}

/** Collects named checks for one run. */
export function createChecker() {
  const results = []
  const check = (name, pass, detail) => {
    results.push({ name, pass: Boolean(pass), ...(pass ? {} : detail === undefined ? {} : { detail }) })
    return Boolean(pass)
  }
  return { check, results }
}
