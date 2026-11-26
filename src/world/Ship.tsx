import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import route from '../data/route.json'
import { episodeStore, stopOf } from '../state/episode'
import { cameraState } from './cameraState'
import { MAX_DIST, polarFor } from './CameraRig'
import { shipState } from './shipState'
import { toonRamp } from './toon'
import { buildMerry } from './merryModel'
import { finishParts, layer, lineMaterial, newParts, rect } from './shipParts'
import { SHIP_CHANGES, shipModelAt, shipSize, type ShipModelId } from './shipModels'
import { buildSunny } from './sunnyModel'
import { createTrail } from './Trail'

// Navio do bando. Fica parado na parada do episódio atual e, quando outro episódio é escolhido na
// barra, navega pela rota até a parada dele (de ida ou de volta, passando direto pelas paradas do
// meio). A rota vem de scripts/build-route.mjs (src/data/route.json, na ordem dos episódios); aqui
// uma curva suave passa pelos pontos.
//
// O navio muda conforme o episódio (bote → Going Merry → Thousand Sunny, ver shipModels.tsx): parado,
// troca no lugar com um "pop" (encolhe e volta com um pulinho); numa viagem, troca ao passar pela
// parada onde o bando mudou de navio. Em viagens longas a câmera se afasta no caminho e volta a
// aproximar no destino.
//
// Os navios são feitos como o terreno: camadas extrudadas com topo claro e parede mais escura,
// toon shading e contorno fino no alto de cada camada.

const SHIP_LEN = 2.7 // comprimento do navio parado (peça de tabuleiro)
const TURN_STOPPED = 0.8 // rad/s: giro mais rápido do navio virando no porto para sair
const LOOK = 1.5 // navegando, a proa aponta para o ponto da rota a esta distância à frente
const EXIT_LOOK = 2 // na saída, vira para o ponto da rota a esta distância do porto
const SAIL_SCALE = 0.45 // navegando, encolhe
const MIN_SCREEN = 0.022 // comprimento mínimo = distância da câmera × isto (não some ao afastar)
const ACCEL = 0.28 // fração da viagem acelerando (e o mesmo freando)
const GROW_BEFORE = 0.7 // s antes de chegar em que o navio começa a voltar ao tamanho cheio
// Duração da viagem: ~2–3 s nas curtas; nas longas o navio acelera para caber no teto.
const VOYAGE_SPEED = 12
const VOYAGE_MIN = 2.2
const VOYAGE_MAX = 7
const CAM_CATCH = 2.5 // na viagem, a câmera alcança o navio (se a vista estava longe dele)
// Afastamento da câmera nas viagens longas: começa depois de ZOOM_FROM unidades de viagem e cresce
// ZOOM_PER unidades de distância por unidade de viagem, até ZOOM_MAX (o zoom máximo da câmera
// também limita).
const ZOOM_FROM = 50
const ZOOM_PER = 0.12
const ZOOM_MAX = 110
const POP = 0.16 // s de cada metade do "pop" da troca de navio (encolher, crescer)

type Pt = number[] // [x, z] ou [x, z, y]

/** Um pedaço contínuo da viagem (a troca de borda na Ilha dos Tritões divide a viagem em dois). */
type Trip = { curve: THREE.CatmullRomCurve3; length: number; start: number }

type Voyage = {
  trips: Trip[]
  total: number
  duration: number
  /** Quanto a câmera se afasta no meio da viagem. */
  zoom: number
  /** Trocas de navio no caminho: em `at` unidades da viagem, o navio vira `model`. */
  swaps: { at: number; model: ShipModelId }[]
}

function curveOf(points: Pt[]) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z, y]) => new THREE.Vector3(x, y ?? 0, z)),
    false,
    'centripetal',
  )
  curve.arcLengthDivisions = Math.max(200, points.length * 8)
  return curve
}

const dist3 = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1], (p[2] ?? 0) - (q[2] ?? 0))

/** Partes de uma perna: duas quando ela troca de borda (`jump`), senão uma. */
function legParts(leg: (typeof route.legs)[number]): Pt[][] {
  const j = 'jump' in leg ? leg.jump : undefined
  return j ? [leg.points.slice(0, j), leg.points.slice(j)] : [leg.points]
}

/**
 * Viagem da parada `from` até a parada `to` (índices em route.stops), saindo do episódio `fromEp`
 * para o `toEp`: as pernas do caminho emendadas numa curva só (o navio passa direto pelas paradas do
 * meio), partida em pedaços só onde a rota troca de borda. Para trás, as mesmas pernas invertidas.
 * null se não há o que navegar (mesma parada ou portos iguais).
 *
 * As distâncias são medidas na linha dos pontos (não na curva): assim a posição de cada parada no
 * caminho sai de graça, e a diferença para a curva é desprezível.
 */
