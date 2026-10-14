# Header rules

A header rule sets, appends or removes HTTP headers on matching requests and their
responses. The browser applies it (tweak installs it through `declarativeNetRequest`), so it
reaches every request type — fetch/XHR, page loads, scripts, images, iframes — and it can set
headers a page cannot (`User-Agent`, `Accept-Encoding`; `Origin`, `Referer` and `Cookie` from an
import file only, see below). Free.

The type is `"interceptionPolicy": "MODIFY_HEADERS"`.

## Contents

- Rows
- What to catch
- Template and fields
- Headers a page cannot change
- Limits
- Examples

## Rows

`requestHeaders` change what is sent, `responseHeaders` what comes back; a rule needs at least
one row in either. Each row:

```json
{ "header": "X-Debug", "value": "1", "operation": "set" }
```

| `operation`     | Does                                                         | `value`          |
| --------------- | ------------------------------------------------------------ | ---------------- |
| `set` (default) | replaces the header, or adds it when missing                 | required         |
| `append`        | adds a value next to the existing one                        | required         |
| `remove`        | strips the header                                            | `""`, not read   |

The browser appends to a **request** header only when it is one of `Accept`,
`Accept-Encoding`, `Accept-Language`, `Access-Control-Request-Headers`, `Cache-Control`,
`Connection`, `Content-Language`, `Cookie`, `Forwarded`, `If-Match`, `If-None-Match`,
`Keep-Alive`, `Range`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`, `User-Agent`, `Via`,
`Want-Digest` or `X-Forwarded-For`; use `set` for any other. Response headers take `append`
on any name (`Set-Cookie` is the classic). A header name is letters, digits and
``!#$%&'*+-.^_`|~``: no spaces, no colon.

## What to catch

`url` is a case-sensitive **substring** of the request url; `isRgx: true` reads it as a
regular expression in RE2 syntax (no lookarounds, no backreferences). Pick the api's host or
path, never a pattern that catches every site: the rule changes every request it catches.
`method` is `*` unless the user names one.

`headerRuleScope` is `ACTIVE_TAB`: the rule applies only on the tab where tweak is running.
`GLOBAL` (every tab, even with tweak stopped) imports from a file, and only when the user asks
for it; tweak refuses it from a page.

## Template and fields

Every field shown is required by tweak's import page; `status`, `delay` and `requestPayload`
mean nothing to a header rule, keep them as shown.

```json
{
  "interceptionPolicy": "MODIFY_HEADERS",
  "label": "Api: debug header",
  "notes": "",
  "url": "api.example.com",
  "isRgx": false,
  "method": "*",
  "requestHeaders": [{ "header": "X-Debug", "value": "1", "operation": "set" }],
  "responseHeaders": [],
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": ""
}
```

## Headers a page cannot change

Some headers are how sites defend themselves from each other: request `Cookie`, `Origin`,
`Referer` and `Sec-*`; response `Set-Cookie`, `Content-Security-Policy`, `X-Frame-Options`,
`Access-Control-*` and `Cross-Origin-*`. Through `window.tweak` a rule touching one is refused
(`UNSUPPORTED_FIELD`), because any page could ask for it. That refusal is final for the page
API: do not retry it with another name or a regex. Show the rule in your answer as a `json`
block with the import link and steps instead (SKILL.md, step 6), say why, and let the user
import it. In a file every one
of them works: removing `Content-Security-Policy` to debug, or a CORS header for a local api.

## Limits

- Headers only: a body or a status is a Mock or Modify job ([mock.md](mock.md),
  [modify.md](modify.md)).
- Like a redirect, it applies only while tweak is **running** on the tab, and to requests made
  after that: reload, or repeat what makes the request.
- `{{variables}}` cannot be written by an agent: write the value out. Never put a token you
  read off the page into a row; a credential comes from the user.

## Examples

Each block is one rule. The headings are what a user typed.

### "Send X-Feature-Flag: new-checkout on every call to our api"

```json
{
  "interceptionPolicy": "MODIFY_HEADERS",
  "label": "Api: new-checkout flag",
  "notes": "",
  "url": "api.example.com",
  "isRgx": false,
  "method": "*",
  "requestHeaders": [{ "header": "X-Feature-Flag", "value": "new-checkout", "operation": "set" }],
  "responseHeaders": [],
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": ""
}
```

### "Load the site in Portuguese: add pt-PT to Accept-Language"

```json
{
  "interceptionPolicy": "MODIFY_HEADERS",
  "label": "Prefer Portuguese",
  "notes": "",
  "url": "shop.example.com",
  "isRgx": false,
  "method": "*",
  "requestHeaders": [{ "header": "Accept-Language", "value": "pt-PT", "operation": "append" }],
  "responseHeaders": [],
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": ""
}
```

### "Stop the browser caching the api's answers"

```json
{
  "interceptionPolicy": "MODIFY_HEADERS",
  "label": "Api: no caching",
  "notes": "",
  "url": "api.example.com",
  "isRgx": false,
  "method": "GET",
  "requestHeaders": [],
  "responseHeaders": [
    { "header": "Cache-Control", "value": "no-store", "operation": "set" },
    { "header": "ETag", "value": "", "operation": "remove" }
  ],
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": ""
}
```

### "Let my local app call the staging api: allow CORS from localhost:3000" (import file)

A CORS header can only come from a file the user imports, never through `window.tweak`.

```json
{
  "interceptionPolicy": "MODIFY_HEADERS",
  "label": "Staging api: CORS for localhost:3000",
  "notes": "",
  "url": "staging-api.example.com",
  "isRgx": false,
  "method": "*",
  "requestHeaders": [],
  "responseHeaders": [
    { "header": "Access-Control-Allow-Origin", "value": "http://localhost:3000", "operation": "set" },
    { "header": "Access-Control-Allow-Credentials", "value": "true", "operation": "set" }
  ],
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": ""
}
```
