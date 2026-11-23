// Atualizar preços oficiais por cupom em vídeo: gravar, ler, conferir e só então confirmar.
// As imagens ficam apenas na memória durante o processamento e são descartadas (nada é guardado).
import { useEffect, useMemo, useRef, useState } from 'react'
import { categoriesSorted, confirmCupom, displayName, findProduct, live, useApp } from './store'
import { mergeFrames, parseDesc, parseFrame, sizesOf, suggest, type CupomFrame } from './cupom'
import { readFrame, stopWorker } from './ocr'
import { brl, clean, fmtQty, num } from './util'

const MAX_FRAMES = 24
const MAX_PHOTOS = 30

type Grab = { blob: Blob; sharp: number }
type Novo = { name: string; brand: string; presentation: string; category: string }
const NOVO = '__novo'
type Row = { novo: Novo | null; key: number; include: boolean; desc: string; productId: string; qty: string; unit: string; lido: number | null; hint: string[] }

/** Nitidez: variância do laplaciano (quanto maior, mais nítido o texto). */
function sharpness(g: Uint8ClampedArray, w: number, h: number) {
  let s = 0, s2 = 0, n = 0
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]
    s += v; s2 += v * v; n++
  }
  return n ? s2 / n - (s / n) ** 2 : 0
}

