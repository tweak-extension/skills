#!/usr/bin/env node
/*
 * Static checks for every skills/*\/ directory: the machine-checkable items of the platform's
 * "Checklist for effective Skills"
 * (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), plus the
 * half of tweak's contract tests that needs no extension: every example rule passes the skill's
 * own validator, and the validator agrees with the schema it ships next to.
 *
 *   npm run lint:skills
 *   node scripts/lint-skills.mjs path/to/one-skill
 *
 * Every problem names a file:line and how to fix it. Free and deterministic: runs on every PR.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// the description is in every conversation's system prompt, whether the skill loads or not:
// tweak's own budget, stricter than the platform's 1024
export const DESCRIPTION_BUDGET = 320
export const SKILL_MAX_LINES = 500
export const CONTENTS_OVER_LINES = 100
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'
const TIME_SENSITIVE = new RegExp(`\\b(before|after) (${MONTHS}),? 20\\d\\d\\b`, 'i')
// a Windows-style path to a file: reference\mock.md, .\scripts\x.mjs
const BACKSLASH_PATH = /(?:^|[\s`'"(])((?:\.{1,2}\\|[\w.-]+\\)[\w.\\-]*\.(?:md|mjs|js|json|py|sh|txt))\b/
const EXTERNAL_LINK = /^(?:[a-z][a-z0-9+.-]*:|#)/i

const lineOf = (text, index) => text.slice(0, index).split('\n').length

/** The markdown files of a skill, relative to its directory. */
function markdownFiles(dir) {
  const reference = path.join(dir, 'reference')
  return [
    'SKILL.md',
    ...(existsSync(reference)
      ? readdirSync(reference)
          .filter((name) => name.endsWith('.md'))
          .sort()
          .map((name) => `reference/${name}`)
      : []),
  ]
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  if (!match) {
    return null
  }
  const field = (key) => match[1].match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1].trim()
  const lines = match[1].split('\n')
  const lineOfKey = (key) => 2 + lines.findIndex((line) => line.startsWith(`${key}:`))
  return { name: field('name'), description: field('description'), lineOfKey }
}

function checkFrontmatter(dir, text, problem) {
  const frontmatter = parseFrontmatter(text)
  if (!frontmatter) {
    problem('SKILL.md', 1, 'no YAML frontmatter', 'start SKILL.md with ---, name: and description: lines, then ---')
    return
  }
  const { name, description, lineOfKey } = frontmatter
  const directory = path.basename(dir)
  if (!name) {
    problem('SKILL.md', 1, 'frontmatter has no name', `add "name: ${directory}"`)
  } else {
    if (name !== directory) {
      problem('SKILL.md', lineOfKey('name'), `name "${name}" is not the directory's, "${directory}"`, 'rename one to match the other')
    }
    if (!/^[a-z0-9-]{1,64}$/.test(name)) {
      problem('SKILL.md', lineOfKey('name'), `name "${name}" is not lowercase letters, digits and hyphens (max 64)`, 'rename it')
    }
    if (/anthropic|claude/.test(name)) {
      problem('SKILL.md', lineOfKey('name'), `name "${name}" contains a reserved word ("anthropic" or "claude")`, 'rename it')
    }
  }
  if (!description) {
    problem('SKILL.md', 1, 'frontmatter has no description', 'add a one-line "description:" saying what the skill does and when to use it')
    return
  }
  const at = lineOfKey('description')
  if (/<[^>]+>/.test(description)) {
    problem('SKILL.md', at, 'description contains an XML tag', 'remove the <...> markup from it')
  }
  if (description.length > DESCRIPTION_BUDGET) {
    problem(
      'SKILL.md',
      at,
      `description is ${description.length} characters, over the ${DESCRIPTION_BUDGET} budget`,
      'cut it: it sits in every conversation, loaded or not',
    )
  }
  if (!/^[A-Z][a-z]+s /.test(description)) {
    problem('SKILL.md', at, 'description does not start in the third person', 'start with a verb like "Creates ..." or "Generates ..."')
  }
  if (!description.includes('Use when')) {
    problem('SKILL.md', at, 'description does not say when to use the skill', 'add a "Use when ..." sentence')
  }
}

