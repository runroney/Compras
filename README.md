# Compras (PWA)

App de lista de compras para iPhone, Android e Windows (pelo navegador). React + TypeScript + Supabase.
Funciona offline, sincroniza entre aparelhos e pessoas, e guarda histórico de listas e de preços.

## O que já vem pronto
- Lista por categoria na ordem do mercado, filtros Faltam / Comprados / Todos, busca, marcar com um toque.
- Busca de produto enquanto digita, categoria e preço sugeridos, cadastro de produto novo na hora.
- Preço estimado e preço pago, totais, diferença, gasto por categoria.
- Base de produtos permanente (editar, excluir com confirmação, evita nome duplicado, histórico de preços).
- Nova lista: arquiva a atual, mantém a base, começa vazia ou levando só o que faltou. Histórico consultável e reutilizável.
- Offline: tudo grava no aparelho e envia sozinho quando a internet volta (indicador "N pendentes").
- Importar e exportar planilha .xlsx (Ajustes).
- 354 produtos de partida (seus 137 + 217 sugeridos) e a lista atual (66 itens com quantidade).

## Colocar no ar (uma vez, uns 20 minutos, tudo grátis)

### 1. Banco e login (Supabase)
1. Crie conta em supabase.com e um projeto novo (região São Paulo). Guarde a senha do banco.
2. Menu **SQL Editor**, cole todo o conteúdo de `supabase/schema.sql` e clique **Run**.
3. Menu **Authentication > Providers > Email**: para uso só de vocês dois, desligue "Confirm email" (assim o cadastro entra direto). Se preferir deixar ligado, cada pessoa confirma pelo e-mail.
4. Menu **Project Settings > API**: copie a **Project URL** e a chave **anon public**.

### 2. Hospedagem (GitHub Pages, grátis)
1. Crie um repositório no GitHub e envie esta pasta (`git push`).
2. Em **Settings > Secrets and variables > Actions**, crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os valores do passo anterior.
3. Em **Settings > Pages**, em "Source" escolha **GitHub Actions**.
4. A aba **Actions** roda sozinha e publica. O endereço fica `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

(Netlify, Cloudflare Pages ou Vercel também servem: comando `npm run build`, pasta `dist`, mesmas duas variáveis.)

### 3. Primeiro uso
1. Abra o link, **Criar conta**, depois **Criar a lista da casa**. Ele já importa os 354 produtos e a lista atual.
2. Em **Ajustes (engrenagem)** aparece o **código de convite**. Sua esposa cria a conta dela e usa **Entrar na lista** com esse código.

### Instalar no celular
- **iPhone (Safari):** abrir o link, botão Compartilhar, **Adicionar à Tela de Início**. Precisa ser o Safari.
- **Android (Chrome):** menu de três pontinhos, **Instalar app** (ou Adicionar à tela inicial).
- **Windows (Chrome/Edge):** ícone de instalar na barra de endereço, ou use só pelo navegador.

Abra o app uma vez com internet antes de ir ao mercado, para ele guardar tudo no aparelho.

## Como funciona por dentro
- **Armazenamento:** cada aparelho guarda uma cópia local (IndexedDB). A fonte oficial é o Postgres do Supabase.
- **Sincronização:** toda alteração vai para uma fila local e é enviada assim que há internet. O app recebe mudanças em tempo real (Supabase Realtime) e também confere ao abrir, ao voltar para o app e a cada 30 s.
- **Conflitos:** vale a alteração mais recente de cada linha (um gatilho no banco impede que uma edição antiga, feita offline, sobrescreva uma mais nova). Nada é apagado de verdade: exclusões são marcadas e continuam sincronizando.
- **Segurança:** só quem entrou na casa (código de convite) lê ou grava os dados, garantido por regras de linha (RLS) no banco. A chave `anon` pode ficar no app, ela não dá acesso sem login.
- **Backup:** use **Ajustes > Exportar tudo para Excel** de vez em quando (sugestão: uma vez por mês). O plano grátis do Supabase não inclui backups automáticos.

## Limitações e custos
- Tudo roda nos planos gratuitos. Confira os limites atuais no site do Supabase e do GitHub; para uso de duas pessoas, ficam muito abaixo.
- O projeto grátis do Supabase pode ser **pausado após cerca de 1 semana sem nenhum acesso**. Basta abrir o painel e clicar em reativar. Uso semanal evita isso.
- Conflito é por linha, não por campo: se duas pessoas mudarem o **mesmo item** ao mesmo tempo (uma marcando, outra mudando a quantidade), vale a mudança mais recente e a outra se perde para aquele item. Itens diferentes nunca conflitam.
- iPhone: o iOS pode apagar dados de sites que ficam semanas sem uso. Por isso o servidor é a cópia oficial e o app recarrega tudo ao entrar.
- Notificações push não estão incluídas.

## Desenvolvimento
```
npm install
cp .env.example .env     # coloque as chaves do Supabase
npm run dev
npm run build
```
Teste de ponta a ponta (usa um backend falso local, não o Supabase): `npm run build` com `VITE_FAKE_URL=http://localhost:8787`, depois `XLSX_IN=/caminho/planilha.xlsx npm run test:e2e`.
Para regerar os produtos de partida: `python3 scripts/make_seed.py base.xlsx lista.xlsx`.
