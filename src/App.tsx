import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { configured } from './remote'
import {
  activeList, addItem, categoriesSorted, createHousehold, findProduct, itemsOf, joinHousehold, lineEst, live, moveCategory,
  newList, reorderItems, setPaid, signIn, signOut, signUp, softDelete, syncNow, toggleItem, totals, upsert, uid, useApp,
} from './store'
import { exportWorkbook, importWorkbook } from './io'
import seed from './seed.json'
import { importRows } from './store'
import type { ListItem, Product } from './types'
import { UNITS, brl, clean, fmtQty, norm, num } from './util'

type Tab = 'lista' | 'produtos' | 'historico' | 'resumo'

export default function App() {
  const s = useApp()
  if (!configured) return <Setup />
  if (!s.ready) return <div className="empty">Carregando…</div>
  if (!s.session) return <Auth />
  if (!s.household) return <HouseholdSetup />
  return <Shell />
}

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
  // Arrastar para reordenar: as linhas NÃO mudam de lugar no DOM durante o gesto (só se deslocam com transform);
  // a ordem nova é gravada uma vez, ao soltar. Assim o navegador não perde o controle do dedo.
  const [drag, setDrag] = useState<{ cat: string; id: string; ids: string[]; from: number; to: number; dy: number; pitch: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startScroll: number; centers: number[]; lastY: number } | null>(null)
  const canDrag = !q && filter !== 'ok'
  const dragId = drag?.id
  const update = useCallback(() => {
    const m = dragRef.current, sc = scrollRef.current
    if (!m || !sc) return
    setDrag(d => {
      if (!d) return d
      const dy = m.lastY - m.startY + (sc.scrollTop - m.startScroll)
      const center = m.centers[d.from] + dy
      let to = 0
      m.centers.forEach((c, j) => { if (j !== d.from && c < center) to++ })
      return dy === d.dy && to === d.to ? d : { ...d, dy, to }
    })
  }, [])
  const finish = useCallback((commit: boolean) => {
    dragRef.current = null
    setDrag(d => {
      if (d && commit && d.to !== d.from) {
        const ids = d.ids.filter(x => x !== d.id); ids.splice(d.to, 0, d.id)
        reorderItems(d.cat, ids)
      }
      return null
    })
  }, [])
  useEffect(() => {
    if (!dragId) return
    const mv = (e: PointerEvent) => { if (dragRef.current) { dragRef.current.lastY = e.clientY; update() } }
    const up = () => finish(true), cancel = () => finish(false)
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel)
    let raf = 0 // rolagem automática perto das bordas
    const tick = () => {
      const sc = scrollRef.current, m = dragRef.current
      if (sc && m) {
        const r = sc.getBoundingClientRect()
        if (m.lastY < r.top + 70) sc.scrollTop -= 12; else if (m.lastY > r.bottom - 70) sc.scrollTop += 12
        update()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); cancelAnimationFrame(raf) }
  }, [dragId, update, finish])
  const startDrag = (e: React.PointerEvent, cat: string, id: string, ids: string[]) => {
    e.preventDefault()
    const sc = scrollRef.current; if (!sc) return
    const rows = ids.map(x => document.querySelector<HTMLElement>(`[data-itemid="${CSS.escape(x)}"]`))
    if (rows.some(r => !r)) return
    const rects = rows.map(r => r!.getBoundingClientRect())
    const from = ids.indexOf(id)
    dragRef.current = { startY: e.clientY, startScroll: sc.scrollTop, lastY: e.clientY, centers: rects.map(r => r.top + r.height / 2) }
    setDrag({ cat, id, ids, from, to: from, dy: 0, pitch: rects[from].height + 10 })
  }
  const shiftOf = (catName: string, k: number) => {
    if (!drag || drag.cat !== catName) return undefined
    if (k === drag.from) return `translateY(${drag.dy}px)`
    if (drag.from < drag.to && k > drag.from && k <= drag.to) return `translateY(${-drag.pitch}px)`
    if (drag.from > drag.to && k >= drag.to && k < drag.from) return `translateY(${drag.pitch}px)`
    return undefined
  }
  const list = activeList()
  const items = list ? itemsOf(list.id) : []
  const t = totals(items)
  const cats = categoriesSorted()
  const shown = items.filter(i => (filter === 'todos' || (filter === 'ok') === i.checked) && (!q || norm(i.name).includes(norm(q))))
  const groups = cats.map(c => ({ c, its: shown.filter(i => i.category === c.name).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)) }))
  const known = new Set(cats.map(c => c.name))
  const orphans = shown.filter(i => !known.has(i.category))
  if (orphans.length) groups.push({ c: { id: 'x', name: 'Outros', color: '#CFD8DC' } as any, its: orphans })
  const pct = t.total ? Math.round((t.done / t.total) * 100) : 0
  return <>
    <div className="top">
      <h1><span>Compras do mês</span><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><SyncChip /><button className="iconbtn" onClick={openSettings} aria-label="Ajustes">⚙</button></span></h1>
      <div className="sub">{t.done} de {t.total} comprados · {pct}%</div>
      <div className="bar"><i style={{ width: pct + '%' }} /></div>
      <div className="tot"><span>Estimado {brl(t.est)}{t.noPrice ? '*' : ''}</span><span>Gasto {brl(t.spent)}</span></div>
    </div>
    <div className="scroll" ref={scrollRef}>
      <div className="chips">
        {([['falta', `Faltam ${t.total - t.done}`], ['ok', `Comprados ${t.done}`], ['todos', 'Todos']] as const).map(([k, l]) => <button key={k} className={'chip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      <input className="search" placeholder="Buscar na lista" value={q} onChange={e => setQ(e.target.value)} />
      {items.length === 0 && <div className="empty">Lista vazia. Toque no + para adicionar o primeiro produto.</div>}
      {items.length > 0 && shown.length === 0 && <div className="empty">{filter === 'falta' ? 'Nada faltando. Compras concluídas! 🎉' : 'Nenhum item aqui.'}</div>}
      {groups.filter(g => g.its.length).map(({ c, its }) => <div key={c.id} data-grp={c.name}>
        <div className="cat"><span>{c.name}</span><span>{its.filter(i => i.checked).length}/{its.length}</span></div>
        {its.map((i, k) => <div key={i.id} data-itemid={i.id} className={'it' + (i.checked ? ' done' : '') + (drag?.id === i.id ? ' dragging' : '')}
          style={{ ['--c' as any]: c.color, transform: shiftOf(c.name, k), transition: drag && drag.id !== i.id ? 'transform .15s' : undefined }} data-testid="item">
          <button className="cb" onClick={() => toggleItem(i.id)} aria-label={i.checked ? 'Desmarcar' : 'Marcar como comprado'}>{i.checked ? '✓' : ''}</button>
          <div className="mid" onClick={() => setEdit(i.id)}>
            <div className="nm">{i.name}</div>
            <div className="meta">{fmtQty(i.qty)} {i.unit}{i.est_price != null ? ` × ${brl(i.est_price)}` : ' · sem preço'}{i.paid_price != null ? ` · pago ${brl(i.paid_price)}` : ''}</div>
          </div>
          <div className="val">{i.est_price != null ? brl(lineEst(i)) : ''}</div>
          {canDrag && <div className="grip" role="button" aria-label={`Arrastar ${i.name}`} data-testid="grip" onPointerDown={e => startDrag(e, c.name, i.id, its.map(x => x.id))}>⠿</div>}
        </div>)}
      </div>)}
    </div>
    <button className="fab" onClick={() => setAdding(true)} aria-label="Adicionar produto">+</button>
    {adding && <AddSheet onClose={() => setAdding(false)} />}
    {edit && <ItemSheet id={edit} onClose={() => setEdit(null)} />}
  </>
}

function AddSheet({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Product | null>(null)
  const [cat, setCat] = useState(''); const [qty, setQty] = useState('1'); const [unit, setUnit] = useState('un'); const [price, setPrice] = useState('')
  const [toast, say] = useToast()
  const cats = categoriesSorted()
  const sugg = useMemo(() => {
    const n = norm(q); if (!n) return []
    const all = live('products').filter(p => norm(p.name).includes(n))
    return all.sort((a, b) => (norm(a.name).startsWith(n) ? 0 : 1) - (norm(b.name).startsWith(n) ? 0 : 1) || a.name.localeCompare(b.name)).slice(0, 8)
  }, [q])
  const exact = q ? findProduct(q) : undefined
  const choose = (p: Product | null, name?: string) => {
    setPicked(p); if (p) { setQ(p.name); setCat(p.category); setUnit(p.unit); setPrice(p.price != null ? String(p.price).replace('.', ',') : '') }
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
      {sugg.map(p => <button key={p.id} onClick={() => choose(p)}>{p.name}<small>{p.category}</small></button>)}
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
  const [est, setEst] = useState(it?.est_price != null ? String(it.est_price).replace('.', ',') : '')
  const [paid, setPaidS] = useState(it?.paid_price != null ? String(it.paid_price).replace('.', ',') : '')
  if (!it) return null
  const save = () => {
    upsert('list_items', { ...it, qty: num(qty) ?? it.qty, unit, est_price: num(est) })
    const p = num(paid)
    if (p !== it.paid_price) setPaid(it.id, p)
    onClose()
  }
  return <Sheet title={it.name} onClose={onClose}>
    <div className="row">
      <div><label className="lbl">Quantidade</label><div className="stepper"><button onClick={() => setQty(String(Math.max(1, (num(qty) ?? 1) - 1)))}>−</button><input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /><button onClick={() => setQty(String((num(qty) ?? 0) + 1))}>+</button></div></div>
      <div><label className="lbl">Unidade</label><select className="field" style={{ height: 50 }} value={unit} onChange={e => setUnit(e.target.value)}>{UNITS.map(u => <option key={u}>{u}</option>)}</select></div>
    </div>
    <div className="row">
      <div><label className="lbl">Preço estimado (un.)</label><input className="field" inputMode="decimal" value={est} onChange={e => setEst(e.target.value)} /></div>
      <div><label className="lbl">Preço pago (un.)</label><input className="field" inputMode="decimal" placeholder="0,00" value={paid} onChange={e => setPaidS(e.target.value)} /></div>
    </div>
    <button className="btn" onClick={save}>Salvar</button>
    <button className="btn danger" onClick={() => { if (confirm(`Remover "${it.name}" da lista? O produto continua na base.`)) { softDelete('list_items', it.id); onClose() } }}>Remover da lista</button>
  </Sheet>
}

// ---------------- PRODUTOS ----------------
function ProductsScreen() {
  useApp()
  const [q, setQ] = useState(''); const [edit, setEdit] = useState<string | 'new' | null>(null)
  const cats = categoriesSorted()
  const prods = live('products').filter(p => !q || norm(p.name).includes(norm(q)))
  const byCat = cats.map(c => ({ c, its: prods.filter(p => p.category === c.name).sort((a, b) => a.name.localeCompare(b.name)) }))
  const orphan = prods.filter(p => !cats.some(c => c.name === p.category))
  if (orphan.length) byCat.push({ c: { id: 'o', name: 'Sem categoria', color: '#ccc' } as any, its: orphan })
  return <>
    <div className="top"><h1><span>Produtos</span><button className="iconbtn" onClick={() => setEdit('new')} aria-label="Novo produto">+</button></h1><div className="sub">{live('products').length} produtos cadastrados</div></div>
    <div className="scroll">
      <input className="search" placeholder="Buscar produto" value={q} onChange={e => setQ(e.target.value)} />
      {byCat.filter(g => g.its.length).map(({ c, its }) => <div key={c.id}>
        <div className="cat"><span>{c.name}</span><span>{its.length}</span></div>
        {its.map(p => <div key={p.id} className="it" style={{ ['--c' as any]: c.color }} onClick={() => setEdit(p.id)} data-testid="prod">
          <div className="mid"><div className="nm">{p.name}</div></div><div className="val">{p.price != null ? brl(p.price) : ''}</div></div>)}
      </div>)}
    </div>
    {edit && <ProductSheet id={edit} onClose={() => setEdit(null)} />}
  </>
}

function ProductSheet({ id, onClose }: { id: string | 'new'; onClose: () => void }) {
  const s = useApp()
  const p = id === 'new' ? undefined : s.tables.products[id]
  const cats = categoriesSorted()
  const [name, setName] = useState(p?.name ?? ''); const [cat, setCat] = useState(p?.category ?? 'Outros')
  const [unit, setUnit] = useState(p?.unit ?? 'un'); const [price, setPrice] = useState(p?.price != null ? String(p.price).replace('.', ',') : '')
  const dup = name && findProduct(name) && findProduct(name)!.id !== p?.id
  const hist = p ? live('price_history').filter(h => h.product_id === p.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8) : []
  const save = () => {
    const nm = clean(name); if (!nm || dup) return
    const np = num(price)
    if (p) {
      if (np != null && np !== p.price) upsert('price_history', { id: uid(), product_id: p.id, product_name: nm, price: np, kind: 'estimado', at: new Date().toISOString() })
      upsert('products', { ...p, name: nm, category: cat, unit, price: np })
      // mantém os itens da lista atual coerentes com a categoria/nome
      const al = activeList(); if (al) itemsOf(al.id).filter(i => i.product_id === p.id).forEach(i => upsert('list_items', { ...i, name: nm, category: cat }))
    } else upsert('products', { id: uid(), name: nm, category: cat, unit, price: np })
    onClose()
  }
  return <Sheet title={p ? 'Editar produto' : 'Novo produto'} onClose={onClose}>
    <label className="lbl">Nome</label><input className="field" value={name} onChange={e => setName(e.target.value)} autoFocus={!p} />
    {dup && <div className="err">Já existe um produto com esse nome.</div>}
    <label className="lbl">Categoria</label><select className="field" value={cat} onChange={e => setCat(e.target.value)}>{cats.map(c => <option key={c.id}>{c.name}</option>)}</select>
    <div className="row"><div><label className="lbl">Unidade padrão</label><select className="field" value={unit} onChange={e => setUnit(e.target.value)}>{UNITS.map(u => <option key={u}>{u}</option>)}</select></div>
      <div><label className="lbl">Preço atual</label><input className="field" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></div></div>
    <button className="btn" disabled={!clean(name) || !!dup} onClick={save}>Salvar</button>
    {p && <button className="btn sec" onClick={() => { addItem({ name: p.name, category: p.category, qty: 1, unit: p.unit, price: p.price, productId: p.id }); onClose() }}>Adicionar à lista atual</button>}
    {p && <button className="btn danger" onClick={() => { if (confirm(`Excluir "${p.name}" da base de produtos?`)) { softDelete('products', p.id); onClose() } }}>Excluir produto</button>}
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
      <div className="card"><h3>Gasto até agora</h3><div className="big">{brl(t.spent)}</div>
        <div className="rowbar"><div className="t"><i style={{ width: (t.est ? Math.min(100, (t.spent / t.est) * 100) : 0) + '%', background: 'var(--g)' }} /></div><span>{t.est ? Math.round((t.spent / t.est) * 100) : 0}% do estimado</span></div></div>
      <div className="row" style={{ margin: '0 14px' }}>
        <div className="card" style={{ margin: '12px 0' }}><h3>Estimado</h3><div className="big" style={{ fontSize: 20 }}>{brl(t.est)}{t.noPrice ? '*' : ''}</div></div>
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
  const onFile = async (f?: File | null) => {
    if (!f) return
    try { const r = await importWorkbook(f); setMsg(`Importação: ${r.lidos} linhas lidas, ${r.novos} produtos novos, ${r.existentes} já existiam (sem duplicar), ${r.precosAtualizados} preços atualizados, ${r.naLista} itens na lista.`) }
    catch (e: any) { setMsg('Não consegui ler o arquivo: ' + e.message) }
  }
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
    {msg && <div className="meta" style={{ marginTop: 10 }} data-testid="importmsg">{msg}</div>}
    <button className="btn danger" onClick={async () => { if (Object.keys(s.dirty).length && !confirm('Há alterações ainda não sincronizadas neste aparelho. Sair mesmo assim?')) return; await signOut() }}>Sair da conta</button>
  </Sheet>
}
