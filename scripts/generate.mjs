#!/usr/bin/env node
// Generate the data files of this site from the publication repository (rltp-spec):
// schemas at their $id paths, the JSON-LD context, and the two registries with digests.
// HTML pages come from scripts/generate-pages.mjs.
//
// Every schema declares, in its own $id, the URL it lives at. This site's job
// is to make that declaration true. Until now it did so with hand-copied files
// and hand-typed SHA-256 digests, which is why nine of eighteen schemas had
// drifted or gone missing within three days of publication. Copies rot; the
// fix is not to sync them more often but to stop keeping them.
//
// So: everything derivable is derived from rltp-spec. What genuinely cannot be
// derived — a human one-line summary, which specification section defines a
// type, what a vocabulary term means — lives in registry.meta.json, and the
// generator FAILS if that file and the shipped schemas disagree in either
// direction. Two hand-maintained lists are tolerable only when a machine holds
// them together.
//
//   usage: node scripts/generate.mjs [path-to-rltp-spec]   (default ../rltp-spec)
//          node scripts/generate.mjs --check               (fail if anything would change)

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const SPEC = join(ROOT, args.find((a) => !a.startsWith('--')) ?? '../rltp-spec')
const BASE = 'https://real-life.org/'

let errors = 0, written = 0, unchanged = 0
const err = (m) => { console.error(`  ERROR ${m}`); errors++ }
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

if (!existsSync(join(SPEC, 'schemas'))) {
  console.error(`No publication repository at ${SPEC}`); process.exit(1)
}

const emit = (relPath, content) => {
  const abs = join(ROOT, relPath)
  const before = existsSync(abs) ? readFileSync(abs, 'utf8') : null
  if (before === content) { unchanged++; return }
  if (CHECK) { err(`${relPath} is out of date`); return }
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  console.log(`  ${before === null ? 'new  ' : 'write'} ${relPath}`)
  written++
}

// ── inputs ───────────────────────────────────────────────────────────────
const meta = JSON.parse(readFileSync(join(ROOT, 'registry.meta.json'), 'utf8'))
const schemas = readdirSync(join(SPEC, 'schemas'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, text: readFileSync(join(SPEC, 'schemas', f), 'utf8') }))
  .map((s) => ({ ...s, doc: JSON.parse(s.text) }))
  .filter((s) => s.doc.$id?.startsWith(BASE))

const core = schemas.filter((s) => s.doc.$id.includes('/rltp/v1/schemas/'))
const types = schemas
  .filter((s) => s.doc.$id.includes('/trust-tasks/'))
  .map((s) => ({ ...s, slug: s.doc.$id.replace(`${BASE}trust-tasks/`, '') }))


// The profile a type belongs to is stated by the schema itself — in the modern
// title form "(rltp-access@0.24, …)" or the older "(Access Layer 0.24 …)". It is
// therefore derived, never carried in registry.meta.json: a version that lives in
// two places is a version that will disagree with itself.
const FAMILIES = { access: 'Access Layer', delivery: 'Delivery Contract', encounter: 'Encounter Layer', membership: 'Membership Tasks' }
const profileOf = (doc, file) => {
  const t = doc.title ?? ''
  const direct = t.match(/rltp-([a-z-]+)@([0-9]+\.[0-9]+)/)
  if (direct) return `rltp-${direct[1]}@${direct[2]}`
  for (const [fam, label] of Object.entries(FAMILIES)) {
    const m = t.match(new RegExp(`${label} ([0-9]+\\.[0-9]+)`))
    if (m) return `rltp-${fam}@${m[1]}`
  }
  err(`${file}: title states no conformance profile — cannot derive which layer owns this type`)
  return null
}

// ── the two hand-maintained lists must agree ─────────────────────────────
for (const t of types)
  if (!meta.types[t.slug]) err(`${t.file} ships type "${t.slug}" with no entry in registry.meta.json`)
for (const slug of Object.keys(meta.types))
  if (!types.some((t) => t.slug === slug)) err(`registry.meta.json describes "${slug}", which no shipped schema declares`)
if (errors) { console.error(`\n${errors} error(s) — refusing to generate from disagreeing inputs.`); process.exit(1) }

// ── schema files, at the paths their own $id promises ────────────────────
console.log('\n── schemas at their $id paths')
for (const s of core) emit(s.doc.$id.replace(BASE, ''), s.text)
for (const t of types) emit(`trust-tasks/${t.slug}/schema.json`, t.text)
const ctxFile = readdirSync(join(SPEC, 'contexts')).find((f) => f.endsWith('.jsonld'))
const ctxText = readFileSync(join(SPEC, 'contexts', ctxFile), 'utf8')
emit('rltp/v1/context.jsonld', ctxText)

// ── registries, with digests computed rather than typed ──────────────────
console.log('\n── machine-readable registries')
const j = (o) => JSON.stringify(o, null, 2) + '\n'

emit('trust-tasks/index.json', j({
  name: 'RLTP Trust Task type registry',
  publisher: meta.publisher,
  framework: meta.framework,
  specificationRepository: meta.specRepo,
  generatedFrom: 'rltp-spec/schemas — do not edit by hand, run scripts/generate.mjs',
  digestAlgorithm: 'SHA-256, lowercase hex, over the served bytes of the referenced file',
  documentProfile: (() => {
    const p = core.find((s) => s.file === 'rltp-delivery-document.schema.json')
    return p ? { schema: p.doc.$id, sha256: sha256(p.text) } : undefined
  })(),
  offlineRule: meta.offlineRule,
  types: types.map((t) => {
    const [name, version] = [t.slug.split('/')[0], t.slug.split('/')[1]]
    const m = meta.types[t.slug]
    return {
      type: t.doc.$id, name, version, profile: profileOf(t.doc, t.file), summary: m.summary,
      definedIn: m.definedIn,
      schema: `${t.doc.$id}/schema.json`, schemaSha256: sha256(t.text),
      documentation: `${t.doc.$id}/`,
    }
  }),
}))

emit('rltp/v1/index.json', j({
  name: 'RLTP vocabulary namespace',
  namespace: 'https://real-life.org/rltp/v1',
  publisher: meta.publisher,
  specificationRepository: meta.specRepo,
  generatedFrom: 'rltp-spec — do not edit by hand, run scripts/generate.mjs',
  digestAlgorithm: 'SHA-256, lowercase hex, over the served bytes of the referenced file',
  context: { url: `${BASE}rltp/v1/context.jsonld`, sha256: sha256(ctxText) },
  offlineRule: meta.vocabularyOfflineRule,
  terms: meta.terms,
  schemas: core.map((s) => ({
    name: s.file.replace('.schema.json', ''), url: s.doc.$id, sha256: sha256(s.text),
  })),
  taskTypeRegistry: `${BASE}trust-tasks/index.json`,
}))

// Documentation pages are generated by scripts/generate-pages.mjs from the same inputs.

console.log(`\n${written} written, ${unchanged} unchanged.`)
if (CHECK && errors) { console.error(`${errors} file(s) out of date — run without --check.`); process.exit(1) }
