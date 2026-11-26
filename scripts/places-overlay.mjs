// Confere as posições de geo/places.json: desenha cada local (ponto + nome) sobre o print da
// sua região. Saída: reference/_debug/places-<região>.png (fora do git).
//
// Uso: node scripts/places-overlay.mjs [região]   (sem região: todas as que têm locais)
import sharp from 'sharp'
import { readFile, mkdir } from 'node:fs/promises'

const { places } = JSON.parse(await readFile('geo/places.json', 'utf8'))
const only = process.argv[2]
const byRegion = {}
for (const [id, p] of Object.entries(places)) {
  if (!p.px || (only && p.region !== only)) continue
  ;(byRegion[p.region] ??= []).push({ id, ...p })
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
await mkdir('reference/_debug', { recursive: true })
for (const [region, list] of Object.entries(byRegion)) {
  const src = `reference/regions/${region}.png`
  const { width, height } = await sharp(src).metadata()
  const marks = list
    .map(({ px: [x, y], name, kind }) => {
      const cor = kind === 'filler' ? '#ff9f1c' : kind === 'special' ? '#c77dff' : '#ffe14d'
      return `<circle cx="${x}" cy="${y}" r="7" fill="${cor}" stroke="#000" stroke-width="2.5"/>
        <text x="${x + 11}" y="${y - 9}" font-family="Arial" font-weight="bold" font-size="17" fill="#fff"
          stroke="#000" stroke-width="4" paint-order="stroke">${esc(name.pt)}</text>`
    })
    .join('\n')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${marks}</svg>`
  const out = `reference/_debug/places-${region}.png`
  await sharp(src).composite([{ input: Buffer.from(svg) }]).png().toFile(out)
  console.log(`${out}: ${list.length} locais`)
}
