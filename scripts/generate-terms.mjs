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
import { shell, entry, WORLD_NAME } from './shell.mjs'

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

// ── pages: every page uses the shell from scripts/shell.mjs ─────────────
const WORLDS = {
  rlnp: { name: 'Real Life Network Protocol', short: 'RLNP', what: 'the social specification: what a circle, an encounter, a promise, a role mean', repo: 'https://github.com/real-life-org/real-life-network-protocol' },
  rls: { name: 'Real Life Stack', short: 'RLS', what: 'the app toolkit: application, data and the connector socket', repo: 'https://github.com/real-life-org/real-life-stack' },
}

const conceptEntry = (c) => entry({
  id: fragment(c['@id']), world: c.world, href: termHref(c),
  label: lang(c['skos:prefLabel'], 'en'), other: lang(c['skos:prefLabel'], 'de'),
  tag: c['rl:status'] === 'proposed' ? 'proposed' : '',
  def: lang(c['skos:definition'], 'en'),
  rels: [
    ...list(c['skos:altLabel']).length ? [{ text: 'also', target: list(c['skos:altLabel']).map((a) => a['@value']).join(', ') }] : [],
    ...(links[c['@id']] ?? []).map(([rel, b]) => ({ text: REL[rel], target: lang(concepts[b]['skos:prefLabel'], 'en') || b, href: termHref(concepts[b]), world: WORLD_NAME.en[concepts[b].world] })),
    ...list(c['dct:source']).map((u) => ({ text: 'source', target: u.split('/').slice(-1)[0], href: u })),
  ],
  note: (notes[c['@id']] ?? [])[0] ?? '',
})

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
  emit(`${world}/v1/index.html`, shell({ title: `${w.short} terms · ${world}/v1`, active: '/#identifiers',
    head: `<link rel="alternate" type="application/ld+json" href="terms.jsonld"><link rel="alternate" type="application/json" href="index.json"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', '@id': ns, name: `${w.short} terms`, description: `Term namespace of the ${w.name}. SKOS concept scheme: ${ns}/terms.jsonld`, url: `${ns}/` })}</script>`,
    body: `<h1><code>${ns}</code></h1>
<p>The term namespace of the <strong>${w.name}</strong>, ${w.what}. Permanent identifiers are <code>${ns}#&lt;Fragment&gt;</code>; the fragments resolve to the entries below.</p>
<p>Each term is defined by the ${w.short} specification itself (<a href="${w.repo}">repository</a>). Mappings to the other parts of Real Life come from the <a href="/meta/v1/">shared register</a>: a term is <em>same as</em>, <em>close to</em>, <em>related to</em>, <em>broader</em> or <em>narrower than</em> its counterpart, or a deliberate <em>false friend</em>; <em>target: same as</em> marks a convergence the specifications still owe. The <a href="/terms/">dictionary</a> shows all three parts side by side.</p>
<p>Machine-readable: <a href="terms.jsonld"><code>terms.jsonld</code></a> (SKOS concept scheme, JSON-LD) and <a href="index.json"><code>index.json</code></a> (registry with digests).</p>
<h2>Terms</h2>
<div class="entries">${own.map(conceptEntry).join('\n')}</div>` }))
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
emit('meta/v1/index.html', shell({ title: 'Shared term register · meta/v1', active: '/#identifiers',
  head: `<link rel="alternate" type="application/ld+json" href="context.jsonld"><link rel="alternate" type="application/json" href="index.json">`,
  body: `<h1><code>${BASE}meta/v1</code></h1>
<p>The shared part of the Real Life term register. The three parts of Real Life keep their own SKOS concept schemes: <a href="/rlnp/v1/">RLNP</a> (meaning), <a href="/rltp/v1/">RLTP</a> (construction) and <a href="/rls/v1/">RLS</a> (interface and code). This namespace holds what none of them owns alone: the JSON-LD context all three use, the mappings between them, and the few fields SKOS does not have.</p>
<p>Machine-readable: <a href="context.jsonld"><code>context.jsonld</code></a>, <a href="mappings.jsonld"><code>mappings.jsonld</code></a>, <a href="index.json"><code>index.json</code></a>.</p>
<h2>Fields</h2>
<div class="entries">${RL.map(([f, d]) => entry({ id: f, world: 'task', label: `rl:${f}`, def: d })).join('\n')}</div>
<h2>Rule</h2>
<p>Definitions never live here. Each part defines its terms in its own repository and stays normative for them; the register only connects them. Source and checks: <a href="https://github.com/real-life-org/meta">real-life-org/meta</a>.</p>` }))

