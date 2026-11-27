import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import { episodeStore } from '../state/episode'
import { cameraState, type IslandSubject } from './cameraState'
import { shipState } from './shipState'
import { WORLD_H, WORLD_W } from './coords'

const MIN_DIST = 40 // aproximação máxima: enquadramento tipo "Reverse Mountain inteira, de lado"
export const MAX_DIST = 173 // afastado o bastante para ver boa parte do mapa

// Inclinação acompanha o zoom: perto, a câmera fica deitada (vê as ilhas de lado);
// longe, quase de cima, como um mapa. Ângulo polar: 0 = de cima, π/2 = horizonte.
const NEAR_DIST = MIN_DIST
const FAR_DIST = MAX_DIST
const NEAR_POLAR = 1.09 // ~62° do zênite na aproximação máxima
const FAR_POLAR = 0.38 // ~22° do zênite no zoom máximo (leve inclinação)

const CLOSE_POLAR = 1.15 // ~66° na vista da ilha: quase rente à água, como a tela de perfil de um jogo

export function polarFor(dist: number) {
  // Mais perto que o zoom normal (vista da ilha): deita ainda mais.
  if (dist < NEAR_DIST) return THREE.MathUtils.lerp(CLOSE_POLAR, NEAR_POLAR, THREE.MathUtils.smoothstep(dist, ISLAND_DIST, NEAR_DIST))
  const t = THREE.MathUtils.smoothstep(dist, NEAR_DIST, FAR_DIST)
  return THREE.MathUtils.lerp(NEAR_POLAR, FAR_POLAR, t)
}

const lastCam = new THREE.Vector3(Infinity, 0, 0)

/** Publica alvo, tamanho da área vista e "última vez que mexeu" para o minimapa. */
function publishCameraState(camera: THREE.PerspectiveCamera, target: THREE.Vector3, halfW: number, halfH: number) {
  cameraState.target = [target.x, target.z]
  cameraState.half = [halfW, halfH]
  // Só conta como movimento se andou algo perceptível (ignora o finzinho do amortecimento).
  if (camera.position.distanceToSquared(lastCam) > 4e-4) {
    cameraState.lastMove = performance.now()
    lastCam.copy(camera.position)
  }
}

// Margem mínima para o alvo não chegar até a névoa da borda quando se está perto.
const MARGIN_X = 22
const MARGIN_Z = 18

// Vista da ilha (a tela de "perfil" do local): a câmera fica bem perto, quase rente à água, com a
// ilha (e o navio, se estiver nela) à direita da tela; à esquerda, a vinheta escura com o nome, os
// arcos e os episódios do local. Entra ao chegar numa parada, ao clicar numa ilha com nome e ao
// abrir a página; sai só pelo X da vinheta (ou quando o navio parte). Nela a câmera fica parada:
// sem arrastar, zoom ou giro.
export const ISLAND_DIST = 13 // distância da câmera na vista da ilha
const HOME_DIST = 50 // zoom da vista normal ao sair da vista da ilha e ao ir até o navio pela âncora
const FRAME_SHIFT = 0.18 // na vista da ilha, a ilha fica esta fração da largura da tela à direita do centro
const FLY_TIME = 1.1 // s da animação de entrar/sair da vista da ilha
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

type CameraRigProps = {
  start: [number, number]
  distance?: number
  /** Começa já na vista desta ilha (ao abrir a página). */
  island?: IslandSubject | null
}

type Fly = { k: number; x: number; z: number; d: number; az: number; tx: number; tz: number; td: number }

/**
 * Câmera de mapa: arrastar move, roda/pinça dá zoom (e a inclinação acompanha), botão direito gira.
 * O alvo fica preso dentro do mapa; quanto mais afastado, mais perto do centro ele precisa ficar.
 */
