import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import places from '../data/places.json'
import { useMapSettings } from '../ui/mapSettings'
import { cameraState } from './cameraState'
import './PlaceLabels.css'

// Nomes dos locais da história (src/data/places.json, gerado pelo build-route a partir de
// geo/places.json), no estilo dos rótulos dos prints (Alegreya negrito, letra escura com contorno
// branco, e um X de mapa do tesouro na cidade), nítidos em qualquer zoom. São uma camada HTML
// única por cima do canvas (<PlaceLabels/>, fora do <Canvas>); a cada frame
// <PlaceLabelsProjector/> (dentro do <Canvas>, depois da câmera) projeta a posição de cada cidade
// na tela e move os rótulos direto no DOM, sem re-renderizar o React. Ligados/desligados por
// mapSettings.names (tecla N). Com a câmera longe, os locais de filler somem; nomes que se
// encostariam escondem o de menor prioridade (anticolisão).

type Place = { name: { pt: string; en: string }; kind?: string; town: number[] }
const LIST = Object.entries(places as Record<string, Place>)

// Ordem da anticolisão: os locais da história (na ordem da viagem) ganham dos fillers.
const PRIORITY = [...LIST.filter(([, p]) => p.kind !== 'filler'), ...LIST.filter(([, p]) => p.kind === 'filler')]
const GAP = 3 // px de folga entre dois nomes
const ENTER_GAP = 8 // folga a mais para um nome escondido voltar (histerese)

const LABEL_Y = 0.5 // na altura do platô (mais alto, a perspectiva desloca o pino para o norte da ilha)
const FAR = 95 // distância da câmera a partir da qual os fillers somem

const X_PATH = 'M3 3 L11 11 M11 3 L3 11' // X de mapa do tesouro (contorno + traço, ver o .css)

const elements = new Map<string, HTMLDivElement>()
const sizes = new Map<string, [number, number]>() // largura e altura de cada rótulo (px)
// a fonte da web chega depois da primeira medida e muda a largura: mede de novo
document.fonts?.addEventListener('loadingdone', () => sizes.clear())

/** A camada de rótulos (DOM). Vai no App, ao lado do <Canvas>. */
export function PlaceLabels() {
  const { names } = useMapSettings()
  if (!names) return null
  return (
    <div className="place-labels">
      {LIST.map(([id, p]) => (
        <div
          key={id}
          ref={(el) => {
            if (el) elements.set(id, el)
            else {
              elements.delete(id)
              sizes.delete(id) // remontado (estilo ou fonte podem ter mudado): mede de novo
            }
          }}
          className={`place-label${p.kind ? ` place-label--${p.kind}` : ''}`}
          style={{ display: 'none' }}
        >
          <span className="place-label__name">{p.name.pt}</span>
          <svg className="place-label__x" viewBox="0 0 14 14" aria-hidden="true">
            <path d={X_PATH} fill="none" strokeLinecap="round" />
            <path d={X_PATH} fill="none" strokeLinecap="round" />
          </svg>
        </div>
      ))}
    </div>
  )
}

const v = new THREE.Vector3()
const shown = new Set<string>() // nomes visíveis no frame anterior

/** Projeta os rótulos a cada frame. Vai dentro do <Canvas>, depois do CameraRig. */
export function PlaceLabelsProjector() {
  useFrame(({ camera, size }) => {
    if (!elements.size) return
    // A câmera acabou de ser movida neste frame (CameraRig), mas a matriz dela só é atualizada no
    // render: sem isto os nomes ficam um frame atrás do mapa e "nadam" ao arrastar e dar zoom.
    camera.updateMatrixWorld()
    const [tx, tz] = cameraState.target
    const far = Math.hypot(camera.position.x - tx, camera.position.y, camera.position.z - tz) > FAR
    // O minimapa fica semitransparente parado: um nome atrás dele apareceria através dele.
    const mini = document.querySelector('.minimap')?.getBoundingClientRect()
    const placed: number[][] = [] // retângulos já na tela, para a anticolisão
    // Histerese: dentro da mesma prioridade, quem já estava na tela vem primeiro, e quem vai
    // aparecer precisa de mais folga. Sem isso, dois nomes no limite piscam alternando.
    const order = [
      ...PRIORITY.filter(([id, p]) => p.kind !== 'filler' && shown.has(id)),
      ...PRIORITY.filter(([id, p]) => p.kind !== 'filler' && !shown.has(id)),
      ...PRIORITY.filter(([id, p]) => p.kind === 'filler' && shown.has(id)),
      ...PRIORITY.filter(([id, p]) => p.kind === 'filler' && !shown.has(id)),
    ]
    for (const [id, p] of order) {
      const was = shown.delete(id)
      const el = elements.get(id)
      if (!el) continue
      v.set(p.town[0], LABEL_Y, p.town[1]).project(camera)
      // fora da tela (com folga para o nome) ou atrás da câmera
      const hidden = (far && p.kind === 'filler') || v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2
      // pixel inteiro: em fração de pixel o texto fica borrado
      const sx = Math.round(((v.x + 1) / 2) * size.width), sy = Math.round(((1 - v.y) / 2) * size.height)
      // sob o minimapa (com folga para o nome, que fica acima do X)
      const underMini = mini && sx > mini.left - 60 && sx < mini.right + 60 && sy > mini.top && sy < mini.bottom + 30
      if (hidden || underMini) {
        el.style.display = 'none'
        continue
      }
      // o tamanho é medido uma vez, com o rótulo visível
      let box = sizes.get(id)
      if (!box) {
        el.style.display = ''
        sizes.set(id, (box = [el.offsetWidth, el.offsetHeight]))
      }
      // ancorado pelo meio de baixo (o X), também em pixel inteiro (translate(-50%) daria meio
      // pixel em larguras ímpares)
      const x0 = sx - Math.round(box[0] / 2), y0 = sy - box[1]
      const g = was ? GAP : GAP + ENTER_GAP
      const r = [x0 - g, y0 - g, x0 + box[0] + g, sy + g]
      // anticolisão: encostaria num nome mais importante, já posto → some (volta com mais zoom)
      if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) {
        el.style.display = 'none'
        continue
      }
      placed.push([x0 - GAP, y0 - GAP, x0 + box[0] + GAP, sy + GAP])
      shown.add(id)
      el.style.display = ''
      el.style.transform = `translate(${x0}px, ${y0}px)`
    }
  })
  return null
}
