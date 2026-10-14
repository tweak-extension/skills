/*
 * The two matchers node:assert lacks: a partial deep match (vitest's toMatchObject) and a few
 * asymmetric values to use inside it. No test framework dependency.
 */
import assert from 'node:assert/strict'

const MATCHER = Symbol('matcher')

const matcher = (description, test) => ({ [MATCHER]: true, description, test })

/** Any value of `type`: String, Number, Boolean, Function, Array or Object. */
export const any = (type) =>
  matcher(`any ${type.name}`, (value) =>
    type === Array
      ? Array.isArray(value)
      : type === Object
        ? value !== null && typeof value === 'object'
        : typeof value === type.name.toLowerCase() || value instanceof type,
  )

/** A string that contains `part`. */
export const stringContaining = (part) =>
  matcher(`string containing ${JSON.stringify(part)}`, (value) => typeof value === 'string' && value.includes(part))

function mismatch(actual, expected, at) {
  if (expected?.[MATCHER]) {
    return expected.test(actual) ? null : `${at}: expected ${expected.description}, got ${JSON.stringify(actual)}`
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return `${at}: expected an array of ${expected.length}, got ${JSON.stringify(actual)}`
    }
    return expected.map((item, index) => mismatch(actual[index], item, `${at}[${index}]`)).find(Boolean) ?? null
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') {
      return `${at}: expected an object, got ${JSON.stringify(actual)}`
    }
    return (
      Object.entries(expected)
        .map(([key, value]) => mismatch(actual[key], value, `${at}.${key}`))
        .find(Boolean) ?? null
    )
  }
  return Object.is(actual, expected) ? null : `${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
}

/** Fails unless `actual` has every property of `expected` (recursively); arrays match in full. */
export function assertMatches(actual, expected) {
  const problem = mismatch(actual, expected, 'value')
  if (problem) {
    assert.fail(problem)
  }
}

/** Fails unless some item of `list` matches `expected` partially. */
export function assertSomeMatch(list, expected) {
  assert.ok(
    list.some((item) => !mismatch(item, expected, 'value')),
    `no item matches ${JSON.stringify(expected)} in ${JSON.stringify(list)}`,
  )
}
