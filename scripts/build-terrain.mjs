// Passo 2 do pipeline do mapa: contornos (geo/geography.json) → geometria 3D cartoon.
//
// Cada platô é uma peça extrudada a partir do seu contorno vetorial, empilhadas como papel
// recortado (bordas nítidas em qualquer zoom). A Red Line e a Reverse Mountain usam o mesmo
// sistema e a mesma paleta.
//
// Escala: o mapa é "espaçado" (MAP_SCALE) sem que as ilhas cresçam na mesma proporção
// (ISLAND_SCALE, em volta do centro de cada ilha), para os mares terem espaço e o navio caber.
//
// Gera em public/terrain/:
//   terrain.bin   malha (triângulos): posições float32 + cores uint8, seguidas das linhas de contorno
//   canals.json   faixas de água dos canais da Reverse Mountain (posição, fluxo, sentido) e a piscina do topo
//   coast.png     distância até a costa no mundo final, para o oceano; + coast_sm.png
// e em src/data/: terrain-meta.json (mundo, contagens) e islands.json (centro/caixa de cada ilha,
// para posicionar locais dentro das ilhas).
//
// Uso: node scripts/build-terrain.mjs
import sharp from 'sharp'
import * as THREE from 'three'
import { contours } from 'd3-contour'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { blur, close, components, edt } from './lib/raster.mjs'
import { fbm, valueNoise } from './lib/noise.mjs'

const geo = JSON.parse(await readFile('geo/geography.json', 'utf8'))
const { width: w, height: h, cutX } = geo
const OUT = 'public/terrain'

// ---------- Escalas ----------
const MAP_SCALE = 2 // espaçamento do mapa (posições, mares, Red Line)
const ISLAND_SCALE = 1.25 // tamanho das ilhas em relação à referência
const RL_HEIGHT = 1.4 // a Red Line fica mais alta para acompanhar a largura maior
const WORLD_W = 200 * MAP_SCALE
const WORLD_H = (WORLD_W * h) / w
const PX = WORLD_W / w // unidades da cena por pixel da referência (escala do mapa)

const refX = (x) => (((x - cutX) % w) + w) % w
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const smooth = (a, b, t) => {
  const x = clamp01((t - a) / (b - a))
  return x * x * (3 - 2 * x)
}
const mapToWorld = (x, y) => [x * PX - WORLD_W / 2, y * PX - WORLD_H / 2]