// ── the gate: real-life.org itself ───────────────────────────────────────
// The root page shows the whole: the layer picture and the three parts, one sentence each,
// then the identifiers this domain anchors. English at /, German at /de/.
// Content comes from meta/overview/parts.json; the picture from meta/overview/layers.{en,de}.svg.
console.log('\n── gate page')
const parts = JSON.parse(readFileSync(join(META, 'overview/parts.json'), 'utf8'))
for (const l of ['en', 'de']) emit(`overview/layers.${l}.svg`, readFileSync(join(META, `overview/layers.${l}.svg`), 'utf8'))
const T = {
  en: { ids: 'Identifiers anchored here', idsText: 'The permanent identifiers of all three parts live under this domain. They follow the protocols, not the branding; a breaking change gets a new version, not a new word.', picture: 'The three parts: the Network Protocol beside the Stack, the Trust Protocol filling the layers below the connector.', rows: [['/terms', 'the dictionary: all terms of the three parts side by side'], ['/rlnp/v1', 'terms of the Real Life Network Protocol'], ['/rls/v1', 'terms of the Real Life Stack'], ['/rltp/v1', 'vocabulary, context and schemas of the Real Life Trust Protocol'], ['/trust-tasks', 'RLTP Trust Task types (ToIP DTGWG framework 0.4)'], ['/meta/v1', 'the shared register: context, mappings between the three parts, register fields']] },
  de: { ids: 'Kennungen, die hier verankert sind', idsText: 'Die dauerhaften Kennungen aller drei Teile liegen unter dieser Domain. Sie folgen den Protokollen, nicht dem Branding; ein Bruch bekommt eine neue Version, kein neues Wort.', picture: 'Die drei Teile: das Netzwerkprotokoll neben dem Stack, das Trust Protocol füllt die Schichten unter dem Connector.', rows: [['/terms', 'das Wörterbuch: alle Begriffe der drei Teile nebeneinander'], ['/rlnp/v1', 'Begriffe des Real Life Network Protocol'], ['/rls/v1', 'Begriffe des Real Life Stack'], ['/rltp/v1', 'Vokabular, Kontext und Schemas des Real Life Trust Protocol'], ['/trust-tasks', 'RLTP Trust-Task-Typen (ToIP DTGWG Framework 0.4)'], ['/meta/v1', 'das gemeinsame Register: Kontext, Verknüpfungen zwischen den drei Teilen, Registerfelder']] },
}
const gatePage = (l) => {
  const t = T[l]; const O = l === 'en' ? 'de' : 'en'
  return shell({ l, title: parts.gate.title[l], active: l === 'de' ? '/de/' : '/', alt: { lang: O, href: O === 'de' ? '/de/' : '/' },
    body: `<p class="sub" style="margin-bottom:18px">${esc(parts.gate.sentence[l])}</p>
<figure><a href="/overview/layers.${l}.svg"><img src="/overview/layers.${l}.svg" alt="${esc(t.picture)}"></a></figure>
<div class="parts">
${parts.parts.map((p) => `<section class="part" id="${p.id}"><h2><a href="${p.url}">${esc(p.name[l])}</a></h2><p>${esc(p.sentence[l])}</p><p class="for">${esc(p.for[l])}</p></section>`).join('\n')}
</div>
<h2 id="identifiers">${t.ids}</h2>
<p>${t.idsText}</p>
<table>${t.rows.map(([path, what]) => `<tr><th><a href="${path}/">${path}</a></th><td>${what}</td></tr>`).join('\n')}</table>` })
}
emit('index.html', gatePage('en'))
emit('de/index.html', gatePage('de'))

