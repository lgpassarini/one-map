import meta from '../data/terrain-meta.json'
import islandData from '../data/islands.json'

export const WORLD_W = meta.world.width
export const WORLD_H = meta.world.height

// O mapa fica no plano XZ: x cresce para o leste, -z é o norte (topo da referência).
// Escala (ver scripts/build-terrain.mjs): as posições são espaçadas por mapScale, mas cada ilha
// cresce só islandScale em volta do próprio centro. Por isso um ponto dentro de uma ilha
// precisa da transformação daquela ilha.

/** Pixel do mapa (já cortado) → posição no mundo (x, z), na escala do mapa (mar, Red Line). */
export function pxToWorld(px: number, py: number): [number, number] {
  return [(px / meta.pixels.width) * WORLD_W - WORLD_W / 2, (py / meta.pixels.height) * WORLD_H - WORLD_H / 2]
}

const k = islandData.islandScale / islandData.mapScale

/** Pixel do mapa → mundo, levando em conta a ilha em que o ponto está (se estiver em uma). */
export function mapPxToWorld(px: number, py: number): [number, number] {
  let best: (typeof islandData.islands)[number] | undefined
  let bestArea = Infinity
  for (const isl of islandData.islands) {
    const [x0, y0, x1, y1] = isl.box
    const m = 3 // tolerância (px) para pontos na costa
    if (px < x0 - m || px > x1 + m || py < y0 - m || py > y1 + m) continue
    const area = (x1 - x0 + 1) * (y1 - y0 + 1)
    if (area < bestArea) {
      best = isl
      bestArea = area
    }
  }
  if (!best) return pxToWorld(px, py)
  const [cx, cy] = best.c
  return pxToWorld(cx + (px - cx) * k, cy + (py - cy) * k)
}

/** Pixel da referência original (reference/world-map-xads181.jpeg) → mundo. */
export function refPxToWorld(px: number, py: number): [number, number] {
  const w = meta.pixels.width
  return mapPxToWorld((((px - meta.cutX) % w) + w) % w, py)
}
