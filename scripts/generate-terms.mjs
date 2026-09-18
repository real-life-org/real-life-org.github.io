#!/usr/bin/env node
// Generate the term namespaces /rlnp/v1, /rls/v1 and /meta/v1 from real-life-org/meta.
//
// The Real Life term register is federated: each part (RLNP, RLTP, RLS) keeps its
// own SKOS concept scheme, and real-life-org/meta holds the mappings between them.
// The identifiers of those concepts are promised under real-life.org; this script
// makes the promise true, the same way generate.mjs does for RLTP. Nothing here is
// written by hand: the source is meta/terms (and, once the parts carry their own
// scheme files, the repositories named in meta/terms/sources.json).
//
// /rltp/v1 stays with generate.mjs and rltp-spec. The RLTP concept scheme in the
// register maps onto the fragments that page already serves.
//
//   usage: node scripts/generate-terms.mjs [path-to-meta]   (default ../meta)
//          node scripts/generate-terms.mjs --check           (fail if anything would change)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const META = join(ROOT, args.find((a) => !a.startsWith('--')) ?? '../meta')
const BASE = 'https://real-life.org/'

let errors = 0, written = 0, unchanged = 0
const err = (m) => { console.error(`  ERROR ${m}`); errors++ }
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const j = (o) => JSON.stringify(o, null, 2) + '\n'
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

if (!existsSync(join(META, 'terms/sources.json'))) {
  console.error(`No meta repository at ${META}`); process.exit(1)
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
const sources = JSON.parse(readFileSync(join(META, 'terms/sources.json'), 'utf8')).schemes
const contextText = readFileSync(join(META, 'terms/context.jsonld'), 'utf8')
const mappingsText = readFileSync(join(META, 'terms/mappings.jsonld'.replace('mappings.jsonld', 'mappings.skos.jsonld')), 'utf8')
const mappings = JSON.parse(mappingsText)['@graph']
const PREFIX = { rlnp: `${BASE}rlnp/v1#`, rltp: `${BASE}rltp/v1#`, rls: `${BASE}rls/v1#` }

const schemeText = {}, concepts = {}
for (const [world, s] of Object.entries(sources)) {
  // Until a part carries its own file (ref is null), the seed copy in meta is the source.
  // When ref is set, the workflow must check that repository out and the path below must exist.
  const file = s.ref == null ? join(META, s.seed) : join(ROOT, world, s.path)
  if (!existsSync(file)) { err(`${world}: scheme file ${file} not found`); continue }
  schemeText[world] = readFileSync(file, 'utf8')
  for (const n of JSON.parse(schemeText[world])['@graph']) {
    if (n['@type'] !== 'skos:Concept') continue
    concepts[n['@id']] = { ...n, world }
  }
}
if (errors) { console.error(`\n${errors} error(s) — refusing to generate.`); process.exit(1) }

const lang = (vals, l) => (Array.isArray(vals) ? vals : [vals]).find((v) => v && v['@language'] === l)?.['@value'] ?? ''
const list = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])
const iri = (curie) => { const [p, f] = curie.split(':'); return PREFIX[p] ? PREFIX[p] + f : curie }
const fragment = (curie) => curie.split(':')[1]

// Labels read "<this term> is <label> <other term>". SKOS: "A skos:narrowMatch B" states that B is
// narrower than A, so A is broader than B; broadMatch is the reverse. Symmetric relations keep their
// predicate when shown from the other side; the two hierarchical ones swap.
const REL = { 'skos:exactMatch': 'same as', 'skos:closeMatch': 'close to', 'skos:relatedMatch': 'related to', 'skos:narrowMatch': 'broader than', 'skos:broadMatch': 'narrower than', 'rl:convergesWith': 'target: same as', 'rl:falseFriend': 'false friend of' }
const INVERSE = { 'skos:narrowMatch': 'skos:broadMatch', 'skos:broadMatch': 'skos:narrowMatch' }
const links = {}
const notes = {}
for (const m of mappings) {
  const a = m['@id']
  if (m['skos:note']) (notes[a] ??= []).push(m['skos:note'])
  for (const rel of Object.keys(REL)) for (const b of list(m[rel])) {
    if (!concepts[a] || !concepts[b]) { err(`mapping ${a} ${rel} ${b}: unknown concept`); continue }
    ;(links[a] ??= []).push([rel, b]); (links[b] ??= []).push([INVERSE[rel] ?? rel, a])
  }
}
if (errors) { console.error(`\n${errors} error(s) — refusing to generate.`); process.exit(1) }

