// Confere a rota (src/data/route.json): desenha as pernas e as paradas numeradas sobre a textura da
// costa (public/terrain/coast_sm.png). A cor da linha mostra a altura (travessia da Reverse
// Mountain); a troca de borda (Ilha dos Tritões) aparece como duas pontas soltas.
// Saída: reference/_debug/route.png e, com um recorte, reference/_debug/route-<nome>.png (fora do git).
//
// Uso: node scripts/route-overlay.mjs [x0,z0,x1,z1 nome]   (recorte em unidades do mundo)
import sharp from 'sharp'
import { readFile, mkdir } from 'node:fs/promises'

const route = JSON.parse(await readFile('src/data/route.json', 'utf8'))
const meta = JSON.parse(await readFile('src/data/terrain-meta.json', 'utf8'))
const W = meta.world.width, H = meta.world.height
const base = sharp('public/terrain/coast_sm.png')
const { width: PW, height: PH } = await base.metadata()
const S = 2 // a imagem final tem o dobro da textura
const px = ([x, z]) => [((x + W / 2) / W) * PW * S, ((z + H / 2) / H) * PH * S]

const lines = route.legs
  .map((leg) => {
    const parts = leg.jump ? [leg.points.slice(0, leg.jump), leg.points.slice(leg.jump)] : [leg.points]
    return parts
      .map((pts) => {
        let d = ''
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = px(pts[i - 1]), [bx, by] = px(pts[i])
          const h = pts[i][2] ?? 0
          const cor = h > 0.5 ? '#ff4fd8' : '#ff3b30'
          d += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${cor}" stroke-width="3" stroke-linecap="round"/>`
        }
        return d
      })
      .join('')
  })
  .join('\n')
const marks = route.stops
  .map((s, i) => {
    const [x, y] = px(s.at)
    const cor = s.sea ? '#4dd2ff' : '#ffe14d'
    return `<circle cx="${x}" cy="${y}" r="7" fill="${cor}" stroke="#000" stroke-width="2"/>
      <text x="${x + 9}" y="${y - 8}" font-family="Arial" font-weight="bold" font-size="15" fill="#fff" stroke="#000"
        stroke-width="3.5" paint-order="stroke">${i} ${s.place ?? 'mar'}</text>`
  })
  .join('\n')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW * S}" height="${PH * S}">${lines}${marks}</svg>`

await mkdir('reference/_debug', { recursive: true })
const img = await base
  .resize(PW * S, PH * S)
  .linear(0.6, 40)
  .composite([{ input: Buffer.from(svg) }])
  .png()
  .toBuffer()
const [box, name] = process.argv.slice(2)
if (box) {
  const [x0, z0, x1, z1] = box.split(',').map(Number)
  const [l, t] = px([x0, z0]), [r, b] = px([x1, z1])
  const out = `reference/_debug/route-${name ?? 'recorte'}.png`
  await sharp(img).extract({ left: Math.round(l), top: Math.round(t), width: Math.round(r - l), height: Math.round(b - t) }).toFile(out)
  console.log(out)
} else {
  await sharp(img).toFile('reference/_debug/route.png')
  console.log('reference/_debug/route.png')
}
