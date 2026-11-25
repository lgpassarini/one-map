// Estado do navio compartilhado com a interface (minimapa). Mutável e atualizado a cada frame,
// como o cameraState.
export const shipState = {
  /** Posição do navio no mundo (x, z). */
  pos: [0, 0] as [number, number],
  sailing: false,
}
