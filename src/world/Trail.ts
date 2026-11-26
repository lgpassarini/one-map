import * as THREE from 'three'

// Rastro do navio na água: uma faixa que segue exatamente o caminho feito, saindo da popa.
// Mesmo visual da costa no oceano: miolo em água rasa mais clara e bordas de espuma branca
// recortadas, que vão se desfazendo. Com o tempo a faixa alarga, a espuma some e tudo apaga.

const MAX = 240 // pontos guardados
const LIFE = 4 // s até sumir

type Point = { x: number; z: number; len: number; age: number; dist: number }

const vertex = /* glsl */ `
  attribute float aAge;   // 0 = acabou de passar, 1 = sumindo
  attribute float aSide;  // -1 .. 1 de uma borda à outra
  attribute float aDist;  // distância percorrida (unidades), para o ruído correr junto
  varying float vAge;
  varying float vSide;
  varying float vDist;
  void main() {
    vAge = aAge;
    vSide = aSide;
    vDist = aDist;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragment = /* glsl */ `
  uniform float uTime;
  varying float vAge;
  varying float vSide;
  varying float vDist;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    float t = vAge;
    float edge = abs(vSide);
    // Contorno ondulado (borda dura, estilo cartoon), que vai se fechando para o meio no fim.
    float n = noise(vec2(vDist * 1.6 - uTime * 0.6, vSide * 1.5 + 3.0));
    float body = step(edge, 1.0 - 0.25 * n - 0.55 * t * t);
    if (body < 0.5) discard;
    // Espuma nas bordas: começa grossa perto do navio, se quebra em pedaços e some.
    float n2 = noise(vec2(vDist * 3.0 + uTime * 0.4, vSide * 4.0));
    float foamEdge = step(0.62 + 0.3 * t + 0.18 * n2 - 0.25 * t * t, edge + 0.08 * (1.0 - t));
    float foamBits = step(0.9 - 0.25 * (1.0 - t), n2) * step(t, 0.7);
    float foam = max(foamEdge * step(t, 0.85), foamBits * step(edge, 0.6));
    // Cores em linear, as mesmas do oceano: água rasa e espuma.
    vec3 shallow = vec3(0.16, 0.48, 0.58);
    vec3 white = vec3(0.96, 0.99, 1.0);
    vec3 col = mix(shallow, white, foam);
    float alpha = mix(0.55, 0.95, foam) * (1.0 - smoothstep(0.55, 1.0, t));
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`

export function createTrail() {
  const pos = new Float32Array(MAX * 2 * 3)
  const age = new Float32Array(MAX * 2)
  const side = new Float32Array(MAX * 2)
  const dist = new Float32Array(MAX * 2)
  for (let i = 0; i < MAX; i++) {
    side[i * 2] = -1
    side[i * 2 + 1] = 1
  }
  const idx: number[] = []
  for (let i = 0; i < MAX - 1; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aAge', new THREE.BufferAttribute(age, 1))
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1))
  g.setAttribute('aDist', new THREE.BufferAttribute(dist, 1))
  g.setIndex(idx)
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(g, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 1

  const points: Point[] = []
  const tailDist = new Float32Array(MAX)
  let travelled = 0

  /**
   * `stern`: popa do navio agora (ou null parado: o rastro só vai sumindo). `len`: tamanho do navio.
   */
  function update(dt: number, stern: { x: number; z: number } | null, len: number) {
    material.uniforms.uTime.value += dt
    for (const p of points) p.age += dt
    while (points.length && points[points.length - 1].age > LIFE) points.pop()
    if (stern) {
      const head = points[0]
      const step = head ? Math.hypot(head.x - stern.x, head.z - stern.z) : 0
      if (!head || step > len * 0.08) {
        travelled += step
        points.unshift({ x: stern.x, z: stern.z, len, age: 0, dist: travelled })
        if (points.length > MAX - 1) points.pop()
      }
    }
    // A cabeça é sempre a popa atual: o rastro sai colado no navio.
    const list = stern && points.length ? [{ ...points[0], x: stern.x, z: stern.z }, ...points] : points
    const n = Math.min(list.length, MAX)
    // Distância de cada ponto até a ponta mais antiga, para afinar o fim (sem corte reto).
    let fromTail = 0
    for (let i = n - 1; i >= 0; i--) {
      if (i < n - 1) fromTail += Math.hypot(list[i].x - list[i + 1].x, list[i].z - list[i + 1].z)
      tailDist[i] = fromTail
    }
    for (let i = 0; i < n; i++) {
      const p = list[i]
      const a = list[Math.max(0, i - 1)], b = list[Math.min(n - 1, i + 1)]
      let dx = a.x - b.x, dz = a.z - b.z
      const d = Math.hypot(dx, dz) || 1
      dx /= d
      dz /= d
      const t = Math.min(1, p.age / LIFE)
      // Começa da largura do casco e se abre devagar.
      const taper = Math.sqrt(Math.min(1, tailDist[i] / (p.len * 2.5)))
      const half = p.len * (0.17 + 0.32 * Math.sqrt(t)) * taper
      for (const e of [0, 1]) {
        const k = e ? 1 : -1
        const o = (i * 2 + e) * 3
        pos[o] = p.x - dz * half * k
        pos[o + 1] = 0.015
        pos[o + 2] = p.z + dx * half * k
        age[i * 2 + e] = t
        dist[i * 2 + e] = p.dist
      }
    }
    g.attributes.position.needsUpdate = true
    g.attributes.aAge.needsUpdate = true
    g.attributes.aDist.needsUpdate = true
    g.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0)
  }

  return { mesh, update }
}
