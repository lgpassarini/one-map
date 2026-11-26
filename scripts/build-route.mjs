// Passo 3 do pipeline do mapa: rota do navio pelo mar, entre os locais de geo/places.json.
//
// Cada local é um pixel no print da sua região → pixel do mapa → mundo (com a escala da ilha,
// src/data/islands.json). O porto é o ponto de mar mais próximo com folga PORT_CLEAR da costa.
// Entre portos consecutivos, A* na distância até a costa (public/terrain/coast.png): passar a
// menos de MIN_CLEAR é proibido e a menos de WANT_CLEAR custa mais, para a rota ficar em mar
// aberto. Depois os pontos são enxugados (atalhos em linha reta que não chegam mais perto da
// costa do que o caminho original), as quinas arredondadas e tudo reamostrado em passos iguais.
//
// Entrada: geo/places.json, geo/geography.json, reference/regions/align.json, coast.png, islands.json
// Saída:   src/data/route.json e src/data/places.json (todos os locais com posição, para os nomes)
//
// Uso: node scripts/build-route.mjs   (depois de npm run geo:terrain)
import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { printTransforms } from './lib/regions.mjs'

const geo = JSON.parse(await readFile('geo/geography.json', 'utf8'))
const align = JSON.parse(await readFile('reference/regions/align.json', 'utf8'))
const { places, route } = JSON.parse(await readFile('geo/places.json', 'utf8'))
const meta = JSON.parse(await readFile('src/data/terrain-meta.json', 'utf8'))
const islandData = JSON.parse(await readFile('src/data/islands.json', 'utf8'))
const T = printTransforms(geo, align)

const WORLD_W = meta.world.width, WORLD_H = meta.world.height
const PORT_CLEAR = 2.1 // unidades: o navio parado (~2,2, e girando no porto) não encosta na praia
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
function smoothPath(pts) {
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
  // Reamostra em passos iguais (a curva do app fica com velocidade e giro uniformes).
  const res = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i]
    const len = Math.hypot(bx - ax, bz - az)
    let t = STEP - carry
    while (t < len) {
      res.push([ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len])
      t += STEP
    }
    carry = len - (t - STEP)
  }
  const last = pts[pts.length - 1]
  const tail = res[res.length - 1]
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) < STEP * 0.5) res.pop()
  res.push(last)
  return res
}

// ---------- Monta ----------
const out = { places: {}, legs: [] }
for (const id of route) {
  const p = places[id]
  const t = T[p.region]
  if (!t) throw new Error(`região desconhecida: ${p.region}`)
  const town = mapPxToWorld(t.sx * p.px[0] + t.tx, t.sy * p.px[1] + t.ty)
  const port = toWorld(...nearestWater(town, PORT_CLEAR))
  out.places[id] = { name: p.name, town: town.map((v) => +v.toFixed(2)), port: port.map((v) => +v.toFixed(2)) }
}
for (let k = 0; k < route.length - 1; k++) {
  const a = out.places[route[k]], b = out.places[route[k + 1]]
  const path = simplify(astar(toCell(a.port), toCell(b.port)))
  const raw = path.map(([x, y]) => toWorld(x, y))
  raw[0] = a.port
  raw[raw.length - 1] = b.port
  const points = smoothPath(raw).map((p) => p.map((v) => +v.toFixed(2)))
  let len = 0
  for (let q = 1; q < points.length; q++) len += Math.hypot(points[q][0] - points[q - 1][0], points[q][1] - points[q - 1][1])
  out.legs.push({ from: route[k], to: route[k + 1], length: +len.toFixed(1), points })
  console.log(`${route[k]} → ${route[k + 1]}: ${len.toFixed(1)} unidades, ${points.length} pontos`)
}
await writeFile('src/data/route.json', JSON.stringify(out) + '\n')

// Todos os locais com posição (não só os da rota), para os nomes no mapa (PlaceLabels).
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
  const town = mapPxToWorld(...m)
  all[id] = { name: p.name, ...(p.kind && { kind: p.kind }), town: town.map((v) => +v.toFixed(2)) }
}
await writeFile('src/data/places.json', JSON.stringify(all) + '\n')
console.log(`src/data/places.json: ${Object.keys(all).length} locais`)
console.log(`MAX_CLEAR da textura: ${MAX_CLEAR.toFixed(2)} unidades`)
