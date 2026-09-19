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
import { shell, entry as entryHtml, esc, WORLD_NAME } from './shell.mjs'
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
const REL_COLOR = { 'rl:convergesWith': 'var(--warn)', 'rl:falseFriend': '#b91c1c' }
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
const render = (e, l, { hideSame = false, id = null } = {}) => {
  const w = W[l]
  const rels = (links[e.key] ?? []).filter(({ rel }) => !(hideSame && rel === 'skos:exactMatch'))
    .map(({ rel, key }) => ({ text: REL_L[l][rel], target: T(entries[key].label, l), href: entries[key].href, world: WORLD_NAME[l][entries[key].world], color: REL_COLOR[rel] }))
  const facts = e.facts.map((f) => ({ text: T(f.text, l), target: f.target, href: f.href }))
  const alt = e.alt.length ? [{ text: w.also, target: e.alt.join(', ') }] : []
  const src = e.sources.map((s) => ({ text: w.source, target: s.text, href: s.url }))
  const actions = e.kind === 'term' ? [{ text: w.edit, href: editUrl(e) }, { text: w.propose, href: proposeUrl(e, l) }].filter((a) => a.href) : []
  const labelOther = T(e.label, other(l)) !== T(e.label, l) ? T(e.label, other(l)) : ''
  return entryHtml({ id: id ?? e.fragment, world: e.world, href: e.href, l, label: T(e.label, l), other: labelOther,
    tag: e.status === 'proposed' ? w.proposed : e.status === 'superseded' ? w.superseded : '',
    def: T(e.def, l), rels: [...alt, ...facts, ...rels, ...src], note: !(links[e.key] ?? []).length ? e.note : '', actions })
}
const entriesHtml = (list, l, opts) => `<div class="entries">${list.map((e) => render(e, l, opts)).join('\n')}</div>`

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
  entries: all.map((e) => ({ key: e.key, kind: e.kind, world: e.world, iri: e.iri, page: `${BASE}${e.href.slice(1)}`, label: e.label, alt: e.alt, definition: e.def, status: e.status, sources: e.sources.map((s) => s.url), symbols: e.symbols, facts: e.facts.map((f) => ({ ...f, text: f.text.en })), note: e.note, mappings: (links[e.key] ?? []).map(({ rel, key }) => ({ rel, key })), row: e.row })),
}))

// ── the layer picture ─────────────────────────────────────────────────────
console.log('\n── pages')
const parts = JSON.parse(readFileSync(join(META, 'overview/parts.json'), 'utf8'))
for (const l of ['en', 'de']) emit(`overview/layers.${l}.svg`, readFileSync(join(META, `overview/layers.${l}.svg`), 'utf8'))
// The picture is written into the page, not embedded as an image, so it follows the page's
// tokens and the colour-scheme toggle. Its own style block goes; its variables map onto the page's.
const inlineSvg = (l) => readFileSync(join(META, `overview/layers.${l}.svg`), 'utf8')
  .replace(/<\?xml[^>]*\?>\s*/, '').replace(/<!--[\s\S]*?-->\s*/g, '').replace(/<style>[\s\S]*?<\/style>\s*/, '')
  .replace(/var\(--(rlnp|rltp|rls)-tint\)/g, 'var(--$1-t)').replace('<svg ', '<svg class="layers" ')

