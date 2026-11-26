import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import { cameraState } from './cameraState'
import { WORLD_H, WORLD_W } from './coords'

const MIN_DIST = 40 // aproximação máxima: enquadramento tipo "Reverse Mountain inteira, de lado"
export const MAX_DIST = 173 // afastado o bastante para ver boa parte do mapa

// Inclinação acompanha o zoom: perto, a câmera fica deitada (vê as ilhas de lado);
// longe, quase de cima, como um mapa. Ângulo polar: 0 = de cima, π/2 = horizonte.
const NEAR_DIST = MIN_DIST
const FAR_DIST = MAX_DIST
const NEAR_POLAR = 1.09 // ~62° do zênite na aproximação máxima
const FAR_POLAR = 0.38 // ~22° do zênite no zoom máximo (leve inclinação)

export function polarFor(dist: number) {
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

/**
 * Câmera de mapa: arrastar move, roda/pinça dá zoom (e a inclinação acompanha), botão direito gira.
 * O alvo fica preso dentro do mapa; quanto mais afastado, mais perto do centro ele precisa ficar.
 */
export function CameraRig({ start, distance = 50 }: { start: [number, number]; distance?: number }) {
  const controls = useRef<MapControlsImpl>(null)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const polar = polarFor(distance)
    c.target.set(start[0], 0, start[1])
    camera.position.set(start[0], distance * Math.cos(polar), start[1] + distance * Math.sin(polar))
    c.update()
  }, [camera, start, distance])

  useFrame(() => {
    const c = controls.current
    if (!c) return
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
      minDistance={MIN_DIST}
      maxDistance={MAX_DIST}
      screenSpacePanning={false}
    />
  )
}
