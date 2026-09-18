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
import { shell, entry } from './shell.mjs'

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
// Pages use the shared shell (scripts/shell.mjs); these are English identifier pages, so the
// navigation marks "Identifiers".
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const page = (title, extraHead, body, opts = {}) => shell({ title, head: extraHead, active: (opts.l === 'de' ? '/de/#identifiers' : '/#identifiers'), body, ...opts })

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

// Retired versions keep their URI: a page that names the successor, the published schema untouched.
for (const [old, next] of Object.entries(meta.superseded ?? {})) {
  emit(`trust-tasks/${old}/index.html`, page(`${old} — superseded RLTP Trust Task type`,
    `<link rel="alternate" type="application/schema+json" href="schema.json">`,
    `<h1><code>${BASE}trust-tasks/${old}</code></h1>
<p><strong>${old}</strong> is a retired version of a private Trust Task type of the Real Life Trust Protocol. It is superseded by <a href="/trust-tasks/${next}/"><code>${next}</code></a>.</p>
<p>The URI keeps resolving because published identifiers do not disappear. The payload schema published under it stays available as <a href="schema.json">schema.json</a>; new documents use the current version.</p>
${OFFLINE_NOTE}`))
}

const TT = {
  en: { h: 'RLTP Trust Task types', p1: `Private Trust Task types registered under <code>${BASE}trust-tasks/</code> by the Real Life Trust Protocol (${esc(meta.framework)}).`, p2: 'Machine-readable registry: <a href="/trust-tasks/index.json"><code>index.json</code></a> — every type with its Type URI, payload-schema URL, defining section and SHA-256 digest. Each payload schema resolves as raw JSON at <code>&lt;Type&nbsp;URI&gt;/schema.json</code>.', profile: 'profile', defined: 'defined in' },
  de: { h: 'RLTP Trust-Task-Typen', p1: `Private Trust-Task-Typen, die das Real Life Trust Protocol unter <code>${BASE}trust-tasks/</code> registriert (${esc(meta.framework)}). Die Beschreibungen sind englisch, wie die Spezifikation.`, p2: 'Maschinenlesbares Register: <a href="/trust-tasks/index.json"><code>index.json</code></a> — jeder Typ mit Type URI, Payload-Schema-URL, definierendem Abschnitt und SHA-256-Prüfsumme. Jedes Payload-Schema löst als rohes JSON unter <code>&lt;Type&nbsp;URI&gt;/schema.json</code> auf.', profile: 'Profil', defined: 'definiert in' },
}
for (const l of ['en', 'de']) {
  const tt = TT[l]; const O = l === 'en' ? 'de' : 'en'
  emit(`${l === 'de' ? 'de/' : ''}trust-tasks/index.html`, page(tt.h,
    `<link rel="alternate" type="application/json" href="/trust-tasks/index.json"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', '@id': `${BASE}trust-tasks/`, name: 'RLTP Trust Task types', description: `Private Trust Task types of the Real Life Trust Protocol. Machine-readable registry: ${BASE}trust-tasks/index.json`, url: `${BASE}trust-tasks/` })}</script>`,
    `<h1>${tt.h}</h1>
<p>${tt.p1}</p>
<p>${tt.p2}</p>
<div class="entries">${types.map((t) => { const m = meta.types[t.slug]
  return entry({ id: t.slug.replace('/', '-'), world: 'task', href: `/trust-tasks/${t.slug}/`, label: t.slug, def: m.summary, l, rels: [{ text: tt.profile, target: profileOf(t.doc, t.file) }, { text: tt.defined, target: `${m.definedIn.specification} ${m.definedIn.section}`, href: m.definedIn.url }] }) }).join('\n')}</div>`,
    { l, search: true, alt: { lang: O, href: `${O === 'de' ? '/de' : ''}/trust-tasks/` } }))
}

