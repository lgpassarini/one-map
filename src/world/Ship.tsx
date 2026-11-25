import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import route from '../data/route.json'
import { cameraState } from './cameraState'
import { shipState } from './shipState'
import { toonRamp } from './toon'
import { createTrail } from './Trail'

// Protótipo do navio: um bote provisório que faz a rota de geo/places.json em vai e volta
// (Foosha → Shells Town → Orange Town → … → Foosha), parando em cada porto. A rota vem de
// scripts/build-route.mjs (src/data/route.json); aqui uma curva suave passa pelos pontos.
//
// O bote é feito como o terreno: camadas extrudadas com topo claro e parede mais escura,
// toon shading e contorno fino no alto de cada camada.

const SHIP_LEN = 2.2 // comprimento do navio parado (peça de tabuleiro)
const SAIL_SCALE = 0.45 // navegando, encolhe
const MIN_SCREEN = 0.022 // comprimento mínimo = distância da câmera × isto (não some ao afastar)
const PAUSE = 1.8 // s parado em cada porto
const SPEED = 10 // unidades/s; a duração fica entre MIN_TRIP e MAX_TRIP
const MIN_TRIP = 3
const MAX_TRIP = 7
const ACCEL = 0.28 // fração da viagem acelerando (e o mesmo freando)
const GROW_BEFORE = 0.7 // s antes de chegar em que o navio começa a voltar ao tamanho cheio

// Dev: ?shipt=segundos adianta a animação (para screenshots).
const START_T = Number(new URLSearchParams(window.location.search).get('shipt')) || 0
const WARMUP = 3 // s simulados antes do primeiro quadro quando ?shipt é usado

type Trip = { curve: THREE.CatmullRomCurve3; reverse: boolean; duration: number }

function buildTrips(): Trip[] {
  const legs = route.legs.map((leg) => {
    const curve = new THREE.CatmullRomCurve3(
      leg.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      'centripetal',
    )
    curve.arcLengthDivisions = Math.max(200, leg.points.length * 8)
    const duration = THREE.MathUtils.clamp(leg.length / SPEED, MIN_TRIP, MAX_TRIP)
    return { curve, duration }
  })
  // Ida pelas pernas e volta pelas mesmas, de trás para frente.
  return [...legs.map((l) => ({ ...l, reverse: false })), ...[...legs].reverse().map((l) => ({ ...l, reverse: true }))]
}

/** Posição (0..1) ao longo da viagem: acelera, navega em velocidade constante e freia. */
function travel(t: number) {
  const a = ACCEL
  const v = 1 / (1 - a)
  if (t < a) return (v * t * t) / (2 * a)
  if (t < 1 - a) return v * (t - a / 2)
  const r = 1 - t
  return 1 - (v * r * r) / (2 * a)
}

/** Aproxima `x` de `to` com amortecimento exponencial (independente do framerate). */
const damp = (x: number, to: number, rate: number, dt: number) => x + (to - x) * (1 - Math.exp(-rate * dt))
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

/** Ondas de mentira: altura da água num ponto (só para o balanço do barco; o mar é plano). */
const wave = (x: number, z: number, t: number) =>
  0.5 * Math.sin(0.9 * x + 1.3 * t) + 0.35 * Math.sin(1.1 * z - 1.7 * t + 1.0) + 0.25 * Math.sin(0.6 * (x + z) + 2.1 * t)

// ---------- Modelo ----------
const LINE_COLOR = '#3b2a20' // o mesmo do contorno do terreno

/** Forma do casco vista de cima (comprimento 1 em y, proa em +y), escalada por `k`. */
function hullShape(k: number, w = 1) {
  const s = new THREE.Shape()
  s.moveTo(-0.2 * k * w, -0.5 * k)
  s.quadraticCurveTo(0, -0.56 * k, 0.2 * k * w, -0.5 * k)
  s.quadraticCurveTo(0.27 * k * w, 0.08 * k, 0, 0.5 * k)
  s.quadraticCurveTo(-0.27 * k * w, 0.08 * k, -0.2 * k * w, -0.5 * k)
  return s
}

const rect = (x0: number, y0: number, x1: number, y1: number) => {
  const s = new THREE.Shape()
  s.moveTo(x0, y0)
  s.lineTo(x1, y0)
  s.lineTo(x1, y1)
  s.lineTo(x0, y1)
  return s
}

type Parts = { pos: number[]; col: number[]; lines: number[] }

/**
 * Camada extrudada como as do terreno: topo na cor `top`, parede 0,72× mais escura, e o
 * contorno do topo em `lines`. A forma (x, y) vira (x, -z): proa para -z.
 */
function layer(shape: THREE.Shape, y0: number, y1: number, top: string, parts: Parts) {
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
}