// ── the gate ──────────────────────────────────────────────────────────────
const G = {
  en: { ids: 'Identifiers anchored here', idsText: 'The permanent identifiers of all three parts live under this domain. They follow the protocols, not the branding; a breaking change gets a new version, not a new word.', picture: 'The three parts: the Network Protocol beside the Stack, the Trust Protocol filling the layers below the connector.', rows: [['/terms', 'the dictionary: everything listed here, side by side'], ['/rlnp/v1', 'terms of the Real Life Network Protocol'], ['/rls/v1', 'terms of the Real Life Stack'], ['/rltp/v1', 'vocabulary, context and schemas of the Real Life Trust Protocol'], ['/trust-tasks', 'RLTP Trust Task types (ToIP DTGWG framework 0.4)'], ['/meta/v1', 'the shared register: context, mappings between the three parts, register fields']] },
  de: { ids: 'Kennungen, die hier verankert sind', idsText: 'Die dauerhaften Kennungen aller drei Teile liegen unter dieser Domain. Sie folgen den Protokollen, nicht dem Branding; ein Bruch bekommt eine neue Version, kein neues Wort.', picture: 'Die drei Teile: das Netzwerkprotokoll neben dem Stack, das Trust Protocol füllt die Schichten unter dem Connector.', rows: [['/terms', 'das Wörterbuch: alles, was hier gelistet ist, nebeneinander'], ['/rlnp/v1', 'Begriffe des Real Life Network Protocol'], ['/rls/v1', 'Begriffe des Real Life Stack'], ['/rltp/v1', 'Vokabular, Kontext und Schemas des Real Life Trust Protocol'], ['/trust-tasks', 'RLTP Trust-Task-Typen (ToIP DTGWG Framework 0.4)'], ['/meta/v1', 'das gemeinsame Register: Kontext, Verknüpfungen zwischen den drei Teilen, Registerfelder']] },
}
for (const l of ['en', 'de']) {
  const t = G[l]
  emit(`${de(l)}index.html`, shell({ l, title: parts.gate.title[l], active: `/${de(l)}`, alt: { lang: other(l), href: `/${de(other(l))}` }, search: 'forward',
    body: `<p class="sub" style="margin-bottom:18px">${esc(parts.gate.sentence[l])}</p>
<figure role="img" aria-label="${esc(t.picture)}">${inlineSvg(l)}</figure>
<div class="parts">
${parts.parts.map((p) => `<section class="part p-${p.spec.world}" id="${p.id}"><h2><a href="${p.url}">${esc(p.name[l])}</a></h2><p>${esc(p.sentence[l])}</p><p class="spec"><b>${esc(p.spec.abbr)}</b> · ${esc(p.spec.name[l])}</p><p class="for">${esc(p.for[l])}</p></section>`).join('\n')}
</div>
<h2 id="identifiers">${t.ids}</h2>
<p>${t.idsText}</p>
<table>${t.rows.map(([path, what]) => `<tr><th><a href="/${de(l)}${path.slice(1)}/">${path}</a></th><td>${what}</td></tr>`).join('\n')}</table>` }))
}

