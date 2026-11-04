# Block rules

A Block rule cancels a matching request before it leaves the browser. The browser applies it
(tweak installs it through `declarativeNetRequest`), so like a Redirect it reaches every kind
of request: fetch/XHR, scripts, stylesheets, images, fonts, media, iframes and page loads.
The request never reaches the server, and the page sees a network error: `fetch` rejects with
a `TypeError`, an XHR fires `error`, and the network panel reads `net::ERR_BLOCKED_BY_CLIENT`.

## Contents

- Block or Mock?
- What to catch
- Template and fields
- Limits
- Examples

## Block or Mock?

| The user wants                                                                      | Type                 |
| ----------------------------------------------------------------------------------- | -------------------- |
| The request to fail with no answer at all: offline, a dropped connection, a network error | Block           |
| A script, stylesheet, image or font to never load: analytics, a chat widget, ads    | Block                |
| An error the server answers with: 500, 404, 401, a timeout status                   | Mock ([mock.md](mock.md)) |
| The request to arrive late, or to hang for a while and then answer                  | Mock with a `delay`  |

"Make it fail" with no status named is ambiguous: a status code is something a server sends,
so a Mock; "never reaches the server", "network error", "offline", "blocked" or "never loads"
is a Block.

## What to catch

`url` is a case-sensitive **substring** of the request url. Set `isRgx: true` only when a
substring cannot say it; the syntax is RE2 (no lookarounds, no backreferences). `method` is `*`
unless the user names one. `redirectTargetType` (the "Catch" option, named after the redirect
it shares with) narrows the request type:

| `redirectTargetType` | Catches            |
| -------------------- | ------------------ |
| `ALL`                | anything (default) |
| `XHR`                | fetch / XHR        |
| `SCRIPT`             | scripts            |
| `DOCUMENT`           | page navigations   |
| `IFRAME`             | iframes            |
| `STYLESHEET`         | stylesheets        |
| `IMAGE`              | images             |
| `MEDIA`              | audio / video      |
| `FONT`               | fonts              |

Every type is a free feature. **Prefer the narrowest one that fits**, and a `url` that names
only what the user wants gone: `ALL` also catches the page itself when `url` matches its
address, and a blocked page load leaves the user on an error page.

## Template and fields

Every field is required by tweak's import page; `status`, `delay`, `requestPayload` and
`responseHeaders` mean nothing to a block, keep them as shown. A block has no `redirectUrl`.

```json
{
  "interceptionPolicy": "BLOCK",
  "label": "Analytics: blocked",
  "notes": "",
  "url": "analytics.example.com",
  "isRgx": false,
  "method": "*",
  "redirectTargetType": "ALL",
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": []
}
```

`headerRuleScope` is `ACTIVE_TAB`: the rule applies only on the tab where tweak is running.
`GLOBAL` (every tab, always) imports from a file but tweak refuses it from a page; use it only
in a file, and only when the user asks for it.

## Limits

- A block cannot answer the request: an error status, a body or a delay is a Mock.
- It cannot tell two requests to the same url apart by body: a GraphQL operation is a Mock
  with a body match ([mock.md](mock.md)).
- Block rules arrived in tweak 10.4. An older tweak refuses them, from a file or a page.

## Examples

Each block is one rule. The headings are what a user typed.

### "Show me what the cart page does when the cart api is unreachable"

```json
{
  "interceptionPolicy": "BLOCK",
  "label": "Cart api: unreachable",
  "notes": "The page sees a network error, as if the user were offline.",
  "url": "/api/cart",
  "isRgx": false,
  "method": "*",
  "redirectTargetType": "XHR",
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": []
}
```

### "Stop the Google Analytics script from loading"

```json
{
  "interceptionPolicy": "BLOCK",
  "label": "Google Analytics script: blocked",
  "notes": "",
  "url": "googletagmanager.com/gtag/js",
  "isRgx": false,
  "method": "*",
  "redirectTargetType": "SCRIPT",
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": []
}
```

### "Make checkout fail: block POSTs to the orders and payments endpoints"

```json
{
  "interceptionPolicy": "BLOCK",
  "label": "Checkout: orders and payments blocked",
  "notes": "",
  "url": "^https://api\\.example\\.com/v1/(orders|payments)",
  "isRgx": true,
  "method": "POST",
  "redirectTargetType": "XHR",
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": []
}
```

### "Hide every image from the CDN so I can check the alt texts"

```json
{
  "interceptionPolicy": "BLOCK",
  "label": "CDN images: blocked",
  "notes": "",
  "url": "images.example.com",
  "isRgx": false,
  "method": "*",
  "redirectTargetType": "IMAGE",
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": []
}
```
