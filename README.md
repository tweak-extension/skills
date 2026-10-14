# tweak Agent Skills

[Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) for
[tweak](https://tweak-extension.com), so an AI agent can mock, modify, redirect and set headers on
a page's requests from plain English.

<!-- DEMO: replace with the recording, then uncomment.
<p align="center"><img src="docs/demo.gif" alt="An agent in Claude in Chrome creating a tweak rule that mocks an empty cart" width="800"></p>
-->

## Skills

| Skill | What it does | Plan the rules need |
| --- | --- | --- |
| [`tweak-creating-rules`](skills/tweak-creating-rules/SKILL.md) | Turns a plain-English ask into tweak rules. With access to the user's tab (Claude in Chrome) it pushes them into tweak through its page API; anywhere else it hands over the rule JSON and a link to tweak's import page. | **Free:** Mock, header, Redirect. **Premium:** Modify, hooks (computed responses), Edit before send. |

See [tweak's pricing](https://tweak-extension.com/pricing) for the plans.

## Install

Upgrading? Remove any older copy first (`tweak-rules`, `creating-tweak-rules`). Two installed
copies both match the same asks.

### Claude Code, as a plugin

```
/plugin marketplace add tweak-extension/skills
/plugin install tweak@tweak-extension
```

The skill then shows as `tweak:tweak-creating-rules`. From a shell:
`claude plugin marketplace add tweak-extension/skills`, then
`claude plugin install tweak@tweak-extension`.

### Claude Code, manually

Copy `skills/tweak-creating-rules` into `~/.claude/skills/` (every project) or into a project's
`.claude/skills/`.

### Claude apps (claude.ai and desktop)

Download `tweak-creating-rules.zip` from the
[latest release](https://github.com/tweak-extension/skills/releases/latest) and upload it as a
custom skill ([how](https://support.claude.com/en/articles/12512198-creating-custom-skills)).
The zip holds the `tweak-creating-rules/` folder at its root, as the upload expects.

### Claude API

Upload the same folder with the [Skills API](https://platform.claude.com/docs/en/api/skills/create)
(`POST /v1/skills`); see the [Skills guide](https://platform.claude.com/docs/en/build-with-claude/skills-guide)
for using it in a request.

### Other agents

Any agent that reads the open `SKILL.md` format can use it: copy
`skills/tweak-creating-rules` into its skills folder, or use the
[`skills` CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add tweak-extension/skills
```

## Usage

### In the browser

1. Install tweak from the [Chrome Web Store](https://chrome.google.com/webstore/detail/tweak/feahianecghpnipmhphmfgmpdodhcapi)
   and open the page you want to work on.
2. In tweak, open **⋮ > Settings > Preferences > AI Agents** and switch it on. It is **off by
   default**: while it is on, any page can ask tweak for rules, so switch it off when you are done.
3. Ask your agent (Claude in Chrome, or any agent that can run a script in the tab), for example:
   - _"Use tweak to show me what this page looks like with an empty cart."_
   - _"Use tweak to replace every image on this page with https://placehold.co/600x400.png."_
   - _"Send `X-Debug: 1` on every `/api` call with tweak."_
4. Press **Run** in tweak if it is not running on the tab.

More in tweak's [AI Agents docs](https://tweak-extension.com/docs/ai-agents).

### Without a browser

Claude Code or a chat cannot reach the tab, so the agent hands you the rules as JSON plus a link
to tweak's import page: paste the JSON there and the rules arrive switched off, ready to enable.
To check a rule file yourself:

```bash
node skills/tweak-creating-rules/scripts/validate-rules.mjs tweak-rules.json
```

## How it's tested

The skill is prose an agent follows, so it is tested at four layers:

1. **Static:** frontmatter, size, links, contents tables, the authoring checklist
   (`npm run lint:skills`, every PR).
2. **Contract:** every example rule passes the skill's own validator, which agrees with the
   schema (`npm run lint:skills`, every PR). tweak's own repository also runs every example
   through the extension's builder and import page.
3. **Trigger:** the description loads the skill for asks it should, and not for near misses.
4. **Behaviour:** the real agent, headless, delivers the right rule the right way, in a file and
   in a fake browser tab whose every SDK call is graded.

Layers 3 and 4 call a model, so a maintainer runs them on a pull request after reviewing it.
See [evals/README.md](evals/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE), covering this repository only. The tweak browser extension is a separate
product, and "tweak" is a trademark this license does not grant (Apache-2.0 §6). See
[NOTICE](NOTICE).
