// Passo 3 do pipeline do mapa: rota do navio pelo mar, na ordem dos episódios.
//
// As paradas vêm de src/data/episodes.json: uma por trecho de episódios seguidos no mesmo local
// (começando em routeOrigin, Foosha); os episódios no mar param no meio do caminho entre o local
// de antes e o de depois. Duas pernas são especiais: a travessia da Reverse Mountain (sobe pelo
// canal do East Blue e desce pelas cachoeiras, com a altura da água em y) e a passagem para a
// Ilha dos Tritões (mergulha por baixo da Red Line da borda leste e sai na borda oeste; `jump`).
//
// Cada local é um pixel no print da sua região → pixel do mapa → mundo (com a escala da ilha,
// src/data/islands.json). O porto é o ponto de mar mais próximo com folga PORT_CLEAR da costa.
// Entre portos consecutivos, A* na distância até a costa (public/terrain/coast.png): passar a
// menos de MIN_CLEAR é proibido e a menos de WANT_CLEAR custa mais, para a rota ficar em mar
// aberto. Depois os pontos são enxugados (atalhos em linha reta que não chegam mais perto da
// costa do que o caminho original), as quinas arredondadas e tudo reamostrado em passos iguais.
//
// Entrada: geo/places.json, src/data/episodes.json, geo/geography.json, reference/regions/align.json,
//          coast.png, canals.json, islands.json
// Saída:   src/data/route.json (places, stops, legs; legs[i] vai de stops[i] a stops[i + 1]; pontos
//          [x, z] ou [x, z, y]) e src/data/places.json (todos os locais com posição, para os nomes)
// Conferência: node scripts/route-overlay.mjs
//
// Uso: node scripts/build-route.mjs   (depois de npm run geo:terrain)
import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { printTransforms } from './lib/regions.mjs'

const geo = JSON.parse(await readFile('geo/geography.json', 'utf8'))
const align = JSON.parse(await readFile('reference/regions/align.json', 'utf8'))
const { places } = JSON.parse(await readFile('geo/places.json', 'utf8'))
const meta = JSON.parse(await readFile('src/data/terrain-meta.json', 'utf8'))
const islandData = JSON.parse(await readFile('src/data/islands.json', 'utf8'))
const T = printTransforms(geo, align)

const WORLD_W = meta.world.width, WORLD_H = meta.world.height
const PORT_CLEAR = 2.6 // unidades: o navio parado (~2,7, e girando no porto) não encosta na praia
const MIN_CLEAR = 0.7 // navegando o navio encolhe (~1 unidade)
const WANT_CLEAR = 3

// ---------- Mapa → mundo (igual a src/world/coords.ts) ----------
const pxToWorld = (px, py) => [(px / meta.pixels.width) * WORLD_W - WORLD_W / 2, (py / meta.pixels.height) * WORLD_H - WORLD_H / 2]
function mapPxToWorld(px, py) {
  let best, bestArea = Infinity
  for (const isl of islandData.islands) {
    const [x0, y0, x1, y1] = isl.box
    if (px < x0 - 3 || px > x1 + 3 || py < y0 - 3 || py > y1 + 3) continue
    const area = (x1 - x0 + 1) * (y1 - y0 + 1)
    if (area < bestArea) { best = isl; bestArea = area }
  }
  if (!best) return pxToWorld(px, py)
  const [cx, cy] = best.c
  return pxToWorld(cx + (px - cx) * best.s, cy + (py - cy) * best.s)
}

