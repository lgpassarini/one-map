import { useEffect, useMemo, useRef, useState } from 'react'
import { arcName, type Episode, episodeAt, episodeStore, EPISODES, LAST_EP, placeName, useEpisode } from '../state/episode'
import './EpisodeBar.css'

// Barra no topo: `< Arco · Ep N >`. As setas (e ← → no teclado) avançam ou voltam um episódio;
// clicar no nome abre a lista de todos os episódios, agrupados por arco, com busca. Escolher um
// episódio faz o navio viajar até o local dele; durante a viagem a barra fica travada.

const TAG_LABEL: Record<string, string> = { filler: 'Filler', recap: 'Recap' }

type Group = { arc: string; place: string | null; from: number; to: number; eps: Episode[] }

/** Episódios seguidos do mesmo arco viram um grupo da lista. */
function buildGroups(): Group[] {
  const groups: Group[] = []
  for (const ep of EPISODES) {
    const g = groups[groups.length - 1]
    if (g && g.arc === ep.arc) {
      g.eps.push(ep)
      g.to = ep.n
    } else groups.push({ arc: ep.arc, place: ep.place ?? null, from: ep.n, to: ep.n, eps: [ep] })
  }
  return groups
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function Tags({ ep }: { ep: Episode | undefined }) {
  const tags = ep && 'tags' in ep ? (ep.tags ?? []) : []
  return (
    <>
      {tags.map((t) => (
        <span key={t} className={`ep-tag ep-tag--${t}`}>
          {TAG_LABEL[t] ?? t}
        </span>
      ))}
    </>
  )
}

export function EpisodeBar() {
  const { episode, sailing } = useEpisode()
  const [open, setOpen] = useState(false)
  const ep = episodeAt(episode)
  const go = (n: number) => episodeStore.select(n)

  // A placa balança um pouco quando o episódio muda (reinicia a animação a cada troca).
  const bar = useRef<HTMLDivElement>(null)
  const firstEp = useRef(episode)
  useEffect(() => {
    const el = bar.current
    if (!el || episode === firstEp.current) return
    firstEp.current = -1
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const deg = [0, 0.9, -0.6, 0.3, -0.12, 0]
    const at = [0, 0.15, 0.38, 0.6, 0.8, 1]
    el.animate(
      deg.map((d, i) => ({ transform: `rotate(${d}deg)`, offset: at[i] })),
      { duration: 1600, easing: 'ease-out' },
    )
  }, [episode])

  // Teclado: ← → trocam de episódio (fora de campos de texto e com a lista fechada).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const { episode: n } = episodeStore.get()
      if (e.key === 'ArrowRight') go(n + 1)
      else if (e.key === 'ArrowLeft') go(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="ep-bar-wrap">
      <div ref={bar} className={`ep-bar${sailing ? ' ep-bar--locked' : ''}${open ? ' ep-bar--open' : ''}`}>
        <button
          className="ep-bar__arrow"
          onClick={() => go(episode - 1)}
          disabled={sailing || episode <= 0}
          aria-label="Episódio anterior"
        >
          <Chevron dir="left" />
        </button>
        <button
          className="ep-bar__title"
          onClick={() => setOpen((o) => !o)}
          disabled={sailing}
          aria-expanded={open}
          title="Escolher episódio"
        >
          <span className="ep-bar__main">
            {ep ? (
              <>
                {arcName(ep.arc)}
                <span className="ep-bar__dot">·</span>
                Ep<span className="ep-bar__num">{ep.n}</span>
              </>
            ) : (
              'Partida'
            )}
          </span>
          <Tags ep={ep} />
        </button>
        <button
          className="ep-bar__arrow"
          onClick={() => go(episode + 1)}
          disabled={sailing || episode >= LAST_EP}
          aria-label="Próximo episódio"
        >
          <Chevron dir="right" />
        </button>
      </div>
      {open && !sailing && <EpisodeList current={episode} onPick={(n) => (go(n), setOpen(false))} onClose={() => setOpen(false)} />}
    </div>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <path d={dir === 'left' ? 'M10.5 2.5 5 8l5.5 5.5' : 'M5.5 2.5 11 8l-5.5 5.5'} />
    </svg>
  )
}

function EpisodeList({ current, onPick, onClose }: { current: number; onPick: (n: number) => void; onClose: () => void }) {
  const groups = useMemo(buildGroups, [])
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const currentRow = useRef<HTMLButtonElement>(null)

  // Abre com o episódio atual no meio da lista.
  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: 'center' })
  }, [])

  // Fecha com Esc ou clicando fora.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (box.current && !box.current.contains(t) && !(t as Element).closest?.('.ep-bar__title')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [onClose])

  // Busca: um número vai direto ao episódio; texto filtra por título, arco ou local.
  const q = query.trim()
  const num = /^\d+$/.test(q) ? Number(q) : null
  const shown = useMemo(() => {
    if (!q) return groups
    if (num !== null) {
      const ep = episodeAt(num)
      return ep ? [{ ...groups.find((g) => g.from <= num && num <= g.to)!, eps: [ep] }] : []
    }
    const words = norm(q).split(/\s+/)
    return groups
      .map((g) => {
        const head = norm(`${arcName(g.arc)} ${placeName(g.place)}`)
        const eps = g.eps.filter((ep) => {
          const text = `${head} ${norm(ep.title.en)}`
          return words.every((w) => text.includes(w))
        })
        return { ...g, eps }
      })
      .filter((g) => g.eps.length)
  }, [q, num, groups])
  const first = shown[0]?.eps[0]

  return (
    <div className="ep-list" ref={box}>
      <input
        className="ep-list__search"
        autoFocus
        placeholder="Buscar: número, título, arco ou ilha"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && first && onPick(first.n)}
      />
      <div className="ep-list__scroll" ref={scroller}>
        {!q && (
          <button className={`ep-row ep-row--start${current === 0 ? ' ep-row--current' : ''}`} onClick={() => onPick(0)} ref={current === 0 ? currentRow : undefined}>
            <span className="ep-row__n">—</span>
            <span className="ep-row__title">Partida: Vila Foosha</span>
          </button>
        )}
        {shown.map((g) => (
          <section key={`${g.arc}-${g.from}`} className="ep-group">
            <header className="ep-group__head">
              <span className="ep-group__arc">{arcName(g.arc)}</span>
              <span className="ep-group__meta">
                {placeName(g.place)} · {g.from === g.to ? `Ep ${g.from}` : `Ep ${g.from}–${g.to}`}
              </span>
            </header>
            {g.eps.map((ep) => (
              <button
                key={ep.n}
                className={`ep-row${ep.n === current ? ' ep-row--current' : ''}`}
                onClick={() => onPick(ep.n)}
                ref={ep.n === current ? currentRow : undefined}
              >
                <span className="ep-row__n">{ep.n}</span>
                <span className="ep-row__title">{ep.title.en}</span>
                <Tags ep={ep} />
              </button>
            ))}
          </section>
        ))}
        {!shown.length && <p className="ep-list__empty">Nenhum episódio encontrado.</p>}
      </div>
    </div>
  )
}
