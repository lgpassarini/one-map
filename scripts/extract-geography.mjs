// Passo 1 do pipeline do mapa: referência (imagem) → contornos vetoriais.
//
// Lê reference/world-map-xads181.jpeg, classifica cada pixel em mar / terra / Red Line,
// limpa textos, rótulos e a rota pontilhada, e grava os contornos em geo/geography.json.
// Esse JSON é a FONTE DE VERDADE da geografia: depois de gerado, pode ser editado à mão
// (ou pelo futuro modo editor) e o build-terrain parte dele, não da imagem.
//
// Uso: node scripts/extract-geography.mjs [--debug]
import sharp from 'sharp'
import { contours } from 'd3-contour'
import { mkdir, writeFile } from 'node:fs/promises'
import { boxSum, close, fillHoles, open, reconstruct, removeSmall } from './lib/raster.mjs'

const SRC = 'reference/world-map-xads181.jpeg'
const OUT = 'geo/geography.extracted.json' // o merge-regions gera o geo/geography.json final
const DEBUG = process.argv.includes('--debug')

const WATER = 0
const LAND = 1
const REDLINE = 2
const UNKNOWN = 255

// Coluna em que o mapa é "girado" (coordenada no mapa = (x na referência - CUT_X) mod largura).
// Hoje é 0: o layout é o da referência, com a Red Line de Mary Geoise dividida nas duas bordas
// e a Reverse Mountain no centro. (Um corte em 1763 deixaria a rota toda contínua, mas o
// layout original foi preferido; a rota cruza a borda na Ilha dos Tritões, por baixo da Red Line.)
const CUT_X = 0

const { data: refData, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: w, height: h } = info
console.log(`referência: ${w}x${h}, corte na coluna ${CUT_X}`)
const data = Buffer.alloc(refData.length)
for (let y = 0; y < h; y++) {
  const row = y * w * 3
  refData.copy(data, row, row + CUT_X * 3, row + w * 3)
  refData.copy(data, row + (w - CUT_X) * 3, row, row + CUT_X * 3)
}

// 1) Classificação por cor.
const cls = new Uint8Array(w * h)
for (let i = 0; i < w * h; i++) {
  const r = data[i * 3]
  const g = data[i * 3 + 1]
  const b = data[i * 3 + 2]
  const max = Math.max(r, g, b)
  const sat = max - Math.min(r, g, b)
  if (max < 45) cls[i] = UNKNOWN // texto preto / silhuetas
  else if (sat < 22 && max < 200) cls[i] = UNKNOWN // contorno cinza dos rótulos (nuvens/gelo são mais claros)
  else if (r > 150 && g > 130 && b < 110) cls[i] = UNKNOWN // texto amarelo
  else if (r > 130 && g > 110 && b < 0.45 * Math.min(r, g)) cls[i] = UNKNOWN // rota pontilhada amarela
  else if (r > g + 70 && r > b + 70) cls[i] = UNKNOWN // rota pontilhada vermelha / marcadores
  else if (b > r + 25 && b >= g - 20) cls[i] = WATER
  else if (r > g + 32 && r > b + 40) cls[i] = REDLINE
  else cls[i] = LAND
}

// 1b) Regiões de texto: muita concentração de preto (contorno das letras). Tudo que não é
// água ali vira desconhecido, inclusive as letras amarelas, cujo tom oliva parece ilha.
{
  const black = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) black[i] = Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) < 45 ? 1 : 0
  const R = 6
  const density = boxSum(black, w, h, R)
  const area = (2 * R + 1) ** 2
  for (let i = 0; i < w * h; i++) {
    if (cls[i] !== WATER && density[i] / area > 0.09) cls[i] = UNKNOWN
  }
}

