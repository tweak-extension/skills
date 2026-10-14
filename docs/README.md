# docs/

Assets for the repository's README. Nothing here ships with a skill.

## `demo.gif` (to record)

The README has a commented-out slot for it. Record, add `docs/demo.gif`, then uncomment the
`<!-- DEMO ... -->` block in the README.

- **Flow:** Claude in Chrome on a shop page, with tweak's **AI Agents** switch on
  (⋮ > Settings > Preferences).
- **Prompt:** _"Use tweak to show me what this page looks like with an empty cart"_.
- **What it shows:** the agent preflights, turns capture on and reloads, searches the captured
  requests, pushes a Mock rule, runs tweak, and the page re-renders with an empty cart.
- **Limits:** ≤ 20 s, 800 px wide, < 5 MB.
