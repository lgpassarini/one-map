import { useEffect, useMemo, useRef } from 'react'
import {
  arcName,
  type Episode,
  episodeAt,
  episodeStore,
  EPISODES,
  placeName,
  regionName,
  STOPS,
  stopOf,
  useEpisode,
} from '../state/episode'
import { useIslandView } from './useIslandView'
import './IslandCard.css'

// Vinheta da vista da ilha (canto superior esquerdo): o local onde o navio está, o episódio atual
// (capítulos do mangá e link do One Pace), os arcos da parada e a lista dos episódios dela. Aparece
// só na vista da ilha (navio parado, câmera de perto); some quando a vista sai dela ou o navio parte.
// Igual para todas as ilhas: as versões detalhadas das ilhas ficam para depois.

const TAG_LABEL: Record<string, string> = { filler: 'Filler', recap: 'Recap' }

/** Capítulos em trechos contínuos: [[5, 5], [41, 42]]. */
function chapterRuns(chapters: number[]) {
  const sorted = [...new Set(chapters)].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const c of sorted) {
    const last = runs[runs.length - 1]
    if (last && c <= last[1] + 1) last[1] = c
    else runs.push([c, c])
  }
  return runs
}

/** "Cap. 23–24", "Cap. 5, 41–42" (flashbacks ficam à parte) ou null (filler sem capítulo). */
function chaptersText(chapters: number[] | undefined) {
  if (!chapters?.length) return null
  const runs = chapterRuns(chapters)
  return `Cap. ${runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')}`
}

/** Capítulos de um arco: só o trecho principal (a maior sequência; os flashbacks soltos ficam de fora). */
function arcChaptersText(chapters: number[]) {
  if (!chapters.length) return null
  const [a, b] = chapterRuns(chapters).reduce((best, r) => (r[1] - r[0] > best[1] - best[0] ? r : best))
  return a === b ? `Cap. ${a}` : `Cap. ${a}–${b}`
}

const epRange = (a: number, b: number) => (a === b ? `Ep ${a}` : `Ep ${a}–${b}`)

type ArcInfo = { arc: string; from: number; to: number; chapters: number[] }

export function IslandCard() {
  const { episode, sailing } = useEpisode()
  const inView = useIslandView()
  const visible = inView && !sailing

  const stopIdx = stopOf(episode)
  const stop = STOPS[stopIdx]
  const ep = episodeAt(episode)

  // Local: a ilha da parada ou, no mar, entre as duas ilhas do trecho.
  const place = 'place' in stop ? stop.place : null
  const sea = 'sea' in stop ? stop.sea : null
  const title = place ? placeName(place) : 'Mar aberto'
  const subtitle = place ? regionName(place) : sea ? `entre ${placeName(sea[0])} e ${placeName(sea[1])}` : ''

  // Episódios e arcos da parada.
  const eps = useMemo(() => (stop.episodes ? EPISODES.slice(stop.episodes[0] - 1, stop.episodes[1]) : []), [stop])
  const arcs = useMemo(() => {
    const out: ArcInfo[] = []
    for (const e of eps) {
      const last = out[out.length - 1]
      const a = last && last.arc === e.arc ? last : null
      if (a) {
        a.to = e.n
        a.chapters.push(...(e.chapters ?? []))
      } else out.push({ arc: e.arc, from: e.n, to: e.n, chapters: [...(e.chapters ?? [])] })
    }
    return out
  }, [eps])

  // Mantém o episódio atual à vista na lista.
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (!visible) return
    const row = list.current?.querySelector<HTMLElement>('.island-card__ep--current')
    const box = list.current
    if (row && box) {
      const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
      box.scrollTop = top - box.clientHeight / 2 + row.clientHeight / 2
    }
  }, [episode, visible])

  return (
    <aside className={`island-card${visible ? ' island-card--visible' : ''}`} aria-hidden={!visible}>
      <header className="island-card__head">
        <h2 className="island-card__name">{episode === 0 ? placeName('foosha') : title}</h2>
        <p className="island-card__region">{episode === 0 ? regionName('foosha') : subtitle}</p>
      </header>

      {ep ? <Current ep={ep} /> : <p className="island-card__start">Ponto de partida do bando. Escolha o Ep 1 na placa para zarpar.</p>}

      {arcs.length > 0 && (
        <section className="island-card__section">
          <h3 className="island-card__label">{arcs.length > 1 ? 'Arcos' : 'Arco'}</h3>
          <ul className="island-card__arcs">
            {arcs.map((a) => (
              <li key={`${a.arc}-${a.from}`}>
                <span className="island-card__arc-name">{arcName(a.arc)}</span>
                <span className="island-card__arc-meta">
                  {epRange(a.from, a.to)}
                  {arcChaptersText(a.chapters) && ` · ${arcChaptersText(a.chapters)}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {eps.length > 1 && (
        <section className="island-card__section island-card__section--list">
          <h3 className="island-card__label">Episódios aqui</h3>
          <ol className="island-card__eps" ref={list}>
            {eps.map((e) => (
              <li key={e.n}>
                <button
                  className={`island-card__ep${e.n === episode ? ' island-card__ep--current' : ''}`}
                  onClick={() => episodeStore.select(e.n)}
                  tabIndex={visible ? 0 : -1}
                >
                  <span className="island-card__ep-n">{e.n}</span>
                  <span className="island-card__ep-title">{e.title.en}</span>
                  {'tags' in e && e.tags?.map((t) => <span key={t} className={`ep-tag ep-tag--${t}`}>{TAG_LABEL[t] ?? t}</span>)}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </aside>
  )
}

/** O episódio atual: número, título, tags, capítulos do mangá e o link do One Pace. */
function Current({ ep }: { ep: Episode }) {
  const chapters = chaptersText(ep.chapters)
  const tags = 'tags' in ep ? (ep.tags ?? []) : []
  return (
    <section className="island-card__now">
      <p className="island-card__now-n">
        Ep {ep.n}
        {tags.map((t) => (
          <span key={t} className={`ep-tag ep-tag--${t}`}>
            {TAG_LABEL[t] ?? t}
          </span>
        ))}
      </p>
      <p className="island-card__now-title">{ep.title.en}</p>
      <p className="island-card__now-meta">{chapters ? `Mangá: ${chapters}` : 'Sem capítulo do mangá'}</p>
      {ep.onePace ? (
        <a className="island-card__onepace" href={ep.onePace.url} target="_blank" rel="noreferrer">
          <span className="island-card__onepace-label">Assistir no One Pace</span>
          <span className="island-card__onepace-title">{ep.onePace.title}</span>
        </a>
      ) : (
        <p className="island-card__no-onepace">Ainda não tem no One Pace</p>
      )}
    </section>
  )
}
