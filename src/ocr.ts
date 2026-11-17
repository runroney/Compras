// Leitor de texto (OCR) que roda dentro do aparelho. Nenhuma imagem sai do celular.
import type { Worker } from 'tesseract.js'
import type { OcrLine } from './cupom'

let worker: Promise<Worker> | null = null
const abs = (p: string) => new URL(import.meta.env.BASE_URL + p, location.href).href.replace(/\/$/, '')

export function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = (async () => {
      const { createWorker } = await import('tesseract.js')
      const base = abs('tesseract')
      const w = await createWorker('por', 1, { workerPath: base + '/worker.min.js', corePath: base, langPath: base, gzip: true, cacheMethod: 'none' })
      await w.setParameters({ tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '1' })
      return w
    })().catch(e => { worker = null; throw e })
  }
  return worker
}
export async function stopWorker() { const w = worker; worker = null; if (w) { try { await (await w).terminate() } catch { /* nada */ } } }

/** Cinza + esticar o contraste: ajuda muito em papel térmico desbotado. */
function prepare(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const scale = w < 1100 ? 1100 / w : 1
  const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale)
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(src, 0, 0, c.width, c.height)
  const im = g.getImageData(0, 0, c.width, c.height); const d = im.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++ }
  const n = d.length / 4; let lo = 0, hi = 255, acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break } }
  acc = 0
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break } }
  const k = hi > lo + 10 ? 255 / (hi - lo) : 1
  for (let i = 0; i < d.length; i += 4) { const y = Math.max(0, Math.min(255, (d[i] - lo) * k)); d[i] = d[i + 1] = d[i + 2] = y }
  g.putImageData(im, 0, 0)
  return c
}

export async function readFrame(blob: Blob): Promise<OcrLine[]> {
  const w = await getWorker()
  const bmp = await createImageBitmap(blob)
  const canvas = prepare(bmp, bmp.width, bmp.height); bmp.close()
  const { data } = await w.recognize(canvas)
  canvas.width = canvas.height = 0
  return (data.lines ?? []).map(l => ({ text: l.text, conf: l.confidence }))
}
