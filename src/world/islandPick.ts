import places from '../data/places.json'
import { WORLD_H, WORLD_W } from './coords'

// Qual ilha está num ponto do mapa: uma grade 2D (células de CELL unidades) com o id da ilha de cada
// célula, montada uma vez a partir da malha do terreno (cada vértice traz o id da sua ilha; 0 = Red
// Line). Serve para o clique e o brilho ao passar o mouse sem fazer raycast na malha inteira.

const CELL = 0.4
const MARGIN = 30 // a terra continua um pouco além da borda do mapa
const GW = Math.ceil((WORLD_W + 2 * MARGIN) / CELL)
const GH = Math.ceil((WORLD_H + 2 * MARGIN) / CELL)
let grid: Uint16Array | null = null

/** Ilha de cada local com nome (pela cidade) e o inverso. */
export const placeIsland = new Map<string, number>()
const islandPlace = new Map<number, string>()

const cellX = (x: number) => Math.floor((x + WORLD_W / 2 + MARGIN) / CELL)
const cellZ = (z: number) => Math.floor((z + WORLD_H / 2 + MARGIN) / CELL)

/** Rasteriza os triângulos da malha (só a projeção no chão) na grade e liga cada local à sua ilha. */
export function buildIslandGrid(pos: Float32Array, ids: Uint16Array) {
  const g = new Uint16Array(GW * GH)
  for (let v = 0; v < ids.length; v += 3) {
    const id = ids[v]
    if (!id) continue
    const ax = pos[v * 3], az = pos[v * 3 + 2]
    const bx = pos[v * 3 + 3], bz = pos[v * 3 + 5]
    const cx = pos[v * 3 + 6], cz = pos[v * 3 + 8]
    const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
    if (Math.abs(area) < 1e-9) continue // parede (vertical): não cobre chão
    const x0 = Math.max(0, cellX(Math.min(ax, bx, cx))), x1 = Math.min(GW - 1, cellX(Math.max(ax, bx, cx)))
    const z0 = Math.max(0, cellZ(Math.min(az, bz, cz))), z1 = Math.min(GH - 1, cellZ(Math.max(az, bz, cz)))
    for (let j = z0; j <= z1; j++) {
      const pz = (j + 0.5) * CELL - WORLD_H / 2 - MARGIN
      for (let i = x0; i <= x1; i++) {
        const px = (i + 0.5) * CELL - WORLD_W / 2 - MARGIN
        // centro da célula dentro do triângulo (mesmo sinal nas três arestas)
        const e0 = (bx - ax) * (pz - az) - (bz - az) * (px - ax)
        const e1 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx)
        const e2 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx)
        if ((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0)) g[j * GW + i] = id
      }
    }
  }
  grid = g

  // Ilha de cada local: a da célula da cidade ou, se ela cair na água, a mais perto (até ~2 unidades).
  placeIsland.clear()
  islandPlace.clear()
  for (const [place, p] of Object.entries(places as Record<string, { town: number[] }>)) {
    const id = nearestIsland(p.town[0], p.town[1], Math.ceil(2 / CELL))
    if (!id) continue
    placeIsland.set(place, id)
    if (!islandPlace.has(id)) islandPlace.set(id, place)
  }
}

function nearestIsland(x: number, z: number, maxR: number) {
  if (!grid) return 0
  const ci = cellX(x), cj = cellZ(z)
  for (let r = 0; r <= maxR; r++) {
    let best = 0, bestD = Infinity
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= GW || j >= GH) continue
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue // só o anel de raio r
        const id = grid[j * GW + i]
        const d = (i - ci) ** 2 + (j - cj) ** 2
        if (id && d < bestD) {
          bestD = d
          best = id
        }
      }
    }
    if (best) return best
  }
  return 0
}

/** Id da ilha num ponto do mapa (0 = água ou Red Line). */
export function islandAt(x: number, z: number) {
  if (!grid) return 0
  const i = cellX(x), j = cellZ(z)
  return i < 0 || j < 0 || i >= GW || j >= GH ? 0 : grid[j * GW + i]
}

/** Local com nome da ilha num ponto do mapa (ou null: água, ilha sem nome, Red Line). */
export const placeAt = (x: number, z: number) => islandPlace.get(islandAt(x, z)) ?? null
