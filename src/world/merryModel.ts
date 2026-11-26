import * as THREE from 'three'
import {
  canvasTexture,
  clipY,
  drawJolly,
  finishParts,
  layer,
  lineMaterial,
  newParts,
  outlined,
  rect,
  shapeOf,
  spar,
  ball,
  squareSail,
  bands,
  toon,
  triSail,
  pirateFlag,
  v,
} from './shipParts'

// Going Merry feito à mão, no estilo do terreno: casco em camadas extrudadas (topo claro, parede
// escura, contorno), peças arredondadas (carneiro, mastros) com contorno de desenho, velas
// estufadas com o Jolly Roger desenhado num canvas. Comprimento ~1, proa em -z, quilha abaixo
// da água (y = 0).

const C = {
  keel: '#6b4128',
  hullLow: '#b27c4e',
  deck: '#cf9a64',
  band: '#55545c',
  rail: '#f6f1e6',
  door: '#5a3a22',
  porthole: '#d9b45a',
  mast: '#8a5a34',
  wood: '#a8724a',
  sheep: '#fbf8f0',
  horn: '#5c3a26',
  eye: '#231c18',
  leaf: '#5fa04a',
  orange: '#f08a24',
  sail: '#f3ead8',
  red: '#d8433b',
}

/** Casco visto de cima (comprimento ~0,92 em y, proa em +y): popa larga e proa bojuda. */
function hullPts(k: number, w = 1) {
  const s = new THREE.Shape()
  s.moveTo(-0.17 * k * w, -0.45 * k)
  s.quadraticCurveTo(0, -0.49 * k, 0.17 * k * w, -0.45 * k)
  s.bezierCurveTo(0.25 * k * w, -0.3 * k, 0.24 * k * w, 0.25 * k, 0, 0.44 * k)
  s.bezierCurveTo(-0.24 * k * w, 0.25 * k, -0.25 * k * w, -0.3 * k, -0.17 * k * w, -0.45 * k)
  return s.getPoints(16)
}

/** Amurada: anel entre o casco e o casco encolhido, recortado à faixa [y0, y1] (vista de cima). */
function railRing(y0: number, y1: number, gap = 0.005) {
  return shapeOf(clipY(hullPts(1), y0, y1), [clipY(hullPts(0.91, 0.88), y0 + gap, y1 - gap)])
}

/** Pano creme com pregas verticais (sombra em cada prega) e o Jolly Roger grande no meio. */
const mainSailTexture = (folds: number) =>
  canvasTexture(512, 400, (ctx) => {
    ctx.fillStyle = C.sail
    ctx.fillRect(0, 0, 512, 400)
    const fw = 512 / folds
    for (let i = 0; i < folds; i++) {
      const gr = ctx.createLinearGradient(i * fw, 0, (i + 1) * fw, 0)
      gr.addColorStop(0, 'rgba(120, 95, 60, 0.16)')
      gr.addColorStop(0.45, 'rgba(255, 255, 255, 0.10)')
      gr.addColorStop(1, 'rgba(120, 95, 60, 0.16)')
      ctx.fillStyle = gr
      ctx.fillRect(i * fw, 0, fw, 400)
    }
    drawJolly(ctx, 256, 208, 1.55)
  })

/** Listras amarelas e vermelhas (descem da verga). */
const stripedTexture = () =>
  canvasTexture(256, 64, (ctx) => {
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? '#f3d34a' : C.red
      ctx.fillRect(i * (256 / 12), 0, 256 / 12 + 1, 64)
    }
  })

/** Tubo que afina de `r0` a `r1` ao longo dos pontos (chifres), com contorno e ponta arredondada. */
function taperTube(pts: THREE.Vector3[], r0: number, r1: number, color: string) {
  const curve = new THREE.CatmullRomCurve3(pts)
  const segs = 64, rad = 10
  const geo = new THREE.TubeGeometry(curve, segs, 1, rad, false)
  const p = geo.attributes.position
  const c = new THREE.Vector3(), q = new THREE.Vector3()
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, c)
    const r = r0 + (r1 - r0) * (i / segs)
    for (let j = 0; j <= rad; j++) {
      const k = i * (rad + 1) + j
      q.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c)
      p.setXYZ(k, q.x, q.y, q.z)
    }
  }
  const g = new THREE.Group()
  g.add(outlined(geo, toon(color), 0.004))
  const end = pts[pts.length - 1]
  g.add(ball(r1, color, end.x, end.y, end.z, 0.004, 10))
  return g
}

/**
 * Cabeça de carneiro na proa: cabeça branca alongada para a frente, olhos pequenos dos lados,
 * sorriso, e chifres marrom-escuros grossos enrolando em espiral para trás e afinando.
 */
