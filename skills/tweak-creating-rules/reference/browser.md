# Driving tweak from the browser

tweak publishes `window.__TWEAK_SDK__` (alias `window.tweak`) in the pages it runs on. When you
can run JavaScript in the user's tab, it is how you read what the page requests, create and
change rules, and run tweak: **you call it, the user never sees the JSON.** Wrap every call in
an async function and return `JSON.stringify(result)`, so the tool prints the answer. Every
call resolves `{ ok: true, ... }` or `{ ok: false, error: { code, message } }`; none throws.

## Contents

- 0. Check what this tweak build can do
- 1. Sign in and preflight
- 2. Find the request, through tweak
- 3. Check what tweak already has
- 4. Push
- 5. Make it apply
- 6. Iterate, toggle, clean up
- Errors
- API reference

## 0. Check what this tweak build can do

The user's tweak may be older than this skill. **Never assume a method exists**: list them
first, then call only what `methods` lists — for anything missing, the fallback below.

```js
(async () => {
  const tweak = window.__TWEAK_SDK__;
  if (!tweak) return JSON.stringify({ missing: true });
  return JSON.stringify({ version: tweak.version, methods: Object.keys(tweak) });
})();
```

| Missing                                        | Do instead                                                                                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window.__TWEAK_SDK__` itself                  | See `missing: true` in step 1                                                                                                                                              |
| `signIn`                                       | Skip it; still pass `{ agent: 'Claude' }` to create calls, an older build ignores it                                                                                       |
| `features`                                     | Only Mock and Redirect, no hooks, no partial body matching: build `version` `1` drops those fields                                                                         |
| `createModifyRule` / `createHeaderRule`        | Modify and header rules are refused (`UNSUPPORTED_RULE_TYPE`): push the Mock and Redirect rules, and hand those over as JSON with the import link (SKILL.md, step 6)           |
| `setRequestCapture` / `searchRequests`         | Read the requests off the page (step 2's fallback), and tell the user you cannot confirm tweak can mock them                                                               |
| `setRunning`                                   | Ask the user to press **Run** in tweak                                                                                                                                     |
| `searchRules`                                  | `listRules({ url })` with a fragment of the request url, then judge by the labels; ask the user when one looks like it does the job                                        |
| `updateRule` / `deleteRule` / `setRuleEnabled` | **A rule you push is permanent for you.** Get every field right before the one push; if it comes back with `warnings` or wrong, tell the user exactly what to fix in tweak |
| `version` below `6`                            | Edit before send is refused (`UNSUPPORTED_FIELD`): push the rule without it, and tell the user to switch it on in the rule's row ([edit-before-send.md](edit-before-send.md)). A form body comes as its raw string: decode it in your script (step 2) |

Whenever `version` is below `5` or something is missing, your answer must tell the user once,
with the steps:
their tweak build is older than this skill, so you cannot do everything it describes (name
what is missing: Modify or header rules, checking their existing rules, writing hooks, running
tweak, capturing requests, fixing your own rules). To update: install the latest tweak build (or rebuild it), then
**Reload** it on the browser's extensions page, then reload this tab, and ask you again. Then do
what the old build allows — do not wait for them.

## 1. Sign in and preflight

Sign in with the name of the assistant you are ("Claude", "ChatGPT", ...): every rule you
create on this page says so in its notes. A reload forgets it, so sign in again after one.

```js
(async () => {
  const tweak = window.__TWEAK_SDK__;
  if (!tweak) return JSON.stringify({ ok: false, missing: true });
  tweak.signIn?.('Claude');
  return JSON.stringify({ status: await tweak.status(), features: await tweak.features?.() });
})();
```

| Answer           | Do                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing: true`  | tweak is not installed, is a build without the page API, or the tab predates it. Ask the user to reload the tab, then retry. Still missing: hand the rule over as JSON (SKILL.md, step 6)      |
| `enabled: false` | Ask the user: tweak > **⋮ > Settings > Preferences > AI Agents**, switch on. No reload needed. Then stop and wait for them: no file, no JSON, no rule written another way              |
| `enabled: true`  | Go on. Keep `running`, `capturing` and `features` for the steps below                                                                                                                          |

