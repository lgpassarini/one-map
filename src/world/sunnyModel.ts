import * as THREE from 'three'
import {
  ball,
  canvasTexture,
  clipY,
  drawJolly,
  finishParts,
  layer,
  lineMaterial,
  newParts,
  outlined,
  pirateFlag,
  rect,
  shapeOf,
  spar,
  squareSail,
  toon,
  v,
} from './shipParts'

// Thousand Sunny feito à mão, no estilo do terreno: casco vermelho com friso branco e fundo de
// madeira, cabeça de leão na proa, duas velas quadradas, cúpulas listradas, gramado no convés.
// Comprimento ~1, proa em -z, quilha abaixo da água (y = 0).

const C = {
  bottom: '#b98a55',
  wood: '#d6ab72',
  red: '#b8332e',
  trim: '#f6f3ec',
  lawn: '#7cbf4e',
  deck: '#a8784c',
  house: '#d8563a',
  cream: '#f3e3b8',
  window: '#4e6a74',
  mast: '#7a4b2a',
  mane: '#ef6d23',
  maneDark: '#c9481c',
  face: '#f5d33a',
  snout: '#f4f1ea',
  eye: '#231c18',
  bone: '#ffffff',
  cannon: '#8d939a',
  wheel: '#2b2b30',
  sail: '#f4f1ea',
  domeA: '#cbd43c',
  domeB: '#d8433b',
}

/** Casco visto de cima (proa em +y): mais largo e redondo que o do Merry. */
function hullPts(k: number, w = 1) {
  const s = new THREE.Shape()
  s.moveTo(-0.2 * k * w, -0.42 * k)
  s.quadraticCurveTo(0, -0.46 * k, 0.2 * k * w, -0.42 * k)
  s.bezierCurveTo(0.3 * k * w, -0.3 * k, 0.3 * k * w, 0.2 * k, 0, 0.42 * k)
  s.bezierCurveTo(-0.3 * k * w, 0.2 * k, -0.3 * k * w, -0.3 * k, -0.2 * k * w, -0.42 * k)
  return s.getPoints(20)
}

/** Meia largura do casco (k = 1) na posição `y` da vista de cima. */
function halfWidth(y: number) {
  const pts = hullPts(1)
  let best = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) best = Math.max(best, Math.abs(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)))
  }
  return best
}

function railRing(y0: number, y1: number, gap = 0.005) {
  return shapeOf(clipY(hullPts(1), y0, y1), [clipY(hullPts(0.92, 0.9), y0 + gap, y1 - gap)])
}

const plainSail = () =>
  canvasTexture(256, 200, (ctx) => {
    ctx.fillStyle = C.sail
    ctx.fillRect(0, 0, 256, 200)
    ctx.strokeStyle = 'rgba(110, 110, 120, 0.18)'
    ctx.lineWidth = 2
    for (let x = 32; x < 256; x += 32) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, 200)
      ctx.stroke()
    }
  })

const mainSailTexture = () =>
  canvasTexture(512, 400, (ctx) => {
    ctx.drawImage(plainSail().image as HTMLCanvasElement, 0, 0, 512, 400)
    drawJolly(ctx, 256, 205, 1.5)
  })

let domeTex: THREE.Texture | null = null
/** Cúpula verde-amarelada com quatro faixas vermelhas estreitas, como as do Sunny. */
function dome(r: number) {
  domeTex ??= canvasTexture(256, 64, (ctx) => {
    ctx.fillStyle = C.domeA
    ctx.fillRect(0, 0, 256, 64)
    ctx.fillStyle = C.domeB
    for (let i = 0; i < 4; i++) ctx.fillRect(32 + i * 64 - 11, 0, 22, 64)
  })
  return outlined(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#ffffff', { map: domeTex }), 0.004)
}

/**
 * Torre redonda creme com janelas estreitas, cúpula listrada mais larga que a torre e duas
 * orelhinhas vermelhas (cesto de gávea, observatório).
 */
function tower(r: number, h: number, x: number, y: number, z: number) {
  const g = new THREE.Group()
  const base = outlined(new THREE.CylinderGeometry(r, r, h, 18), toon(C.cream), 0.004)
  base.position.y = h / 2
  const disk = outlined(new THREE.CylinderGeometry(r * 1.4, r * 1.4, 0.012, 18), toon('#c9ccd2'), 0.003)
  disk.position.y = 0.006
  const top = dome(r * 1.3)
  top.position.y = h
  g.add(base, disk, top)
  const win = new THREE.BoxGeometry(r * 0.22, h * 0.42, 0.004)
  const winMat = toon(C.window)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3
    const w = new THREE.Mesh(win, winMat)
    w.position.set(Math.sin(a) * (r + 0.001), h * 0.52, Math.cos(a) * (r + 0.001))
    w.rotation.y = a
    g.add(w)
  }
  for (const sx of [-1, 1]) {
    const ear = outlined(new THREE.ConeGeometry(r * 0.32, r * 0.7, 4), toon(C.domeB), 0.003)
    ear.position.set(sx * r * 1.0, h + r * 1.05, 0) // por fora da cúpula (raio 1,3r)
    ear.rotation.z = -sx * 0.7
    g.add(ear)
  }
  g.position.set(x, y, z)
  return g
}