function sheep() {
  const g = new THREE.Group()
  g.add(spar(v(0, 0.2, -0.4), v(0, 0.44, -0.46), 0.05, 0.036, C.sheep))
  // Cabeça: elipsoide (esfera unitária escalada; o contorno escala junto).
  const H = v(0, 0.47, -0.52), R = v(0.058, 0.055, 0.1)
  const head = outlined(new THREE.SphereGeometry(1, 28, 20), toon(C.sheep), 0.075)
  head.position.copy(H)
  head.scale.copy(R)
  g.add(head)
  /** Ponto na superfície da cabeça na direção local (x, y, z), um pouco para fora. */
  const onHead = (x: number, y: number, z: number, out = 0) => {
    const d = v(x / R.x, y / R.y, z / R.z)
    const k = 1 / d.length()
    const p = v(x * k, y * k, z * k)
    const n = v(p.x / R.x ** 2, p.y / R.y ** 2, p.z / R.z ** 2).normalize()
    return { p: p.add(H).addScaledVector(n, out), n }
  }
  for (const sx of [-1, 1]) {
    // Olho: branco pequeno com pupila preta, do lado da frente da cabeça.
    const e = onHead(sx * 0.042, 0.014, -0.062, 0.004)
    g.add(ball(0.014, '#ffffff', e.p.x, e.p.y, e.p.z, 0.003, 12))
    const pp = e.p.clone().addScaledVector(e.n, 0.009)
    g.add(ball(0.0085, C.eye, pp.x, pp.y, pp.z, 0, 8))
    // Chifre: sai do alto da cabeça, enrola para trás, para baixo e para a frente, para fora.
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 50; i++) {
      const t = i / 50
      const th = -0.3 + t * Math.PI * 2 * 1.3
      const r = 0.05 * (1 - 0.78 * t)
      pts.push(v(sx * (0.04 + 0.045 * t), 0.475 + r * Math.cos(th), -0.455 + r * Math.sin(th)))
    }
    g.add(taperTube(pts, 0.026, 0.009, C.horn))
  }
  // Sorriso: curva na parte de baixo da frente do focinho, subindo nas pontas.
  const smile: THREE.Vector3[] = []
  for (let i = 0; i <= 16; i++) {
    const a = -1 + (2 * i) / 16
    smile.push(onHead(0.042 * a, -0.024 + 0.014 * a * a, -1, 0.0015).p)
  }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(smile), 24, 0.0032, 6), toon(C.eye)))
  return g
}

/** Pé de tangerina num vaso, sobre o tombadilho. */
function tangerine(x: number, z: number, y: number) {
  const g = new THREE.Group()
  const box = outlined(new THREE.BoxGeometry(0.07, 0.04, 0.07), toon(C.wood), 0.003)
  box.position.set(x, y + 0.02, z)
  g.add(box)
  g.add(spar(v(x, y + 0.04, z), v(x, y + 0.1, z), 0.008, 0.006, C.mast))
  const leaf = outlined(new THREE.IcosahedronGeometry(0.05, 0), toon(C.leaf), 0.004)
  leaf.position.set(x, y + 0.13, z)
  g.add(leaf)
  for (const [dx, dy, dz] of [[0.035, 0.0, 0.025], [-0.03, 0.02, 0.03], [0.01, -0.02, -0.04], [-0.035, -0.01, -0.01]]) {
    g.add(ball(0.012, C.orange, x + dx, y + 0.13 + dy, z + dz, 0, 8))
  }
  return g
}

/** Vigia (janela redonda dourada) numa parede, olhando para `normal`. */
function porthole(x: number, y: number, z: number, normal: THREE.Vector3) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.005, 6, 14), toon(C.porthole))
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.014, 14), toon('#3d4b57'))
  m.add(glass)
  m.position.set(x, y, z)
  m.lookAt(m.position.clone().add(normal))
  return m
}