// ── pages ────────────────────────────────────────────────────────────────
const STYLE = `body{font-family:system-ui,sans-serif;max-width:760px;margin:3rem auto;padding:0 1.2rem;line-height:1.6;color:#1a2030}a{color:#2451b3}code{background:#f0f2f7;padding:.1em .35em;border-radius:4px;font-size:.92em}h1{font-size:1.5rem}h2{font-size:1.15rem;margin-top:2rem}h3{font-size:1rem;margin:1.6rem 0 .2rem}dl{margin:0}dt{font-weight:600;margin-top:.6rem}dd{margin:0 0 0 1rem;color:#333c4d}.de{color:#556}.src,.map{font-size:.9em}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e2e6ef;padding:.4em .6em;text-align:left;font-size:.95em}footer{margin-top:3rem;font-size:.85em;color:#667}:target{background:#fdf3d8}@media(prefers-color-scheme:dark){body{background:#0e0e10;color:#e8e8ea}code{background:#1c1c22}dd{color:#c8c8d0}.de{color:#a9a9b4}td,th{border-color:#2c2c31}a{color:#7fb6d6}footer{color:#9a9aa4}:target{background:#2a2410}}`
const FOOT = `<footer>Real Life · <a href="https://github.com/real-life-org/meta">term register and mappings</a> · generated by scripts/generate-terms.mjs</footer></body></html>`
const page = (title, extraHead, body) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style>${extraHead}</head><body>\n${body}\n${FOOT}\n`

const WORLDS = {
  rlnp: { name: 'Real Life Network Protocol', short: 'RLNP', what: 'the social specification: what a circle, an encounter, a promise, a role mean', repo: 'https://github.com/real-life-org/real-life-network-protocol' },
  rls: { name: 'Real Life Stack', short: 'RLS', what: 'the app toolkit: application, data and the connector socket', repo: 'https://github.com/real-life-org/real-life-stack' },
}

const conceptHtml = (c) => {
  const f = fragment(c['@id'])
  const rows = (links[c['@id']] ?? []).map(([rel, b]) => {
    const o = concepts[b]
    const label = lang(o['skos:prefLabel'], 'en') || b
    return `<li>${REL[rel]} <a href="${iri(b)}">${esc(label)}</a> <span class="de">(${o.world.toUpperCase()})</span></li>`
  }).join('')
  const alts = list(c['skos:altLabel']).map((a) => a['@value']).filter(Boolean)
  return `<h3 id="${esc(f)}"><code>#${esc(f)}</code> ${esc(lang(c['skos:prefLabel'], 'en'))} <span class="de">· ${esc(lang(c['skos:prefLabel'], 'de'))}</span>${c['rl:status'] === 'proposed' ? ' <em>(proposed, not yet in the specification)</em>' : ''}</h3>
<dl><dt>Definition</dt><dd>${esc(lang(c['skos:definition'], 'en'))}</dd><dd class="de">${esc(lang(c['skos:definition'], 'de'))}</dd>
${alts.length ? `<dt>Also</dt><dd>${esc(alts.join(', '))}</dd>` : ''}
<dt class="src">Source</dt><dd class="src">${list(c['dct:source']).map((u) => `<a href="${u}">${esc(u.split('/').slice(-1)[0])}</a>`).join(', ')}</dd>
${rows ? `<dt class="map">Mappings</dt><dd class="map"><ul>${rows}</ul></dd>` : ''}
${(notes[c['@id']] ?? []).map((n) => `<dd class="map"><em>${esc(n)}</em></dd>`).join('')}</dl>`
}

console.log('\n── term namespaces')
for (const [world, w] of Object.entries(WORLDS)) {
  const ns = `${BASE}${world}/v1`
  const own = Object.values(concepts).filter((c) => c.world === world).sort((a, b) => fragment(a['@id']).localeCompare(fragment(b['@id'])))
  emit(`${world}/v1/terms.jsonld`, schemeText[world])
  emit(`${world}/v1/index.json`, j({
    name: `${w.short} term namespace`, namespace: ns, publisher: BASE, specificationRepository: w.repo,
    generatedFrom: 'real-life-org/meta — do not edit by hand, run scripts/generate-terms.mjs',
    context: { url: `${BASE}meta/v1/context.jsonld`, sha256: sha256(contextText) },
    scheme: { url: `${ns}/terms.jsonld`, sha256: sha256(schemeText[world]) },
    mappings: { url: `${BASE}meta/v1/mappings.jsonld`, sha256: sha256(mappingsText) },
    terms: own.map((c) => ({ iri: iri(c['@id']), en: lang(c['skos:prefLabel'], 'en'), de: lang(c['skos:prefLabel'], 'de'), status: c['rl:status'] ?? 'in specification' })),
  }))
  emit(`${world}/v1/index.html`, page(`${w.short} terms — real-life.org/${world}/v1`,
    `<link rel="alternate" type="application/ld+json" href="terms.jsonld"><link rel="alternate" type="application/json" href="index.json"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', '@id': ns, name: `${w.short} terms`, description: `Term namespace of the ${w.name}. SKOS concept scheme: ${ns}/terms.jsonld`, url: `${ns}/` })}</script>`,
    `<h1><code>${ns}</code></h1>
<p>The term namespace of the <strong>${w.name}</strong>, ${w.what}. Permanent identifiers are <code>${ns}#&lt;Fragment&gt;</code>; the fragments resolve to the entries below.</p>
<p>Each term is defined by the ${w.short} specification itself (<a href="${w.repo}">repository</a>). Mappings to the other parts of Real Life come from the <a href="/meta/v1/">shared register</a>: a term is <em>same as</em>, <em>close to</em>, <em>related to</em>, <em>broader</em> or <em>narrower than</em> its counterpart, or a deliberate <em>false friend</em>; <em>target: same as</em> marks a convergence the specifications still owe.</p>
<p>Machine-readable: <a href="terms.jsonld"><code>terms.jsonld</code></a> (SKOS concept scheme, JSON-LD) and <a href="index.json"><code>index.json</code></a> (registry with digests).</p>
<h2>Terms</h2>
${own.map(conceptHtml).join('\n')}`))
}

