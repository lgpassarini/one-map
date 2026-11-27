import { Suspense } from 'react'
import route from '../data/route.json'
import type { Quality } from '../quality'
import { CameraRig, ISLAND_DIST } from './CameraRig'
import { Canals } from './Canals'
import { mapPxToWorld } from './coords'
import { EdgeFog } from './EdgeFog'
import { Ocean } from './Ocean'
import { PlaceLabelsProjector } from './PlaceLabels'
import { episodeStore, stopOf } from '../state/episode'
import type { IslandSubject } from './cameraState'
import { Ship, stopFocus } from './Ship'
import { Terrain } from './Terrain'

// A câmera começa na vista da ilha da parada do episódio salvo. Dev: ?at=px,py&dist=n posiciona a
// câmera num pixel do mapa (fora da vista da ilha).
function startView(): { at: [number, number]; dist: number; island: IslandSubject | null } {
  const p = new URLSearchParams(window.location.search)
  const at = p.get('at')?.split(',').map(Number)
  const dist = Number(p.get('dist')) || 50
  if (at?.length === 2) return { at: mapPxToWorld(at[0], at[1]), dist, island: null }
  const stop = stopOf(episodeStore.get().episode)
  const place = (route.stops[stop] as { place?: string | null }).place ?? null
  const focus = stopFocus(stop)
  return { at: focus, dist: ISLAND_DIST, island: { place, stop, focus } }
}
const START = startView()

// Céu/neblina quase brancos: ao longe tudo se dissolve numa névoa clara.
const SKY = '#a8bdc9' // mesmo tom da névoa das bordas (EdgeFog)

export function World({ quality }: { quality: Quality }) {
  return (
    <>
      <color attach="background" args={[SKY]} />
      {/* near/far são ajustados pela câmera conforme o zoom (CameraRig). */}
      <fog attach="fog" args={[SKY, 60, 160]} />
      <hemisphereLight args={['#ffffff', '#8fb8c8', 1.4]} />
      <directionalLight position={[50, 80, 35]} intensity={2.0} color="#fff6e6" />
      <Suspense fallback={null}>
        <Terrain />
        <Canals />
        <Ocean quality={quality} />
      </Suspense>
      {/* O navio do bando: fica na parada do episódio atual e viaja quando outro é escolhido. */}
      <Ship />
      <EdgeFog />
      <CameraRig start={START.at} distance={START.dist} island={START.island} />
      {/* depois da câmera: os nomes usam a posição dela deste frame (antes, ficavam um frame atrás) */}
      <PlaceLabelsProjector />
    </>
  )
}