export function buildMerry() {
  const parts = newParts()
  const FORE = 0.2 // início do castelo de proa (vista de cima, y)
  const AFT = -0.17 // fim do tombadilho

  // Casco: quilha, parte de baixo, faixa de metal, parte de cima (o topo é o convés).
  layer(shapeOf(hullPts(0.82, 0.74)), -0.12, -0.04, C.keel, parts)
  layer(shapeOf(hullPts(0.93, 0.9)), -0.04, 0.05, C.hullLow, parts)
  layer(shapeOf(hullPts(0.985, 0.98)), 0.05, 0.09, C.band, parts)
  layer(shapeOf(hullPts(1)), 0.09, 0.2, C.deck, parts)
  layer(shapeOf(hullPts(1.02, 1.035)), 0.185, 0.2, C.rail, parts) // friso branco no alto do casco

  // Convés do meio com amurada branca.
  layer(railRing(AFT, FORE), 0.2, 0.27, C.rail, parts)
  // Castelo de proa: mais alto, com amurada.
  layer(shapeOf(clipY(hullPts(1), FORE, 1)), 0.2, 0.29, C.deck, parts)
  layer(railRing(FORE, 1), 0.29, 0.34, C.rail, parts)
  // Tombadilho (sobre a cabine): ainda mais alto, com amurada.
  layer(shapeOf(clipY(hullPts(1), -1, AFT)), 0.2, 0.35, C.deck, parts)
  layer(railRing(-1, AFT), 0.35, 0.41, C.rail, parts)

  // Porta da cabine (na parede da frente do tombadilho).
  layer(rect(-0.035, AFT - 0.004, 0.035, AFT + 0.006), 0.2, 0.31, C.door, parts)
  // Escadas do convés para o tombadilho e para o castelo de proa.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      layer(rect(sx * 0.15 - 0.03, AFT + 0.005 + i * 0.02, sx * 0.15 + 0.03, AFT + 0.025 + i * 0.02), 0.2, 0.33 - i * 0.045, C.wood, parts)
    }
  }
  for (let i = 0; i < 2; i++) layer(rect(-0.04, FORE - 0.025 - i * 0.02, 0.04, FORE - 0.005 - i * 0.02), 0.2, 0.27 - i * 0.035, C.wood, parts)

  const group = new THREE.Group()
  group.add(...finishParts(parts))

  // Vigias: na frente da cabine e nos lados do tombadilho.
  for (const x of [-0.1, 0.1]) group.add(porthole(x, 0.275, -AFT - 0.007, v(0, 0, -1)))
  for (const sx of [-1, 1]) for (const z of [0.26, 0.36]) group.add(porthole(sx * 0.218, 0.275, z, v(sx, 0, 0)))

  // Mastro principal: mastro, verga, vela com o Jolly Roger e cesto de gávea (balde).
  const MZ = 0.0
  group.add(spar(v(0, 0.2, MZ), v(0, 1.17, MZ), 0.02, 0.012), bands(v(0, 0.3, MZ), v(0, 0.84, MZ), 0.018, 7))
  group.add(spar(v(-0.3, 0.86, MZ - 0.024), v(0.3, 0.86, MZ - 0.024), 0.011), bands(v(-0.29, 0.86, MZ - 0.024), v(0.29, 0.86, MZ - 0.024), 0.011, 13))
  group.add(squareSail(0.54, 0.46, 0.63, MZ - 0.032, 0.09, mainSailTexture(7), 7))
  const nest = outlined(new THREE.CylinderGeometry(0.075, 0.058, 0.08, 14), toon(C.wood), 0.004)
  nest.position.set(0, 0.95, MZ)
  group.add(nest)

  // Mastro de ré com a vela triangular listrada.
  const RZ = 0.3
  group.add(spar(v(0, 0.35, RZ), v(0, 1.0, RZ), 0.014, 0.009))
  const yA = v(0, 0.9, RZ - 0.05), yB = v(0, 0.6, RZ + 0.36)
  group.add(spar(yA, yB, 0.007))
  group.add(triSail(yA.clone().add(v(0, -0.012, 0.01)), yB.clone().add(v(0, -0.012, 0)), v(0, 0.47, RZ + 0.02), 0.035, stripedTexture()))

  // Cordame: estais para a proa e a popa, enxárcias para os lados.
  const rig: number[] = []
  const line = (a: THREE.Vector3, b: THREE.Vector3) => rig.push(...a.toArray(), ...b.toArray())
  line(v(0, 1.05, MZ), v(0, 0.33, -0.39))
  line(v(0, 1.0, MZ), v(0, 0.92, RZ))
  line(v(0, 0.95, RZ), v(0, 0.41, 0.45))
  for (const sx of [-1, 1]) {
    for (const dz of [-0.05, 0, 0.05]) line(v(0, 0.92, MZ), v(sx * 0.215, 0.27, MZ + dz))
    line(v(0, 0.88, RZ), v(sx * 0.19, 0.41, RZ + 0.02))
  }
  const rg = new THREE.BufferGeometry()
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rig, 3))
  group.add(new THREE.LineSegments(rg, lineMaterial()))

  // Bandeiras piratas no topo dos mastros (a do principal tremula).
  const flag = pirateFlag(0.2)
  flag.position.set(0, 1.08, MZ)
  const flag2 = pirateFlag(0.14)
  flag2.position.set(0, 0.92, RZ)
  group.add(flag, flag2)

  group.add(sheep())
  group.add(tangerine(-0.11, 0.24, 0.35), tangerine(0.11, 0.24, 0.35))
  return { group, flag, flagYaw: 0 }
}
