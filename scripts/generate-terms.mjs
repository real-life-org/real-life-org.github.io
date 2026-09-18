#!/usr/bin/env node
// Generate the term namespaces /rlnp/v1, /rls/v1 and /meta/v1, and the gate page at /, from real-life-org/meta.
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
// Where a term can be read. /rltp/v1 is generated from rltp-spec's fragment tables, so a concept the
// register only proposes to RLTP has no section there yet; its link goes to the source it cites.
const termHref = (c) => (c.world === 'rltp' && c['rl:status'] === 'proposed' ? list(c['dct:source'])[0] : iri(c['@id']))

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
    return `<li>${REL[rel]} <a href="${termHref(o)}">${esc(label)}</a> <span class="de">(${o.world.toUpperCase()})</span></li>`
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

// ── the gate: real-life.org itself ───────────────────────────────────────
// The root page shows the whole: the layer picture and the three parts, one sentence each,
// then the identifiers this domain anchors. English at /, German at /de/.
// Content comes from meta/overview/parts.json; the picture from meta/overview/layers.{en,de}.svg.
console.log('\n── gate page')
const parts = JSON.parse(readFileSync(join(META, 'overview/parts.json'), 'utf8'))
for (const l of ['en', 'de']) emit(`overview/layers.${l}.svg`, readFileSync(join(META, `overview/layers.${l}.svg`), 'utf8'))
const GATE_STYLE = STYLE + `.parts{display:grid;grid-template-columns:repeat(3,1fr);gap:1.4rem;margin:1.6rem 0}@media(max-width:640px){.parts{grid-template-columns:1fr}}.part h2{margin:.2rem 0 .3rem}.part p{margin:.2rem 0}.part ul{margin:.4rem 0 .6rem 1.1rem;padding:0}.part .for{font-size:.9em;color:#667}figure{margin:1.6rem 0}figure img{width:100%;height:auto;display:block;border-radius:6px}.lang{float:right;font-size:.9em}@media(prefers-color-scheme:dark){.part .for{color:#9a9aa4}}`
const T = {
  en: { ids: 'Identifiers anchored here', idsText: 'The permanent identifiers of all three parts live under this domain. They follow the protocols, not the branding; a breaking change gets a new version, not a new word.', picture: 'The three parts: the Network Protocol beside the Stack, the Trust Protocol filling the layers below the connector.', other: 'Deutsch', otherHref: '/de/', rows: [['/terms', 'the dictionary: all terms of the three parts side by side'], ['/rlnp/v1', 'terms of the Real Life Network Protocol'], ['/rls/v1', 'terms of the Real Life Stack'], ['/rltp/v1', 'vocabulary, context and schemas of the Real Life Trust Protocol'], ['/trust-tasks', 'RLTP Trust Task types (ToIP DTGWG framework 0.4)'], ['/meta/v1', 'the shared register: context, mappings between the three parts, register fields']], meta: 'Picture, seams and register: <a href="https://github.com/real-life-org/meta">real-life-org/meta</a>.' },
  de: { ids: 'Kennungen, die hier verankert sind', idsText: 'Die dauerhaften Kennungen aller drei Teile liegen unter dieser Domain. Sie folgen den Protokollen, nicht dem Branding; ein Bruch bekommt eine neue Version, kein neues Wort.', picture: 'Die drei Teile: das Netzwerkprotokoll neben dem Stack, das Trust Protocol füllt die Schichten unter dem Connector.', other: 'English', otherHref: '/', rows: [['/terms', 'das Wörterbuch: alle Begriffe der drei Teile nebeneinander'], ['/rlnp/v1', 'Begriffe des Real Life Network Protocol'], ['/rls/v1', 'Begriffe des Real Life Stack'], ['/rltp/v1', 'Vokabular, Kontext und Schemas des Real Life Trust Protocol'], ['/trust-tasks', 'RLTP Trust-Task-Typen (ToIP DTGWG Framework 0.4)'], ['/meta/v1', 'das gemeinsame Register: Kontext, Verknüpfungen zwischen den drei Teilen, Registerfelder']], meta: 'Bild, Nähte und Register: <a href="https://github.com/real-life-org/meta">real-life-org/meta</a>.' },
}
const gatePage = (l) => {
  const t = T[l]
  const body = `<p class="lang"><a href="${t.otherHref}" lang="${l === 'en' ? 'de' : 'en'}">${t.other}</a></p>
<h1>${esc(parts.gate.title[l])}</h1>
<p>${esc(parts.gate.sentence[l])}</p>
<figure><a href="/overview/layers.${l}.svg"><img src="/overview/layers.${l}.svg" alt="${esc(t.picture)}"></a></figure>
<div class="parts">
${parts.parts.map((p) => `<section class="part" id="${p.id}"><h2><a href="${p.url}">${esc(p.name[l])}</a></h2><p>${esc(p.sentence[l])}</p><p class="for">${esc(p.for[l])}</p></section>`).join('\n')}
</div>
<h2>${t.ids}</h2>
<p>${t.idsText}</p>
<table>${t.rows.map(([path, what]) => `<tr><th><a href="${path}/">${path}</a></th><td>${what}</td></tr>`).join('\n')}</table>
<p>${t.meta}</p>`
  return `<!DOCTYPE html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(parts.gate.title[l])} — real-life.org</title><link rel="alternate" hreflang="${l === 'en' ? 'de' : 'en'}" href="https://real-life.org${t.otherHref}"><style>${GATE_STYLE}</style></head><body>\n${body}\n<footer>real-life.org · <a href="https://github.com/real-life-org">real-life-org</a> · generated from real-life-org/meta by scripts/generate-terms.mjs</footer></body></html>\n`
}
emit('index.html', gatePage('en'))
emit('de/index.html', gatePage('de'))

