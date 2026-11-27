import route from '../data/route.json'
import { episodeStore, stopOf } from '../state/episode'
import { cameraState } from './cameraState'
import { stopFocus } from './Ship'

// Como se entra na vista da ilha: o navio chega numa parada (Ship.tsx) ou o usuário clica numa ilha
// com nome (no rótulo ou no terreno). Sai pelo X da vinheta. Viajando, nada disso vale.

/** Ilha com nome sob o mouse (no terreno ou no rótulo): ela brilha (Terrain.tsx). */
export const hoverState = { place: null as string | null, label: null as string | null }

const stopPlace = (stop: number) => (route.stops[stop] as { place?: string | null }).place ?? null

/** Pede a vista da ilha de uma parada da rota. */
export function viewStop(stop: number) {
  cameraState.islandRequest = { place: stopPlace(stop), stop, focus: stopFocus(stop) }
}

/**
 * Pede a vista da ilha de um local: a parada onde o navio está, se for nesse local; senão, a
 * primeira parada da rota nele.
 */
export function viewPlace(place: string) {
  const { episode, sailing } = episodeStore.get()
  if (sailing) return
  const here = stopOf(episode)
  const stop = stopPlace(here) === place ? here : route.stops.findIndex((_, i) => stopPlace(i) === place)
  if (stop >= 0) viewStop(stop)
}

export const exitIsland = () => (cameraState.exitIsland = true)
