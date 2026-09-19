// One catalog for everything real-life.org lists: terms of the three parts (SKOS schemes in
// real-life-org/meta, plus the RLTP vocabulary from registry.meta.json), the RLTP Trust Task
// types (schemas in rltp-spec) and the register's own fields. Every page is a filter over it.
//
// An entry has one shape, whatever its origin:
//   { key, kind: 'term'|'task'|'field', world: 'rlnp'|'rls'|'rltp'|'meta'|'task',
//     fragment, iri, href, label: {de,en}, alt: [], def: {de,en}, status,
//     sources: [{url, text}], symbols: [], facts: [{text: {de,en}, target, href}], note }
// Labels and definitions are bilingual where the source is; a missing language falls back
// to the other one at render time.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const BASE = 'https://real-life.org/'
export const PREFIX = { rlnp: `${BASE}rlnp/v1#`, rltp: `${BASE}rltp/v1#`, rls: `${BASE}rls/v1#` }
export const REL = ['skos:exactMatch', 'skos:closeMatch', 'skos:relatedMatch', 'skos:narrowMatch', 'skos:broadMatch', 'rl:convergesWith', 'rl:falseFriend']
// "A skos:narrowMatch B" states that B is narrower than A; seen from B the relation is broadMatch.
export const INVERSE = { 'skos:narrowMatch': 'skos:broadMatch', 'skos:broadMatch': 'skos:narrowMatch' }
export const SAME = new Set(['skos:exactMatch', 'skos:closeMatch'])

export const lang = (vals, l) => (Array.isArray(vals) ? vals : [vals]).find((v) => v && v['@language'] === l)?.['@value'] ?? ''
export const list = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])
const bi = (vals) => ({ de: lang(vals, 'de'), en: lang(vals, 'en') })

// The conformance profile a Trust Task type belongs to is stated by the schema title.
const FAMILIES = { access: 'Access Layer', delivery: 'Delivery Contract', encounter: 'Encounter Layer', membership: 'Membership Tasks' }
export const profileOf = (doc) => {
  const t = doc.title ?? ''
  const direct = t.match(/rltp-([a-z-]+)@([0-9]+\.[0-9]+)/)
  if (direct) return `rltp-${direct[1]}@${direct[2]}`
  for (const [fam, label] of Object.entries(FAMILIES)) {
    const m = t.match(new RegExp(`${label} ([0-9]+\\.[0-9]+)`))
    if (m) return `rltp-${fam}@${m[1]}`
  }
  return null
}

