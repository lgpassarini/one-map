// Passo 1 dos dados de episódios: cruza as fontes baixadas por fetch-episodes.mjs.
//
// - opguide.app (mapping.json): capítulos de cada episódio, flag de filler, arco (pelos capítulos)
// - onepace.net (watch): episódio do One Pace que cobre cada episódio do anime, com o link
// - One Piece Wiki: título EN, arco da navegação (inclusive os de filler), recap, sinopse
// - geo/episode-places.json (à mão): local de cada episódio, conferido contra os links das sinopses
//
// Saída: src/data/episodes.json e docs/revisao-episodios.md (divergências entre as fontes, para
// o usuário revisar).
//
// Uso: node scripts/build-episodes.mjs   (depois de node scripts/fetch-episodes.mjs)
import { readFile, readdir, writeFile } from 'node:fs/promises'

const DIR = '.cache/episodes'
const opg = JSON.parse(await readFile(`${DIR}/opguide-mapping.json`, 'utf8'))
const opHtml = await readFile(`${DIR}/onepace-watch.html`, 'utf8')
const curated = JSON.parse(await readFile('geo/episode-places.json', 'utf8'))
const N = opg.maxEpisode

// ---------- Wiki ----------
const wiki = {}
for (const f of (await readdir(`${DIR}/wiki`)).sort()) {
  const j = JSON.parse(await readFile(`${DIR}/wiki/${f}`, 'utf8'))
  for (const p of j.query.pages) {
    if (p.missing) continue
    wiki[+p.title.replace('Episode ', '')] = p.revisions[0].slots.main.content
  }
}
const field = (c, name) => new RegExp(`\\|\\s*${name}\\s*=([^\\n]*)`).exec(c)?.[1].trim() ?? ''
const section = (c, name) => {
  const i = c.indexOf(`==${name}==`)
  if (i < 0) return ''
  const r = c.slice(i + name.length + 4)
  const k = r.search(/\n==[^=]/)
  return k < 0 ? r : r.slice(0, k)
}
const linkTargets = (s) => [...s.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim())
const plain = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const wikiNav = (c) => /\{\{([^}|]+)/.exec(c.split('==Site Navigation==')[1] ?? '')?.[1].trim()

// ---------- One Pace (onepace.net) ----------
const decode = (s) =>
  s.replace(/<!-- -->/g, '').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').trim()
const numbers = (s) => {
  const out = []
  for (const m of s.replace(/[–—]/g, '-').matchAll(/(\d+)(?:\s*-\s*(\d+))?/g)) {
    const a = +m[1], b = m[2] ? +m[2] : a
    for (let k = a; k <= b; k++) out.push(k)
  }
  return out
}
const opArcs = [], opEps = []
{
  const re =
    /id="([a-z0-9-]+)-title"[^>]*><a href="#\1"[^>]*>([^<]+)|<h3[^>]*><a href="#([a-z0-9-]+-\d+)"[^>]*><strong[^>]*>\d+<span[^>]*>:<\/span><\/strong>(.*?)<svg|Covered (manga chapters|anime episodes)<\/span><span[^>]*>\s*<\/span>([^<]*)</g
  let ep = null
  for (const m of opHtml.matchAll(re)) {
    if (m[1]) {
      opArcs.push({ id: m[1], name: decode(m[2]) })
      ep = null // o resumo do arco também tem "Covered anime episodes"
    } else if (m[3]) opEps.push((ep = { id: m[3], arc: opArcs.at(-1).id, title: decode(m[4]), chapters: [], anime: [] }))
    else if (ep) ep[m[5] === 'manga chapters' ? 'chapters' : 'anime'] = numbers(m[6])
  }
}
// anime → primeiro episódio do One Pace que o cobre
const animeToOp = {}
for (const e of opEps) for (const a of e.anime) animeToOp[a] ??= e

// ---------- Arcos ----------
// A base é o anime oficial: o arco é o da navegação da Wiki (divisão do anime, com os arcos de
// filler e as minisséries de capa). "Specials" e páginas sem navegação ficam no arco de antes.
// O arco pelos capítulos (divisão do One Pace, um fan cut) só entra na conferência do relatório
// e para escolher o link do One Pace. As faixas de capítulo saem dos episódios do One Pace no
// opguide, sem os arcos de capa e de interlúdio (Buggy's Crew, Koby-Meppo, Gaimon...), que
// reaproveitam números de capítulo.
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const SIDE_ARCS = /^(gaimon|the-|if-you-could|one-piece-fan-letter|warship-island)/
const WIKI_ALIAS = { 'Post-Alabasta Arc': 'Post-Arabasta Arc' }
// mesmo arco com nome diferente (Wiki → One Pace), só para a conferência
const SAME_ARC = {
  arabasta: 'alabasta', 'water-7': 'water-seven', 'fish-man-island': 'fishman-island',
  'wano-country': 'wano', levely: 'reverie', elbaph: 'elbaf',
}
const opArcName = Object.fromEntries(opArcs.map((a) => [a.id, a.name]))
const mainArcs = [] // { name, start } em ordem de capítulo
for (const x of opg.onePace) {
  const id = x[0].replace(/-\d+$/, '')
  if (SIDE_ARCS.test(id) || !x[4].length) continue
  const a = mainArcs.find((m) => m.id === id)
  if (a) a.start = Math.min(a.start, ...x[4])
  else mainArcs.push({ id, name: opArcName[id] ?? x[2], start: Math.min(...x[4]) })
}
mainArcs.sort((a, b) => a.start - b.start)
const canonArcNames = mainArcs.map((a) => a.name)
const lastOpChapter = Math.max(...opg.onePace.flatMap((x) => x[4]))
const arcByChapter = (c) => mainArcs.findLast((a) => a.start <= c).name
const arcs = new Map() // id → { id, name, filler, episodes: [a, b] }
const arcOf = (name) => {
  const id = slug(name)
  if (!arcs.has(id)) arcs.set(id, { id, name: { en: name } })
  return id
}

// ---------- Episódios ----------
const review = { arc: [], place: [], onePace: [], missing: [] }
const placeAt = (n) => {
  let p = null
  for (const [a, id] of curated.segments) if (a <= n) p = id
  return p
}
const placeByWiki = {}
for (const [id, p] of Object.entries(curated.places)) for (const w of p.wiki) placeByWiki[w] = id

const episodes = []
let prevArc = null, canonOrder = -1
for (let n = 1; n <= N; n++) {
  const c = wiki[n]
  if (!c) review.missing.push(n)
  const chapters = opg.episodeToChapters[n - 1] ?? []
  const flag = opg.fillerFlags[n - 1]
  const tags = []
  if (flag === 'f') tags.push('filler')
  if (c && /recap/i.test(field(c, 'chapter'))) tags.push('recap')

  // arco pelos capítulos (One Pace): capítulo mais alto, porque flashbacks adaptam capítulos
  // antigos (ep. 4 adapta 1 e 8), e nunca volta para um arco anterior ao do episódio de antes
  const ch = Math.max(0, ...chapters.filter((k) => k <= lastOpChapter)) || null
  let chArc = null
  if (ch) {
    const order = canonArcNames.indexOf(arcByChapter(ch))
    if (order >= canonOrder) canonOrder = order
    chArc = slug(canonArcNames[canonOrder])
  }

  // arco: o da navegação da Wiki (anime oficial). Página sem navegação (Long Ring Long Land,
  // 777–779): a categoria "X Arc Episodes" da Wiki e, sem ela, o arco pelos capítulos.
  // "Specials" (291, 292, 303, 336, 406, 407, 492, 542, 590, 907) fica no arco de antes.
  const nav = c ? wikiNav(c) : undefined
  const catArc = c && /\[\[Category:(.+?) Arc Episodes\]\]/.exec(c)?.[1]
  const arc =
    nav && nav !== 'Specials' ? arcOf((WIKI_ALIAS[nav] ?? nav).replace(/ Arc$/, ''))
    : !nav && catArc ? arcOf((WIKI_ALIAS[`${catArc} Arc`] ?? catArc).replace(/ Arc$/, ''))
    : !nav && chArc ? arcOf(canonArcNames[canonOrder])
    : prevArc
  prevArc = arc

  if (chArc) {
    const wikiSide = SAME_ARC[arc] ?? arc
    // só compara arcos principais (as minisséries de capa e os fillers não existem no One Pace)
    if (mainArcs.some((a) => a.id === wikiSide) && wikiSide !== chArc)
      review.arc.push({ n, wiki: arcs.get(arc).name.en, chapters: canonArcNames[canonOrder] })
  }

  // One Pace: o episódio do onepace.net que cobre este episódio do anime. Confere com o opguide:
  // algum capítulo do episódio está nesse episódio do One Pace? (opguide numera "arco-1",
  // o onepace.net "arco-01")
  // Sem cobertura no onepace.net: o do opguide pelos capítulos, se existir no onepace.net.
  const norm = (id) => id.replace(/-0*(\d+)$/, '-$1')
  const viaOpg = new Set(chapters.flatMap((k) => (opg.chapterToOnePace[k - 1] ?? []).map((i) => norm(opg.onePace[i][0]))))
  let onePace = null
  let op = animeToOp[n]
  let fallback = false
  if (!op && flag !== 'f')
    for (const id of viaOpg) {
      const e = opEps.find((x) => norm(x.id) === id && x.arc === chArc)
      if (e) { op = e; fallback = true; break }
    }
  if (op) onePace = { id: op.id, title: op.title, url: `https://onepace.net/en/watch#${op.id}` }
  if (fallback) review.onePace.push({ n, onepace: `${op.id} (pelo opguide)`, opguide: [...viaOpg].join(', ') })
  else {
    if (op && viaOpg.size && !viaOpg.has(norm(op.id)))
      review.onePace.push({ n, onepace: op.id, opguide: [...viaOpg].join(', ') })
    // sem One Pace por ainda não ter saído (opguide "arco-0" = a lançar; capítulos além do One Pace) não entra
    const unreleased = [...viaOpg].every((id) => id.endsWith('-0')) || chapters.every((k) => k > lastOpChapter)
    if (!op && chapters.length && flag !== 'f' && !unreleased)
      review.onePace.push({ n, onepace: null, opguide: [...viaOpg].join(', ') || null })
  }

  // local
  const place = placeAt(n)
  if (c) {
    const hits = {}
    const text = section(c, 'Short Summary') + section(c, 'Long Summary')
    for (const t of new Set(linkTargets(text))) {
      const id = placeByWiki[t]
      if (id) hits[id] = (hits[id] ?? 0) + 1
    }
    const best = Object.entries(hits).sort((a, b) => b[1] - a[1])[0]
    if (place !== 'mar' && Object.keys(hits).length && !hits[place] && best[1] >= 2)
      review.place.push({ n, place, wiki: hits })
    if (place === 'mar' && best && best[1] >= 3) review.place.push({ n, place, wiki: hits })
  }

  // "Título (sub); Outro (dub)" → o primeiro
  const title = c ? plain(field(c, 'English') || field(c, 'Translation')).split(/\s*\((?:sub|dub)\)/)[0].trim() : `Episode ${n}`
  const ep = { n, title: { en: title }, arc, place: place === 'mar' ? null : place }
  if (chapters.length) ep.chapters = chapters
  if (onePace) ep.onePace = onePace
  if (tags.length) ep.tags = tags
  episodes.push(ep)
}

// "mar": entre o local anterior e o próximo
let last = curated.start
for (const e of episodes) {
  if (e.place) last = e.place
  else e.sea = [last, null]
}
let next = null
for (const e of [...episodes].reverse()) {
  if (e.place) next = e.place
  else e.sea[1] = next
}

// faixa de episódios de cada arco; arco de filler = mais da metade dos episódios é filler
const fillerCount = {}
for (const e of episodes) {
  const a = arcs.get(e.arc)
  a.episodes = a.episodes ? [a.episodes[0], e.n] : [e.n, e.n]
  fillerCount[e.arc] = (fillerCount[e.arc] ?? 0) + (e.tags?.includes('filler') ? 1 : 0)
}
for (const a of arcs.values()) {
  const total = episodes.filter((e) => e.arc === a.id).length
  a.filler = fillerCount[a.id] > total / 2
}

const places = {}
for (const [id, p] of Object.entries(curated.places)) places[id] = { name: p.name, region: p.region, ...(p.kind && { kind: p.kind }) }
// routeOrigin: onde o navio começa no mapa, antes do ep. 1 (não é o local de nenhum episódio)
const out = {
  generated: new Date().toISOString().slice(0, 10),
  sources: { opguide: opg.generatedAt },
  routeOrigin: curated.start,
  arcs: [...arcs.values()],
  places,
  episodes,
}

// ---------- Validação estrutural (falha o build) ----------
{
  const erros = []
  const arcIds = new Set(out.arcs.map((a) => a.id))
  if (!places[out.routeOrigin]) erros.push(`routeOrigin ${out.routeOrigin} não está em places`)
  if (episodes.length !== N) erros.push(`${episodes.length} episódios, esperado ${N}`)
  episodes.forEach((e, i) => {
    if (e.n !== i + 1) erros.push(`episódio na posição ${i + 1} é o ${e.n} (duplicado ou faltando)`)
    if (!arcIds.has(e.arc)) erros.push(`ep. ${e.n}: arco ${e.arc} não existe`)
    if (e.place && !places[e.place]) erros.push(`ep. ${e.n}: local ${e.place} não existe`)
    if (!e.place && !(e.sea?.length === 2 && e.sea.every((p) => places[p]))) erros.push(`ep. ${e.n}: sea inválido ${JSON.stringify(e.sea)}`)
    if (e.place && e.sea) erros.push(`ep. ${e.n}: tem place e sea`)
    if (!e.title?.en) erros.push(`ep. ${e.n}: sem título`)
  })
  for (const a of out.arcs) {
    const ns = episodes.filter((e) => e.arc === a.id).map((e) => e.n)
    if (!ns.length) erros.push(`arco ${a.id} sem episódios`)
    else if (a.episodes[0] !== ns[0] || a.episodes[1] !== ns.at(-1)) erros.push(`arco ${a.id}: faixa ${a.episodes} ≠ ${ns[0]}–${ns.at(-1)}`)
  }
  if (erros.length) {
    console.error('validação falhou:\n' + erros.join('\n'))
    process.exit(1)
  }
  console.log('validação: ok (episódios 1–' + N + ' sem lacuna, arcos, locais, sea e faixas dos arcos)')
}
await writeFile('src/data/episodes.json', JSON.stringify(out) + '\n')

// ---------- Relatório de revisão ----------
const L = []
L.push('# Revisão dos episódios', '')
L.push(`Gerado por \`scripts/build-episodes.mjs\` em ${out.generated}. Não edite: corrija \`geo/episode-places.json\` e rode de novo.`, '')
L.push(`${N} episódios, ${arcs.size} arcos (${[...arcs.values()].filter((a) => a.filler).length} de filler), ${episodes.filter((e) => e.onePace).length} com One Pace, ${episodes.filter((e) => e.tags?.includes('filler')).length} fillers, ${episodes.filter((e) => e.tags?.includes('recap')).length} recaps, ${episodes.filter((e) => !e.place).length} no mar.`, '')
L.push('## Locais por trecho', '', '| Episódios | Local | Arcos |', '| --- | --- | --- |')
for (let k = 0; k < curated.segments.length; k++) {
  const [a, id] = curated.segments[k]
  const b = (curated.segments[k + 1]?.[0] ?? N + 1) - 1
  const arcNames = [...new Set(episodes.slice(a - 1, b).map((e) => arcs.get(e.arc).name.en))].join(', ')
  const nome = id === 'mar' ? `mar (${episodes[a - 1].sea.join(' → ')})` : curated.places[id].name.pt
  L.push(`| ${a === b ? a : `${a}–${b}`} | ${nome} | ${arcNames} |`)
}
L.push('', '## Arcos com mais de um local', '')
L.push('A regra é um local por arco; aqui ficam os arcos que mudam de local no meio (em geral um arco de filler encaixado dentro de outro).', '')
const multi = L.length
L.push('| Arco | Episódios | Locais |', '| --- | --- | --- |')
for (const a of arcs.values()) {
  const runs = []
  for (const e of episodes.filter((x) => x.arc === a.id)) {
    const p = e.place ?? 'mar'
    if (runs.at(-1)?.p === p) runs.at(-1).b = e.n
    else runs.push({ p, a: e.n, b: e.n })
  }
  if (runs.length > 1)
    L.push(`| ${a.name.en} | ${a.episodes.join('–')} | ${runs.map((r) => `${r.p} (${r.a === r.b ? r.a : `${r.a}–${r.b}`})`).join(', ')} |`)
}
if (L.length === multi + 2) L.splice(multi, 2, 'Nenhum: cada arco fica num local só.')
L.push('', '## Local: o trecho diz uma coisa, a sinopse da Wiki outra', '')
L.push('Links de locais na sinopse (curta + longa) que não batem com o local do trecho. Muitos são flashbacks ou cenas de outros personagens; só vale corrigir quando o Luffy está mesmo em outro lugar.', '')
L.push('| Ep | Trecho | Locais citados na Wiki | Título |', '| --- | --- | --- | --- |')
for (const r of review.place)
  L.push(`| ${r.n} | ${r.place} | ${Object.entries(r.wiki).map(([k, v]) => `${k} (${v})`).join(', ')} | ${episodes[r.n - 1].title.en} |`)
L.push('', '## Arco: Wiki × capítulos (divisão do One Pace)', '')
L.push('A Wiki (anime oficial) e o One Pace dividem alguns arcos em pontos diferentes. O site usa o arco da Wiki; isto é só para conferência.', '')
const groups = []
for (const r of review.arc) {
  const g = groups.at(-1)
  if (g && g.wiki === r.wiki && g.chapters === r.chapters && g.b === r.n - 1) g.b = r.n
  else groups.push({ a: r.n, b: r.n, wiki: r.wiki, chapters: r.chapters })
}
L.push('| Episódios | Wiki | Capítulos |', '| --- | --- | --- |')
for (const g of groups) L.push(`| ${g.a === g.b ? g.a : `${g.a}–${g.b}`} | ${g.wiki} | ${g.chapters} |`)
L.push('', '## One Pace: onepace.net × opguide', '')
L.push('Episódios canônicos sem One Pace, ou em que o onepace.net e o opguide apontam arcos diferentes.', '')
L.push('| Ep | onepace.net | opguide |', '| --- | --- | --- |')
for (const r of review.onePace) L.push(`| ${r.n} | ${r.onepace ?? '—'} | ${r.opguide ?? '—'} |`)
if (review.missing.length) L.push('', `Sem página na Wiki: ${review.missing.join(', ')}`)
await writeFile('docs/revisao-episodios.md', L.join('\n') + '\n')

console.log(`ok: ${N} episódios, ${arcs.size} arcos, ${opEps.length} episódios do One Pace`)
console.log(`revisão: ${review.place.length} locais, ${groups.length} trechos de arco, ${review.onePace.length} One Pace, ${review.missing.length} sem Wiki`)
