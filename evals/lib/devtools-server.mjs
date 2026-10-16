#!/usr/bin/env node
/*
 * A stdio MCP server standing in for a browser-automation tool that launches its OWN browser
 * (Chrome DevTools MCP, Playwright, Puppeteer): a fresh profile with no extensions, so no tweak.
 * A terminal session that has one installed must not open it to push or check a rule. The cases
 * grade the transcript's tool calls; every call is also appended to EVAL_DEVTOOLS_LOG as JSONL.
 *
 *   EVAL_DEVTOOLS_LOG=<calls.jsonl> node devtools-server.mjs
 *
 * Tool names follow chrome-devtools-mcp's, so the agent sees what a real install offers.
 */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { createPage } from './page-server.mjs'

const BLANK = 'about:blank'

const tool = (name, description, properties = {}, required = []) => ({
  name,
  description,
  inputSchema: { type: 'object', properties, required },
})

export const TOOLS = [
  tool('list_pages', 'Get a list of pages open in the browser.'),
  tool('new_page', 'Creates a new page and navigates it to the URL.', { url: { type: 'string' } }, ['url']),
  tool('navigate_page', 'Navigates the currently selected page to a URL.', { url: { type: 'string' } }, ['url']),
  tool(
    'evaluate_script',
    'Evaluate a JavaScript function inside the currently selected page. Returns the response as JSON.',
    { function: { type: 'string', description: 'A JavaScript function declaration to run in the page.' } },
    ['function'],
  ),
  tool('take_snapshot', 'Take a text snapshot of the currently selected page.'),
  tool('take_screenshot', 'Take a screenshot of the page.'),
  tool('list_network_requests', 'List all requests for the currently selected page.'),
]

/** What the fresh browser answers: a page with no tweak in it, whatever the agent does. */
export function createBrowser() {
  let url = BLANK
  return async (name, args = {}) => {
    if (name === 'new_page' || name === 'navigate_page') {
      url = String(args.url ?? BLANK)
      return `Navigated to ${url}.`
    }
    if (name === 'list_pages') {
      return `0: ${url} [selected]`
    }
    if (name === 'evaluate_script') {
      const page = createPage({ url: url.startsWith('http') ? url : 'https://example.test/', missingSdk: true }, () => {})
      const source = String(args.function ?? '')
      return page.run(`(async () => JSON.stringify(await (${source})()))()`)
    }
    if (name === 'list_network_requests') {
      return 'No requests found.'
    }
    return `Page ${url}: empty.`
  }
}

function serve() {
  const browser = createBrowser()
  const log = process.env.EVAL_DEVTOOLS_LOG
  const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)

  const handle = async ({ id, method, params }) => {
    if (method === 'initialize') {
      return {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'chrome-devtools', version: '1.0.0' },
      }
    }
    if (method === 'tools/list') {
      return { tools: TOOLS }
    }
    if (method === 'tools/call') {
      if (log) {
        appendFileSync(log, `${JSON.stringify({ tool: params?.name, args: params?.arguments ?? {} })}\n`)
      }
      try {
        return { content: [{ type: 'text', text: await browser(params?.name, params?.arguments) }] }
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
