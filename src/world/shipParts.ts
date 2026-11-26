import * as THREE from 'three'
import { toonRamp } from './toon'

// Peças comuns dos navios feitos à mão (bote, Going Merry): camadas extrudadas como as do
// terreno (topo claro, parede mais escura, contorno no alto) e contorno "casco invertido"
// para as peças arredondadas.

export const LINE_COLOR = '#3b2a20' // o mesmo do contorno do terreno

export type Parts = { pos: number[]; col: number[]; lines: number[] }
export const newParts = (): Parts => ({ pos: [], col: [], lines: [] })

export const rect = (x0: number, y0: number, x1: number, y1: number) => {
  const s = new THREE.Shape()
  s.moveTo(x0, y0)
  s.lineTo(x1, y0)
  s.lineTo(x1, y1)
  s.lineTo(x0, y1)
  return s
}

/** Recorta um polígono (vista de cima) à faixa ymin ≤ y ≤ ymax (Sutherland–Hodgman). */
export function clipY(pts: THREE.Vector2[], ymin: number, ymax: number) {
  const half = (src: THREE.Vector2[], d: (p: THREE.Vector2) => number) => {
    const out: THREE.Vector2[] = []
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length]
      const da = d(a), db = d(b)
      if (da >= 0) out.push(a)
      if (da >= 0 !== db >= 0) out.push(a.clone().lerp(b, da / (da - db)))
    }
    return out
  }
  return half(half(pts, (p) => p.y - ymin), (p) => ymax - p.y)
}

/**
 * Camada extrudada como as do terreno: topo na cor `top`, parede 0,72× mais escura, e o
 * contorno do topo em `lines`. A forma (x, y) vira (x, -z): proa para -z.
 */
export function layer(shape: THREE.Shape, y0: number, y1: number, top: string, parts: Parts) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 10 })
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, y0, 0)
  const p = geo.attributes.position.array // ExtrudeGeometry já vem sem índice
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3()
  const cTop = new THREE.Color(top)
  const cWall = cTop.clone().multiplyScalar(0.72)
  for (let i = 0; i < p.length; i += 9) {
    a.fromArray(p, i)
    b.fromArray(p, i + 3)
    c.fromArray(p, i + 6)
    n.subVectors(c, b).cross(a.sub(b)).normalize()
    const col = Math.abs(n.y) > 0.5 ? cTop : cWall
    for (let k = 0; k < 9; k++) parts.pos.push(p[i + k])
    for (let k = 0; k < 3; k++) parts.col.push(col.r, col.g, col.b)
  }
  // Contorno no alto da camada (como as linhas dos platôs).
  for (const ring of [shape.getPoints(10), ...shape.holes.map((h) => h.getPoints(10))]) {
    for (let i = 0; i < ring.length; i++) {
      const u = ring[i], v = ring[(i + 1) % ring.length]
      parts.lines.push(u.x, y1 + 0.004, -u.y, v.x, y1 + 0.004, -v.y)
    }
  }
  geo.dispose()
}

let ramp: THREE.Texture | null = null
export const gradient = () => (ramp ??= toonRamp())

let lineMat: THREE.LineBasicMaterial | null = null
export const lineMaterial = () =>
  (lineMat ??= new THREE.LineBasicMaterial({ color: LINE_COLOR, transparent: true, opacity: 0.7 }))

/** Junta as camadas num mesh chapado (normais por face) e nas linhas de contorno. */
export function finishParts(parts: Parts) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts.pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(parts.col, 3))
  g.computeVertexNormals() // não indexada → normais por face (chapado, como o terreno)
  const body = new THREE.Mesh(g, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient() }))
  const lg = new THREE.BufferGeometry()
  lg.setAttribute('position', new THREE.Float32BufferAttribute(parts.lines, 3))
  return [body, new THREE.LineSegments(lg, lineMaterial())] as const
}

export const toon = (color: string, opts: THREE.MeshToonMaterialParameters = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: gradient(), ...opts })