// ---------- Distância até a costa, em unidades, num grid ----------
const { data: coastRaw, info } = await sharp('public/terrain/coast_sm.png').greyscale().raw().toBuffer({ resolveWithObject: true })
const GW = info.width, GH = info.height
const CELL = WORLD_W / GW // unidades por célula
const clearance = new Float32Array(GW * GH)
// coast.png guarda min(dist, maxPx)/maxPx em 0..255, com dist em px da textura cheia.
for (let i = 0; i < clearance.length; i++) clearance[i] = (coastRaw[i] / 255) * (meta.coast.maxPx / meta.coast.pxPerUnit)
const MAX_CLEAR = meta.coast.maxPx / meta.coast.pxPerUnit
const toCell = ([x, z]) => [Math.round(((x + WORLD_W / 2) / WORLD_W) * GW - 0.5), Math.round(((z + WORLD_H / 2) / WORLD_H) * GH - 0.5)]
const toWorld = (cx, cy) => [((cx + 0.5) / GW) * WORLD_W - WORLD_W / 2, ((cy + 0.5) / GH) * WORLD_H - WORLD_H / 2]
const clearAt = (cx, cy) => (cx < 0 || cy < 0 || cx >= GW || cy >= GH ? 0 : clearance[cy * GW + cx])

/** Célula de mar mais próxima de `p` com pelo menos `need` de folga. */
function nearestWater(p, need) {
  const [px, py] = toCell(p)
  for (let r = 0; r < 200; r++) {
    let best = null, bestD = Infinity
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (clearAt(px + dx, py + dy) < need) continue
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; best = [px + dx, py + dy] }
      }
    }
    if (best) return best
  }
  throw new Error(`sem mar perto de ${p}`)
}

// ---------- A* ----------
const stepCost = (c) => 1 + 6 * Math.max(0, (WANT_CLEAR - c) / WANT_CLEAR) ** 2
function astar([sx, sy], [tx, ty]) {
  const N = GW * GH
  const g = new Float32Array(N).fill(Infinity)
  const from = new Int32Array(N).fill(-1)
  const closed = new Uint8Array(N)
  const heap = [] // [f, idx]
  const push = (f, i) => {
    heap.push([f, i])
    let k = heap.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (heap[p][0] <= heap[k][0]) break
      ;[heap[p], heap[k]] = [heap[k], heap[p]]
      k = p
    }
  }
  const pop = () => {
    const top = heap[0], last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let k = 0
      for (;;) {
        const l = 2 * k + 1, r = l + 1
        let m = k
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === k) break
        ;[heap[m], heap[k]] = [heap[k], heap[m]]
        k = m
      }
    }
    return top
  }
  const h = (x, y) => Math.hypot(x - tx, y - ty)
  const s = sy * GW + sx, t = ty * GW + tx
  g[s] = 0
  push(h(sx, sy), s)
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]
  while (heap.length) {
    const [, i] = pop()
    if (closed[i]) continue
    closed[i] = 1
    if (i === t) break
    const x = i % GW, y = (i - x) / GW
    for (const [dx, dy, len] of D) {
      const nx = x + dx, ny = y + dy
      const c = clearAt(nx, ny)
      if (c < MIN_CLEAR) continue
      const j = ny * GW + nx
      const ng = g[i] + len * stepCost(c)
      if (ng < g[j]) {
        g[j] = ng
        from[j] = i
        push(ng + h(nx, ny), j)
      }
    }
  }
  if (from[t] < 0) throw new Error('rota sem caminho pelo mar')
  const path = []
  for (let i = t; i >= 0; i = from[i]) path.push([i % GW, (i - (i % GW)) / GW])
  return path.reverse()
}

/** Enxuga o caminho: pula pontos enquanto a reta não chega mais perto da costa que o trecho original. */
function simplify(path) {
  const out = [path[0]]
  let i = 0
  while (i < path.length - 1) {
    let best = i + 1
    let minOrig = Math.min(clearAt(...path[i]), clearAt(...path[i + 1]))
    for (let j = i + 2; j < path.length; j++) {
      minOrig = Math.min(minOrig, clearAt(...path[j]))
      const need = Math.min(minOrig, WANT_CLEAR) - 0.05
      const [ax, ay] = path[i], [bx, by] = path[j]
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2)
      let ok = true
      for (let q = 1; q < n && ok; q++) ok = clearAt(Math.round(ax + ((bx - ax) * q) / n), Math.round(ay + ((by - ay) * q) / n)) >= need
      if (ok) best = j
    }
    out.push(path[best])
    i = best
  }
  return out
}

