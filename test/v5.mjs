// Comparação de PREÇO UNITÁRIO (informado no mercado x último oficial), cor só no total do item. Gera capturas por cenário.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
const { chromium } = createRequire(import.meta.url)('playwright')
const procs = [spawn('node', ['test/fake-server.mjs'], { stdio: 'ignore' }), spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })]
await new Promise(r => setTimeout(r, 3500))
const C = v => { const [a, b = ''] = String(v).replace('.', ',').split(','); return a + b.padEnd(2, '0').slice(0, 2) } // máscara de preço: digita só os números
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m) }
const browser = await chromium.launch()
const RED = 'rgb(192, 57, 43)', GREEN = 'rgb(30, 127, 92)', NORMAL = 'rgb(27, 31, 29)'
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, colorScheme: 'light', deviceScaleFactor: 2 })
  const p = await ctx.newPage(); p.on('dialog', d => d.accept()); await p.goto('http://localhost:4173/')
  await p.locator('input[type=email]').fill('v5@t.com'); await p.locator('input[type=password]').fill('senha123')
  await p.getByRole('button', { name: 'Ainda não tenho conta' }).click(); await p.getByRole('button', { name: 'Criar conta' }).click()
  await p.getByRole('button', { name: 'Criar a lista da casa' }).click(); await p.waitForSelector('[data-testid=item]')
  await p.getByRole('button', { name: /Todos/ }).click()
  const LEITE = 'Leite litro cx c/12 zero lac.'
  const row = n => p.locator('[data-testid=item]', { hasText: n }).first()
  const val = n => row(n).locator('.val')
  const color = (n, sel) => row(n).locator(sel).evaluate(e => getComputedStyle(e).color)
  const headColor = () => p.locator('.top .tot').evaluate(e => getComputedStyle(e).color)
  const head0 = await headColor()
  const open = async n => { await row(n).locator('.mid').click(); await p.locator('.sheet').waitFor() }
  const fields = () => p.locator('.sheet input[inputmode=decimal], .sheet input[inputmode=numeric]')
  const nameColor0 = await color(LEITE, '.nm')
  // estado inicial: 2 un x R$ 6,80 = R$ 13,60, oficial R$ 6,80
  ok((await row(LEITE).locator('.meta').innerText()).startsWith('2 un × R$ 6,80'), 'ponto de partida: 2 un × R$ 6,80 (oficial R$ 6,80)')
  const shots = []
  const cenario = async (nome, n, qty, paid, esperado, cor, totalTxt) => {
    await open(n)
    if (qty != null) await p.locator('.sheet .stepper input').fill(String(qty))
    await fields().nth(2).fill(C(paid))   // Preço pago (un.) = o preço informado no mercado
    const off = await p.getByTestId('official-ref').innerText()
    await p.locator('.sheet').screenshot({ path: `/tmp/sheet-${nome}.png` })
    await p.getByRole('button', { name: 'Salvar' }).click()
    await row(n).scrollIntoViewIfNeeded()
    await row(n).screenshot({ path: `/tmp/row-${nome}.png` })
    const meta = (await row(n).locator('.meta').innerText()).replace(/\n/g, ' ')
    const v = await val(n).innerText(), c = await color(n, '.val')
    console.log(`[${nome}] ${off} | ${meta} | total ${v} | cor ${c}`)
    ok(v === totalTxt, `[${nome}] total do item = ${totalTxt}`)
    ok(c === cor, `[${nome}] cor do total: ${esperado}`)
    ok((await color(n, '.nm')) === nameColor0, `[${nome}] nome do produto sem cor`)
    ok((await headColor()) === head0, `[${nome}] total geral do cabeçalho sem mudança de cor`)
    shots.push(nome)
  }
  await cenario('1-aumento', LEITE, 2, '7,00', 'vermelho', RED, 'R$ 14,00')
  await cenario('2-reducao', LEITE, 2, '6,50', 'verde', GREEN, 'R$ 13,00')
  await cenario('3-igual', LEITE, 2, '6,80', 'normal', NORMAL, 'R$ 13,60')
  // quantidade não interfere: mesma alta unitária com 5 un e baixa com 1 un
  await cenario('3b-qtd5-aumento', LEITE, 5, '7,00', 'vermelho (5 un, mesma alta unitária)', RED, 'R$ 35,00')
  await cenario('3c-qtd1-reducao', LEITE, 1, '6,50', 'verde (1 un, mesma baixa unitária)', GREEN, 'R$ 6,50')
  // sem preço oficial
  await p.getByRole('button', { name: 'Adicionar produto' }).click()
  await p.getByPlaceholder('Digite para buscar ou cadastrar').fill('Leite sem oficial'); await p.getByRole('button', { name: /Cadastrar/ }).click()
  await p.getByRole('button', { name: 'Adicionar à lista' }).click(); await p.getByRole('button', { name: 'Fechar' }).click()
  await cenario('4-sem-oficial', 'Leite sem oficial', 1, '9,00', 'normal (sem preço oficial)', NORMAL, 'R$ 9,00')
  // caminho da estimativa: sem preço pago, só o preço estimado
  await open(LEITE); await fields().nth(2).fill(''); await fields().nth(1).fill(C('7,10')); await p.getByRole('button', { name: 'Salvar' }).click()
  ok(await color(LEITE, '.val') === RED && await val(LEITE).innerText() === 'R$ 7,10', 'só estimativa (sem preço pago) acima do oficial também fica vermelha')
  // regra 4: nada disso mexeu no preço oficial nem no histórico
  await p.locator('nav button', { hasText: 'Produtos' }).click()
  await p.locator('[data-testid=prod]', { hasText: LEITE }).first().click()
  ok(await p.getByTestId('official-field').inputValue() === '6,80', 'preço oficial continua R$ 6,80')
  ok(await p.locator('.sheet .line').count() === 0, 'nenhum registro novo no histórico de preços')
  await p.getByRole('button', { name: 'Fechar' }).click()
  await p.locator('nav button', { hasText: 'Lista' }).click()
  await p.screenshot({ path: '/tmp/lista-final.png' })
  console.log(shots.join(','))
} catch (e) { fail++; console.log('ERRO', e.message) }
console.log(`\n${pass} ok, ${fail} falhas`)
await browser.close(); procs.forEach(p => p.kill()); process.exit(fail ? 1 : 0)
