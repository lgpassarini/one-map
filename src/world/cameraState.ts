// Estado da câmera compartilhado entre a cena 3D e a interface (minimapa).
// Mutável e fora do React de propósito: é atualizado a cada frame sem re-renderizar nada.
export const cameraState = {
  /** Alvo da câmera no mundo (x, z). */
  target: [0, 0] as [number, number],
  /** Meia-largura e meia-altura (unidades do mundo) da área vista em volta do alvo. */
  half: [0, 0] as [number, number],
  /** performance.now() da última vez que a câmera se mexeu. */
  lastMove: 0,
  /** Pedido (âncora, chegada do navio): levar a câmera à vista da ilha. */
  flyToIsland: false,
  /** A câmera está na vista da ilha (ou indo para ela): a vinheta do local aparece e a âncora não faz nada. */
  islandView: false,
}
