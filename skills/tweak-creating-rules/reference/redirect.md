# Redirect rules

A Redirect rule sends a matching request to another url. The browser applies it (tweak
installs it through `declarativeNetRequest`), so unlike a Mock it reaches every kind of
request: fetch/XHR, scripts, stylesheets, images, fonts, media, iframes and page loads.

## Contents

- What to catch
- Where it goes
- Template and fields
- Limits
- Examples

## What to catch

`url` is a case-sensitive **substring** of the request url. Set `isRgx: true` only when a
substring cannot say it; the syntax is RE2 (no lookarounds, no backreferences).
`redirectTargetType` narrows the request type:

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

Every type is available on every plan. Prefer the narrowest one that fits: `ALL` also
catches the page itself when `url` matches its address.

## Where it goes

tweak infers the redirect from the shape of `redirectUrl`:

| `redirectUrl`                         | Result                                                 |
| ------------------------------------- | ------------------------------------------------------ |
| `http://localhost:5006` (origin only) | scheme, host and port swapped; **path and query kept** |
| `https://cdn.example.com/cat.png`     | every match goes to exactly this url                   |
| `/v2/users`, `?debug=1`, `#top`       | that part rewritten, origin kept                       |
| `https://example.com/\1` + `isRgx`    | regex substitution with the capture groups of `url`    |

Only `http(s)` urls. With `isRgx: true` the `redirectUrl` must be a whole absolute url.

**The `redirectUrl` must not match `url` itself**, or the redirected request is caught again
and the browser gives up with too many redirects. "Every image to a placeholder" is the
classic: match the site's own image host, not every `.png`.

## Template and fields

Every field is required by tweak's import page; `status`, `delay`, `requestPayload` and
`responseHeaders` mean nothing to a redirect, keep them as shown.

```json
{
  "interceptionPolicy": "REDIRECT",
  "label": "Api calls to my local server",
  "notes": "",
  "url": "api.example.com",
  "isRgx": false,
  "method": "*",
  "redirectUrl": "http://localhost:5006",
  "redirectTargetType": "XHR",
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": []
}
```

`method` is `*` unless the user names one. `headerRuleScope` is `ACTIVE_TAB`: the rule applies
only on the tab where tweak is running. `GLOBAL` (every tab, always) imports from a file but
tweak refuses it from a page; use it only in a file, and only when the user asks for it.

## Limits

- A redirect cannot change a response body or status: that is a Mock ([mock.md](mock.md)).
- The target server must allow the page's origin (CORS) for a redirected fetch/XHR to be
  readable, same as any cross-origin request.

## Examples

Each block is one rule. The headings are what a user typed.

### "Point the api at my local server on port 5006"

Origin only, so `/users?id=1` on the api becomes `http://localhost:5006/users?id=1`.

```json
{
  "interceptionPolicy": "REDIRECT",
  "label": "Api to localhost:5006",
  "notes": "",
  "url": "api.example.com",
  "isRgx": false,
  "method": "*",
  "redirectUrl": "http://localhost:5006",
  "redirectTargetType": "XHR",
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": []
}
```

### "Load my local build of app.js instead of the CDN one"

```json
{
  "interceptionPolicy": "REDIRECT",
  "label": "app.js from the local dev server",
  "notes": "",
  "url": "cdn.example.com/static/app.",
  "isRgx": false,
  "method": "*",
  "redirectUrl": "http://localhost:3000/app.js",
  "redirectTargetType": "SCRIPT",
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": []
}
```

### "Replace every image on this page with a placeholder"

The site's image host is what keeps the placeholder itself out of the match (see "Where it
goes" above).

```json
{
  "interceptionPolicy": "REDIRECT",
  "label": "All images to a placeholder",
  "notes": "",
  "url": "images.example.com",
  "isRgx": false,
  "method": "*",
  "redirectUrl": "https://placehold.co/600x400.png",
  "redirectTargetType": "IMAGE",
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": []
}
```

When the page serves images from several hosts, write one rule per host rather than a
pattern broad enough to catch the placeholder.

### "Call v2 of the users endpoint instead of v1"

```json
{
  "interceptionPolicy": "REDIRECT",
  "label": "Users api v1 to v2",
  "notes": "",
  "url": "^https://api\\.example\\.com/v1/users(.*)$",
  "isRgx": true,
  "method": "*",
  "redirectUrl": "https://api.example.com/v2/users\\1",
  "redirectTargetType": "XHR",
  "headerRuleScope": "ACTIVE_TAB",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": []
}
```