/**
 * Arredonda as quinas (Chaikin, 3 passadas) e reamostra a cada ~STEP unidades. O corte de cada
 * quina tem tamanho máximo CUT, e só é aceito se os pontos novos continuam com folga da costa.
 */
const CUT = 2.5
const STEP = 1
const clearAtWorld = (p) => clearAt(...toCell(p))
const smoothPath = (pts) => resample(chaikin(pts))
function chaikin(pts) {
  for (let pass = 0; pass < 3; pass++) {
    const out = [pts[0]]
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1]
      const la = Math.hypot(b[0] - a[0], b[1] - a[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1])
      const ka = Math.min(0.25, CUT / la), kc = Math.min(0.25, CUT / lc)
      const p = [b[0] + (a[0] - b[0]) * ka, b[1] + (a[1] - b[1]) * ka]
      const q = [b[0] + (c[0] - b[0]) * kc, b[1] + (c[1] - b[1]) * kc]
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
      if (clearAtWorld(mid) >= MIN_CLEAR + 0.3) out.push(p, q)
      else out.push(b)
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  return pts
}

/** Reamostra em passos iguais (a curva do app fica com velocidade e giro uniformes). Pontos 2D ou 3D. */
const dist = (a, b) => Math.hypot(...a.map((v, k) => b[k] - v))
const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t)
function resample(pts) {
  const res = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const len = dist(a, b)
    let t = STEP - carry
    while (t < len) {
      res.push(lerp(a, b, t / len))
      t += STEP
    }
    carry = len - (t - STEP)
  }
  const last = pts[pts.length - 1]
  if (dist(last, res[res.length - 1]) < STEP * 0.5) res.pop()
  res.push(last)
  return res
}
const pathLength = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)

// ---------- Locais: posição no mundo ----------
// Todos os locais com posição (não só os da rota), também para os nomes no mapa (PlaceLabels).
// O encaixe dos prints da Grand Line erra alguns px: um local canônico que cai no mar perto de
// uma ilha (até SNAP px do mapa) vai para a borda dessa ilha, para o pino ficar em cima dela
// e acompanhar o crescimento da ilha. Fillers não grudam (alguns são pontos no mar de propósito).
const SNAP = 18
const NO_SNAP = new Set(['skypiea']) // marcador no céu, acima de Jaya
function snapToIsland([px, py]) {
  let best = null, bestD = SNAP
  for (const isl of islandData.islands) {
    const [x0, y0, x1, y1] = isl.box
    const dx = Math.max(x0 - px, 0, px - x1), dy = Math.max(y0 - py, 0, py - y1)
    const d = Math.hypot(dx, dy)
    if (d === 0) return [px, py]
    if (d < bestD) { bestD = d; best = [Math.min(Math.max(px, x0), x1), Math.min(Math.max(py, y0), y1)] }
  }
  return best ?? [px, py]
}
const all = {}
for (const [id, p] of Object.entries(places)) {
  if (!p.px) continue
  const t = T[p.region]
  if (!t) throw new Error(`região desconhecida: ${p.region}`)
  let m = [t.sx * p.px[0] + t.tx, t.sy * p.px[1] + t.ty]
  if (p.kind !== 'filler' && !NO_SNAP.has(id)) {
    const s = snapToIsland(m)
    if (s[0] !== m[0] || s[1] !== m[1]) console.log(`  ${id}: grudado na ilha (${Math.hypot(s[0] - m[0], s[1] - m[1]).toFixed(1)} px)`)
    m = s
  }
  all[id] = { name: p.name, ...(p.kind && { kind: p.kind }), town: mapPxToWorld(...m) }
}
const r2 = (p) => p.map((v) => +v.toFixed(2))
await writeFile('src/data/places.json', JSON.stringify(Object.fromEntries(Object.entries(all).map(([id, p]) => [id, { ...p, town: r2(p.town) }]))) + '\n')
console.log(`src/data/places.json: ${Object.keys(all).length} locais`)