// ── list pages: each one a filter over the catalog ────────────────────────
const listPage = ({ l, path, title, active, head = '', intro, filter, rowsMode = false, tail = '' }) => {
  const w = W[l]
  const body = rowsMode
    ? `${intro}<div class="rows">${rows.filter((keys) => keys.some((k) => filter(entries[k]))).sort((x, y) => (y.length - x.length) || T(entries[x[0]].label, l).localeCompare(T(entries[y[0]].label, l)))
        .map((keys) => { const es = keys.map((k) => entries[k]); const labels = [...new Set(es.map((e) => T(e.label, l)))]
          return `<section class="row" data-q="${esc(es.map((e) => [e.label.de, e.label.en, e.def.de, e.def.en].join(' ')).join(' ').toLowerCase())}"><div class="rowhead"><b>${esc(labels.join(' · '))}</b><span>${es.length > 1 ? `${w.oneThing} ${es.length} ${w.parts}` : w.alone}</span></div>${entriesHtml(es, l, { hideSame: true, id: null })}</section>` }).join('\n')}</div>${tail}`
    : `${intro}${entriesHtml(all.filter(filter), l)}${tail}`
  emit(`${de(l)}${path}index.html`, shell({ l, title, active, head, search: true, alt: { lang: other(l), href: `/${de(other(l))}${path}` }, body }))
}
const NSW = {
  rlnp: { name: 'Real Life Network Protocol', short: 'RLNP', what: { en: 'the social specification: what a circle, an encounter, a promise, a role mean', de: 'die soziale Spezifikation: was ein Kreis, eine Begegnung, ein Versprechen, eine Rolle bedeuten' } },
  rls: { name: 'Real Life Stack', short: 'RLS', what: { en: 'the app toolkit: application, data and the connector socket', de: 'der App-Baukasten: Anwendung, Daten und die Steckstelle des Connectors' } },
  rltp: { name: 'Real Life Trust Protocol', short: 'RLTP', what: { en: 'the technical specification: identity, encounter and relationship, access', de: 'die technische Spezifikation: Identität, Begegnung und Beziehung, Zugang' } },
}
const NS = {
  en: { intro: (w, ns) => `The term namespace of the <strong>${w.name}</strong>, ${w.what.en}. Permanent identifiers are <code>${ns}#&lt;Fragment&gt;</code>; the fragments resolve to the entries below. Each term is defined by the ${w.short} specification itself; mappings to the other parts come from the <a href="/meta/v1/">shared register</a>, and the <a href="/terms/">dictionary</a> shows everything side by side.`, terms: 'Terms', machine: (world) => `Machine-readable: <a href="/${world}/v1/terms.jsonld"><code>terms.jsonld</code></a> (SKOS concept scheme) and <a href="/${world}/v1/index.json"><code>index.json</code></a>.` },
  de: { intro: (w, ns) => `Der Begriffs-Namensraum des <strong>${w.name}</strong>, ${w.what.de}. Dauerhafte Kennungen sind <code>${ns}#&lt;Fragment&gt;</code>; die Fragmente lösen zu den Einträgen unten auf. Jeden Begriff definiert die ${w.short}-Spezifikation selbst; die Verknüpfungen zu den anderen Teilen kommen aus dem <a href="/de/meta/v1/">gemeinsamen Register</a>, und das <a href="/de/terms/">Wörterbuch</a> zeigt alles nebeneinander. Begriffe ohne deutsches Wort erscheinen englisch.`, terms: 'Begriffe', machine: (world) => `Maschinenlesbar: <a href="/${world}/v1/terms.jsonld"><code>terms.jsonld</code></a> (SKOS-Konzeptschema) und <a href="/${world}/v1/index.json"><code>index.json</code></a>.` },
}
const RLTP_EXTRA = {
  en: `<p>The JSON-LD context document is <a href="/rltp/v1/context.jsonld">context.jsonld</a>. Per the interim securing profile, credentials pin their <code>@context</code> by value and implementations never process JSON-LD at runtime — this document defines meaning, not machinery.</p>`,
  de: `<p>Das JSON-LD-Kontextdokument ist <a href="/rltp/v1/context.jsonld">context.jsonld</a>. Nach dem vorläufigen Sicherungsprofil binden Credentials ihren <code>@context</code> per Wert, und Implementierungen verarbeiten JSON-LD nie zur Laufzeit — dieses Dokument definiert Bedeutung, nicht Maschinerie.</p>`,
}
const RLTP_TAIL = {
  en: `<h2>Normative schemas</h2><p>${core.map((s) => `<a href="/rltp/v1/schemas/${s.file}">${s.file.replace('.schema.json', '')}</a>`).join(' · ')}</p><p>Task payload schemas live at their Type URIs under <a href="/trust-tasks/">/trust-tasks/</a>.</p>`,
  de: `<h2>Normative Schemas</h2><p>${core.map((s) => `<a href="/rltp/v1/schemas/${s.file}">${s.file.replace('.schema.json', '')}</a>`).join(' · ')}</p><p>Payload-Schemas der Task-Typen liegen unter ihren Type URIs unter <a href="/de/trust-tasks/">/trust-tasks/</a>.</p>`,
}
for (const l of ['en', 'de']) {
  for (const world of ['rlnp', 'rls', 'rltp']) {
    const w = NSW[world]; const ns = `${BASE}${world}/v1`; const n = NS[l]
    listPage({ l, path: `${world}/v1/`, title: `${w.short} ${n.terms} · ${world}/v1`, active: `/${de(l)}#identifiers`,
      head: `<link rel="alternate" type="application/ld+json" href="/${world}/v1/${world === 'rltp' ? 'context.jsonld' : 'terms.jsonld'}"><link rel="alternate" type="application/json" href="/${world}/v1/index.json"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', '@id': ns, name: `${w.short} terms`, description: `Term namespace of the ${w.name}.`, url: `${ns}/` })}</script>`,
      intro: `<h1><code>${ns}</code></h1><p>${n.intro(w, ns)}</p>${world === 'rltp' ? RLTP_EXTRA[l] : ''}<p>${n.machine(world)}</p><h2>${n.terms}</h2>`,
      filter: (e) => e.kind === 'term' && e.world === world, tail: world === 'rltp' ? RLTP_TAIL[l] : '' })
  }
  // /meta/v1: the register's fields
  const M = {
    en: { title: 'Shared term register · meta/v1', p1: 'The shared part of the Real Life term register. The three parts keep their own SKOS concept schemes: <a href="/rlnp/v1/">RLNP</a> (meaning), <a href="/rltp/v1/">RLTP</a> (construction) and <a href="/rls/v1/">RLS</a> (interface and code). This namespace holds what none of them owns alone: the JSON-LD context all three use, the mappings between them, and the few fields SKOS does not have.', p2: 'Machine-readable: <a href="/meta/v1/context.jsonld"><code>context.jsonld</code></a>, <a href="/meta/v1/mappings.jsonld"><code>mappings.jsonld</code></a>, <a href="/meta/v1/index.json"><code>index.json</code></a>; the whole catalog: <a href="/terms/index.json"><code>terms/index.json</code></a>.', fields: 'Fields', rule: 'Rule', p3: 'Definitions never live here. Each part defines its terms in its own repository and stays normative for them; the register only connects them. Source and checks: <a href="https://github.com/real-life-org/meta">real-life-org/meta</a>.' },
    de: { title: 'Gemeinsames Begriffsregister · meta/v1', p1: 'Der gemeinsame Teil des Real-Life-Begriffsregisters. Die drei Teile halten ihre eigenen SKOS-Konzeptschemata: <a href="/de/rlnp/v1/">RLNP</a> (Bedeutung), <a href="/de/rltp/v1/">RLTP</a> (Konstruktion) und <a href="/de/rls/v1/">RLS</a> (Oberfläche und Code). Dieser Namensraum hält, was keiner allein besitzt: den JSON-LD-Kontext aller drei, die Verknüpfungen zwischen ihnen und die wenigen Felder, die SKOS nicht hat.', p2: 'Maschinenlesbar: <a href="/meta/v1/context.jsonld"><code>context.jsonld</code></a>, <a href="/meta/v1/mappings.jsonld"><code>mappings.jsonld</code></a>, <a href="/meta/v1/index.json"><code>index.json</code></a>; der ganze Katalog: <a href="/terms/index.json"><code>terms/index.json</code></a>.', fields: 'Felder', rule: 'Regel', p3: 'Definitionen leben nie hier. Jeder Teil definiert seine Begriffe im eigenen Repository und bleibt dafür normativ; das Register verbindet sie nur. Quelle und Prüfungen: <a href="https://github.com/real-life-org/meta">real-life-org/meta</a>.' },
  }[l]
  listPage({ l, path: 'meta/v1/', title: M.title, active: `/${de(l)}#identifiers`,
    head: `<link rel="alternate" type="application/ld+json" href="/meta/v1/context.jsonld"><link rel="alternate" type="application/json" href="/meta/v1/index.json">`,
    intro: `<h1><code>${BASE}meta/v1</code></h1><p>${M.p1}</p><p>${M.p2}</p><h2>${M.fields}</h2>`, filter: (e) => e.kind === 'field', tail: `<h2>${M.rule}</h2><p>${M.p3}</p>` })
  // /trust-tasks/: the types
  const TT = {
    en: { h: 'RLTP Trust Task types', p1: `Private Trust Task types registered under <code>${BASE}trust-tasks/</code> by the Real Life Trust Protocol (${esc(registry.framework)}).`, p2: 'Machine-readable registry: <a href="/trust-tasks/index.json"><code>index.json</code></a> — every type with its Type URI, payload-schema URL, defining section and SHA-256 digest. Each payload schema resolves as raw JSON at <code>&lt;Type&nbsp;URI&gt;/schema.json</code>.' },
    de: { h: 'RLTP Trust-Task-Typen', p1: `Private Trust-Task-Typen, die das Real Life Trust Protocol unter <code>${BASE}trust-tasks/</code> registriert (${esc(registry.framework)}). Die Beschreibungen sind englisch, wie die Spezifikation.`, p2: 'Maschinenlesbares Register: <a href="/trust-tasks/index.json"><code>index.json</code></a> — jeder Typ mit Type URI, Payload-Schema-URL, definierendem Abschnitt und SHA-256-Prüfsumme. Jedes Payload-Schema löst als rohes JSON unter <code>&lt;Type&nbsp;URI&gt;/schema.json</code> auf.' },
  }[l]
  listPage({ l, path: 'trust-tasks/', title: TT.h, active: `/${de(l)}#identifiers`,
    head: `<link rel="alternate" type="application/json" href="/trust-tasks/index.json"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', '@id': `${BASE}trust-tasks/`, name: 'RLTP Trust Task types', url: `${BASE}trust-tasks/` })}</script>`,
    intro: `<h1>${TT.h}</h1><p>${TT.p1}</p><p>${TT.p2}</p>`, filter: (e) => e.kind === 'task' })
  // /terms/: everything, grouped into rows
  const D = {
    en: { title: 'Dictionary', sub: 'Everything real-life.org lists, side by side: the terms of the three parts, the Trust Task types and the register\'s fields. A row is one concept: the entries that mean the same thing. Related, broader or narrower terms, false friends and convergence targets are linked from the entries. Each part defines its own terms; this page only puts them next to each other.', termsN: 'entries', proposedN: 'proposals', convergeN: 'convergence tasks', guardOk: 'Guard: no findings', how: '<em>edit</em> opens the defining file of the part; GitHub turns the change into a pull request. <em>propose</em> opens a prefilled issue. <em>New term</em> opens an issue with the fields a term needs.' },
    de: { title: 'Wörterbuch', sub: 'Alles, was real-life.org listet, nebeneinander: die Begriffe der drei Teile, die Trust-Task-Typen und die Felder des Registers. Eine Zeile ist ein Begriff: die Einträge, die dasselbe meinen. Verwandte, allgemeinere oder speziellere Begriffe, falsche Freunde und Konvergenzziele sind aus den Einträgen verlinkt. Jeder Teil definiert seine Begriffe selbst; diese Seite stellt sie nur nebeneinander. Begriffe ohne deutsches Wort erscheinen englisch.', termsN: 'Einträge', proposedN: 'Vorschläge', convergeN: 'Konvergenzaufgaben', guardOk: 'Guard: keine Hinweise', how: '<em>ändern</em> öffnet die Definitionsdatei des Teils; GitHub macht aus der Änderung einen Pull Request. <em>vorschlagen</em> öffnet ein vorbefülltes Issue. <em>Begriff anlegen</em> öffnet ein Issue mit den Feldern, die ein Begriff braucht.' },
  }[l]
  const nConv = Object.entries(links).reduce((n, [a, v]) => n + v.filter(({ rel, key }) => rel === 'rl:convergesWith' && a < key).length, 0)
  listPage({ l, path: 'terms/', title: D.title, active: `/${de(l)}terms/`, rowsMode: true, filter: () => true,
    intro: `<p class="sub">${D.sub}</p><div class="stats"><span>${all.length} ${D.termsN}</span><span>${all.filter((e) => e.status === 'proposed').length} ${D.proposedN}</span><span>${nConv} ${D.convergeN}</span><span>${D.guardOk}</span><a href="${newTermUrl(l)}">+ ${W[l].newTerm} ↗</a></div>`,
    tail: `<p class="sub" style="margin-top:22px;font-size:.88rem">${D.how}</p>` })
}

