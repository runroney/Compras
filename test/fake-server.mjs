// Backend de mentira (memória) que imita o contrato do Supabase, só para testar o motor de sincronização.
import http from 'node:http'
const users = {}, households = {}, memberOf = {}
const data = {}  // table -> id -> row
let clock = 0
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); res.end(JSON.stringify(obj)) }
const body = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b ? JSON.parse(b) : {})) })
const code = () => Math.random().toString(36).slice(2, 10)
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const u = new URL(req.url, 'http://x'); const p = u.pathname
  const tok = req.headers.authorization || ''
  const me = users[tok] ? tok : null
  try {
    if (p === '/signup') { const b = await body(req); users[b.email] = b.password; return send(res, 200, { token: b.email, session: { userId: b.email, email: b.email } }) }
    if (p === '/signin') { const b = await body(req); if (users[b.email] !== b.password) return send(res, 400, { error: 'Invalid login credentials' }); return send(res, 200, { token: b.email, session: { userId: b.email, email: b.email } }) }
    if (!me) return send(res, 401, { error: 'não autenticado' })
    if (p === '/me') return send(res, 200, { session: { userId: me, email: me } })
    if (p === '/household') return send(res, 200, { household: memberOf[me] ? households[memberOf[me]] : null })
    if (p === '/household/create') { const b = await body(req); const h = { id: 'hh-' + code(), name: b.name, invite_code: code() }; households[h.id] = h; memberOf[me] = h.id; return send(res, 200, { household: h }) }
    if (p === '/household/join') { const b = await body(req); const h = Object.values(households).find(h => h.invite_code === b.code); if (!h) return send(res, 400, { error: 'codigo invalido' }); memberOf[me] = h.id; return send(res, 200, { household: h }) }
    if (p === '/pull') {
      const t = u.searchParams.get('table'), h = u.searchParams.get('household'), since = u.searchParams.get('since')
      if (memberOf[me] !== h) return send(res, 403, { error: 'sem acesso' })
      const rows = Object.values(data[t] || {}).filter(r => r.household_id === h && (!since || r.synced_at > since)).sort((a, b) => a.synced_at.localeCompare(b.synced_at))
      return send(res, 200, { rows })
    }
    if (p === '/push') {
      const b = await body(req); const t = b.table; data[t] ||= {}
      for (const r of b.rows) {
        if (memberOf[me] !== r.household_id) return send(res, 403, { error: 'sem acesso' })
        const old = data[t][r.id]
        if (old && r.updated_at < old.updated_at) continue // last-write-wins, igual ao trigger do Postgres
        data[t][r.id] = { ...r, synced_at: new Date(Date.now() + (++clock) / 1000).toISOString() }
      }
      return send(res, 200, { ok: true })
    }
    if (p === '/__dump') return send(res, 200, data)
    send(res, 404, { error: 'rota' })
  } catch (e) { send(res, 500, { error: String(e) }) }
}).listen(8787, () => console.log('fake backend em :8787'))