// ---------- Paradas: a ordem dos episódios ----------
// Uma parada por trecho de episódios seguidos no mesmo local (src/data/episodes.json). Os
// episódios no mar (place null, sea [antes, depois]) param no meio do caminho entre os dois.
const eps = JSON.parse(await readFile('src/data/episodes.json', 'utf8'))
const stops = [{ key: eps.routeOrigin, place: eps.routeOrigin, episodes: null }]
for (const ep of eps.episodes) {
  const key = ep.place ?? `mar:${ep.sea.join('>')}`
  const last = stops[stops.length - 1]
  if (last.key === key) last.episodes[1] = ep.n
  else stops.push({ key, ...(ep.place ? { place: ep.place } : { sea: ep.sea }), episodes: [ep.n, ep.n] })
}
for (const s of stops) if (s.place && !all[s.place]) throw new Error(`local sem posição em geo/places.json: ${s.place}`)

// ---------- Canais da Reverse Mountain (public/terrain/canals.json, do build-terrain) ----------
// Linha do meio de cada canal, do topo até o mar, com a altura da água: [x, z, y].
const canalData = JSON.parse(await readFile('public/terrain/canals.json', 'utf8'))
const canalLine = (c) => {
  const v = c.verts, pts = []
  for (let k = 0; k + 9 < v.length; k += 10) pts.push([(v[k] + v[k + 5]) / 2, (v[k + 2] + v[k + 7]) / 2, (v[k + 1] + v[k + 6]) / 2])
  return pts
}
const DOWN = canalLine(canalData.canals.find((c) => c.down)) // desce para a Grand Line (Paradise)
// Canal que sobe do East Blue: o que termina mais perto de Loguetown.
const UP_EB = canalData.canals
  .filter((c) => !c.down)
  .map(canalLine)
  .sort((a, b) => dist(a.at(-1).slice(0, 2), all.loguetown.town) - dist(b.at(-1).slice(0, 2), all.loguetown.town))[0]
/** Ponto no mar em frente à boca do canal (`k` unidades para fora). */
const mouthOut = (line, k) => {
  const end = line.at(-1), prev = line.at(-6)
  const d = dist(end.slice(0, 2), prev.slice(0, 2))
  return [end[0] + ((end[0] - prev[0]) / d) * k, end[1] + ((end[1] - prev[1]) / d) * k]
}

// ---------- Portos ----------
// O porto é o ponto de mar mais próximo da cidade com folga PORT_CLEAR da costa. A parada da
// Reverse Mountain é no mar ao pé das cachoeiras (Twin Cape, onde está o Laboon).
const port = {}
for (const s of stops) {
  if (!s.place || port[s.place]) continue
  const from = s.place === 'reverse-mountain' ? mouthOut(DOWN, PORT_CLEAR + 1.5) : all[s.place].town
  port[s.place] = toWorld(...nearestWater(from, PORT_CLEAR))
}
// Paradas seguidas com portos a menos de STAY_DIST (ex.: Ilha dos Tritões → Mar de Maubeugemour)
// dividem o porto: o navio não fica dando voltinhas em torno da mesma ilha.
const STAY_DIST = 5
for (let i = 1; i < stops.length; i++) {
  const a = stops[i - 1].place, b = stops[i].place
  if (a && b && a !== b && dist(port[a], port[b]) < STAY_DIST) {
    console.log(`  ${b}: usa o porto de ${a} (${dist(port[a], port[b]).toFixed(1)} unidades)`)
    port[b] = port[a]
  }
}

