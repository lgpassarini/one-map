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
import { printChannels, printTransforms, rasterPolys } from './lib/regions.mjs'

const geo = JSON.parse(await readFile('geo/geography.extracted.json', 'utf8'))
const W = geo.width, H = geo.height
const align = JSON.parse(await readFile('reference/regions/align.json', 'utf8'))

const CALM_N = Math.round(geo.bands.calmBeltNorth[0] * H)
const CALM_S = Math.round(geo.bands.calmBeltSouth[1] * H)

// Transformação print → mapa (T) e área de mar (box) de cada região.
const T = printTransforms(geo, align)
// Faixa que os prints da Grand Line cobrem (eles mostram parte dos Calm Belts). Os Blues vão até
// ela, e não só até o Calm Belt: o encaixe do East Blue põe Loguetown (y≈811) logo depois do
// começo do Calm Belt (801), e ela ficava de fora.
const glCover = async (name) => {
  const { height } = await sharp(`reference/regions/${name}.png`).metadata()
  return [Math.ceil(T[name].ty), Math.floor(T[name].sy * (height - 1) + T[name].ty)]
}
const [nwTop, nwBottom] = await glCover('new-world') // lado oeste (x < 2048)
const [pdTop, pdBottom] = await glCover('paradise') // lado leste
// Ilhas que os rótulos do print cortam em fatias (caixas [x0, y0, x1, y1] no print): ali a letra
// vira terra (ver printChannels). Conferidas uma a uma; fora delas a regra juntaria ilhas
// separadas por um rótulo no estreito (Ilha Rubeck, Reino de Lvneel, Cheese em Totto Land).
const FIX_LABELS = {
  'north-blue': [[690, 540, 750, 590]], // Notice Town
  'east-blue': [
    [290, 350, 470, 455], // Ilhas Conomi (Arlong Park)
    [900, 355, 1000, 420], // Ilha Organ (Orange Town)
    [1465, 540, 1570, 620], // Vila Shimotsuki
    [20, 735, 100, 800], // Loguetown
  ],
  'south-blue': [[1340, 310, 1430, 410]], // Castle Town
  paradise: [
    [355, 70, 450, 140], // Alabasta
    [665, 155, 720, 200], // Upper Yard
    [1255, 90, 1300, 150], // Water 7
  ],
  'new-world': [
    [300, 265, 385, 345], // Dressrosa
    [1480, 150, 1600, 230], // Wano
  ],
}

const REGIONS = {
  'north-blue': { T: T['north-blue'], box: [0, 0, 2048, Math.max(CALM_N, nwTop)] },
  'east-blue': { T: T['east-blue'], box: [2048, 0, W, Math.max(CALM_N, pdTop)] },
  'west-blue': { T: T['west-blue'], box: [0, Math.min(CALM_S, nwBottom + 1), 2048, H] },
  'south-blue': { T: T['south-blue'], box: [2048, Math.min(CALM_S, pdBottom + 1), W, H] },
  // Grand Line + Calm Belts (Amazon Lily e Impel Down ficam no Calm Belt), cortado abaixo ao
  // que o print cobre
  paradise: { T: T.paradise, box: [2048, CALM_N, W, CALM_S], keepSmall: [[838, 128, 880, 153]] }, // anel de Long Ring
  'new-world': { T: T['new-world'], box: [0, CALM_N, 2048, CALM_S] },
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

for (const [name, { T, box: area, keepSmall }] of Object.entries(REGIONS)) {
  const pr = await printChannels(`reference/regions/${name}.png`, { keepSmall, fixLabels: FIX_LABELS[name] })
  // a área não passa do que o print cobre (nas faixas da Grand Line ele não vai até a borda dos
  // Calm Belts): fora dele, as nossas ilhas ficam
  const box = [area[0], Math.max(area[1], Math.ceil(T.ty)), area[2], Math.min(area[3], Math.floor(T.sy * (pr.h - 1) + T.ty))]
  const { data: prRGB } = await sharp(`reference/regions/${name}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  // Terra que veio de rótulo (printChannels.labelLand) tem a cor da letra (preta ou branca, que
  // virariam rocha e neve): pega a cor da terra de verdade mais próxima.
  for (let i = 0; i < pr.labelLand.length; i++) {
    if (!pr.labelLand[i]) continue
    const x = i % pr.w, y = (i / pr.w) | 0
    search: for (let rad = 1; rad <= 24; rad++)
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue
          const nx = x + dx, ny = y + dy, j = ny * pr.w + nx
          if (nx < 0 || ny < 0 || nx >= pr.w || ny >= pr.h || !pr.land[j] || pr.labelLand[j]) continue
          prRGB[i * 3] = prRGB[j * 3]; prRGB[i * 3 + 1] = prRGB[j * 3 + 1]; prRGB[i * 3 + 2] = prRGB[j * 3 + 2]
          break search
        }
  }
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
