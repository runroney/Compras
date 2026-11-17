// Copia os arquivos do leitor de texto (OCR) para dentro do app, para tudo rodar no proprio aparelho, sem servico externo.
import { cpSync, mkdirSync, existsSync } from 'node:fs'
const out = 'public/tesseract'
mkdirSync(out, { recursive: true })
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz', 'por.traineddata.gz'],
]
for (const [from, to] of files) {
  if (!existsSync(from)) { console.error('Arquivo do OCR nao encontrado: ' + from); process.exit(1) }
  cpSync(from, `${out}/${to}`)
}
console.log('OCR copiado para ' + out)