// ---------- 1) Rasteriza ----------
function pathOf(polys) {
  return polys.map((poly) => poly.map((ring) => 'M' + ring.map((p) => p.join(',')).join('L') + 'Z').join('')).join('')
}
async function rasterizeSvg(paths, W, H) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/>${paths.map((d) => `<path d="${d}" fill="white" fill-rule="evenodd"/>`).join('')}</svg>`
  const raw = await sharp(Buffer.from(svg), { limitInputPixels: false }).greyscale().raw().toBuffer()
  const m = new Uint8Array(W * H)
  for (let i = 0; i < m.length; i++) m[i] = raw[i] > 127 ? 1 : 0
  return m
}
const land = await rasterizeSvg([pathOf(geo.land)], w, h)
const redline = await rasterizeSvg([pathOf(geo.redline)], w, h)

// ---------- 2) Reverse Mountain: topo e os 5 braços (canais) ----------
const RM_GUESS = [refX(2019), 1056]
const CANAL_HALF = 6 // px
const MOUNTAIN_R = 110 // px
const FALLS = 5
let summit, arms // arms[s] = { ux, uy, len }; s = 0 desce (leste, Paradise), 1..4 sobem
const canal = new Uint8Array(w * h)
{
  const closed = close(redline, w, h, 14)
  const cand = new Uint8Array(w * h)
  for (let i = 0; i < cand.length; i++) {
    const x = i % w
    const y = (i - x) / w
    const d = Math.hypot(x - RM_GUESS[0], y - RM_GUESS[1])
    if (!redline[i] && ((closed[i] && d < 900) || d < 45)) cand[i] = 1
  }
  const { labels } = components(cand, w, h)
  const id = labels[Math.round(RM_GUESS[1]) * w + Math.round(RM_GUESS[0])]
  if (id < 0) throw new Error('Reverse Mountain não encontrada')
  let sx = 0, sy = 0, n = 0
  for (let i = 0; i < cand.length; i++) {
    if (labels[i] !== id) continue
    const x = i % w
    const y = (i - x) / w
    if (Math.hypot(x - RM_GUESS[0], y - RM_GUESS[1]) < 45) { sx += x; sy += y; n++ }
  }
  summit = [sx / n, sy / n]
  const sectorOf = (dx, dy) =>
    Math.abs(Math.atan2(dy, dx)) < (25 * Math.PI) / 180 ? 0 : dx > 0 ? (dy < 0 ? 1 : 2) : dy < 0 ? 3 : 4
  const sum = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]
  for (let i = 0; i < cand.length; i++) {
    if (labels[i] !== id) continue
    const x = i % w
    const y = (i - x) / w
    const dx = x - summit[0], dy = y - summit[1]
    const r = Math.hypot(dx, dy)
    if (r < 60) continue
    const s = sectorOf(dx, dy)
    sum[s][0] += dx / r
    sum[s][1] += dy / r
  }
  const angle = sum.map(([x, y]) => Math.atan2(y, x))
  angle[1] = -angle[2] // braço NE tapado na referência pela rota pontilhada: espelha o SE
  angle[0] = 0 // canal que desce para a Grand Line: horizontal
  for (let i = 0; i < cand.length; i++) if (labels[i] === id) redline[i] = 1 // canais originais viram rocha
  arms = angle.map((a) => {
    const ux = Math.cos(a), uy = Math.sin(a)
    let r = 50
    for (; r < 1200; r++) {
      const x = Math.round(summit[0] + ux * r), y = Math.round(summit[1] + uy * r)
      if (x < 0 || y < 0 || x >= w || y >= h || !redline[y * w + x]) break
    }
    return { ux, uy, len: r + 6 }
  })
  const R = Math.max(...arms.map((e) => e.len)) + 10
  for (let y = Math.max(0, Math.floor(summit[1] - R)); y < Math.min(h, summit[1] + R); y++) {
    for (let x = Math.max(0, Math.floor(summit[0] - R)); x < Math.min(w, summit[0] + R); x++) {
      const dx = x - summit[0], dy = y - summit[1]
      for (const e of arms) {
        const t = dx * e.ux + dy * e.uy
        if (t >= 0 && t <= e.len && Math.abs(dx * e.uy - dy * e.ux) <= CANAL_HALF) {
          canal[y * w + x] = 1
          redline[y * w + x] = 0
          land[y * w + x] = 0
        }
      }
    }
  }
  console.log(`Reverse Mountain em (${summit.map((v) => v.toFixed(0))}); braços: ${arms.map((e) => e.len).join(', ')} px`)
}

// ---------- 3) Distâncias ----------
// Canais contam como "terra" aqui: assim a Red Line sobe reta desde a água do canal (paredão),
// sem formar uma prainha onde se veria o oceano por baixo da faixa de água.
const water = new Uint8Array(w * h)
for (let i = 0; i < w * h; i++) water[i] = land[i] || redline[i] || canal[i] ? 0 : 1
const distToWater = edt(water, w, h)

// ---------- 4) Ilhas: componentes, centro e bioma ----------
const islands = components(land, w, h)
const nIslands = islands.sizes.length
const centroid = new Float64Array(nIslands * 2)
const bbox = new Float64Array(nIslands * 4).fill(NaN)
// Cores das ilhas (do merge-regions: cores dos prints); sem ele, a referência original.
const refImg = await sharp(geo.colors ?? geo.source).resize(w, h).removeAlpha().raw().toBuffer()
const BIOME = { GRASS: 0, DESERT: 1, SNOW: 2, ROCK: 3 }
const islandBiome = new Uint8Array(nIslands)
{
  const acc = new Float64Array(nIslands * 4)
  for (let i = 0; i < w * h; i++) {
    const l = islands.labels[i]
    if (l < 0) continue
    const x = i % w
    const y = (i - x) / w
    centroid[l * 2] += x
    centroid[l * 2 + 1] += y
    const b = l * 4
    bbox[b] = Number.isNaN(bbox[b]) ? x : Math.min(bbox[b], x)
    bbox[b + 1] = Number.isNaN(bbox[b + 1]) ? y : Math.min(bbox[b + 1], y)
    bbox[b + 2] = Number.isNaN(bbox[b + 2]) ? x : Math.max(bbox[b + 2], x)
    bbox[b + 3] = Number.isNaN(bbox[b + 3]) ? y : Math.max(bbox[b + 3], y)
    const j = y * w + ((x + cutX) % w)
    const r = refImg[j * 3], g = refImg[j * 3 + 1], bl = refImg[j * 3 + 2]
    if (Math.max(r, g, bl) < 45) continue
    acc[l * 4] += r; acc[l * 4 + 1] += g; acc[l * 4 + 2] += bl; acc[l * 4 + 3]++
  }
  for (let l = 0; l < nIslands; l++) {
    centroid[l * 2] /= islands.sizes[l]
    centroid[l * 2 + 1] /= islands.sizes[l]
    const n = acc[l * 4 + 3] || 1
    const r = acc[l * 4] / n, g = acc[l * 4 + 1] / n, b = acc[l * 4 + 2] / n
    const max = Math.max(r, g, b)
    const sat = max - Math.min(r, g, b)
    islandBiome[l] =
      max > 175 && sat < 45 ? BIOME.SNOW : r > g + 4 && r > 130 && b > 70 ? BIOME.DESERT : r > g + 12 || sat < 22 ? BIOME.ROCK : BIOME.GRASS
  }
}
// ---------- 4b) Escala de cada ilha (piso de tamanho) ----------
// Em geral a ilha cresce ISLAND_SCALE em volta do seu centro. As pequenas crescem mais, até
// MIN_SIZE unidades (no máximo MAX_GROW vezes), para o navio caber; o crescimento para antes de
// encostar numa vizinha (ISLAND_GAP) ou na Red Line (RL_GAP).
const MIN_SIZE = 4 // unidades do mundo (maior lado da ilha)
const MAX_GROW = 3
const ISLAND_GAP = 7 // px da referência, depois de escalar
const RL_GAP = 10
const k = ISLAND_SCALE / MAP_SCALE
const islandK = new Float64Array(nIslands).fill(k)
{
  // Raio de cada ilha (px) e pixels da borda (para medir a distância até as vizinhas).
  const radius = new Float64Array(nIslands)
  const edge = Array.from({ length: nIslands }, () => [])
  for (let i = 0; i < w * h; i++) {
    const l = islands.labels[i]
    if (l < 0) continue
    const x = i % w
    const y = (i - x) / w
    radius[l] = Math.max(radius[l], Math.hypot(x - centroid[l * 2], y - centroid[l * 2 + 1]) + 0.5)
    const border = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
      islands.labels[i - 1] !== l || islands.labels[i + 1] !== l || islands.labels[i - w] !== l || islands.labels[i + w] !== l
    if (border) edge[l].push(x, y)
  }
  const distToRed = edt(redline, w, h) // distância até a Red Line
  const want = new Float64Array(nIslands)
  for (let l = 0; l < nIslands; l++) {
    const e = Math.max(bbox[l * 4 + 2] - bbox[l * 4], bbox[l * 4 + 3] - bbox[l * 4 + 1]) + 1
    want[l] = Math.max(k, Math.min(k * MAX_GROW, MIN_SIZE / (e * PX)))
  }
  const grows = [...Array(nIslands).keys()].filter((l) => want[l] > k)
  // Distância do centro de l até a ilha m já escalada (m cresce em volta do próprio centro).
  const distTo = (l, m) => {
    const cx = centroid[l * 2], cy = centroid[l * 2 + 1], mx = centroid[m * 2], my = centroid[m * 2 + 1]
    const s = islandK[m]
    let best = Infinity
    const E = edge[m]
    for (let q = 0; q < E.length; q += 2) best = Math.min(best, Math.hypot(mx + (E[q] - mx) * s - cx, my + (E[q + 1] - my) * s - cy))
    return best
  }
  for (let pass = 0; pass < 4; pass++) {
    for (const l of grows) {
      const cx = centroid[l * 2], cy = centroid[l * 2 + 1]
      let room = distToRed[Math.round(cy) * w + Math.round(cx)] - RL_GAP
      for (let m = 0; m < nIslands; m++) {
        if (m === l) continue
        const far = Math.hypot(centroid[m * 2] - cx, centroid[m * 2 + 1] - cy) - radius[m] * islandK[m]
        if (far > room + ISLAND_GAP) continue // longe demais para limitar
        room = Math.min(room, distTo(l, m) - ISLAND_GAP)
      }
      // a ilha escalada (raio radius[l] * s) precisa caber em room
      // A última passada só diminui: assim nenhuma ilha volta a encostar numa vizinha.
      const s = Math.max(k, Math.min(want[l], room / radius[l]))
      islandK[l] = pass === 3 ? Math.min(islandK[l], s) : s
    }
  }
  const grown = grows.filter((l) => islandK[l] > k * 1.05)
  const limited = grows.filter((l) => islandK[l] < want[l] * 0.95)
  console.log(`piso de tamanho: ${grown.length} ilhas cresceram (${limited.length} limitadas pelas vizinhas/Red Line)`)
}
/** Ponto de uma ilha (px da referência) → mundo: a ilha cresce em volta do seu centro. */
const islandToWorld = (l, x, y) => {
  const cx = centroid[l * 2], cy = centroid[l * 2 + 1], s = islandK[l]
  return mapToWorld(cx + (x - cx) * s, cy + (y - cy) * s)
}

// ---------- 5) Alturas contínuas (decidem os platôs) ----------
const RL_LEVELS = [0.1, 2.3 * RL_HEIGHT, 2.9 * RL_HEIGHT] // pé, muralha, topo
const RL_TOP = RL_LEVELS[2]
// Acima do topo da muralha: degraus de cordilheira (Red Line montanhosa) que continuam,
// cada vez mais estreitos, até o pico da Reverse Mountain.
const UP_LEVELS = [4.9, 5.8, 6.8, 7.9, 9.2, 10.7, 12.4, 14.5]
const ALL_LEVELS = [...RL_LEVELS, ...UP_LEVELS]
const PEAK = UP_LEVELS[UP_LEVELS.length - 1] + 0.6
/** Altura contínua da montanha num ponto (px). Contorno irregular via ruído no ângulo. */
function mountainRaw(x, y) {
  const dx = x - summit[0], dy = y - summit[1]
  const a = Math.atan2(dy, dx)
  const wobble = 1 + 0.22 * (valueNoise(Math.cos(a) * 2.2 + 5, Math.sin(a) * 2.2 + 5, 41) - 0.5) * 2
  const r = Math.hypot(dx, dy) / (MOUNTAIN_R * wobble)
  if (r >= 1) return 0
  return RL_TOP + (PEAK - RL_TOP) * Math.pow(1 - r, 1.45)
}

// Piscina no topo: o cume é nivelado na altura da borda (rimRaw) e coberto por um lago raso,
// onde os quatro canais que sobem desembocam.
const POOL_R = 22 // px: raio da água
const RIM = 6 // px: largura da borda de rocha em volta
const rimRaw = (() => {
  let lo = Infinity
  for (let a = 0; a < 64; a++) {
    const ang = (a / 64) * Math.PI * 2
    lo = Math.min(lo, mountainRaw(summit[0] + Math.cos(ang) * (POOL_R + RIM), summit[1] + Math.sin(ang) * (POOL_R + RIM)))
  }
  return lo
})()

const islandRaw = new Float32Array(w * h)
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (!land[i]) continue
    // Ilhas que cresceram ganham relevo como se fossem desse tamanho (mais platôs).
    const d = distToWater[i] * (islandK[islands.labels[i]] / k)
    const n = fbm(x, y, { period: 60, octaves: 2, seed: 3 })
    const desert = islandBiome[islands.labels[i]] === BIOME.DESERT
    islandRaw[i] = 0.1 + (1 - Math.exp(-d / 22)) * (0.55 + 1.1 * n) * (desert ? 0.55 : 1) + smooth(2, 5, d) * 0.12
  }
}

// Red Line num grid com PAD px a mais em todos os lados: ela continua para fora do mapa,
// para o limite ficar escondido na névoa em vez de aparecer como um corte.
const PAD = 320
const W2 = w + 2 * PAD
const H2 = h + 2 * PAD
const redP = new Uint8Array(W2 * H2)
{
  // Antes de estender, fecha reentrâncias finas perto das bordas (senão a cópia para fora
  // vira um túnel comprido). O fechamento é feito num grid já estendido 24 px por cópia da
  // borda, para não "comer" a própria borda.
  const E = 24
  const we = w + 2 * E, he = h + 2 * E
  const ext = new Uint8Array(we * he)
  for (let y = 0; y < he; y++) {
    const sy = Math.min(h - 1, Math.max(0, y - E))
    for (let x = 0; x < we; x++) ext[y * we + x] = redline[sy * w + Math.min(w - 1, Math.max(0, x - E))]
  }
  const closedExt = close(ext, we, he, 12)
  const robust = redline.slice()
  const BAND = 48
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < BAND || x >= w - BAND || y < BAND || y >= h - BAND) {
        robust[y * w + x] |= closedExt[(y + E) * we + x + E]
      }
    }
  }
  for (let y2 = 0; y2 < H2; y2++) {
    const sy = Math.min(h - 1, Math.max(0, y2 - PAD))
    for (let x2 = 0; x2 < W2; x2++) {
      const x = x2 - PAD, y = y2 - PAD
      const inside = x >= 0 && x < w && y >= 0 && y < h
      redP[y2 * W2 + x2] = inside ? redline[y * w + x] : robust[sy * w + Math.min(w - 1, Math.max(0, x))]
    }
  }
}
const redRaw = new Float32Array(W2 * H2)
{
  const waterP = new Uint8Array(W2 * H2)
  for (let y2 = 0; y2 < H2; y2++) {
    for (let x2 = 0; x2 < W2; x2++) {
      const x = x2 - PAD, y = y2 - PAD
      const inside = x >= 0 && x < w && y >= 0 && y < h
      const solid = redP[y2 * W2 + x2] || (inside && (land[y * w + x] || canal[y * w + x]))
      waterP[y2 * W2 + x2] = solid ? 0 : 1
    }
  }
  const distP = edt(waterP, W2, H2)
  for (let y2 = 0; y2 < H2; y2++) {
    for (let x2 = 0; x2 < W2; x2++) {
      const i = y2 * W2 + x2
      if (!redP[i]) continue
      const x = x2 - PAD, y = y2 - PAD
      const d = distP[i]
      const n = fbm(x + 5000, y + 5000, { period: 160, octaves: 2, seed: 7 })
      // Cordilheira: cristas (ruído "ridged") que sobem em vários degraus acima do topo da muralha.
      const ridge = 1 - Math.abs(fbm(x + 5000, y + 5000, { period: 130, octaves: 3, seed: 13 }) * 2 - 1)
      const peaks = smooth(18, 120, d) * (Math.pow(ridge, 1.6) * 3.4 + n * 0.9)
      const rl = 0.1 + smooth(0, 16, d) * (RL_LEVELS[1] - 0.1) + smooth(20, 70, d) * (RL_TOP - RL_LEVELS[1]) + peaks
      // Reverse Mountain: só onde já é Red Line, com a borda colada nos canais íngreme.
      const m = x >= 0 && x < w && y >= 0 && y < h ? mountainRaw(x, y) : 0
      redRaw[i] = m > 0 ? Math.max(rl, Math.min(m, RL_TOP + smooth(0, 6, d) * (PEAK - RL_TOP))) : rl
      // Cume nivelado na altura da borda da piscina.
      if (m > 0 && Math.hypot(x - summit[0], y - summit[1]) < POOL_R + RIM + 4) redRaw[i] = Math.min(redRaw[i], rimRaw)
    }
  }
}

// ---------- 6) Contornos → camadas extrudadas ----------
const positions = []
const colors = []
const lines = []
const coastRings = [] // anéis do nível 0 já no mundo, para a textura da costa
const miniRings = { land: [], red: [] } // os mesmos anéis, separados por tipo, para o minimapa

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]
const shade = (c, f) => c.map((v) => Math.round(v * f))
const PAL = {
  [BIOME.GRASS]: ['#f2d58a', '#8fd16a', '#62b450', '#3f9445', '#a88b62'].map(hex),
  [BIOME.DESERT]: ['#f6dc96', '#efc979', '#e2ad5e', '#cc8f4a', '#b07440'].map(hex),
  [BIOME.SNOW]: ['#f2d58a', '#e8f1f7', '#d4e4ef', '#ffffff', '#ffffff'].map(hex),
  [BIOME.ROCK]: ['#f2d58a', '#b99a72', '#9b7b58', '#7f6248', '#c9c0b3'].map(hex),
}
// Red Line e Reverse Mountain na mesma família de cor: os degraus da montanha clareiam até o pico.
// Vermelho "carmim empoeirado", como a Red Line dos mapas de referência.
const RL_PAL = ['#8e2f35', '#a13b42', '#b24a4f'].map(hex)
// Degraus acima do topo: do vermelho da muralha até um rosado claro no pico.
const RED_PAL = [
  ...RL_PAL,
  ...UP_LEVELS.map((_, k) => {
    const t = (k + 1) / UP_LEVELS.length
    const a = hex('#b85257'), b = hex('#e3a3a0')
    return a.map((v, c) => Math.round(v + (b[c] - v) * t))
  }),
]

function simplify(pts, tol) {
  if (pts.length < 6) return pts
  const mid = Math.floor(pts.length / 2)
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[mid] = keep[pts.length - 1] = 1
  const stack = [[0, mid], [mid, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = pts[a], [bx, by] = pts[b]
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    let maxD = 0, idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]) }
  }
  return pts.filter((_, i) => keep[i])
}
const ringArea = (r) => {
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

// Ilha de cada vértice (rótulo + 1; 0 = Red Line e Reverse Mountain): a cena usa para destacar uma
// ilha inteira (brilho ao passar o mouse numa ilha com nome).
const vertexIsland = []

function pushTri(a, b, c, col, island) {
  const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2]
  if (uz * vx - ux * vz < 0) [b, c] = [c, b] // topo virado para cima
  positions.push(...a, ...b, ...c)
  colors.push(...col, ...col, ...col)
  vertexIsland.push(island, island, island)
}

/**
 * Extruda um polígono (anéis em px) de y0 até y1, com `xf` levando px → mundo. `island` é o id
 * gravado nos vértices (rótulo da ilha + 1, ou 0).
 */
function extrude(rings, y0, y1, topCol, wallCol, xf, isCoast, island = 0) {
  const [outer, ...holes] = rings
  const v2 = (r) => r.map(([x, y]) => new THREE.Vector2(x, y))
  const tris = THREE.ShapeUtils.triangulateShape(v2(outer), holes.map(v2))
  const P = [outer, ...holes].flat().map(([x, y]) => xf(x, y))
  for (const [a, b, c] of tris) pushTri([P[a][0], y1, P[a][1]], [P[b][0], y1, P[b][1]], [P[c][0], y1, P[c][1]], topCol, island)
  for (const ring of rings) {
    const W = ring.map(([x, y]) => xf(x, y))
    if (isCoast) {
      coastRings.push(W)
      miniRings[isCoast].push(W)
    }
    for (let i = 0; i < W.length; i++) {
      const [ax, az] = W[i]
      const [bx, bz] = W[(i + 1) % W.length]
      positions.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az)
      for (let q = 0; q < 6; q++) colors.push(...wallCol)
      for (let q = 0; q < 6; q++) vertexIsland.push(island)
      lines.push(ax, y1 + 0.006, az, bx, y1 + 0.006, bz)
    }
  }
}

function polygonsOf(field, threshold, minArea = 6, fieldW = w, fieldH = h) {
  const [g] = contours().size([fieldW, fieldH]).thresholds([threshold])(field)
  const out = []
  for (const poly of g.coordinates) {
    const rings = poly
      .map((r) => simplify(r.slice(0, -1), 0.45))
      .filter((r) => r.length >= 3 && Math.abs(ringArea(r)) >= minArea)
    if (rings.length && Math.abs(ringArea(rings[0])) >= minArea) out.push(rings)
  }
  return out
}

function islandOf(rings) {
  for (const [x, y] of rings[0]) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.round(x) + dx, yy = Math.round(y) + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const l = islands.labels[yy * w + xx]
        if (l >= 0) return l
      }
    }
  }
  return -1
}

// Ilhas: nível 0 = praia (contorno da costa), depois platôs.
const LEVELS = [0.1, 0.32, 0.6, 0.95, 1.35]
{
  const mask = new Float32Array(w * h)
  for (let i = 0; i < mask.length; i++) mask[i] = land[i]
  const coastField = blur(mask, w, h, 1)
  const rawField = blur(islandRaw, w, h, 2)
  let count = 0
  LEVELS.forEach((top, lv) => {
    const base = lv === 0 ? -0.3 : LEVELS[lv - 1]
    const threshold = lv === 0 ? 0.5 : LEVELS[lv - 1] + 0.9 * (top - LEVELS[lv - 1])
    for (const rings of polygonsOf(lv === 0 ? coastField : rawField, threshold)) {
      const l = islandOf(rings)
      if (l < 0) continue
      const pal = PAL[islandBiome[l]]
      extrude(rings, base, top, pal[lv], shade(pal[lv], 0.72), (x, y) => islandToWorld(l, x, y), lv === 0 && 'land', l + 1)
      count++
    }
  })
  console.log(`ilhas: ${nIslands}, ${count} peças`)
}

// Red Line (cordilheira) + Reverse Mountain: mesmos degraus, mesma paleta, no grid estendido.
{
  const mask = new Float32Array(W2 * H2)
  for (let i = 0; i < mask.length; i++) mask[i] = redP[i]
  const coastField = blur(mask, W2, H2, 1)
  const rawField = blur(redRaw, W2, H2, 1)
  const xf = (x, y) => mapToWorld(x - PAD, y - PAD)
  ALL_LEVELS.forEach((top, lv) => {
    const base = lv === 0 ? -0.3 : ALL_LEVELS[lv - 1]
    const threshold = lv === 0 ? 0.5 : ALL_LEVELS[lv - 1] + 0.5 * (top - ALL_LEVELS[lv - 1])
    // Degraus altos muito pequenos (lascas no pico) são descartados: o topo termina num platô.
    for (const rings of polygonsOf(lv === 0 ? coastField : rawField, threshold, lv > 2 ? 60 : 20, W2, H2)) {
      extrude(rings, base, top, RED_PAL[lv], shade(RED_PAL[lv], 0.68), xf, lv === 0 && 'red')
    }
  })
}

// ---------- 7) Faixas de água dos canais ----------
// Altura da água: no trecho da montanha, um pouco abaixo do degrau em que o canal está
// (a água sobe em degraus); no trecho da Red Line, rampa até o mar. O canal que desce tem
// FALLS cachoeiras nesse trecho.
const allLevels = ALL_LEVELS
function steppedAt(raw) {
  let z = allLevels[0]
  for (let lv = 1; lv < allLevels.length; lv++) {
    if (raw >= allLevels[lv - 1] + 0.5 * (allLevels[lv] - allLevels[lv - 1])) z = allLevels[lv]
  }
  return z
}
/** Altura (em degraus) da rocha dos dois lados do canal, a uma distância r do topo: a menor das duas. */
function rockBeside(e, r) {
  const off = CANAL_HALF + 5
  let lowest = Infinity
  for (const side of [-1, 1]) {
    const x = Math.round(summit[0] + e.ux * r - e.uy * off * side) + PAD
    const y = Math.round(summit[1] + e.uy * r + e.ux * off * side) + PAD
    lowest = Math.min(lowest, steppedAt(redRaw[y * W2 + x]))
  }
  return lowest
}
const POOL_Y = steppedAt(rimRaw) - 0.08 // superfície da piscina, rente à borda
function waterLevel(s, r) {
  // Dentro da piscina, o canal fica logo abaixo da superfície dela.
  if (r < POOL_R + 1) return POOL_Y - 0.05
  // Fora dela, a água nunca passa da rocha ao lado.
  return Math.min(waterLevelRaw(s, r), rockBeside(arms[s], r) - 0.35)
}
function waterLevelRaw(s, r) {
  const e = arms[s]
  const m = mountainRaw(summit[0] + e.ux * r, summit[1] + e.uy * r)
  if (m > RL_TOP) return steppedAt(m) - 0.45
  const foot = (() => { // onde o braço sai da montanha
    let rr = 0
    while (mountainRaw(summit[0] + e.ux * rr, summit[1] + e.uy * rr) > RL_TOP) rr++
    return rr
  })()
  const t = clamp01((r - foot) / (e.len - foot))
  const top = RL_TOP - 0.45
  if (s !== 0) return 0.05 + (top - 0.05) * (1 - t)
  const q = (1 - t) * FALLS
  return 0.05 + (top - 0.05) * ((Math.floor(q) + smooth(0.85, 1, q - Math.floor(q))) / FALLS)
}
const canals = []
const canalRings = [] // para a textura da costa (canais contam como terra)
arms.forEach((e, s) => {
  const verts = []
  const left = [], right = []
  const steps = Math.ceil(e.len / 1.2)
  for (let q = 0; q <= steps; q++) {
    const r = (q / steps) * e.len
    const y = waterLevel(s, r) + 0.01
    for (const side of [-1, 1]) {
      const half = CANAL_HALF + 1.5 // entra por baixo dos paredões
      const [wx, wz] = mapToWorld(summit[0] + e.ux * r - e.uy * half * side, summit[1] + e.uy * r + e.ux * half * side)
      verts.push(+wx.toFixed(3), +y.toFixed(3), +wz.toFixed(3), +(r / e.len).toFixed(4), side < 0 ? 0 : 1)
      ;(side < 0 ? left : right).push([wx, wz])
    }
  }
  canals.push({ down: s === 0, verts })
  canalRings.push([...left, ...right.reverse()])
})

// ---------- 8) Costa no mundo final (para o oceano) ----------
const CW = 4096
const CH = Math.round((CW * WORLD_H) / WORLD_W)
const toCoastPx = ([x, z]) => [((x + WORLD_W / 2) / WORLD_W) * CW, ((z + WORLD_H / 2) / WORLD_H) * CH]
const coastPath = [...coastRings, ...canalRings]
  .map((r) => 'M' + r.map((p) => toCoastPx(p).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z')
  .join('')
const coastSolid = await rasterizeSvg([coastPath], CW, CH)
const coastDist = edt(coastSolid, CW, CH)
const COAST_MAX = 64
const coast = Buffer.alloc(CW * CH)
for (let i = 0; i < coast.length; i++) coast[i] = Math.round(clamp01(coastDist[i] / COAST_MAX) * 255)

// ---------- 8b) Minimapa: o mundo em cores chapadas, visto de cima ----------
await mkdir(OUT, { recursive: true })
{
  const MW = 1024
  const MH = Math.round((MW * WORLD_H) / WORLD_W)
  const toMini = ([x, z]) => [((x + WORLD_W / 2) / WORLD_W) * MW, ((z + WORLD_H / 2) / WORLD_H) * MH]
  const d = (rings) => rings.map((r) => 'M' + r.map((p) => toMini(p).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join('')
  const band = (k) => {
    const [a, b] = geo.bands[k]
    return `<rect x="0" y="${(a * MH).toFixed(1)}" width="${MW}" height="${((b - a) * MH).toFixed(1)}" fill="#4f8ba6"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${MW}" height="${MH}">
    <rect width="100%" height="100%" fill="#2f6582"/>
    ${band('calmBeltNorth')}${band('calmBeltSouth')}
    <path d="${d(miniRings.red)}" fill="#a83a42" fill-rule="evenodd"/>
    <path d="${d(miniRings.land)}" fill="#7fb85a" stroke="#e8d49a" stroke-width="0.8" fill-rule="evenodd"/>
    <path d="${d(canalRings)}" fill="#7cc7e6"/>
  </svg>`
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/minimap.png`)
}