// ── detail pages: one per Trust Task type, from the same entry ────────────
const OFFLINE = '<p><em>Offline rule: conforming implementations pre-register every schema by its <code>$id</code> and never resolve over the network — this page is documentation, not infrastructure.</em></p>'
for (const e of all.filter((x) => x.kind === 'task')) {
  const head = `<link rel="alternate" type="application/schema+json" href="schema.json">` + (e.status === 'superseded' ? '' : `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'DefinedTerm', '@id': e.iri, name: e.fragment, description: `RLTP Trust Task type — ${e.def.en} Payload schema: ${e.iri}/schema.json`, inDefinedTermSet: `${BASE}trust-tasks/`, url: `${e.iri}/` })}</script>`)
  const body = e.status === 'superseded'
    ? `<h1><code>${e.iri}</code></h1>
<p><strong>${e.fragment}</strong> is a retired version of a private Trust Task type of the Real Life Trust Protocol. It is superseded by <a href="/trust-tasks/${e.supersededBy}/"><code>${e.supersededBy}</code></a>.</p>
<p>The URI keeps resolving because published identifiers do not disappear. The payload schema published under it stays available as <a href="schema.json">schema.json</a>; new documents use the current version.</p>
${OFFLINE}`
    : `<h1><code>${e.iri}</code></h1>
<p><strong>${e.fragment}</strong> is a private Trust Task type of the Real Life Trust Protocol (${esc(registry.framework)}).</p>
<p>${esc(e.def.en)}</p>
<table><tr><th>Normative definition</th><td><a href="${e.definedIn.url}">${esc(e.definedIn.specification)} ${esc(e.definedIn.section)}</a></td></tr>
<tr><th>Conformance profile</th><td><code>${e.profile}</code></td></tr>
<tr><th>Payload schema ($id = this URI)</th><td><a href="schema.json">schema.json</a></td></tr>
<tr><th>Document profile</th><td><a href="/rltp/v1/schemas/rltp-delivery-document.schema.json">rltp-delivery-document.schema.json</a></td></tr></table>
${OFFLINE}`
  emit(`trust-tasks/${e.fragment}/index.html`, shell({ title: `${e.fragment} — RLTP Trust Task type`, head, active: '/#identifiers', body }))
}

console.log(`\n${written} written, ${unchanged} unchanged.`)
if (CHECK && errors) { console.error(`${errors} file(s) out of date — run without --check.`); process.exit(1) }