`features.features` answers what the user's plan allows and what you can drive, one entry per
feature (`MOCK_RULES`, `MODIFY_RULES`, `HEADER_RULES`, `REDIRECT_RULES`, `HOOKS`,
`EDIT_BEFORE_SEND`, `COLLECTIONS`, ...). An entry with `available: false` is not possible for you: `reason: 'PLAN'` means the
user's plan does not include it, `'NOT_IN_SDK'` means the user can do it in tweak but you cannot.
Tell the user which, and offer what is possible instead. `features.redirectTargetTypes` lists
the Catch types the plan allows.

## 2. Find the request, through tweak

**tweak's capture is the source of truth for what can be mocked or modified.** A request it
captured went through its fetch/XHR wrappers, so a Mock or Modify rule can catch it. A request
it did not capture cannot be, whatever the network panel shows. Do not read requests off the
network panel or `performance` for a Mock or Modify rule.

```js
// 1. start capturing this tab (skip when status said capturing: true)
(async () => JSON.stringify(await window.__TWEAK_SDK__.setRequestCapture(true)))();
// 2. reload: only requests made from now on are captured
location.reload();
// 3. after the page has loaded, sign in again, then search what tweak captured
(async () => {
  window.__TWEAK_SDK__.signIn('Claude');
  return JSON.stringify(await window.__TWEAK_SDK__.searchRequests({ url: 'products' }));
})();
```

