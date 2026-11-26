import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import route from '../data/route.json'
import { episodeStore, stopOf } from '../state/episode'
import { cameraState } from './cameraState'
import { shipState } from './shipState'
import { toonRamp } from './toon'
import { buildMerry } from './merryModel'
import { finishParts, layer, lineMaterial, newParts, rect } from './shipParts'
import { shipSize, type ShipModelId } from './shipModels'
import { buildSunny } from './sunnyModel'
import { createTrail } from './Trail'

// Navio do bando. No modo `viagem` (o normal), ele fica na parada do episódio atual e, quando outro
// episódio é escolhido na barra, navega pela rota até a parada dele (de ida ou de volta, passando
// direto pelas paradas do meio). A rota vem de scripts/build-route.mjs (src/data/route.json, na
// ordem dos episódios); aqui uma curva suave passa pelos pontos.
// Dev (?navios): protótipo com a rota inteira em vai e volta e voltas em mar aberto.
//
// O bote é feito como o terreno: camadas extrudadas com topo claro e parede mais escura,
// toon shading e contorno fino no alto de cada camada.

const SHIP_LEN = 2.7 // comprimento do navio parado (peça de tabuleiro)
const TURN_STOPPED = 0.8 // rad/s: giro mais rápido do navio virando no porto para sair
const LOOK = 1.5 // navegando, a proa aponta para o ponto da rota a esta distância à frente
const EXIT_LOOK = 2 // na saída, vira para o ponto da rota a esta distância do porto
const SAIL_SCALE = 0.45 // navegando, encolhe
const MIN_SCREEN = 0.022 // comprimento mínimo = distância da câmera × isto (não some ao afastar)
const PAUSE = 1.8 // s parado em cada porto
const SPEED = 10 // unidades/s; a duração fica entre MIN_TRIP e MAX_TRIP
const MIN_TRIP = 3
const MAX_TRIP = 7
const ACCEL = 0.28 // fração da viagem acelerando (e o mesmo freando)
const GROW_BEFORE = 0.7 // s antes de chegar em que o navio começa a voltar ao tamanho cheio
// Viagem até um episódio: ~2–3 s nas curtas; nas longas o navio acelera para caber no teto.
const VOYAGE_SPEED = 12
const VOYAGE_MIN = 2.2
const VOYAGE_MAX = 7
const CAM_CATCH = 2.5 // na viagem, a câmera alcança o navio (se a vista estava longe dele)

// Dev: ?shipt=segundos adianta a animação (para screenshots).
const START_T = Number(new URLSearchParams(window.location.search).get('shipt')) || 0
const WARMUP = 3 // s simulados antes do primeiro quadro quando ?shipt é usado

/** Uma viagem entre dois portos. `start` é onde ela começa na rota inteira (ida e volta), em unidades. */
type Trip = { curve: THREE.CatmullRomCurve3; reverse: boolean; duration: number; length: number; start: number }

/**
 * Por onde o navio anda: a rota dos portos (geo/places.json) ou, enquanto só ela existe, um
 * circuito oval em mar aberto (centro, raio em x e em z) para ver outros navios em outros mares.
 */
export type Course = 'viagem' | 'rota' | { center: [number, number]; rx: number; rz: number }

/** Põe comprimento e início em cada viagem (em sequência). */
function measure(trips: Trip[]) {
  let start = 0
  for (const t of trips) {
    t.length = t.curve.getLength()
    t.start = start
    start += t.length
  }
  return trips
}

function buildTrips(course: Course): Trip[] {
  if (course === 'viagem') return []
  return measure(course === 'rota' ? buildLegs() : buildLoop(course))
}

/** Fim (em unidades) da peça da rota que contém `s`: a direção nunca mira além de uma troca de borda. */
function pieceEnd(trips: Trip[], s: number) {
  const last = trips[trips.length - 1]
  const trip = trips.find((t) => s < t.start + t.length) ?? last
  return trip.start + trip.length - 1e-3
}

/** Ponto e direção (no sentido da viagem) a `s` unidades do início das viagens. */
function pathAt(trips: Trip[], s: number, p: THREE.Vector3, tan: THREE.Vector3) {
  const last = trips[trips.length - 1]
  const trip = trips.find((t) => s < t.start + t.length) ?? last
  const local = THREE.MathUtils.clamp((s - trip.start) / trip.length, 0, 1)
  const along = trip.reverse ? 1 - local : local
  trip.curve.getPointAt(along, p)
  trip.curve.getTangentAt(along, tan)
  if (trip.reverse) tan.negate()
}