let outlineMat: THREE.MeshBasicMaterial | null = null

/**
 * Peça arredondada com contorno de desenho: uma cópia "inflada" ao longo das normais, só com
 * as faces de trás, na cor do contorno.
 */
export function outlined(geo: THREE.BufferGeometry, mat: THREE.Material, thickness = 0.006) {
  const mesh = new THREE.Mesh(geo, mat)
  const out = geo.clone()
  const p = out.attributes.position, n = out.attributes.normal
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * thickness, p.getY(i) + n.getY(i) * thickness, p.getZ(i) + n.getZ(i) * thickness)
  }
  outlineMat ??= new THREE.MeshBasicMaterial({ color: LINE_COLOR, side: THREE.BackSide })
  mesh.add(new THREE.Mesh(out, outlineMat))
  return mesh
}

export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

export const shapeOf = (pts: THREE.Vector2[], holes: THREE.Vector2[][] = []) => {
  const s = new THREE.Shape(pts)
  for (const h of holes) s.holes.push(new THREE.Path(h))
  return s
}

/** Cilindro (mastro, verga, pescoço) de `a` a `b`, raio `r0` em `a` e `r1` em `b`, com contorno. */
export function spar(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, color = '#8a5a34') {
  const geo = new THREE.CylinderGeometry(r1, r0, a.distanceTo(b), 8)
  const m = outlined(geo, toon(color), 0.004)
  m.position.copy(a).add(b).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return m
}

export function ball(r: number, color: string, x: number, y: number, z: number, line = 0.005, seg = 16) {
  const m = line > 0
    ? outlined(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), toon(color), line)
    : new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), toon(color))
  m.position.set(x, y, z)
  return m
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  draw(cv.getContext('2d')!)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

const INK = '#1d1a1a'

/**
 * Jolly Roger dos Chapéus de Palha: ossos cruzados atrás, caveira larga de olhos redondos grandes,
 * nariz de coração invertido e mandíbula com duas fileiras de dentes; chapéu de palha com aba
 * larga e fina, faixa vermelha na base da copa e riscos de palha. Tudo branco/amarelo com contorno
 * preto. (0, 0) = altura dos olhos; o desenho vai de y = -96 (copa) a y = +100 (ossos) e
 * x = ±96; `s` = escala.
 */
