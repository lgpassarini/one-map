import { useEffect, useRef } from 'react'
import { cameraState } from '../world/cameraState'
import { WORLD_H, WORLD_W } from '../world/coords'
import './Minimap.css'

const base = import.meta.env.BASE_URL

// Retangular, na proporção do mundo (2:1): mostra o mapa inteiro, sem rolar.
const WIDTH = 400 // px (CSS)
const HEIGHT = Math.round((WIDTH * WORLD_H) / WORLD_W)
const IDLE_ALPHA = 0.35
const ACTIVE_ALPHA = 1
const IDLE_AFTER = 300 // ms parado até voltar a ficar transparente

/**
 * Minimapa no canto inferior esquerdo: o mundo de cima e o contorno da área que a câmera está
 * vendo. Fica transparente parado e opaco enquanto a câmera se move.
 */
export function Minimap() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cv = canvas.current!
    const ctx = cv.getContext('2d')!
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    cv.width = WIDTH * dpr
    cv.height = HEIGHT * dpr
    const img = new Image()
    img.src = `${base}terrain/minimap.png`
    let raf = 0
    let wasActive: boolean | null = null

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const active = performance.now() - cameraState.lastMove < IDLE_AFTER
      if (box.current && active !== wasActive) {
        box.current.style.opacity = String(active ? ACTIVE_ALPHA : IDLE_ALPHA)
        wasActive = active
      }
      if (!img.complete || !img.naturalWidth) return

      const s = cv.width / WORLD_W // px do canvas por unidade do mundo
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.drawImage(img, 0, 0, cv.width, cv.height)

      // Retângulo de localização: centrado no alvo da câmera; só muda de tamanho com o zoom.
      const [tx, tz] = cameraState.target
      const [hw, hh] = cameraState.half
      if (hw > 0) {
        const x = (tx - hw + WORLD_W / 2) * s
        const y = (tz - hh + WORLD_H / 2) * s
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
        ctx.fillRect(x, y, hw * 2 * s, hh * 2 * s)
        ctx.lineWidth = 2 * dpr
        ctx.strokeStyle = '#ffffff'
        ctx.strokeRect(x, y, hw * 2 * s, hh * 2 * s)
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={box} className="minimap" style={{ width: WIDTH, height: HEIGHT }}>
      <canvas ref={canvas} style={{ width: WIDTH, height: HEIGHT }} />
    </div>
  )
}