// 2) Preenche pixels desconhecidos com a classe majoritária dos vizinhos conhecidos.
for (let pass = 0; pass < 30; pass++) {
  let changed = 0
  const next = cls.slice()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (cls[i] !== UNKNOWN) continue
      const votes = [0, 0, 0]
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const c = cls[yy * w + xx]
          if (c !== UNKNOWN) votes[c]++
        }
      }
      const total = votes[0] + votes[1] + votes[2]
      if (total === 0) continue
      // Empate favorece água: textos ficam majoritariamente sobre o mar.
      next[i] = votes[WATER] >= votes[LAND] && votes[WATER] >= votes[REDLINE] ? WATER : votes[LAND] >= votes[REDLINE] ? LAND : REDLINE
      changed++
    }
  }
  cls.set(next)
  if (!changed) break
}

// 3) Máscaras limpas.
const mask = (c) => {
  const m = new Uint8Array(w * h)
  for (let i = 0; i < m.length; i++) m[i] = cls[i] === c ? 1 : 0
  return m
}

const redlineRaw = mask(REDLINE)
const redlineBig = removeSmall(redlineRaw, w, h, 20000) // só os blocos grandes da Red Line
// O fechamento trata o lado de fora da imagem como vazio e comeria a borda; por isso o OR com o original.
let redline = close(redlineBig, w, h, 3)
for (let i = 0; i < redline.length; i++) redline[i] |= redlineBig[i]
redline = fillHoles(redline, w, h, 60000)

let land = mask(LAND)
for (let i = 0; i < land.length; i++) {
  if (redlineRaw[i] && !redline[i]) land[i] = 1 // ilhas marrom-avermelhadas pequenas são terra
  if (redline[i]) land[i] = 0
}
land = open(land, w, h, 1) // remove traços finos (restos de texto, linhas de rota)
land = reconstruct(land, open(land, w, h, 3), w, h) // só formas com núcleo grosso (mata pontos de rota/ícones)
land = removeSmall(land, w, h, 30) // pontinhos isolados
land = fillHoles(land, w, h, 400) // lagos pequenos / texto sobre a ilha

// 4) Contornos (marching squares) em coordenadas de pixel da referência.
function toPolygons(m) {
  const values = new Float64Array(w * h)
  for (let i = 0; i < m.length; i++) values[i] = m[i]
  const [geom] = contours().size([w, h]).thresholds([0.5])(values)
  return geom.coordinates.map((poly) => poly.map((ring) => simplify(ring, 0.6)))
}

// Douglas–Peucker
function simplify(pts, tol) {
  if (pts.length < 5) return pts
  // Anel fechado: primeiro == último, então divide no meio para o DP ter uma corda válida.
  const mid = Math.floor(pts.length / 2)
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[mid] = keep[pts.length - 1] = 1
  const stack = [
    [0, mid],
    [mid, pts.length - 1],
  ]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    let maxD = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])
}

const geography = {
  source: SRC,
  width: w,
  height: h,
  cutX: CUT_X,
  // Faixas do Calm Belt e da Grand Line, em fração da altura (medidas na referência).
  bands: { calmBeltNorth: [0.384, 0.42], grandLine: [0.42, 0.584], calmBeltSouth: [0.584, 0.62] },
  land: toPolygons(land),
  redline: toPolygons(redline),
}

await mkdir('geo', { recursive: true })
await writeFile(OUT, JSON.stringify(geography))
const count = (polys) => polys.reduce((s, p) => s + p.reduce((t, r) => t + r.length, 0), 0)
console.log(`ilhas/massas de terra: ${geography.land.length} (${count(geography.land)} pontos)`)
console.log(`Red Line: ${geography.redline.length} blocos (${count(geography.redline)} pontos)`)
console.log(`gravado em ${OUT}`)

if (DEBUG) {
  await mkdir('reference/_debug', { recursive: true })
  const rgb = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    const c = redline[i] ? [170, 60, 40] : land[i] ? [90, 150, 60] : [20, 50, 90]
    rgb.set(c, i * 3)
  }
  await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toFile('reference/_debug/classes.png')
  console.log('debug: reference/_debug/classes.png')
}
