import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { WORLD_H, WORLD_W } from './coords'
import { EDGE_FOG_RGB } from './edgeFade'

// Névoa branca nas bordas do mundo: camadas translúcidas empilhadas que vão ficando densas para
// fora do mapa, com fiapos que se movem devagar. Substitui as nuvens em bolas.
// Camadas baixas: camadas altas, vistas com a câmera inclinada, se projetavam por cima do mapa
// e pareciam "avançar" sobre ele. O sumiço do terreno lá fora fica com o edgeFade.
const LAYERS = [
  { y: 0.3, alpha: 0.9 },
  { y: 1.3, alpha: 0.8 },
  { y: 2.4, alpha: 0.7 },
  { y: 3.6, alpha: 0.6 },
]
// Negativo = a névoa só começa fora do mapa (unidades além da borda).
const INSIDE = -5
const OUTSIDE = 22 // a partir daqui, fora do mapa, é névoa total
const EXTRA = 160

const vertex = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`
const fragment = /* glsl */ `
  uniform vec2 uHalf;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uSeed;
  uniform vec3 uColor;
  varying vec2 vXZ;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    // Distância com sinal até a borda do mapa (positiva fora).
    vec2 q = abs(vXZ) - uHalf;
    float e = max(q.x, q.y);
    vec2 p = vXZ * 0.06 + vec2(uTime * 0.02, uTime * 0.013) + uSeed;
    float wisps = 0.55 + 0.45 * (noise(p) * 0.65 + noise(p * 2.3) * 0.35);
    float a = smoothstep(-float(INSIDE), float(OUTSIDE), e + (wisps - 0.5) * 8.0);
    gl_FragColor = vec4(uColor, a * uAlpha * mix(wisps, 1.0, smoothstep(0.0, float(OUTSIDE), e)));
  }
`

export function EdgeFog() {
  const time = useMemo(() => ({ value: 0 }), [])
  const materials = useMemo(
    () =>
      LAYERS.map(
        (l, i) =>
          new THREE.ShaderMaterial({
            vertexShader: vertex,
            fragmentShader: fragment,
            transparent: true,
            depthWrite: false,
            defines: { INSIDE: INSIDE.toFixed(1), OUTSIDE: OUTSIDE.toFixed(1) },
            uniforms: {
              uHalf: { value: new THREE.Vector2(WORLD_W / 2, WORLD_H / 2) },
              uTime: time,
              uAlpha: { value: l.alpha },
              uSeed: { value: i * 7.3 },
              uColor: { value: new THREE.Vector3(...EDGE_FOG_RGB) },
            },
          }),
      ),
    [time],
  )

  useFrame((_, dt) => {
    time.value += dt
  })

  return (
    <group>
      {LAYERS.map((l, i) => (
        <mesh key={i} material={materials[i]} rotation-x={-Math.PI / 2} position-y={l.y} renderOrder={10 + i}>
          <planeGeometry args={[WORLD_W + EXTRA, WORLD_H + EXTRA]} />
        </mesh>
      ))}
    </group>
  )
}
