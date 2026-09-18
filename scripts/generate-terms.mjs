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
  en: { title: 'Dictionary', intro: 'All terms of the three parts of Real Life, side by side. A row is one concept: what it means in the Network Protocol, how the Stack shows it, how the Trust Protocol constructs it. Terms that are only related, broader or narrower, or meant to converge, stay in their own rows and appear as cross-references under the entry. Each part defines its own terms; this page only puts them next to each other.', how: 'To change a term, use <em>edit</em>: it opens the defining file in the owning repository, and GitHub turns your change into a pull request. To suggest without editing, use <em>propose</em>: it opens a prefilled issue.', edit: 'edit', propose: 'propose', alone: 'no counterpart, on purpose', proposed: 'proposal', other: 'Deutsch', otherHref: '/de/terms/', pic: 'How the three parts fit together' },
  de: { title: 'Wörterbuch', intro: 'Alle Begriffe der drei Teile von Real Life, nebeneinander. Eine Zeile ist ein Begriff: was er im Netzwerkprotokoll bedeutet, wie der Stack ihn zeigt, wie das Trust Protocol ihn konstruiert. Begriffe, die nur verwandt, allgemeiner oder spezieller sind oder erst noch zusammenwachsen sollen, bleiben in eigenen Zeilen und stehen als Querverweise unter dem Eintrag. Jeder Teil definiert seine Begriffe selbst; diese Seite stellt sie nur nebeneinander.', how: 'Um einen Begriff zu ändern, nimm <em>ändern</em>: Es öffnet die Definitionsdatei im zuständigen Repo, und GitHub macht aus der Änderung einen Pull Request. Wer nur vorschlagen will, nimmt <em>vorschlagen</em>: ein vorbefülltes Issue.', edit: 'ändern', propose: 'vorschlagen', alone: 'bewusst ohne Gegenstück', proposed: 'Vorschlag', other: 'English', otherHref: '/terms/', pic: 'Wie die drei Teile zusammengehören' },
}
const DICT_STYLE = STYLE + `body{max-width:1100px}.cluster{border-top:1px solid #e2e6ef;padding:1.2rem 0 .6rem}.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:1.2rem}@media(max-width:720px){.cols{grid-template-columns:1fr}}.col h4{margin:0 0 .3rem;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:#667}.t{margin:0 0 .9rem}.t b{font-size:1.02em}.t .de{font-size:.92em}.t p{margin:.15rem 0;font-size:.95em}.t .rel{font-size:.86em;color:#556;margin-top:.2rem}.t .act{font-size:.82em;margin-top:.25rem}.t .act a{margin-right:.6rem}.tag{font-size:.72em;border:1px solid #b45309;color:#b45309;border-radius:4px;padding:0 .3em;vertical-align:.1em}.lang{float:right;font-size:.9em}@media(prefers-color-scheme:dark){.cluster{border-color:#2c2c31}.col h4{color:#9a9aa4}.t .rel{color:#b9b9c3}.tag{border-color:#fbbf24;color:#fbbf24}}`
const dictPage = (l) => {
  const t = D[l]
  const entry = (id) => {
    const c = concepts[id]
    const rels = (links[id] ?? []).map(([rel, b]) => `${REL_L[l][rel]} <a href="${termHref(concepts[b])}">${esc(lang(concepts[b]['skos:prefLabel'], l) || b)}</a> <span class="de">(${WORLD_NAME[l][concepts[b].world]})</span>`).join(' · ')
    return `<div class="t" id="${c.world}-${fragment(id)}"><b><a href="${termHref(c)}">${esc(lang(c['skos:prefLabel'], l))}</a></b> <span class="de">${esc(lang(c['skos:prefLabel'], l === 'en' ? 'de' : 'en'))}</span>${c['rl:status'] === 'proposed' ? ` <span class="tag">${t.proposed}</span>` : ''}
<p>${esc(lang(c['skos:definition'], l))}</p>
${rels ? `<div class="rel">${rels}</div>` : `<div class="rel">${t.alone}</div>`}
<div class="act"><a href="${editUrl(c)}">${t.edit}</a><a href="${proposeUrl(c, l)}">${t.propose}</a></div></div>`
  }
  const body = `<p class="lang"><a href="${t.otherHref}" lang="${l === 'en' ? 'de' : 'en'}">${t.other}</a></p>
<h1>${t.title}</h1>
<p>${t.intro}</p>
<p>${t.how}</p>
<p><a href="/${l === 'de' ? 'de/' : ''}">${t.pic}</a> · <a href="/meta/v1/">meta/v1</a></p>
${sortedClusters.map((ids) => `<section class="cluster"><div class="cols">${WORLD_ORDER.map((w) => {
    const own = ids.filter((id) => concepts[id].world === w).sort()
    return `<div class="col"><h4>${WORLD_NAME[l][w]}</h4>${own.map(entry).join('\n') || ''}</div>`
  }).join('\n')}</div></section>`).join('\n')}`
  return `<!DOCTYPE html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title} — real-life.org</title><link rel="alternate" hreflang="${l === 'en' ? 'de' : 'en'}" href="https://real-life.org${t.otherHref}"><style>${DICT_STYLE}</style></head><body>\n${body}\n<footer>real-life.org · <a href="https://github.com/real-life-org/meta">real-life-org/meta</a> · generated by scripts/generate-terms.mjs</footer></body></html>\n`
}
emit('terms/index.html', dictPage('en'))
emit('de/terms/index.html', dictPage('de'))

console.log(`\n${written} written, ${unchanged} unchanged.`)
if (CHECK && errors) { console.error(`${errors} file(s) out of date — run without --check.`); process.exit(1) }