// ---------- Pernas ----------
/** Caminho pelo mar de `a` a `b` (A* → enxuga → arredonda → reamostra), pontos [x, z]. */
function seaPath(a, b) {
  const raw = simplify(astar(nearestWater(a, MIN_CLEAR), nearestWater(b, MIN_CLEAR))).map(([x, y]) => toWorld(x, y))
  raw[0] = a
  raw[raw.length - 1] = b
  return straightEnds(chaikin(raw))
}

/**
 * Entrada e saída do porto em linha reta: troca os primeiros e os últimos ~END_STRAIGHT unidades
 * do caminho por uma reta, se ela não chega perto da costa. Sem isso o caminho faz curvas fechadas
 * bem na chegada, e o navio, já freando, gira no lugar.
 */
const END_STRAIGHT = 6
function straightOk(a, b) {
  const n = Math.ceil(dist(a, b) / (CELL * 0.5))
  for (let q = 1; q < n; q++) if (clearAtWorld(lerp(a, b, q / n)) < MIN_CLEAR + 0.3) return false
  return true
}
function straightStart(pts) {
  let acc = 0, best = 1
  for (let k = 1; k < pts.length - 1; k++) {
    acc += dist(pts[k - 1], pts[k])
    if (acc > END_STRAIGHT) break
    if (straightOk(pts[0], pts[k])) best = k
  }
  return [pts[0], ...pts.slice(best)]
}
const straightEnds = (pts) => straightStart(straightStart(pts).reverse()).reverse()

/**
 * Travessia da Reverse Mountain: do East Blue até a boca do canal, sobe por ele até a piscina do
 * topo e desce pelo canal das cachoeiras até o mar da Grand Line. Pontos [x, z, y] (y = altura da água).
 */
const flat = (pts) => pts.map(([x, z]) => [x, z, 0])
function reverseMountain(a, b) {
  const approach = mouthOut(UP_EB, 2.5)
  return [
    ...flat(seaPath(a, approach)),
    ...[...UP_EB].reverse(),
    ...DOWN,
    ...flat(seaPath(mouthOut(DOWN, 2.5), b)),
  ]
}

/**
 * Passagem para a Ilha dos Tritões: o navio vai até a Red Line da borda leste, mergulha por baixo
 * dela (y até -DIVE) e sai do outro lado do mapa (borda oeste), na mesma altura. Devolve as duas
 * partes. Pontos [x, z, y].
 */
const DIVE = 3
function underRedLine(a, b) {
  const z = b[1]
  const [, cy] = toCell([0, z])
  let xr = GW - 1, xl = 0
  while (xr > 0 && clearAt(xr, cy) < WANT_CLEAR) xr--
  while (xl < GW - 1 && clearAt(xl, cy) < WANT_CLEAR) xl++
  const east = toWorld(xr, cy), west = toWorld(xl, cy)
  // Porto entre a borda e o primeiro mar aberto: vai direto, sem passar dele e voltar.
  const arrive = b[0] <= west[0] ? [[b[0], b[1], 0]] : flat(seaPath(west, b))
  return [
    [...flat(seaPath(a, east)), [WORLD_W / 2, z, -DIVE]],
    [[-WORLD_W / 2, z, -DIVE], ...arrive],
  ]
}

/** Divide um caminho na metade do comprimento (parada no mar). */
function splitHalf(pts) {
  const half = pathLength(pts) / 2
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (acc + d >= half) {
      const mid = lerp(pts[i - 1], pts[i], (half - acc) / d)
      return [[...pts.slice(0, i), mid], [mid, ...pts.slice(i)]]
    }
    acc += d
  }
}