// ── /meta/v1: the shared context, the rl: fields, the mappings ───────────
console.log('\n── meta namespace')
emit('meta/v1/context.jsonld', contextText)
emit('meta/v1/mappings.jsonld', mappingsText)
const RL = [
  ['convergesWith', 'The target state: these two concepts are meant to become the same, and the specifications have a task until they are. The SKOS mapping relations describe today.'],
  ['falseFriend', 'Same word in at least one language, different thing, on purpose. Recorded so the pair is never reported as a missing mapping and so the pages show it explicitly.'],
  ['status', '"proposed": the concept does not exist in its specification yet; it is a proposal from the register to that part.'],
  ['symbol', 'Code symbols that implement the term (Real Life Stack only).'],
]
emit('meta/v1/index.json', j({
  name: 'Real Life shared term register', namespace: `${BASE}meta/v1`, publisher: BASE,
  registerRepository: 'https://github.com/real-life-org/meta',
  generatedFrom: 'real-life-org/meta — do not edit by hand, run scripts/generate-terms.mjs',
  context: { url: `${BASE}meta/v1/context.jsonld`, sha256: sha256(contextText) },
  mappings: { url: `${BASE}meta/v1/mappings.jsonld`, sha256: sha256(mappingsText) },
  fields: RL.map(([f, d]) => ({ iri: `${BASE}meta/v1#${f}`, definition: d })),
  schemes: Object.fromEntries(Object.entries(PREFIX).map(([w, p]) => [w, p.slice(0, -1)])),
}))
emit('meta/v1/index.html', page('Real Life shared term register — real-life.org/meta/v1',
  `<link rel="alternate" type="application/ld+json" href="context.jsonld"><link rel="alternate" type="application/json" href="index.json">`,
  `<h1><code>${BASE}meta/v1</code></h1>
<p>The shared part of the Real Life term register. The three parts of Real Life keep their own SKOS concept schemes: <a href="/rlnp/v1/">RLNP</a> (meaning), <a href="/rltp/v1/">RLTP</a> (construction) and <a href="/rls/v1/">RLS</a> (interface and code). This namespace holds what none of them owns alone: the JSON-LD context all three use, the mappings between them, and the few fields SKOS does not have.</p>
<p>Machine-readable: <a href="context.jsonld"><code>context.jsonld</code></a>, <a href="mappings.jsonld"><code>mappings.jsonld</code></a>, <a href="index.json"><code>index.json</code></a>.</p>
<h2>Fields</h2>
<table><tr><th>Fragment</th><th>Meaning</th></tr>
${RL.map(([f, d]) => `<tr id="${f}"><td><code>#${f}</code></td><td>${esc(d)}</td></tr>`).join('\n')}
</table>
<h2>Rule</h2>
<p>Definitions never live here. Each part defines its terms in its own repository and stays normative for them; the register only connects them. Source and checks: <a href="https://github.com/real-life-org/meta">real-life-org/meta</a>.</p>`))

console.log(`\n${written} written, ${unchanged} unchanged.`)
if (CHECK && errors) { console.error(`${errors} file(s) out of date — run without --check.`); process.exit(1) }
