// Nível de qualidade da cena: completo no desktop, reduzido em tablet/celular.
export type Quality = 'high' | 'low'

export function detectQuality(): Quality {
  if (typeof window === 'undefined') return 'high'
  const params = new URLSearchParams(window.location.search)
  const forced = params.get('quality')
  if (forced === 'high' || forced === 'low') return forced
  const coarse = window.matchMedia('(pointer: coarse)').matches
  return coarse || window.innerWidth < 900 ? 'low' : 'high'
}

export const QUALITY_SETTINGS = {
  high: { textureSuffix: '', dpr: [1, 2] as [number, number] },
  low: { textureSuffix: '_sm', dpr: [1, 1.5] as [number, number] },
}
