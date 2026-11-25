// Leitura dos prints de região (reference/regions/*.png) e dos canais do nosso mapa.
import sharp from 'sharp'
import { open, removeSmall } from './raster.mjs'

/** Classifica um print em terra / Red Line / Calm Belt (máscaras 0/1). */
export async function printChannels(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  let land = new Uint8Array(w * h), red = new Uint8Array(w * h), calm = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const text = max < 55 || min > 205
    const isRed = r > g + 45 && r > b + 30
    const sea = b > r + 20 && b >= g - 12
    if (isRed) red[i] = 1
    else if (sea) {
      if (g > 140 && b > 150 && r > 85) calm[i] = 1
    } else if (!text) land[i] = 1
  }
  land = removeSmall(open(land, w, h, 2), w, h, 40)
  red = removeSmall(open(red, w, h, 2), w, h, 400)
  calm = removeSmall(open(calm, w, h, 3), w, h, 2000)
  return { w, h, land, red, calm }
}

export async function rasterPolys(polys, W, H) {
  const d = polys.map((p) => p.map((r) => 'M' + r.map((q) => q.join(',')).join('L') + 'Z').join('')).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/><path d="${d}" fill="white" fill-rule="evenodd"/></svg>`
  const raw = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer()
  const m = new Uint8Array(W * H)
  for (let i = 0; i < m.length; i++) m[i] = raw[i] > 127 ? 1 : 0
  return m
}

/** Terra e Red Line do nosso mapa (geo/geography.json), na resolução da referência. */
export async function ourChannels(geo) {
  return { land: await rasterPolys(geo.land, geo.width, geo.height), red: await rasterPolys(geo.redline, geo.width, geo.height) }
}