// Cada perna é calculada uma vez por par de locais (a volta reaproveita a ida, invertida).
const cache = new Map()
function legPath(from, to) {
  const key = `${from}>${to}`
  if (cache.has(key)) return cache.get(key)
  const back = cache.get(`${to}>${from}`)
  let parts
  if (dist(port[from], port[to]) < 0.01) parts = [[port[from]]] // mesmo porto: o navio fica
  else if (back) parts = [...back].reverse().map((p) => [...p].reverse())
  else if (to === 'reverse-mountain') parts = [reverseMountain(port[from], port[to])]
  else if (to === 'fishman-island') parts = underRedLine(port[from], port[to])
  else parts = [seaPath(port[from], port[to])]
  cache.set(key, parts)
  return parts
}

/**
 * Junta as partes numa perna: pontos reamostrados e `jump` = índice onde o navio troca de borda.
 * Uma perna parada (`stay`, um ponto só) = a parada seguinte é no mesmo lugar.
 */
function makeLeg(from, to, parts) {
  if (parts.length === 1 && parts[0].length === 1) return { from, to, length: 0, stay: true, points: [r2(parts[0][0].slice(0, 2))] }
  const sampled = parts.map((p) => resample(p).map(r2))
  const points = sampled.flat()
  const leg = { from, to, length: +sampled.reduce((s, p) => s + pathLength(p), 0).toFixed(1), points }
  if (sampled.length > 1) leg.jump = sampled[0].length
  return leg
}

const SEA_MIN = 8 // parada no mar a menos disso do porto de antes fica no porto
const legs = []
for (let i = 0; i < stops.length - 1; i++) {
  const a = stops[i], b = stops[i + 1]
  if (b.sea) continue // feita junto com a perna seguinte
  if (a.sea) {
    const [before, after] = a.sea
    const parts = legPath(before, after)
    if (parts.length > 1) throw new Error(`parada no mar numa travessia: ${a.key}`)
    if (pathLength(parts[0]) / 2 < SEA_MIN) {
      // Meio do caminho colado na ilha de antes: o navio fica no porto e só sai depois.
      a.at = r2(port[before])
      legs.push(makeLeg(before, a.key, [[port[before]]]), makeLeg(a.key, b.place, parts))
      continue
    }
    const [p1, p2] = splitHalf(parts[0])
    a.at = r2(p1.at(-1).slice(0, 2))
    legs.push(makeLeg(before, a.key, [p1]), makeLeg(a.key, b.place, [p2]))
  } else legs.push(makeLeg(a.place, b.place, legPath(a.place, b.place)))
}
for (const s of stops) if (s.place) s.at = r2(port[s.place])

// Conferência: nenhum ponto no mar pode chegar a menos de MIN_CLEAR da costa (os canais e o
// mergulho por baixo da Red Line, os pontos com y ≠ 0, ficam de fora).
for (const l of legs) {
  let worst = Infinity, at = null
  l.points.forEach((p, i) => {
    if ((p[2] ?? 0) !== 0) return
    const c = clearAtWorld(p)
    if (c < worst) { worst = c; at = i }
  })
  if (worst < MIN_CLEAR - 0.15) console.warn(`  AVISO ${l.from} → ${l.to}: ponto ${at} a ${worst.toFixed(2)} da costa (${l.points[at]})`)
}
for (const l of legs) console.log(`${l.from} → ${l.to}: ${l.length} unidades, ${l.points.length} pontos${l.jump ? ', troca de borda' : ''}`)

const out = {
  places: Object.fromEntries(Object.keys(port).map((id) => [id, { name: all[id].name, town: r2(all[id].town), port: r2(port[id]) }])),
  // stops[i] → stops[i + 1] = legs[i]
  stops: stops.map(({ place, sea, episodes, at }) => ({ ...(place ? { place } : { sea }), episodes, at })),
  legs,
}
await writeFile('src/data/route.json', JSON.stringify(out) + '\n')
console.log(`src/data/route.json: ${out.stops.length} paradas, ${legs.length} pernas`)
console.log(`MAX_CLEAR da textura: ${MAX_CLEAR.toFixed(2)} unidades`)
