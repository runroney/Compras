// De/para do cupom: abreviações, criar produto na conferência (nome, marca, apresentação) e memória do apelido.
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
  const novoProd = async (nome, marca, pres) => {
    await tab('Produtos'); await p.getByRole('button', { name: 'Novo produto' }).click()
    await p.locator('.sheet input.field').first().fill(nome); if (marca) await p.getByTestId('brand').fill(marca); if (pres) await p.getByTestId('pres').fill(pres)
    await p.getByRole('button', { name: 'Salvar' }).click()
  }
  await novoProd('Leite condensado', 'Moça', '395 g'); await novoProd('Coisa de limpar', '', '')
  await tab('Lista')
  const abrir = async () => { await p.getByRole('button', { name: 'Ajustes' }).click(); await p.getByTestId('open-cupom').click(); await p.getByTestId('pick-photos').waitFor(); await p.getByTestId('file-photos').setInputFiles('/tmp/foto_unica.jpg'); await p.getByTestId('review').waitFor({ timeout: 240000 }) }
  const rowsOf = async () => { const r = await p.getByTestId('cupom-row').all(); const d = await Promise.all(r.map(x => x.locator('label').first().innerText())); return { r, d, of: re => r[d.findIndex(x => re.test(x))] } }
  const sel = async row => await row.locator('select').first().evaluate(s => s.options[s.selectedIndex].text)
  const marcar = async (row, unit) => { await row.getByTestId('cupom-unit').fill(unit); const cb = row.locator('input[type=checkbox]'); if (!(await cb.isChecked())) await cb.check() }

  // 1ª vez
  await abrir(); let R = await rowsOf()
  ok(await sel(R.of(/LEITE COND/)) === 'Leite condensado Moça 395 g', 'LEITE COND MOCA 395G associado sozinho ao cadastro por extenso: ' + await sel(R.of(/LEITE COND/)))
  // criar produto novo pelo cupom
  const pt = R.of(/PAPEL TOALHA/)
  await pt.getByTestId('cupom-prod').selectOption('__novo')
  ok(await pt.getByTestId('novo-name').inputValue() === 'Papel toalha' && await pt.getByTestId('novo-brand').inputValue() === 'Scott' && await pt.getByTestId('novo-pres').inputValue() === '2 un', 'formulário já vem com Papel toalha / Scott / 2 un')
  await p.screenshot({ path: 'test/shot-novo-produto.png' })
  await marcar(pt, '9,90')
  // de/para manual para um nome que o app não adivinharia
  const dt = R.of(/DETERG/); await dt.getByTestId('cupom-prod').selectOption({ label: 'Coisa de limpar' }); await marcar(dt, '3,29')
  await p.getByTestId('cupom-confirm').click()
  await p.getByRole('button', { name: 'Fechar' }).click().catch(() => {})
  await tab('Produtos')
  ok(await p.locator('[data-testid=prod]', { hasText: 'Papel toalha Scott 2 un' }).count() === 1, 'produto novo criado só ao confirmar: "Papel toalha Scott 2 un"')
  await p.locator('[data-testid=prod]', { hasText: 'Papel toalha Scott 2 un' }).click()
  ok(await p.getByTestId('official-field').inputValue() === '9,90', 'preço oficial do produto novo = 9,90')
  await p.getByRole('button', { name: 'Fechar' }).click(); await tab('Lista')

  await tab('Produtos'); const nAntes = parseInt(await p.locator('.top .sub').innerText()); await tab('Lista')
  // 2ª vez: os apelidos foram lembrados
  await abrir(); R = await rowsOf()
  ok(await sel(R.of(/PAPEL TOALHA/)) === 'Papel toalha Scott 2 un', 'segundo cupom: PAPEL TOALHA já vem associado (de/para lembrado)')
  ok(await sel(R.of(/DETERG/)) === 'Coisa de limpar', 'segundo cupom: DETERGENTE YPE NEUTRO já vem em "Coisa de limpar" (de/para manual lembrado)')
  // criar duplicado é bloqueado
  const arroz = R.of(/ARROZ/); await arroz.getByTestId('cupom-prod').selectOption('__novo')
  await arroz.getByTestId('novo-name').fill('Leite condensado'); await arroz.getByTestId('novo-brand').fill('Moça'); await arroz.getByTestId('novo-pres').fill('395 g')
  ok(await arroz.getByText('Já existe esse produto').count() === 1, 'produto igual a um existente é avisado (não duplica)')
  await p.getByTestId('cupom-cancel').click(); await p.getByRole('button', { name: 'Fechar' }).click().catch(() => {})
  await tab('Produtos')
  ok(parseInt(await p.locator('.top .sub').innerText()) === nAntes, 'cancelar não criou nenhum produto')
} catch (e) { fail++; console.log('ERRO', e.message.split('\n')[0]) } finally { await browser.close(); procs.forEach(x => x.kill()); console.log(`\n${pass} ok, ${fail} falhas`); process.exit(fail ? 1 : 0) }
