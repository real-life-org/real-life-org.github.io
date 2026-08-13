#!/usr/bin/env node
// Generate this site from the publication repository.
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

// ── documentation pages ──────────────────────────────────────────────────
// Every type URI must resolve for a human as well as a machine: the URI is the
// contract we hand to other ecosystems, and a 404 there is a broken promise.
// The pages are generated, so a new type in rltp-spec can never ship without
// its page again.
const STYLE = `body{font-family:system-ui,sans-serif;max-width:760px;margin:3rem auto;padding:0 1.2rem;line-height:1.6;color:#1a2030}a{color:#2451b3}code{background:#f0f2f7;padding:.1em .35em;border-radius:4px;font-size:.92em}h1{font-size:1.5rem}h2{font-size:1.15rem;margin-top:2rem}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e2e6ef;padding:.4em .6em;text-align:left;font-size:.95em}footer{margin-top:3rem;font-size:.85em;color:#667}:target{background:#fdf3d8}@media(prefers-color-scheme:dark){body{background:#0e0e10;color:#e8e8ea}code{background:#1c1c22}td,th{border-color:#2c2c31}a{color:#7fb6d6}footer{color:#9a9aa4}:target{background:#2a2410}}`
const FOOT = `<footer>Real Life Trust Protocol · <a href="https://github.com/real-life-org/rltp-spec">specification repository</a> · <a href="https://rltp.real-life.org/simulator/">simulator</a></footer></body></html>`
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const page = (title, extraHead, body) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style>${extraHead}</head><body>\n${body}\n${FOOT}\n`

console.log('\n── documentation pages')
const OFFLINE_NOTE = '<p><em>Offline rule: conforming implementations pre-register every schema by its <code>$id</code> and never resolve over the network — this page is documentation, not infrastructure.</em></p>'

for (const t of types) {
  const m = meta.types[t.slug]
  const [name] = t.slug.split('/')
  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'DefinedTerm', '@id': t.doc.$id,
    name: t.slug, description: `RLTP Trust Task type — ${m.summary} Payload schema: ${t.doc.$id}/schema.json`,
    inDefinedTermSet: `${BASE}trust-tasks/`, url: `${t.doc.$id}/`,
  })
  emit(`trust-tasks/${t.slug}/index.html`, page(
    `${t.slug} — RLTP Trust Task type`,
    `<link rel="alternate" type="application/schema+json" href="schema.json"><script type="application/ld+json">${ld}</script>`,
    `<h1><code>${t.doc.$id}</code></h1>
<p><strong>${t.slug}</strong> is a private Trust Task type of the Real Life Trust Protocol (${esc(meta.framework)}).</p>
<p>${esc(m.summary)}</p>
<table><tr><th>Normative definition</th><td><a href="${m.definedIn.url}">${esc(m.definedIn.specification)} ${esc(m.definedIn.section)}</a></td></tr>
<tr><th>Conformance profile</th><td><code>${profileOf(t.doc, t.file)}</code></td></tr>
<tr><th>Payload schema ($id = this URI)</th><td><a href="schema.json">schema.json</a></td></tr>
<tr><th>Document profile</th><td><a href="/rltp/v1/schemas/rltp-delivery-document.schema.json">rltp-delivery-document.schema.json</a></td></tr></table>
${OFFLINE_NOTE}`))
}

emit('trust-tasks/index.html', page('RLTP Trust Task types',
  `<link rel="alternate" type="application/json" href="index.json"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', '@id': `${BASE}trust-tasks/`, name: 'RLTP Trust Task types', description: `Private Trust Task types of the Real Life Trust Protocol. Machine-readable registry: ${BASE}trust-tasks/index.json`, url: `${BASE}trust-tasks/` })}</script>`,
  `<h1>RLTP Trust Task types</h1>
<p>Private Trust Task types registered under <code>${BASE}trust-tasks/</code> by the Real Life Trust Protocol (${esc(meta.framework)}).</p>
<p>Machine-readable registry: <a href="index.json"><code>index.json</code></a> — every type with its Type URI, payload-schema URL, defining section and SHA-256 digest. Each payload schema resolves as raw JSON at <code>&lt;Type&nbsp;URI&gt;/schema.json</code>.</p>
<table><tr><th>Type</th><th>Defined in</th><th></th></tr>
${types.map((t) => { const m = meta.types[t.slug]
  return `<tr><td><a href="/trust-tasks/${t.slug}/"><code>${t.slug}</code></a></td><td>${esc(m.definedIn.specification)} ${esc(m.definedIn.section)}</td><td>${esc(m.summary)}</td></tr>` }).join('\n')}
</table>`))

emit('rltp/v1/index.html', page('RLTP vocabulary — real-life.org/rltp/v1',
  `<link rel="alternate" type="application/ld+json" href="context.jsonld"><link rel="alternate" type="application/json" href="index.json"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', '@id': `${BASE}rltp/v1`, name: 'RLTP vocabulary', description: `The vocabulary namespace of the Real Life Trust Protocol. JSON-LD context: ${BASE}rltp/v1/context.jsonld`, url: `${BASE}rltp/v1/` })}</script>`,
  `<h1><code>${BASE}rltp/v1</code></h1>
<p>The vocabulary namespace of the <strong>Real Life Trust Protocol</strong>. Permanent term identifiers are <code>${BASE}rltp/v1#&lt;Fragment&gt;</code>; the fragments resolve to the table below.</p>
<p>The JSON-LD context document is <a href="context.jsonld">context.jsonld</a>. Per the interim securing profile, credentials pin their <code>@context</code> by value and implementations never process JSON-LD at runtime — this document defines meaning, not machinery.</p>
<p>Machine-readable registry: <a href="index.json"><code>index.json</code></a> — all terms with IRI and definition, plus context and schema URLs with SHA-256 digests.</p>
<h2>Terms</h2>
<table><tr><th>Fragment</th><th>Meaning</th><th>Defined in</th></tr>
${meta.terms.map((t) => `<tr id="${t.fragment}"><td><code>#${t.fragment}</code></td><td>${esc(t.meaning)}</td><td>${esc(t.definedIn)}</td></tr>`).join('\n')}
</table>
<h2>Normative schemas</h2>
<p>${core.map((s) => `<a href="schemas/${s.file}">${s.file.replace('.schema.json', '')}</a>`).join(' · ')}</p>
<p>Task payload schemas live at their Type URIs under <a href="/trust-tasks/">/trust-tasks/</a>.</p>`))

console.log(`\n${written} written, ${unchanged} unchanged.`)
if (CHECK && errors) { console.error(`${errors} file(s) out of date — run without --check.`); process.exit(1) }