function buildLoop({ center: [cx, cz], rx, rz }: Exclude<Course, string>): Trip[] {
  const N = 16
  const pts = Array.from({ length: N }, (_, i) => {
    const a = (-i / N) * Math.PI * 2 // anti-horário visto de cima
    return new THREE.Vector3(cx + rx * Math.cos(a), 0, cz + rz * Math.sin(a))
  })
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal')
  curve.arcLengthDivisions = 400
  const duration = THREE.MathUtils.clamp(curve.getLength() / SPEED, MIN_TRIP, MAX_TRIP)
  return [{ curve, duration, reverse: false, length: 0, start: 0 }]
}

/** Ponto de partida de um percurso (para posicionar a câmera). */
export function courseStart(course: Course): [number, number] {
  const p = buildTrips(course)[0].curve.getPointAt(0)
  return [p.x, p.z]
}

function buildLegs(): Trip[] {
  // Uma perna com `jump` (passagem por baixo da Red Line até a Ilha dos Tritões) vira duas
  // viagens: o navio some numa borda do mapa e reaparece na outra.
  // Pernas paradas (`stay`, a parada seguinte é no mesmo porto) não viram viagem.
  const pieces = route.legs.flatMap((leg) => (leg.points.length < 2 ? [] : legParts(leg)))
  const legs = pieces.map((points) => {
    const curve = curveOf(points)
    const length = points.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) : 0), 0)
    const duration = THREE.MathUtils.clamp(length / SPEED, MIN_TRIP, MAX_TRIP)
    return { curve, duration, length: 0, start: 0 }
  })
  // Ida pelas pernas e volta pelas mesmas, de trás para frente.
  return [...legs.map((l) => ({ ...l, reverse: false })), ...[...legs].reverse().map((l) => ({ ...l, reverse: true }))]
}

type Pt = number[] // [x, z] ou [x, z, y]

function curveOf(points: Pt[]) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z, y]) => new THREE.Vector3(x, y ?? 0, z)),
    false,
    'centripetal',
  )
  curve.arcLengthDivisions = Math.max(200, points.length * 8)
  return curve
}

/** Partes de uma perna: duas quando ela troca de borda (`jump`), senão uma. */
function legParts(leg: (typeof route.legs)[number]): Pt[][] {
  const j = 'jump' in leg ? leg.jump : undefined
  return j ? [leg.points.slice(0, j), leg.points.slice(j)] : [leg.points]
}

/**
 * Viagem da parada `from` até a parada `to` (índices em route.stops): as pernas do caminho
 * emendadas numa curva só (o navio passa direto pelas paradas do meio), partida em peças só onde
 * a rota troca de borda. Para trás, as mesmas pernas invertidas. Vazia se não há o que navegar
 * (mesma parada ou portos iguais).
 */
function buildVoyage(from: number, to: number): { trips: Trip[]; duration: number } {
  const back = to < from
  const legs = route.legs.slice(Math.min(from, to), Math.max(from, to))
  if (back) legs.reverse()
  const pieces: Pt[][] = []
  let cur: Pt[] = []
  for (const leg of legs) {
    const parts = legParts(leg)
    if (back) parts.reverse()
    parts.forEach((part, k) => {
      // A segunda parte de uma perna com `jump` começa uma peça nova (do outro lado do mapa).
      if (k > 0 && cur.length) {
        pieces.push(cur)
        cur = []
      }
      for (const p of back ? [...part].reverse() : part) {
        const q = cur[cur.length - 1]
        if (!q || Math.hypot(p[0] - q[0], p[1] - q[1], (p[2] ?? 0) - (q[2] ?? 0)) > 1e-3) cur.push(p)
      }
    })
  }
  if (cur.length) pieces.push(cur)
  const trips = measure(
    pieces.filter((p) => p.length >= 2).map((p) => ({ curve: curveOf(p), reverse: false, duration: 0, length: 0, start: 0 })),
  )
  const total = trips.reduce((s, t) => s + t.length, 0)
  return { trips, duration: THREE.MathUtils.clamp(total / VOYAGE_SPEED, VOYAGE_MIN, VOYAGE_MAX) }
}

