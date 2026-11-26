// Navios do jogo: bote a remo, Going Merry e Thousand Sunny. Todos são feitos à mão em código
// (Ship.tsx, merryModel.ts, sunnyModel.ts), no estilo do terreno, normalizados para comprimento ~1
// com a proa em -z; aqui ficam o tamanho de cada um em relação ao bote e em que episódio o bando
// troca de navio.

export type ShipModelId = 'bote' | 'merry' | 'sunny'

const SIZE: Record<ShipModelId, number> = { bote: 1, merry: 1.3, sunny: 1.6 }

export const shipSize = (id: ShipModelId) => SIZE[id]

/**
 * Trocas de navio, em ordem. O Merry vem a partir do Ep 18 (o bando ganha o navio no fim do 17, em
 * Syrup Village); o Sunny a partir do 313, logo depois do fim de Enies Lobby (o Merry se vai no 312;
 * o Sunny só aparece de fato no 321, mas entre um e outro o bando não tem navio próprio).
 */
export const SHIP_CHANGES: { ep: number; before: ShipModelId; after: ShipModelId }[] = [
  { ep: 18, before: 'bote', after: 'merry' },
  { ep: 313, before: 'merry', after: 'sunny' },
]

/** Navio do bando no episódio `n` (0 = Partida, ainda de bote). */
export function shipModelAt(n: number): ShipModelId {
  let model: ShipModelId = 'bote'
  for (const c of SHIP_CHANGES) if (n >= c.ep) model = c.after
  return model
}
