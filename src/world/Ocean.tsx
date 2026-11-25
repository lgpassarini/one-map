import { useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import meta from '../data/terrain-meta.json'
import { QUALITY_SETTINGS, type Quality } from '../quality'
import { WORLD_H, WORLD_W } from './coords'
import { EDGE_FADE_GLSL, EDGE_FOG_RGB } from './edgeFade'

const base = import.meta.env.BASE_URL

const vertex = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  varying vec2 vEdgeXZ;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vEdgeXZ = world.xz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

// Oceano cartoon: cores chapadas, faixa rasa com borda definida, anel de espuma pulsando em
// volta das ilhas e manchas de reflexo que se movem. Calm Belt quase parado.
const fragment = /* glsl */ `
  #include <fog_pars_fragment>
  ${EDGE_FADE_GLSL}
  uniform sampler2D uCoast;
  uniform float uTime;
  uniform float uCoastMax;
  uniform vec2 uWorld;
  uniform vec2 uCalmN;
  uniform vec2 uCalmS;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float band(float y, vec2 r) { return step(r.x, y) * step(y, r.y); }

  void main() {
    vec2 uvRaw = vec2(vWorld.x / uWorld.x + 0.5, 0.5 - vWorld.z / uWorld.y);
    vec2 uv = clamp(uvRaw, 0.001, 0.999);
    float inside = step(0.0, uvRaw.x) * step(uvRaw.x, 1.0) * step(0.0, uvRaw.y) * step(uvRaw.y, 1.0);
    // Distância até a costa em pixels da referência (fora do mapa: longe de tudo).
    float d = mix(uCoastMax, texture2D(uCoast, uv).r * uCoastMax, inside);
    vec2 p = vWorld.xz;
    // Borda do Calm Belt ondulada, para não parecer uma faixa pintada com régua.
    float imgY = 1.0 - uv.y + (noise(p * 0.35) - 0.5) * 0.008;
    float calm = max(band(imgY, uCalmN), band(imgY, uCalmS)) * inside;

    // Borda ondulada para as faixas não ficarem perfeitamente concêntricas.
    float wob = (noise(p * 1.3 + uTime * 0.15) - 0.5) * 3.0;

    // Cores em linear (viram sRGB no fim): azul-petróleo mais escuro.
    vec3 deep = vec3(0.045, 0.19, 0.33);
    vec3 deepLight = vec3(0.065, 0.24, 0.39);
    vec3 shallow = vec3(0.16, 0.48, 0.58);
    vec3 calmCol = vec3(0.08, 0.28, 0.42);
    vec3 foam = vec3(0.96, 0.99, 1.0);

    // Movimento: manchas de dois tons que correm devagar (ruído deformado e quantizado),
    // como reflexos de onda em desenho. No Calm Belt quase não se movem.
    float speed = mix(1.0, 0.15, calm);
    vec2 q = p * 0.09 + vec2(uTime * 0.035, uTime * 0.02) * speed;
    vec2 warp = vec2(noise(q + 3.7), noise(q + 9.1)) - 0.5;
    float swell = noise(q * 1.7 + warp * 1.6 + vec2(-uTime * 0.05, uTime * 0.03) * speed);
    float tone = step(0.72, swell); // borda dura, estilo cartoon; limiar alto = poucas manchas
    vec3 openSea = mix(deep, deepLight, tone);

    // d está em pixels da textura da costa (~10 px por unidade da cena).
    vec3 col = mix(openSea, calmCol, calm);
    col = mix(col, shallow, step(d + wob * 0.6, 9.0)); // faixa rasa, borda dura

    // Anel de espuma que pulsa em volta das ilhas.
    float r = 5.0 + 2.0 * sin(uTime * 1.1);
    float ring = 1.0 - smoothstep(0.5, 1.0, abs(d + wob * 0.3 - r));
    float ringFade = 0.55 + 0.45 * cos(uTime * 1.1);
    col = mix(col, foam, ring * ringFade * 0.85);
    // Espuma colada na costa.
    col = mix(col, foam, 1.0 - smoothstep(1.0, 2.2, d + wob * 0.2));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdgeFog, edgeFade());
  }
`

export function Ocean({ quality }: { quality: Quality }) {
  const q = QUALITY_SETTINGS[quality]
  const coast = useTexture(`${base}terrain/coast${q.textureSuffix}.png`)

  const material = useMemo(() => {
    coast.colorSpace = THREE.NoColorSpace
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uCoast: { value: null },
          uTime: { value: 0 },
          uCoastMax: { value: meta.coast.maxPx },
          uWorld: { value: new THREE.Vector2(WORLD_W, WORLD_H) },
          uCalmN: { value: new THREE.Vector2(...meta.bands.calmBeltNorth) },
          uCalmS: { value: new THREE.Vector2(...meta.bands.calmBeltSouth) },
          uEdgeFog: { value: new THREE.Vector3(...EDGE_FOG_RGB) },
          uEdgeHalf: { value: new THREE.Vector2(WORLD_W / 2, WORLD_H / 2) },
        },
      ]),
    })
  }, [coast])
  material.uniforms.uCoast.value = coast

  useFrame((_, dt) => {
    material.uniforms.uTime.value += dt
  })

  return (
    <mesh material={material} rotation-x={-Math.PI / 2}>
      {/* Maior que o mapa: continua por baixo e além da névoa da borda. */}
      <planeGeometry args={[WORLD_W + 160, WORLD_H + 160]} />
    </mesh>
  )
}
