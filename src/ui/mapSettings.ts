import { useSyncExternalStore } from 'react'

// Preferências do mapa que a interface liga e desliga (hoje: os nomes dos locais). Fica fora do
// React para qualquer parte ler e mudar; os componentes assinam com useMapSettings. Salvo no
// localStorage. Por enquanto a tecla N alterna os nomes; um botão na interface vai usar o mesmo
// setMapSetting.
export type MapSettings = { names: boolean }

const KEY = 'one-map:settings'
const DEFAULTS: MapSettings = { names: true }

function load(): MapSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

let settings = load()
const listeners = new Set<() => void>()

export function setMapSetting<K extends keyof MapSettings>(key: K, value: MapSettings[K]) {
  settings = { ...settings, [key]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // sem localStorage (modo privado): vale só nesta visita
  }
  for (const l of listeners) l()
}

export function useMapSettings(): MapSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => settings,
  )
}

// Atalho de teclado: N liga/desliga os nomes (fora de campos de texto).
window.addEventListener('keydown', (e) => {
  if (e.key !== 'n' && e.key !== 'N') return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const el = e.target as HTMLElement | null
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
  setMapSetting('names', !settings.names)
})
