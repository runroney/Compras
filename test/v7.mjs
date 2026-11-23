// Máscara de preço na tela do item + garantia de que o cupom continua gravando o oficial certo.
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
  await p.getByRole('button', { name: 'Adicionar produto' }).click()
  await p.getByPlaceholder('Digite para buscar ou cadastrar').fill('Arroz Camil 5 kg')
  await p.getByRole('button', { name: /Cadastrar "Arroz Camil 5 kg"/ }).click(); await p.getByRole('button', { name: 'Adicionar à lista' }).click(); await p.getByRole('button', { name: 'Fechar' }).click()
  const it = p.locator('[data-testid=item]', { hasText: 'Arroz Camil 5 kg' })
  await it.locator('.mid').click()
  const paid = p.getByTestId('paid-field'), est = p.getByTestId('est-field')
  const digitar = async (f, t) => { await f.fill(''); await f.pressSequentially(t) }
  await digitar(paid, '5'); ok(await paid.inputValue() === '0,05', 'digitar 5 vira 0,05')
  await digitar(paid, '650'); ok(await paid.inputValue() === '6,50', 'digitar 650 vira 6,50')
  await digitar(paid, '1290'); ok(await paid.inputValue() === '12,90', 'digitar 1290 vira 12,90')
  await digitar(est, '2890'); ok(await est.inputValue() === '28,90', 'estimado: 2890 vira 28,90')
  await paid.fill(''); ok(await paid.inputValue() === '', 'apagar tudo deixa o campo vazio')
  await digitar(paid, '2750'); await p.getByRole('button', { name: 'Salvar' }).click()
  ok(/27,50/.test(await it.innerText()) && /28,90/.test(await it.innerText()), 'item salvo com pago 27,50 e estimado 28,90')
  await it.locator('.mid').click()
  ok(await p.getByTestId('paid-field').inputValue() === '27,50' && await p.getByTestId('est-field').inputValue() === '28,90', 'ao reabrir os valores voltam certos com vírgula')
  await p.screenshot({ path: 'test/shot-mascara.png' }); await p.getByRole('button', { name: 'Fechar' }).click()
  await tab('Produtos'); await p.locator('[data-testid=prod]', { hasText: 'Arroz Camil 5 kg' }).click()
  ok(await p.getByTestId('official-field').inputValue() === '', 'preço oficial continua intocado (vazio) depois de usar a máscara')
  await p.getByRole('button', { name: 'Fechar' }).click(); await tab('Lista')
  // cupom: confirma um preço e confere o oficial gravado
  await p.getByRole('button', { name: 'Ajustes' }).click(); await p.getByTestId('open-cupom').click(); await p.getByTestId('pick-photos').waitFor()
  await p.getByTestId('file-photos').setInputFiles('/tmp/foto_unica.jpg')
  await p.getByTestId('review').waitFor({ timeout: 240000 })
  const rows = await p.getByTestId('cupom-row').all(); const ds = await Promise.all(rows.map(r => r.locator('label').first().innerText()))
  const row = rows[ds.findIndex(d => /ARROZ/.test(d))]
  await row.locator('select').selectOption({ label: 'Arroz Camil 5 kg' })
  await row.getByTestId('cupom-unit').fill('28,90')
  await row.locator('input[type=checkbox]').check()
  await p.getByTestId('cupom-confirm').click()
  await p.getByRole('button', { name: 'Fechar' }).click().catch(() => {})
  await tab('Produtos'); await p.locator('[data-testid=prod]', { hasText: 'Arroz Camil 5 kg' }).click()
  ok(await p.getByTestId('official-field').inputValue() === '28,90', 'cupom gravou o oficial 28,90 certinho: ' + await p.getByTestId('official-field').inputValue())
  ok(await p.locator('.sheet .line', { hasText: 'oficial' }).count() === 1, 'histórico com 1 linha oficial')
  await p.getByRole('button', { name: 'Fechar' }).click(); await tab('Lista')
  const lv = await it.getByTestId('lineval').getAttribute('class')
  ok(/down/.test(lv), 'pago 27,50 abaixo do oficial 28,90: verde')
} catch (e) { fail++; console.log('ERRO', e.message.split('\n')[0]) } finally { await browser.close(); procs.forEach(x => x.kill()); console.log(`\n${pass} ok, ${fail} falhas`); process.exit(fail ? 1 : 0) }