export default function CupomFlow({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [phase, setPhase] = useState<'cam' | 'proc' | 'review'>('cam')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('') // aviso de leitura (não é erro de câmera)
  const [rec, setRec] = useState(false)
  const [count, setCount] = useState(0)
  const [hint, setHint] = useState('')
  const [prog, setProg] = useState({ i: 0, n: 0 })
  const [result, setResult] = useState<{ rows: Row[]; total: number | null; date: string | null } | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const frames = useRef<Grab[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelled = useRef(false)
  const lastThumb = useRef<Uint8ClampedArray | null>(null)
  const maxSharp = useRef(0)
  const busy = useRef(false)
  const vidIn = useRef<HTMLInputElement>(null)
  const phoIn = useRef<HTMLInputElement>(null)

  const stopCam = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null }
  const startCam = async () => {
    setErr('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não permite usar a câmera aqui.')
      const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
      stream.current = s
      const t = s.getVideoTracks()[0]
      try { await t.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }) } catch { /* nem todo aparelho aceita */ }
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}) }
    } catch (e: any) {
      setErr(e?.name === 'NotAllowedError' ? 'A câmera foi bloqueada. Permita o acesso à câmera para este app nas configurações do navegador e tente de novo.' : 'Não consegui abrir a câmera: ' + (e?.message ?? e))
    }
  }
  useEffect(() => { if (phase === 'cam' && !stream.current) void startCam() }, [phase]) // abre a câmera ao entrar (e ao "gravar de novo")
  useEffect(() => {
    return () => { cancelled.current = true; if (timer.current) clearInterval(timer.current); stopCam(); frames.current = []; void stopWorker() }
  }, [])

  const grab = async (src?: HTMLVideoElement) => {
    const v = src ?? video.current
    if (!v || !v.videoWidth || busy.current) return
    busy.current = true
    try {
      const tw = 320, th = Math.max(1, Math.round(v.videoHeight * tw / v.videoWidth))
      const tc = document.createElement('canvas'); tc.width = tw; tc.height = th
      const tg = tc.getContext('2d', { willReadFrequently: true })!
      tg.drawImage(v, 0, 0, tw, th)
      const px = tg.getImageData(0, 0, tw, th).data
      const gray = new Uint8ClampedArray(tw * th)
      for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000
      const sharp = sharpness(gray, tw, th)
      maxSharp.current = Math.max(maxSharp.current, sharp)
      setHint(maxSharp.current > 0 && sharp < maxSharp.current * 0.4 ? 'Imagem borrada. Vá mais devagar ou afaste um pouco.' : '')
      const last = lastThumb.current
      if (last && last.length === gray.length) {
        let d = 0; for (let i = 0; i < gray.length; i++) d += Math.abs(gray[i] - last[i])
        if (d / gray.length < 2.5) return // quase igual ao quadro anterior: não adianta ler de novo
      }
      lastThumb.current = gray
      const cw = Math.min(v.videoWidth, 1600), ch = Math.round(v.videoHeight * cw / v.videoWidth)
      const c = document.createElement('canvas'); c.width = cw; c.height = ch
      c.getContext('2d')!.drawImage(v, 0, 0, cw, ch)
      const blob: Blob | null = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92))
      c.width = c.height = 0
      if (!blob) return
      frames.current.push({ blob, sharp })
      if (frames.current.length > 60) { const k = frames.current.reduce((m, f, i, a) => (f.sharp < a[m].sharp ? i : m), 0); frames.current.splice(k, 1) }
      setCount(frames.current.length)
    } finally { busy.current = false }
  }
  const startRec = () => { frames.current = []; lastThumb.current = null; maxSharp.current = 0; setCount(0); setRec(true); void grab(); timer.current = setInterval(() => void grab(), 600) }
  const stopRec = async () => {
    if (timer.current) clearInterval(timer.current); timer.current = null; setRec(false); setHint('')
    stopCam()
    // fica com os quadros mais nítidos (até o limite), na ordem em que foram gravados
    const all = frames.current; frames.current = []
    const top = all.map((f, i) => ({ ...f, i })).filter(f => f.sharp >= maxSharp.current * 0.3).sort((a, b) => b.sharp - a.sharp).slice(0, MAX_FRAMES).sort((a, b) => a.i - b.i)
    await readAll(top)
  }
  /** Lê os quadros (da câmera, de um vídeo ou de fotos), junta tudo e abre a conferência. */
  const readAll = async (top: Grab[]) => {
    setPhase('proc'); setProg({ i: 0, n: top.length })
    const parsed: CupomFrame[] = []
    try {
      for (let k = 0; k < top.length; k++) {
        if (cancelled.current) return
        setProg({ i: k + 1, n: top.length })
        parsed.push(parseFrame(await readFrame(top[k].blob)))
      }
    } catch (e: any) { if (!cancelled.current) { setNote('Não consegui ler o cupom: ' + (e?.message ?? e)); setPhase('cam') } return }
    finally { top.length = 0 }
    if (cancelled.current) return
    const m = mergeFrames(parsed)
    const cat = live('products').map(p => ({ id: p.id, name: p.name, brand: p.brand, presentation: p.presentation, aliases: p.aliases }))
    const rows: Row[] = m.items.map((it, key) => {
      const s = suggest(it.desc, cat)
      return { novo: null, key, include: s.auto && it.ok && (it.unit ?? 0) > 0, desc: it.desc, productId: s.auto ? s.list[0].id : '', qty: fmtQty(it.qty), unit: it.unit != null ? it.unit.toFixed(2).replace('.', ',') : '', lido: it.total, hint: s.list.length && !s.auto ? ['sugestão não é segura, confira'] : [] }
    })
    setResult({ rows, total: m.total, date: m.date })
    await stopWorker()
    setPhase('review')
  }
  const reset = () => { frames.current = []; lastThumb.current = null; maxSharp.current = 0; setCount(0); setHint('') }
  /** Vídeo que já existe no aparelho: percorre o arquivo em intervalos e usa os quadros mais nítidos. O arquivo não é guardado. */
  const pickVideo = async (file: File) => {
    stopCam(); reset(); setNote(''); setPhase('proc'); setProg({ i: 0, n: 0 })
    const url = URL.createObjectURL(file)
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url
    try {
      await new Promise<void>((ok, bad) => { v.onloadeddata = () => ok(); v.onerror = () => bad(new Error('Não consegui abrir esse vídeo.')); setTimeout(() => bad(new Error('Não consegui abrir esse vídeo.')), 20000) })
      const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 0
      const n = dur ? Math.min(60, Math.max(1, Math.floor(dur / 0.6))) : 1
      for (let k = 0; k < n; k++) {
        if (cancelled.current) return
        if (dur) {
          const t = Math.min(dur - 0.05, (k + 0.5) * (dur / n))
          await new Promise<void>(ok => { v.onseeked = () => ok(); v.currentTime = Math.max(0, t); setTimeout(ok, 4000) })
        }
        setProg({ i: k + 1, n })
        busy.current = false
        await grab(v)
      }
    } catch (e: any) { setNote(e?.message ?? 'Não consegui abrir esse vídeo.'); setPhase('cam'); return }
    finally { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load() }
    if (!frames.current.length) { setNote('Não consegui tirar imagens desse vídeo.'); setPhase('cam'); return }
    const all = frames.current; frames.current = []
    const top = all.map((f, i) => ({ ...f, i })).filter(f => f.sharp >= maxSharp.current * 0.3).sort((a, b) => b.sharp - a.sharp).slice(0, MAX_FRAMES).sort((a, b) => a.i - b.i)
    await readAll(top)
  }
  /** Fotos escolhidas (uma ou várias): todas são lidas, na ordem escolhida. Nada é guardado. */
  const pickPhotos = async (files: File[]) => {
    stopCam(); reset(); setNote(''); setPhase('proc')
    const list = files.slice(0, MAX_PHOTOS)
    const out: Grab[] = []
    try {
      for (let k = 0; k < list.length; k++) {
        setProg({ i: k + 1, n: list.length })
        const bmp = await createImageBitmap(list[k]).catch(() => null)
        if (!bmp) continue
        const w = Math.min(bmp.width, 1600), h = Math.round(bmp.height * w / bmp.width)
        const c = document.createElement('canvas'); c.width = w; c.height = h
        c.getContext('2d')!.drawImage(bmp, 0, 0, w, h); bmp.close?.()
        const blob: Blob | null = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)); c.width = c.height = 0
        if (blob) out.push({ blob, sharp: 1 })
      }
    } catch (e: any) { setNote('Não consegui abrir as fotos: ' + (e?.message ?? e)); setPhase('cam'); return }
    if (!out.length) { setNote('Não consegui abrir essas fotos. Escolha imagens JPG ou PNG.'); setPhase('cam'); return }
    await readAll(out)
  }
  const again = () => { setResult(null); setErr(''); setNote(''); setPhase('cam') }

  return <div className="sheetbg" style={{ alignItems: phase === 'cam' ? 'stretch' : 'flex-end', zIndex: 60 }}>
    {phase === 'cam' && <div className="cam" data-testid="cam">
      <video ref={video} playsInline muted autoPlay />
      <input ref={vidIn} type="file" accept="video/*" hidden data-testid="file-video" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickVideo(f) }} />
      <input ref={phoIn} type="file" accept="image/*" multiple hidden data-testid="file-photos" onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) void pickPhotos(f) }} />
      <div className="cam-top">
        <b>Atualizar preços pelo cupom</b>
        <button className="x" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      <div className="cam-bar">
        {err ? <div className="err" style={{ color: '#fff' }}>{err}</div>
          : <div className="meta" style={{ color: '#fff' }}>{rec ? `Gravando... ${count} quadros úteis` : 'Aproxime do cupom, com boa luz e sem sombra. Ao gravar, passe devagar do começo ao fim.'}</div>}
        {note && <div className="err" data-testid="cam-note" style={{ color: '#fff' }}>{note}</div>}
        {hint && <div className="alert l900" data-testid="cam-hint">{hint}</div>}
        {err ? <button className="btn" onClick={startCam}>Tentar de novo</button>
          : !rec ? <button className="btn" data-testid="rec" onClick={startRec}>Gravar</button>
            : <button className="btn danger" data-testid="stop" onClick={() => void stopRec()}>Parar e ler o cupom</button>}
        {!rec && <>
          <button className="btn sec" data-testid="pick-video" onClick={() => vidIn.current?.click()}>Escolher vídeo da galeria</button>
          <button className="btn sec" data-testid="pick-photos" onClick={() => phoIn.current?.click()}>Escolher fotos (uma ou várias)</button>
        </>}
      </div>
    </div>}
    {phase === 'proc' && <div className="sheet">
      <h2>Lendo o cupom</h2>
      <div className="meta" data-testid="proc">{prog.n ? `Quadro ${prog.i} de ${prog.n}.` : 'Abrindo o arquivo.'} Isso pode levar um minuto. Mantenha o app aberto.</div>
      <div className="bar" style={{ background: 'var(--bd)', margin: '12px 0' }}><i style={{ width: (prog.n ? (prog.i / prog.n) * 100 : 0) + '%', background: 'var(--g)' }} /></div>
      <button className="btn sec" onClick={() => { cancelled.current = true; onClose() }}>Cancelar</button>
    </div>}
    {phase === 'review' && result && <Review init={result} onCancel={onClose} onAgain={again} onDone={onDone} />}
  </div>
}

