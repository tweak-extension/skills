# Mock rules

A Mock rule catches a request the page makes with `fetch` or `XMLHttpRequest` and answers it
itself: the server is never called.

## Contents

- The request
- Matching the request body
- The response
- Template and fields
- Limits
- Examples

## The request

`url` is a case-sensitive **substring** of the full request url: `/api/cart`, not the whole
url with its query string. Set `isRgx: true` only when a substring cannot say it (JavaScript
regex syntax). `method` is one of `GET POST PUT PATCH DELETE HEAD OPTIONS`, or `*` for any.

## Matching the request body

Many requests share one url — every GraphQL operation POSTs to `/graphql` — so the url alone
cannot pick one out. `requestPayload` narrows the rule to requests whose body matches it, in one
of two ways (`requestPayloadMatchPolicy`):

| Policy            | Matches when the body                                                                              | Plan    |
| ----------------- | -------------------------------------------------------------------------------------------------- | ------- |
| `EXACT` (default) | equals `requestPayload` — compared as JSON when both parse, so spacing and key order do not matter | free    |
| `PARTIAL`         | contains it: a substring, or for JSON, every field it names with the same value                    | premium |

`PARTIAL` is the tool for GraphQL: `{"operationName":"getProduct","variables":{"productId":1}}`
catches that one operation for that one product, whatever its query text. The tweak UI calls
the two **Equals** and **Contains**, the bar over the rule's Request payload tab, beside **Any**
(`ANY`, which ignores the body). Newer tweak versions store an empty payload as `ANY`; older
ones refuse the value, so to match any body leave `requestPayload` empty and the policy out. Take the body
from the captured request (`searchRequests`), never from the page's rendered text.
`requestPayload` may be a plain object in the browser; in a file, a JSON string. On the free
plan, only `EXACT` — or narrow by url. Never `PARTIAL` with `{}` or `[]`: an empty container is
contained in every JSON body, and tweak warns.

**A form body** (`application/x-www-form-urlencoded`, a classic `<form>` post or
`URLSearchParams`) is matched field by field, in any order, once the rule's `requestHeaders`
has that Content-Type row. Free. Use the captured request's `contentType` to tell:

```json
"requestHeaders": [{ "header": "Content-Type", "value": "application/x-www-form-urlencoded" }],
"requestPayload": "user=ada&remember=1"
```

`EXACT` then means the same fields with the same values, in any order; `PARTIAL` means at least
these fields. In the browser `requestPayload` may be an object (`{ "user": "ada" }`), written
as the form string for you. A Mock never sends its request, so Content-Type is the only request
header it takes; any other is refused (a header rule sets headers: [headers.md](headers.md)).

## The response

Keep the shape of the real api: same keys, same nesting, plausible values. When the real
response is known (the user pasted it, or you read it off the page), start from it and change
only what the user asked for. A status without a body is rarely what a frontend expects; an
error usually wants the api's own error shape.

## Template and fields

Every field is required by tweak's import page. `responsePayload` is a **string**: serialize
JSON into it.

```json
{
  "interceptionPolicy": "MOCK",
  "label": "Cart: payment service down",
  "notes": "Checks the checkout error banner.",
  "url": "/api/cart",
  "isRgx": false,
  "method": "GET",
  "status": 503,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": [{ "header": "Content-Type", "value": "application/json; charset=utf-8", "active": true }],
  "responsePayload": "{\"error\":{\"code\":\"PAYMENT_UNAVAILABLE\",\"message\":\"Try again later\"}}"
}
```

| Field                       | Notes                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `label`                     | What the rule does, in a few words. Markdown, 256 characters max. Shown on the rule's row    |
| `notes`                     | Why it exists, for whoever reads it later. Markdown, optional (`""`)                         |
| `status`                    | 100-599                                                                                      |
| `delay`                     | Milliseconds before answering. Use it for "slow network" asks                                |
| `requestPayload`            | `""` matches any body. Set it to tell requests to one url apart: "Matching the request body" |
| `requestPayloadMatchPolicy` | Optional. `EXACT` (default) or `PARTIAL` (premium). Leave it out with an empty payload       |
| `requestHeaders`            | Optional. Only a Content-Type row: `application/x-www-form-urlencoded` makes it a form match |
| `isLogpointEnabled`         | Optional. `false` mutes tweak's console log for this rule (premium); default `true`          |
| `isEditBeforeSendEnabled`, `editBeforeSendStage` | Optional. Pause for the user to edit it by hand (premium): [edit-before-send.md](edit-before-send.md) |
| `responseHeaders`           | Always a Content-Type row. `text/plain`, `text/html` or other types for non-JSON payloads    |

