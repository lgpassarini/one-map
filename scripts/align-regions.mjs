// Alinha os prints detalhados de cada região (reference/regions/*.png) com o nosso mapa.
//
// Objetivo: IoU (interseção / união) das máscaras de Red Line, Calm Belt e terra — levemente
// dilatadas para tolerar pequenas diferenças — entre o print transformado e o nosso mapa.
// Parâmetros: escala única + deslocamento. Busca grossa (1/8) → média (1/4) → fina (1/2).
// A IoU não favorece escalas pequenas (ao contrário da correlação normalizada).
//
// Grava reference/regions/align.json e reference/_debug/overlay-<região>.png (via region-overlay).
//
// Uso: node scripts/align-regions.mjs [região...]
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dilate } from './lib/raster.mjs'
import { ourChannels, printChannels } from './lib/regions.mjs'

const geo = JSON.parse(await readFile('geo/geography.json', 'utf8'))
const W = geo.width, H = geo.height

// box: janela (px do nosso mapa) onde a região fica; s: faixa de escala; w: peso por canal.
const REGIONS = {
  'north-blue': { box: [0, 0, 2048, 820], s: [0.6, 1.3], w: { land: 1 } },
  'east-blue': { box: [2048, 0, 4096, 820], s: [0.6, 1.3], w: { land: 1 } },
  'west-blue': { box: [0, 1265, 2048, 2085], s: [0.6, 1.3], w: { land: 1 } },
  'south-blue': { box: [2048, 1265, 4096, 2085], s: [0.6, 1.3], w: { land: 1 } },
  'new-world': { box: [0, 760, 2048, 1330], s: [0.85, 1.4], w: { red: 0.5, calm: 1.5, land: 1 } },
  paradise: { box: [2048, 760, 4096, 1330], s: [0.85, 1.4], w: { red: 0.5, calm: 1.5, land: 1 } },
}

function down(mask, w, h, f) {
  const dw = Math.ceil(w / f), dh = Math.ceil(h / f)
  const d = new Uint8Array(dw * dh)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) d[((y / f) | 0) * dw + ((x / f) | 0)] = 1
  return { d, w: dw, h: dh }
}

const ours = await ourChannels(geo)
ours.calm = new Uint8Array(W * H)
for (const k of ['calmBeltNorth', 'calmBeltSouth']) {
  const [a, b] = geo.bands[k]
  for (let y = Math.round(a * H); y < Math.round(b * H); y++)
    for (let x = 0; x < W; x++) if (!ours.red[y * W + x] && !ours.land[y * W + x]) ours.calm[y * W + x] = 1
}

const only = process.argv.slice(2)
let result = {}
try { result = JSON.parse(await readFile('reference/regions/align.json', 'utf8')) } catch {}

for (const [name, cfg] of Object.entries(REGIONS)) {
  if (only.length && !only.includes(name)) continue
  const pr = await printChannels(`reference/regions/${name}.png`)
  const chans = Object.keys(cfg.w)
  let best = null
  for (const F of [8, 4, 2]) {
    const R = {}, P = {}
    for (const c of chans) {
      const r = down(ours[c], W, H, F)
      r.d = dilate(r.d, r.w, r.h, c === 'land' ? 1 : 0)
      R[c] = r
      const p = down(pr[c], pr.w, pr.h, F)
      const pts = []
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.d[y * p.w + x]) pts.push(x, y)
      P[c] = { ...p, pts, n: pts.length / 2 }
    }
    const pw = Math.ceil(pr.w / F), ph = Math.ceil(pr.h / F)
    const coarse = !best
    const sList = []
    if (coarse) for (let s = cfg.s[0]; s <= cfg.s[1] + 1e-9; s += 0.01) sList.push(s)
    else for (let s = best.s - (F === 4 ? 0.015 : 0.006); s <= best.s + (F === 4 ? 0.015 : 0.006) + 1e-9; s += 0.0015) sList.push(s)
    let cur = { v: -1 }
    for (const s of sList) {
      const tx0 = coarse ? Math.floor(cfg.box[0] / F - pw * s * 0.15) : best.tx * 2 - 4
      const tx1 = coarse ? Math.ceil(cfg.box[2] / F - pw * s * 0.85) : best.tx * 2 + 4
      const ty0 = coarse ? Math.floor(cfg.box[1] / F - ph * s * 0.15) : best.ty * 2 - 4
      const ty1 = coarse ? Math.ceil(cfg.box[3] / F - ph * s * 0.85) : best.ty * 2 + 4
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          let v = 0, wsum = 0
          for (const c of chans) {
            const p = P[c], r = R[c]
            if (p.n < 4) continue
            // Interseção: pontos do print que caem em terra/Red Line/Calm Belt do nosso mapa.
            let inter = 0
            for (let k = 0; k < p.pts.length; k += 2) {
              const x = (p.pts[k] * s + tx) | 0, y = (p.pts[k + 1] * s + ty) | 0
              if (x >= 0 && y >= 0 && x < r.w && y < r.h && r.d[y * r.w + x]) inter++
            }
            // Área do nosso canal dentro da janela coberta pelo print (aprox. por amostragem).
            let ourArea = 0
            const xa = Math.max(0, tx), ya = Math.max(0, ty)
            const xb = Math.min(r.w, Math.ceil(tx + pw * s)), yb = Math.min(r.h, Math.ceil(ty + ph * s))
            for (let y = ya; y < yb; y += 2) for (let x = xa; x < xb; x += 2) ourArea += r.d[y * r.w + x]
            ourArea *= 4
            const printArea = p.n * s * s
            const union = printArea + ourArea - inter * s * s
            v += cfg.w[c] * ((inter * s * s) / Math.max(union, 1))
            wsum += cfg.w[c]
          }
          v /= wsum
          if (v > cur.v) cur = { v, s, tx, ty }
        }
      }
    }
    best = cur
  }
  result[name] = { scale: +best.s.toFixed(4), tx: best.tx * 2, ty: best.ty * 2, score: +best.v.toFixed(3) }
  console.log(name, JSON.stringify(result[name]))
  execFileSync('node', ['scripts/region-overlay.mjs', name, String(best.s), String(best.tx * 2), String(best.ty * 2)], { stdio: 'inherit' })
}
await writeFile('reference/regions/align.json', JSON.stringify(result, null, 2) + '\n')
