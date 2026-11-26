// Passo 1 dos dados de episódios: baixa as fontes para .cache/episodes/ (fora do git).
//
// - opguide.app: /api/mapping.json (episódio → capítulos, flags de filler, lista do One Pace)
// - onepace.net: /en/watch (arcos, episódios do One Pace, episódios do anime cobertos, âncoras)
// - One Piece Wiki: wikitext das páginas "Episode N" (título EN, arco, sinopse, recap), 50 por vez
//
// Já baixado não baixa de novo; --refresh força tudo. Depois: node scripts/build-episodes.mjs
//
// Uso: node scripts/fetch-episodes.mjs [--refresh]
import { mkdir, writeFile, access, readFile } from 'node:fs/promises'

const DIR = '.cache/episodes'
const UA = 'one-map-script (personal fan project)'
const refresh = process.argv.includes('--refresh')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const exists = (p) => access(p).then(() => true, () => false)

async function get(url) {
  for (let tent = 1; ; tent++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (res.ok) return res.text()
    if (tent >= 3) throw new Error(`${res.status} em ${url}`)
    await sleep(3000 * tent)
  }
}

async function save(name, url) {
  const path = `${DIR}/${name}`
  if (!refresh && (await exists(path))) return path
  console.log('baixando', url)
  await writeFile(path, await get(url))
  await sleep(1000)
  return path
}

await mkdir(`${DIR}/wiki`, { recursive: true })

// opguide: a versão do mapping vem nas props do conversor
const convert = await get('https://opguide.app/convert')
const ver = /&quot;version&quot;:\[0,&quot;([^&]+)&quot;/.exec(convert)?.[1] ?? '0'
const mapPath = await save('opguide-mapping.json', `https://opguide.app/api/mapping.json?v=${ver}`)
await save('onepace-watch.html', 'https://onepace.net/en/watch')

const { maxEpisode } = JSON.parse(await readFile(mapPath, 'utf8'))
const BATCH = 50
for (let a = 1; a <= maxEpisode; a += BATCH) {
  const b = Math.min(a + BATCH - 1, maxEpisode)
  const titles = []
  for (let n = a; n <= b; n++) titles.push(`Episode ${n}`)
  const url =
    'https://onepiece.fandom.com/api.php?action=query&prop=revisions&rvprop=content&rvslots=main' +
    '&format=json&formatversion=2&redirects=1&titles=' + encodeURIComponent(titles.join('|'))
  await save(`wiki/episodes-${String(a).padStart(4, '0')}.json`, url)
}
console.log(`ok: ${maxEpisode} episódios; fontes em ${DIR}/`)
