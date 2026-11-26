import { useEffect, useState } from 'react'
import { cameraState } from '../world/cameraState'

/**
 * A câmera está na vista da ilha? Acompanha cameraState.islandView (atualizado a cada quadro pela
 * câmera), re-renderizando só quando muda.
 */
export function useIslandView() {
  const [inView, setInView] = useState(cameraState.islandView)
  useEffect(() => {
    let raf = 0
    let last = cameraState.islandView
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (cameraState.islandView !== last) {
        last = cameraState.islandView
        setInView(last)
      }
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])
  return inView
}