// ---------- 9) Grava ----------
const pos = new Float32Array(positions)
const col = new Uint8Array(colors)
const lin = new Float32Array(lines)
const colPadded = new Uint8Array(Math.ceil(col.length / 4) * 4)
colPadded.set(col)
if (vertexIsland.length !== pos.length / 3) throw new Error('ilha por vértice: contagem não bate com a malha')
if (nIslands + 1 > 65535) throw new Error('ilhas demais para Uint16')
const isl = new Uint16Array(Math.ceil(vertexIsland.length / 2) * 2) // múltiplo de 4 bytes
isl.set(vertexIsland)
await writeFile(
  `${OUT}/terrain.bin`,
  Buffer.concat([Buffer.from(pos.buffer), Buffer.from(colPadded.buffer), Buffer.from(lin.buffer), Buffer.from(isl.buffer)]),
)
const [poolX, poolZ] = mapToWorld(summit[0], summit[1])
const pool = { x: +poolX.toFixed(3), z: +poolZ.toFixed(3), r: +(POOL_R * PX).toFixed(3), y: +POOL_Y.toFixed(3) }
await writeFile(`${OUT}/canals.json`, JSON.stringify({ canals, pool }))
await sharp(coast, { raw: { width: CW, height: CH, channels: 1 } }).png().toFile(`${OUT}/coast.png`)
await sharp(coast, { raw: { width: CW, height: CH, channels: 1 } })
  .resize(CW / 2, Math.round(CH / 2))
  .png()
  .toFile(`${OUT}/coast_sm.png`)

