# Hooks

A hook is JavaScript tweak runs when a Mock or Modify rule matches. A **response hook**
computes the body the page receives; a **request hook** rewrites the request before it goes
out. Both are tweak premium.

On a **Mock** the response hook starts from the rule's `responsePayload`. On a **Modify** rule
with `responsePayload` left `""` it starts from **the server's real body**: the way to change
one field and keep the rest live ([modify.md](modify.md)).

**Check before you write one**: in the browser, `isFeatureAvailable('HOOKS')` must answer
`available: true`. Then write the hook **into the rule yourself**: `responseHook` on the
create call, or `updateRule(id, { responseHook })` for a rule you already made — never hand
the user code to paste when the call can carry it.

Only a build without `features` (browser.md, step 0) cannot take a hook from an agent. There,
push the rule with the payload the hook starts from, give the user the hook body to paste into
the rule's **Response hook** tab, and tell them updating tweak lets you do it yourself. On the
free plan (`reason: 'PLAN'`), write the values out in `responsePayload` instead.

## Contents

- The response hook
- The request hook
- Where a hook runs
- Examples

## The response hook

Put the **body** of a function in `responseHook`: no `function` keyword, no wrapper. It is
called with:

| Name       | Holds                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `response` | the body: a Mock's `responsePayload`, or a Modify rule's server answer; **parsed when it is JSON**, the raw string otherwise    |
| `url`      | the request url                                                                                                                    |
| `method`   | the request method                                                                                                                 |
| `body`     | the request body                                                                                                                   |
| `vars`     | the user's tweak variables, by name                                                                                                |
| `chance`   | [Chance.js](https://chancejs.com): `chance.name()`, `chance.sentence()`, `chance.integer({ min: 1, max: 5 })`, `chance.date()` ... |
| `_`        | `_.merge`, `_.pick`, `_.isEqual`                                                                                                   |

**Return** the body: an object is stringified for you, a string is sent as is. A hook that
returns nothing sends `responsePayload` untouched, and tweak warns about it.

On a Mock, keep `responsePayload` as the shape the hook starts from (the captured real
response is the best one), and have the hook change only what the user asked for. `response`
is only parsed when the body is valid JSON: check `typeof response` when it might not be.

## The request hook

`requestHook` receives `url`, `method`, `body` (the raw string the page sent), `headers`,
`vars`, `chance` and `_`, and must return `{ method, url, body, headers }`. It matters on a
Modify rule, whose request is sent: rewrite one field of the body, or the url. A Mock never
sends its request, so write one there only when the user asks for it.

## Where a hook runs

A rule an agent writes hook code into runs **only on the site it was written from**, and its
notes say so. That is deliberate — code planted from one page must not run on another — so tell
the user when they ask for the same rule elsewhere: they create it from that site, or write the
hook themselves in tweak.

## Examples

A new rule born with its hook — 120 random reviews on one product:

```js
(async () =>
  JSON.stringify(
    await window.__TWEAK_SDK__.createMockRule(
      {
        label: 'Product 1: 120 reviews',
        url: '/products/1',
        method: 'GET',
        responsePayload: capturedResponsePayload, // from searchRequests, parsed
        responseHook: `
          response.reviews = Array.from({ length: 120 }, () => ({
            reviewerName: chance.name(),
            rating: chance.integer({ min: 1, max: 5 }),
            comment: chance.sentence({ words: 8 }),
          }));
          return response;
        `,
      },
      { agent: 'Claude' }
    )
  ))();
```

Random reviews on every product request, added to a rule you already made:

```js
await window.__TWEAK_SDK__.updateRule(ruleId, {
  responseHook: `
    response.reviews = Array.from({ length: chance.integer({ min: 1, max: 5 }) }, () => ({
      reviewerName: chance.name(),
      rating: chance.integer({ min: 1, max: 5 }),
      comment: chance.sentence({ words: 8 }),
      date: chance.date({ year: 2025 }).toISOString(),
    }));
    return response;
  `,
});
```

An error for one id in the url, the real payload for every other:

```js
responseHook: `
  if (url.includes('/products/13')) {
    return { message: 'Product with id 13 not found' };
  }
  return response;
`,
```

A hook cannot change the status: set `status` on the rule, and write one rule per status.

One field of the server's real answer, on a Modify rule (`responsePayload` left `""`):

```js
(async () =>
  JSON.stringify(
    await window.__TWEAK_SDK__.createModifyRule(
      {
        label: 'Account: plan shows as free',
        url: '/api/account',
        method: 'GET',
        responseHook: `
          response.plan = 'free';
          return response;
        `,
      },
      { agent: 'Claude' }
    )
  ))();
```