/** Rumo do navio parado numa parada sem ter viajado: como se tivesse chegado pela rota. */
function restingHeading(stop: number) {
  const dir = (pts: Pt[]) => {
    for (let i = pts.length - 1; i > 0; i--) {
      const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1]
      if (dx * dx + dz * dz > 1e-4) return Math.atan2(-dx, -dz)
    }
    return null
  }
  for (let i = stop - 1; i >= 0; i--) {
    const parts = legParts(route.legs[i])
    const h = dir(parts[parts.length - 1])
    if (h !== null) return h
  }
  const first = route.legs.find((l) => l.points.length > 1)
  return first ? (dir([...legParts(first)[0]].slice(0, 2)) ?? 0) : 0
}

/** Porto da parada `stop` (onde o navio fica parado). */
const ports = new Map<number, THREE.Vector3>()
function stopPort(stop: number): THREE.Vector3 {
  const hit = ports.get(stop)
  if (hit) return hit
  // Perna que sai da parada (ou, na última, a que chega): o ponto da ponta é o porto.
  const out = route.legs[stop]
  const p = out ? out.points[0] : route.legs[stop - 1].points[route.legs[stop - 1].points.length - 1]
  const v = new THREE.Vector3(p[0], p[2] ?? 0, p[1])
  ports.set(stop, v)
  return v
}

/**
 * Direção (rumo, como `heading`) do ponto `a` para o ponto `look` unidades à frente na rota (sem
 * passar do fim da peça); null se os pontos quase coincidem.
 */
