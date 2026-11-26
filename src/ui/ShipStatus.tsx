import { useEffect, useState } from 'react'
import { useEpisode } from '../state/episode'
import { cameraState } from '../world/cameraState'
import './ShipStatus.css'

// Medalhão de madeira no canto inferior direito que mostra o estado do navio: âncora quando está
// parado, bússola (com a agulha balançando) quando está viajando. Clicar na âncora leva a câmera
// de volta até o navio (centraliza, volta ao zoom inicial e desfaz o giro). Durante a viagem a
// câmera fica travada no navio (CameraRig). Com a câmera já no navio, a âncora fica inativa (não
// adianta recentralizar de novo).

export function ShipStatus() {
  const { sailing } = useEpisode()
  const atShip = useAtShip()
  const idle = !sailing && atShip
  return (
    <button
      className={`ship-status${sailing ? ' ship-status--sailing' : ''}${idle ? ' ship-status--home' : ''}`}
      title={sailing ? 'Navegando' : atShip ? 'Ancorado' : 'Ir até o navio'}
      disabled={sailing || atShip}
      onClick={() => (cameraState.flyToShip = true)}
    >
      <span className="ship-status__icon ship-status__anchor" aria-hidden={sailing}>
        <Anchor />
      </span>
      <span className="ship-status__icon ship-status__compass" aria-hidden={!sailing}>
        <Compass />
      </span>
      <span className="ship-status__label">{sailing ? 'Navegando' : 'Ir até o navio'}</span>
    </button>
  )
}

/** Acompanha cameraState.atShip (atualizado a cada quadro pela câmera), re-renderizando só quando muda. */
function useAtShip() {
  const [atShip, setAtShip] = useState(cameraState.atShip)
  useEffect(() => {
    let raf = 0
    let last = cameraState.atShip
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (cameraState.atShip !== last) {
        last = cameraState.atShip
        setAtShip(last)
      }
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])
  return atShip
}

/** Âncora: argola, haste com cepo, braços curvos com pontas. Cada traço sai duas vezes: largo e escuro (contorno), fino e creme. */
function Anchor() {
  const d = [
    'M24 13 V38', // haste
    'M16.5 17.5 H31.5', // cepo
    'M10 29 C11 37 17 41 24 41 C31 41 37 37 38 29', // braços
  ]
  return (
    <svg viewBox="0 0 48 48">
      <g className="ink">
        {d.map((p) => (
          <path key={p} d={p} />
        ))}
        <circle cx="24" cy="9.5" r="3.6" />
        <path d="M6.5 31.5 L10 26.5 L13.5 31.5" />
        <path d="M34.5 31.5 L38 26.5 L41.5 31.5" />
      </g>
      <g className="cream">
        {d.map((p) => (
          <path key={p} d={p} />
        ))}
        <circle cx="24" cy="9.5" r="3.6" />
        <path d="M6.5 31.5 L10 26.5 L13.5 31.5" />
        <path d="M34.5 31.5 L38 26.5 L41.5 31.5" />
      </g>
    </svg>
  )
}

/** Bússola: aro, marcas dos pontos cardeais, agulha vermelha (norte) e creme (sul). */
function Compass() {
  return (
    <svg viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="20" className="compass-ring" />
      <g className="compass-ticks">
        <path d="M24 6.5 V10.5 M24 37.5 V41.5 M6.5 24 H10.5 M37.5 24 H41.5" />
      </g>
      <g className="compass-needle">
        <path d="M24 9 L29 24 L19 24 Z" className="needle-n" />
        <path d="M24 39 L19 24 L29 24 Z" className="needle-s" />
        <circle cx="24" cy="24" r="2.6" className="needle-pin" />
      </g>
    </svg>
  )
}
