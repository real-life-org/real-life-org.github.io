#!/usr/bin/env node
// Generate every HTML page of real-life.org, the register's data files and the catalog, from
// real-life-org/meta and rltp-spec. Each list page is a filter over one catalog (scripts/catalog.mjs);
// every entry on every page is the same kind of object rendered by the same component
// (scripts/shell.mjs). Nothing here is written by hand.
//
//   usage: node scripts/generate-pages.mjs [path-to-meta] [path-to-rltp-spec]   (defaults ../meta ../rltp-spec)
//          node scripts/generate-pages.mjs ... --check                          (fail if anything would change)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { shell, entry as entryHtml, esc, WORLD_NAME, NORES } from './shell.mjs'
import { buildCatalog, BASE, PREFIX } from './catalog.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const pos = args.filter((a) => !a.startsWith('--'))
const META = join(ROOT, pos[0] ?? '../meta')
const SPEC = join(ROOT, pos[1] ?? '../rltp-spec')

let errors = 0, written = 0, unchanged = 0
const err = (m) => { console.error(`  ERROR ${m}`); errors++ }
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const j = (o) => JSON.stringify(o, null, 2) + '\n'
// Inline JSON-LD sits in a <script>; a '<' in a value must not be able to close it.
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`
if (!existsSync(join(META, 'terms/sources.json'))) { console.error(`No meta repository at ${META}`); process.exit(1) }
if (!existsSync(join(SPEC, 'schemas'))) { console.error(`No rltp-spec repository at ${SPEC}`); process.exit(1) }

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

const C = buildCatalog({ META, SPEC, ROOT, err })
if (errors) { console.error(`\n${errors} error(s) — refusing to generate.`); process.exit(1) }
const { entries, links, rows, sources, contextText, mappingsText, schemeText, registry, core } = C
const all = Object.values(entries)
const de = (l) => (l === 'de' ? 'de/' : '')
const other = (l) => (l === 'en' ? 'de' : 'en')
// A missing language falls back to the other one; a term without a German word shows English.
const T = (o, l) => o[l] || o[other(l)] || ''

// ── words ─────────────────────────────────────────────────────────────────
const REL_L = {
  en: { 'skos:exactMatch': 'same as', 'skos:closeMatch': 'close to', 'skos:relatedMatch': 'related to', 'skos:narrowMatch': 'broader than', 'skos:broadMatch': 'narrower than', 'rl:convergesWith': 'target: same as', 'rl:falseFriend': 'false friend of' },
  de: { 'skos:exactMatch': 'gleich', 'skos:closeMatch': 'nahezu gleich', 'skos:relatedMatch': 'verwandt mit', 'skos:narrowMatch': 'allgemeiner als', 'skos:broadMatch': 'spezieller als', 'rl:convergesWith': 'Ziel: gleich mit', 'rl:falseFriend': 'falscher Freund von' },
}
const REL_COLOR = { 'rl:convergesWith': 'var(--rls)', 'rl:falseFriend': 'var(--bad)' }
const W = {
  en: { proposed: 'proposal', superseded: 'superseded', also: 'also', source: 'source', edit: 'edit', propose: 'propose', oneThing: 'one thing in', parts: 'parts', alone: 'only here', newTerm: 'New term' },
  de: { proposed: 'Vorschlag', superseded: 'abgelöst', also: 'auch', source: 'Quelle', edit: 'ändern', propose: 'vorschlagen', oneThing: 'ein Ding in', parts: 'Teilen', alone: 'nur hier', newTerm: 'Begriff anlegen' },
}

// ── where a term can be changed ───────────────────────────────────────────
const editUrl = (e) => {
  const s = sources[e.world]; if (!s) return null
  return s.ref == null ? `https://github.com/real-life-org/meta/edit/main/${s.seed}` : `https://github.com/${s.repo}/edit/${s.branch ?? 'main'}/${s.path}`
}
const proposeUrl = (e, l) => {
  const s = sources[e.world]; const repo = !s || s.ref == null ? 'real-life-org/meta' : s.repo
  const title = (l === 'de' ? 'Begriff ändern: ' : 'Change term: ') + T(e.label, l)
  const body = l === 'de' ? `Begriff: ${e.iri}\n\nHeutige Definition:\n${T(e.def, 'de')}\n\nVorschlag:\n\nWarum:\n` : `Term: ${e.iri}\n\nCurrent definition:\n${T(e.def, 'en')}\n\nProposal:\n\nWhy:\n`
  return `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
}
const NEW_TERM = {
  en: ['New term: ', 'Part (Network / Stack / Trust Protocol):', 'Label DE / EN:', 'Definition DE:', 'Definition EN:', 'Mappings to existing terms (same, related, false friend, target: same):', 'Source in the spec:', 'Why:'],
  de: ['Neuer Begriff: ', 'Teil (Netzwerk / Stack / Trust Protocol):', 'Bezeichnung DE / EN:', 'Definition DE:', 'Definition EN:', 'Zuordnungen zu bestehenden Begriffen (gleich, verwandt, falscher Freund, Ziel: gleich):', 'Quelle in der Spec:', 'Warum:'],
}
const newTermUrl = (l) => `https://github.com/real-life-org/meta/issues/new?title=${encodeURIComponent(NEW_TERM[l][0])}&body=${encodeURIComponent(NEW_TERM[l].slice(1).join('\n\n') + '\n')}`

// ── one entry, rendered ───────────────────────────────────────────────────
// hideSame: on a row page the exact matches are the row itself; elsewhere they are shown.
const render = (e, l, { hideSame = false, id = null, plain = false } = {}) => {
  const w = W[l]
  const rels = (links[e.key] ?? []).filter(({ rel }) => !(hideSame && rel === 'skos:exactMatch'))
    .map(({ rel, key }) => ({ text: REL_L[l][rel], target: T(entries[key].label, l), href: entries[key].href, world: WORLD_NAME[l][entries[key].world], color: REL_COLOR[rel] }))
  const facts = e.facts.map((f) => ({ text: T(f.text, l), target: f.target, href: f.href }))
  const alt = e.alt.length ? [{ text: w.also, target: e.alt.join(', ') }] : []
  const src = e.sources.map((s) => ({ text: w.source, target: s.text, href: s.url }))
  const actions = e.kind === 'term' ? [{ text: w.edit, href: editUrl(e) }, { text: w.propose, href: proposeUrl(e, l) }].filter((a) => a.href) : []
  const labelOther = T(e.label, other(l)) !== T(e.label, l) ? T(e.label, other(l)) : ''
  return entryHtml({ id: id ?? e.fragment, world: e.world, href: e.href, l, plain, label: T(e.label, l), other: labelOther,
    tag: e.status === 'proposed' ? w.proposed : e.status === 'superseded' ? w.superseded : '',
    def: T(e.def, l), rels: [...alt, ...facts, ...rels, ...src], note: !(links[e.key] ?? []).length ? e.note : '', actions })
}
const entriesHtml = (list, l, opts) => list.map((e) => render(e, l, opts)).join('\n')

// ── register data files (unchanged contracts) ─────────────────────────────
console.log('\n── register data')
for (const world of Object.keys(sources)) {
  if (!schemeText[world]) continue
  const ns = `${BASE}${world}/v1`
  const own = all.filter((e) => e.kind === 'term' && e.world === world)
  emit(`${world}/v1/terms.jsonld`, schemeText[world])
  if (world === 'rltp') continue // /rltp/v1/index.json and context stay with generate.mjs
  emit(`${world}/v1/index.json`, j({
    name: `${world.toUpperCase()} term namespace`, namespace: ns, publisher: BASE, specificationRepository: `https://github.com/${sources[world].repo}`,
    generatedFrom: 'real-life-org/meta — do not edit by hand, run scripts/generate-pages.mjs',
    context: { url: `${BASE}meta/v1/context.jsonld`, sha256: sha256(contextText) },
    scheme: { url: `${ns}/terms.jsonld`, sha256: sha256(schemeText[world]) },
    mappings: { url: `${BASE}meta/v1/mappings.jsonld`, sha256: sha256(mappingsText) },
    terms: own.map((e) => ({ iri: e.iri, en: e.label.en, de: e.label.de, status: e.status })),
  }))
}
emit('meta/v1/context.jsonld', contextText)
emit('meta/v1/mappings.jsonld', mappingsText)
emit('meta/v1/index.json', j({
  name: 'Real Life shared term register', namespace: `${BASE}meta/v1`, publisher: BASE, registerRepository: 'https://github.com/real-life-org/meta',
  generatedFrom: 'real-life-org/meta — do not edit by hand, run scripts/generate-pages.mjs',
  context: { url: `${BASE}meta/v1/context.jsonld`, sha256: sha256(contextText) },
  mappings: { url: `${BASE}meta/v1/mappings.jsonld`, sha256: sha256(mappingsText) },
  fields: all.filter((e) => e.kind === 'field').map((e) => ({ iri: e.iri, definition: e.def.en })),
  schemes: Object.fromEntries(Object.entries(PREFIX).map(([w, p]) => [w, p.slice(0, -1)])),
}))
// the catalog itself: every entry of every list, one shape, both languages
emit('terms/index.json', j({
  name: 'Real Life catalog', generatedFrom: 'real-life-org/meta and rltp-spec — do not edit by hand, run scripts/generate-pages.mjs',
  entries: all.map((e) => ({ key: e.key, kind: e.kind, world: e.world, iri: e.iri, page: `${BASE}${e.href.slice(1)}`, label: e.label, alt: e.alt, definition: e.def, status: e.status, sources: e.sources.map((s) => s.url), symbols: e.symbols, facts: e.facts, note: e.note, mappings: (links[e.key] ?? []).map(({ rel, key }) => ({ rel, key })), row: e.row })),
}))

// ── the layer picture ─────────────────────────────────────────────────────
// The picture is drawn as HTML on the page: cards for the five things the network protocol
// names, cards for the five layers of the stack, the seams between them as curves (drawn by a
// small script from the cards' positions; below 680px the seams are lines of text). The texts
// are those of meta/overview/layers.{en,de}.svg, which stays the standalone picture.
console.log('\n── pages')
const parts = JSON.parse(readFileSync(join(META, 'overview/parts.json'), 'utf8'))
for (const l of ['en', 'de']) emit(`overview/layers.${l}.svg`, readFileSync(join(META, `overview/layers.${l}.svg`), 'utf8'))
const DIAG = {
  en: { meaning: 'Meaning', construction: 'Construction', seam: 'Seam', socket: 'Connector = socket', fills: 'RLTP fills 1 to 3', guarantees: 'with its own guarantees per layer', server: 'server', others: 'others possible', oneBackend: 'one backend', forAll: 'for all three', rail: 'RLS · 4, 5',
    alt: 'The three parts: the Network Protocol beside the Stack, the Trust Protocol filling the layers below the connector.',
    layers: { L5: ['5 · Application', 'modules · views · forms'], L4: ['4 · Data', 'items · relations · schema · portability'], L3: ['3 · Access', 'groups · policy · keys'], L2: ['2 · Encounter and Relationship', 'ceremony · trust · credentials'], L1: ['1 · Identity', 'identifiers · devices'] },
    things: [['Place · Initiative · Resource · Project', 'one thing can be all of them'], ['Witnessing · Promise · Role', 'a statement with an author, not approval'], ['Circle', 'chooses its own form and access'], ['Visibility', 'within the circle · mirrored · published'], ['Person · Relationship', 'arises from encounter']],
    seams: [['m0', 'L4', 'templates + facets'], ['m1', 'L4', 'item with author'], ['m2', 'L4', 'space + domain model'], ['m2', 'L3', 'group, log, policy'], ['m3', 'L3', 'home space, keys'], ['m4', 'L2', 'contact card, ceremony'], ['m4', 'L1', 'key as identifier, devices']] },
  de: { meaning: 'Bedeutung', construction: 'Konstruktion', seam: 'Naht', socket: 'Connector = Steckstelle', fills: 'RLTP füllt 1 bis 3', guarantees: 'mit eigenen Zusagen je Schicht', server: 'Server', others: 'weitere möglich', oneBackend: 'ein Backend', forAll: 'für alle drei', rail: 'RLS · 4, 5',
    alt: 'Die drei Teile: das Netzwerkprotokoll neben dem Stack, das Trust Protocol füllt die Schichten unter dem Connector.',
    layers: { L5: ['5 · Anwendung', 'Module · Ansichten · Formulare'], L4: ['4 · Daten', 'Items · Relationen · Schema · Portabilität'], L3: ['3 · Zugang', 'Gruppen · Regeln · Schlüssel'], L2: ['2 · Begegnung und Beziehung', 'Zeremonie · Vertrauen · Nachweise'], L1: ['1 · Identität', 'Kennungen · Geräte'] },
    things: [['Ort · Initiative · Ressource · Projekt', 'eines kann alles zugleich sein'], ['Bezeugen · Versprechen · Rolle', 'Aussage mit Urheber, keine Abnahme'], ['Kreis', 'wählt Form und Zugang selbst'], ['Sichtbarkeit', 'im Kreis · gespiegelt · veröffentlicht'], ['Mensch · Beziehung', 'entsteht durch Begegnung']],
    seams: [['m0', 'L4', 'Vorlagen + Facetten'], ['m1', 'L4', 'Item mit Urheber'], ['m2', 'L4', 'Space + Domänenmodell'], ['m2', 'L3', 'Gruppe, Log, Regeln'], ['m3', 'L3', 'Home-Space, Schlüssel'], ['m4', 'L2', 'Kontaktkarte, Zeremonie'], ['m4', 'L1', 'Schlüssel als Kennung, Geräte']] },
}
const LAYER_WORLD = { L5: 'rls', L4: 'rls', L3: 'rltp', L2: 'rltp', L1: 'rltp' }
const diagram = (l) => {
  const d = DIAG[l]
  const card = (id, cls) => `<div class="layer layer--${cls}" data-node="${id}"><b>${esc(d.layers[id][0])}</b><small>${esc(d.layers[id][1])}</small></div>`
  const things = d.things.map(([title, note], i) => {
    const seams = d.seams.filter(([from]) => from === `m${i}`).map(([, to, label]) => `<div class="seam"><span>${esc(label)}</span><span>→</span><span class="w w-${LAYER_WORLD[to]}">${esc(d.layers[to][0])}</span></div>`).join('')
    return `<div class="layer layer--rlnp" data-node="m${i}"><span><b>${esc(title)}</b><br><small>${esc(note)}</small></span><div class="seams">${seams}</div></div>`
  }).join('\n')
  return `<figure class="diagram" data-diagram aria-label="${esc(d.alt)}">
<div class="diagram__grid">
<div class="col"><div class="col__head"><span class="dot dot-rlnp"></span>RLNP · ${d.meaning}</div>
${things}
</div>
<div class="col__mid">${d.seam}</div>
<div class="col"><div class="col__head"><span class="dot dot-rls"></span>Stack · ${d.construction}</div>
<div class="upper"><div class="col">${card('L5', 'rls')}${card('L4', 'rls layer--strong')}</div><div class="rail"><span></span><b>${d.rail}</b><span></span></div></div>
<div class="connector"><span>${d.socket}</span></div>
<div class="lower">
<div class="col">${card('L3', 'rltp')}${card('L2', 'rltp')}${card('L1', 'rltp')}<div class="legend legend--rltp"><b>${d.fills}</b><small>${d.guarantees}</small></div></div>
<div class="col"><div class="layer layer--dashed"><span><b>Supabase</b><br><small>${d.server}</small></span><i>${d.others}</i></div><div class="legend legend--neutral"><b>${d.oneBackend}</b><small>${d.forAll}</small></div></div>
</div></div></div>
<svg class="diagram__seams" data-seams aria-hidden="true"></svg>
</figure>`
}
// Measures the cards and draws the seams as labelled curves into the overlay.
const SEAMS_SCRIPT = (l) => `<script>(function(){var fig=document.querySelector('[data-diagram]');if(!fig)return;var svg=fig.querySelector('svg[data-seams]');var defs=${JSON.stringify(DIAG[l].seams)};var NS='http://www.w3.org/2000/svg';function draw(){var box=fig.getBoundingClientRect(),W=box.width,H=box.height,narrow=W<680;fig.classList.toggle('is-narrow',narrow);svg.innerHTML='';if(narrow)return;svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('width',W);svg.setAttribute('height',H);svg.innerHTML='<defs><marker id="rl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--rlnp)"/></marker></defs>';var count={},seen={};defs.forEach(function(d){count[d[0]]=(count[d[0]]||0)+1;count[d[1]]=(count[d[1]]||0)+1});function frac(n){seen[n]=(seen[n]||0)+1;return seen[n]/(count[n]+1)}function rect(n){var e=fig.querySelector('[data-node="'+n+'"]');if(!e)return null;var r=e.getBoundingClientRect();return{l:r.left-box.left,r:r.right-box.left,t:r.top-box.top,h:r.height}}defs.forEach(function(d,i){var a=rect(d[0]),b=rect(d[1]);if(!a||!b)return;var x1=a.r+1,y1=a.t+a.h*frac(d[0]),x2=b.l-1,y2=b.t+b.h*frac(d[1]),dx=(x2-x1)*.55;var p=document.createElementNS(NS,'path');p.id='seam'+i;p.setAttribute('d','M'+x1+' '+y1+' C '+(x1+dx)+' '+y1+', '+(x2-dx)+' '+y2+', '+x2+' '+y2);p.setAttribute('fill','none');p.setAttribute('stroke','var(--rlnp)');p.setAttribute('stroke-width','1.5');p.setAttribute('stroke-opacity','.85');p.setAttribute('marker-end','url(#rl-arrow)');var t=document.createElementNS(NS,'text');t.setAttribute('dy','-4');t.setAttribute('text-anchor','middle');t.setAttribute('font-size','10.5');t.setAttribute('font-weight','500');t.setAttribute('fill','var(--rlnp)');var tp=document.createElementNS(NS,'textPath');tp.setAttribute('href','#seam'+i);tp.setAttribute('startOffset','46%');tp.textContent=d[2];t.appendChild(tp);svg.appendChild(p);svg.appendChild(t)})}new ResizeObserver(draw).observe(fig);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(draw);draw()})()</script>`

// ── the gate ──────────────────────────────────────────────────────────────
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>'
const G = {
  en: { ids: 'Identifiers anchored here', idsText: 'The permanent identifiers of all three parts live under this domain. They follow the protocols, not the branding; a breaking change gets a new version, not a new word.', all: 'all',
    rows: [['/terms', 'the dictionary: everything listed here, side by side', 'meta', 'all'], ['/rlnp/v1', 'terms of the Real Life Network Protocol', 'rlnp'], ['/rls/v1', 'terms of the Real Life Stack', 'rls'], ['/rltp/v1', 'vocabulary, context and schemas of the Real Life Trust Protocol', 'rltp'], ['/trust-tasks', 'RLTP Trust Task types (ToIP DTGWG framework 0.4)', 'task'], ['/meta/v1', 'the shared register: context, mappings between the three parts, register fields', 'meta']] },
  de: { ids: 'Kennungen, die hier verankert sind', idsText: 'Die dauerhaften Kennungen aller drei Teile liegen unter dieser Domain. Sie folgen den Protokollen, nicht dem Branding; ein Bruch bekommt eine neue Version, kein neues Wort.', all: 'alle',
    rows: [['/terms', 'das Wörterbuch: alles, was hier gelistet ist, nebeneinander', 'meta', 'alle'], ['/rlnp/v1', 'Begriffe des Real Life Network Protocol', 'rlnp'], ['/rls/v1', 'Begriffe des Real Life Stack', 'rls'], ['/rltp/v1', 'Vokabular, Kontext und Schemas des Real Life Trust Protocol', 'rltp'], ['/trust-tasks', 'RLTP Trust-Task-Typen (ToIP DTGWG Framework 0.4)', 'task'], ['/meta/v1', 'das gemeinsame Register: Kontext, Verknüpfungen zwischen den drei Teilen, Registerfelder', 'meta']] },
}
for (const l of ['en', 'de']) {
  const t = G[l]
  emit(`${de(l)}index.html`, shell({ l, title: parts.gate.title[l], active: `/${de(l)}`, alt: { lang: other(l), href: `/${de(other(l))}` }, script: SEAMS_SCRIPT(l),
    body: `<div class="page-head"><h1 class="hero">${esc(parts.gate.title[l])}</h1><p class="lead">${esc(parts.gate.sentence[l])}</p></div>
${diagram(l)}
<div class="parts">
${parts.parts.map((p) => `<a class="part" id="${p.id}" href="${p.url}"><span class="w w-${p.spec.world}">${esc(p.spec.abbr)}</span><span class="part__text"><span class="part__title">${esc(p.name[l])}</span><span class="part__claim">${esc(p.sentence[l])}</span></span><span class="part__meta">${esc(p.spec.name[l])} · ${esc(p.for[l])}</span><span class="part__link">${esc(p.url.replace(/^https?:\/\//, ''))} ${ARROW}</span></a>`).join('\n')}
</div>
<div class="section-head" id="identifiers"><h2 class="section">${t.ids}</h2><p>${t.idsText}</p></div>
<div class="list">${t.rows.map(([path, what, world, label]) => `<a class="row" href="/${de(l)}${path.slice(1)}/"><span class="path">${path}</span><span class="desc">${what}</span><span class="w w-${world}">${label ?? WORLD_NAME[l][world]}</span></a>`).join('\n')}</div>` }))
}

// ── list pages: each one a filter over the catalog ────────────────────────
const CR = { en: 'Identifiers', de: 'Kennungen' }
const crumbs = (l, ...items) => `<div class="crumbs"><a href="/${de(l)}#identifiers">${CR[l]}</a>${items.map((x, i) => `<span>/</span>${i === items.length - 1 ? `<b>${esc(x[0])}</b>` : `<a href="${x[1]}">${esc(x[0])}</a>`}`).join('')}</div>`
const machineLinks = (l, items) => `<div class="links"><span>${l === 'de' ? 'Maschinenlesbar' : 'Machine-readable'}</span>${items.map(([text, href]) => `<a class="btn btn--mono" href="${href}">${esc(text)}</a>`).join('')}</div>`
const empty = (l) => `<p class="empty" id="empty">${NORES[l]}</p>`
const listPage = ({ l, path, title, active, head = '', intro, filter, plain = false, tail = '' }) => {
  const own = all.filter(filter)
  emit(`${de(l)}${path}index.html`, shell({ l, title, active, head, search: true, alt: { lang: other(l), href: `/${de(other(l))}${path}` },
    body: `${intro}<div class="list">${entriesHtml(own, l, { plain })}${empty(l)}</div>${tail}` }))
}
const NSW = {
  rlnp: { name: 'Real Life Network Protocol', short: 'RLNP', what: { en: 'the social specification: what a circle, an encounter, a promise, a role mean', de: 'die soziale Spezifikation: was ein Kreis, eine Begegnung, ein Versprechen, eine Rolle bedeuten' } },
  rls: { name: 'Real Life Stack', short: 'RLS', what: { en: 'the app toolkit: application, data and the connector socket', de: 'der App-Baukasten: Anwendung, Daten und die Steckstelle des Connectors' } },
  rltp: { name: 'Real Life Trust Protocol', short: 'RLTP', what: { en: 'the technical specification: identity, encounter and relationship, access', de: 'die technische Spezifikation: Identität, Begegnung und Beziehung, Zugang' } },
}
const NS = {
  en: { intro: (w, ns) => `The term namespace of the <strong>${w.name}</strong>, ${w.what.en}. Permanent identifiers are <code>${ns}#&lt;Fragment&gt;</code>; the fragments resolve to the entries below. Each term is defined by the ${w.short} specification itself; mappings to the other parts come from the <a href="/meta/v1/">shared register</a>, and the <a href="/terms/">dictionary</a> shows everything side by side.`, terms: 'Terms', schemas: 'Normative schemas', schemasText: 'Task payload schemas live at their Type URIs under <a href="/trust-tasks/">/trust-tasks/</a>.' },
  de: { intro: (w, ns) => `Der Begriffs-Namensraum des <strong>${w.name}</strong>, ${w.what.de}. Dauerhafte Kennungen sind <code>${ns}#&lt;Fragment&gt;</code>; die Fragmente lösen zu den Einträgen unten auf. Jeden Begriff definiert die ${w.short}-Spezifikation selbst; die Verknüpfungen zu den anderen Teilen kommen aus dem <a href="/de/meta/v1/">gemeinsamen Register</a>, und das <a href="/de/terms/">Wörterbuch</a> zeigt alles nebeneinander. Begriffe ohne deutsches Wort erscheinen englisch.`, terms: 'Begriffe', schemas: 'Normative Schemas', schemasText: 'Payload-Schemas der Task-Typen liegen an ihren Type URIs unter <a href="/de/trust-tasks/">/trust-tasks/</a>.' },
}
const RLTP_EXTRA = {
  en: `<p class="intro intro--muted">The JSON-LD context document is <a href="/rltp/v1/context.jsonld">context.jsonld</a>. Per the interim securing profile, credentials pin their <code>@context</code> by value and implementations never process JSON-LD at runtime; this document defines meaning, not machinery.</p>`,
  de: `<p class="intro intro--muted">Das JSON-LD-Kontextdokument ist <a href="/rltp/v1/context.jsonld">context.jsonld</a>. Nach dem vorläufigen Sicherungsprofil binden Credentials ihren <code>@context</code> per Wert, und Implementierungen verarbeiten JSON-LD nie zur Laufzeit; dieses Dokument definiert Bedeutung, nicht Maschinerie.</p>`,
}
for (const l of ['en', 'de']) {
  for (const world of ['rlnp', 'rls', 'rltp']) {
    const w = NSW[world]; const ns = `${BASE}${world}/v1`; const n = NS[l]
    const own = all.filter((e) => e.kind === 'term' && e.world === world)
    const machine = world === 'rltp' ? [['context.jsonld', '/rltp/v1/context.jsonld'], ['terms.jsonld', '/rltp/v1/terms.jsonld'], ['index.json', '/rltp/v1/index.json']] : [['terms.jsonld', `/${world}/v1/terms.jsonld`], ['index.json', `/${world}/v1/index.json`]]
    listPage({ l, path: `${world}/v1/`, title: `${w.short} ${n.terms} · ${world}/v1`, active: `/${de(l)}#identifiers`, plain: true,
      head: `<link rel="alternate" type="application/ld+json" href="/${world}/v1/${world === 'rltp' ? 'context.jsonld' : 'terms.jsonld'}"><link rel="alternate" type="application/json" href="/${world}/v1/index.json">${ld({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', '@id': ns, name: `${w.short} terms`, description: `Term namespace of the ${w.name}.`, url: `${ns}/` })}`,
      intro: `${crumbs(l, [`${world}/v1`])}<div class="page-head"><span class="w w-${world}">${WORLD_NAME[l][world]}</span><h1 class="uri">${ns}</h1><p class="intro">${n.intro(w, ns)}</p>${world === 'rltp' ? RLTP_EXTRA[l] : ''}${machineLinks(l, machine)}</div><h2>${n.terms}<span class="count">${own.length}</span></h2>`,
      filter: (e) => e.kind === 'term' && e.world === world,
      tail: world === 'rltp' ? `<div class="after"><h2>${n.schemas}</h2><p>${n.schemasText}</p><div class="chips">${core.map((s) => `<a class="btn btn--mono" href="/rltp/v1/schemas/${s.file}">${s.file.replace('.schema.json', '')}</a>`).join('')}</div></div>` : '' })
  }
  // /meta/v1: the register's fields
  const M = {
    en: { title: 'Shared term register · meta/v1', p1: 'The shared part of the Real Life term register. The three parts keep their own SKOS concept schemes: <a href="/rlnp/v1/">RLNP</a> (meaning), <a href="/rltp/v1/">RLTP</a> (construction) and <a href="/rls/v1/">RLS</a> (interface and code). This namespace holds what none of them owns alone: the JSON-LD context all three use, the mappings between them, and the few fields SKOS does not have.', fields: 'Fields', rule: 'Rule', p3: 'Definitions never live here. Each part defines its terms in its own repository and stays normative for them; the register only connects them. Source and checks: <a href="https://github.com/real-life-org/meta">real-life-org/meta</a>.' },
    de: { title: 'Gemeinsames Begriffsregister · meta/v1', p1: 'Der gemeinsame Teil des Real-Life-Begriffsregisters. Die drei Teile halten ihre eigenen SKOS-Konzeptschemata: <a href="/de/rlnp/v1/">RLNP</a> (Bedeutung), <a href="/de/rltp/v1/">RLTP</a> (Konstruktion) und <a href="/de/rls/v1/">RLS</a> (Oberfläche und Code). Dieser Namensraum hält, was keiner allein besitzt: den JSON-LD-Kontext aller drei, die Verknüpfungen zwischen ihnen und die wenigen Felder, die SKOS nicht hat.', fields: 'Felder', rule: 'Regel', p3: 'Definitionen leben nie hier. Jeder Teil definiert seine Begriffe im eigenen Repository und bleibt dafür normativ; das Register verbindet sie nur. Quelle und Prüfungen: <a href="https://github.com/real-life-org/meta">real-life-org/meta</a>.' },
  }[l]
  const nFields = all.filter((e) => e.kind === 'field').length
  listPage({ l, path: 'meta/v1/', title: M.title, active: `/${de(l)}#identifiers`, plain: true,
    head: `<link rel="alternate" type="application/ld+json" href="/meta/v1/context.jsonld"><link rel="alternate" type="application/json" href="/meta/v1/index.json">`,
    intro: `${crumbs(l, ['meta/v1'])}<div class="page-head"><span class="w w-meta">${WORLD_NAME[l].meta}</span><h1 class="uri">${BASE}meta/v1</h1><p class="intro">${M.p1}</p>${machineLinks(l, [['context.jsonld', '/meta/v1/context.jsonld'], ['mappings.jsonld', '/meta/v1/mappings.jsonld'], ['index.json', '/meta/v1/index.json'], ['terms/index.json', '/terms/index.json']])}</div><h2>${M.fields}<span class="count">${nFields}</span></h2>`,
    filter: (e) => e.kind === 'field', tail: `<div class="after"><h2>${M.rule}</h2><p>${M.p3}</p></div>` })
  // /trust-tasks/: the types, one card each
  const TT = {
    en: { h: 'RLTP Trust Task types', p1: `Private Trust Task types registered under <code>${BASE}trust-tasks/</code> by the Real Life Trust Protocol (${esc(registry.framework)}). Every type is a URI at which its payload schema lives. Conforming implementations pre-register every schema by its <code>$id</code> and resolve nothing over the network at runtime.`, retired: 'retired version, superseded by' },
    de: { h: 'RLTP Trust-Task-Typen', p1: `Private Trust-Task-Typen, die das Real Life Trust Protocol unter <code>${BASE}trust-tasks/</code> registriert (${esc(registry.framework)}). Jeder Typ ist eine URI, an der sein Payload-Schema liegt. Konforme Implementierungen registrieren jedes Schema vorab über seine <code>$id</code> und lösen zur Laufzeit nichts über das Netz auf. Die Beschreibungen sind englisch, wie die Spezifikation.`, retired: 'zurückgezogene Version, abgelöst durch' },
  }[l]
  const tasks = all.filter((e) => e.kind === 'task').sort((a, b) => a.fragment.localeCompare(b.fragment))
  const taskCard = (e) => {
    const [name, version] = e.fragment.split('/')
    const q = esc([e.fragment, e.profile ?? '', e.def.en].join(' ').toLowerCase())
    return e.status === 'superseded'
      ? `<a class="task task--retired" href="${e.href}" data-q="${q}"><span class="head"><span class="task__name">${esc(name)}<span>/${esc(version)}</span></span><span class="task__profile">${TT.retired} ${esc(e.supersededBy)}</span></span><span class="task__where"></span></a>`
      : `<a class="task" href="${e.href}" data-q="${q}"><span class="head"><span class="task__name">${esc(name)}<span>/${esc(version)}</span></span><span class="task__profile">${esc(e.profile)}</span></span><span class="task__where">${esc(e.definedIn.specification)} · ${esc(e.definedIn.section)}</span><span class="task__summary">${esc(e.def.en)}</span></a>`
  }
  emit(`${de(l)}trust-tasks/index.html`, shell({ l, title: TT.h, active: `/${de(l)}#identifiers`, search: true, alt: { lang: other(l), href: `/${de(other(l))}trust-tasks/` },
    head: `<link rel="alternate" type="application/json" href="/trust-tasks/index.json">${ld({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', '@id': `${BASE}trust-tasks/`, name: 'RLTP Trust Task types', url: `${BASE}trust-tasks/` })}`,
    body: `${crumbs(l, ['trust-tasks'])}<div class="page-head"><span class="w w-rltp">${WORLD_NAME[l].rltp}</span><h1>${TT.h}</h1><p class="intro intro--muted">${TT.p1}</p>${machineLinks(l, [['index.json', '/trust-tasks/index.json']])}</div>
<div class="tasks">${tasks.map(taskCard).join('\n')}${empty(l)}</div>` }))
  // /terms/: everything; a concept block holds the entries that mean the same thing
  const D = {
    en: { title: 'Dictionary', sub: 'Everything real-life.org lists, side by side: the terms of the three parts, the Trust Task types and the register\'s fields. Entries that mean the same thing stand together; related, broader or narrower terms, false friends and convergence targets are linked from the entries. Each part defines its own terms; this page only puts them next to each other.', termsN: 'entries', proposedN: 'proposals', convergeN: 'convergence tasks', all: 'All', oneThing: 'one thing in', parts: 'parts', how: '<em>edit</em> opens the defining file of the part; GitHub turns the change into a pull request. <em>propose</em> opens a prefilled issue. <em>New term</em> opens an issue with the fields a term needs.' },
    de: { title: 'Wörterbuch', sub: 'Alles, was real-life.org listet, nebeneinander: die Begriffe der drei Teile, die Trust-Task-Typen und die Felder des Registers. Einträge, die dasselbe meinen, stehen zusammen; verwandte, allgemeinere oder speziellere Begriffe, falsche Freunde und Konvergenzziele sind aus den Einträgen verlinkt. Jeder Teil definiert seine Begriffe selbst; diese Seite stellt sie nur nebeneinander. Begriffe ohne deutsches Wort erscheinen englisch.', termsN: 'Einträge', proposedN: 'Vorschläge', convergeN: 'Konvergenzaufgaben', all: 'Alle', oneThing: 'ein Ding in', parts: 'Teilen', how: '<em>ändern</em> öffnet die Definitionsdatei des Teils; GitHub macht aus der Änderung einen Pull Request. <em>vorschlagen</em> öffnet ein vorbefülltes Issue. <em>Begriff anlegen</em> öffnet ein Issue mit den Feldern, die ein Begriff braucht.' },
  }[l]
  const nConv = Object.entries(links).reduce((n, [a, v]) => n + v.filter(({ rel, key }) => rel === 'rl:convergesWith' && a < key).length, 0)
  const concepts = rows.slice().sort((x, y) => (y.length - x.length) || T(entries[x[0]].label, l).localeCompare(T(entries[y[0]].label, l)))
    .map((keys) => { const es = keys.map((k) => entries[k]); const labels = [...new Set(es.map((e) => T(e.label, l)))]
      return `<section class="concept" data-w="${[...new Set(es.map((e) => e.world))].join(' ')}" data-q="${esc(es.map((e) => [e.label.de, e.label.en, e.def.de, e.def.en].join(' ')).join(' ').toLowerCase())}">${es.length > 1 ? `<div class="concept__head"><b>${esc(labels.join(' · '))}</b><span>${D.oneThing} ${es.length} ${D.parts}</span></div>` : ''}${entriesHtml(es, l, { hideSame: true })}</section>` }).join('\n')
  const filters = [['all', D.all], ['rlnp', WORLD_NAME[l].rlnp], ['rls', WORLD_NAME[l].rls], ['rltp', WORLD_NAME[l].rltp], ['task', WORLD_NAME[l].task], ['meta', WORLD_NAME[l].meta]]
  emit(`${de(l)}terms/index.html`, shell({ l, title: D.title, active: `/${de(l)}terms/`, search: true, alt: { lang: other(l), href: `/${de(other(l))}terms/` },
    body: `<div class="page-head"><h1>${D.title}</h1><p class="intro intro--muted">${D.sub}</p><p class="stats">${all.length} ${D.termsN} · ${all.filter((e) => e.status === 'proposed').length} ${D.proposedN} · ${nConv} ${D.convergeN}</p></div>
<div class="segmented" role="tablist">${filters.map(([k, label], i) => `<button type="button" role="tab" data-filter="${k}" aria-selected="${i === 0}">${label}</button>`).join('')}</div>
<div class="list">${concepts}${empty(l)}</div>
<p class="muted" style="font-size:13.5px;margin:0">${D.how} <a href="${newTermUrl(l)}">${W[l].newTerm} ↗</a></p>` }))
}

// ── detail pages: one per Trust Task type, from the same entry ────────────
const OFFLINE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M2 2l20 20"/></svg>'
const OFFLINE = `<div class="note">${OFFLINE_ICON}<span><b>Offline rule.</b> Conforming implementations pre-register every schema by its <code>$id</code> and never resolve over the network. This page is documentation, not infrastructure.</span></div>`
for (const e of all.filter((x) => x.kind === 'task')) {
  const head = `<link rel="alternate" type="application/schema+json" href="schema.json">` + (e.status === 'superseded' ? '' : `${ld({ '@context': 'https://schema.org', '@type': 'DefinedTerm', '@id': e.iri, name: e.fragment, description: `RLTP Trust Task type — ${e.def.en} Payload schema: ${e.iri}/schema.json`, inDefinedTermSet: `${BASE}trust-tasks/`, url: `${e.iri}/` })}`)
  const top = `${crumbs('en', ['trust-tasks', '/trust-tasks/'], [e.fragment])}<div class="page-head"><span class="w w-task">Trust Task</span><h1 class="uri">${e.iri}</h1>`
  const body = e.status === 'superseded'
    ? `${top}<p class="intro"><strong>${e.fragment}</strong> is a retired version of a private Trust Task type of the Real Life Trust Protocol. It is superseded by <a href="/trust-tasks/${e.supersededBy}/"><code>${e.supersededBy}</code></a>.</p>
<p class="intro intro--muted">The URI keeps resolving because published identifiers do not disappear. The payload schema published under it stays available as <a href="schema.json">schema.json</a>; new documents use the current version.</p></div>
${OFFLINE}`
    : `${top}<p class="intro"><strong>${e.fragment}</strong> is a private Trust Task type of the Real Life Trust Protocol (${esc(registry.framework)}).</p>
<p class="intro intro--muted">${esc(e.def.en)}</p></div>
<dl class="facts">
<div><dt>Normative definition</dt><dd><a href="${e.definedIn.url}">${esc(e.definedIn.specification)} ${esc(e.definedIn.section)}</a></dd></div>
<div><dt>Conformance profile</dt><dd class="mono">${esc(e.profile)}</dd></div>
<div><dt>Payload schema<small>$id = this URI</small></dt><dd><a class="mono" href="schema.json">schema.json</a><span class="sha">sha256 ${sha256(e.schemaText)}</span></dd></div>
<div><dt>Document profile</dt><dd><a class="mono" href="/rltp/v1/schemas/rltp-delivery-document.schema.json">rltp-delivery-document.schema.json</a></dd></div>
</dl>
${OFFLINE}`
  emit(`trust-tasks/${e.fragment}/index.html`, shell({ title: `${e.fragment} — RLTP Trust Task type`, head, active: '/#identifiers', body }))
}

console.log(`\n${written} written, ${unchanged} unchanged.`)
if (CHECK && errors) { console.error(`${errors} file(s) out of date — run without --check.`); process.exit(1) }
