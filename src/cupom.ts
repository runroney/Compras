// Leitura de cupom fiscal: transforma o texto lido pelo OCR em itens, junta os quadros do vídeo sem duplicar
// e sugere o produto do catálogo. Funções puras (sem tela, sem banco), para poderem ser testadas sozinhas.
import { norm } from './util'

export interface OcrLine { text: string; conf: number }
export interface CupomItem {
  idx: number | null; desc: string; qty: number; unitCode: string
  unit: number | null; total: number | null; ok: boolean; conf: number; seen: number
}
export interface CupomFrame { items: CupomItem[]; total: number | null; date: string | null }

// ---------- números ----------
const D = '[0-9OIl]'
const P = `(\\d${D}{0,8}?)\\s?[.,]\\s?(${D}{2})`           // preço: 24,90 / 1.234,56 (tolera O no lugar de 0)
const Q = `(\\d{1,4}(?:[.,]\\d{1,3})?)`                       // quantidade
const UN = '(UN|UND|UNID|KG|KGS|G|L|LT|ML|PC|PCT|CX|DZ|FD|FR|LA|PÇ)'
const TAIL = '(?:\\s+[A-Z]{1,2}\\d{0,2})?\\s*$'               // código de imposto no fim da linha (F1, T01, A)
const RE_X = new RegExp(`^(.*?)\\s*${Q}\\s*${UN}?\\s*[xX×*]\\s*${P}\\s*=?\\s*${P}${TAIL}`, 'i')
const RE_NOX = new RegExp(`^(.*?)\\s+${Q}\\s*${UN}\\s+${P}\\s+${P}${TAIL}`, 'i')
const RE_ONE = new RegExp(`^\\s*\\d{1,3}\\s+(.*?\\S)\\s+${P}${TAIL}`, 'i')
const fix = (s: string) => s.replace(/[OIl]/g, c => (c === 'O' ? '0' : '1'))
const money = (int: string, dec: string) => Number(fix(int).replace(/\./g, '') + '.' + fix(dec))
const qtyNum = (s: string) => Number(fix(s).replace(',', '.'))

const BLOCK = new Set(['total', 'subtotal', 'troco', 'dinheiro', 'cartao', 'cpf', 'cnpj', 'icms', 'tributos', 'qtd', 'valor', 'pagamento', 'desconto', 'acrescimo', 'debito', 'credito', 'pix', 'nfc', 'nfce', 'danfe', 'consumidor', 'chave', 'protocolo', 'operador', 'caixa', 'ccf', 'coo', 'cupom', 'fiscal', 'itens', 'item', 'codigo', 'descricao', 'unit', 'inscricao', 'obrigado', 'volte', 'www', 'tel', 'fone', 'emissao', 'serie', 'numero', 'via', 'autorizacao', 'sat', 'tributacao'])
const blocked = (s: string) => norm(s).split(/[^a-z0-9]+/).some(t => BLOCK.has(t))
const MIN_CONF = 60
const letters = (s: string) => (s.match(/[A-Za-zÀ-ÿ]/g) ?? []).length

/** Tira índice do item (001), código de barras e lixo de OCR do começo da descrição. */
export function cleanDesc(s: string): { desc: string; idx: number | null } {
  let t = s.replace(/^[\s|!_\-.:]+/, '')
  let idx: number | null = null
  // fichas iniciais que são número/código (às vezes lidas com letras trocadas: 0 -> O, B, A, S...)
  for (let k = 0; k < 3; k++) {
    const m = t.match(/^(\S+)\s+(?=\S)/); if (!m) break
    const tok = m[1]
    const digitsy = /\d/.test(tok) && /^[0-9OIlBSAN|]+$/.test(tok)
    const junk = tok.length >= 9 && (/\d/.test(tok) || /^[OIlBSAN]+$/.test(tok)) // código de barras com letras trocadas
    if (!digitsy && !junk) break
    if (idx == null && /^\d{1,4}$/.test(tok) && tok.length <= 4) idx = Number(tok.slice(-3))
    t = t.slice(m[0].length)
  }
  t = t.replace(/\b\d{7,14}\b/g, ' ').replace(/[|_]/g, ' ').replace(/\s+/g, ' ').trim()
  return { desc: t, idx }
}

