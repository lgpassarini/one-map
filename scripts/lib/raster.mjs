// Utilitários de raster usados pelos scripts de geografia.
// Todas as máscaras são Uint8Array de tamanho w*h com valores 0/1.

/** Soma de cada janela quadrada de raio r (separável, O(n)). */
export const boxSum = (mask, w, h, r) => boxCount(mask, w, h, r)

function boxCount(mask, w, h, r) {
  const tmp = new Uint16Array(w * h)
  const out = new Uint16Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let s = 0
    for (let x = -r; x <= r; x++) if (x >= 0 && x < w) s += mask[row + x]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s
      const add = x + r + 1
      const rem = x - r
      if (add < w) s += mask[row + add]
      if (rem >= 0) s -= mask[row + rem]
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let y = -r; y <= r; y++) if (y >= 0 && y < h) s += tmp[y * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s
      const add = y + r + 1
      const rem = y - r
      if (add < h) s += tmp[add * w + x]
      if (rem >= 0) s -= tmp[rem * w + x]
    }
  }
  return out
}

export function dilate(mask, w, h, r) {
  const c = boxCount(mask, w, h, r)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = c[i] > 0 ? 1 : 0
  return out
}

export function erode(mask, w, h, r) {
  const c = boxCount(mask, w, h, r)
  const full = (2 * r + 1) ** 2
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = c[i] >= full ? 1 : 0
  return out
}

export const open = (m, w, h, r) => dilate(erode(m, w, h, r), w, h, r)
export const close = (m, w, h, r) => erode(dilate(m, w, h, r), w, h, r)

/** Rotula componentes conexos (4-vizinhança). Retorna { labels, sizes, touchesBorder }. */
export function components(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1)
  const sizes = []
  const touchesBorder = []
  const stack = new Int32Array(w * h)
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue
    const id = sizes.length
    let sp = 0
    let size = 0
    let border = false
    stack[sp++] = start
    labels[start] = id
    while (sp) {
      const i = stack[--sp]
      size++
      const x = i % w
      const y = (i - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true
      const n = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
      for (const j of n) {
        if (j >= 0 && mask[j] && labels[j] === -1) {
          labels[j] = id
          stack[sp++] = j
        }
      }
    }
    sizes.push(size)
    touchesBorder.push(border)
  }
  return { labels, sizes, touchesBorder }
}

/** Remove componentes menores que minSize. */
export function removeSmall(mask, w, h, minSize) {
  const { labels, sizes } = components(mask, w, h)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) if (mask[i] && sizes[labels[i]] >= minSize) out[i] = 1
  return out
}

/** Reconstrução morfológica: mantém os componentes de `mask` que tocam algum pixel de `marker`. */
export function reconstruct(mask, marker, w, h) {
  const { labels, sizes } = components(mask, w, h)
  const keep = new Uint8Array(sizes.length)
  for (let i = 0; i < mask.length; i++) if (marker[i] && labels[i] >= 0) keep[labels[i]] = 1
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) if (labels[i] >= 0 && keep[labels[i]]) out[i] = 1
  return out
}

/**
 * Preenche buracos (componentes de fundo que não tocam a borda) menores que maxSize.
 * Com wrapX, só as bordas de cima/baixo contam: o mapa dá a volta em x, então um buraco
 * que encosta na borda leste/oeste continua sendo buraco.
 */
export function fillHoles(mask, w, h, maxSize = Infinity, { wrapX = false } = {}) {
  const inv = new Uint8Array(w * h)
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1
  const { labels, sizes } = components(inv, w, h)
  const open = new Uint8Array(sizes.length) // componentes que tocam uma borda "aberta"
  for (let x = 0; x < w; x++) {
    if (inv[x]) open[labels[x]] = 1
    if (inv[(h - 1) * w + x]) open[labels[(h - 1) * w + x]] = 1
  }
  if (!wrapX) {
    for (let y = 0; y < h; y++) {
      if (inv[y * w]) open[labels[y * w]] = 1
      if (inv[y * w + w - 1]) open[labels[y * w + w - 1]] = 1
    }
  }
  const out = mask.slice()
  for (let i = 0; i < out.length; i++) {
    if (inv[i] && !open[labels[i]] && sizes[labels[i]] <= maxSize) out[i] = 1
  }
  return out
}

/** Desfoque aproximadamente gaussiano (3 passadas de média móvel, raio r) num campo float. */
export function blur(field, w, h, r) {
  let a = Float32Array.from(field)
  let b = new Float32Array(w * h)
  const n = 2 * r + 1
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w
      let s = 0
      for (let x = -r; x <= r; x++) s += a[row + Math.min(w - 1, Math.max(0, x))]
      for (let x = 0; x < w; x++) {
        b[row + x] = s / n
        s += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let y = -r; y <= r; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x]
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / n
        s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]
      }
    }
  }
  return a
}

/** Transformada de distância euclidiana exata (Felzenszwalb). Distância até o pixel mais próximo com mask=1. */
export function edt(mask, w, h) {
  const INF = 1e20
  const f = new Float64Array(Math.max(w, h))
  const d = new Float64Array(Math.max(w, h))
  const v = new Int32Array(Math.max(w, h))
  const z = new Float64Array(Math.max(w, h) + 1)
  const grid = new Float64Array(w * h)
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] ? 0 : INF

  const pass = (n) => {
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++
      d[q] = (q - v[k]) ** 2 + f[v[k]]
    }
  }

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]
    pass(h)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]
    pass(w)
    for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x])
  }
  return grid
}
