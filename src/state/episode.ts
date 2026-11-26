import { useSyncExternalStore } from 'react'
import data from '../data/episodes.json'
import route from '../data/route.json'

// Episódio atual (= onde você está) e se o navio está viajando. Fora do React de propósito: o
// navio (cena 3D) lê a cada frame, e a barra de episódios assina as mudanças.
//
// Episódio 0 = antes do primeiro episódio: o navio está em Foosha, o ponto de partida.
// O episódio é salvo no localStorage assim que é escolhido (no início da viagem); recarregar a
// página já mostra o navio no destino. O link `?ep=405` escolhe um episódio e também salva.

export type Episode = (typeof data.episodes)[number]

export const EPISODES = data.episodes
export const LAST_EP = EPISODES[EPISODES.length - 1].n
const arcs = new Map(data.arcs.map((a) => [a.id, a]))
const places = data.places as Record<string, { name: { pt: string; en: string } }>

export const episodeAt = (n: number): Episode | undefined => EPISODES[n - 1]
export const arcName = (id: string) => arcs.get(id)?.name.en ?? id
export const placeName = (id: string | null | undefined) => (id ? (places[id]?.name.pt ?? id) : 'Mar aberto')

/** Parada da rota (índice em route.stops) do episódio `n`; o episódio 0 é Foosha (parada 0). */
export function stopOf(n: number) {
  if (n <= 0) return 0
  const i = route.stops.findIndex((s) => s.episodes && s.episodes[0] <= n && n <= s.episodes[1])
  return i < 0 ? 0 : i
}

const KEY = 'one-map:episodio'
const clampEp = (n: number) => (Number.isFinite(n) ? Math.min(LAST_EP, Math.max(0, Math.round(n))) : 0)

function load() {
  const url = new URL(window.location.href)
  const fromUrl = url.searchParams.get('ep')
  if (fromUrl !== null) {
    const n = clampEp(Number(fromUrl))
    try {
      localStorage.setItem(KEY, String(n))
    } catch {}
    // Tira o ?ep do endereço: senão, recarregar voltaria sempre para ele.
    url.searchParams.delete('ep')
    window.history.replaceState(null, '', url)
    return n
  }
  try {
    return clampEp(Number(localStorage.getItem(KEY) ?? 0))
  } catch {
    return 0
  }
}

type State = { episode: number; sailing: boolean }
let state: State = { episode: load(), sailing: false }
const listeners = new Set<() => void>()
const set = (next: Partial<State>) => {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

export const episodeStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  /** Escolhe um episódio (ignorado durante a viagem: a barra fica travada). */
  select(n: number) {
    n = clampEp(n)
    if (state.sailing || n === state.episode) return
    try {
      localStorage.setItem(KEY, String(n))
    } catch {}
    set({ episode: n })
  },
  /** O navio avisa quando parte e quando chega. */
  setSailing(sailing: boolean) {
    if (sailing !== state.sailing) set({ sailing })
  },
}

export const useEpisode = () => useSyncExternalStore(episodeStore.subscribe, episodeStore.get)
