// Ajuste: cupom por arquivo (vídeo da galeria, foto única, várias fotos) e cor com preço de referência.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
const { chromium } = createRequire(import.meta.url)('playwright')
const URL = 'http://localhost:4173/'
const procs = [spawn('node', ['test/fake-server.mjs'], { stdio: 'ignore' }), spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })]
await new Promise(r => setTimeout(r, 3500))
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m) }
const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } })
  const p = await ctx.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => console.log('PAGEERR', e.message)); await p.goto(URL)
  const tab = n => p.locator('nav button', { hasText: n }).click()
  await p.locator('input[type=email]').fill('eu@teste.com'); await p.locator('input[type=password]').fill('senha123')
  await p.getByRole('button', { name: 'Ainda não tenho conta' }).click(); await p.getByRole('button', { name: 'Criar conta' }).click()
  await p.getByRole('button', { name: 'Criar a lista da casa' }).click(); await p.waitForSelector('[data-testid=item]')

  // ---- cor com preço de referência (produto novo, sem oficial) ----
  await p.getByRole('button', { name: 'Adicionar produto' }).click()
  await p.getByPlaceholder('Digite para buscar ou cadastrar').fill('Produto Ref')
  await p.getByRole('button', { name: /Cadastrar "Produto Ref"/ }).click()
  await p.getByPlaceholder('0,00').fill('7,00')
  await p.getByRole('button', { name: 'Adicionar à lista' }).click(); await p.getByRole('button', { name: 'Fechar' }).click()
  const it = p.locator('[data-testid=item]', { hasText: 'Produto Ref' })
  const cls = async () => (await it.getByTestId('lineval').getAttribute('class'))
  ok(!/up|down/.test(await cls()), 'só com referência, sem preço pago: sem cor')
  const setPaid = async v => { await it.locator('.mid').click(); const fs = p.locator('.sheet input.field'); await fs.nth(0).fill('7,00'); await fs.nth(1).fill(v); await p.getByRole('button', { name: 'Salvar' }).click() }
  await setPaid('6,50'); ok(/down/.test(await cls()), 'pago 6,50 < referência 7,00: verde')
  await setPaid('7,50'); ok(/up/.test(await cls()), 'pago 7,50 > referência 7,00: laranja')
  await setPaid('7,00'); ok(!/up|down/.test(await cls()), 'pago igual à referência: neutro')
  await p.screenshot({ path: 'test/shot-referencia.png' })

  // ---- cupom por arquivo ----
  const abrir = async () => { await p.getByRole('button', { name: 'Ajustes' }).click(); await p.getByTestId('open-cupom').click(); await p.getByTestId('pick-video').waitFor() }
  const itens = async () => { await p.getByTestId('review').waitFor({ timeout: 240000 }); const r = await p.getByTestId('cupom-row').all(); return Promise.all(r.map(x => x.locator('label').first().innerText())) }
  await abrir()
  ok(await p.getByTestId('pick-photos').count() === 1, 'tela do cupom mostra vídeo da galeria e fotos')
  await p.getByTestId('file-video').setInputFiles('/tmp/cupom.webm')
  const dv = await itens(); console.log('VIDEO:', dv.join(' | '))
  ok(dv.length >= 7 && dv.some(d => /ARROZ/i.test(d)) && dv.some(d => /DETERG/i.test(d)), `vídeo de arquivo lido (${dv.length} itens)`)
  await p.getByTestId('cupom-cancel').click(); await p.getByRole('button', { name: 'Fechar' }).click().catch(() => {})
  await abrir()
  await p.getByTestId('file-photos').setInputFiles('/tmp/foto_unica.jpg')
  const d1 = await itens(); console.log('FOTO:', d1.join(' | '))
  ok(d1.length >= 7 && d1.some(d => /ARROZ/i.test(d)), `foto única lida (${d1.length} itens)`)
  await p.getByTestId('cupom-cancel').click(); await p.getByRole('button', { name: 'Fechar' }).click().catch(() => {})
  await abrir()
  await p.getByTestId('file-photos').setInputFiles(['/tmp/foto1.jpg', '/tmp/foto2.jpg', '/tmp/foto3.jpg'])
  const d3 = await itens(); console.log('FOTOS:', d3.join(' | '))
  ok(d3.length >= 7 && d3.length <= 10 && new Set(d3.map(x => x.toLowerCase())).size === d3.length, `3 fotos sobrepostas juntadas sem duplicar (${d3.length} itens)`)
  await p.screenshot({ path: 'test/shot-cupom-fotos.png' })
  await p.getByTestId('cupom-cancel').click(); await p.getByRole('button', { name: 'Fechar' }).click().catch(() => {})
  // arquivo inválido: mensagem clara e volta
  await abrir()
  await p.getByTestId('file-photos').setInputFiles({ name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('nao e imagem') })
  await p.getByTestId('cam-note').waitFor({ timeout: 20000 })
  ok(/fotos/.test(await p.getByTestId('cam-note').innerText()), 'arquivo inválido mostra aviso e volta à tela')
} catch (e) { fail++; console.log('ERRO', e.message.split('\n')[0]) } finally { await browser.close(); procs.forEach(x => x.kill()); console.log(`\n${pass} ok, ${fail} falhas`); process.exit(fail ? 1 : 0) }
