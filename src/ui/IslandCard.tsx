import { useEffect, useMemo, useRef } from 'react'
import { arcName, type Episode, episodeStore, EPISODES, placeName, regionName, STOPS, useEpisode } from '../state/episode'
import { exitIsland } from '../world/islandView'
import { useIslandView } from './useIslandView'
import './IslandCard.css'

// Vinheta da vista da ilha (a tela de "perfil" do local): uma sombra escura que entra pela esquerda,
// com o nome da ilha, os arcos que acontecem nela e, em cada arco, os episódios passados ali, e um X
// no canto superior direito que sai da vista. A ilha é a da vista (onde o navio chegou ou a que foi
// clicada), não necessariamente a do navio. Clicar num episódio leva o navio até ele.

const TAG_LABEL: Record<string, string> = { filler: 'Filler', recap: 'Recap' }

/** "Cap. 23–41" (só o trecho principal: a maior sequência; flashbacks soltos ficam de fora) ou null. */
function chaptersText(chapters: number[]) {
  const sorted = [...new Set(chapters)].sort((a, b) => a - b)
  if (!sorted.length) return null
  const runs: [number, number][] = []
  for (const c of sorted) {
    const last = runs[runs.length - 1]
    if (last && c <= last[1] + 1) last[1] = c
    else runs.push([c, c])
  }
  const [a, b] = runs.reduce((best, r) => (r[1] - r[0] > best[1] - best[0] ? r : best))
  return a === b ? `Cap. ${a}` : `Cap. ${a}–${b}`
}

type ArcGroup = { arc: string; eps: Episode[] }

export function IslandCard() {
  const { episode, sailing } = useEpisode()
  const island = useIslandView()
  const visible = island !== null && !sailing

  // Guarda a última ilha mostrada, para o conteúdo não sumir enquanto a vinheta sai deslizando.
  const lastIsland = useRef(island)
  if (island) lastIsland.current = island
  const stop = STOPS[lastIsland.current?.stop ?? 0]
  const place = lastIsland.current?.place ?? null
  const sea = 'sea' in stop ? stop.sea : null

  // Episódios do local: numa ilha, todos os que se passam nela (inclusive em outras visitas); no mar,
  // os do trecho da parada. Agrupados por arco, na ordem em que os arcos aparecem.
  const arcs = useMemo(() => {
    const eps = place
      ? EPISODES.filter((e) => e.place === place)
      : stop.episodes
        ? EPISODES.slice(stop.episodes[0] - 1, stop.episodes[1])
        : []
    const groups = new Map<string, ArcGroup>()
    for (const e of eps) {
      const g = groups.get(e.arc) ?? { arc: e.arc, eps: [] }
      g.eps.push(e)
      groups.set(e.arc, g)
    }
    return [...groups.values()]
  }, [place, stop])

  const name = place ? placeName(place) : 'Mar aberto'
  const region = place ? regionName(place) : sea ? `entre ${placeName(sea[0])} e ${placeName(sea[1])}` : ''

  // Esc também sai da vista (como o X).
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && exitIsland()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  // Mantém o episódio atual à vista: rola só o necessário para ele ficar até 60% da altura (assim,
  // nos primeiros episódios, o título do arco continua aparecendo).
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!visible) return
    const box = body.current
    const row = box?.querySelector<HTMLElement>('.island-card__ep--current')
    if (box && row) {
      const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
      box.scrollTop = Math.max(0, top - box.clientHeight * 0.6)
    }
  }, [episode, visible])

  return (
    <>
    <button
      className={`island-close${visible ? ' island-close--visible' : ''}`}
      onClick={exitIsland}
      tabIndex={visible ? 0 : -1}
      aria-label="Sair da vista da ilha"
      title="Sair da vista da ilha"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6 L18 18 M18 6 L6 18" />
      </svg>
    </button>
    <aside className={`island-card${visible ? ' island-card--visible' : ''}`} aria-hidden={!visible}>
      <header className="island-card__head">
        {region && <p className="island-card__region">{region}</p>}
        <h2 className="island-card__name">{name}</h2>
      </header>
      <div className="island-card__body" ref={body}>

        {arcs.length === 0 && <p className="island-card__start">Ponto de partida do bando. Escolha o Ep 1 na placa para zarpar.</p>}

        {arcs.map(({ arc, eps }) => {
          const first = eps[0].n
          const last = eps[eps.length - 1].n
          const chapters = chaptersText(eps.flatMap((e) => e.chapters ?? []))
          return (
            <section key={arc} className="island-card__arc">
              <h3 className="island-card__arc-name">{arcName(arc)}</h3>
              <p className="island-card__arc-meta">
                {first === last ? `Ep ${first}` : `Ep ${first}–${last}`}
                {chapters && ` · ${chapters}`}
              </p>
              <ol className="island-card__eps">
                {eps.map((e) => (
                  <li key={e.n}>
                    <button
                      className={`island-card__ep${e.n === episode ? ' island-card__ep--current' : ''}`}
                      onClick={() => episodeStore.select(e.n)}
                      tabIndex={visible ? 0 : -1}
                    >
                      <span className="island-card__ep-n">{e.n}</span>
                      <span className="island-card__ep-title">{e.title.en}</span>
                      {'tags' in e &&
                        e.tags?.map((t) => (
                          <span key={t} className={`ep-tag ep-tag--${t}`}>
                            {TAG_LABEL[t] ?? t}
                          </span>
                        ))}
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )
        })}
      </div>
    </aside>
    </>
  )
}
