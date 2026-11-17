import { createClient } from '@supabase/supabase-js'
import type { AnyRow, Household, Remote, Session, Table } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const fakeUrl = import.meta.env.VITE_FAKE_URL as string | undefined

export const configured = Boolean(fakeUrl || (url && key))

function supabaseRemote(): Remote {
  const sb = createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true } })
  const toSession = (u: { id: string; email?: string | null } | null | undefined): Session | null =>
    u ? { userId: u.id, email: u.email ?? '' } : null
  const hh = (r: any): Household => ({ id: r.id, name: r.name, invite_code: r.invite_code })
  return {
    async getSession() { const { data } = await sb.auth.getSession(); return toSession(data.session?.user) },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
      return toSession(data.user)!
    },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password })
      if (error) throw new Error(error.message)
      return toSession(data.session?.user)
    },
    async signOut() { await sb.auth.signOut() },
    async myHousehold() {
      const { data, error } = await sb.rpc('my_household')
      if (error) throw new Error(error.message)
      return data && data.id ? hh(data) : null
    },
    async createHousehold(name) {
      const { data, error } = await sb.rpc('create_household', { p_name: name })
      if (error) throw new Error(error.message)
      return hh(data)
    },
    async joinHousehold(code) {
      const { data, error } = await sb.rpc('join_household', { p_code: code })
      if (error) throw new Error(error.message)
      return hh(data)
    },
    async pull(table, household, since) {
      const out: AnyRow[] = []
      let from = 0
      for (;;) {
        let q = sb.from(table).select('*').eq('household_id', household).order('synced_at', { ascending: true }).order('id').range(from, from + 999)
        if (since) q = q.gt('synced_at', since)
        const { data, error } = await q
        if (error) throw new Error(error.message)
        out.push(...(data as AnyRow[]))
        if (!data || data.length < 1000) break
        from += 1000
      }
      return out
    },
    async push(table, rows) {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200).map(({ synced_at, ...r }: any) => {
          // marca/apresentação só viajam quando existem (assim o app segue sincronizando antes do SQL novo ser rodado)
          if (r.brand == null) delete r.brand
          if (r.presentation == null) delete r.presentation
          return r
        })
        const { error } = await sb.from(table).upsert(chunk, { onConflict: 'id' })
        if (error) throw new Error(error.message)
      }
    },
    subscribe(household, onChange) {
      const ch = sb.channel('hh-' + household)
      ;(['categories', 'products', 'lists', 'list_items', 'price_history'] as Table[]).forEach(t =>
        ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `household_id=eq.${household}` }, onChange))
      ch.subscribe()
      return () => { sb.removeChannel(ch) }
    },
  }
}

// Backend falso (só para testes locais, veja test/fake-server.mjs)
function fakeRemote(): Remote {
  const base = fakeUrl!
  const tokenKey = 'fake_token'
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', authorization: localStorage.getItem(tokenKey) || '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error || 'erro')
    return j
  }
  return {
    async getSession() { try { return (await call('/me')).session } catch { return null } },
    async signIn(e, p) { const j = await call('/signin', { email: e, password: p }); localStorage.setItem(tokenKey, j.token); return j.session },
    async signUp(e, p) { const j = await call('/signup', { email: e, password: p }); localStorage.setItem(tokenKey, j.token); return j.session },
    async signOut() { localStorage.removeItem(tokenKey) },
    async myHousehold() { return (await call('/household')).household },
    async createHousehold(n) { return (await call('/household/create', { name: n })).household },
    async joinHousehold(c) { return (await call('/household/join', { code: c })).household },
    async pull(t, h, s) { return (await call(`/pull?table=${t}&household=${h}&since=${encodeURIComponent(s || '')}`)).rows },
    async push(t, rows) { await call('/push', { table: t, rows }) },
    subscribe(_h, cb) { const id = setInterval(cb, 1500); return () => clearInterval(id) },
  }
}

export const remote: Remote | null = fakeUrl ? fakeRemote() : url && key ? supabaseRemote() : null
