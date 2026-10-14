#!/usr/bin/env node
/*
 * Zips every skills/<name>/ into dist/<name>.zip, the folder at the zip's root, as Claude apps
 * take it (Settings > Capabilities > Skills). Built from source on every release and never
 * committed: a committed zip once went stale and kept shipping an old flow.
 *
 *   npm run pack
 *
 * Plain node (zlib), no `zip` binary: the same bytes on every platform, with a fixed timestamp
 * so an unchanged skill packs to an identical zip.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = path.join(ROOT, 'skills')
const DIST = path.join(ROOT, 'dist')
const IGNORED = new Set(['.DS_Store', 'Thumbs.db'])
// 1980-01-01 00:00, the earliest MS-DOS time: keeps the archive reproducible
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1

function filesUnder(dir, base = dir) {
  return readdirSync(dir)
    .filter((name) => !IGNORED.has(name))
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name)
      return statSync(full).isDirectory() ? filesUnder(full, base) : [path.relative(base, full)]
    })
}

/** A zip (deflate, no extras) of `entries`: [{ name, data }]. */
export function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  entries.forEach(({ name, data }) => {
    const nameBytes = Buffer.from(name.split(path.sep).join('/'), 'utf8')
    const compressed = deflateRawSync(data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4) // made by: unix, 3.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38) // -rw-r--r--
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + compressed.length
  })
  const centralSize = centrals.reduce((size, part) => size + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

function main() {
  rmSync(DIST, { recursive: true, force: true })
  mkdirSync(DIST)
  readdirSync(SKILLS)
    .filter((name) => statSync(path.join(SKILLS, name)).isDirectory())
    .forEach((name) => {
      const dir = path.join(SKILLS, name)
      const entries = filesUnder(dir).map((file) => ({
        name: path.join(name, file),
        data: readFileSync(path.join(dir, file)),
      }))
      const out = path.join(DIST, `${name}.zip`)
      writeFileSync(out, zip(entries))
      console.log(`${path.relative(ROOT, out)}: ${entries.length} files`)
    })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