function buildDinghy() {
  const parts: Parts = { pos: [], col: [], lines: [] }
  // Casco em dois degraus: fundo (metade dentro d'água) e borda mais larga, oca por dentro.
  layer(hullShape(0.86, 0.92), -0.1, 0.07, '#c98a4b', parts)
  const rim = hullShape(1)
  rim.holes.push(hullShape(0.8, 0.9))
  layer(rim, 0.07, 0.2, '#e3ad6a', parts)
  // Fundo por dentro, tábua de sentar e o mastro (quadrado, chapado).
  layer(hullShape(0.82, 0.9), 0.07, 0.1, '#8c5a32', parts)
  layer(rect(-0.17, -0.06, 0.17, 0.02), 0.1, 0.16, '#e3ad6a', parts)
  layer(rect(-0.03, 0.1, 0.03, 0.16), 0.1, 0.92, '#7a4b2a', parts)

  const gradientMap = toonRamp()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts.pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(parts.col, 3))
  g.computeVertexNormals() // não indexada → normais por face (chapado, como o terreno)
  const body = new THREE.Mesh(g, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }))
  const lineMat = new THREE.LineBasicMaterial({ color: LINE_COLOR, transparent: true, opacity: 0.7 })
  const lg = new THREE.BufferGeometry()
  lg.setAttribute('position', new THREE.Float32BufferAttribute(parts.lines, 3))
  const lines = new THREE.LineSegments(lg, lineMat)

  // Vela: triângulo estufado (a barriga dá os tons do toon shading), preso atrás do mastro.
  const H = 0.62, B = 0.46 // altura e base (até a popa)
  const pt = (u: number, v: number) => {
    // u: 0 = mastro → 1 = ponta da retranca; v: 0 = embaixo → 1 = topo
    const w = 1 - v
    const belly = Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v + 0.15)) * 0.08 * w
    return [belly, 0.26 + v * H, -0.11 + u * B * w]
  }
  const N = 8
  const sp: number[] = []
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const v0 = i / N, v1 = (i + 1) / N, u0 = j / N, u1 = (j + 1) / N
      const a = pt(u0, v0), b = pt(u1, v0), c = pt(u0, v1), d = pt(u1, v1)
      sp.push(...a, ...b, ...c, ...b, ...d, ...c)
    }
  }
  const sailGeo = new THREE.BufferGeometry()
  sailGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3))
  sailGeo.computeVertexNormals()
  const sail = new THREE.Mesh(sailGeo, new THREE.MeshToonMaterial({ color: '#f7eed8', gradientMap, side: THREE.DoubleSide }))
  const edge: number[] = []
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N
    edge.push(...pt(0, t0), ...pt(0, t1)) // no mastro
    edge.push(...pt(t0, 0), ...pt(t1, 0)) // embaixo
    edge.push(...pt(1, t0), ...pt(1, t1)) // borda de fuga
  }
  const se = new THREE.BufferGeometry()
  se.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3))
  const sailLines = new THREE.LineSegments(se, lineMat)

  // Bandeirinha vermelha no topo do mastro.
  const flagShape = new THREE.Shape()
  flagShape.moveTo(0, 0)
  flagShape.lineTo(0.17, -0.045)
  flagShape.lineTo(0, -0.09)
  const flag = new THREE.Mesh(
    new THREE.ShapeGeometry(flagShape),
    new THREE.MeshToonMaterial({ color: '#d8433b', gradientMap, side: THREE.DoubleSide }),
  )
  flag.position.set(0, 0.92, -0.13)
  flag.rotation.y = -Math.PI / 2 // aponta para a popa

  const group = new THREE.Group()
  group.add(body, lines, sail, sailLines, flag)
  return { group, flag }
}

