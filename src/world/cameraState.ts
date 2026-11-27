// Estado da câmera compartilhado entre a cena 3D e a interface (minimapa, vinheta da ilha).
// Mutável e fora do React de propósito: é atualizado a cada frame sem re-renderizar nada.

/** A ilha (ou trecho de mar) mostrada na vista da ilha. */
export type IslandSubject = {
  /** Local (id em places), ou null numa parada no mar. */
  place: string | null
  /** Parada da rota (índice em route.stops) que a vista enquadra. */
  stop: number
  /** Ponto do mundo (x, z) onde a câmera mira. */
  focus: [number, number]
  /** Pedido feito pela chegada do navio: a vista entra sem mexer na câmera. */
  arrival?: boolean
}

export const cameraState = {
  /** Alvo da câmera no mundo (x, z). */
  target: [0, 0] as [number, number],
  /** Meia-largura e meia-altura (unidades do mundo) da área vista em volta do alvo. */
  half: [0, 0] as [number, number],
  /** performance.now() da última vez que a câmera se mexeu. */
  lastMove: 0,
  /** Na vista da ilha (ou indo para ela): qual ilha. null = vista normal do mapa. */
  island: null as IslandSubject | null,
  /** Pedido (chegada do navio, clique numa ilha): entrar na vista desta ilha. */
  islandRequest: null as IslandSubject | null,
  /** Pedido (X da vinheta): sair da vista da ilha. */
  exitIsland: false,
  /** A viagem em andamento começou na vista da ilha: a câmera segue o navio de perto, sem se afastar. */
  voyageFromIsland: false,
  /** Pedido (âncora): ir até o navio na vista normal. */
  flyToShip: false,
}