const RV = {
  en: { p1: `The vocabulary namespace of the <strong>Real Life Trust Protocol</strong>. Permanent term identifiers are <code>${BASE}rltp/v1#&lt;Fragment&gt;</code>; the fragments resolve to the entries below.`, p2: 'The JSON-LD context document is <a href="/rltp/v1/context.jsonld">context.jsonld</a>. Per the interim securing profile, credentials pin their <code>@context</code> by value and implementations never process JSON-LD at runtime — this document defines meaning, not machinery.', p3: 'Machine-readable registry: <a href="/rltp/v1/index.json"><code>index.json</code></a> — all terms with IRI and definition, plus context and schema URLs with SHA-256 digests.', terms: 'Terms', defined: 'defined in', schemas: 'Normative schemas', tasks: 'Task payload schemas live at their Type URIs under <a href="/trust-tasks/">/trust-tasks/</a>.' },
  de: { p1: `Der Vokabular-Namensraum des <strong>Real Life Trust Protocol</strong>. Dauerhafte Kennungen sind <code>${BASE}rltp/v1#&lt;Fragment&gt;</code>; die Fragmente lösen zu den Einträgen unten auf. Die Bedeutungen sind englisch, wie die Spezifikation.`, p2: 'Das JSON-LD-Kontextdokument ist <a href="/rltp/v1/context.jsonld">context.jsonld</a>. Nach dem vorläufigen Sicherungsprofil binden Credentials ihren <code>@context</code> per Wert, und Implementierungen verarbeiten JSON-LD nie zur Laufzeit — dieses Dokument definiert Bedeutung, nicht Maschinerie.', p3: 'Maschinenlesbares Register: <a href="/rltp/v1/index.json"><code>index.json</code></a> — alle Begriffe mit IRI und Definition, dazu Kontext- und Schema-URLs mit SHA-256-Prüfsummen.', terms: 'Begriffe', defined: 'definiert in', schemas: 'Normative Schemas', tasks: 'Payload-Schemas der Task-Typen liegen unter ihren Type URIs unter <a href="/de/trust-tasks/">/trust-tasks/</a>.' },
}
for (const l of ['en', 'de']) {
  const r = RV[l]; const O = l === 'en' ? 'de' : 'en'
  emit(`${l === 'de' ? 'de/' : ''}rltp/v1/index.html`, page(l === 'de' ? 'RLTP-Vokabular · rltp/v1' : 'RLTP vocabulary · rltp/v1',
    `<link rel="alternate" type="application/ld+json" href="/rltp/v1/context.jsonld"><link rel="alternate" type="application/json" href="/rltp/v1/index.json"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', '@id': `${BASE}rltp/v1`, name: 'RLTP vocabulary', description: `The vocabulary namespace of the Real Life Trust Protocol. JSON-LD context: ${BASE}rltp/v1/context.jsonld`, url: `${BASE}rltp/v1/` })}</script>`,
    `<h1><code>${BASE}rltp/v1</code></h1>
<p>${r.p1}</p>
<p>${r.p2}</p>
<p>${r.p3}</p>
<h2>${r.terms}</h2>
<div class="entries">${meta.terms.map((t) => entry({ id: t.fragment, world: 'rltp', label: t.fragment, href: `/rltp/v1/#${t.fragment}`, def: t.meaning, l, rels: [{ text: r.defined, target: t.definedIn }] })).join('\n')}</div>
<h2>${r.schemas}</h2>
<p>${core.map((s) => `<a href="/rltp/v1/schemas/${s.file}">${s.file.replace('.schema.json', '')}</a>`).join(' · ')}</p>
<p>${r.tasks}</p>`,
    { l, search: true, alt: { lang: O, href: `${O === 'de' ? '/de' : ''}/rltp/v1/` } }))
}

console.log(`\n${written} written, ${unchanged} unchanged.`)
if (CHECK && errors) { console.error(`${errors} file(s) out of date — run without --check.`); process.exit(1) }
