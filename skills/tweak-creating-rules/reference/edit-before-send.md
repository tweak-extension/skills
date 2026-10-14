# Edit before send

Edit before send pauses a request in the user's tab and opens tweak's editor over the page, so
**the user** changes the request or the response by hand, then presses **Continue** (or
**Cancel request**). It is tweak's breakpoint for data. Premium, and a switch on a Mock or
Modify rule, not a rule type of its own.

Reach for it whenever the user wants to do the editing themselves, live: "pause when the
request fires", "let me edit the response before the app gets it", "stop and let me change the
body", "a breakpoint where I can change the data". Never answer that tweak cannot do this.

## Contents

- The two fields
- Which rule carries it
- Switching it on a rule that exists
- Limits
- Examples

## The two fields

| Field                     | Value                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `isEditBeforeSendEnabled` | `true` pauses every request the rule catches                                                   |
| `editBeforeSendStage`     | `REQUEST` (default): before it is sent. `RESPONSE`: once the answer is in, before the page reads it. `REQUEST_AND_RESPONSE`: both |

Pick the stage from the user's words: editing what the page **sends** is `REQUEST`, what it
**receives** is `RESPONSE`, both is `REQUEST_AND_RESPONSE`.

## Which rule carries it

- **Modify** (`PATCH`) when the user edits the real thing: at `RESPONSE` the editor opens on the
  server's own answer, at `REQUEST` on the request about to go out. Nothing else needs setting:
  the pause is the change, so a Modify rule with only this switch is valid.
- **Mock** when there is no server answer to edit (the endpoint is down, or not built yet): the
  editor opens on the rule's own response.

Match the request as for any rule ([modify.md](modify.md), [mock.md](mock.md)): the shortest
url fragment that catches only that request. A pause on a broad url stops every request it
catches, so keep it narrow.

## Switching it on a rule that exists

When the user already has a rule for that request — including the one you just created — switch
it on there instead of creating a second rule:
`updateRule(id, { isEditBeforeSendEnabled: true, editBeforeSendStage: 'RESPONSE' }, { agent: 'Claude' })`
([browser.md](browser.md) step 6). A user's own rule is changed only on their yes, like any
other change to it (browser.md step 3). Switch it off with `isEditBeforeSendEnabled: false`.

Then tell the user what happens next: tweak must be running on the tab; the next time the page
makes that request, tweak's editor opens over the page; edit, then **Continue**. Edits apply to
that one request and are never saved into the rule.

## Limits

- **Premium.** `features().features.EDIT_BEFORE_SEND` says whether the plan has it. On the free
  plan tell the user it needs premium; offer a Mock or Modify rule that makes the change for
  them instead.
- Needs tweak API version `6`. On an older build create the rule without the switch, then tell
  the user to turn on **Edit before send** on the rule's row in tweak (the pencil next to the
  breakpoint) and pick the stage.
- fetch and XHR only. A synchronous XHR is never paused.

## Examples

Each block is one rule. The headings are what a user typed.

### "Pause when the product loads and let me edit its reviews by hand before the app gets them"

```json
{
  "interceptionPolicy": "PATCH",
  "label": "Product 1: edit the response by hand",
  "notes": "Pauses on the real answer so the reviews can be edited before the page reads them.",
  "url": "/products/1",
  "isRgx": false,
  "method": "GET",
  "status": 0,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": [],
  "responsePayload": "",
  "isEditBeforeSendEnabled": true,
  "editBeforeSendStage": "RESPONSE"
}
```

### "Let me change the checkout request before it goes out"

```json
{
  "interceptionPolicy": "PATCH",
  "label": "Checkout: edit the request before it is sent",
  "notes": "",
  "url": "/api/checkout",
  "isRgx": false,
  "method": "POST",
  "status": 0,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": [],
  "responsePayload": "",
  "isEditBeforeSendEnabled": true,
  "editBeforeSendStage": "REQUEST"
}
```

### "The orders api isn't built yet: stop on it so I can type the answer each time"

```json
{
  "interceptionPolicy": "MOCK",
  "label": "Orders: answer by hand",
  "notes": "Pauses on the mocked answer so it can be edited per request.",
  "url": "/api/orders",
  "isRgx": false,
  "method": "GET",
  "status": 200,
  "delay": 0,
  "requestPayload": "",
  "responseHeaders": [{ "header": "Content-Type", "value": "application/json; charset=utf-8", "active": true }],
  "responsePayload": "{\"orders\":[]}",
  "isEditBeforeSendEnabled": true,
  "editBeforeSendStage": "RESPONSE"
}
```