/** Pétala da juba: lâmina pontuda e curva, base na origem, ponta para +y. */
function maneBlade(len: number, w: number) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2, 0)
  s.quadraticCurveTo(-w * 0.35, len * 0.55, w * 0.35, len)
  s.quadraticCurveTo(w * 0.15, len * 0.5, w / 2, 0)
  s.lineTo(-w / 2, 0)
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: false, curveSegments: 6 })
  const m = new THREE.Mesh(geo, toon(C.mane))
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), lineMaterial()))
  return m
}

/**
 * Cabeça de leão: juba de pétalas pontudas como raios de sol, rosto amarelo achatado, olhos
 * brancos com pupila, focinho branco com nariz preto e os ossos cruzados atrás.
 */
function lion() {
  const g = new THREE.Group()
  const cx = 0, cy = 0.33, cz = -0.47
  // Ossos cruzados atrás da juba; as pontas saem um pouco além dos raios.
  for (const d of [1, -1]) {
    const a = v(cx - 0.19 * d, cy + 0.19, cz + 0.05), b = v(cx + 0.19 * d, cy - 0.19, cz + 0.05)
    g.add(spar(a, b, 0.012, 0.012, C.bone))
    for (const p of [a, b]) {
      const side = v(-(b.y - a.y), b.x - a.x, 0).normalize().multiplyScalar(0.015)
      g.add(ball(0.018, C.bone, p.x + side.x, p.y + side.y, p.z, 0.003, 10))
      g.add(ball(0.018, C.bone, p.x - side.x, p.y - side.y, p.z, 0.003, 10))
    }
  }
  // Juba: disco escuro atrás e pétalas curvas em volta.
  const back = outlined(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 24), toon(C.maneDark), 0.004)
  back.rotation.x = Math.PI / 2
  back.position.set(cx, cy, cz + 0.025)
  g.add(back)
  const N = 10
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    const blade = maneBlade(i % 2 ? 0.115 : 0.13, 0.07)
    blade.position.set(cx + Math.sin(a) * 0.07, cy + Math.cos(a) * 0.07, cz + 0.002)
    blade.rotation.z = -a
    g.add(blade)
  }
  // Rosto: esfera achatada (escala junto com o contorno).
  const F = v(cx, cy, cz - 0.01), FR = v(0.085, 0.085, 0.064)
  const face = outlined(new THREE.SphereGeometry(1, 28, 20), toon(C.face), 0.06)
  face.position.copy(F)
  face.scale.copy(FR)
  g.add(face)
  const onFace = (x: number, y: number) => cz - 0.01 - FR.z * Math.sqrt(Math.max(0, 1 - (x / FR.x) ** 2 - (y / FR.y) ** 2))
  for (const sx of [-1, 1]) {
    const ex = sx * 0.04, ey = 0.024, ez = onFace(ex, ey)
    const eye = outlined(new THREE.SphereGeometry(1, 16, 12), toon('#ffffff'), 0.15)
    eye.position.set(cx + ex, cy + ey, ez)
    eye.scale.set(0.02, 0.022, 0.01)
    g.add(eye)
    g.add(ball(0.0105, C.eye, cx + ex, cy + ey, ez - 0.008, 0, 10))
  }
  // Focinho branco com nariz preto e o risquinho da boca.
  const mz = onFace(0, -0.03) + 0.004
  const muzzle = outlined(new THREE.SphereGeometry(1, 20, 14), toon(C.snout), 0.09)
  muzzle.position.set(cx, cy - 0.03, mz)
  muzzle.scale.set(0.044, 0.035, 0.028)
  g.add(muzzle)
  g.add(ball(0.011, C.eye, cx, cy - 0.013, mz - 0.024, 0, 10))
  const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.022, 6), toon(C.eye))
  mouth.position.set(cx, cy - 0.03, mz - 0.028)
  g.add(mouth)
  return g
}