// ── the dictionary: all terms of the three parts, side by side ───────────
// One page for people, not per world: a concept with its counterparts next to it. Every
// entry links to where it can be changed (the owning repository; GitHub turns an edit into a
// pull request) and to a prefilled issue for those who would rather propose than edit.
console.log('\n── dictionary')
const parent = {}
const find = (x) => (parent[x] === undefined || parent[x] === x) ? (parent[x] = x) : (parent[x] = find(parent[x]))
const union = (a, b) => { parent[find(a)] = find(b) }
for (const c of Object.keys(concepts)) find(c)
// A row is one concept, so only sameness joins two terms: exactMatch and closeMatch. Related,
// broader, narrower and convergence targets stay cross-references under the entry; joining them
// would put Bezeugen, Beziehung, Rolle and Verifikation in one row.
const SAME = new Set(['skos:exactMatch', 'skos:closeMatch'])
for (const [a, rels] of Object.entries(links)) for (const [rel, b] of rels) if (SAME.has(rel)) union(a, b)
const clusters = {}
for (const c of Object.keys(concepts)) (clusters[find(c)] ??= []).push(c)
const WORLD_ORDER = ['rlnp', 'rls', 'rltp']
const WORLD_NAME = { en: { rlnp: 'Network', rls: 'Stack', rltp: 'Trust Protocol' }, de: { rlnp: 'Netzwerk', rls: 'Stack', rltp: 'Trust Protocol' } }
const REL_L = { en: REL, de: { 'skos:exactMatch': 'gleich', 'skos:closeMatch': 'nahezu gleich', 'skos:relatedMatch': 'verwandt mit', 'skos:narrowMatch': 'allgemeiner als', 'skos:broadMatch': 'spezieller als', 'rl:convergesWith': 'Ziel: gleich mit', 'rl:falseFriend': 'falscher Freund von' } }
const sortedClusters = Object.values(clusters).sort((x, y) => (y.length - x.length) || x[0].localeCompare(y[0]))
const editUrl = (c) => {
  const s = sources[c.world]
  return s.ref == null
    ? `https://github.com/real-life-org/meta/edit/main/${s.seed}`
    : `https://github.com/${s.repo}/edit/${s.branch ?? 'main'}/${s.path}`
}
const proposeUrl = (c, l) => {
  const s = sources[c.world]
  const title = (l === 'de' ? 'Begriff ändern: ' : 'Change term: ') + lang(c['skos:prefLabel'], l)
  const body = (l === 'de'
    ? `Begriff: ${iri(c['@id'])}\n\nHeutige Definition:\n${lang(c['skos:definition'], 'de')}\n\nVorschlag:\n\nWarum:\n`
    : `Term: ${iri(c['@id'])}\n\nCurrent definition:\n${lang(c['skos:definition'], 'en')}\n\nProposal:\n\nWhy:\n`)
  const repo = s.ref == null ? 'real-life-org/meta' : s.repo
  return `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
}
const D = {
  en: { title: 'Dictionary', sub: 'All terms of the three parts of Real Life. Each part defines its own terms; this page puts them next to each other and shows how they relate.', search: 'Search terms…', termsN: 'terms', proposedN: 'proposals', convergeN: 'convergence tasks', guardOk: 'Guard: no findings', proposal: 'proposal', oneThing: 'one thing in', worlds: 'parts', alone: 'only here', newTerm: 'New term', edit: 'edit', propose: 'propose', how: '<em>edit</em> opens the defining file of the part; GitHub turns the change into a pull request. <em>propose</em> opens a prefilled issue. <em>New term</em> opens an issue with the fields a term needs.', noResults: 'No term matches the search.', other: 'DE', otherHref: '/de/terms/', pic: 'How the three parts fit together', newTermIssue: ['New term: ', 'Part (Network / Stack / Trust Protocol):', 'Label DE / EN:', 'Definition DE:', 'Definition EN:', 'Mappings to existing terms (same, related, false friend, target: same):', 'Source in the spec:', 'Why:'] },
  de: { title: 'Wörterbuch', sub: 'Alle Begriffe der drei Teile von Real Life. Jeder Teil definiert seine Begriffe selbst; diese Seite stellt sie nebeneinander und zeigt, wie sie zusammenhängen.', search: 'Begriff suchen…', termsN: 'Begriffe', proposedN: 'Vorschläge', convergeN: 'Konvergenzaufgaben', guardOk: 'Guard: keine Hinweise', proposal: 'Vorschlag', oneThing: 'ein Ding in', worlds: 'Teilen', alone: 'nur hier', newTerm: 'Begriff anlegen', edit: 'ändern', propose: 'vorschlagen', how: '<em>ändern</em> öffnet die Definitionsdatei des Teils; GitHub macht aus der Änderung einen Pull Request. <em>vorschlagen</em> öffnet ein vorbefülltes Issue. <em>Begriff anlegen</em> öffnet ein Issue mit den Feldern, die ein Begriff braucht.', noResults: 'Kein Begriff passt zur Suche.', other: 'EN', otherHref: '/terms/', pic: 'Wie die drei Teile zusammengehören', newTermIssue: ['Neuer Begriff: ', 'Teil (Netzwerk / Stack / Trust Protocol):', 'Bezeichnung DE / EN:', 'Definition DE:', 'Definition EN:', 'Zuordnungen zu bestehenden Begriffen (gleich, verwandt, falscher Freund, Ziel: gleich):', 'Quelle in der Spec:', 'Warum:'] },
}
const WCOL = { rlnp: ['#3f7a4e', '#e6f0e7', '#7cc48a', '#1e2f23'], rls: ['#b36b1c', '#f7ecdd', '#e0a25a', '#33281a'], rltp: ['#2f62c9', '#e5ecfa', '#7fa6f0', '#1d2738'] }
// Layout from the Claude Design prototype "Wörterbuch" (list view), 2026-09-18: header with title,
// search, language switch and "new term"; a stats line; one card per row; entries with a world badge.
const DICT_STYLE = `:root{--bg:#fff;--ink:#1a2030;--muted:#667;--soft:#556;--text2:#333c4d;--line:#e2e6ef;--field:#d5dae6;--chip:#f0f2f7;--hover:#f6f7fa;--link:#2451b3;--warn:#b45309;--rlnp:#3f7a4e;--rlnp-t:#e6f0e7;--rls:#b36b1c;--rls-t:#f7ecdd;--rltp:#2f62c9;--rltp-t:#e5ecfa}
@media(prefers-color-scheme:dark){:root{--bg:#0e0e10;--ink:#e8e8ea;--muted:#9a9aa4;--soft:#b9b9c3;--text2:#d0d0d6;--line:#2c2c31;--field:#3a3a42;--chip:#1c1c22;--hover:#18181d;--link:#7fb6d6;--warn:#fbbf24;--rlnp:#7cc48a;--rlnp-t:#1e2f23;--rls:#e0a25a;--rls-t:#33281a;--rltp:#7fa6f0;--rltp-t:#1d2738}}
body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5}a{color:var(--link)}
header{display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;padding:18px 28px 14px;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:baseline;gap:10px}.brand b{font-size:1.35rem;font-weight:650;letter-spacing:-.01em}.brand span{font-size:.85rem;color:var(--muted)}
header input{flex:1 1 180px;max-width:320px;padding:6px 12px;border:1px solid var(--field);border-radius:8px;background:var(--bg);color:var(--ink);outline:none;font:inherit}header input:focus{border-color:var(--link)}
.right{margin-left:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--field);background:var(--bg);border-radius:8px;padding:5px 12px;font-size:.9rem;white-space:nowrap;text-decoration:none;color:var(--ink)}.btn:hover{background:var(--chip)}.btn small{color:var(--muted);font-size:.78rem}
main{padding:22px 28px 60px;max-width:900px}
.sub{margin:0 0 6px;max-width:760px;color:var(--text2);font-size:.95rem;text-wrap:pretty}
.stats{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:.85rem;color:var(--muted);margin-bottom:22px}
.rows{display:flex;flex-direction:column;gap:10px;max-width:820px}
.row{border:1px solid var(--line);border-radius:10px;padding:12px 16px;background:var(--bg)}
.rowhead{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px}.rowhead b{font-size:1.05rem;font-weight:650}.rowhead span{font-size:.85rem;color:var(--muted)}
.entries{display:flex;flex-direction:column;gap:6px}
.e{display:grid;grid-template-columns:126px minmax(0,1fr);gap:12px;align-items:start;padding:6px 8px;margin:0 -8px;border-radius:6px}.e:hover{background:var(--hover)}.e:target{background:#fdf3d8}
@media(max-width:560px){.e{grid-template-columns:1fr;gap:4px}}
.w{justify-self:start;font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;font-weight:600;border-radius:4px;padding:2px 7px;margin-top:3px;white-space:nowrap}
.w-rlnp{color:var(--rlnp);background:var(--rlnp-t)}.w-rls{color:var(--rls);background:var(--rls-t)}.w-rltp{color:var(--rltp);background:var(--rltp-t)}
.head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px}.head b a{color:inherit;text-decoration:none}.head b a:hover{text-decoration:underline}.head .o{font-size:.88em;color:var(--soft)}
.tag{font-size:.72em;border:1px solid var(--warn);color:var(--warn);border-radius:4px;padding:0 .35em}
.def{margin:2px 0 0;font-size:.92em;color:var(--text2);text-wrap:pretty}
.rels{display:flex;flex-wrap:wrap;gap:2px 10px;margin-top:4px;font-size:.82em;color:var(--soft)}.rels span{white-space:nowrap}.rels i{font-style:normal;color:var(--muted)}
.act{margin-top:3px;font-size:.8em}.act a{margin-right:.7em;color:var(--muted)}.act a:hover{color:var(--link)}
.note{margin:4px 0 0;font-size:.85em;color:var(--soft);font-style:italic}
.empty{display:none;color:var(--muted);padding:24px 0}
footer{padding:0 28px 28px;font-size:.85em;color:var(--muted)}`
const REL_COLOR = { 'rl:convergesWith': 'var(--warn)', 'rl:falseFriend': '#b91c1c' }
const dictPage = (l) => {
  const t = D[l]; const O = l === 'en' ? 'de' : 'en'
  const nProposed = Object.values(concepts).filter((c) => c['rl:status'] === 'proposed').length
  const nConv = Object.entries(links).reduce((n, [a, v]) => n + v.filter(([r, b]) => r === 'rl:convergesWith' && a < b).length, 0)
  const noteOf = (id) => (notes[id] ?? [])[0]
  const entry = (id) => {
    const c = concepts[id]
    const others = (links[id] ?? []).filter(([rel]) => rel !== 'skos:exactMatch')
    const rels = others.map(([rel, b]) => `<span style="${REL_COLOR[rel] ? `color:${REL_COLOR[rel]}` : ''}">${REL_L[l][rel]} <a href="${termHref(concepts[b])}">${esc(lang(concepts[b]['skos:prefLabel'], l) || b)}</a> <i>(${WORLD_NAME[l][concepts[b].world]})</i></span>`).join('')
    const n = noteOf(id)
    return `<div class="e" id="${c.world}-${fragment(id)}"><span class="w w-${c.world}">${WORLD_NAME[l][c.world]}</span><div>
<div class="head"><b><a href="${termHref(c)}">${esc(lang(c['skos:prefLabel'], l))}</a></b><span class="o">${esc(lang(c['skos:prefLabel'], O))}</span>${c['rl:status'] === 'proposed' ? `<span class="tag">${t.proposal}</span>` : ''}</div>
<p class="def">${esc(lang(c['skos:definition'], l))}</p>
${rels ? `<div class="rels">${rels}</div>` : ''}${n && !others.length && !(links[id] ?? []).length ? `<p class="note">${esc(n)}</p>` : ''}
<div class="act"><a href="${editUrl(c)}">${t.edit}</a><a href="${proposeUrl(c, l)}">${t.propose}</a></div></div></div>`
  }
  const rows = sortedClusters.map((ids) => {
    const es = [...ids].sort((x, y) => WORLD_ORDER.indexOf(concepts[x].world) - WORLD_ORDER.indexOf(concepts[y].world))
    const labels = [...new Set(es.map((id) => lang(concepts[id]['skos:prefLabel'], l)))]
    const hint = ids.length > 1 ? `${t.oneThing} ${ids.length} ${t.worlds}` : t.alone
    return `<section class="row" data-q="${esc(es.map((id) => [lang(concepts[id]['skos:prefLabel'], 'de'), lang(concepts[id]['skos:prefLabel'], 'en'), lang(concepts[id]['skos:definition'], 'de'), lang(concepts[id]['skos:definition'], 'en')].join(' ')).join(' ').toLowerCase())}"><div class="rowhead"><b>${esc(labels.join(' · '))}</b><span>${hint}</span></div><div class="entries">${es.map(entry).join('\n')}</div></section>`
  }).join('\n')
  const newTermUrl = `https://github.com/real-life-org/meta/issues/new?title=${encodeURIComponent(t.newTermIssue[0])}&body=${encodeURIComponent(t.newTermIssue.slice(1).join('\n\n') + '\n')}`
  const body = `<header><div class="brand"><b>${t.title}</b><span>real-life.org</span></div>
<input id="q" type="search" placeholder="${t.search}" aria-label="${t.search}">
<div class="right"><a class="btn" href="${t.otherHref}" lang="${O}">${t.other}</a><a class="btn" href="${newTermUrl}">+ ${t.newTerm} <small>Issue ↗</small></a></div></header>
<main>
<p class="sub">${t.sub}</p>
<div class="stats"><span>${Object.keys(concepts).length} ${t.termsN}</span><span>${nProposed} ${t.proposedN}</span><span>${nConv} ${t.convergeN}</span><span>${t.guardOk}</span><a href="/${l === 'de' ? 'de/' : ''}">${t.pic}</a></div>
<div class="rows" id="rows">
${rows}
</div>
<p class="empty" id="empty">${t.noResults}</p>
<p class="sub" style="margin-top:22px;font-size:.88rem">${t.how}</p>
</main>
<footer>real-life.org · <a href="https://github.com/real-life-org/meta">real-life-org/meta</a> · generated by scripts/generate-terms.mjs</footer>
<script>(function(){var q=document.getElementById('q'),rows=[].slice.call(document.querySelectorAll('.row')),empty=document.getElementById('empty');q.addEventListener('input',function(){var v=q.value.trim().toLowerCase(),n=0;rows.forEach(function(r){var hit=!v||r.getAttribute('data-q').indexOf(v)>-1;r.style.display=hit?'':'none';if(hit)n++});empty.style.display=n?'none':'block'})})()</script>`
  return `<!DOCTYPE html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title} — real-life.org</title><link rel="alternate" hreflang="${O}" href="https://real-life.org${t.otherHref}"><style>${DICT_STYLE}</style></head><body>\n${body}\n</body></html>\n`
}
emit('terms/index.html', dictPage('en'))
emit('de/terms/index.html', dictPage('de'))

console.log(`\n${written} written, ${unchanged} unchanged.`)
if (CHECK && errors) { console.error(`${errors} file(s) out of date — run without --check.`); process.exit(1) }
