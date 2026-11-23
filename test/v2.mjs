// Testes da Entrega 1: preço oficial x estimado, cores, ordem, orçamento, Excel revisado.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright'); const XLSX = require('xlsx')
const seed = JSON.parse(readFileSync('src/seed.json', 'utf8'))
const URL = 'http://localhost:4173/'
const procs = [spawn('node', ['test/fake-server.mjs'], { stdio: 'ignore' }), spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })]
await new Promise(r => setTimeout(r, 3500))
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m) }
const C = v => { const [a, b = ''] = String(v).replace('.', ',').split(','); return a + b.padEnd(2, '0').slice(0, 2) } // máscara de preço: digita só os números
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await chromium.launch()
const mk = async (w = 390) => { const ctx = await browser.newContext({ viewport: { width: w, height: 780 } }); const p = await ctx.newPage(); p.on('dialog', d => d.accept()); await p.goto(URL); return { ctx, p } }
const tab = (p, n) => p.locator('nav button', { hasText: n }).click()
const waitSync = p => p.waitForFunction(() => document.querySelector('[data-testid=sync]')?.textContent === 'Sincronizado', null, { timeout: 15000 })
const brlRe = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const prod = (n) => seed.products.find(p => p.name === n)
const ARROZ = 'Água sanitária', LEITE = 'Amaciante pequeno azul' // ambos na lista atual
try {
  const A = await mk(360), p = A.p
  await p.locator('input[type=email]').fill('eu@teste.com'); await p.locator('input[type=password]').fill('senha123')
  await p.getByRole('button', { name: 'Ainda não tenho conta' }).click(); await p.getByRole('button', { name: 'Criar conta' }).click()
  await p.getByRole('button', { name: 'Criar a lista da casa' }).click()
  await p.waitForSelector('[data-testid=item]'); await waitSync(p)
  await p.getByRole('button', { name: /Todos/ }).click()

  // ---- ordem, sem arrastar, categorias na mesma sequência
  ok(await p.locator('.grip, [data-testid=grip]').count() === 0, 'nenhum ícone/controle de arrastar na lista')
  const groups = await p.evaluate(() => [...document.querySelectorAll('[data-grp]')].map(g => ({ c: g.dataset.grp, names: [...g.querySelectorAll('.nm')].map(n => n.textContent) })))
  const sorted = groups.every(g => g.names.every((n, i) => i === 0 || g.names[i - 1].localeCompare(n, 'pt-BR', { sensitivity: 'base' }) <= 0))
  ok(sorted, 'itens em ordem alfabética dentro de cada categoria')
  const seq = groups.map(g => g.c), want = seed.categories.map(c => c.name).filter(n => seq.includes(n))
  ok(JSON.stringify(seq) === JSON.stringify(want), 'sequência das categorias preservada: ' + seq.join(' > '))
  await p.evaluate(() => { const r = document.querySelector('[data-testid=item]'); r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })

  // ---- cabeçalho: No carrinho / Previsão final
  const head = await p.locator('.tot').innerText()
  ok(/No carrinho/.test(head) && /Previsão final/.test(head), 'cabeçalho mostra "No carrinho" e "Previsão final": ' + head.replace(/\n/g, ' | '))
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sem rolagem horizontal em 360 px')
  const topH = await p.locator('.top').boundingBox(); console.log('altura do cabeçalho', topH.height)

  // ---- preço oficial preservado e estimativa manual não mexe nele
  const offAntes = prod(ARROZ).price
  const row = p.locator('[data-testid=item]', { hasText: ARROZ }).first()
  ok(!/up|down/.test(await row.locator('.val').getAttribute('class')), 'estimativa igual ao oficial: valor sem cor de comparação')
  await row.locator('.mid').click()
  ok(new RegExp('Último preço oficial: R\\$ ' + brlRe(offAntes).replace('.', '\\.')).test(await p.locator('[data-testid=official-ref]').innerText()), 'ficha do item mostra o último preço oficial')
  await p.locator('.sheet input[inputmode=decimal], .sheet input[inputmode=numeric]').nth(1).fill(C(offAntes + 2)); await p.getByRole('button', { name: 'Salvar' }).click()
  ok(/up/.test(await row.locator('.val').getAttribute('class')), 'estimativa acima do oficial: valor total fica vermelho (classe up)')
  const metaTxt = await row.locator('.meta').innerText(); ok(!/%/.test(metaTxt), 'linha do item sem percentual/texto extra: ' + metaTxt)
  const cA = await row.locator('.val').evaluate(e => getComputedStyle(e).color), cB = await p.locator('[data-testid=item] .val:not(.up):not(.down)').first().evaluate(e => getComputedStyle(e).color)
  ok(cA !== cB, `cor aplicada só no valor total (${cA} x ${cB})`)
  await row.locator('.mid').click()
  await p.locator('.sheet input[inputmode=decimal], .sheet input[inputmode=numeric]').nth(1).fill(C(offAntes - 0.5)); await p.getByRole('button', { name: 'Salvar' }).click()
  ok(/down/.test(await row.locator('.val').getAttribute('class')), 'estimativa abaixo do oficial: valor total fica verde (classe down)')
  await tab(p, 'Produtos')
  await p.locator('[data-testid=prod]', { hasText: ARROZ }).first().click()
  ok((await p.locator('[data-testid=official-field]').inputValue()) === String(offAntes).replace('.', ','), 'preço oficial do produto continua o do catálogo atual: ' + offAntes)
  ok(await p.locator('[data-testid=official-field]').evaluate(e => e.readOnly), 'preço oficial não é editável na tela de produto')
  ok(await p.locator('.sheet .line').count() === 0, 'estimativa manual não criou histórico de preço')
  await p.getByRole('button', { name: 'Fechar' }).click()

  // ---- nova lista usa o preço oficial como estimativa inicial
  await tab(p, 'Resumo'); await p.getByRole('button', { name: /Nova lista/ }).click()
  await p.getByRole('button', { name: 'Copiar todos os itens da atual' }).click()
  await tab(p, 'Lista'); await p.getByRole('button', { name: /Todos/ }).click()
  await wait(400)
  const metaNova = await p.locator('[data-testid=item]', { hasText: ARROZ }).first().locator('.meta').innerText()
  ok(metaNova.includes('R$ ' + brlRe(offAntes)), 'nova lista começa com o preço oficial como estimativa: ' + metaNova)

  // ---- orçamento: alertas 800 / 900 / 1000 e aviso da previsão
  const alerts = () => p.locator('.top .alert').allInnerTexts()
  await p.getByRole('button', { name: 'Adicionar produto' }).click()
  await p.getByPlaceholder('Digite para buscar ou cadastrar').fill('Teste caro')
  await p.getByRole('button', { name: /Cadastrar/ }).click()
  await p.getByPlaceholder('0,00').fill('790'); await p.getByRole('button', { name: 'Adicionar à lista' }).click(); await p.getByRole('button', { name: 'Fechar' }).click()
  const caro = () => p.locator('[data-testid=item]', { hasText: 'Teste caro' })
  await caro().locator('.cb').click()
  ok((await alerts()).length === 0, 'carrinho em R$ 790: nenhum alerta (mesmo com a previsão passando de R$ 1.000)')
  const setEst = async v => { await caro().locator('.mid').click(); await p.locator('.sheet input[inputmode=decimal], .sheet input[inputmode=numeric]').nth(1).fill(C(v)); await p.getByRole('button', { name: 'Salvar' }).click() }
  await setEst('800'); ok((await alerts()).some(t => /Carrinho em R\$ 800,00.*acima do orçamento/.test(t)), 'R$ 800 com previsão acima de R$ 1.000: alerta ' + (await alerts()))
  await setEst('900'); ok((await alerts()).some(t => /Carrinho em R\$ 900,00/.test(t)) && await p.locator('.top .alert.l900').count() === 1, 'R$ 900 com risco: alerta nível 900')
  await setEst('1000'); ok((await alerts()).some(t => /Orçamento de R\$ 1\.000,00 ultrapassado/.test(t)), 'R$ 1.000: orçamento ultrapassado: ' + (await alerts()))
  ok(await p.locator('.top .alert.l1000').count() === 1, 'alerta vermelho no carrinho de R$ 1.000')
  const headBig = await p.locator('.tot').innerText(); ok(/No carrinho R\$ 1\.000,00/.test(headBig.replace(/\n/g, ' ')), 'No carrinho soma só o marcado: ' + headBig.replace(/\n/g, ' '))
  await p.screenshot({ path: 'test/shot-orcamento.png' })
  await caro().locator('.cb').click()
  ok((await alerts()).length === 0, 'desmarcando (carrinho volta abaixo de R$ 800): sem alerta')
  await tab(p, 'Resumo'); const rs = await p.locator('.scroll').innerText(); ok(/no carrinho/i.test(rs) && /previsão final/i.test(rs), 'Resumo mostra No carrinho e Previsão final')
  await caro().first().isVisible().catch(() => {}); await tab(p, 'Lista')
  await caro().locator('.mid').click(); await p.getByRole('button', { name: 'Remover da lista' }).click()

  // ---- nome sem cor quando o produto não tem preço oficial (mesmo com estimativa)
  await tab(p, 'Lista')
  await p.getByRole('button', { name: 'Adicionar produto' }).click()
  await p.getByPlaceholder('Digite para buscar ou cadastrar').fill('Produto sem oficial'); await p.getByRole('button', { name: /Cadastrar/ }).click()
  await p.getByPlaceholder('0,00').fill('99'); await p.getByRole('button', { name: 'Adicionar à lista' }).click(); await p.getByRole('button', { name: 'Fechar' }).click()
  const so = p.locator('[data-testid=item]', { hasText: 'Produto sem oficial' }).first()
  ok(!/up|down/.test(await so.locator('.val').getAttribute('class')), 'produto sem preço oficial fica com a cor normal mesmo com estimativa preenchida')
  await so.locator('.mid').click(); await p.getByRole('button', { name: 'Remover da lista' }).click()
  // ---- alertas pelo efeito líquido: lista nova, vazia
  await tab(p, 'Resumo'); await p.getByRole('button', { name: /Nova lista/ }).click(); await p.getByRole('button', { name: 'Começar vazia' }).click()
  await tab(p, 'Lista')
  const addP = async (n, v) => { await p.getByRole('button', { name: 'Adicionar produto' }).click(); await p.getByPlaceholder('Digite para buscar ou cadastrar').fill(n); await p.getByRole('button', { name: /Cadastrar/ }).click(); await p.getByPlaceholder('0,00').fill(v); await p.getByRole('button', { name: 'Adicionar à lista' }).click(); await p.getByRole('button', { name: 'Fechar' }).click() }
  await addP('Grande A', '850'); await addP('Resto B', '100')
  await p.locator('[data-testid=item]', { hasText: 'Grande A' }).locator('.cb').click()
  ok((await alerts()).length === 0, 'carrinho R$ 850 e previsão R$ 950: dentro do orçamento, sem alerta')
  await addP('Resto C', '120')
  ok((await alerts()).some(t => /Carrinho em R\$ 850,00.*R\$ 70,00 acima do orçamento/.test(t)), 'previsão sobe para R$ 1.070: alerta com o valor acima: ' + (await alerts()))
  const rc = p.locator('[data-testid=item]', { hasText: 'Resto C' })
  await rc.locator('.mid').click(); await p.locator('.sheet input[inputmode=decimal], .sheet input[inputmode=numeric]').nth(1).fill(C('40')); await p.getByRole('button', { name: 'Salvar' }).click()
  ok((await alerts()).length === 0, 'item mais barato compensa: previsão volta a R$ 990 e o alerta some')
  // ---- Excel: estimativa, cancelar, oficial com conferência, sem duplicar, data antiga
  const mkXlsx = (rows, name) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tipo', 'ITEM', 'QTD', 'P. UNIT.'], ...rows]), 'Lista'); XLSX.writeFile(wb, name); return name }
  const price0 = prod(LEITE).price
  const f1 = mkXlsx([['Limpeza', LEITE, 2, price0 + 1], ['Outros', 'Produto Inédito X', 1, 5.5]], 'test/imp1.xlsx')
  const prodsCount = async () => { await tab(p, 'Produtos'); const t = await p.locator('.top .sub').innerText(); await tab(p, 'Lista'); return t }
  const before = await prodsCount()
  await p.getByRole('button', { name: 'Ajustes' }).click()
  await p.locator('input[type=file]').setInputFiles(f1)
  await p.waitForSelector('[data-testid=imp-confirm]')
  ok(await p.locator('[data-testid=imp-line]').count() === 2, 'conferência lista as linhas do arquivo')
  await p.getByTestId('imp-cancel').click()
  await p.getByRole('button', { name: 'Fechar' }).click()
  ok(await prodsCount() === before, 'cancelar a conferência não grava nada: ' + before)
  // estimativa
  await p.getByRole('button', { name: 'Ajustes' }).click(); await p.locator('input[type=file]').setInputFiles(f1)
  await p.waitForSelector('[data-testid=imp-confirm]'); await p.getByTestId('imp-confirm').click()
  await p.waitForSelector('[data-testid=importmsg]'); await p.getByRole('button', { name: 'Fechar' }).click()
  await tab(p, 'Produtos'); await p.locator('[data-testid=prod]', { hasText: LEITE }).first().click()
  ok((await p.locator('[data-testid=official-field]').inputValue()) === String(price0).replace('.', ','), 'importar como estimativa não altera o preço oficial')
  await p.getByRole('button', { name: 'Fechar' }).click()
  await tab(p, 'Lista'); await p.getByRole('button', { name: /Todos/ }).click()
  ok((await p.locator('[data-testid=item]', { hasText: LEITE }).first().locator('.meta').innerText()).includes('R$ ' + brlRe(price0 + 1)), 'estimativa do item atualizada pela planilha')
  // oficial
  const imp = async (file, date, force) => {
    await p.getByRole('button', { name: 'Ajustes' }).click(); await p.locator('input[type=file]').setInputFiles(file)
    await p.waitForSelector('[data-testid=imp-confirm]'); await p.getByTestId('mode-off').click()
    if (date) await p.locator('.sheet input[type=date]').fill(date)
    if (force) { ok(await p.getByTestId('imp-confirm').isDisabled(), 'nada a atualizar: botão de confirmar fica desligado'); for (const l of await p.getByTestId('imp-line').all()) await l.click() }
    const t = await p.getByTestId('imp-confirm').innerText(); await p.getByTestId('imp-confirm').click()
    await p.waitForSelector('[data-testid=importmsg]'); const m = await p.getByTestId('importmsg').innerText(); await p.getByRole('button', { name: 'Fechar' }).click(); return { t, m }
  }
  const r1 = await imp(f1); console.log(r1.m)
  ok(/oficiais/.test(r1.t) && /2 preços oficiais atualizados/.test(r1.m), 'modo oficial exige botão explícito e atualiza o preço oficial')
  await tab(p, 'Produtos'); await p.locator('[data-testid=prod]', { hasText: LEITE }).first().click()
  ok((await p.locator('[data-testid=official-field]').inputValue()) === String(price0 + 1).replace('.', ','), 'preço oficial atualizado após confirmar')
  ok(await p.locator('.sheet .line .pill', { hasText: 'oficial' }).count() === 1, 'histórico registrou 1 linha oficial')
  await p.getByRole('button', { name: 'Fechar' }).click(); await tab(p, 'Lista')
  const r2 = await imp(f1, null, true); console.log(r2.m)
  ok(/já registrados/.test(r2.m), 'repetir a mesma importação não duplica histórico')
  await tab(p, 'Produtos'); await p.locator('[data-testid=prod]', { hasText: LEITE }).first().click()
  ok(await p.locator('.sheet .line .pill', { hasText: 'oficial' }).count() === 1, 'continua 1 linha de histórico oficial')
  await p.getByRole('button', { name: 'Fechar' }).click(); await tab(p, 'Lista')
  const f2 = mkXlsx([['Limpeza', LEITE, null, price0 + 9]], 'test/imp2.xlsx')
  const r3 = await imp(f2, '2020-01-10'); console.log(r3.m)
  await tab(p, 'Produtos'); await p.locator('[data-testid=prod]', { hasText: LEITE }).first().click()
  ok((await p.locator('[data-testid=official-field]').inputValue()) === String(price0 + 1).replace('.', ','), 'preço com data mais antiga não sobrescreve o oficial atual')
  ok(await p.locator('.sheet .line .pill', { hasText: 'oficial' }).count() === 2, 'mas entra no histórico')
  await p.getByRole('button', { name: 'Fechar' }).click()
  ok(await p.getByText('Produto Inédito X').count() >= 1, 'produto novo da planilha foi cadastrado só após confirmar')
  await tab(p, 'Lista'); await waitSync(p)

  // ---- segundo aparelho vê o oficial
  const code = await (async () => { await tab(p, 'Lista'); await p.getByRole('button', { name: 'Ajustes' }).click(); const c = await p.getByTestId('invite').innerText(); await p.getByRole('button', { name: 'Fechar' }).click(); return c })()
  const B = await mk(); await B.p.locator('input[type=email]').fill('ela@teste.com'); await B.p.locator('input[type=password]').fill('senha123')
  await B.p.getByRole('button', { name: 'Ainda não tenho conta' }).click(); await B.p.getByRole('button', { name: 'Criar conta' }).click()
  await B.p.getByPlaceholder('código de convite').fill(code); await B.p.getByRole('button', { name: 'Entrar na lista' }).click()
  await B.p.waitForSelector('[data-testid=item]', { timeout: 15000 }); await wait(1500)
  await tab(B.p, 'Produtos'); await B.p.locator('[data-testid=prod]', { hasText: LEITE }).first().click()
  ok((await B.p.locator('[data-testid=official-field]').inputValue()) === String(price0 + 1).replace('.', ','), 'segundo aparelho recebe o preço oficial atualizado')
} catch (e) { fail++; console.log('ERRO', e.message) }
console.log(`\n${pass} ok, ${fail} falhas`)
await browser.close(); procs.forEach(p => p.kill()); process.exit(fail ? 1 : 0)