function checkLinks(dir, file, text, problem) {
  ;[...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].forEach((match) => {
    const target = match[1]
    if (EXTERNAL_LINK.test(target)) {
      return
    }
    const [relative] = target.split('#')
    if (!existsSync(path.join(dir, path.dirname(file), relative))) {
      problem(file, lineOf(text, match.index), `link to ${target} does not resolve`, 'fix the path, relative to this file')
    }
  })
}

/** Every reference file must be one hop from SKILL.md, so the agent never reads a chain to find it. */
function checkReferencesLinked(dir, skillText, problem) {
  const linked = new Set(
    [...skillText.matchAll(/\]\(([^)\s#]+)/g)].map(([, target]) => path.normalize(target).replace(/^\.\//, '')),
  )
  markdownFiles(dir)
    .filter((file) => file !== 'SKILL.md')
    .forEach((file) => {
      if (!linked.has(file)) {
        problem(file, 1, 'not linked from SKILL.md', `link it from SKILL.md as ](${file}): references stay one level deep`)
      }
    })
}

function checkProse(file, text, problem) {
  const lines = text.split('\n')
  if (file !== 'SKILL.md' && lines.length > CONTENTS_OVER_LINES && !/^## Contents$/m.test(text)) {
    problem(file, 1, `${lines.length} lines and no "## Contents" section`, 'add a table of contents near the top')
  }
  lines.forEach((line, index) => {
    const backslash = line.match(BACKSLASH_PATH)
    if (backslash) {
      problem(file, index + 1, `backslash path ${backslash[1]}`, 'use forward slashes: they work on every platform')
    }
    const dated = line.match(TIME_SENSITIVE)
    if (dated) {
      problem(file, index + 1, `time-sensitive phrasing "${dated[0]}"`, 'state the current behaviour; move the old one under an "Old patterns" heading')
    }
  })
}

/** Every ```json block that is an example rule, with the line it starts on. */
export function exampleRules(text) {
  return [...text.matchAll(/```json\n([\s\S]*?)```/g)]
    .filter(([, block]) => block.includes('"interceptionPolicy"') && !block.includes('"..."'))
    .map((match) => ({ line: lineOf(text, match.index), block: match[1] }))
}

async function checkExamples(dir, files, read, problem) {
  const validator = path.join(dir, 'scripts/validate-rules.mjs')
  if (!existsSync(validator)) {
    return
  }
  const { validateRules } = await import(pathToFileURL(validator).href)
  files.forEach((file) => {
    exampleRules(read(file)).forEach(({ line, block }) => {
      let value
      try {
        value = JSON.parse(block)
      } catch (error) {
        problem(file, line, `example rule is not valid JSON: ${error.message}`, 'fix the JSON block')
        return
      }
      const { errors } = validateRules(Array.isArray(value) || value?.configurations ? value : [value])
      errors.forEach((error) =>
        problem(file, line, `example rule fails validate-rules.mjs: ${error}`, 'fix the example, it is copied as written'),
      )
    })
  })
}

const sorted = (list) => [...list].sort()
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))

/** validate-rules.mjs is hand-written so an agent can run it with plain node: it must agree with the schema. */
async function checkValidatorAgainstSchema(dir, problem) {
  const validatorFile = path.join(dir, 'scripts/validate-rules.mjs')
  const schemaFile = path.join(dir, 'reference/rule.schema.json')
  if (!existsSync(validatorFile) || !existsSync(schemaFile)) {
    return
  }
  const validator = await import(pathToFileURL(validatorFile).href)
  const schema = JSON.parse(readFileSync(schemaFile, 'utf8'))
  const where = 'scripts/validate-rules.mjs'
  const branches = Object.fromEntries(
    (schema.oneOf ?? []).map((branch) => [branch.properties?.interceptionPolicy?.const, branch.properties]),
  )
  const fix = 'make validate-rules.mjs match reference/rule.schema.json (the schema is generated in tweak)'
  if (!same(Object.keys(validator.FIELDS), Object.keys(branches))) {
    problem(where, 1, `FIELDS has types ${sorted(Object.keys(validator.FIELDS))}, the schema ${sorted(Object.keys(branches))}`, fix)
  }
  const withoutType = (list) => list.filter((field) => field !== 'interceptionPolicy')
  Object.entries(branches).forEach(([type, properties]) => {
    const fields = validator.FIELDS[type]
    if (fields && !same(withoutType(fields), withoutType(Object.keys(properties)))) {
      const missing = Object.keys(properties).filter((field) => field !== 'interceptionPolicy' && !fields.includes(field))
      const extra = withoutType(fields).filter((field) => !(field in properties))
      problem(where, 1, `FIELDS.${type} differs from the schema: missing [${missing}], extra [${extra}]`, fix)
    }
  })
  const property = (name) =>
    Object.values(branches)
      .map((properties) => properties[name])
      .filter(Boolean)
  const enums = {
    METHODS: 'method',
    MATCH_POLICIES: 'requestPayloadMatchPolicy',
    TARGET_TYPES: 'redirectTargetType',
    SCOPES: 'headerRuleScope',
    EDIT_BEFORE_SEND_STAGES: 'editBeforeSendStage',
  }
  Object.entries(enums).forEach(([constant, name]) => {
    property(name).forEach((definition) => {
      if (!same(validator[constant] ?? [], definition.enum ?? [])) {
        problem(where, 1, `${constant} is [${validator[constant]}], the schema's ${name} is [${definition.enum}]`, fix)
      }
    })
  })
  const limits = { LABEL_MAX: 'label', NOTES_MAX: 'notes', HOOK_MAX: 'responseHook' }
  Object.entries(limits).forEach(([constant, name]) => {
    property(name).forEach((definition) => {
      if (validator[constant] !== definition.maxLength) {
        problem(where, 1, `${constant} is ${validator[constant]}, the schema's ${name} maxLength is ${definition.maxLength}`, fix)
      }
    })
  })
}

/** Every problem with one skill directory, as { file, line, message, fix } (file relative to the repo). */
export async function lintSkill(dir) {
  const problems = []
  const relative = path.relative(ROOT, dir) || dir
  const problem = (file, line, message, fix) => problems.push({ file: path.join(relative, file), line, message, fix })
  const skillFile = path.join(dir, 'SKILL.md')
  if (!existsSync(skillFile)) {
    problem('SKILL.md', 1, 'missing', 'every skill directory needs a SKILL.md')
    return problems
  }
  const read = (file) => readFileSync(path.join(dir, file), 'utf8')
  const skillText = read('SKILL.md')
  const files = markdownFiles(dir)

  checkFrontmatter(dir, skillText, problem)
  const lines = skillText.split('\n').length
  if (lines >= SKILL_MAX_LINES) {
    problem('SKILL.md', SKILL_MAX_LINES, `${lines} lines, at or over ${SKILL_MAX_LINES}`, 'move detail into reference/ files')
  }
  checkReferencesLinked(dir, skillText, problem)
  files.forEach((file) => {
    checkLinks(dir, file, read(file), problem)
    checkProse(file, read(file), problem)
  })
  await checkExamples(dir, files, read, problem)
  await checkValidatorAgainstSchema(dir, problem)
  return problems
}

/** The skill directories under `root`/skills. */
export function skillDirs(root = ROOT) {
  const skills = path.join(root, 'skills')
  return readdirSync(skills)
    .map((name) => path.join(skills, name))
    .filter((dir) => statSync(dir).isDirectory())
}

const format = ({ file, line, message, fix }) => `${file}:${line}: ${message}\n  fix: ${fix}`

async function main() {
  const targets = process.argv.slice(2)
  const dirs = targets.length ? targets.map((target) => path.resolve(target)) : skillDirs()
  const problems = (await Promise.all(dirs.map(lintSkill))).flat()
  if (problems.length) {
    console.error(problems.map(format).join('\n'))
    console.error(`\n${problems.length} problem(s) in ${dirs.length} skill(s)`)
    process.exit(1)
  }
  console.log(`${dirs.length} skill(s) pass: ${dirs.map((dir) => path.basename(dir)).join(', ')}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
