// Passo 1b do pipeline: substitui as ilhas de cada região pelas dos prints detalhados
// (reference/regions/*.png), que são a fonte de verdade das posições e formatos.
//
// Entrada: geo/geography.extracted.json (do extract-geography) + reference/regions/align.json.
// Saída:   geo/geography.json (usado pelo build-terrain) e geo/colors.png (cores das ilhas
//          para o bioma: verde = grama, areia = deserto, cinza = rocha, branco = neve).
//
// Para cada região:
//   - remove as nossas ilhas cujo centro cai na área de mar da região;
//   - coloca cada ilha do print no lugar: o centro vai pela transformação da região e o formato
//     usa uma escala uniforme (nas faixas da Grand Line o quadro tem escalas x/y diferentes, mas
//     as ilhas não devem ficar achatadas);
//   - nada é colocado sobre a Red Line nem sobre os canais da Reverse Mountain.
//
// Uso: node scripts/merge-regions.mjs
import sharp from 'sharp'
import { contours } from 'd3-contour'
import { readFile, writeFile } from 'node:fs/promises'
import { close, components, dilate, fillHoles, removeSmall } from './lib/raster.mjs'
import { printChannels, rasterPolys } from './lib/regions.mjs'

const geo = JSON.parse(await readFile('geo/geography.extracted.json', 'utf8'))
const W = geo.width, H = geo.height
const align = JSON.parse(await readFile('reference/regions/align.json', 'utf8'))

const GL = [Math.round(geo.bands.grandLine[0] * H), Math.round(geo.bands.grandLine[1] * H)] // linhas da Grand Line
const CALM_N = Math.round(geo.bands.calmBeltNorth[0] * H)
const CALM_S = Math.round(geo.bands.calmBeltSouth[1] * H)

// Transformação print → mapa: X = sx*px + tx, Y = sy*py + ty. box = área de mar da região.
const uniform = (a) => ({ sx: a.scale, sy: a.scale, tx: a.tx, ty: a.ty })
// Faixas: quadro medido no print (Calm Belts em y; da Red Line/Twin Cape até Sabaody/Lodestar em x)
// e no nosso mapa (Grand Line em y; bordas da Red Line na latitude da Grand Line em x).
function frame(print, ours) {
  const sx = (ours.x1 - ours.x0) / (print.x1 - print.x0)
  const sy = (ours.y1 - ours.y0) / (print.y1 - print.y0)
  return { sx, sy, tx: ours.x0 - print.x0 * sx, ty: ours.y0 - print.y0 * sy }
}
const REGIONS = {
  'north-blue': { T: uniform(align['north-blue']), box: [0, 0, 2048, CALM_N] },
  'east-blue': { T: uniform(align['east-blue']), box: [2048, 0, W, CALM_N] },
  'west-blue': { T: uniform(align['west-blue']), box: [0, CALM_S, 2048, H] },
  'south-blue': { T: uniform(align['south-blue']), box: [2048, CALM_S, W, H] },
  paradise: { T: frame({ x0: 0, x1: 1999, y0: 48, y1: 352 }, { x0: 2262, x1: 3925, y0: GL[0], y1: GL[1] }), box: [2048, GL[0], W, GL[1]] },
  'new-world': { T: frame({ x0: 0, x1: 1998, y0: 58, y1: 365 }, { x0: 140, x1: 1890, y0: GL[0], y1: GL[1] }), box: [0, GL[0], 2048, GL[1]] },
}

const land = await rasterPolys(geo.land, W, H)
const red = await rasterPolys(geo.redline, W, H)
const blocked = dilate(red, W, H, 3) // folga para ilha não encostar na Red Line
// Canais da Reverse Mountain: o vão em X dentro da Red Line (fechamento).
{
  const closed = close(red, W, H, 14)
  for (let i = 0; i < closed.length; i++) if (closed[i] && !red[i]) blocked[i] = 1
}

const refColor = await sharp(geo.source).resize(W, H).removeAlpha().raw().toBuffer()
const colors = Buffer.from(refColor)
const out = land.slice()

