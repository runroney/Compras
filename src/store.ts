import { del, get, set } from 'idb-keyval'
import { useSyncExternalStore } from 'react'
import { remote } from './remote'
import { TABLES } from './types'
import type { AnyRow, Household, RowOf, Session, Table } from './types'
import { now, uid, norm, clean } from './util'
import type { Product } from './types'

type Tables = { [T in Table]: Record<string, RowOf<T>> }
export interface State {
  ready: boolean
  session: Session | null
  household: Household | null
  tables: Tables
  dirty: Record<string, 1> // "tabela:id" => ainda não enviado
  cursor: Record<string, string> // último synced_at recebido por tabela
  online: boolean
  syncing: boolean
  error: string | null
  lastSync: string | null
}
const empty = (): Tables => ({ categories: {}, products: {}, lists: {}, list_items: {}, price_history: {} })
let state: State = {
  ready: false, session: null, household: null, tables: empty(), dirty: {}, cursor: {},
  online: typeof navigator === 'undefined' ? true : navigator.onLine, syncing: false, error: null, lastSync: null,
}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())
const patch = (p: Partial<State>) => { state = { ...state, ...p }; emit() }
export const useApp = () => useSyncExternalStore(cb => (listeners.add(cb), () => listeners.delete(cb)), () => state)
export const getState = () => state

// ---------- persistência local (IndexedDB) ----------
const KEY = 'compras-state-v1'
let saveTimer: ReturnType<typeof setTimeout> | null = null
const persist = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { session, household, tables, dirty, cursor, lastSync } = state
    set(KEY, { session, household, tables, dirty, cursor, lastSync }).catch(() => {})
  }, 0) // agrupa escritas do mesmo instante, mas grava logo: fechar o app não pode perder a marcação
}

// ---------- escrita local (sempre funciona, com ou sem internet) ----------
export function upsert<T extends Table>(table: T, row: Omit<RowOf<T>, 'updated_at' | 'household_id' | 'deleted'> & Partial<RowOf<T>>) {
  const hid = state.household?.id ?? ''
  const full = { deleted: false, household_id: hid, ...row, updated_at: now() } as RowOf<T>
  state = {
    ...state,
    tables: { ...state.tables, [table]: { ...state.tables[table], [full.id]: full } },
    dirty: { ...state.dirty, [`${table}:${full.id}`]: 1 },
  }
  emit(); persist(); scheduleSync()
  return full
}
export const softDelete = <T extends Table>(table: T, id: string) => {
  const cur = state.tables[table][id]
  if (cur) upsert(table, { ...cur, deleted: true } as any)
}

// ---------- sincronização ----------
let syncTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let again = false
export function scheduleSync(delay = 400) {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => { void syncNow() }, delay)
}

export async function syncNow() {
  const { session, household } = state
  if (!remote || !session || !household) return
  if (!navigator.onLine) { patch({ online: false }); return }
  if (running) { again = true; return }
  running = true; patch({ syncing: true, online: true })
  try {
    // 1) envia o que está pendente
    for (const t of TABLES) {
      const keys = Object.keys(state.dirty).filter(k => k.startsWith(t + ':'))
      if (!keys.length) continue
      const rows = keys.map(k => state.tables[t][k.slice(t.length + 1)]).filter(Boolean) as AnyRow[]
      await remote.push(t, rows)
      const dirty = { ...state.dirty }
      for (const r of rows) {
        const cur = state.tables[t][r.id]
        if (cur && cur.updated_at === r.updated_at) delete dirty[`${t}:${r.id}`] // não mexeram enquanto enviava
      }
      state = { ...state, dirty }
    }
    // 2) busca o que mudou no servidor (inclui o resultado de conflitos)
    const cursor = { ...state.cursor }
    const tables = { ...state.tables }
    for (const t of TABLES) {
      const rows = await remote.pull(t, household.id, cursor[t] ?? null)
      if (!rows.length) continue
      const map: Record<string, AnyRow> = { ...tables[t] }
      for (const r of rows) {
        const loc = map[r.id]
        const isDirty = state.dirty[`${t}:${r.id}`]
        // alteração local ainda não enviada e mais nova vence; senão vale o servidor
        if (!(loc && isDirty && loc.updated_at > r.updated_at)) map[r.id] = r
        if (!cursor[t] || (r.synced_at && r.synced_at > cursor[t])) cursor[t] = r.synced_at!
      }
      ;(tables as any)[t] = map
    }
    patch({ tables, cursor, error: null, lastSync: now() })
    persist()
  } catch (e: any) {
    patch({ error: e?.message ?? 'falha ao sincronizar' })
  } finally {
    running = false; patch({ syncing: false })
    if (again) { again = false; scheduleSync(200) }
  }
}