export function buildCatalog({ META, SPEC, ROOT, err }) {
  const sources = JSON.parse(readFileSync(join(META, 'terms/sources.json'), 'utf8')).schemes
  const contextText = readFileSync(join(META, 'terms/context.jsonld'), 'utf8')
  const mappingsText = readFileSync(join(META, 'terms/mappings.skos.jsonld'), 'utf8')
  const registry = JSON.parse(readFileSync(join(ROOT, 'registry.meta.json'), 'utf8'))

  const entries = {}
  const add = (e) => { entries[e.key] = e; return e }

  // ── terms from the three SKOS schemes ─────────────────────────────────
  const schemeText = {}
  for (const [world, s] of Object.entries(sources)) {
    const file = s.ref == null ? join(META, s.seed) : join(ROOT, world, s.path)
    if (!existsSync(file)) { err(`${world}: scheme file ${file} not found`); continue }
    schemeText[world] = readFileSync(file, 'utf8')
    for (const n of JSON.parse(schemeText[world])['@graph']) {
      if (n['@type'] !== 'skos:Concept') continue
      const fragment = n['@id'].split(':')[1]
      add({
        key: n['@id'], kind: 'term', world, fragment, iri: PREFIX[world] + fragment,
        href: `/${world}/v1/#${fragment}`,
        label: bi(n['skos:prefLabel']), alt: [...new Set(list(n['skos:altLabel']).map((a) => a['@value']))],
        def: bi(n['skos:definition']), status: n['rl:status'] ?? 'specified',
        sources: list(n['dct:source']).map((u) => ({ url: u, text: u.split('/').slice(-1)[0] })),
        symbols: list(n['rl:symbol']), facts: [], note: '',
      })
    }
  }

  // ── the RLTP vocabulary from registry.meta.json, merged onto the RLTP scheme ──
  for (const t of registry.terms) {
    const key = `rltp:${t.fragment}`
    const e = entries[key] ?? add({ key, kind: 'term', world: 'rltp', fragment: t.fragment, iri: PREFIX.rltp + t.fragment, href: `/rltp/v1/#${t.fragment}`, label: { de: '', en: t.fragment }, alt: [], def: { de: '', en: '' }, status: 'specified', sources: [], symbols: [], facts: [], note: '' })
    if (!e.def.en) e.def.en = t.meaning
    e.facts.push({ text: { de: 'definiert in', en: 'defined in' }, target: t.definedIn })
  }

  // ── Trust Task types from rltp-spec schemas ───────────────────────────
  const schemas = readdirSync(join(SPEC, 'schemas')).filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, text: readFileSync(join(SPEC, 'schemas', f), 'utf8') }))
    .map((s) => ({ ...s, doc: JSON.parse(s.text) })).filter((s) => s.doc.$id?.startsWith(BASE))
  const core = schemas.filter((s) => s.doc.$id.includes('/rltp/v1/schemas/'))
  const types = schemas.filter((s) => s.doc.$id.includes('/trust-tasks/')).map((s) => ({ ...s, slug: s.doc.$id.replace(`${BASE}trust-tasks/`, '') }))
  for (const t of types) {
    const m = registry.types[t.slug]
    if (!m) { err(`${t.file} ships type "${t.slug}" with no entry in registry.meta.json`); continue }
    const profile = profileOf(t.doc)
    if (!profile) err(`${t.file}: title states no conformance profile`)
    add({
      key: `task:${t.slug}`, kind: 'task', world: 'task', fragment: t.slug, iri: t.doc.$id, href: `/trust-tasks/${t.slug}/`,
      label: { de: t.slug, en: t.slug }, alt: [], def: { de: '', en: m.summary }, status: 'specified',
      sources: [{ url: m.definedIn.url, text: `${m.definedIn.specification} ${m.definedIn.section}` }], symbols: [],
      facts: [{ text: { de: 'Profil', en: 'profile' }, target: profile }, { text: { de: 'definiert in', en: 'defined in' }, target: `${m.definedIn.specification} ${m.definedIn.section}`, href: m.definedIn.url }],
      note: '', schemaText: t.text, definedIn: m.definedIn, profile,
    })
  }
  for (const slug of Object.keys(registry.types)) if (!types.some((t) => t.slug === slug)) err(`registry.meta.json describes "${slug}", which no shipped schema declares`)
  for (const [old, next] of Object.entries(registry.superseded ?? {})) {
    add({
      key: `task:${old}`, kind: 'task', world: 'task', fragment: old, iri: `${BASE}trust-tasks/${old}`, href: `/trust-tasks/${old}/`,
      label: { de: old, en: old }, alt: [], def: { de: `Zurückgezogene Version, abgelöst durch ${next}. Die Kennung löst weiter auf, das veröffentlichte Schema bleibt.`, en: `Retired version, superseded by ${next}. The URI keeps resolving; the published schema stays.` },
      status: 'superseded', sources: [], symbols: [], facts: [{ text: { de: 'abgelöst durch', en: 'superseded by' }, target: next, href: `/trust-tasks/${next}/` }], note: '', supersededBy: next,
    })
  }

  // ── the register's own fields ─────────────────────────────────────────
  const FIELDS = {
    convergesWith: { en: 'The target state: these two concepts are meant to become the same, and the specifications have a task until they are. The SKOS mapping relations describe today.', de: 'Der Zielzustand: Diese zwei Begriffe sollen gleich werden, und die Spezifikationen haben eine Aufgabe, bis sie es sind. Die SKOS-Relationen beschreiben das Heute.' },
    falseFriend: { en: 'Same word in at least one language, different thing, on purpose. Recorded so the pair is never reported as a missing mapping and so the pages show it explicitly.', de: 'Gleiches Wort in mindestens einer Sprache, andere Sache, mit Absicht. Festgehalten, damit das Paar nie als fehlende Verknüpfung gemeldet wird und die Seiten es ausdrücklich zeigen.' },
    status: { en: '"proposed": the concept does not exist in its specification yet; it is a proposal from the register to that part.', de: '„proposed": Der Begriff existiert in seiner Spezifikation noch nicht; er ist ein Vorschlag des Registers an diesen Teil.' },
    symbol: { en: 'Code symbols that implement the term (Real Life Stack only).', de: 'Codesymbole, die den Begriff implementieren (nur Real Life Stack).' },
  }
  for (const [f, d] of Object.entries(FIELDS)) add({ key: `field:${f}`, kind: 'field', world: 'meta', fragment: f, iri: `${BASE}meta/v1#${f}`, href: `/meta/v1/#${f}`, label: { de: `rl:${f}`, en: `rl:${f}` }, alt: [], def: d, status: 'specified', sources: [], symbols: [], facts: [], note: '' })

  // ── mappings between terms ────────────────────────────────────────────
  const links = {}, notes = {}
  for (const m of JSON.parse(mappingsText)['@graph']) {
    const a = m['@id']
    if (!entries[a]) { err(`mapping names unknown concept ${a}`); continue }
    if (m['skos:note']) (notes[a] ??= []).push(m['skos:note'])
    for (const rel of REL) for (const b of list(m[rel])) {
      if (!entries[b]) { err(`${a} ${rel} -> unknown concept ${b}`); continue }
      ;(links[a] ??= []).push({ rel, key: b }); (links[b] ??= []).push({ rel: INVERSE[rel] ?? rel, key: a })
    }
  }
  for (const [k, ns] of Object.entries(notes)) entries[k].note = ns[0]

  // ── rows: a row is one concept, so only sameness joins entries ────────
  const parent = {}
  const find = (x) => (parent[x] === undefined || parent[x] === x) ? (parent[x] = x) : (parent[x] = find(parent[x]))
  for (const k of Object.keys(entries)) find(k)
  for (const [a, rels] of Object.entries(links)) for (const { rel, key: b } of rels) if (SAME.has(rel)) parent[find(a)] = find(b)
  const rows = {}
  for (const k of Object.keys(entries)) (rows[find(k)] ??= []).push(k)
  const WORLD_ORDER = ['rlnp', 'rls', 'rltp', 'task', 'meta']
  const rowList = Object.values(rows).map((keys) => keys.sort((x, y) => WORLD_ORDER.indexOf(entries[x].world) - WORLD_ORDER.indexOf(entries[y].world)))
  for (const keys of rowList) for (const k of keys) entries[k].row = keys

  return { entries, links, rows: rowList, sources, contextText, mappingsText, schemeText, registry, core, types, WORLD_ORDER }
}
