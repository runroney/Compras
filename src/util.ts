export const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
export const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
export const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString()
export const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const num = (s: string): number | null => {
  const t = s.replace(/\./g, '').replace(',', '.').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
export const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','))
export const UNITS = ['un', 'kg', 'g', 'L', 'ml', 'pct', 'cx', 'lata', 'dz', 'fr', 'maço', 'band.']

/** Máscara de preço: só os números contam e a vírgula entra sozinha (650 vira 6,50). */
export const maskMoney = (s: string): string => {
  const d = s.replace(/\D/g, '').replace(/^0+/, '')
  if (!d) return ''
  const c = d.padStart(3, '0')
  return c.slice(0, -2) + ',' + c.slice(-2)
}
export const toMask = (n: number | null | undefined): string => (n != null ? maskMoney(String(Math.round(n * 100))) : '')