let unsub: (() => void) | null = null
function startRealtime() {
  unsub?.(); unsub = null
  if (remote && state.household) unsub = remote.subscribe(state.household.id, () => scheduleSync(300))
}

// ---------- ciclo de vida ----------
export async function boot() {
  const saved: any = await get(KEY).catch(() => undefined)
  if (saved) state = { ...state, ...saved, tables: { ...empty(), ...saved.tables } }
  patch({ ready: true })
  window.addEventListener('online', () => { patch({ online: true }); scheduleSync(100) })
  window.addEventListener('offline', () => patch({ online: false }))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(100); else persist() })
  window.addEventListener('pagehide', persist)
  setInterval(() => scheduleSync(0), 30000)
  if (!remote) return
  try {
    if (navigator.onLine) {
      const s = await remote.getSession()
      if (s) { patch({ session: s }); persist(); if (!state.household) await loadHousehold() }
      else if (state.session) patch({ session: null }) // sessão expirou
    }
  } catch { /* offline: segue com o que está salvo */ }
  startRealtime(); scheduleSync(0)
}
export async function loadHousehold() {
  if (!remote) return
  const h = await remote.myHousehold()
  patch({ household: h }); persist(); startRealtime(); scheduleSync(0)
}
export async function signIn(email: string, pw: string) {
  const s = await remote!.signIn(email, pw)
  patch({ session: s }); persist(); await loadHousehold()
}
export async function signUp(email: string, pw: string) {
  const s = await remote!.signUp(email, pw)
  if (!s) throw new Error('Conta criada. Confirme o e-mail (veja sua caixa de entrada) e entre.')
  patch({ session: s }); persist(); await loadHousehold()
}
export async function signOut() {
  unsub?.(); unsub = null
  await remote?.signOut()
  await del(KEY)
  state = { ...state, session: null, household: null, tables: empty(), dirty: {}, cursor: {}, lastSync: null }
  emit()
}
export async function createHousehold(name: string) {
  const h = await remote!.createHousehold(name)
  patch({ household: h }); persist(); startRealtime()
  return h
}
export async function joinHousehold(code: string) {
  const h = await remote!.joinHousehold(code)
  patch({ household: h }); persist(); startRealtime(); scheduleSync(0)
}

// ---------- seletores / regras de negócio ----------
export const live = <T extends Table>(t: T): RowOf<T>[] =>
  Object.values(state.tables[t]).filter(r => !r.deleted) as RowOf<T>[]
export const categoriesSorted = () => live('categories').sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
export const activeList = () => live('lists').filter(l => l.status === 'active').sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
export const itemsOf = (listId: string) => live('list_items').filter(i => i.list_id === listId)
export const lineEst = (i: { qty: number; est_price: number | null }) => (i.est_price ?? 0) * i.qty
export const lineSpent = (i: { qty: number; est_price: number | null; paid_price: number | null; checked: boolean }) =>
  i.checked ? (i.paid_price ?? i.est_price ?? 0) * i.qty : 0
export const totals = (items: ReturnType<typeof itemsOf>) => ({
  est: items.reduce((s, i) => s + lineEst(i), 0),
  spent: items.reduce((s, i) => s + lineSpent(i), 0),
  done: items.filter(i => i.checked).length,
  total: items.length,
  noPrice: items.filter(i => i.est_price == null).length,
  forecast: items.reduce((s, i) => s + (i.checked ? lineSpent(i) : lineEst(i)), 0), // carrinho + estimativa do que falta
})
/** Limites fixos de alerta do carrinho. */
export const LIMITS = [800, 900, 1000] as const
export const cartLevel = (cart: number): 0 | 800 | 900 | 1000 => (cart >= 1000 ? 1000 : cart >= 900 ? 900 : cart >= 800 ? 800 : 0)
/** Último preço oficial = products.price (só cupom ou Excel revisado e confirmado mexe nele). */
export const officialOf = (productId: string | null | undefined): number | null =>
  (productId ? state.tables.products[productId]?.price : null) ?? null
export const lastOfficialAt = (productId: string): string | null =>
  live('price_history').filter(h => h.product_id === productId && h.kind === 'oficial').reduce<string | null>((m, h) => (!m || h.at > m ? h.at : m), null)
export const findProduct = (name: string) => live('products').find(p => norm(p.name) === norm(name))