for (const [name, { T, box }] of Object.entries(REGIONS)) {
  const pr = await printChannels(`reference/regions/${name}.png`)
  const { data: prRGB } = await sharp(`reference/regions/${name}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  // Rótulos sobre as ilhas deixam buracos: preenche os pequenos.
  const prLand = fillHoles(pr.land, pr.w, pr.h, 4000)

  // 1) Remove as nossas ilhas desta região.
  const ourComp = components(land, W, H)
  const cx = new Float64Array(ourComp.sizes.length), cy = new Float64Array(ourComp.sizes.length)
  for (let i = 0; i < land.length; i++) {
    const l = ourComp.labels[i]
    if (l < 0) continue
    cx[l] += i % W
    cy[l] += (i / W) | 0
  }
  const inBox = (x, y) => x >= box[0] && x < box[2] && y >= box[1] && y < box[3]
  let removed = 0
  const kill = new Uint8Array(ourComp.sizes.length)
  for (let l = 0; l < kill.length; l++) {
    if (inBox(cx[l] / ourComp.sizes[l], cy[l] / ourComp.sizes[l])) { kill[l] = 1; removed++ }
  }
  for (let i = 0; i < out.length; i++) if (ourComp.labels[i] >= 0 && kill[ourComp.labels[i]]) out[i] = 0

  // 2) Coloca as ilhas do print.
  const su = Math.sqrt(T.sx * T.sy) // escala uniforme do formato
  const pc = components(prLand, pr.w, pr.h)
  const n = pc.sizes.length
  const pcx = new Float64Array(n), pcy = new Float64Array(n)
  for (let i = 0; i < prLand.length; i++) {
    const l = pc.labels[i]
    if (l < 0) continue
    pcx[l] += i % pr.w
    pcy[l] += (i / pr.w) | 0
  }
  let placed = 0
  for (let l = 0; l < n; l++) {
    if (pc.sizes[l] < 12) continue
    pcx[l] /= pc.sizes[l]
    pcy[l] /= pc.sizes[l]
    const X = T.sx * pcx[l] + T.tx, Y = T.sy * pcy[l] + T.ty
    if (!inBox(X, Y)) continue
    placed++
  }
  // Pinta pixel a pixel no destino (amostragem inversa), por componente.
  const r = Math.ceil(su) // raio do "carimbo" de cada pixel
  for (let i = 0; i < prLand.length; i++) {
    const l = pc.labels[i]
    if (l < 0 || pc.sizes[l] < 12) continue
    const X0 = T.sx * pcx[l] + T.tx, Y0 = T.sy * pcy[l] + T.ty
    if (!inBox(X0, Y0)) continue
    const px = i % pr.w, py = (i / pr.w) | 0
    const X = X0 + (px - pcx[l]) * su, Y = Y0 + (py - pcy[l]) * su
    const rr = prRGB[i * 3], gg = prRGB[i * 3 + 1], bb = prRGB[i * 3 + 2]
    for (let dy = 0; dy < r; dy++) {
      for (let dx = 0; dx < r; dx++) {
        const x = Math.round(X + dx), y = Math.round(Y + dy)
        if (x < 0 || y < 0 || x >= W || y >= H || blocked[y * W + x]) continue
        out[y * W + x] = 1
        colors[(y * W + x) * 3] = rr
        colors[(y * W + x) * 3 + 1] = gg
        colors[(y * W + x) * 3 + 2] = bb
      }
    }
  }
  console.log(`${name}: removidas ${removed} ilhas nossas, colocadas ${placed} do print (escala ${su.toFixed(3)})`)
}

// Limpeza final: fecha frestas do carimbo, tira grãos.
let final = close(out, W, H, 1)
for (let i = 0; i < final.length; i++) if (blocked[i]) final[i] = 0
final = removeSmall(final, W, H, 30)

// Vetoriza (mesmo método do extract-geography).
function simplify(pts, tol) {
  if (pts.length < 5) return pts
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
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])
}
const values = new Float64Array(W * H)
for (let i = 0; i < final.length; i++) values[i] = final[i]
const [g] = contours().size([W, H]).thresholds([0.5])(values)
const merged = { ...geo, land: g.coordinates.map((poly) => poly.map((ring) => simplify(ring, 0.6))), colors: 'geo/colors.png' }
await writeFile('geo/geography.json', JSON.stringify(merged))
await sharp(colors, { raw: { width: W, height: H, channels: 3 } }).png().toFile('geo/colors.png')
console.log(`geo/geography.json: ${merged.land.length} ilhas`)