export function CameraRig({ start, distance = 50, island = null }: CameraRigProps) {
  const controls = useRef<MapControlsImpl>(null)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)
  // Animação em andamento (entrar ou sair da vista da ilha, ir até o navio): de onde a câmera saiu e
  // para onde vai (alvo e distância).
  const fly = useRef<Fly | null>(null)
  // Deslocamento do enquadramento para a direita (0..1), suavizado ao entrar e sair da vista.
  const shift = useRef(island ? 1 : 0)

  useEffect(() => {
    cameraState.island = island
  }, [island])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const polar = polarFor(distance)
    c.target.set(start[0], 0, start[1])
    camera.position.set(start[0], distance * Math.cos(polar), start[1] + distance * Math.sin(polar))
    c.update()
  }, [camera, start, distance])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return
    const sailing = episodeStore.get().sailing

    // Pedidos da interface e do navio (consumidos sempre, mesmo quando ignorados).
    const request = cameraState.islandRequest
    const exit = cameraState.exitIsland
    const toShip = cameraState.flyToShip
    cameraState.islandRequest = null
    cameraState.exitIsland = false
    cameraState.flyToShip = false

    // Viajando, a câmera vai com o navio (o Ship.tsx a conduz) e a vinheta sai. Se a viagem começou
    // na vista da ilha, a câmera continua de perto e com o enquadramento deslocado. Na chegada a câmera
    // não se mexe: só a vinheta aparece.
    if (sailing) {
      if (cameraState.island) cameraState.voyageFromIsland = true
      cameraState.island = null
      fly.current = null
    } else {
      // Centraliza num ponto, vai até a distância pedida e desfaz o giro (norte para cima).
      const flyTo = (tx: number, tz: number, td: number) => {
        const off = camera.position.clone().sub(c.target)
        fly.current = { k: 0, x: c.target.x, z: c.target.z, d: off.length(), az: Math.atan2(off.x, off.z), tx, tz, td }
      }
      const cur = cameraState.island
      if (request && request.arrival) {
        // Chegada do navio: a vista entra onde a câmera está, sem zoom nem animação (só a vinheta
        // aparece e, se a viagem não saiu da vista da ilha, o enquadramento desliza para a direita).
        cameraState.island = { ...request, focus: [c.target.x, c.target.z] }
      } else if (request && !(cur && cur.stop === request.stop)) {
        cameraState.island = request
        flyTo(request.focus[0], request.focus[1], ISLAND_DIST)
      } else if (exit && cur) {
        cameraState.island = null
        flyTo(c.target.x, c.target.z, HOME_DIST)
      } else if (toShip) {
        cameraState.island = null
        flyTo(shipState.pos[0], shipState.pos[1], HOME_DIST)
      }
    }

    const f = fly.current
    if (f) {
      f.k = Math.min(1, f.k + Math.min(dt, 0.1) / FLY_TIME)
      const e = easeInOut(f.k)
      const d = THREE.MathUtils.lerp(f.d, f.td, e)
      const az = f.az + angleDiff(f.az, 0) * e
      const polar = polarFor(d)
      c.target.set(THREE.MathUtils.lerp(f.x, f.tx, e), 0, THREE.MathUtils.lerp(f.z, f.tz, e))
      camera.position.set(
        c.target.x + d * Math.sin(polar) * Math.sin(az),
        d * Math.cos(polar),
        c.target.z + d * Math.sin(polar) * Math.cos(az),
      )
      if (f.k >= 1) fly.current = null
    }

    // Arrastar, zoom e giro: só na vista normal, parada.
    const inView = cameraState.island !== null
    c.enabled = !sailing && !fly.current && !inView
    // Aproximação máxima do zoom normal só com os controles ligados: os controles corrigem a distância
    // a cada quadro mesmo desligados, e na viagem e na vista da ilha a câmera fica mais perto que isso.
    c.minDistance = c.enabled ? MIN_DIST : 0

    const t = c.target
    const dist = camera.position.distanceTo(t)

    // Trava o ângulo polar no valor do zoom atual (o giro em volta continua livre).
    const polar = polarFor(dist)
    c.minPolarAngle = polar
    c.maxPolarAngle = polar

    // Limite do alvo: metade do mapa menos a margem e menos parte do que a câmera enxerga.
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const halfW = halfH * (size.width / size.height)
    const lx = Math.max(0, WORLD_W / 2 - Math.max(MARGIN_X, halfW * 0.85))
    const lz = Math.max(0, WORLD_H / 2 - Math.max(MARGIN_Z, halfH * 0.85))
    const dx = THREE.MathUtils.clamp(t.x, -lx, lx) - t.x
    const dz = THREE.MathUtils.clamp(t.z, -lz, lz) - t.z
    if (dx || dz) {
      t.x += dx
      t.z += dz
      camera.position.x += dx
      camera.position.z += dz
    }

    publishCameraState(camera, t, halfW, halfH)

    // Vista da ilha: desloca a imagem para a direita (o alvo continua na ilha), deixando a esquerda
    // livre para a vinheta.
    const goal = inView || cameraState.voyageFromIsland ? 1 : 0
    if (!sailing) cameraState.voyageFromIsland = false
    shift.current += (goal - shift.current) * (1 - Math.exp(-Math.min(dt, 0.1) * 5))
    if (Math.abs(goal - shift.current) < 1e-3) shift.current = goal
    if (shift.current > 0) {
      const w = size.width, h = size.height
      camera.setViewOffset(w, h, -w * FRAME_SHIFT * easeInOut(shift.current), 0, w, h)
    } else if (camera.view?.enabled) camera.clearViewOffset()

    // Neblina acompanha o zoom.
    if (scene.fog instanceof THREE.Fog) {
      // Bem longe: só apaga o que está muito além (a névoa das bordas é do EdgeFog),
      // para o mapa em si não ficar enevoado ao aproximar.
      scene.fog.near = dist * 4.5
      scene.fog.far = dist * 9
    }
  })

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={island ? 0 : MIN_DIST}
      maxDistance={MAX_DIST}
      screenSpacePanning={false}
    />
  )
}