export function parseFrame(lines: OcrLine[]): CupomFrame {
  const items: CupomItem[] = []
  let total: number | null = null, totalRank = 0, date: string | null = null
  let pending: { desc: string; idx: number | null; conf: number } | null = null
  for (const { text: raw, conf } of lines) {
    const line = raw.replace(/\s+/g, ' ').trim(); if (!line) continue
    if (!date) {
      const d = line.match(/(\d{2})\/(\d{2})\/(\d{4})/)
      if (d && +d[3] >= 2000 && +d[3] <= 2100 && +d[2] >= 1 && +d[2] <= 12 && +d[1] >= 1 && +d[1] <= 31) date = `${d[3]}-${d[2]}-${d[1]}`
    }
    const n = norm(line)
    const tp = line.match(new RegExp(`${P}\\s*$`))
    if (tp && /\btotal\b|a pagar/.test(n) && !/subtotal|desconto|troco/.test(n)) {
      const v = money(tp[1], tp[2]); const rank = /a pagar|valor total/.test(n) ? 2 : 1
      if (rank > totalRank || (rank === totalRank && v > (total ?? 0))) { total = v; totalRank = rank }
      continue
    }
    let m = line.match(RE_X), kind: 'x' | 'nox' | 'one' | null = m ? 'x' : null
    if (!m) { m = line.match(RE_NOX); if (m) kind = 'nox' }
    if (m && kind) {
      const qty = qtyNum(m[2]), unitCode = (m[3] ?? 'UN').toUpperCase()
      const unit = money(m[4], m[5]), tot = money(m[6], m[7])
      let { desc, idx } = cleanDesc(m[1])
      let c = conf
      if (letters(desc) < 3 && pending) { desc = pending.desc; idx = idx ?? pending.idx; c = Math.min(conf, pending.conf) }
      pending = null
      if (letters(desc) < 3 || blocked(desc) || !(qty > 0) || c < MIN_CONF) continue // linha cortada na borda do quadro costuma vir com confiança baixa
      const ok = Math.abs(qty * unit - tot) <= Math.max(0.03, tot * 0.01)
      items.push({ idx, desc, qty, unitCode, unit, total: tot, ok, conf: c, seen: 1 })
      continue
    }
    const one = line.match(RE_ONE)
    if (one && letters(one[1]) >= 3 && !blocked(one[1])) {
      const { desc, idx } = cleanDesc(line.replace(new RegExp(`\\s+${P}${TAIL}`), ''))
      const v = money(one[2], one[3])
      if (letters(desc) >= 3) { items.push({ idx, desc, qty: 1, unitCode: 'UN', unit: v, total: v, ok: true, conf, seen: 1 }); pending = null; continue }
    }
    if (letters(line) >= 4 && !blocked(line) && !/\d[.,]\d{2}\s*$/.test(line)) { const c = cleanDesc(line); if (letters(c.desc) >= 3) pending = { ...c, conf } }
  }
  return { items, total, date }
}