function Review({ init, onCancel, onAgain, onDone }: { init: { rows: Row[]; total: number | null; date: string | null }; onCancel: () => void; onAgain: () => void; onDone: (m: string) => void }) {
  useApp()
  const [rows, setRows] = useState(init.rows)
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(init.date && init.date <= today ? init.date : today)
  const prods = useMemo(() => live('products').sort((a, b) => displayName(a).localeCompare(displayName(b), 'pt-BR', { sensitivity: 'base' })), [])
  const cat = useMemo(() => prods.map(p => ({ id: p.id, name: p.name, brand: p.brand, presentation: p.presentation, aliases: p.aliases })), [prods])
  const cats = categoriesSorted()
  const brands = useMemo(() => [...new Set(prods.map(p => clean(p.brand ?? '')).filter(Boolean))], [prods])
  const novoOk = (r: Row) => !!r.novo && !!clean(r.novo.name) && !findProduct(displayName(r.novo))
  const rowOk = (r: Row) => r.include && (num(r.unit) ?? 0) > 0 && (r.productId === NOVO ? novoOk(r) : !!r.productId)
  const byId = (id: string) => prods.find(p => p.id === id)
  const set = (k: number, p: Partial<Row>) => setRows(r => r.map(x => (x.key === k ? { ...x, ...p } : x)))
  const sum = rows.reduce((s, r) => s + (num(r.qty) ?? 0) * (num(r.unit) ?? 0), 0)
  const valid = rows.filter(rowOk)
  return <div className="sheet" style={{ maxHeight: '92vh' }} role="dialog" aria-label="Conferir cupom" data-testid="review">
    <h2>Conferir cupom<button className="x" onClick={onCancel} aria-label="Fechar">×</button></h2>
    <div className="meta" style={{ marginBottom: 8 }}>Nada é gravado até você confirmar. Corrija o que estiver errado e desmarque o que não quiser atualizar.</div>
    <div className="line"><span>Itens lidos</span><b>{rows.length}</b></div>
    <div className="line"><span>Soma dos itens</span><b>{brl(sum)}</b></div>
    {init.total != null && <div className="line"><span>Total lido no cupom</span><b>{brl(init.total)}</b></div>}
    {init.total != null && Math.abs(init.total - sum) > 0.05 && <div className="alert l900" style={{ margin: '6px 0' }} data-testid="sum-warn">A soma dos itens não bate com o total do cupom. Pode haver item não lido ou valor errado.</div>}
    <label className="lbl">Data do cupom</label><input className="field" type="date" value={date} max={today} onChange={e => setDate(e.target.value)} />
    {rows.length === 0 && <div className="empty" style={{ padding: '18px 0' }}>Não consegui ler nenhum item. Tente de novo mais perto, com boa luz e passando devagar.</div>}
    {rows.map(r => {
      const p = r.productId && r.productId !== NOVO ? byId(r.productId) : undefined
      const off = p?.price ?? null; const u = num(r.unit)
      const sg = suggest(r.desc, cat).list
      const csz = sizesOf(r.desc), psz = p ? sizesOf(displayName(p)) : []
      const sizeWarn = !!p && csz.length > 0 && psz.length > 0 && !csz.some(x => psz.includes(x))
      const calc = (num(r.qty) ?? 0) * (u ?? 0)
      const mathWarn = r.lido != null && Math.abs(calc - r.lido) > 0.03
      return <div key={r.key} data-testid="cupom-row" style={{ borderTop: '1px solid var(--bd)', padding: '10px 0', opacity: r.include ? 1 : .6 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 700 }}>
          <input type="checkbox" checked={r.include} onChange={e => set(r.key, { include: e.target.checked })} style={{ marginTop: 4 }} />{r.desc}</label>
        <select className="field" style={{ marginTop: 6 }} value={r.productId} data-testid="cupom-prod"
          onChange={e => { const v = e.target.value; set(r.key, v === NOVO ? { productId: v, include: (u ?? 0) > 0, novo: r.novo ?? { ...parseDesc(r.desc, brands), category: cats.find(c => c.name === 'Outros')?.name ?? cats[0]?.name ?? 'Outros' } } : { productId: v, include: !!v && (u ?? 0) > 0 }) }}>
          <option value="">Sem produto (não atualizar)</option>
          <option value={NOVO}>+ Criar produto novo com este item</option>
          {sg.length > 0 && <optgroup label="Sugestões">{sg.map(s => { const q = byId(s.id); return q ? <option key={'s' + s.id} value={s.id}>{displayName(q)}</option> : null })}</optgroup>}
          <optgroup label="Todos os produtos">{prods.map(q => <option key={q.id} value={q.id}>{displayName(q)}</option>)}</optgroup>
        </select>
        {r.productId === NOVO && r.novo && <div data-testid="novo-form" style={{ background: 'var(--bg2, rgba(127,127,127,.08))', borderRadius: 10, padding: 10, margin: '8px 0' }}>
          <div className="meta" style={{ marginBottom: 4 }}>Novo produto: confira o nome por extenso, a marca e a apresentação. Ele só é criado quando você confirmar o cupom.</div>
          <label className="lbl">Nome</label><input className="field" value={r.novo.name} data-testid="novo-name" onChange={e => set(r.key, { novo: { ...r.novo!, name: e.target.value } })} />
          <div className="row">
            <div><label className="lbl">Marca</label><input className="field" value={r.novo.brand} data-testid="novo-brand" onChange={e => set(r.key, { novo: { ...r.novo!, brand: e.target.value } })} /></div>
            <div><label className="lbl">Apresentação</label><input className="field" value={r.novo.presentation} data-testid="novo-pres" onChange={e => set(r.key, { novo: { ...r.novo!, presentation: e.target.value } })} /></div>
          </div>
          <label className="lbl">Categoria</label><select className="field" value={r.novo.category} onChange={e => set(r.key, { novo: { ...r.novo!, category: e.target.value } })}>{cats.map(c => <option key={c.id}>{c.name}</option>)}</select>
          {!!r.novo.name && !!findProduct(displayName(r.novo)) && <div className="err">Já existe esse produto no cadastro. Escolha ele na lista acima.</div>}
          <div className="meta">Vai aparecer na lista como: <b>{displayName(r.novo) || '...'}</b></div>
        </div>}
        <div className="row">
          <div><label className="lbl">Quantidade</label><input className="field" inputMode="decimal" value={r.qty} onChange={e => set(r.key, { qty: e.target.value })} /></div>
          <div><label className="lbl">Preço unitário</label><input className="field" inputMode="decimal" value={r.unit} data-testid="cupom-unit" onChange={e => set(r.key, { unit: e.target.value })} /></div>
        </div>
        {p && <div className="meta">{off != null ? `Oficial hoje ${brl(off)}${u != null ? ` → novo ${brl(u)}` : ''}` : 'Sem preço oficial ainda'}</div>}
        {sizeWarn && <div className="err" style={{ margin: '4px 0 0' }}>Apresentação diferente: o cupom indica {csz.join(', ')} e o produto é {psz.join(', ')}. Escolha a apresentação certa.</div>}
        {mathWarn && <div className="err" style={{ margin: '4px 0 0' }}>A conta não fecha com o valor lido no cupom ({brl(r.lido!)}). Confira quantidade e preço.</div>}
        {!p && r.hint.map(h => <div key={h} className="meta">{h}</div>)}
      </div>
    })}
    <button className="btn" data-testid="cupom-confirm" disabled={!valid.length || !date}
      onClick={() => { const rep = confirmCupom(valid.map(r => ({ productId: r.productId === NOVO ? '' : r.productId, novo: r.productId === NOVO ? r.novo : null, desc: r.desc, unit: num(r.unit)! })), date); onDone(`Cupom confirmado: ${rep.criados ? `${rep.criados} produto${rep.criados === 1 ? '' : 's'} novo${rep.criados === 1 ? '' : 's'} criado${rep.criados === 1 ? '' : 's'}, ` : ''}${rep.atualizados} preços oficiais atualizados${rep.soHistorico ? `, ${rep.soHistorico} só no histórico (cupom mais antigo que o oficial atual)` : ''}${rep.jaRegistrados ? `, ${rep.jaRegistrados} já registrados` : ''}. ${rows.length - valid.length} itens não foram usados.`) }}>
      Confirmar e atualizar {valid.length} preço{valid.length === 1 ? '' : 's'} oficial{valid.length === 1 ? '' : 'is'}</button>
    <button className="btn sec" onClick={onAgain}>Ler outro cupom</button>
    <button className="btn sec" data-testid="cupom-cancel" onClick={onCancel}>Cancelar (nada é gravado)</button>
  </div>
}
