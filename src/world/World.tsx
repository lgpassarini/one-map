import { Suspense } from 'react'
import route from '../data/route.json'
import type { Quality } from '../quality'
import { CameraRig } from './CameraRig'
import { Canals } from './Canals'
import { mapPxToWorld } from './coords'
import { EdgeFog } from './EdgeFog'
import { Ocean } from './Ocean'
import { PlaceLabelsProjector } from './PlaceLabels'
import { type Course, courseStart, Ship } from './Ship'
import type { ShipModelId } from './shipModels'
import { Terrain } from './Terrain'

// Vila Foosha: ponto de partida enquanto não há episódio selecionado.
const FOOSHA = route.places.foosha.port as [number, number]

// Navios fora do mapa por enquanto (voltam com a troca por episódio). Dev: ?navios mostra o
// protótipo abaixo.
const SHOW_SHIPS = new URLSearchParams(window.location.search).has('navios')

// Protótipo: um navio em cada mar. O bote faz a rota do East Blue; o Merry e o Sunny dão voltas
// em mar aberto (pontos com ~7 unidades livres de ilhas, achados no coast.png) no North e no
// South Blue. ?seguir=bote|merry|sunny escolhe em qual a câmera começa e qual ela acompanha.
const COURSES: Record<ShipModelId, Course> = {
  bote: 'rota',
  merry: { center: [-98, -45], rx: 7, rz: 4.9 },
  sunny: { center: [102, 57], rx: 7, rz: 4.9 },
}
const SHIPS = Object.keys(COURSES) as ShipModelId[]
const seguir = new URLSearchParams(window.location.search).get('seguir')
const LEAD: ShipModelId = SHIPS.find((id) => id === seguir) ?? 'bote'

// Dev: ?at=px,py&dist=n posiciona a câmera num pixel do mapa.
function startView(): { at: [number, number]; dist: number } {
  const p = new URLSearchParams(window.location.search)
  const at = p.get('at')?.split(',').map(Number)
  const dist = Number(p.get('dist')) || 50
  if (at?.length === 2) return { at: mapPxToWorld(at[0], at[1]), dist }
  return { at: !SHOW_SHIPS || LEAD === 'bote' ? FOOSHA : courseStart(COURSES[LEAD]), dist }
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
      {SHOW_SHIPS && SHIPS.map((id) => (
        <Ship key={id} model={id} lead={id === LEAD} course={COURSES[id]} />
      ))}
      <EdgeFog />
      <CameraRig start={START.at} distance={START.dist} />
      {/* depois da câmera: os nomes usam a posição dela deste frame (antes, ficavam um frame atrás) */}
      <PlaceLabelsProjector />
    </>
  )
}
