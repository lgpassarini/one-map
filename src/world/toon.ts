import * as THREE from 'three'

/** Rampa de luz do toon shading: 3 tons chapados, sem gradiente. */
export function toonRamp() {
  const data = new Uint8Array([120, 195, 255])
  const t = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat)
  t.minFilter = THREE.NearestFilter
  t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}
