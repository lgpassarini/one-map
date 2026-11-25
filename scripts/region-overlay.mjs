// Sobreposição de um print de região com o nosso mapa, para uma transformação dada.
// Uso: node scripts/region-overlay.mjs <região> <escala> <tx> <ty>
//   verde = só no print, vermelho = só no nosso, amarelo = ambos (terra); tons escuros = Red Line.
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { printChannels, ourChannels } from './lib/regions.mjs'

const [name, s, tx, ty] = process.argv.slice(2)
const T = { scale: +s, tx: +tx, ty: +ty }
const geo = JSON.parse(await readFile('geo/geography.json', 'utf8'))
const ours = await ourChannels(geo)
const pr = await printChannels(`reference/regions/${name}.png`)
const W = geo.width, H = geo.height
const x0 = Math.max(0, Math.floor(T.tx)), y0 = Math.max(0, Math.floor(T.ty))
const x1 = Math.min(W, Math.ceil(T.tx + pr.w * T.scale)), y1 = Math.min(H, Math.ceil(T.ty + pr.h * T.scale))
const ow = x1 - x0, oh = y1 - y0
const rgb = Buffer.alloc(ow * oh * 3)
let both = 0, onlyP = 0, onlyO = 0
for (let y = y0; y < y1; y++) {
  for (let x = x0; x < x1; x++) {
    const px = Math.round((x - T.tx) / T.scale), py = Math.round((y - T.ty) / T.scale)
    const inP = px >= 0 && py >= 0 && px < pr.w && py < pr.h
    const p = inP ? pr.land[py * pr.w + px] : 0
    const o = ours.land[y * W + x]
    const rp = inP ? pr.red[py * pr.w + px] : 0
    const ro = ours.red[y * W + x]
    let c = [25, 45, 70]
    if (rp || ro) c = rp && ro ? [120, 60, 120] : rp ? [40, 110, 40] : [120, 40, 40]
    if (p && o) c = [230, 210, 60]
    else if (p) c = [60, 200, 80]
    else if (o) c = [220, 60, 60]
    if (p && o) both++; else if (p) onlyP++; else if (o) onlyO++
    rgb.set(c, ((y - y0) * ow + (x - x0)) * 3)
  }
}
await sharp(rgb, { raw: { width: ow, height: oh, channels: 3 } }).png().toFile(`reference/_debug/overlay-${name}.png`)
console.log(name, 'IoU terra', (both / (both + onlyP + onlyO)).toFixed(3))
