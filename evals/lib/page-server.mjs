#!/usr/bin/env node
/*
 * A stdio MCP server standing in for a browser-driving tool (Claude in Chrome's javascript tool):
 * one tool, `run_page_script`, that runs the agent's JavaScript in a fake tab whose
 * `window.__TWEAK_SDK__` is fake-tweak.mjs. Every SDK call is appended to EVAL_SDK_LOG as JSONL.
 *
 *   EVAL_SCENARIO=<scenario.json> EVAL_SDK_LOG=<calls.jsonl> node page-server.mjs
 *
 * Zero dependencies: newline-delimited JSON-RPC 2.0, the three methods Claude Code calls.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { createFakeTweak } from './fake-tweak.mjs'

const SCRIPT_TIMEOUT_MS = 10_000
// what Claude in Chrome answers instead of output shaped like a query string or a cookie
export const BLOCKED_OUTPUT = '[BLOCKED: Cookie/query string data]'
const QUERY_STRING_RGX = /[\w.%-]+=[^&\s"']*&[\w.%-]+=/

/** A vm context dressed as the scenario's tab, just far enough for the skill's snippets. */
export function createPage(scenario, log) {
  const tweak = createFakeTweak(scenario, log)
  const resources = scenario.resources ?? []
  const images = resources.filter((entry) => entry.initiatorType === 'img').map((entry) => ({ src: entry.name }))
  const url = new URL(scenario.url ?? 'https://shop.test/')
  const window = {
    // a tab without tweak's page API: not installed, a store build, or a tab older than tweak
    ...(scenario.missingSdk ? {} : { __TWEAK_SDK__: tweak.sdk, tweak: tweak.sdk }),
    location: {
      href: url.href,
      origin: url.origin,
      hostname: url.hostname,
      pathname: url.pathname,
      reload: tweak.reload,
    },
    document: {
      title: scenario.title ?? '',
      images,
      body: { innerText: scenario.documentText ?? '' },
      querySelectorAll: (selector) => (selector === 'img' ? images : []),
    },
    performance: {
      getEntriesByType: (type) => (type === 'resource' ? resources : []),
    },
  }
  window.window = window
  window.globalThis = window
  const context = vm.createContext({
    ...window,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
  })

  return {
    tweak,
    async run(code) {
      const value = await Promise.race([
        vm.runInContext(code, context, { timeout: SCRIPT_TIMEOUT_MS }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('script timed out')), SCRIPT_TIMEOUT_MS)),
      ])
      if (value === undefined) {
        return 'undefined'
      }
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      // `blocksQueryStrings`: the tool refuses to print a raw form body, as Claude in Chrome does
      return scenario.blocksQueryStrings && QUERY_STRING_RGX.test(text) ? BLOCKED_OUTPUT : text
    },
  }
}

function serve() {
  const scenario = JSON.parse(readFileSync(process.env.EVAL_SCENARIO, 'utf8'))
  const logFile = process.env.EVAL_SDK_LOG
  const page = createPage(scenario, (entry) => appendFileSync(logFile, `${JSON.stringify(entry)}\n`))
  const tool = {
    name: 'run_page_script',
    description:
      `Runs JavaScript in the user's active browser tab (${scenario.url}) and returns the value of ` +
      'the last expression as text; a returned promise is awaited. Use it to read the page and ' +
      'to call the APIs the page exposes.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'JavaScript to run in the page' } },
      required: ['code'],
    },
  }
  const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)

  const handle = async ({ id, method, params }) => {
    if (method === 'initialize') {
      return {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'browser', version: '1.0.0' },
      }
    }
    if (method === 'tools/list') {
      return { tools: [tool] }
    }
    if (method === 'tools/call') {
      try {
        const text = await page.run(String(params?.arguments?.code ?? ''))
        return { content: [{ type: 'text', text }] }
      } catch (error) {
        return { content: [{ type: 'text', text: `${error?.name ?? 'Error'}: ${error?.message}` }], isError: true }
      }
    }
    if (method === 'ping') {
      return {}
    }
    if (id !== undefined) {
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 })
    }
    return undefined
  }

  createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) {
      return
    }
    const message = JSON.parse(line)
    try {
      const result = await handle(message)
      if (message.id !== undefined) {
        send({ id: message.id, result })
      }
    } catch (error) {
      send({ id: message.id, error: { code: error.code ?? -32603, message: error.message } })
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serve()
}