export function drawJolly(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(s, s)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const WHITE = '#ffffff', YELLOW = '#f6cf2a', RED = '#e2372c'
  const OL = 5 // espessura do contorno

  // Ossos: duas passadas (contorno preto mais grosso, osso branco por cima).
  const BONES: [number, number, number, number][] = [[-82, -80, 82, 92], [82, -80, -82, 92]]
  for (const [w, r, color] of [[16 + OL * 2, 10 + OL, INK], [16, 10, WHITE]] as const) {
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = w
    for (const [x0, y0, x1, y1] of BONES) {
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      const len = Math.hypot(x1 - x0, y1 - y0)
      const dx = (x1 - x0) / len, dy = (y1 - y0) / len
      for (const [x, y, sg] of [[x0, y0, -1], [x1, y1, 1]]) {
        for (const o of [-1, 1]) {
          ctx.beginPath()
          ctx.arc(x + sg * dx * 4 - dy * o * 9, y + sg * dy * 4 + dx * o * 9, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  }

  ctx.strokeStyle = INK
  ctx.lineWidth = OL
  // Mandíbula (atrás da caveira): larga, cantos de baixo arredondados.
  ctx.fillStyle = WHITE
  ctx.beginPath()
  ctx.roundRect(-33, 26, 66, 46, [4, 4, 16, 16])
  ctx.fill()
  ctx.stroke()
  // Crânio: largo em cima, afinando nas maçãs até a mandíbula.
  ctx.beginPath()
  ctx.moveTo(-34, 38)
  ctx.bezierCurveTo(-50, 34, -60, 18, -58, -8)
  ctx.bezierCurveTo(-56, -62, 56, -62, 58, -8)
  ctx.bezierCurveTo(60, 18, 50, 34, 34, 38)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Dentes: duas fileiras, cinco colunas.
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.moveTo(-31, 54)
  ctx.lineTo(31, 54)
  for (const x of [-19, -6.5, 6.5, 19]) {
    ctx.moveTo(x, 38)
    ctx.lineTo(x, 70)
  }
  ctx.stroke()
  ctx.beginPath() // linha de cima dos dentes (onde o crânio encontra a mandíbula)
  ctx.moveTo(-33, 38)
  ctx.lineTo(33, 38)
  ctx.stroke()
  // Olhos redondos grandes e nariz de coração invertido.
  ctx.fillStyle = INK
  for (const x of [-24, 24]) {
    ctx.beginPath()
    ctx.arc(x, 2, 19, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.beginPath() // coração de ponta para cima
  ctx.moveTo(0, 15)
  ctx.bezierCurveTo(-9, 22, -9, 30, -4, 30)
  ctx.lineTo(0, 27)
  ctx.lineTo(4, 30)
  ctx.bezierCurveTo(9, 30, 9, 22, 0, 15)
  ctx.fill()

  // Chapéu: copa amarela, faixa vermelha na base, riscos de palha e aba larga e fina.
  ctx.lineWidth = OL
  ctx.fillStyle = YELLOW
  ctx.beginPath()
  ctx.moveTo(-56, -30)
  ctx.lineTo(-56, -60)
  ctx.bezierCurveTo(-56, -102, 56, -102, 56, -60)
  ctx.lineTo(56, -30)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = RED
  ctx.beginPath()
  ctx.rect(-56, -56, 112, 22)
  ctx.fill()
  ctx.stroke()
  ctx.lineWidth = 2.5
  ctx.beginPath()
  for (const [x0, y0, x1, y1] of [[-30, -84, -40, -62], [-8, -90, -12, -62], [14, -89, 16, -62], [34, -82, 42, -62]]) {
    ctx.moveTo(x0, y0)
    ctx.quadraticCurveTo((x0 + x1) / 2 + (x0 < 0 ? -3 : 3), (y0 + y1) / 2, x1, y1)
  }
  ctx.stroke()
  ctx.lineWidth = OL
  ctx.fillStyle = YELLOW
  ctx.beginPath()
  ctx.roundRect(-92, -36, 184, 11, 5.5)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function edgeLines(at: (u: number, v: number) => THREE.Vector3, sides: [number, number, number, number][]) {
  const edge: number[] = []
  const N = 16
  for (const [u0, v0, u1, v1] of sides) {
    for (let i = 0; i < N; i++) {
      const a = i / N, b = (i + 1) / N
      edge.push(...at(u0 + (u1 - u0) * a, v0 + (v1 - v0) * a).toArray(), ...at(u0 + (u1 - u0) * b, v0 + (v1 - v0) * b).toArray())
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3))
  return new THREE.LineSegments(g, lineMaterial())
}

/**
 * Vela quadrada pendurada na verga, estufada para a proa (-z): `w`×`h`, centro em (0, cy, z).
 * `folds` > 0 faz pregas verticais (o pano franzido na verga), mais fundas em cima.
 */
export function squareSail(w: number, h: number, cy: number, z: number, bulge: number, map: THREE.Texture, folds = 0) {
  const at = (u: number, t: number) => {
    const belly = bulge * Math.sin(Math.PI * u) * Math.sin((Math.PI / 2) * (1 - t)) ** 0.7 // presa na verga (t = 1)
    const pleat = folds ? 0.012 * w * Math.sin(u * Math.PI * 2 * folds) * (0.35 + 0.65 * t) : 0
    return v((u - 0.5) * w * (0.92 + 0.08 * t), cy + (t - 0.5) * h - 0.04 * h * Math.sin(Math.PI * u) * (1 - t), z - belly - pleat)
  }
  const geo = new THREE.PlaneGeometry(1, 1, folds ? folds * 6 : 12, 10)
  const p = geo.attributes.position, uv = geo.attributes.uv
  for (let i = 0; i < p.count; i++) p.setXYZ(i, ...at(uv.getX(i), uv.getY(i)).toArray())
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, toon('#ffffff', { map, side: THREE.DoubleSide }))
  mesh.add(edgeLines(at, [[0, 0, 1, 0], [0, 1, 1, 1], [0, 0, 0, 1], [1, 0, 1, 1]]))
  return mesh
}

/** Vela triangular (latina) entre `a`, `b` e `c`, estufada para o lado (+x). */
export function triSail(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, bulge: number, map: THREE.Texture) {
  // (s, t): s ao longo de a→b, t de a/b até c.
  const at = (s: number, t: number) => {
    const top = a.clone().lerp(b, s)
    const q = top.lerp(c, t)
    q.x += bulge * Math.sin(Math.PI * s) * Math.sin(Math.PI * Math.min(1, t * 1.4)) * (1 - t)
    return q
  }
  const pos: number[] = [], uv: number[] = []
  const N = 10
  // Textura projetada: u ao longo da verga (a→b), então as listras ficam paralelas entre si.
  const ab = b.clone().sub(a), abLen = ab.length()
  ab.divideScalar(abLen)
  const put = (s: number, t: number) => {
    const q = at(s, t)
    pos.push(q.x, q.y, q.z)
    uv.push(q.clone().sub(a).dot(ab) / abLen, t)
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const s0 = j / N, s1 = (j + 1) / N, t0 = i / N, t1 = (i + 1) / N
      put(s0, t0); put(s1, t0); put(s0, t1)
      put(s1, t0); put(s1, t1); put(s0, t1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, toon('#ffffff', { map, side: THREE.DoubleSide }))
  mesh.add(edgeLines(at, [[0, 0, 1, 0], [0, 0, 0, 1], [1, 0, 1, 1]]))
  return mesh
}

/** Anéis escuros ao longo de um mastro ou verga (de `a` a `b`), como as amarrações. */
export function bands(a: THREE.Vector3, b: THREE.Vector3, r: number, n: number, color = '#3e2518') {
  const g = new THREE.Group()
  const dir = b.clone().sub(a).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  const geo = new THREE.CylinderGeometry(r * 1.18, r * 1.18, a.distanceTo(b) / n * 0.38, 8)
  const mat = toon(color)
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat)
    m.position.copy(a).lerp(b, (i + 0.5) / n)
    m.quaternion.copy(q)
    g.add(m)
  }
  return g
}

let flagTex: THREE.Texture | null = null

/**
 * Bandeira pirata preta, ondulada, presa ao mastro na origem do grupo e apontando para a popa
 * (+z); o símbolo ocupa quase toda a altura.
 */
export function pirateFlag(width: number) {
  flagTex ??= canvasTexture(384, 256, (ctx) => {
    ctx.fillStyle = INK
    ctx.fillRect(0, 0, 384, 256)
    drawJolly(ctx, 192, 124, 1.08)
  })
  const h = width * (256 / 384)
  const geo = new THREE.PlaneGeometry(width, h, 16, 4)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + width / 2 // 0 no mastro → width na ponta
    const y = p.getY(i)
    p.setZ(i, Math.sin((x / width) * Math.PI * 2.2) * 0.07 * x + Math.sin(y / h * 3) * 0.01 * x / width)
  }
  geo.computeVertexNormals()
  const cloth = new THREE.Mesh(geo, toon('#ffffff', { map: flagTex, side: THREE.DoubleSide }))
  cloth.rotation.y = Math.PI / 2
  cloth.position.set(0, 0, width / 2)
  const e = new THREE.EdgesGeometry(geo, 60) // só a borda, não as ondas
  cloth.add(new THREE.LineSegments(e, lineMaterial()))
  const g = new THREE.Group()
  g.add(cloth)
  return g
}
