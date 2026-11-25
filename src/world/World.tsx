import { Suspense } from 'react'
import type { Quality } from '../quality'
import { CameraRig } from './CameraRig'
import { Canals } from './Canals'
import { mapPxToWorld, refPxToWorld } from './coords'
import { EdgeFog } from './EdgeFog'
import { Ocean } from './Ocean'
import { Terrain } from './Terrain'

// Vila Foosha (pixel na referência original), ponto de partida enquanto não há episódio selecionado.
const FOOSHA = refPxToWorld(3588, 363)

// Dev: ?at=px,py&dist=n posiciona a câmera num pixel do mapa.
function startView(): { at: [number, number]; dist: number } {
  const p = new URLSearchParams(window.location.search)
  const at = p.get('at')?.split(',').map(Number)
  const dist = Number(p.get('dist')) || 50
  return { at: at?.length === 2 ? mapPxToWorld(at[0], at[1]) : FOOSHA, dist }
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
      <EdgeFog />
      <CameraRig start={START.at} distance={START.dist} />
    </>
  )
}