export function Ship() {
  const trips = useMemo(() => buildTrips(), [])
  const dinghy = useMemo(() => buildDinghy(), [])
  const trail = useMemo(() => createTrail(), [])
  const flag = useRef(dinghy.flag)
  const ship = useRef<THREE.Group>(null)
  const st = useRef({
    trip: 0,
    t: START_T - PAUSE,
    clock: 0,
    last: new THREE.Vector3(),
    heading: 0,
    turnRate: 0,
    size: 1,
    motion: 0,
    init: false,
  })
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), tan: new THREE.Vector3() }), [])

  const warmed = useRef(false)

  function tick(g: THREE.Group, camera: THREE.Camera, controls: MapControlsImpl | null, dt: number) {
    const s = st.current
    s.clock += dt
    s.t += dt
    let trip = trips[s.trip]
    while (s.t > trip.duration) {
      s.t -= trip.duration + PAUSE
      s.trip = (s.trip + 1) % trips.length
      trip = trips[s.trip]
    }
    const sailing = s.t >= 0
    const u = sailing ? travel(s.t / trip.duration) : 0
    const along = trip.reverse ? 1 - u : u
    trip.curve.getPointAt(along, tmp.p)

    // Direção: navegando, olha um pouco à frente na curva; parado, vira devagar para a próxima saída.
    const ahead = trip.reverse ? Math.max(0, along - 0.02) : Math.min(1, along + 0.02)
    trip.curve.getTangentAt(sailing ? ahead : trip.reverse ? 1 : 0, tmp.tan)
    if (trip.reverse) tmp.tan.negate()
    const want = Math.atan2(-tmp.tan.x, -tmp.tan.z)
    if (!s.init) s.heading = want
    const before = s.heading
    s.heading += angleDiff(s.heading, want) * (1 - Math.exp(-dt * (sailing ? 5 : 1.6)))
    s.turnRate = damp(s.turnRate, angleDiff(before, s.heading) / Math.max(dt, 1e-3), 6, dt)

    // Câmera acompanha enquanto o navio está na área vista (se o usuário levou a vista para
    // longe, ela fica onde está).
    if (s.init && controls) {
      const dx = tmp.p.x - s.last.x, dz = tmp.p.z - s.last.z
      const [tx, tz] = cameraState.target
      const [hw, hh] = cameraState.half
      if ((dx || dz) && Math.abs(tmp.p.x - tx) < hw * 0.9 && Math.abs(tmp.p.z - tz) < hh * 0.9) {
        controls.target.x += dx
        controls.target.z += dz
        camera.position.x += dx
        camera.position.z += dz
      }
    }
    s.last.copy(tmp.p)
    s.init = true

    // Tamanho e "modo navegando" amortecidos: encolhe ao sair, volta a crescer perto de chegar.
    const cruising = sailing && s.t < trip.duration - GROW_BEFORE
    s.size = damp(s.size, cruising ? SAIL_SCALE : 1, cruising ? 5 : 3.5, dt)
    s.motion = damp(s.motion, cruising ? 1 : 0, 3, dt)
    const minLen = camera.position.distanceTo(tmp.p) * MIN_SCREEN
    const len = Math.max(SHIP_LEN * s.size, minLen)

    // Balanço na água: altura e inclinação vêm das ondas sob a proa, a popa e os lados.
    const fx = -Math.sin(s.heading), fz = -Math.cos(s.heading)
    const half = len * 0.45, side = len * 0.2
    const T = s.clock
    const hBow = wave(tmp.p.x + fx * half, tmp.p.z + fz * half, T)
    const hStern = wave(tmp.p.x - fx * half, tmp.p.z - fz * half, T)
    const hL = wave(tmp.p.x - fz * side, tmp.p.z + fx * side, T)
    const hR = wave(tmp.p.x + fz * side, tmp.p.z - fx * side, T)
    const amp = 0.035 * (1 - 0.4 * s.motion) // navegando, corta as ondas
    const heave = ((hBow + hStern + hL + hR) / 4) * amp * len
    const pitch = (hBow - hStern) * amp * 1.4 + s.motion * 0.05 // proa levanta um pouco ao navegar
    const roll = (hR - hL) * amp * 2.2 - THREE.MathUtils.clamp(s.turnRate * 0.12, -0.18, 0.18) // inclina nas curvas

    g.position.set(tmp.p.x, heave, tmp.p.z)
    g.rotation.set(pitch, s.heading, roll, 'YXZ')
    g.scale.setScalar(len)
    flag.current.rotation.y = -Math.PI / 2 + Math.sin(T * 7) * 0.3 // tremula

    // Rastro na água a partir da popa, enquanto navega.
    const stern = { x: tmp.p.x - fx * len * 0.42, z: tmp.p.z - fz * len * 0.42 }
    trail.update(dt, sailing && s.motion > 0.05 ? stern : null, len)

    shipState.pos = [tmp.p.x, tmp.p.z]
    shipState.sailing = sailing
  }

  useFrame((state, rawDt) => {
    const g = ship.current
    if (!g || !trips.length) return
    const controls = state.controls as MapControlsImpl | null
    // Dev (?shipt): simula os segundos anteriores, para o rastro já existir no screenshot.
    if (!warmed.current) {
      warmed.current = true
      if (START_T > 0) {
        st.current.t -= WARMUP
        for (let i = 0; i < WARMUP * 30; i++) tick(g, state.camera, controls, 1 / 30)
      }
    }
    tick(g, state.camera, controls, Math.min(rawDt, 0.1))
  })

  return (
    <>
      <group ref={ship}>
        <primitive object={dinghy.group} />
      </group>
      <primitive object={trail.mesh} />
    </>
  )
}