export function ensureList() {
  let l = activeList()
  if (!l) l = upsert('lists', { id: uid(), name: 'Compras de ' + new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), status: 'active', created_at: now(), archived_at: null })
  return l
}
export function addItem(p: { name: string; category: string; qty: number; unit: string; price: number | null; productId?: string | null }) {
  const list = ensureList()
  const name = clean(p.name)
  let product = p.productId ? state.tables.products[p.productId] : findProduct(name)
  // Produto novo nasce sem preço oficial. O preço digitado aqui vale só como estimativa do item.
  if (!product || product.deleted) product = upsert('products', { id: uid(), name, category: p.category, unit: p.unit, price: null })
  const dup = itemsOf(list.id).find(i => i.product_id === product!.id)
  if (dup) return upsert('list_items', { ...dup, qty: dup.qty + p.qty, checked: false }) // mesmo produto: soma
  return upsert('list_items', {
    id: uid(), list_id: list.id, product_id: product.id, name: product.name, category: product.category,
    qty: p.qty, unit: p.unit, est_price: p.price ?? product.price, paid_price: null, checked: false, sort: Date.now(),
  })
}
export function toggleItem(id: string) {
  const it = state.tables.list_items[id]; if (it) upsert('list_items', { ...it, checked: !it.checked })
}
/** Arquiva a lista atual e cria uma nova (vazia ou copiando uma lista existente). */
export function newList(opts: { copyFrom?: string | 'current'; onlyPending?: boolean }) {
  const cur = activeList()
  const srcId = opts.copyFrom === 'current' ? cur?.id : opts.copyFrom
  const src = srcId ? itemsOf(srcId) : []
  if (cur) upsert('lists', { ...cur, status: 'archived', archived_at: now() })
  const nl = upsert('lists', { id: uid(), name: 'Compras de ' + new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }), status: 'active', created_at: now(), archived_at: null })
  for (const i of src) {
    if (opts.onlyPending && i.checked) continue
    const pr = i.product_id ? state.tables.products[i.product_id] : undefined
    upsert('list_items', { ...i, id: uid(), list_id: nl.id, checked: false, paid_price: null, est_price: pr?.price ?? i.est_price, sort: i.sort })
  }
  return nl
}
export function moveCategory(id: string, dir: -1 | 1) {
  const cats = categoriesSorted(); const i = cats.findIndex(c => c.id === id); const j = i + dir
  if (i < 0 || j < 0 || j >= cats.length) return
  ;[cats[i], cats[j]] = [cats[j], cats[i]]
  cats.forEach((c, k) => { if (c.sort !== k) upsert('categories', { ...c, sort: k }) })
}

// ---------- importação ----------
export interface ImportRow { category: string; name: string; price: number | null; qty: number | null }
export interface ImportReport { lidos: number; novos: number; existentes: number; precosAtualizados: number; naLista: number; categoriasNovas: number }
export function importRows(rows: ImportRow[], opts: { categories?: { name: string; color: string }[]; addToList: boolean }): ImportReport {
  const rep: ImportReport = { lidos: rows.length, novos: 0, existentes: 0, precosAtualizados: 0, naLista: 0, categoriasNovas: 0 }
  const catNames = new Set(live('categories').map(c => norm(c.name)))
  let sort = live('categories').reduce((m, c) => Math.max(m, c.sort), -1) + 1
  for (const c of opts.categories ?? []) if (!catNames.has(norm(c.name))) { upsert('categories', { id: uid(), name: c.name, color: c.color, sort: sort++ }); catNames.add(norm(c.name)); rep.categoriasNovas++ }
  for (const r of rows) {
    const name = clean(r.name); if (!name) continue
    let cat = clean(r.category || 'Outros')
    if (!catNames.has(norm(cat))) { upsert('categories', { id: uid(), name: cat, color: '#CFD8DC', sort: sort++ }); catNames.add(norm(cat)); rep.categoriasNovas++ }
    else cat = live('categories').find(c => norm(c.name) === norm(cat))?.name ?? cat
    let p = findProduct(name)
    if (p) {
      rep.existentes++
      if (r.price != null && p.price !== r.price) { p = upsert('products', { ...p, price: r.price }); rep.precosAtualizados++ }
    } else { p = upsert('products', { id: uid(), name, category: cat, unit: 'un', price: r.price }); rep.novos++ }
    if (opts.addToList && r.qty && r.qty > 0) {
      const list = ensureList()
      if (!itemsOf(list.id).some(i => i.product_id === p!.id)) {
        upsert('list_items', { id: uid(), list_id: list.id, product_id: p.id, name: p.name, category: p.category, qty: r.qty, unit: p.unit, est_price: p.price, paid_price: null, checked: false, sort: itemsOf(list.id).length * 1024 })
        rep.naLista++
      }
    }
  }
  return rep
}

