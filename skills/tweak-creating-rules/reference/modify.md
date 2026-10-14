# Modify rules

A Modify rule lets the request reach the server and changes only what the rule names, on the
way out or on the way back. Everything else passes through as the page sent it and the
server answered it. Premium; fetch and XHR only.

The type is `"interceptionPolicy": "PATCH"`. That is tweak's name for Modify and has nothing
to do with the HTTP method: `method` still says which method the rule catches.

## Contents

- What it changes
- Which request it catches
- Template and fields
- Limits
- Examples

## What it changes

Set only what the user asked to change. A field left at its default passes through untouched,
and tweak refuses a rule that changes nothing.

| Field                    | Changes                                                       | Default: passes through |
| ------------------------ | ------------------------------------------------------------- | ----------------------- |
| `responseHook`           | the server's body, by code: **the way to change one field**   | none                    |
| `status`                 | the status the page sees                                      | `0`, the server's       |
| `responsePayload`        | replaces the whole body                                       | `""`, the server's body |
| `responseHeaders`        | sets headers on the response the page reads                   | `[]`                    |
| `delay`                  | milliseconds before the request is sent: a slower real answer | `0`                     |
| `outgoingRequestPayload` | replaces the body sent to the server                          | `""`, the page's body   |
| `requestHook`            | rewrites url, method, body or headers before it is sent       | none                    |
| `requestHeaders`         | sets headers on the request                                   | none                    |
| `isEditBeforeSendEnabled` | pauses it for the user to edit by hand ([edit-before-send.md](edit-before-send.md)) | `false`  |

With `responsePayload` left `""`, a response hook's `response` is **the server's own body**,
parsed when it is JSON: change what the user asked for and return it. That keeps live data
live, which is the point of Modify over Mock. The hook contract is in [hooks.md](hooks.md).

`requestHeaders` are set by the page, which the browser forbids for `Cookie`, `Origin`,
`Referer`, `Host`, `Sec-*`, `Proxy-*` and a few more: tweak refuses those on a Modify rule.
A header-only ask is a header rule anyway ([headers.md](headers.md)): free, and it reaches
every request type.

## Which request it catches

As a Mock does. `url` is a case-sensitive **substring** of the full request url (`isRgx: true`
for a JavaScript regex). `method` is one of `GET POST PUT PATCH DELETE HEAD OPTIONS`, or `*`.
`requestPayload` narrows it to requests whose body matches, with
`requestPayloadMatchPolicy`: `EXACT` (default, compared as JSON when both parse), `PARTIAL`
(contained: a substring, or every JSON field it names) or `ANY`. `""` matches any body. Take a
body to match from the captured request, never from the page's rendered text.

## Template and fields

Every field shown is required by tweak's import page; JSON goes into `responsePayload` and
`outgoingRequestPayload` as a **string**.

```json
{
  "interceptionPolicy": "PATCH",
  "label": "Account: plan shows as free",
  "notes": "The rest of the account stays live.",
  "url": "/api/account",
  "isRgx": false,
  "method": "GET",
  "status": 0,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": [],
  "responsePayload": "",
  "responseHook": "response.plan = 'free';\nreturn response;"
}
```

| Field                       | Notes                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `label`                     | What the rule does, in a few words. Markdown, 256 characters max                           |
| `notes`                     | Why it exists, for whoever reads it later. Markdown, optional (`""`)                       |
| `status`                    | `0` keeps the server's, or 100-599                                                         |
| `responseHeaders`           | Rows `{ "header", "value", "active": true }`, set over the server's                        |
| `requestPayloadMatchPolicy` | Optional. `EXACT`, `PARTIAL` or `ANY`; leave it out with an empty `requestPayload`         |
| `requestHeaders`            | Optional. Rows `{ "header", "value" }` set on the request                                  |
| `outgoingRequestPayload`    | Optional. The whole body sent instead of the page's                                        |
| `responseHook`, `requestHook` | Optional. The body of a function, see [hooks.md](hooks.md)                               |
| `isLogpointEnabled`         | Optional. `false` mutes tweak's console log for this rule                                  |
| `isEditBeforeSendEnabled`, `editBeforeSendStage` | Optional. Pause for the user to edit it by hand: [edit-before-send.md](edit-before-send.md) |

## Limits

- **Premium.** On the free plan offer a Mock instead: the captured real response with the
  change written in ([mock.md](mock.md)). Imported from a file on the free plan, a Modify rule
  becomes a Mock.
- fetch and XHR only. Images, scripts, stylesheets and page loads need a Redirect or a header
  rule.
- The first enabled rule that catches a request answers it: a Mock on the same url wins over
  this rule. In the browser, `searchRules` tells you (`answers: true`).
- A hook an agent writes runs only on the site it was written from ([hooks.md](hooks.md)).

## Examples

Each block is one rule. The headings are what a user typed.

### "Show my account as on the free plan, keep everything else real"

```json
{
  "interceptionPolicy": "PATCH",
  "label": "Account: plan shows as free",
  "notes": "",
  "url": "/api/account",
  "isRgx": false,
  "method": "GET",
  "status": 0,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": [],
  "responsePayload": "",
  "responseHook": "response.plan = 'free';\nreturn response;"
}
```

### "Make the real /api/orders fail with a 500, keep its body"

```json
{
  "interceptionPolicy": "PATCH",
  "label": "Orders: real body, status 500",
  "notes": "",
  "url": "/api/orders",
  "isRgx": false,
  "method": "GET",
  "status": 500,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": [],
  "responsePayload": ""
}
```

### "Slow the real search api down by 3 seconds"

```json
{
  "interceptionPolicy": "PATCH",
  "label": "Search: real answer, 3s late",
  "notes": "",
  "url": "/api/search",
  "isRgx": false,
  "method": "GET",
  "status": 0,
  "delay": 3000,
  "requestPayload": "",
  "responseHeaders": [],
  "responsePayload": ""
}
```

### "Add to cart with quantity 0, whatever the page sends"

A request hook rewrites the body the page built; `body` is the raw string it sent.

```json
{
  "interceptionPolicy": "PATCH",
  "label": "Cart: add with quantity 0",
  "notes": "",
  "url": "/api/cart/items",
  "isRgx": false,
  "method": "POST",
  "status": 0,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": [],
  "responsePayload": "",
  "requestHook": "const data = JSON.parse(body);\ndata.quantity = 0;\nreturn { method, url, body: JSON.stringify(data), headers };"
}
```
