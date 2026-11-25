import { useFrame, useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import meta from '../data/terrain-meta.json'

const base = import.meta.env.BASE_URL

type Canal = { down: boolean; verts: number[] } // verts: [x, y, z, v, u] por vértice, em pares (lado 0/1)
type Pool = { x: number; z: number; r: number; y: number }

const vertex = /* glsl */ `
  attribute vec2 flow; // x = v (0 no topo, 1 no mar), y = u (0/1 de um lado ao outro)
  varying vec2 vFlow;
  #include <fog_pars_vertex>
  void main() {
    vFlow = flow;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

// Água cartoon correndo pelo canal. Nos que sobem, as listras andam em direção ao topo;
// no que desce, para o mar, com espuma em cada queda (cachoeira).
const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uDown;
  uniform float uLen;
  varying vec2 vFlow;
  #include <fog_pars_fragment>
  void main() {
    float v = vFlow.x;
    float speed = mix(1.4, -2.0, uDown);
    float stripe = fract(v * uLen * 0.9 + uTime * speed + sin(vFlow.y * 3.14159) * 0.25);
    float streak = smoothstep(0.75, 0.92, stripe);
    float edge = smoothstep(0.32, 0.5, abs(vFlow.y - 0.5)); // espuma nas margens
    float foam = 0.0;
    if (uDown > 0.5) foam = smoothstep(0.78, 0.96, fract((1.0 - v) * float(FALLS)));
    vec3 col = mix(vec3(0.20, 0.62, 0.86), vec3(1.0), clamp(streak * 0.55 + edge * 0.5 + foam, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

function waterMaterial(down: boolean, len: number, time: { value: number }) {
  const m = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.DoubleSide,
    fog: true,
    defines: { FALLS: meta.falls },
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uDown: { value: down ? 1 : 0 }, uLen: { value: len } }]),
  })
  m.uniforms.uTime = time
  return m
}

/** Piscina no topo da Reverse Mountain: disco de água com ondas indo para o centro. */
function poolMesh(p: Pool, time: { value: number }) {
  const g = new THREE.CircleGeometry(p.r, 72)
  g.rotateX(-Math.PI / 2)
  const pos = g.getAttribute('position')
  const flow = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    flow[i * 2] = Math.hypot(pos.getX(i), pos.getZ(i)) / p.r // 0 no centro, 1 na borda
    flow[i * 2 + 1] = 0.5
  }
  g.setAttribute('flow', new THREE.BufferAttribute(flow, 2))
  const mesh = new THREE.Mesh(g, waterMaterial(false, p.r * 2.5, time))
  mesh.position.set(p.x, p.y, p.z)
  return mesh
}

export function Canals() {
  const data = useLoader(THREE.FileLoader, `${base}terrain/canals.json`, (l) => l.setResponseType('json')) as unknown as {
    canals: Canal[]
    pool: Pool
  }
  const time = useMemo(() => ({ value: 0 }), [])

  const meshes = useMemo(
    () => [
      poolMesh(data.pool, time),
      ...data.canals.map((c) => {
        const n = c.verts.length / 5
        const pos = new Float32Array(n * 3)
        const flow = new Float32Array(n * 2)
        for (let i = 0; i < n; i++) {
          pos.set(c.verts.slice(i * 5, i * 5 + 3), i * 3)
          flow[i * 2] = c.verts[i * 5 + 3]
          flow[i * 2 + 1] = c.verts[i * 5 + 4]
        }
        const index: number[] = []
        for (let k = 0; k < n / 2 - 1; k++) {
          const a = k * 2, b = a + 1, cc = a + 2, d = a + 3
          index.push(a, b, d, a, d, cc)
        }
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        g.setAttribute('flow', new THREE.BufferAttribute(flow, 2))
        g.setIndex(index)
        // Comprimento do canal em unidades da cena, para as listras terem o mesmo espaçamento.
        const len = Math.hypot(pos[pos.length - 3] - pos[0], pos[pos.length - 1] - pos[2])
        return new THREE.Mesh(g, waterMaterial(c.down, len, time))
      }),
    ],
    [data, time],
  )

  useFrame((_, dt) => {
    time.value += dt
  })

  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  )
}