function buildVoyage(from: number, to: number, fromEp: number, toEp: number): Voyage | null {
  const back = to < from
  const legIdx = Array.from({ length: Math.abs(to - from) }, (_, i) => (back ? from - 1 - i : from + i))
  const pieces: { pts: Pt[]; start: number; length: number }[] = []
  const stopAt = new Map<number, number>() // parada → unidades da viagem em que o navio passa por ela
  let cur: Pt[] = []
  let curStart = 0
  let dist = 0
  for (const i of legIdx) {
    stopAt.set(back ? i + 1 : i, dist)
    const parts = legParts(route.legs[i])
    if (back) parts.reverse()
    parts.forEach((part, k) => {
      // A segunda parte de uma perna com `jump` começa um pedaço novo (do outro lado do mapa).
      if (k > 0 && cur.length) {
        pieces.push({ pts: cur, start: curStart, length: dist - curStart })
        cur = []
        curStart = dist
      }
      for (const p of back ? [...part].reverse() : part) {
        const q = cur[cur.length - 1]
        if (!q) cur.push(p)
        else if (dist3(p, q) > 1e-3) {
          dist += dist3(p, q)
          cur.push(p)
        }
      }
    })
  }
  if (cur.length) pieces.push({ pts: cur, start: curStart, length: dist - curStart })
  stopAt.set(to, dist)
  const trips = pieces.filter((p) => p.pts.length >= 2).map((p) => ({ curve: curveOf(p.pts), start: p.start, length: p.length }))
  if (!trips.length) return null

  // Troca de navio ao passar pela parada da troca. Na parada de destino, o navio do episódio de
  // destino; nas outras, o do lado para onde a viagem vai.
  const swaps: Voyage['swaps'] = []
  for (const c of SHIP_CHANGES) {
    const k = stopOf(c.ep)
    const at = stopAt.get(k)
    if (at === undefined) continue
    const model = k === to ? shipModelAt(toEp) : back ? c.before : c.after
    if (k === from && model === shipModelAt(fromEp)) continue
    swaps.push({ at, model })
  }
  swaps.sort((a, b) => a.at - b.at)

  return {
    trips,
    total: dist,
    duration: THREE.MathUtils.clamp(dist / VOYAGE_SPEED, VOYAGE_MIN, VOYAGE_MAX),
    zoom: THREE.MathUtils.clamp((dist - ZOOM_FROM) * ZOOM_PER, 0, ZOOM_MAX),
    swaps,
  }
}

/** Pedaço da viagem que contém `s`. */
const tripAt = (trips: Trip[], s: number) => trips.find((t) => s < t.start + t.length) ?? trips[trips.length - 1]

/** Ponto e direção (no sentido da viagem) a `s` unidades do início da viagem. */
function pathAt(trips: Trip[], s: number, p: THREE.Vector3, tan: THREE.Vector3) {
  const trip = tripAt(trips, s)
  const local = THREE.MathUtils.clamp((s - trip.start) / trip.length, 0, 1)
  trip.curve.getPointAt(local, p)
  trip.curve.getTangentAt(local, tan)
}

/**
 * Direção (rumo, como `heading`) do ponto `a` para o ponto `look` unidades à frente na rota (sem
 * passar do fim do pedaço: nunca mira através da troca de borda); null se os pontos quase coincidem.
 */