// ---------- preço oficial (só cupom ou Excel revisado e confirmado) ----------
const atFromDate = (d: string) => (!d || d === now().slice(0, 10) ? now() : new Date(d + 'T12:00:00').toISOString())
/**
 * Grava um preço oficial confirmado. Sempre entra no histórico (sem duplicar: mesmo produto, preço e dia).
 * Só vira o preço oficial atual se a data não for mais antiga que a última confirmação já registrada.
 */
export function addOfficialPrice(productId: string, price: number, atISO: string): 'atualizado' | 'historico' | 'duplicado' {
  const p = state.tables.products[productId]; if (!p) return 'duplicado'
  const hist = live('price_history').filter(h => h.product_id === productId && h.kind === 'oficial')
  if (hist.some(h => h.price === price && h.at.slice(0, 10) === atISO.slice(0, 10))) return 'duplicado'
  const latest = hist.reduce<string | null>((m, h) => (!m || h.at > m ? h.at : m), null)
  upsert('price_history', { id: uid(), product_id: p.id, product_name: p.name, price, kind: 'oficial', at: atISO })
  if (latest && atISO < latest) return 'historico'
  if (p.price !== price) upsert('products', { ...p, price })
  return 'atualizado'
}

// ---------- importação de Excel revisada ----------
export interface ImportLine { key: number; row: ImportRow; product: Product | null; category: string; catFallback: boolean }
export interface ImportResult { lidos: number; novos: number; oficiais: number; soHistorico: number; jaRegistrados: number; estimativas: number; naLista: number; ignorados: number }
/** Monta a conferência sem gravar nada. Não cria categorias: categoria desconhecida cai em "Outros". */
export function planImport(rows: ImportRow[]): ImportLine[] {
  const cats = categoriesSorted()
  const fallback = cats.find(c => norm(c.name) === 'outros')?.name ?? cats[0]?.name ?? 'Outros'
  const seen = new Set<string>(); const out: ImportLine[] = []
  rows.forEach(r => {
    const name = clean(r.name); const k = norm(name); if (!name || seen.has(k)) return
    seen.add(k)
    const product = findProduct(name) ?? null
    const found = cats.find(c => norm(c.name) === norm(r.category || ''))
    out.push({ key: out.length, row: { ...r, name }, product, category: product?.category ?? found?.name ?? fallback, catFallback: !product && !found })
  })
  return out
}
/** Grava somente as linhas marcadas. Modo 'estimate' nunca toca no preço oficial. */
export function applyImport(lines: ImportLine[], o: { mode: 'estimate' | 'official'; date: string; keep: Set<number> }): ImportResult {
  const rep: ImportResult = { lidos: lines.length, novos: 0, oficiais: 0, soHistorico: 0, jaRegistrados: 0, estimativas: 0, naLista: 0, ignorados: 0 }
  const at = atFromDate(o.date)
  for (const l of lines) {
    if (!o.keep.has(l.key)) { rep.ignorados++; continue }
    const price = l.row.price
    let p = l.product ? state.tables.products[l.product.id] : undefined
    if (!p || p.deleted) { p = upsert('products', { id: uid(), name: l.row.name, category: l.category, unit: 'un', price: null }); rep.novos++ }
    if (o.mode === 'official' && price != null) {
      const r = addOfficialPrice(p.id, price, at)
      if (r === 'atualizado') rep.oficiais++; else if (r === 'historico') rep.soHistorico++; else rep.jaRegistrados++
      p = state.tables.products[p.id]
    }
    const est = o.mode === 'estimate' ? (price ?? p.price) : p.price
    const list = (l.row.qty || (o.mode === 'estimate' && price != null)) ? ensureList() : undefined
    if (!list) continue
    const on = itemsOf(list.id).find(i => i.product_id === p!.id)
    if (on) {
      if (o.mode === 'estimate' && price != null && on.est_price !== price) { upsert('list_items', { ...on, est_price: price }); rep.estimativas++ }
    } else if (l.row.qty && l.row.qty > 0) {
      upsert('list_items', { id: uid(), list_id: list.id, product_id: p.id, name: p.name, category: p.category, qty: l.row.qty, unit: p.unit, est_price: est, paid_price: null, checked: false, sort: Date.now() })
      rep.naLista++
    }
  }
  return rep
}
export { uid }
