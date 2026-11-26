// Estado do navio compartilhado com a interface (minimapa). Mutável e atualizado a cada frame,
// como o cameraState.
export const shipState = {
  /** Há um navio no mapa (sem navio, o minimapa não mostra o ponto). */
  visible: false,
  /** Posição do navio no mundo (x, z). */
  pos: [0, 0] as [number, number],
  sailing: false,
  /** Ponto da vista da ilha (x, z): entre o porto e a cidade da parada onde o navio está. */
  focus: [0, 0] as [number, number],
}
