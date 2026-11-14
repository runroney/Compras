import { activeList, itemsOf, live, importRows, type ImportReport, type ImportRow } from './store'
import { clean, norm } from './util'

export async function importWorkbook(file: File): Promise<ImportReport> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const rows: ImportRow[] = []
  let withQty = false
  for (const name of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: null })
    if (!data.length) continue
    const head = (data[0] as any[]).map(h => norm(String(h ?? '')))
    const col = (...keys: string[]) => head.findIndex(h => keys.some(k => h.startsWith(k)))
    const cItem = col('item', 'produto'), cCat = col('tipo', 'categoria'), cQty = col('qtd', 'quantidade'), cPrice = col('p. unit', 'preco', 'preço')
    if (cItem < 0) continue
    for (const r of data.slice(1)) {
      const nm = r[cItem]; if (nm == null || clean(String(nm)) === '') continue
      const q = cQty >= 0 ? Number(r[cQty]) : NaN
      const pr = cPrice >= 0 ? Number(r[cPrice]) : NaN
      if (cQty >= 0) withQty = true
      rows.push({ category: cCat >= 0 && r[cCat] ? String(r[cCat]) : 'Outros', name: String(nm), price: Number.isFinite(pr) && r[cPrice] !== null && r[cPrice] !== '' ? pr : null, qty: Number.isFinite(q) && q > 0 ? q : null })
    }
  }
  return importRows(rows, { addToList: withQty })
}

export async function exportWorkbook() {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const prods = live('products').sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prods.map(p => ({ Categoria: p.category, Produto: p.name, Unidade: p.unit, 'Preço': p.price }))), 'Base de Produtos')
  const al = activeList()
  const cur = al ? itemsOf(al.id) : []
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cur.map(i => ({ Tipo: i.category, ITEM: i.name, QTD: i.qty, Un: i.unit, OK: i.checked, 'P. UNIT. estimado': i.est_price, 'P. UNIT. pago': i.paid_price }))), 'Lista atual')
  const hist: any[] = []
  for (const l of live('lists').filter(l => l.status === 'archived').sort((a, b) => b.created_at.localeCompare(a.created_at)))
    for (const i of itemsOf(l.id)) hist.push({ Lista: l.name, Arquivada: l.archived_at, Tipo: i.category, ITEM: i.name, QTD: i.qty, Un: i.unit, OK: i.checked, 'P. UNIT. estimado': i.est_price, 'P. UNIT. pago': i.paid_price })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hist), 'Listas anteriores')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(live('price_history').sort((a, b) => b.at.localeCompare(a.at)).map(h => ({ Produto: h.product_name, 'Preço': h.price, Tipo: h.kind, Data: h.at }))), 'Histórico de preços')
  XLSX.writeFile(wb, `compras-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
