// Leitura dos prints de região (reference/regions/*.png) e dos canais do nosso mapa.
import sharp from 'sharp'
import { open, removeSmall } from './raster.mjs'

/**
 * Classifica um print em terra / Red Line / Calm Belt (máscaras 0/1).
 * `keepSmall`: caixas [x0, y0, x1, y1] do print onde ilhotas pequenas são mantidas (a limpeza
 * normal, que tira resíduo dos rótulos, apagaria ilhas de poucos px, como o anel de Long Ring).
 * `fixLabels`: caixas em volta de ilhas que os rótulos cortam em fatias (Dressrosa, Loguetown):
 * ali, a letra com terra logo acima e logo abaixo vira terra. Só em caixas listadas: num rótulo
 * que fica no estreito entre duas ilhas (Ilha Rubeck), a mesma regra juntaria as duas. Esses
 * pixels voltam em `labelLand`: a cor deles é a da letra, não a da ilha.
 */
export async function printChannels(file, { keepSmall = [], fixLabels = [] } = {}) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  let land = new Uint8Array(w * h), red = new Uint8Array(w * h), calm = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const text = max < 55 || min > 205
    const isRed = r > g + 45 && r > b + 30
    // ilha de neve (Drum, Balloon Terminal, Baltigo): clara e pouco saturada; antes do teste de
    // mar, porque o branco-azulado dela passaria por água do Calm Belt
    const snow = !text && min > 150 && max - min < 45
    const sea = b > r + 20 && b >= g - 12
    if (isRed) red[i] = 1
    else if (snow) land[i] = 1
    else if (sea) {
      if (g > 140 && b > 150 && r > 85) calm[i] = 1
    } else if (!text) land[i] = 1
  }
  const raw = land
  land = removeSmall(open(land, w, h, 2), w, h, 40)
  // Conserto dos rótulos: pixel de letra (escura, branca, ou o contorno creme, que é terra no
  // bruto mas a limpeza tirou) com terra já limpa até TEXT_GAP px acima e abaixo.
  const TEXT_GAP = 16
  const fill = []
  for (const [x0, y0, x1, y1] of fixLabels)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x
        if (land[i] || red[i]) continue
        const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]
        if (!(Math.max(r, g, b) < 55 || Math.min(r, g, b) > 205 || raw[i])) continue
        let up = false, down = false
        for (let k = 1; k <= TEXT_GAP && y - k >= 0; k++) if (land[(y - k) * w + x]) { up = true; break }
        if (!up) continue
        for (let k = 1; k <= TEXT_GAP && y + k < h; k++) if (land[(y + k) * w + x]) { down = true; break }
        if (down) fill.push(i)
      }
  const labelLand = new Uint8Array(w * h) // terra que veio de pixel de rótulo (a cor dela não vale)
  for (const i of fill) land[i] = labelLand[i] = 1
  // Ainda nas caixas: rótulos na borda da ilha (as últimas linhas de Dressrosa não têm terra
  // abaixo) deixam "dentes". Pixel de rótulo dentro do fecho convexo de um pedaço da ilha vira
  // terra; cada pedaço tem o seu fecho, então ilhas vizinhas não se juntam.
  for (const [x0, y0, x1, y1] of fixLabels) {
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1
    const lab = new Int32Array(bw * bh).fill(-1)
    let next = 0
    for (let j = 0; j < bw * bh; j++) {
      if (lab[j] >= 0 || !land[(y0 + ((j / bw) | 0)) * w + x0 + (j % bw)]) continue
      const pts = [], stack = [j]
      lab[j] = next
      while (stack.length) {
        const k = stack.pop(), kx = k % bw, ky = (k / bw) | 0
        pts.push([kx, ky])
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = kx + dx, ny = ky + dy, n = ny * bw + nx
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh || lab[n] >= 0 || !land[(y0 + ny) * w + x0 + nx]) continue
          lab[n] = next
          stack.push(n)
        }
      }
      next++
      if (pts.length < 30) continue
      const hull = convexHull(pts)
      let hx0 = bw, hy0 = bh, hx1 = 0, hy1 = 0
      for (const [px, py] of hull) { hx0 = Math.min(hx0, px); hy0 = Math.min(hy0, py); hx1 = Math.max(hx1, px); hy1 = Math.max(hy1, py) }
      for (let py = hy0; py <= hy1; py++)
        for (let px = hx0; px <= hx1; px++) {
          const i = (y0 + py) * w + x0 + px
          if (land[i] || red[i] || !insideHull(hull, px, py)) continue
          const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]
          if (Math.max(r, g, b) < 55 || Math.min(r, g, b) > 205 || raw[i]) land[i] = labelLand[i] = 1
        }
    }
  }
  for (const [x0, y0, x1, y1] of keepSmall)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (raw[y * w + x]) land[y * w + x] = 1
  red = removeSmall(open(red, w, h, 2), w, h, 400)
  calm = removeSmall(open(calm, w, h, 3), w, h, 2000)
  return { w, h, land, red, calm, labelLand }
}

/** Fecho convexo (cadeia monótona) de pontos inteiros, em sentido anti-horário. */
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = [], upper = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop()
    lower.push(q)
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** O ponto está dentro (ou na borda) do fecho convexo anti-horário? */
function insideHull(h, x, y) {
  if (h.length < 3) return false
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length]
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false
  }
  return true
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

/**
 * Transformação print → mapa de cada região: X = sx*px + tx, Y = sy*py + ty (px do mapa cortado).
 * Nos quatro Blues é o encaixe uniforme do align.json; nas faixas da Grand Line, o quadro medido
 * no print (Calm Belts em y; da Red Line/Twin Cape até Sabaody/Lodestar em x) e no nosso mapa.
 * (Nas faixas, o formato de cada ilha usa escala uniforme em volta do centro, então um ponto
 * dentro de uma ilha pode cair alguns px fora do lugar exato.)
 */
export function printTransforms(geo, align) {
  const H = geo.height
  const GL = [Math.round(geo.bands.grandLine[0] * H), Math.round(geo.bands.grandLine[1] * H)]
  const uniform = (a) => ({ sx: a.scale, sy: a.scale, tx: a.tx, ty: a.ty })
  const frame = (print, ours) => {
    const sx = (ours.x1 - ours.x0) / (print.x1 - print.x0)
    const sy = (ours.y1 - ours.y0) / (print.y1 - print.y0)
    return { sx, sy, tx: ours.x0 - print.x0 * sx, ty: ours.y0 - print.y0 * sy }
  }
  return {
    'north-blue': uniform(align['north-blue']),
    'east-blue': uniform(align['east-blue']),
    'west-blue': uniform(align['west-blue']),
    'south-blue': uniform(align['south-blue']),
    paradise: frame({ x0: 0, x1: 1999, y0: 48, y1: 352 }, { x0: 2262, x1: 3925, y0: GL[0], y1: GL[1] }),
    'new-world': frame({ x0: 0, x1: 1998, y0: 58, y1: 365 }, { x0: 140, x1: 1890, y0: GL[0], y1: GL[1] }),
  }
}