// ── the dictionary: all terms of the three parts, side by side ───────────
// One page for people, not per world: a concept with its counterparts next to it. Every
// entry links to where it can be changed (the owning repository; GitHub turns an edit into a
// pull request) and to a prefilled issue for those who would rather propose than edit.
// Layout from the Claude Design prototype "Wörterbuch" (list view), 2026-09-18.
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
  en: { title: 'Dictionary', sub: 'All terms of the three parts of Real Life. Each part defines its own terms; this page puts them next to each other and shows how they relate.', search: 'Search terms…', termsN: 'terms', proposedN: 'proposals', convergeN: 'convergence tasks', guardOk: 'Guard: no findings', proposal: 'proposal', oneThing: 'one thing in', worlds: 'parts', alone: 'only here', newTerm: 'New term', edit: 'edit', propose: 'propose', how: '<em>edit</em> opens the defining file of the part; GitHub turns the change into a pull request. <em>propose</em> opens a prefilled issue. <em>New term</em> opens an issue with the fields a term needs.', noResults: 'No term matches the search.', newTermIssue: ['New term: ', 'Part (Network / Stack / Trust Protocol):', 'Label DE / EN:', 'Definition DE:', 'Definition EN:', 'Mappings to existing terms (same, related, false friend, target: same):', 'Source in the spec:', 'Why:'] },
  de: { title: 'Wörterbuch', sub: 'Alle Begriffe der drei Teile von Real Life. Jeder Teil definiert seine Begriffe selbst; diese Seite stellt sie nebeneinander und zeigt, wie sie zusammenhängen.', search: 'Begriff suchen…', termsN: 'Begriffe', proposedN: 'Vorschläge', convergeN: 'Konvergenzaufgaben', guardOk: 'Guard: keine Hinweise', proposal: 'Vorschlag', oneThing: 'ein Ding in', worlds: 'Teilen', alone: 'nur hier', newTerm: 'Begriff anlegen', edit: 'ändern', propose: 'vorschlagen', how: '<em>ändern</em> öffnet die Definitionsdatei des Teils; GitHub macht aus der Änderung einen Pull Request. <em>vorschlagen</em> öffnet ein vorbefülltes Issue. <em>Begriff anlegen</em> öffnet ein Issue mit den Feldern, die ein Begriff braucht.', noResults: 'Kein Begriff passt zur Suche.', newTermIssue: ['Neuer Begriff: ', 'Teil (Netzwerk / Stack / Trust Protocol):', 'Bezeichnung DE / EN:', 'Definition DE:', 'Definition EN:', 'Zuordnungen zu bestehenden Begriffen (gleich, verwandt, falscher Freund, Ziel: gleich):', 'Quelle in der Spec:', 'Warum:'] },
}
const REL_COLOR = { 'rl:convergesWith': 'var(--warn)', 'rl:falseFriend': '#b91c1c' }
const dictPage = (l) => {
  const t = D[l]; const O = l === 'en' ? 'de' : 'en'
  const nProposed = Object.values(concepts).filter((c) => c['rl:status'] === 'proposed').length
  const nConv = Object.entries(links).reduce((n, [a, v]) => n + v.filter(([r, b]) => r === 'rl:convergesWith' && a < b).length, 0)
  const noteOf = (id) => (notes[id] ?? [])[0]
  const item = (id) => {
    const c = concepts[id]
    const others = (links[id] ?? []).filter(([rel]) => rel !== 'skos:exactMatch')
    return entry({ id: `${c.world}-${fragment(id)}`, world: c.world, href: termHref(c), l,
      label: lang(c['skos:prefLabel'], l), other: lang(c['skos:prefLabel'], O), tag: c['rl:status'] === 'proposed' ? t.proposal : '',
      def: lang(c['skos:definition'], l),
      rels: others.map(([rel, b]) => ({ text: REL_L[l][rel], target: lang(concepts[b]['skos:prefLabel'], l) || b, href: termHref(concepts[b]), world: WORLD_NAME[l][concepts[b].world], color: REL_COLOR[rel] })),
      note: !(links[id] ?? []).length ? (noteOf(id) ?? '') : '',
      actions: [{ text: t.edit, href: editUrl(c) }, { text: t.propose, href: proposeUrl(c, l) }] })
  }
  const rows = sortedClusters.map((ids) => {
    const es = [...ids].sort((x, y) => WORLD_ORDER.indexOf(concepts[x].world) - WORLD_ORDER.indexOf(concepts[y].world))
    const labels = [...new Set(es.map((id) => lang(concepts[id]['skos:prefLabel'], l)))]
    const hint = ids.length > 1 ? `${t.oneThing} ${ids.length} ${t.worlds}` : t.alone
    return `<section class="row" data-q="${esc(es.map((id) => [lang(concepts[id]['skos:prefLabel'], 'de'), lang(concepts[id]['skos:prefLabel'], 'en'), lang(concepts[id]['skos:definition'], 'de'), lang(concepts[id]['skos:definition'], 'en')].join(' ')).join(' ').toLowerCase())}"><div class="rowhead"><b>${esc(labels.join(' · '))}</b><span>${hint}</span></div><div class="entries">${es.map(item).join('\n')}</div></section>`
  }).join('\n')
  const newTermUrl = `https://github.com/real-life-org/meta/issues/new?title=${encodeURIComponent(t.newTermIssue[0])}&body=${encodeURIComponent(t.newTermIssue.slice(1).join('\n\n') + '\n')}`
  return shell({ l, title: t.title, active: l === 'de' ? '/de/terms/' : '/terms/', alt: { lang: O, href: O === 'de' ? '/de/terms/' : '/terms/' },
    tools: `<input id="q" type="search" placeholder="${t.search}" aria-label="${t.search}">`,
    right: `<a class="btn" href="${newTermUrl}">+ ${t.newTerm} <small>Issue ↗</small></a>`,
    body: `<p class="sub">${t.sub}</p>
<div class="stats"><span>${Object.keys(concepts).length} ${t.termsN}</span><span>${nProposed} ${t.proposedN}</span><span>${nConv} ${t.convergeN}</span><span>${t.guardOk}</span></div>
<div class="rows" id="rows">
${rows}
</div>
<p class="empty" id="empty">${t.noResults}</p>
<p class="sub" style="margin-top:22px;font-size:.88rem">${t.how}</p>`,
    script: `<script>(function(){var q=document.getElementById('q'),rows=[].slice.call(document.querySelectorAll('.row')),empty=document.getElementById('empty');q.addEventListener('input',function(){var v=q.value.trim().toLowerCase(),n=0;rows.forEach(function(r){var hit=!v||r.getAttribute('data-q').indexOf(v)>-1;r.style.display=hit?'':'none';if(hit)n++});empty.style.display=n?'none':'block'})})()</script>` })
}
emit('terms/index.html', dictPage('en'))
emit('de/terms/index.html', dictPage('de'))

console.log(`\n${written} written, ${unchanged} unchanged.`)
if (CHECK && errors) { console.error(`${errors} file(s) out of date — run without --check.`); process.exit(1) }
