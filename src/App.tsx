import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { configured } from './remote'
import {
  activeList, addItem, applyImport, budgetAlert, categoriesSorted, createHousehold, displayName, findProduct, itemsOf, joinHousehold, lastOfficialAt, lineEst, live, moveCategory,
  newList, officialOf, planImport, signIn, signOut, signUp, softDelete, syncNow, toggleItem, totals, upsert, uid, useApp,
  type ImportLine, type ImportResult,
} from './store'
import { exportWorkbook, readWorkbook } from './io'
import seed from './seed.json'
import { importRows } from './store'
import type { ListItem, Product } from './types'
import { UNITS, brl, clean, fmtQty, maskMoney, norm, num, toMask } from './util'

type Tab = 'lista' | 'produtos' | 'historico' | 'resumo'

export default function App() {
  const s = useApp()
  if (!configured) return <Setup />
  if (!s.ready) return <div className="empty">Carregando…</div>
  if (!s.session) return <Auth />
  if (!s.household) return <HouseholdSetup />
  return <Shell />
}

const CupomFlow = lazy(() => import('./Cupom')) // câmera + leitor de texto só carregam quando usados

function Setup() {
  return <div className="auth"><h1>Falta configurar</h1><p>O app ainda não está ligado ao banco na nuvem. Siga o passo a passo do README (Supabase) e gere o app de novo com as duas chaves.</p></div>
}

function Auth() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const go = async () => {
    setErr(''); setBusy(true)
    try { await (mode === 'in' ? signIn(email.trim(), pw) : signUp(email.trim(), pw)) }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return <div className="auth">
    <h1>🛒 Compras</h1><p>{mode === 'in' ? 'Entre para ver sua lista.' : 'Crie sua conta (e-mail e senha de 6+ caracteres).'}</p>
    <label className="lbl">E-mail</label><input className="field" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
    <label className="lbl">Senha</label><input className="field" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
    <button className="btn" disabled={busy || !email || pw.length < 6} onClick={go}>{mode === 'in' ? 'Entrar' : 'Criar conta'}</button>
    {err && <div className="err">{err}</div>}
    <button className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr('') }}>{mode === 'in' ? 'Ainda não tenho conta' : 'Já tenho conta'}</button>
  </div>
}

function HouseholdSetup() {
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true); setErr('')
    try {
      await createHousehold('Casa')
      importRows(seed.products.map(p => ({ category: p.category, name: p.name, price: p.price, qty: null })), { categories: seed.categories, addToList: false })
      importRows(seed.currentList.map(c => ({ category: 'Outros', name: c.name, price: null, qty: c.qty })), { addToList: true })
      void syncNow()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const join = async () => { setBusy(true); setErr(''); try { await joinHousehold(code) } catch (e: any) { setErr(e.message) } finally { setBusy(false) } }
  return <div className="auth">
    <h1>Quase lá</h1>
    <p>Quem começa cria a lista da casa (já vem com os {seed.products.length} produtos). A segunda pessoa entra com o código de convite.</p>
    <button className="btn" disabled={busy} onClick={create}>Criar a lista da casa</button>
    <p style={{ marginTop: 28 }}>Já existe uma lista? Digite o código que a outra pessoa te passou:</p>
    <input className="field" placeholder="código de convite" value={code} onChange={e => setCode(e.target.value)} autoCapitalize="none" />
    <button className="btn sec" disabled={busy || code.length < 4} onClick={join}>Entrar na lista</button>
    {err && <div className="err">{err}</div>}
    <button className="link" onClick={() => signOut()}>Sair</button>
  </div>
}

function SyncChip() {
  const s = useApp()
  const pend = Object.keys(s.dirty).length
  const text = !s.online ? `Offline${pend ? ` · ${pend} pendente${pend > 1 ? 's' : ''}` : ''}` : s.error ? 'Erro de sync' : s.syncing ? 'Sincronizando…' : pend ? `${pend} pendente${pend > 1 ? 's' : ''}` : 'Sincronizado'
  return <span className={'sync' + (!s.online || pend || s.error ? ' warn' : '')} onClick={() => syncNow()} title={s.error ?? ''} data-testid="sync">{text}</span>
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="sheetbg" onClick={onClose}><div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
    <h2>{title}<button className="x" onClick={onClose} aria-label="Fechar">×</button></h2>{children}</div></div>
}
function Toast({ msg }: { msg: string }) { return msg ? <div className="toast">{msg}</div> : null }
const useToast = () => { const [m, setM] = useState(''); return [m, (t: string) => { setM(t); setTimeout(() => setM(''), 1800) }] as const }