`searchRequests({ url, method, limit, payloadChars })` answers `{ total, requests }`, newest
first; each request has its `url`, `method`, `contentType` (the response's), `requestContentType`,
`requestPayload` and `responsePayload` (cut to `payloadChars`, 2000 by default, `truncated: true` when it was). Match
`url` loosely first, then narrow. If the request the user means is not there, trigger it (the
click, the search, the page it loads on) and search again; still missing means tweak cannot
mock it — say so. If it is an image, a script, a stylesheet or a page load, it is a Redirect
or header rule job, and those requests are never captured: for those two types only, the
page's own resource list is where to look (`performance.getEntriesByType('resource')`).

Start a Mock from the captured `responsePayload`: same keys, same nesting, only what the user
asked for changed. A Modify rule's response hook works on that same shape, live. Never echo tokens or personal data from it back to the user or into a rule.

**Request bodies come from here too.** When a rule has to tell requests apart by body — one
GraphQL operation among many on the same url — take `requestPayload` from the captured request:
it is exactly what the page sent. Do not rebuild a body from the page's source or rendered text:
rendered text is normalised, and your own tool may block fetching the source outright. Then match
it partially ([mock.md](mock.md), "Matching the request body").

**A form body** (`requestContentType` is `application/x-www-form-urlencoded`: a `<form>` post, a
newsletter sign-up, a login) comes as its fields, `{ "email": "...", "consent": "" }`, a repeated
field as a list. You read it, and you can write it back as an object (mock.md, "A form body").
On a build below version `6` it comes as the raw `email=...&consent=` string, and **browser tools
refuse to print anything shaped like a query string or a cookie**, so never return it as is:
decode it inside the same script and return the fields.

```js
(async () => {
  const { requests } = await window.__TWEAK_SDK__.searchRequests({ url: 'subscribe', method: 'POST' });
  return JSON.stringify(
    requests.map(({ url, method, requestContentType, requestPayload, responsePayload }) => ({
      url,
      method,
      requestContentType,
      // a raw form string reads as query-string data, which the tool blocks: hand back its fields
      fields:
        typeof requestPayload === 'string' && /^[^{[\s][^=&\s]*=/.test(requestPayload)
          ? Object.fromEntries(new URLSearchParams(requestPayload))
          : requestPayload,
      responsePayload,
    }))
  );
})();
```

A tool answer that says the output was blocked means the same: re-run the script with the body
decoded, never give up on reading it.

**Without `searchRequests`** (an older build): list requests with the network tool or
`performance.getEntriesByType('resource')`, and say you could not confirm tweak can mock them.

## 3. Check what tweak already has

**Before you write a rule, search for one.** The user may already have a rule that does the
job — switched off, in another collection, or written by an agent last week. A second rule for
the same request is clutter at best, and at worst it never answers: the page uses the first
enabled rule that catches a request.

```js
(async () =>
  JSON.stringify(
    await window.__TWEAK_SDK__.searchRules({
      requestUrl: 'https://shop.example.com/api/products?page=1', // a captured request's url
      method: 'GET',
      text: 'empty product list', // the user's ask, in a few words
    })
  ))();
```

`searchRules` answers `{ total, rules }`, best first. A rule with `catches: true` would catch
that request; `answers: true` marks the Mock or Modify rule the page uses for it now (header
rules and redirects all apply together). A header or Modify rule lists its `headers` by name
and operation, never their values. Each rule carries its
`label`, `notes`, `enabled`, `status`, `delay`, `hooks` and `collection`, and — only when it
catches the request — its `responsePayload`: compare those with the ask. A rule found by
`text` alone matches words, not the request: read it before you trust it.

| Found                                                                        | Do                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A rule that does the job, switched off                                       | **Propose it, do not create.** "Your rule _Products: empty list_ already does this — switch it on?" On yes: `setRuleEnabled(id, true)`, then step 5. On no: create, as asked |
| A rule that does the job, `answers: true`                                    | Nothing to create. If tweak is not running, step 5. Tell the user which rule it is                                                                                           |
| A rule that nearly does it                                                   | Propose changing it rather than adding one: what you would change, and why. Change it (`updateRule`) only on yes; an agent-created rule of yours you may just fix            |
| An enabled rule that catches the request but does something else (`answers`) | Tell the user: a new rule would never answer while it is on. Offer to switch it off (`setRuleEnabled(id, false)`) — on yes only — then create                                |
| Nothing relevant                                                             | Go on: step 4                                                                                                                                                                |

This is the one place you ask before acting: the user's own rules are theirs to reuse,
change or switch off. Ask once, with the rule's label, and do what they answer.

## 4. Push

Write the rule from the type's reference and push it straight away, literally in the call. Do
not show it to the user first, and do not ask permission to push what they already asked for.
**Read `warnings` and `error` on every answer**: a rule is only done when both are empty.

```js
(async () => {
  const result = await window.__TWEAK_SDK__.createRules(
    [
      {
        interceptionPolicy: 'MOCK',
        label: 'Products: none',
        notes: 'Tests the empty state of the product listing.',
        url: '/products',
        method: 'GET',
        status: 200,
        responsePayload: { products: [], total: 0 },
      },
    ],
    { agent: 'Claude' }
  );
  return JSON.stringify(result);
})();
```

`createRules` takes up to 20 rules and creates all of them or none; `createMockRule(rule)`,
`createModifyRule(rule)`, `createHeaderRule(rule)` and `createRedirectRule(rule)` take one and
set its type. Here every field but `url` (and `redirectUrl` for a redirect, a header row for a
header rule) has a default — a Modify rule's forward what the server sent — and
`responsePayload`, `requestPayload` and `outgoingRequestPayload` may be plain objects. Keep
the `created[].id`s: they are how you change the rules later. On a paid plan the rules land in
a collection named **"AI Generated"** (`result.collection`); tell the user that is where they
are.

## 5. Make it apply

Rules land switched on, but tweak applies them only on a tab where it is **running** — every
type, header rules and redirects included. If
`status().running` is false, run it — the Run button, for this tab:

```js
(async () => JSON.stringify(await window.__TWEAK_SDK__.setRunning(true)))();
```

Requests already made are not replayed: reload, or repeat what makes the request, then check
the page shows the change. Tell the user what you created, by its label, and where it is.

## 6. Iterate, toggle, clean up

- **Change a rule** you made — never create a second one for the same request:
  `updateRule(id, { status: 500 }, { agent: 'Claude' })`. Any field `createRules` takes; only
  what you pass changes, and the rule keeps its switch. Hooks go here too ([hooks.md](hooks.md)),
  and so does Edit before send, when the user wants to edit it by hand ([edit-before-send.md](edit-before-send.md)).
- **The user's own rules**: `listRules({ url, label, type, enabled })` answers their ids, labels
  and urls — never their payloads.
- **On or off**: `setRuleEnabled(id, false)`; tweak itself: `setRunning(false)`.
- **Undo a mistake**: `deleteRule(id)` deletes a rule an agent created — never the user's own
  (`NOT_DELETABLE`); switch those off instead, or ask the user.
- **Capture**: if it was off before you started, switch it back off with
  `setRequestCapture(false)` once you are done.

## Errors

| `error.code`            | Do                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `INVALID_RULE`          | The message names the rule and the field. Fix it, push again                              |
| `UNSUPPORTED_FIELD`     | A field you set cannot be set by an agent: remove it, or tell the user to set it in tweak. A header that guards other sites (headers.md): do not retry, hand the rule over as JSON (SKILL.md, step 6) |
| `NOT_DELETABLE`         | Not a rule an agent created: switch it off, or ask the user                               |
| `PREMIUM_REQUIRED`      | Modify, a hook or `PARTIAL` on the free plan: offer the free way (see the message)        |
| `UNSUPPORTED_RULE_TYPE` | An older build (step 0): hand that rule over as JSON (SKILL.md, step 6)                   |
| `RULE_LIMIT_REACHED`    | Tell the user to delete rules in tweak or upgrade. Do not delete for them                 |
| `RULE_NOT_FOUND`        | The id is wrong or the rule was deleted: `listRules()` gives the current ids              |
| `RUN_LOCKED`            | A global header/redirect rule keeps tweak running: the user switches it off               |
| `AGENT_ACCESS_DISABLED` | The preflight's `enabled: false` row                                                      |
| `TIMEOUT`               | tweak did not answer. Ask the user to reload the tab, then retry once                     |

Relay `warnings` to the user: they name fields tweak dropped or cut.

## API reference

API version `6` (`tweak.version`), top frame only; older builds lack some methods (step 0).
`window.tweak` is missing when the page already owned that
name; `window.__TWEAK_SDK__` is always there. `help()` returns this list as data.

| Method                                | Answers                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `signIn(name)`                        | `{ ok, agent }` — synchronous                                                            |
| `status()`                            | `{ enabled, running, capturing, premium?, ruleSlotsLeft? }`                              |
| `features()`                          | `{ premium, features: { NAME: { available, reason?, message? } }, redirectTargetTypes }` |
| `isFeatureAvailable(name)`            | `{ feature, available, reason?, message? }`                                              |
| `setRequestCapture(on)`               | `{ capturing }`                                                                          |
| `searchRequests(query)`               | `{ capturing, total, requests }`; a form body comes as its fields                        |
| `createRules(rules, { agent })`       | `{ created: [{ id, type, url, label, enabled, collection? }], collection?, warnings }`   |
| `createMockRule(rule, { agent })`     | same                                                                                     |
| `createModifyRule(rule, { agent })`   | same                                                                                     |
| `createHeaderRule(rule, { agent })`   | same                                                                                     |
| `createRedirectRule(rule, { agent })` | same                                                                                     |
| `updateRule(id, changes, { agent })`  | `{ rule, warnings }`                                                                     |
| `listRules(query)`                    | `{ rules: [{ id, type, url, label, enabled, collection? }] }`                            |
| `searchRules(query)`                  | `{ total, rules }` — step 3; `{ requestUrl, method, text, type, enabled, limit }`        |
| `setRuleEnabled(id, on)`              | `{ rule }`                                                                               |
| `deleteRule(id)`                      | `{ deleted }` — agent-created rules only                                                 |
| `setRunning(on)`                      | `{ running }`                                                                            |

`createRules` also accepts an import file's `{ configurations: [...] }`. A field outside the
rule type's vocabulary is refused (`UNSUPPORTED_FIELD`); an export's leftovers (`id`,
`collectionId`, `enabled`, a field left at `false` or `""`) are dropped. Every rule's notes get a
line saying who created it, and on which site.