export function buildSunny() {
  const parts = newParts()
  const FORE = 0.2
  const AFT = -0.12

  // Casco: fundo e parte de baixo de madeira, painel vermelho, friso branco; gramado no convés.
  layer(shapeOf(hullPts(0.84, 0.8)), -0.14, -0.03, C.bottom, parts)
  layer(shapeOf(hullPts(0.95, 0.94)), -0.03, 0.06, C.wood, parts)
  layer(shapeOf(hullPts(1)), 0.06, 0.22, C.red, parts)
  layer(shapeOf(hullPts(1.02, 1.035)), 0.22, 0.24, C.trim, parts)
  layer(shapeOf(clipY(hullPts(0.92, 0.9), AFT, FORE)), 0.24, 0.246, C.lawn, parts)
  layer(railRing(AFT, FORE), 0.24, 0.3, C.trim, parts)

  // Castelo de proa (madeira) e tombadilho, os dois com amurada branca.
  layer(shapeOf(clipY(hullPts(1), FORE, 1)), 0.24, 0.312, C.red, parts)
  layer(shapeOf(clipY(hullPts(1), FORE, 1)), 0.312, 0.32, C.deck, parts)
  layer(railRing(FORE, 1), 0.32, 0.37, C.trim, parts)
  layer(shapeOf(clipY(hullPts(1), -1, AFT)), 0.24, 0.352, C.red, parts)
  layer(shapeOf(clipY(hullPts(1), -1, AFT)), 0.352, 0.36, C.deck, parts)
  layer(railRing(-1, AFT), 0.36, 0.41, C.trim, parts)
  // Faixas brancas verticais dividindo o painel vermelho.
  for (const y of [-0.28, -0.02, 0.22]) {
    const w = halfWidth(y)
    for (const sx of [-1, 1]) layer(rect(sx * w - 0.012, y - 0.012, sx * w + 0.012, y + 0.012), 0.05, 0.24, C.trim, parts)
  }

  // Casinha de ré (vermelho-alaranjada) com porta e janelas creme.
  layer(rect(-0.14, -0.36, 0.14, -0.2), 0.36, 0.5, C.house, parts)
  layer(rect(-0.15, -0.37, 0.15, -0.19), 0.5, 0.515, C.cream, parts)
  layer(rect(-0.03, -0.2, 0.03, -0.194), 0.36, 0.46, C.cream, parts)
  for (const x of [-0.09, 0.09]) layer(rect(x - 0.022, -0.2, x + 0.022, -0.194), 0.41, 0.46, C.window, parts)
  // Escada da frente do tombadilho.
  for (let i = 0; i < 3; i++) layer(rect(-0.05, AFT + 0.005 + i * 0.02, 0.05, AFT + 0.025 + i * 0.02), 0.24, 0.35 - i * 0.04, C.deck, parts)

  const group = new THREE.Group()
  group.add(...finishParts(parts))

  // Canhões dos lados e as rodas de pás perto da popa.
  for (const sx of [-1, 1]) {
    for (const [y, h] of [[0.12, 0.17], [0.05, 0.12], [0.08, 0.09]] as const) {
      const w = halfWidth(y)
      group.add(spar(v(sx * (w - 0.01), h, -y), v(sx * (w + 0.04), h, -y), 0.014, 0.012, C.cannon))
    }
    const wy = -0.3, w = halfWidth(wy)
    const wheel = outlined(new THREE.TorusGeometry(0.075, 0.016, 8, 24), toon(C.wheel), 0.003)
    wheel.position.set(sx * (w + 0.01), 0.1, -wy)
    wheel.rotation.y = Math.PI / 2
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24), toon(C.red, { side: THREE.DoubleSide }))
    wheel.add(hub)
    group.add(wheel)
  }

  // Observatório em cima da casinha.
  group.add(tower(0.06, 0.08, 0, 0.515, 0.28))

  // Mastro principal: vela grande com o Jolly Roger, cesto de gávea com cúpula e bandeira.
  const MZ = -0.02
  group.add(spar(v(0, 0.24, MZ), v(0, 1.28, MZ), 0.024, 0.014, C.mast))
  group.add(spar(v(-0.36, 0.94, MZ - 0.026), v(0.36, 0.94, MZ - 0.026), 0.012, 0.012, C.mast))
  group.add(squareSail(0.66, 0.52, 0.68, MZ - 0.034, 0.11, mainSailTexture()))
  group.add(tower(0.05, 0.06, 0, 0.99, MZ))

  // Mastro de ré com vela lisa, mais alta.
  const RZ = 0.15
  group.add(spar(v(0, 0.36, RZ), v(0, 1.22, RZ), 0.018, 0.011, C.mast))
  group.add(spar(v(-0.27, 1.05, RZ - 0.022), v(0.27, 1.05, RZ - 0.022), 0.01, 0.01, C.mast))
  group.add(squareSail(0.5, 0.42, 0.84, RZ - 0.03, 0.09, plainSail()))

  // Cordame.
  const rig: number[] = []
  const line = (a: THREE.Vector3, b: THREE.Vector3) => rig.push(...a.toArray(), ...b.toArray())
  line(v(0, 1.15, MZ), v(0, 0.37, -0.38))
  line(v(0, 1.12, MZ), v(0, 1.1, RZ))
  line(v(0, 1.12, RZ), v(0, 0.41, 0.42))
  for (const sx of [-1, 1]) {
    for (const dz of [-0.05, 0.05]) line(v(0, 0.96, MZ), v(sx * 0.27, 0.3, MZ + dz))
    line(v(0, 1.0, RZ), v(sx * 0.25, 0.41, RZ + 0.03))
  }
  const rg = new THREE.BufferGeometry()
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rig, 3))
  group.add(new THREE.LineSegments(rg, lineMaterial()))

  // Bandeiras piratas no topo dos mastros (a do principal tremula).
  const flag = pirateFlag(0.2)
  flag.position.set(0, 1.18, MZ)
  const flag2 = pirateFlag(0.16)
  flag2.position.set(0, 1.15, RZ)
  group.add(flag, flag2)

  group.add(lion())
  return { group, flag, flagYaw: 0 }
}