function Shell() {
  const [tab, setTab] = useState<Tab>('lista')
  const [settings, setSettings] = useState(false)
  return <div className="app">
    {tab === 'lista' && <ListScreen openSettings={() => setSettings(true)} />}
    {tab === 'produtos' && <ProductsScreen />}
    {tab === 'historico' && <HistoryScreen />}
    {tab === 'resumo' && <SummaryScreen openSettings={() => setSettings(true)} />}
    <nav className="nav">
      {([['lista', '🛒', 'Lista'], ['produtos', '📦', 'Produtos'], ['historico', '🕘', 'Histórico'], ['resumo', '📊', 'Resumo']] as const).map(([k, i, l]) =>
        <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><span>{i}</span>{l}</button>)}
    </nav>
    {settings && <SettingsSheet onClose={() => setSettings(false)} />}
  </div>
}

// ---------------- LISTA ----------------
function ListScreen({ openSettings }: { openSettings: () => void }) {
  useApp()
  const [filter, setFilter] = useState<'falta' | 'ok' | 'todos'>('falta')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [edit, setEdit] = useState<string | null>(null)
  const [toast, say] = useToast()
  const list = activeList()
  const items = list ? itemsOf(list.id) : []
  const t = totals(items)
  const cats = categoriesSorted()
  const shown = items.filter(i => (filter === 'todos' || (filter === 'ok') === i.checked) && (!q || norm(i.name).includes(norm(q))))
  const groups = cats.map(c => ({ c, its: shown.filter(i => i.category === c.name).sort(byName) }))
  const known = new Set(cats.map(c => c.name))
  const orphans = shown.filter(i => !known.has(i.category))
  if (orphans.length) groups.push({ c: { id: 'x', name: 'Outros', color: '#CFD8DC' } as any, its: orphans.sort(byName) })
  const pct = t.total ? Math.round((t.done / t.total) * 100) : 0
  const al = budgetAlert(t.spent, t.forecast)
  const level = al?.level ?? 0
  const [prevLevel, setPrevLevel] = useState(level)
  useEffect(() => { if (al && level > prevLevel) say(al.text); if (level !== prevLevel) setPrevLevel(level) }, [level]) // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <div className="top">
      <h1><span>Compras do mês</span><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><SyncChip /><button className="iconbtn" onClick={openSettings} aria-label="Ajustes">⚙</button></span></h1>
      <div className="sub">{t.done} de {t.total} comprados · {pct}%</div>
      <div className="bar"><i style={{ width: pct + '%' }} /></div>
      <div className="tot"><span>No carrinho {brl(t.spent)}</span><span>Previsão final {brl(t.forecast)}{t.noPrice ? '*' : ''}</span></div>
      <BudgetAlerts spent={t.spent} forecast={t.forecast} />
    </div>
    <div className="scroll">
      <div className="chips">
        {([['falta', `Faltam ${t.total - t.done}`], ['ok', `Comprados ${t.done}`], ['todos', 'Todos']] as const).map(([k, l]) => <button key={k} className={'chip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      <input className="search" placeholder="Buscar na lista" value={q} onChange={e => setQ(e.target.value)} />
      {items.length === 0 && <div className="empty">Lista vazia. Toque no + para adicionar o primeiro produto.</div>}
      {items.length > 0 && shown.length === 0 && <div className="empty">{filter === 'falta' ? 'Nada faltando. Compras concluídas! 🎉' : 'Nenhum item aqui.'}</div>}
      {groups.filter(g => g.its.length).map(({ c, its }) => <div key={c.id} data-grp={c.name}>
        <div className="cat"><span>{c.name}</span><span>{its.filter(i => i.checked).length}/{its.length}</span></div>
        {its.map(i => {
          // Preço unitário atual = o informado no mercado (pago), se houver; senão a estimativa. Compara sempre unitário x unitário.
          // Base da comparação: preço oficial; sem oficial, o preço de referência (estimado) digitado no item.
          const off = officialOf(i.product_id) ?? i.est_price
          const cur = i.paid_price ?? i.est_price
          const cmp = off != null && cur != null && Math.abs(cur - off) > 0.004 ? (cur > off ? ' up' : ' down') : ''
          return <div key={i.id} className={'it' + (i.checked ? ' done' : '')} style={{ ['--c' as any]: c.color }} data-testid="item">
            <button className="cb" onClick={() => toggleItem(i.id)} aria-label={i.checked ? 'Desmarcar' : 'Marcar como comprado'}>{i.checked ? '✓' : ''}</button>
            <div className="mid" onClick={() => setEdit(i.id)}>
              <div className="nm">{i.name}</div>
              <div className="meta">{fmtQty(i.qty)} {i.unit}{i.est_price != null ? ` × ${brl(i.est_price)}` : ' · sem preço'}{i.paid_price != null ? ` · pago ${brl(i.paid_price)}` : ''}</div>
            </div>
            <div className={'val lv' + cmp} data-testid="lineval">{i.paid_price != null ? brl(i.paid_price * i.qty) : i.est_price != null ? brl(lineEst(i)) : ''}</div>
          </div>
        })}
      </div>)}
    </div>
    <button className="fab" onClick={() => setAdding(true)} aria-label="Adicionar produto">+</button>
    {adding && <AddSheet onClose={() => setAdding(false)} />}
    {edit && <ItemSheet id={edit} onClose={() => setEdit(null)} />}
    <Toast msg={toast} />
  </>
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
function BudgetAlerts({ spent, forecast }: { spent: number; forecast: number }) {
  const al = budgetAlert(spent, forecast)
  if (!al) return null
  return <div className="alerts"><div className={'alert l' + al.level} data-testid="alert-cart">{al.text}</div></div>
}

function AddSheet({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Product | null>(null)
  const [cat, setCat] = useState(''); const [qty, setQty] = useState('1'); const [unit, setUnit] = useState('un'); const [price, setPrice] = useState('')
  const [toast, say] = useToast()
  const cats = categoriesSorted()
  const sugg = useMemo(() => {
    const n = norm(q); if (!n) return []
    const all = live('products').filter(p => norm(displayName(p)).includes(n))
    return all.sort((a, b) => (norm(displayName(a)).startsWith(n) ? 0 : 1) - (norm(displayName(b)).startsWith(n) ? 0 : 1) || displayName(a).localeCompare(displayName(b))).slice(0, 8)
  }, [q])
  const exact = q ? findProduct(q) : undefined
  const choose = (p: Product | null, name?: string) => {
    setPicked(p); if (p) { setQ(displayName(p)); setCat(p.category); setUnit(p.unit); setPrice(p.price != null ? String(p.price).replace('.', ',') : '') }
    else { setQ(name ?? q); setCat(cats.find(c => c.name === 'Outros')?.name ?? cats[0]?.name ?? 'Outros') }
  }
  const showForm = picked || (cat && q)
  const add = () => {
    const qn = num(qty) ?? 1
    addItem({ name: q, category: cat || 'Outros', qty: qn, unit, price: num(price), productId: picked?.id })
    say(`✓ ${clean(q)} adicionado`)
    setQ(''); setPicked(null); setCat(''); setQty('1'); setUnit('un'); setPrice('')
  }
  return <Sheet title="Adicionar item" onClose={onClose}>
    <input className="search" style={{ margin: 0, width: '100%' }} autoFocus placeholder="Digite para buscar ou cadastrar" value={q} onChange={e => { setQ(e.target.value); setPicked(null); setCat('') }} />
    {!showForm && q && <div className="sug">
      {sugg.map(p => <button key={p.id} onClick={() => choose(p)}>{displayName(p)}<small>{p.category}</small></button>)}
      {!exact && <button style={{ color: 'var(--g)', fontWeight: 700 }} onClick={() => choose(null, clean(q))}>+ Cadastrar "{clean(q)}" como novo</button>}
    </div>}
    {showForm && <>
      <label className="lbl">Categoria {picked ? '(sugerida)' : ''}</label>
      <select className="field" value={cat} onChange={e => setCat(e.target.value)}>{cats.map(c => <option key={c.id}>{c.name}</option>)}</select>
      <div className="row">
        <div><label className="lbl">Quantidade</label><div className="stepper"><button onClick={() => setQty(String(Math.max(1, (num(qty) ?? 1) - 1)))}>−</button><input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /><button onClick={() => setQty(String((num(qty) ?? 0) + 1))}>+</button></div></div>
        <div><label className="lbl">Unidade</label><select className="field" style={{ height: 50 }} value={unit} onChange={e => setUnit(e.target.value)}>{UNITS.map(u => <option key={u}>{u}</option>)}</select></div>
      </div>
      <label className="lbl">Preço unitário estimado (opcional)</label>
      <input className="field" inputMode="decimal" placeholder="0,00" value={price} onChange={e => setPrice(e.target.value)} />
      <button className="btn" onClick={add}>Adicionar à lista</button>
    </>}
    <Toast msg={toast} />
  </Sheet>
}

function ItemSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const it = useApp().tables.list_items[id] as ListItem | undefined
  const [qty, setQty] = useState(it ? String(it.qty).replace('.', ',') : '1')
  const [unit, setUnit] = useState(it?.unit ?? 'un')
  const [est, setEst] = useState(toMask(it?.est_price))
  const [paid, setPaidS] = useState(toMask(it?.paid_price))
  if (!it) return null
  const off = officialOf(it.product_id)
  const save = () => {
    // Estimativa e preço pago valem só para este item. O preço oficial não é alterado aqui.
    upsert('list_items', { ...it, qty: num(qty) ?? it.qty, unit, est_price: num(est), paid_price: num(paid) })
    onClose()
  }
  return <Sheet title={it.name} onClose={onClose}>
    <div className="row">
      <div><label className="lbl">Quantidade</label><div className="stepper"><button onClick={() => setQty(String(Math.max(1, (num(qty) ?? 1) - 1)))}>−</button><input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /><button onClick={() => setQty(String((num(qty) ?? 0) + 1))}>+</button></div></div>
      <div><label className="lbl">Unidade</label><select className="field" style={{ height: 50 }} value={unit} onChange={e => setUnit(e.target.value)}>{UNITS.map(u => <option key={u}>{u}</option>)}</select></div>
    </div>
    <div className="row">
      <div><label className="lbl">Preço estimado (un.)</label><input className="field" inputMode="numeric" placeholder="0,00" value={est} data-testid="est-field" onChange={e => setEst(maskMoney(e.target.value))} /></div>
      <div><label className="lbl">Preço pago (un.)</label><input className="field" inputMode="numeric" placeholder="0,00" value={paid} data-testid="paid-field" onChange={e => setPaidS(maskMoney(e.target.value))} /></div>
    </div>
    <div className="meta" data-testid="official-ref">{off != null ? `Último preço oficial: ${brl(off)}` : 'Sem preço oficial ainda. O preço estimado serve de referência para as cores.'}</div>
    <button className="btn" onClick={save}>Salvar</button>
    <button className="btn danger" onClick={() => { if (confirm(`Remover "${it.name}" da lista? O produto continua na base.`)) { softDelete('list_items', it.id); onClose() } }}>Remover da lista</button>
  </Sheet>
}

// ---------------- PRODUTOS ----------------
function ProductsScreen() {
  useApp()
  const [q, setQ] = useState(''); const [edit, setEdit] = useState<string | 'new' | null>(null)
  const cats = categoriesSorted()
  const prods = live('products').filter(p => !q || norm(displayName(p)).includes(norm(q)))
  const byCat = cats.map(c => ({ c, its: prods.filter(p => p.category === c.name).sort((a, b) => displayName(a).localeCompare(displayName(b))) }))
  const orphan = prods.filter(p => !cats.some(c => c.name === p.category))
  if (orphan.length) byCat.push({ c: { id: 'o', name: 'Sem categoria', color: '#ccc' } as any, its: orphan })
  return <>
    <div className="top"><h1><span>Produtos</span><button className="iconbtn" onClick={() => setEdit('new')} aria-label="Novo produto">+</button></h1><div className="sub">{live('products').length} produtos cadastrados</div></div>
    <div className="scroll">
      <input className="search" placeholder="Buscar produto" value={q} onChange={e => setQ(e.target.value)} />
      {byCat.filter(g => g.its.length).map(({ c, its }) => <div key={c.id}>
        <div className="cat"><span>{c.name}</span><span>{its.length}</span></div>
        {its.map(p => <div key={p.id} className="it" style={{ ['--c' as any]: c.color }} onClick={() => setEdit(p.id)} data-testid="prod">
          <div className="mid"><div className="nm">{displayName(p)}</div></div><div className="val">{p.price != null ? brl(p.price) : ''}</div></div>)}
      </div>)}
    </div>
    {edit && <ProductSheet key={edit} id={edit} onClose={() => setEdit(null)} onVariant={pid => setEdit('var:' + pid)} />}
  </>
}

function ProductSheet({ id, onClose, onVariant }: { id: string | 'new'; onClose: () => void; onVariant?: (id: string) => void }) {
  const s = useApp()
  const isVar = id.startsWith('var:')
  const src = isVar ? s.tables.products[id.slice(4)] : undefined   // "nova apresentação": parte de um produto existente
  const p = id === 'new' || isVar ? undefined : s.tables.products[id]
  const base = p ?? src
  const cats = categoriesSorted()
  const [name, setName] = useState(base?.name ?? ''); const [cat, setCat] = useState(base?.category ?? 'Outros')
  const [unit, setUnit] = useState(base?.unit ?? 'un')
  const [brand, setBrand] = useState(base?.brand ?? ''); const [pres, setPres] = useState(p?.presentation ?? '')
  const full = displayName({ name: clean(name), brand, presentation: pres })
  const found = full ? findProduct(full) : undefined
  const dup = !!found && found.id !== p?.id
  const hist = p ? live('price_history').filter(h => h.product_id === p.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8) : []
  const offAt = p ? lastOfficialAt(p.id) : null
  // Só grava marca/apresentação quando há valor (ou para limpar um valor antigo), para não mexer em produtos que não usam isso.
  const opt = (v: string, old?: string | null) => clean(v) || (old ? '' : undefined)
  const save = () => {
    const nm = clean(name); if (!nm || dup) return
    if (p) {
      upsert('products', { ...p, name: nm, category: cat, unit, brand: opt(brand, p.brand), presentation: opt(pres, p.presentation) }) // o preço oficial não muda por aqui
      // mantém os itens da lista atual coerentes com a categoria/nome
      const al = activeList(); if (al) itemsOf(al.id).filter(i => i.product_id === p.id).forEach(i => upsert('list_items', { ...i, name: full, category: cat }))
    } else upsert('products', { id: uid(), name: nm, category: cat, unit, price: null, brand: opt(brand), presentation: opt(pres) })
    onClose()
  }
  return <Sheet title={p ? 'Editar produto' : isVar ? 'Nova apresentação' : 'Novo produto'} onClose={onClose}>
    {isVar && <div className="meta" style={{ marginBottom: 6 }}>Mesmo produto em outra embalagem. Cada apresentação tem o seu próprio preço oficial e não é comparada com as outras.</div>}
    <label className="lbl">Nome</label><input className="field" value={name} onChange={e => setName(e.target.value)} autoFocus={!p && !isVar} />
    <div className="row"><div><label className="lbl">Marca (opcional)</label><input className="field" value={brand} onChange={e => setBrand(e.target.value)} data-testid="brand" /></div>
      <div><label className="lbl">Apresentação</label><input className="field" placeholder="ex.: 5 kg" value={pres} onChange={e => setPres(e.target.value)} data-testid="pres" autoFocus={isVar} /></div></div>
    {dup && <div className="err">Já existe esse produto com a mesma marca e apresentação.</div>}
    <label className="lbl">Categoria</label><select className="field" value={cat} onChange={e => setCat(e.target.value)}>{cats.map(c => <option key={c.id}>{c.name}</option>)}</select>
    <div className="row"><div><label className="lbl">Unidade padrão</label><select className="field" value={unit} onChange={e => setUnit(e.target.value)}>{UNITS.map(u => <option key={u}>{u}</option>)}</select></div>
      <div><label className="lbl">Preço oficial{offAt ? ` (${new Date(offAt).toLocaleDateString('pt-BR')})` : ''}</label><input className="field" value={p?.price != null ? p.price.toFixed(2).replace('.', ',') : ''} placeholder="sem preço" readOnly data-testid="official-field" /></div></div>
    <button className="btn" disabled={!clean(name) || dup} onClick={save}>Salvar</button>
    {p && <button className="btn sec" onClick={() => { addItem({ name: p.name, category: p.category, qty: 1, unit: p.unit, price: p.price, productId: p.id }); onClose() }}>Adicionar à lista atual</button>}
    {p && onVariant && <button className="btn sec" data-testid="new-pres" onClick={() => onVariant(p.id)}>Nova apresentação deste produto</button>}
    {p && <button className="btn danger" onClick={() => { if (confirm(`Excluir "${displayName(p)}" da base de produtos?`)) { softDelete('products', p.id); onClose() } }}>Excluir produto</button>}
    {hist.length > 0 && <><label className="lbl" style={{ marginTop: 18 }}>Histórico de preços</label>
      {hist.map(h => <div key={h.id} className="line"><span>{new Date(h.at).toLocaleDateString('pt-BR')} <span className="pill">{h.kind}</span></span><b>{brl(h.price)}</b></div>)}</>}
  </Sheet>
}

// ---------------- HISTÓRICO ----------------
function HistoryScreen() {
  useApp()
  const [open, setOpen] = useState<string | null>(null)
  const lists = live('lists').filter(l => l.status === 'archived').sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? ''))
  return <>
    <div className="top"><h1>Listas anteriores</h1><div className="sub">{lists.length} compra{lists.length === 1 ? '' : 's'} guardada{lists.length === 1 ? '' : 's'}</div></div>
    <div className="scroll">
      {lists.length === 0 && <div className="empty">Quando você iniciar uma nova lista, a atual fica guardada aqui.</div>}
      {lists.map((l, k) => {
        const t = totals(itemsOf(l.id)); const prev = lists[k + 1]; const pt = prev ? totals(itemsOf(prev.id)) : null
        const diff = pt && pt.spent > 0 ? t.spent - pt.spent : null
        return <div key={l.id} className="card" onClick={() => setOpen(l.id)} style={{ cursor: 'pointer' }} data-testid="hist">
          <h3>{new Date(l.archived_at ?? l.created_at).toLocaleDateString('pt-BR')}</h3>
          <div className="big" style={{ fontSize: 20 }}>{l.name}</div>
          <div className="meta">{t.done}/{t.total} comprados · gasto {brl(t.spent)} · estimado {brl(t.est)}{diff != null ? ` · ${diff >= 0 ? '+' : '−'}${brl(Math.abs(diff))} vs. anterior` : ''}</div>
        </div>
      })}
    </div>
    {open && <HistoryDetail id={open} onClose={() => setOpen(null)} />}
  </>
}
function HistoryDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const l = useApp().tables.lists[id]; if (!l) return null
  const items = itemsOf(id).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  const t = totals(items)
  return <Sheet title={l.name} onClose={onClose}>
    <div className="meta" style={{ marginBottom: 8 }}>{t.done}/{t.total} comprados · gasto {brl(t.spent)} · estimado {brl(t.est)}</div>
    {items.map(i => <div className="line" key={i.id}><span style={{ textDecoration: i.checked ? 'none' : 'line-through', opacity: i.checked ? 1 : .6 }}>{i.name} <span className="pill">{fmtQty(i.qty)} {i.unit}</span></span><b>{brl((i.paid_price ?? i.est_price ?? 0) * i.qty)}</b></div>)}
    <button className="btn" onClick={() => { if (confirm('Arquivar a lista atual e criar uma nova com os itens desta compra?')) { newList({ copyFrom: id }); onClose() } }}>Usar como base de uma nova lista</button>
  </Sheet>
}

// ---------------- RESUMO ----------------
function SummaryScreen({ openSettings }: { openSettings: () => void }) {
  useApp()
  const [nl, setNl] = useState(false)
  const list = activeList(); const items = list ? itemsOf(list.id) : []; const t = totals(items)
  const cats = categoriesSorted()
  const rows = cats.map(c => { const its = items.filter(i => i.category === c.name); return { c, est: its.reduce((s, i) => s + lineEst(i), 0), spent: totals(its).spent } }).filter(r => r.est || r.spent)
  const max = Math.max(1, ...rows.map(r => Math.max(r.est, r.spent)))
  const diff = t.spent - items.filter(i => i.checked).reduce((s, i) => s + lineEst(i), 0)
  const pct = t.total ? Math.round((t.done / t.total) * 100) : 0
  return <>
    <div className="top"><h1><span>Resumo</span><button className="iconbtn" onClick={openSettings} aria-label="Ajustes">⚙</button></h1><div className="sub">{list?.name ?? 'Sem lista'}</div></div>
    <div className="scroll">
      <div className="card"><h3>No carrinho</h3><div className="big">{brl(t.spent)}</div>
        <div className="rowbar"><div className="t"><i style={{ width: (t.forecast ? Math.min(100, (t.spent / t.forecast) * 100) : 0) + '%', background: 'var(--g)' }} /></div><span>{t.forecast ? Math.round((t.spent / t.forecast) * 100) : 0}% da previsão</span></div>
        <BudgetAlerts spent={t.spent} forecast={t.forecast} /></div>
      <div className="row" style={{ margin: '0 14px' }}>
        <div className="card" style={{ margin: '12px 0' }}><h3>Previsão final</h3><div className="big" style={{ fontSize: 20 }}>{brl(t.forecast)}{t.noPrice ? '*' : ''}</div></div>
        <div className="card" style={{ margin: '12px 0' }}><h3>Real − estimado</h3><div className="big" style={{ fontSize: 20, color: diff > 0 ? 'var(--warn)' : 'var(--g)' }}>{diff >= 0 ? '+' : '−'}{brl(Math.abs(diff))}</div></div>
      </div>
      <div className="card"><h3>Andamento</h3><div className="big">{pct}%</div><div className="meta">{t.done} comprados · {t.total - t.done} pendentes</div></div>
      <div className="card"><h3>Por categoria (estimado / gasto)</h3>
        {rows.length === 0 && <div className="meta">Sem dados ainda.</div>}
        {rows.map(r => <div key={r.c.id} className="rowbar"><span className="n">{r.c.name}</span>
          <div className="t"><i style={{ width: (r.est / max) * 100 + '%', background: r.c.color, opacity: .45 }} /><i style={{ width: (r.spent / max) * 100 + '%', background: r.c.color, height: '55%', top: '22%' }} /></div><span className="v">{brl(r.spent)}</span></div>)}
        {t.noPrice > 0 && <div className="meta" style={{ marginTop: 10 }}>* {t.noPrice} item(ns) sem preço de referência não entram no estimado.</div>}
      </div>
      <div style={{ padding: '0 14px' }}><button className="btn sec" onClick={() => setNl(true)}>Nova lista (mantém os produtos)</button></div>
    </div>
    {nl && <Sheet title="Nova lista" onClose={() => setNl(false)}>
      <p className="meta" style={{ marginBottom: 6 }}>A lista atual será arquivada no histórico. Nada é apagado e a base de produtos continua igual.</p>
      <button className="btn" onClick={() => { newList({}); setNl(false) }}>Começar vazia</button>
      <button className="btn sec" onClick={() => { newList({ copyFrom: 'current', onlyPending: true }); setNl(false) }}>Levar só o que faltou comprar</button>
      <button className="btn sec" onClick={() => { newList({ copyFrom: 'current' }); setNl(false) }}>Copiar todos os itens da atual</button>
    </Sheet>}
  </>
}

// ---------------- AJUSTES ----------------
function SettingsSheet({ onClose }: { onClose: () => void }) {
  const s = useApp(); const cats = categoriesSorted()
  const [msg, setMsg] = useState(''); const [newCat, setNewCat] = useState('')
  useEffect(() => { void syncNow() }, [])
  const [imp, setImp] = useState<ImportLine[] | null>(null)
  const onFile = async (f?: File | null) => {
    if (!f) return
    try {
      const lines = planImport(await readWorkbook(f))
      if (!lines.length) setMsg('Não encontrei produtos nesse arquivo.'); else { setMsg(''); setImp(lines) }
    } catch (e: any) { setMsg('Não consegui ler o arquivo: ' + e.message) }
  }
  const done = (r: ImportResult) => {
    setImp(null)
    setMsg(`Importação concluída: ${r.lidos} linhas lidas, ${r.ignorados} desmarcadas, ${r.novos} produtos novos, ${r.oficiais} preços oficiais atualizados${r.soHistorico ? `, ${r.soHistorico} só no histórico (mais antigos que o oficial atual)` : ''}${r.jaRegistrados ? `, ${r.jaRegistrados} já registrados` : ''}, ${r.estimativas} estimativas alteradas, ${r.naLista} itens novos na lista.`)
  }
  const [cupom, setCupom] = useState(false)
  if (cupom) return <Suspense fallback={<div className="empty">Carregando…</div>}><CupomFlow onClose={() => setCupom(false)} onDone={m => { setCupom(false); setMsg(m) }} /></Suspense>
  if (imp) return <ImportSheet lines={imp} onCancel={() => setImp(null)} onDone={done} />
  return <Sheet title="Ajustes" onClose={onClose}>
    <div className="line"><span>Conta</span><b>{s.session?.email}</b></div>
    <div className="line"><span>Sincronização</span><span><SyncChip /></span></div>
    {s.error && <div className="err">{s.error}</div>}
    <label className="lbl" style={{ marginTop: 14 }}>Código para sua esposa entrar na mesma lista</label>
    <div className="code" data-testid="invite">{s.household?.invite_code}</div>
    <label className="lbl" style={{ marginTop: 18 }}>Ordem das categorias (ordem do mercado)</label>
    {cats.map((c, i) => <div className="line" key={c.id}><span><span className="pill" style={{ background: c.color, borderColor: c.color }}>&nbsp;</span> {c.name}</span>
      <span><button className="x" disabled={i === 0} onClick={() => moveCategory(c.id, -1)} aria-label="Subir">↑</button><button className="x" disabled={i === cats.length - 1} onClick={() => moveCategory(c.id, 1)} aria-label="Descer">↓</button></span></div>)}
    <div className="row" style={{ marginTop: 8 }}><input className="field" placeholder="Nova categoria" value={newCat} onChange={e => setNewCat(e.target.value)} />
      <button className="btn sec" style={{ margin: 0, flex: '0 0 90px' }} disabled={!clean(newCat)} onClick={() => { upsert('categories', { id: uid(), name: clean(newCat), color: '#CFD8DC', sort: cats.length }); setNewCat('') }}>Criar</button></div>
    <label className="lbl" style={{ marginTop: 18 }}>Planilha</label>
    <label className="btn sec" style={{ cursor: 'pointer' }}>Importar planilha (.xlsx)<input type="file" accept=".xlsx,.xls" hidden onChange={e => { void onFile(e.target.files?.[0]); e.target.value = '' }} /></label>
    <button className="btn sec" onClick={() => void exportWorkbook()}>Exportar tudo para Excel</button>
    <label className="lbl" style={{ marginTop: 18 }}>Cupom fiscal</label>
    <button className="btn sec" data-testid="open-cupom" onClick={() => setCupom(true)}>Atualizar preços por cupom (vídeo ou fotos)</button>
    {msg && <div className="meta" style={{ marginTop: 10 }} data-testid="importmsg">{msg}</div>}
    <button className="btn danger" onClick={async () => { if (Object.keys(s.dirty).length && !confirm('Há alterações ainda não sincronizadas neste aparelho. Sair mesmo assim?')) return; await signOut() }}>Sair da conta</button>
  </Sheet>
}

// ---------------- IMPORTAR EXCEL (conferência) ----------------
function ImportSheet({ lines, onCancel, onDone }: { lines: ImportLine[]; onCancel: () => void; onDone: (r: ImportResult) => void }) {
  useApp()
  const [mode, setMode] = useState<'estimate' | 'official'>('estimate')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const info = (l: ImportLine) => {
    const off = l.product?.price ?? null; const pr = l.row.price
    if (!l.product) return { t: pr != null ? `novo · ${brl(pr)}` : 'novo · sem preço', go: true }
    if (pr == null) return { t: 'sem preço na planilha', go: false }
    if (off != null && Math.abs(off - pr) < 0.005) return { t: `${brl(pr)} · igual ao oficial`, go: false }
    return { t: off != null ? `${brl(off)} → ${brl(pr)}` : `sem oficial → ${brl(pr)}`, go: true }
  }
  const [off, setOff] = useState<Set<number>>(new Set())  // linhas desmarcadas manualmente
  const [on, setOn] = useState<Set<number>>(new Set())    // linhas marcadas manualmente
  const keepOf = (l: ImportLine) => on.has(l.key) || (!off.has(l.key) && (mode === 'official' ? info(l).go : l.row.price != null || !!l.row.qty || !l.product))
  const flip = (l: ImportLine) => {
    const k = keepOf(l); const a = new Set(on), b = new Set(off)
    if (k) { a.delete(l.key); b.add(l.key) } else { b.delete(l.key); a.add(l.key) }
    setOn(a); setOff(b)
  }
  const keep = new Set(lines.filter(keepOf).map(l => l.key))
  const rows = [...lines].sort((a, b) => Number(info(b).go) - Number(info(a).go) || a.row.name.localeCompare(b.row.name, 'pt-BR', { sensitivity: 'base' }))
  return <Sheet title="Conferir importação" onClose={onCancel}>
    <div className="chips" style={{ padding: 0 }}>
      <button className={'chip' + (mode === 'estimate' ? ' on' : '')} onClick={() => setMode('estimate')} data-testid="mode-est">Preços como estimativa</button>
      <button className={'chip' + (mode === 'official' ? ' on' : '')} onClick={() => setMode('official')} data-testid="mode-off">Atualizar preços oficiais</button>
    </div>
    {mode === 'official'
      ? <><div className="meta" style={{ margin: '8px 0' }}>Os preços marcados abaixo passam a ser o preço oficial e entram no histórico. Confira antes de confirmar.</div>
        <label className="lbl">Data dos preços</label><input className="field" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} /></>
      : <div className="meta" style={{ margin: '8px 0' }}>Os preços valem só como estimativa dos itens da lista. O preço oficial não muda.</div>}
    <div className="meta" style={{ margin: '8px 0' }}>{keep.size} de {lines.length} linhas serão aplicadas. Toque para marcar ou desmarcar.</div>
    {rows.map(l => <div key={l.key} className="line" onClick={() => flip(l)} style={{ cursor: 'pointer', opacity: keepOf(l) ? 1 : .5 }} data-testid="imp-line">
      <span><input type="checkbox" readOnly checked={keepOf(l)} style={{ marginRight: 8 }} />{l.row.name}{l.row.qty ? <span className="pill">{fmtQty(l.row.qty)}</span> : null}{l.catFallback ? <span className="pill">categoria: {l.category}</span> : null}</span>
      <b style={{ fontSize: 13 }}>{info(l).t}</b></div>)}
    <button className="btn" data-testid="imp-confirm" disabled={!keep.size || (mode === 'official' && !date)} onClick={() => onDone(applyImport(lines, { mode, date, keep }))}>{mode === 'official' ? 'Confirmar e atualizar preços oficiais' : 'Confirmar importação'}</button>
    <button className="btn sec" data-testid="imp-cancel" onClick={onCancel}>Cancelar (nada é gravado)</button>
  </Sheet>
}
