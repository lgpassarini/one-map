// Navios do jogo: bote a remo, Going Merry e Thousand Sunny. Todos são feitos à mão em código
// (Ship.tsx, merryModel.ts, sunnyModel.ts), no estilo do terreno, normalizados para comprimento ~1
// com a proa em -z; aqui fica só o tamanho de cada um em relação ao bote.

export type ShipModelId = 'bote' | 'merry' | 'sunny'

const SIZE: Record<ShipModelId, number> = { bote: 1, merry: 1.3, sunny: 1.6 }

export const shipSize = (id: ShipModelId) => SIZE[id]
