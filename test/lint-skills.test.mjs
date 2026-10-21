import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { exampleRules, lintSkill, skillDirs } from '../scripts/lint-skills.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = path.join(ROOT, 'skills/tweak-creating-rules')

/** A copy of the real skill with `edits` applied: { 'file': (text) => text }. */
function brokenCopy(edits) {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'lint-')), 'tweak-creating-rules')
  cpSync(SKILL, dir, { recursive: true })
  Object.entries(edits).forEach(([file, edit]) => {
    const target = path.join(dir, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, edit(readFileSync(target, { encoding: 'utf8', flag: 'a+' })))
  })
  return dir
}

const messages = async (dir) => (await lintSkill(dir)).map(({ file, line, message }) => `${path.basename(file)}:${line} ${message}`)

describe('lint-skills', () => {
  it('passes every skill in the repo', async () => {
    const dirs = skillDirs()

    assert.ok(dirs.length >= 1)
    for (const dir of dirs) {
      assert.deepEqual(await lintSkill(dir), [])
    }
  })

  it('finds the example rules it validates', () => {
    const count = ['SKILL.md', 'reference/mock.md', 'reference/redirect.md', 'reference/headers.md']
      .map((file) => exampleRules(readFileSync(path.join(SKILL, file), 'utf8')).length)
      .reduce((a, b) => a + b)

    assert.ok(count > 5, `only ${count} example rules found`)
  })

  it('reports a bad frontmatter, at its line', async () => {
    const dir = brokenCopy({
      'SKILL.md': (text) =>
        text
          .replace(/^name: .*$/m, 'name: claude-Rules')
          .replace(/^description: .*$/m, `description: I make <b>rules</b>. ${'x'.repeat(320)}`),
    })
    const found = await messages(dir)

    assert.ok(found.some((entry) => entry.startsWith('SKILL.md:2 name "claude-Rules" is not the directory')))
    assert.ok(found.some((entry) => entry.includes('reserved word')))
    assert.ok(found.some((entry) => entry.includes('lowercase')))
    assert.ok(found.some((entry) => entry.startsWith('SKILL.md:3 description contains an XML tag')))
    assert.ok(found.some((entry) => entry.includes('over the 320 budget')))
    assert.ok(found.some((entry) => entry.includes('third person')))
    assert.ok(found.some((entry) => entry.includes('when to use the skill')))
  })

  it('reports broken and missing links, a long reference without contents, backslashes and dates', async () => {
    const dir = brokenCopy({
      'SKILL.md': (text) => `${text.replace('](reference/hooks.md)', '](reference/hook.md)')}\nSee reference\\mock.md.\n`,
      'reference/orphan.md': () => `# Orphan\n${'line\n'.repeat(120)}Works before March 2026.\n`,
    })
    const found = await messages(dir)

    assert.ok(found.some((entry) => /^SKILL\.md:\d+ link to reference\/hook\.md does not resolve$/.test(entry)))
    assert.ok(found.some((entry) => entry === 'hooks.md:1 not linked from SKILL.md'))
    assert.ok(found.some((entry) => entry === 'orphan.md:1 not linked from SKILL.md'))
    assert.ok(found.some((entry) => entry.startsWith('orphan.md:1 123 lines and no "## Contents"')))
    assert.ok(found.some((entry) => entry.includes('backslash path reference\\mock.md')))
    assert.ok(found.some((entry) => entry.startsWith('orphan.md:122 time-sensitive phrasing "before March 2026"')))
  })

  it('reports a plan named in prose or the schema, never in code', async () => {
    const dir = brokenCopy({
      'reference/mock.md': (text) =>
        `${text}\nModify needs Tweak Max.\nOn \`PREMIUM_REQUIRED\`, offer the free way.\n\`\`\`js\nresponse.tier = 'premium'\n\`\`\`\n`,
      'reference/rule.schema.json': (text) => text.replace('(Modify, not a free feature)', '(Modify, premium)'),
    })
    const found = await messages(dir)
    const plans = found.filter((entry) => entry.includes('names a plan'))

    assert.ok(plans.some((entry) => entry.startsWith('mock.md:') && entry.endsWith('"Tweak Max"')))
    assert.ok(plans.some((entry) => entry.startsWith('rule.schema.json:') && entry.endsWith('"premium"')))
    assert.equal(plans.length, 2, plans.join('\n'))
  })

  it('reports an example rule the validator refuses, and a validator out of step with the schema', async () => {
    const dir = brokenCopy({
      'reference/mock.md': (text) => `${text}\n\`\`\`json\n{ "interceptionPolicy": "MOCK", "url": "/a" }\n\`\`\`\n`,
      'reference/rule.schema.json': (text) => text.replace('"maxLength": 256', '"maxLength": 300'),
    })
    const found = await messages(dir)

    assert.ok(found.some((entry) => entry.startsWith('mock.md:') && entry.includes('fails validate-rules.mjs')))
    assert.ok(found.some((entry) => entry.includes('LABEL_MAX is 256')))
  })
})
