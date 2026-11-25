import { useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import meta from '../data/terrain-meta.json'
import { addEdgeFade } from './edgeFade'

const base = import.meta.env.BASE_URL

/** Rampa de luz do toon shading: 3 tons chapados, sem gradiente. */
function toonRamp() {
  const data = new Uint8Array([120, 195, 255])
  const t = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat)
  t.minFilter = THREE.NearestFilter
  t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

/**
 * Terreno cartoon: ilhas e Red Line como camadas extrudadas a partir dos contornos (bordas
 * nítidas em qualquer zoom), a Reverse Mountain e as linhas de contorno. Tudo gerado por
 * scripts/build-terrain.mjs em public/terrain/terrain.bin.
 */
export function Terrain() {
  const buffer = useLoader(THREE.FileLoader, `${base}terrain/terrain.bin`, (l) => l.setResponseType('arraybuffer')) as ArrayBuffer

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

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.computeVertexNormals() // não indexada → normais por face (visual chapado)
    const m = new THREE.Mesh(
      g,
      addEdgeFade(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp(), side: THREE.DoubleSide })),
    )

    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.BufferAttribute(lin, 3))
    const lineMat = addEdgeFade(new THREE.LineBasicMaterial({ color: '#3b2a20', transparent: true, opacity: 0.55 }))
    const l = new THREE.LineSegments(lg, lineMat)
    return { mesh: m, lines: l }
  }, [buffer])

  return (
    <group>
      <primitive object={mesh} />
      <primitive object={lines} />
    </group>
  )
}