## Limits

- Mock covers `fetch` and XHR only. Images, scripts, stylesheets and page loads need a
  Redirect rule ([redirect.md](redirect.md)).
- A rule does nothing until tweak is **running** on the tab (the Run button, or an
  auto-enabled site).
- The first enabled rule that matches wins, so keep `url` specific when several rules exist.
- A response computed by code (random values, fields derived from the request) is a hook:
  [hooks.md](hooks.md). Hooks are premium; on the free plan write the values out in
  `responsePayload`.
- The server's real answer with one thing changed is a Modify rule (premium,
  [modify.md](modify.md)). On the free plan, a Mock of the captured response with the change
  written in is the way.
- The breakpoint (pausing devtools on a match) and "Edit before send" are the user's to switch
  on in tweak: setting either is refused (`UNSUPPORTED_FIELD`). Tell the user where they are.

## Examples

Each block is one rule. The headings are what a user typed.

### "Show me the empty state of my orders page"

```json
{
  "interceptionPolicy": "MOCK",
  "label": "Orders: none yet",
  "notes": "",
  "url": "/api/orders",
  "isRgx": false,
  "method": "GET",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": [{ "header": "Content-Type", "value": "application/json; charset=utf-8", "active": true }],
  "responsePayload": "{\"orders\":[],\"total\":0}"
}
```

### "What happens when login fails with a 401?"

The body copies the api's real error shape; the frontend reads `error.message`.

```json
{
  "interceptionPolicy": "MOCK",
  "label": "Login: wrong password",
  "notes": "",
  "url": "/auth/login",
  "isRgx": false,
  "method": "POST",
  "status": 401,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": [{ "header": "Content-Type", "value": "application/json; charset=utf-8", "active": true }],
  "responsePayload": "{\"error\":{\"code\":\"INVALID_CREDENTIALS\",\"message\":\"Email or password is incorrect\"}}"
}
```

### "Make search take 5 seconds so I can see the spinner"

```json
{
  "interceptionPolicy": "MOCK",
  "label": "Search: 5s latency",
  "notes": "",
  "url": "/api/search",
  "isRgx": false,
  "method": "GET",
  "status": 200,
  "delay": 5000,
  "requestPayload": "",
  "responseHeaders": [{ "header": "Content-Type", "value": "application/json; charset=utf-8", "active": true }],
  "responsePayload": "{\"results\":[{\"id\":1,\"title\":\"First result\"}]}"
}
```

### "Mock getProduct for product 1 in our GraphQL api" (premium)

Every operation POSTs to `/graphql`, so the body picks this one out, partially: the operation
name and the variable, whatever the query text around them.

```json
{
  "interceptionPolicy": "MOCK",
  "label": "GraphQL `getProduct` 1: out of stock",
  "notes": "",
  "url": "/graphql",
  "isRgx": false,
  "method": "POST",
  "status": 200,
  "delay": 0,
  "requestPayload": "{\"operationName\":\"getProduct\",\"variables\":{\"productId\":1}}",
  "requestPayloadMatchPolicy": "PARTIAL",
  "responseHeaders": [{ "header": "Content-Type", "value": "application/json; charset=utf-8", "active": true }],
  "responsePayload": "{\"data\":{\"product\":{\"id\":1,\"stock\":0}}}"
}
```

On the free plan, `EXACT` with the whole captured body, or the url when the page puts the
operation there (`/graphql?op=getProduct`).

### "Return this CSV from /export"

```json
{
  "interceptionPolicy": "MOCK",
  "label": "Export: two rows",
  "notes": "",
  "url": "/export.csv",
  "isRgx": false,
  "method": "GET",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": [{ "header": "Content-Type", "value": "text/csv", "active": true }],
  "responsePayload": "id,name\n1,Ada\n2,Grace"
}
```