const scratchTan = new THREE.Vector3()
function headingTo(trips: Trip[], a: number, look: number, pa: THREE.Vector3, pb: THREE.Vector3) {
  const trip = tripAt(trips, a)
  const b = Math.min(a + look, trip.start + trip.length - 1e-3)
  pathAt(trips, a, pa, scratchTan)
  pathAt(trips, b, pb, scratchTan)
  const dx = pb.x - pa.x, dz = pb.z - pa.z
  if (dx * dx + dz * dz < 0.05 * 0.05) return null
  return Math.atan2(-dx, -dz)
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
  return first ? (dir(legParts(first)[0].slice(0, 2)) ?? 0) : 0
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

/** Onde o navio começa: o porto da parada do episódio salvo (para posicionar a câmera). */
export function voyageStart(): [number, number] {
  const p = stopPort(stopOf(episodeStore.get().episode))
  return [p.x, p.z]
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

/** Afastamento da câmera ao longo da viagem (0..1): sobe no começo, fica, desce perto do fim. */
const zoomCurve = (p: number) => THREE.MathUtils.smoothstep(p, 0, 0.22) * (1 - THREE.MathUtils.smoothstep(p, 0.72, 1))

/** Crescer com um pulinho no fim (passa um pouco do tamanho e volta). */
const easeOutBack = (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2)

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


const MODELS = Object.keys(BUILDERS) as ShipModelId[]

export function Ship() {
  // Os três navios ficam montados; só o atual aparece.
  const bodies = useMemo(() => Object.fromEntries(MODELS.map((id) => [id, BUILDERS[id]()])) as Record<ShipModelId, ReturnType<typeof buildDinghy>>, [])
  const trail = useMemo(() => createTrail(), [])
  const ship = useRef<THREE.Group>(null)
  const st = useRef(
    (() => {
      const ep = episodeStore.get().episode
      return {
        t: 0, // s desde a partida (0 enquanto vira no porto para sair)
        clock: 0,
        last: new THREE.Vector3(),
        heading: 0,
        angVel: 0, // velocidade de giro parado (rad/s)
        left: false, // já partiu nesta viagem (apontado para a saída)
        turnRate: 0,
        size: 1,
        motion: 0,
        init: false,
        at: stopOf(ep), // parada onde o navio está (ou de onde partiu)
        ep, // episódio em que o navio está (ou de onde partiu)
        to: 0,
        toEp: 0,
        voyage: null as Voyage | null,
        camBase: 0, // distância da câmera na partida (para onde ela volta)
        model: shipModelAt(ep),
        pop: 0, // 0 = parado; 0..1 encolhendo; 1..2 crescendo com o navio novo
      }
    })(),
  )
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), tan: new THREE.Vector3(), ahead: new THREE.Vector3(), off: new THREE.Vector3() }), [])

  function tick(g: THREE.Group, camera: THREE.Camera, controls: MapControlsImpl | null, dt: number) {
    const s = st.current
    s.clock += dt
    s.t += dt

    // Partida e chegada.
    const target = episodeStore.get().episode
    if (!s.voyage && target !== s.ep) {
      const to = stopOf(target)
      const v = to === s.at ? null : buildVoyage(s.at, to, s.ep, target)
      if (v) {
        s.voyage = v
        s.to = to
        s.toEp = target
        s.t = 0
        s.left = false
        s.camBase = controls ? camera.position.distanceTo(controls.target) : 0
        episodeStore.setSailing(true)
      } else {
        // Mesmo porto: não há o que navegar (o navio pode trocar no lugar, abaixo).
        s.at = to
        s.ep = target
      }
    } else if (s.voyage && s.t >= s.voyage.duration) {
      // Chegou: fica parado no porto do destino, como chegou.
      s.at = s.to
      s.ep = s.toEp
      s.voyage = null
      episodeStore.setSailing(false)
    }
    const v = s.voyage
    const trips = v?.trips ?? null

    // Saída: na hora de partir, o navio primeiro vira no lugar (devagar, uma vez) até apontar para
    // onde vai de fato (o ponto EXIT_LOOK à frente na rota) e só então anda.
    const turningOut = v !== null && s.t > 0 && !s.left && s.init
    if (turningOut) {
      const exit = headingTo(v.trips, 0, EXIT_LOOK, tmp.p, tmp.ahead)
      if (exit !== null && Math.abs(angleDiff(s.heading, exit)) > 0.03) {
        s.t = 0
        const rate = THREE.MathUtils.clamp(angleDiff(s.heading, exit) * 1.5, -TURN_STOPPED, TURN_STOPPED)
        s.angVel = damp(s.angVel, rate, 2.5, dt)
      } else s.left = true
    }
    const sailing = v !== null && s.t > 0
    const duration = v?.duration ?? 1
    const prog = sailing ? Math.min(1, s.t / duration) : 0
    const pos = v ? Math.min(travel(prog) * v.total, v.total - 1e-3) : 0
    if (trips) pathAt(trips, pos, tmp.p, tmp.tan)
    else tmp.p.copy(stopPort(s.at))

    // Direção: navegando, a proa aponta para um ponto LOOK à frente no caminho (corda, não a
    // tangente: as curvinhas do traçado não viram giros). Parado, a direção fica como chegou.
    const before = s.heading
    if (!s.init) s.heading = restingHeading(s.at)
    if (sailing) {
      const want = headingTo(trips!, pos, LOOK, tmp.ahead, tmp.tan)
      if (want !== null) s.heading += angleDiff(s.heading, want) * (1 - Math.exp(-dt * 5))
      s.angVel = 0
    } else if (turningOut) s.heading += s.angVel * dt
    else s.angVel = 0
    if (trips) pathAt(trips, pos, tmp.p, tmp.tan) // headingTo usa os vetores temporários
    s.turnRate = damp(s.turnRate, angleDiff(before, s.heading) / Math.max(dt, 1e-3), 6, dt)

    // Câmera: parado, acompanha só enquanto o navio está na área vista (se o usuário levou a vista
    // para longe, ela fica onde está). Na viagem, acompanha sempre, vai até o navio se a vista
    // estava longe e, nas viagens longas, se afasta no caminho e volta no destino.
    if (s.init && controls) {
      const dx = tmp.p.x - s.last.x, dz = tmp.p.z - s.last.z
      const [tx, tz] = cameraState.target
      const [hw, hh] = cameraState.half
      let mx = 0, mz = 0
      if (v || (Math.abs(tmp.p.x - tx) < hw * 0.9 && Math.abs(tmp.p.z - tz) < hh * 0.9)) {
        mx = dx
        mz = dz
      }
      if (v) {
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
      if (v && v.zoom > 0) {
        const d = Math.min(MAX_DIST, s.camBase + v.zoom * zoomCurve(prog))
        const polar = polarFor(d)
        tmp.off.subVectors(camera.position, controls.target)
        const az = Math.atan2(tmp.off.x, tmp.off.z)
        camera.position.set(
          controls.target.x + d * Math.sin(polar) * Math.sin(az),
          controls.target.y + d * Math.cos(polar),
          controls.target.z + d * Math.sin(polar) * Math.cos(az),
        )
      }
    }
    s.last.copy(tmp.p)
    s.init = true

    // Navio do momento: numa viagem, o da última troca já passada (ou o de partida); parado, o do
    // episódio. Se mudou, "pop": encolhe, troca e cresce com um pulinho.
    let want = v ? shipModelAt(s.ep) : shipModelAt(target)
    if (v) for (const sw of v.swaps) if (pos >= sw.at) want = sw.model
    if (s.pop === 0 && want !== s.model) s.pop = 1e-6
    if (s.pop > 0) {
      s.pop += dt / POP
      if (s.pop >= 1 && s.pop - dt / POP < 1) s.model = want // no ponto mais encolhido
      if (s.pop >= 2) s.pop = 0
    }
    const popScale = s.pop === 0 ? 1 : s.pop < 1 ? 1 - THREE.MathUtils.smoothstep(s.pop, 0, 1) : easeOutBack(s.pop - 1)
    for (const id of MODELS) bodies[id].group.visible = id === s.model
    const body = bodies[s.model]
    const scale = shipSize(s.model)

    // Tamanho e "modo navegando" amortecidos: encolhe ao sair, volta a crescer perto de chegar.
    const cruising = sailing && s.t < duration - GROW_BEFORE
    s.size = damp(s.size, cruising ? SAIL_SCALE : 1, cruising ? 5 : 3.5, dt)
    s.motion = damp(s.motion, cruising ? 1 : 0, 3, dt)
    const minLen = camera.position.distanceTo(tmp.p) * MIN_SCREEN
    const len = Math.max(SHIP_LEN * scale * s.size, minLen * scale)

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

    // y da rota: subida pelos canais da Reverse Mountain e mergulho por baixo da Red Line.
    g.position.set(tmp.p.x, tmp.p.y + heave, tmp.p.z)
    g.rotation.set(pitch, s.heading, roll, 'YXZ')
    g.scale.setScalar(len * Math.max(popScale, 1e-3))
    body.flag.rotation.y = body.flagYaw + Math.sin(T * 7) * 0.3 // tremula

    // Rastro na água a partir da popa, enquanto navega.
    const stern = { x: tmp.p.x - fx * len * 0.42, z: tmp.p.z - fz * len * 0.42 }
    const onSea = Math.abs(tmp.p.y) < 0.1 // nos canais e no mergulho não há rastro no mar
    trail.update(dt, sailing && s.motion > 0.05 && onSea ? stern : null, len)

    shipState.pos = [tmp.p.x, tmp.p.z]
    shipState.visible = true
    shipState.sailing = sailing
  }

  useFrame((state, rawDt) => {
    const g = ship.current
    if (!g) return
    tick(g, state.camera, state.controls as MapControlsImpl | null, Math.min(rawDt, 0.1))
  })

  return (
    <>
      <group ref={ship}>
        {MODELS.map((id) => (
          <primitive key={id} object={bodies[id].group} />
        ))}
      </group>
      <primitive object={trail.mesh} />
    </>
  )
}
