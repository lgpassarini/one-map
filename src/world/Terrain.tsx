import { type ThreeEvent, useFrame, useLoader, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import meta from '../data/terrain-meta.json'
import { episodeStore } from '../state/episode'
import { addEdgeFade } from './edgeFade'
import { buildIslandGrid, placeAt, placeIsland } from './islandPick'
import { hoverState, viewPlace } from './islandView'
import { toonRamp } from './toon'

const base = import.meta.env.BASE_URL

// Brilho da ilha com nome sob o mouse: a ilha inteira clareia e esquenta, pulsando de leve.
const GLOW_IN = 10 // velocidade com que o brilho acende/apaga
const PICK_Y = 0.4 // altura do plano usado para achar a ilha sob o mouse (perto do topo dos platôs)

const GLOW_GLSL = /* glsl */ `
  uniform float uHoverIsland;
  uniform float uGlow;
  uniform float uTime;
  varying float vIsland;
`

/** Brilho de uma ilha (pelo id de ilha de cada vértice) num material embutido do three. */
function addIslandGlow(material: THREE.Material, uniforms: Record<string, THREE.IUniform>) {
  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float islandId;\nvarying float vIsland;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvIsland = islandId;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLOW_GLSL)
      .replace(
        '#include <tonemapping_fragment>',
        `{
          float on = uHoverIsland > 0.5 ? 1.0 - step(0.5, abs(vIsland - uHoverIsland)) : 0.0;
          float k = on * uGlow * (0.75 + 0.25 * sin(uTime * 4.0));
          // clareia mantendo a cor (multiplica) e esquenta um pouco, sem lavar a saturação
          gl_FragColor.rgb *= 1.0 + 0.42 * k;
          gl_FragColor.rgb += vec3(0.07, 0.055, 0.0) * k;
        }
        #include <tonemapping_fragment>`,
      )
  }
  return material
}

/**
 * Terreno cartoon: ilhas e Red Line como camadas extrudadas a partir dos contornos (bordas
 * nítidas em qualquer zoom), a Reverse Mountain e as linhas de contorno. Tudo gerado por
 * scripts/build-terrain.mjs em public/terrain/terrain.bin (posições, cores, linhas e a ilha de cada
 * vértice). As ilhas com nome são clicáveis e brilham com o mouse em cima.
 */
export function Terrain() {
  const buffer = useLoader(THREE.FileLoader, `${base}terrain/terrain.bin`, (l) => l.setResponseType('arraybuffer')) as ArrayBuffer
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  const glow = useMemo(() => ({ uHoverIsland: { value: 0 }, uGlow: { value: 0 }, uTime: { value: 0 } }), [])

  const { mesh, lines } = useMemo(() => {
    const { vertices, colorBytes, lineVertices } = meta.mesh
    const pos = new Float32Array(buffer, 0, vertices * 3)
    // Cores gravadas em sRGB (como na paleta); o three espera cores de vértice em linear.
    const srgb = new Uint8Array(buffer, vertices * 12, vertices * 3)
    const lut = new Float32Array(256).map((_, i) => {
      const c = i / 255
      return c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    const col = new Float32Array(srgb.length)
    for (let i = 0; i < srgb.length; i++) col[i] = lut[srgb[i]]
    const lin = new Float32Array(buffer, vertices * 12 + colorBytes, lineVertices * 3)
    const ids = new Uint16Array(buffer, vertices * 12 + colorBytes + lineVertices * 12, vertices)
    buildIslandGrid(pos, ids)

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('islandId', new THREE.BufferAttribute(ids, 1))
    g.computeVertexNormals() // não indexada → normais por face (visual chapado)
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp(), side: THREE.DoubleSide })
    const m = new THREE.Mesh(g, addIslandGlow(addEdgeFade(mat), glow))

    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.BufferAttribute(lin, 3))
    const lineMat = addEdgeFade(new THREE.LineBasicMaterial({ color: '#3b2a20', transparent: true, opacity: 0.55 }))
    const l = new THREE.LineSegments(lg, lineMat)
    return { mesh: m, lines: l }
  }, [buffer, glow])

  // Mouse sobre o mapa: acha a ilha com nome embaixo (plano na altura dos platôs + grade de ilhas),
  // sem raycast na malha. Arrastando, viajando ou fora do canvas, nada brilha.
  useEffect(() => {
    const el = gl.domElement
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PICK_Y)
    const hit = new THREE.Vector3()
    const set = (place: string | null) => {
      hoverState.place = place
      el.style.cursor = place ? 'pointer' : ''
    }
    const onMove = (e: PointerEvent) => {
      if (e.buttons || episodeStore.get().sailing) return set(null)
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      set(ray.ray.intersectPlane(plane, hit) ? placeAt(hit.x, hit.z) : null)
    }
    const onLeave = () => set(null)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [gl, camera])

  // Brilho: acende na ilha sob o mouse (ou do rótulo sob o mouse) e apaga suave ao sair.
  useFrame((_, dt) => {
    const place = episodeStore.get().sailing ? null : (hoverState.label ?? hoverState.place)
    const id = place ? (placeIsland.get(place) ?? 0) : 0
    if (id && id !== glow.uHoverIsland.value) {
      glow.uHoverIsland.value = id
      glow.uGlow.value = 0
    }
    glow.uGlow.value += ((id ? 1 : 0) - glow.uGlow.value) * (1 - Math.exp(-GLOW_IN * Math.min(dt, 0.1)))
    glow.uTime.value += dt
  })

  return (
    <group>
      {/* Clicar (sem arrastar) numa ilha com nome abre a vista dela. */}
      <primitive
        object={mesh}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (e.delta > 6) return
          const place = placeAt(e.point.x, e.point.z)
          if (place) {
            e.stopPropagation()
            viewPlace(place)
          }
        }}
      />
      <primitive object={lines} />
    </group>
  )
}
