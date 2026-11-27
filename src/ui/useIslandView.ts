import { useEffect, useState } from 'react'
import { cameraState } from '../world/cameraState'

/**
 * A ilha da vista da ilha (ou null na vista normal). Acompanha cameraState.island (atualizado pela
 * câmera a cada quadro), re-renderizando só quando muda.
 */
export function useIslandView() {
  const [island, setIsland] = useState(cameraState.island)
  useEffect(() => {
    let raf = 0
    let last = cameraState.island
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (cameraState.island !== last) {
        last = cameraState.island
        setIsland(last)
      }
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])
  return island
}
