// Cor do valor total estimado de cada produto na Lista (4 cenários do pedido).
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
const { chromium } = createRequire(import.meta.url)('playwright')
const procs = [spawn('node', ['test/fake-server.mjs'], { stdio: 'ignore' }), spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })]
await new Promise(r => setTimeout(r, 3500))
const C = v => { const [a, b = ''] = String(v).replace('.', ',').split(','); return a + b.padEnd(2, '0').slice(0, 2) } // máscara de preço: digita só os números
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m) }
const browser = await chromium.launch()
try {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, colorScheme: scheme, deviceScaleFactor: 2 })
    const p = await ctx.newPage(); p.on('dialog', d => d.accept()); await p.goto('http://localhost:4173/')
    await p.locator('input[type=email]').fill(scheme + '@t.com'); await p.locator('input[type=password]').fill('senha123')
    await p.getByRole('button', { name: 'Ainda não tenho conta' }).click(); await p.getByRole('button', { name: 'Criar conta' }).click()
    await p.getByRole('button', { name: 'Criar a lista da casa' }).click(); await p.waitForSelector('[data-testid=item]')
    await p.getByRole('button', { name: /Todos/ }).click()
    const row = n => p.locator('[data-testid=item]', { hasText: n }).first()
    const setEst = async (n, v) => { await row(n).locator('.mid').click(); await p.locator('.sheet input[inputmode=decimal], .sheet input[inputmode=numeric]').nth(1).fill(C(v)); await p.getByRole('button', { name: 'Salvar' }).click() }
    // Água (oficial 6,75 -> estimado 7,25), Amaciante (7,49 -> 5,00), Detergente (3,15 igual), Leite novo sem oficial (estimado 4,00)
    await setEst('Água sanitária', '7,25'); await setEst('Amaciante pequeno azul', '5')
    await p.getByRole('button', { name: 'Adicionar produto' }).click()
    await p.getByPlaceholder('Digite para buscar ou cadastrar').fill('Leite novo teste'); await p.getByRole('button', { name: /Cadastrar/ }).click()
    await p.getByPlaceholder('0,00').fill('4'); await p.getByRole('button', { name: 'Adicionar à lista' }).click(); await p.getByRole('button', { name: 'Fechar' }).click()
    const col = async (n, sel) => row(n).locator(sel).evaluate(e => getComputedStyle(e).color)
    const red = await col('Água sanitária', '.val'), green = await col('Amaciante pequeno azul', '.val'), same = await col('Detergente uni.', '.val'), none = await col('Leite novo teste', '.val')
    console.log(scheme, { red, green, same, none })
    ok(red !== same && green !== same && red !== green, `[${scheme}] vermelho, verde e normal são três cores diferentes`)
    ok(none === same, `[${scheme}] produto sem preço oficial fica na cor normal`)
    ok((await row('Água sanitária').locator('.val').innerText()) === 'R$ 7,25', `[${scheme}] valor mostrado é o total estimado (R$ 7,25)`)
    ok(/^rgb\(2[0-9]{2}, /.test(red) || red.startsWith('rgb(192'), `[${scheme}] maior que o oficial: vermelho (${red})`)
    const names = await Promise.all(['Água sanitária', 'Amaciante pequeno azul', 'Detergente uni.', 'Leite novo teste'].map(n => col(n, '.nm')))
    ok(new Set(names).size === 1, `[${scheme}] cor dos nomes não mudou (todas iguais)`)
    const bg = await Promise.all(['Água sanitária', 'Amaciante pequeno azul', 'Detergente uni.'].map(n => row(n).evaluate(e => getComputedStyle(e).backgroundColor)))
    ok(new Set(bg).size === 1, `[${scheme}] fundo da linha não mudou`)
    const clip = await p.locator('.scroll').boundingBox()
    await row('Água sanitária').scrollIntoViewIfNeeded()
    await p.screenshot({ path: `test/shot-cores-${scheme}.png` })
    await ctx.close()
  }
} catch (e) { fail++; console.log('ERRO', e.message) }
console.log(`\n${pass} ok, ${fail} falhas`)
await browser.close(); procs.forEach(p => p.kill()); process.exit(fail ? 1 : 0)