// ---------- parecido entre textos ----------
function lev(a: string, b: string) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}
export const strSim = (a: string, b: string) => { const L = Math.max(a.length, b.length); return L ? 1 - lev(a, b) / L : 1 }
const flat = (s: string) => norm(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Tamanhos como "5kg", "395 g", "1,5 L" viram um valor comparável (g ou ml). */
export function sizesOf(s: string): string[] {
  const out: string[] = []
  const re = /(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|l|lt)\b/gi
  let m: RegExpExecArray | null
  const t = norm(s)
  while ((m = re.exec(t))) {
    let v = Number(m[1].replace(',', '.')); const u = m[2].toLowerCase()
    if (u === 'kg' || u === 'l' || u === 'lt') v *= 1000
    out.push(`${Math.round(v)}${u === 'ml' || u === 'l' || u === 'lt' ? 'ml' : 'g'}`)
  }
  return out
}

// ---------- juntar quadros do vídeo sem duplicar ----------
export interface Merged extends CupomItem { }
export function mergeFrames(frames: CupomFrame[]): { items: Merged[]; total: number | null; date: string | null } {
  const clusters: { members: { item: CupomItem; frame: number }[] }[] = []
  frames.forEach((f, fi) => {
    const usedHere = new Set<number>()
    for (const it of f.items) {
      let best = -1, bestSim = 0
      clusters.forEach((c, ci) => {
        if (usedHere.has(ci) || c.members.some(m => m.frame === fi)) return
        const rep = c.members.reduce((a, b) => (b.item.conf > a.item.conf ? b : a)).item
        const sim = strSim(flat(it.desc), flat(rep.desc))
        const sa = sizesOf(it.desc), sb = sizesOf(rep.desc)
        if (sa.length && sb.length && sa.join() !== sb.join()) return // tamanhos diferentes = produtos diferentes
        const same = (it.idx != null && it.idx === rep.idx && sim >= 0.5) || sim >= 0.78
        if (same && sim > bestSim) { best = ci; bestSim = sim }
      })
      if (best >= 0) { clusters[best].members.push({ item: it, frame: fi }); usedHere.add(best) }
      else { clusters.push({ members: [{ item: it, frame: fi }] }); usedHere.add(clusters.length - 1) }
    }
  })
  const items = clusters.map(c => {
    const ms = c.members.map(m => m.item)
    const good = ms.filter(m => m.ok); const pool = good.length ? good : ms
    // valores: o que mais se repete entre os quadros (e fecha a conta); senão o de maior confiança
    const votes = new Map<string, { n: number; best: CupomItem }>()
    for (const m of pool) { const k = `${m.qty}|${m.unit}|${m.total}`; const v = votes.get(k); if (!v) votes.set(k, { n: 1, best: m }); else { v.n++; if (m.conf > v.best.conf) v.best = m } }
    const win = [...votes.values()].sort((a, b) => b.n - a.n || b.best.conf - a.best.conf)[0].best
    const descBest = ms.reduce((a, b) => (b.conf * Math.min(b.desc.length, 30) > a.conf * Math.min(a.desc.length, 30) ? b : a))
    return { ...win, desc: descBest.desc, idx: ms.find(m => m.idx != null)?.idx ?? null, seen: ms.length, conf: Math.max(...ms.map(m => m.conf)) }
  })
  // linha cortada na borda de um quadro: sobra só um registro fraco, com os mesmos números de um item já visto várias vezes
  const keep = items.filter(a => !(a.seen === 1 && items.some(b => b !== a && b.seen >= 2 && b.qty === a.qty && b.unit === a.unit && b.total === a.total && strSim(flat(a.desc), flat(b.desc)) >= 0.3)))
  const total = frames.map(f => f.total).filter((x): x is number => x != null).sort((a, b) => b - a)[0] ?? null
  const date = frames.map(f => f.date).find(Boolean) ?? null
  return { items: keep, total, date }
}

// ---------- sugerir produto do catálogo ----------
export interface CatalogProduct { id: string; name: string; brand?: string | null; presentation?: string | null }
export interface Suggestion { id: string; score: number; sizeMismatch: boolean }
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'por', 'tipo', 'cx', 'pct', 'un', 'und', 'uni', 'unid', 'unidade', 'pacote', 'caixa', 'kg', 'g', 'ml', 'l'])
const toks = (s: string) => flat(s).split(' ').filter(t => t.length >= 2 && !/^\d+$/.test(t) && !STOP.has(t) && !/^\d+(kg|g|gr|ml|l|lt)$/.test(t))
const isSubseq = (t: string, q: string) => { let i = 0; for (const c of q) if (c === t[i]) i++; return i === t.length }
function tokScore(t: string, q: string) {
  if (t === q) return 1
  const m = Math.min(t.length, q.length)
  if (m >= 3 && (t.startsWith(q) || q.startsWith(t))) return 0.85
  if (t.length >= 3 && t[0] === q[0] && isSubseq(t, q)) return 0.75
  if (m >= 4 && strSim(t, q) >= 0.75) return 0.7
  return 0
}
export function suggest(desc: string, catalog: CatalogProduct[], max = 5): { list: Suggestion[]; auto: boolean } {
  const ct = toks(desc); const cs = sizesOf(desc)
  const out: Suggestion[] = []
  for (const p of catalog) {
    const full = [p.name, p.brand, p.presentation].filter(Boolean).join(' ')
    const pt = toks(full); if (!pt.length || !ct.length) continue
    const cCover = ct.reduce((s, t) => s + Math.max(...pt.map(q => tokScore(t, q))), 0) / ct.length
    const pCover = pt.reduce((s, q) => s + Math.max(...ct.map(t => tokScore(t, q))), 0) / pt.length
    let score = 0.4 * cCover + 0.6 * pCover
    const ps = sizesOf(full); let mismatch = false
    if (cs.length && ps.length) { if (cs.some(x => ps.includes(x))) score += 0.12; else { score -= 0.4; mismatch = true } }
    if (score > 0.3) out.push({ id: p.id, score, sizeMismatch: mismatch })
  }
  out.sort((a, b) => b.score - a.score)
  const list = out.slice(0, max)
  const auto = list.length > 0 && list[0].score >= 0.62 && !list[0].sizeMismatch && (list.length < 2 || list[0].score - list[1].score >= 0.06)
  return { list, auto }
}