const islandList = []
for (let l = 0; l < nIslands; l++) {
  islandList.push({
    c: [+centroid[l * 2].toFixed(1), +centroid[l * 2 + 1].toFixed(1)],
    box: [bbox[l * 4], bbox[l * 4 + 1], bbox[l * 4 + 2], bbox[l * 4 + 3]],
    s: +islandK[l].toFixed(4),
  })
}
await writeFile('src/data/islands.json', JSON.stringify({ mapScale: MAP_SCALE, islandScale: ISLAND_SCALE, islands: islandList }) + '\n')

const meta = {
  pixels: { width: w, height: h },
  world: { width: WORLD_W, height: WORLD_H },
  coast: { width: CW, height: CH, maxPx: COAST_MAX, pxPerUnit: CW / WORLD_W },
  cutX,
  mesh: { vertices: pos.length / 3, colorBytes: colPadded.length, lineVertices: lin.length / 3, islandIds: true },
  reverseMountain: { px: summit.map((v) => Math.round(v)), peak: PEAK },
  falls: FALLS,
  bands: geo.bands,
}
await writeFile('src/data/terrain-meta.json', JSON.stringify(meta, null, 2) + '\n')
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB'
console.log(
  `malha: ${(pos.length / 9).toFixed(0)} triângulos, ${lin.length / 6} segmentos → terrain.bin ${mb(pos.byteLength + colPadded.length + lin.byteLength)}; mundo ${WORLD_W} x ${WORLD_H.toFixed(1)}`,
)