const scratchTan = new THREE.Vector3()
function headingTo(trips: Trip[], a: number, look: number, pa: THREE.Vector3, pb: THREE.Vector3) {
  const b = Math.min(a + look, pieceEnd(trips, a))
  pathAt(trips, a, pa, scratchTan)
  pathAt(trips, b, pb, scratchTan)
  const dx = pb.x - pa.x, dz = pb.z - pa.z
  if (dx * dx + dz * dz < 0.05 * 0.05) return null
  return Math.atan2(-dx, -dz)
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

// ---------- Modelo (bote) ----------

/** Forma do casco vista de cima (comprimento 1 em y, proa em +y), escalada por `k`. */
function hullShape(k: number, w = 1) {
  const s = new THREE.Shape()
  s.moveTo(-0.2 * k * w, -0.5 * k)
  s.quadraticCurveTo(0, -0.56 * k, 0.2 * k * w, -0.5 * k)
  s.quadraticCurveTo(0.27 * k * w, 0.08 * k, 0, 0.5 * k)
  s.quadraticCurveTo(-0.27 * k * w, 0.08 * k, -0.2 * k * w, -0.5 * k)
  return s
}

function buildDinghy() {
  const parts = newParts()
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
  const [body, lines] = finishParts(parts)
  const lineMat = lineMaterial()

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
  return { group, flag: flag as THREE.Object3D, flagYaw: -Math.PI / 2 }
}

/** Navio feito à mão para cada modelo (o Sunny e o Merry usam a mesma interface do bote). */
const BUILDERS: Record<ShipModelId, () => ReturnType<typeof buildDinghy>> = {
  bote: buildDinghy,
  merry: buildMerry,
  sunny: buildSunny,
}

type ShipProps = {
  model?: ShipModelId
  /** Segundos adiantados na rota (para vários navios em pontos diferentes). */
  phase?: number
  /** O principal: a câmera acompanha e o minimapa mostra este. */
  lead?: boolean
  course?: Course
}

/** Onde o navio começa no modo `viagem`: o porto da parada do episódio salvo. */
export function voyageStart(): [number, number] {
  const p = stopPort(stopOf(episodeStore.get().episode))
  return [p.x, p.z]
}

export function Ship({ model = 'bote', phase = 0, lead = true, course = 'viagem' }: ShipProps) {
  const voyage = course === 'viagem'
  const loopTrips = useMemo(() => buildTrips(course), [course])
  const body = useMemo(() => BUILDERS[model](), [model])
  const trail = useMemo(() => createTrail(), [])
  const ship = useRef<THREE.Group>(null)
  const scale = shipSize(model)
  const st = useRef({
    trip: 0,
    t: voyage ? 0 : START_T - PAUSE + phase,
    clock: 0,
    last: new THREE.Vector3(),
    heading: 0,
    angVel: 0, // velocidade de giro parado (rad/s)
    left: false, // já partiu nesta viagem (apontado para a saída)
    turnRate: 0,
    size: 1,
    motion: 0,
    init: false,
    // Modo viagem: parada onde o navio está (ou de onde partiu), destino e a viagem em curso.
    at: stopOf(episodeStore.get().episode),
    to: 0,
    run: null as { trips: Trip[]; duration: number } | null,
  })
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), tan: new THREE.Vector3(), ahead: new THREE.Vector3() }), [])

  const warmed = useRef(false)

  function tick(g: THREE.Group, camera: THREE.Camera, controls: MapControlsImpl | null, dt: number) {
    const s = st.current
    s.clock += dt
    s.t += dt

    // Janela: o trecho da rota que o navio percorre agora (`from` + `len` unidades em `duration`
    // segundos), ou nenhum (parado numa parada, no modo viagem).
    let trips: Trip[] | null = null
    let from = 0, len = 0, duration = 1
    if (voyage) {
      if (!s.run) {
        const target = stopOf(episodeStore.get().episode)
        if (target !== s.at) {
          const v = buildVoyage(s.at, target)
          if (v.trips.length) {
            s.run = v
            s.to = target
            s.t = 0
            s.left = false
            episodeStore.setSailing(true)
          } else s.at = target // mesmo porto: não há o que navegar
        }
      } else if (s.t >= s.run.duration) {
        // Chegou: fica parado no porto do destino, como chegou.
        s.at = s.to
        s.run = null
        episodeStore.setSailing(false)
      }
      if (s.run) {
        trips = s.run.trips
        const last = trips[trips.length - 1]
        len = last.start + last.length
        duration = s.run.duration
      }
    } else {
      let trip = loopTrips[s.trip]
      while (s.t > trip.duration) {
        s.t -= trip.duration + PAUSE
        s.trip = (s.trip + 1) % loopTrips.length
        trip = loopTrips[s.trip]
        s.left = false
      }
      trips = loopTrips
      from = trip.start
      len = trip.length
      duration = trip.duration
    }
    const end = from + len - 1e-3

    // Saída: na hora de partir, o navio primeiro vira no lugar (devagar, uma vez) até apontar para
    // onde vai de fato (o ponto EXIT_LOOK à frente na rota) e só então anda; a pausa se estende.
    const turningOut = trips !== null && s.t > 0 && !s.left && s.init
    if (turningOut) {
      const exit = headingTo(trips!, from, EXIT_LOOK, tmp.p, tmp.ahead)
      if (exit !== null && Math.abs(angleDiff(s.heading, exit)) > 0.03) {
        s.t = 0
        const rate = THREE.MathUtils.clamp(angleDiff(s.heading, exit) * 1.5, -TURN_STOPPED, TURN_STOPPED)
        s.angVel = damp(s.angVel, rate, 2.5, dt)
      } else s.left = true
    }
    const sailing = trips !== null && s.t > 0
    const u = sailing ? travel(Math.min(1, s.t / duration)) : 0
    const pos = Math.min(from + u * len, end)
    if (trips) pathAt(trips, pos, tmp.p, tmp.tan)
    else tmp.p.copy(stopPort(s.at))

    // Direção: navegando, a proa aponta para um ponto LOOK à frente no caminho (corda, não a
    // tangente: as curvinhas do traçado não viram giros). Parado, a direção fica como chegou.
    const before = s.heading
    if (!s.init) s.heading = trips ? Math.atan2(-tmp.tan.x, -tmp.tan.z) : restingHeading(s.at)
    if (sailing) {
      const want = headingTo(trips!, pos, LOOK, tmp.ahead, tmp.tan)
      if (want !== null) s.heading += angleDiff(s.heading, want) * (1 - Math.exp(-dt * 5))
      s.angVel = 0
    } else if (turningOut) s.heading += s.angVel * dt
    else s.angVel = 0
    if (trips) pathAt(trips, pos, tmp.p, tmp.tan) // headingTo usa os vetores temporários
    s.turnRate = damp(s.turnRate, angleDiff(before, s.heading) / Math.max(dt, 1e-3), 6, dt)

    // Câmera: acompanha enquanto o navio está na área vista (se o usuário levou a vista para
    // longe, ela fica onde está). Numa viagem até um episódio, acompanha sempre e, se a vista
    // estava longe, vai até o navio.
    if (lead && s.init && controls) {
      const dx = tmp.p.x - s.last.x, dz = tmp.p.z - s.last.z
      const [tx, tz] = cameraState.target
      const [hw, hh] = cameraState.half
      const voyaging = voyage && s.run !== null
      let mx = 0, mz = 0
      if (voyaging || (Math.abs(tmp.p.x - tx) < hw * 0.9 && Math.abs(tmp.p.z - tz) < hh * 0.9)) {
        mx = dx
        mz = dz
      }
      if (voyaging) {
        const k = 1 - Math.exp(-CAM_CATCH * dt)
        mx += (tmp.p.x - controls.target.x - mx) * k
        mz += (tmp.p.z - controls.target.z - mz) * k
      }
      if (mx || mz) {
        controls.target.x += mx
        controls.target.z += mz
        camera.position.x += mx
        camera.position.z += mz
      }
    }
    s.last.copy(tmp.p)
    s.init = true

    // Tamanho e "modo navegando" amortecidos: encolhe ao sair, volta a crescer perto de chegar.
    const cruising = sailing && s.t < duration - GROW_BEFORE
    s.size = damp(s.size, cruising ? SAIL_SCALE : 1, cruising ? 5 : 3.5, dt)
    s.motion = damp(s.motion, cruising ? 1 : 0, 3, dt)
    const minLen = camera.position.distanceTo(tmp.p) * MIN_SCREEN
    const len3d = Math.max(SHIP_LEN * scale * s.size, minLen * scale)

    // Balanço na água: altura e inclinação vêm das ondas sob a proa, a popa e os lados.
    const fx = -Math.sin(s.heading), fz = -Math.cos(s.heading)
    const half = len3d * 0.45, side = len3d * 0.2
    const T = s.clock
    const hBow = wave(tmp.p.x + fx * half, tmp.p.z + fz * half, T)
    const hStern = wave(tmp.p.x - fx * half, tmp.p.z - fz * half, T)
    const hL = wave(tmp.p.x - fz * side, tmp.p.z + fx * side, T)
    const hR = wave(tmp.p.x + fz * side, tmp.p.z - fx * side, T)
    const amp = 0.035 * (1 - 0.4 * s.motion) // navegando, corta as ondas
    const heave = ((hBow + hStern + hL + hR) / 4) * amp * len3d
    const pitch = (hBow - hStern) * amp * 1.4 + s.motion * 0.05 // proa levanta um pouco ao navegar
    const roll = (hR - hL) * amp * 2.2 - THREE.MathUtils.clamp(s.turnRate * 0.12, -0.18, 0.18) // inclina nas curvas

    // y da rota: subida pelos canais da Reverse Mountain e mergulho por baixo da Red Line.
    g.position.set(tmp.p.x, tmp.p.y + heave, tmp.p.z)
    g.rotation.set(pitch, s.heading, roll, 'YXZ')
    g.scale.setScalar(len3d)
    body.flag.rotation.y = body.flagYaw + Math.sin(T * 7) * 0.3 // tremula

    // Rastro na água a partir da popa, enquanto navega.
    const stern = { x: tmp.p.x - fx * len3d * 0.42, z: tmp.p.z - fz * len3d * 0.42 }
    const onSea = Math.abs(tmp.p.y) < 0.1 // nos canais e no mergulho não há rastro no mar
    trail.update(dt, sailing && s.motion > 0.05 && onSea ? stern : null, len3d)

    if (lead) {
      shipState.pos = [tmp.p.x, tmp.p.z]
      shipState.visible = true
      shipState.sailing = sailing
    }
  }

  useFrame((state, rawDt) => {
    const g = ship.current
    if (!g || (!voyage && !loopTrips.length)) return
    const controls = state.controls as MapControlsImpl | null
    // Dev (?shipt, só no protótipo): simula os segundos anteriores, para o rastro já existir no screenshot.
    if (!warmed.current) {
      warmed.current = true
      if (!voyage && START_T > 0) {
        st.current.t -= WARMUP
        for (let i = 0; i < WARMUP * 30; i++) tick(g, state.camera, controls, 1 / 30)
      }
    }
    tick(g, state.camera, controls, Math.min(rawDt, 0.1))
  })

  return (
    <>
      <group ref={ship}>
        <primitive object={body.group} />
      </group>
      <primitive object={trail.mesh} />
    </>
  )
}
