import * as THREE from 'three'
import { WORLD_H, WORLD_W } from './coords'

// Cor da névoa das bordas (sRGB). O céu (SKY em World.tsx) usa o mesmo tom.
export const EDGE_FOG_RGB: [number, number, number] = [0.66, 0.74, 0.79]

// Fora do mapa, tudo (terreno, mar, linhas) se mistura com a cor da névoa e chega a 100%
// em FADE_END unidades — antes do fim da terra estendida (~31 unidades), para nunca se ver
// o mundo "acabar".
export const FADE_START = 4
export const FADE_END = 24

export const EDGE_FADE_GLSL = /* glsl */ `
  uniform vec3 uEdgeFog;
  uniform vec2 uEdgeHalf;
  varying vec2 vEdgeXZ;
  float edgeFade() {
    vec2 q = abs(vEdgeXZ) - uEdgeHalf;
    float e = max(q.x, q.y); // distância até a borda (positiva fora)
    return smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, e);
  }
`

/** Aplica o fade de borda a um material embutido do three (via onBeforeCompile). */
export function addEdgeFade(material: THREE.Material) {
  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer)
    shader.uniforms.uEdgeFog = { value: new THREE.Vector3(...EDGE_FOG_RGB) }
    shader.uniforms.uEdgeHalf = { value: new THREE.Vector2(WORLD_W / 2, WORLD_H / 2) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEdgeXZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvEdgeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + EDGE_FADE_GLSL)
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uEdgeFog, edgeFade());')
  }
  return material
}
