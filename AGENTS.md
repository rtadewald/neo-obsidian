# Neo-Obsidian — guia para agentes

Leia este arquivo inteiro antes de mexer em qualquer coisa. Ele descreve o que o app é, como os dados vivem no vault,
o que cada tela faz e quais regras não se quebram. O que estiver aqui é regra; se o código discordar, o código vale e
este arquivo precisa ser corrigido no mesmo commit.

## 1. O que é

O Neo-Obsidian é um app web local por cima do vault do Obsidian do Rodrigo (`/Users/rtadewald/Obsidian Notes`).
Ele não tem banco de notas próprio: **lê e escreve os mesmos `.md` do vault**. Por cima deles monta um canvas em que
cada copy vive numa **categoria** (`categoria:` no frontmatter) e as versões da mesma copy (📱 Reels, 💰 Ad, 🏞️
Carrossel…, com o mesmo `ideia:`) se juntam num card 🎬.

> **Desde 18/11/2026 não existe mais 💡 ideia separada.** As 48 notas 💡 vazias foram para a `.trash` do vault, as
> 37 com material viraram copies em `1 Priorizar/` (frontmatter do T-Copy, com `ideia: "[[💡 Nome]]"` para entrar no
> mesmo card 🎬 das versões dela) e 160 copies ganharam a `categoria:` da 💡 delas. A chave `ideia:` ficou só como a
> chave do card 🎬. "Nova ideia", link colado e radar criam copies em Priorizar (`canvas._nova_copy`); a versão nova
> (`criar_saida`) herda a categoria das irmãs. Copy sem `grupo:` vive onde as irmãs de `ideia:` vivem. O que ainda
> fala de 💡 ideia abaixo é legado (o código aceita, mas o vault não tem mais nenhuma).
O app não tem IA dentro: ele é a **porta para o Claude Code** que roda no terminal (seção 9). Cada nota tem um código
(`NEO-042`); o Rodrigo copia no app e cola no Claude Code, ou manda um pedido pela bolinha do canto (⌘J).

- `app/backend/` — FastAPI em Python 3.12, rodado com `uv` (porta **8740**). O pacote Python ainda se chama `jarvis`
  (nome antigo do projeto); não renomeie.
- `app/frontend/` — Vite + React 19 + TypeScript + React Flow 12 (`@xyflow/react`) + CodeMirror 6 (porta **5180**,
  repassa `/api` para a 8740).
- `app/dados/` — o estado que não é nota: SQLite do radar, layout do canvas, miniaturas. **Fora do git.**
- `specs.md` — decisões e escopo (as "Q" citadas no código, como Q9, Q27, Q30, estão lá).
- `wireframes/` — os `.wf` da fase de desenho. `prototipos/` e `design-systems/` ficam fora do git.

## 2. As regras

1. **O vault é a fonte da verdade.** Status, formato, ideia, canvas, produto: tudo está no nome do arquivo, na pasta ou no
   frontmatter da nota. O app só deriva. Nunca guarde em `app/dados/` algo que o Obsidian precisaria saber.
2. **Escreva no vault pelas funções do backend** (`notas.py`, `canvas.py`), não com `open().write()` solto. Elas
   escrevem de forma atômica (`notas._escrever`: arquivo temporário + `os.replace`), mantêm os `[[links]]`, os pins
   do Obsidian e as posições do canvas em ordem.
3. **Nunca leia e escreva o mesmo arquivo na mesma expressão.** `open(p, "w").write(open(p).read() …)` trunca o arquivo
   antes de ler e já apagou uma nota real. Leia, guarde em variável, depois escreva. Em operação em lote no vault,
   faça backup antes (no scratchpad) e confira o diff.
4. **Nada se apaga de verdade.** Apagar uma nota manda para `.trash/` do vault (a lixeira do Obsidian), via
   `notas.para_lixeira`. Canvas apagado só sai da lista; as notas continuam (voltam para o Inbox).
5. **Frontmatter se edita por linha.** Mude só a chave que precisa (`canvas._definir`, `notas._definir_scheduled`,
   `notas._marcar_publicado`, ou o painel de propriedades no front). Não reescreva o bloco inteiro: o Obsidian e os
   plugins (Templater, Dataview) dependem do formato.
6. **PT-BR em tudo:** textos da interface, nomes de variáveis e funções, comentários, mensagens de commit.
7. **Segredos e conteúdo do vault não saem daqui.** O repositório é público no GitHub. Nada de notas, `app/dados/`,
   `.env` ou chaves em commits. O agente usa o login da assinatura do Claude Code (`auth.py` tira a
   `ANTHROPIC_API_KEY` do ambiente de propósito).
8. **Não mexa em `.obsidian/`** do vault, com uma exceção já implementada: o `data.json` do plugin File Explorer++
   (pins), que `notas._trocar_fixada` mantém em dia quando uma nota muda de nome, de pasta ou vai para a lixeira.

## 3. Rodar, testar, reiniciar

```bash
neo-obsidian            # sobe API + front e abre http://localhost:5180 (Ctrl+C derruba os dois)
neo-obsidian parar      # derruba o que estiver nas portas 8740 e 5180
neo-obsidian abrir      # só abre o navegador
```

O comando é o link `~/.local/bin/neo-obsidian` → `app/neo-obsidian.sh`. Separado:

```bash
uv run --directory app/backend jarvis          # API (porta 8740)
npm --prefix app/frontend run dev              # front (porta 5180)
```

No Claude Code desta pasta os dois estão em `.claude/launch.json` como `neo-obsidian-api` e `neo-obsidian-web`.

- **O front recarrega sozinho** (HMR do Vite). **A API não:** depois de mexer em Python, reinicie a API.
- Tipos do front: `npx tsc --noEmit -p tsconfig.app.json` dentro de `app/frontend`. Há erros antigos em
  `livePreview.ts` (sintaxe de parâmetro de construtor) e um em `Radar.tsx` (comparação `'' === 'fora'`); não são seus.
  Ao criar classes, declare os campos e atribua no construtor (o `erasableSyntaxOnly` está ligado).
- Python: `uv run --directory app/backend python -c "import jarvis.main"` confere que a API importa.
- Não há testes automáticos. Teste no navegador e **limpe o que criou** (ideia de teste vai para a lixeira, posição de
  teste sai do `canvas.json`, nota real alterada volta do backup).

## 4. O vault: pastas, status e o de-para

```
1 Copies/
  0 Ideias/            💡 ideias (uma nota por ideia). Entradas/ = legado (ver seção 12)
  1 Priorizar/         copies vivas: backlog, em edição, agendadas
  2 Publicados/        copies publicadas (publicado: true)
2 Notas/Engine/
  templates/           T - Copy.md é o frontmatter de toda copy nova
  attachments/         imagens coladas (![[Pasted image ….png]])
3 Skills/<nome>/SKILL.md   as skills (o Claude Code usa; o modal abre e edita)
.trash/                a lixeira do Obsidian (para onde o app "apaga")
```

### Status da copy (pasta + emoji no começo do nome)

| Status (código) | Rótulo no app | Como está no vault |
|---|---|---|
| `ideia` | Priorizar / Backlog | nota em `1 Priorizar/` sem marca no começo do nome |
| `edicao` | Em edição | em `1 Priorizar/`, nome começa com `🧑🏼‍🔧` |
| `agendado` | Agendado | em `1 Priorizar/`, nome começa com `🔹` |
| `publicado` | Publicado | em `2 Publicados/`, com `publicado: true` |

- Mudar entre `ideia`, `edicao` e `agendado` **renomeia** a nota (troca só a marca: `notas.mudar_status`).
- Publicar **move** para `2 Publicados/`, tira `🔹`/`🧑🏼‍🔧` do nome e grava `publicado: true` (`notas.mover`).
  Despublicar faz o caminho inverso (`publicado: false`, volta para Priorizar) e, se pedido, aplica o status.
- A regex das marcas é `notas.MARCAS` (aceita `🧑‍🔧` com qualquer tom de pele e marcas repetidas).

### Formato (emoji depois da marca de status)

| Emoji | Formato | | Emoji | Formato |
|---|---|---|---|---|
| 📱 | Reels | | 🏞️ | Carrossel / estático |
| 💰 | Ad (tráfego pago) | | 🎥 | YouTube |
| 📺 | VSL | | 🎙️ | Live |
| 📝 | Feed | | 🗣️ | Stories |

São os `canvas.FORMATOS`, na ordem de `canvas.ROTULO_FORMATO`; o front ordena as abas por `ORDEM_FORMATO`
(`canvasApi.ts`). Marcas antigas ainda reconhecidas no nome (`MARCAS_FORMATO`): `📩 🎣 📚 💻 🧑🏼‍🏫 ✅ 🔥 📦`. Nota sem
emoji conhecido aparece como `📄`. O nome sem marcas nem emoji é o "título da ideia" (`canvas._base`).

**De-para já aplicado no vault** (não reverta; use como regra para notas novas):

- `🔥 Nome` → `📱 Nome` com a tag `"🔥"` em `tags:` (o fogo virou tag, não formato).
- `✅ … CTA` → `💰` (Ad). O ✅ verde não é formato.
- `🎣 Isca …` → `📱` (Reels).
- Nota de Priorizar sem copy nenhuma → `0 Ideias/` como `💡 Nome`, com a posição do canvas migrada (`p:…` → `i:…`).
- "Entrada" (material bruto) deixou de ser tipo à parte: link ou texto colado vira 💡 ideia.

### Frontmatter

| Chave | Em quê | O que é |
|---|---|---|
| `publicado` | copy | `true` só em `2 Publicados/` (o app mantém) |
| `scheduled` | copy | `"AAAA-MM-DD"`, a data de publicação; o calendário editorial lê e grava |
| `tags` | todas | lista YAML; vazia fica `tags:` (nunca apague a chave) |
| `ideia` | copy | `"[[💡 Nome]]"`: a copy é uma saída dessa ideia (com aspas, por causa dos colchetes) |
| `notion` | copy | link do card no Notion (base "Edição e Publicação - 2026"); vários cards da mesma copy (versões, LP/VSL, retestes) viram lista. O painel mostra como "Notion ↗" |
| `grupo` | ideia ou copy | nome do **canvas** onde a nota vive (vazio = 📥 Inbox) |
| `origin` | ideia | wikilink do projeto/tema pai (padrão do vault) |
| `fontes` | ideia | lista de `[[…]]` das entradas ligadas (legado) |
| `url`, `tipo`, `thumb`, `autor` | ideia | o material bruto: `tipo` é `texto`, `link`, `youtube`, `instagram` ou `radar` |

Copy nova sempre nasce com o frontmatter de `2 Notas/Engine/templates/T - Copy.md` (`notas.criar`) ou com
`publicado: false / scheduled: / ideia: / tags:` (`canvas.criar_saida`). Ideia nova: `origin: / tags:` (+ `fontes`).

### Links

- Sempre `[[wikilinks]]` por título simples (`[[💡 Img 2 HTML]]`), nunca link markdown para nota do vault.
- Renomear uma 💡 ideia pelo app reescreve os `[[links]]` para ela em todo `1 Copies/` (`notas.trocar_links`), como o
  Obsidian faria. Renomear uma copy **não** reescreve links (copies quase não são linkadas).
- Imagens: `![[Pasted image AAAAMMDDHHMMSS.png]]`, resolvidas em `2 Notas/Engine/attachments/` (rota `/api/anexo/…`).
- Nomes de arquivo têm espaços, emojis e acentos: **sempre aspas** em comandos de shell.

### Conflito com o Obsidian aberto

Cada `PUT /api/notas/…` manda o `mtime` que o editor leu. Se o arquivo mudou por fora, a API devolve conflito e o
modal mostra "recarregar" em vez de sobrescrever. Não contorne isso.

## 5. O modelo do canvas

### Canvas e produtos: dois eixos independentes

- **Canvas = onde a nota vive.** É a propriedade `grupo: "<canvas>"` (uma só por nota). Sem `grupo:` (ou com um valor
  que não é canvas nenhum), a nota vive no **📥 Inbox**. Copy sem `grupo:` vai junto com a 💡 ideia dela; ideia sem
  `grupo:` vai com a maioria das copies dela (`canvas._todas` calcula esse `canvas` de cada nota).
- `app/dados/canvases.json` lista os canvas temáticos: `{slug, nome, icone, cor}` (Skills, Hacks e Dicas, Storytelling
  Project…). O Inbox (`inbox`) é fixo e não fica no arquivo. Há ainda o canvas interno `todos` (todas as notas), de
  onde saem as pastas globais. Cada canvas tem o seu layout em `app/dados/canvas/<slug>.json`.
- **Produto = as tags da nota** (FIA `🤖fia`, FID `🖼️fid`, Dados `📊dados`, PICO `💰bf26`/`arquivo/pico`), listados em
  `app/dados/produtos.json` (`{slug, nome, icone, tags, cor}`). **Produto não é lugar**: dentro do canvas é só um filtro
  (botões liga/desliga na barra, depois de um pipe após os tipos, mais "Sem" = sem produto) e uma bolinha da cor dele no card. Produtos diferentes convivem no mesmo canvas, e
  uma nota pode ser de vários produtos.
- O app manda o canvas atual no cabeçalho `X-Canvas` (`canvasApi.ts`); o middleware de `main.py` põe em
  `canvas._atual` (o que não existir vira `inbox`). Nota criada dentro de um canvas temático já nasce com o `grupo:`
  dele (`marcar_no_canvas`). Renomear/mover uma nota leva a posição junto em **todos** os layouts.
- **Globais**: as pastas Em edição, Agendado e Publicado (e as tabelas delas) contam as notas de todos os canvas.
- Botão direito num card ou numa seleção: **Mover para ›** (lista dos canvas e o Inbox; `POST /api/canvas/mover` grava
  o `grupo:` na ideia e em todas as copies dela, tira dos arquivados do destino e dá lugar aos cards lá) e
  **Produto ›** (marca/desmarca a tag; `POST /api/canvas/produto`; na seleção, `–` com `n/N` quando só parte é).
- Clicar em NEO-OBSIDIAN (início do breadcrumb) abre a **página inicial** (`Canvases.tsx`): os canvas com quantas
  copies de cada produto vivem ali, "+ Novo canvas", e Renomear/Apagar no hover. Renomear troca o `grupo:` de todas as
  notas dele; apagar devolve as notas ao Inbox (o layout vai para o histórico).
- Até 14/11/2026 existiam caixas (retângulos dentro de canvas por produto). Foram tiradas: cada caixa virou um canvas
  com as mesmas notas e posições, e os canvas de produto viraram produtos. Os arquivos antigos estão em
  `app/dados/antes-de-produtos-*/`. Não traga as caixas de volta.

| Card | Id | De onde vem |
|---|---|---|
| 💡 **ideia** | `i:<nome>` | uma nota em `0 Ideias/` |
| 🎬 **produção (grupo)** | `g:<nome da ideia>` | as copies com o mesmo `ideia:`; um card só com um chip por formato |
| 🎬 **produção de uma nota** | `p:<raiz>/<nome>` | copy sem `ideia:` (ou com uma ideia que só tem ela). Mesmo visual do card 🎬 (`CartaoProducao`), com um chip só |
| entrada (legado) | `e:<nome>` | nota em `0 Ideias/Entradas/` |

- **Três tipos de card: 💡 ideia, 🎬 produção e 📺 VSL.** A produção junta as versões curtas da mesma copy (Reels,
  carrosséis, ads… com o mesmo `ideia:`). Cada VSL (📺) tem card próprio (`CartaoVSL`, selo VSL, duração estimada),
  nunca entra numa produção e, com `ideia:`, ganha uma linha da ideia ou da produção até ela. "Entrada" é legado e não há mais nenhuma nota desse tipo.
- **🔥 winner** = a tag `"🔥"` em `tags:` (`canvas.WINNER`). O card ganha borda vermelha e o foguinho; marca e desmarca
  pelo botão direito (`POST /api/canvas/winner`). O botão não aparece nos cards que não são winner.
- **O grupo 🎬 não precisa de nota 💡.** Basta duas ou mais copies com o mesmo `ideia: "[[💡 X]]"`, mesmo que
  `💡 X.md` não exista. Com uma copy só e sem a nota, ela fica solta. Com a nota 💡, a ideia vira card próprio e uma
  seta liga a ideia ao grupo.
- **O card de grupo abre sempre no 📱 Reels** quando há um (entre vários Reels, o que está para sair).

### `app/dados/canvas/<slug>.json`

```json
{ "pos": { "i:💡 Nome": {"x": 0, "y": 0}, "edicao|p:priorizar/…": {…} },
  "arquivados": ["p:priorizar/…"],
  "visiveis": ["g:💡 …"] }
```

**O layout se protege** (`canvas.py`): uma trava única (`_trava`) envolve toda leitura-alteração-gravação, cada
gravação usa um temporário próprio, cada versão anterior vai para `app/dados/canvas-historico/` (as últimas 200) e um
layout ilegível **nunca** é tratado como vazio (dá erro `LayoutIlegivel`). Antes disso, duas gravações simultâneas
corromperam o arquivo e o servidor regravou um layout vazio por cima de tudo. Para restaurar, copie uma versão do
histórico por cima do `<slug>.json` com a API parada.

A posição na vista principal do canvas usa o id puro; nas outras vistas, `<vista>|<id>`. Quando uma
nota muda de nome ou de pasta pela API de ação, `canvas.renomeou` leva a posição junto. **Se você renomear ou mover
uma nota por fora do app, migre a chave em `pos` também**, senão o card perde o lugar.

### O que aparece num canvas

- Só as notas que vivem nele (o `canvas` calculado de cada nota). Arquivado à mão (menu → Arquivar) não aparece.
- **Copy publicada fica no canvas temático dela**; no **Inbox** ela conta como arquivada (vai para a pasta Publicado),
  a não ser que esteja em `visiveis` (trazida por ⌘↵ ou Mover para). Ideia aparece se não tem saída ou se alguma
  saída está viva.
- Filtros na barra: tipos (💡 🎬 📺) | produtos (os mesmos botões liga/desliga) e o seletor Todos, Backlog, Em edição, Agendado.
- **Sem barra da esquerda (19/11/2026):** as pastas dos canvas, os pinados e o histórico na esquerda saíram (e o ⌘[ da nota).
  Para trocar de canvas: a página principal (NEO-OBSIDIAN no breadcrumb), onde o botão direito num card de canvas
  abre o `MenuDoCanvas` (Renomear, Cor, Arquivar/Reativar, Excluir), ou o ⌘P. Os pinados ficam na tabela "Pinados"
  (barra de baixo). O rodapé vai até a borda.
- Vistas (`Visao` em `Canvas.tsx`): `principal`, `foco:<id>` (um card e
  tudo que está ligado a ele), além de `edicao`, `agendado` e `pub-<ano>`. Os pinados abrem o `foco:` pela tabela Pinados.
- **Pinados**: categorias (`c:<nome>`), cards 🎬 (`g:`) e copies (`p:`) se pinam (`pinavel` em `pins.ts`; o pin
  antigo `i:💡 X` vira `p:priorizar/X`, a copy que nasceu dela). Clicar num pinado abre o `foco:` dele, isolado, com os
  filhos: a categoria parte de todas as copies com aquela `categoria:`; no mapa mental a raiz do foco abre expandida e a tela se enquadra. A categoria pina pelo botão direito.
- **Guias de alinhamento**: arrastando um card sozinho, bordas e meio encaixam (7 px de tela) nos dos outros cards
  visíveis, com uma linha rosa (`canvas-guia`, no `ViewportPortal`). No mapa, só a categoria encaixa.
- **Alinhar e distribuir** (botão na barra de baixo): esquerda, centro, direita, topo, meio, base e distribuir na
  horizontal/vertical os cards selecionados; no mapa mental, só as categorias. Entra no ⌘Z.
- **Organizar o mapa** (botão de grade ao lado de Mapa mental, só no mapa): uma coluna (padrão) ou grade 3×3, 4×4, 5×5,
  6×6 e 8×8, como no Neo Stitch: em todo nível os filhos de um card vão em colunas de N (nunca mais de N empilhados),
  cada um com o bloco do seu galho. Fica no localStorage `canvas-grade#<canvas>`. Arrastar muda a ordem coluna a coluna.
  As grades que dariam o mesmo resultado (nenhum card com mais de N filhos) ficam apagadas no menu.
- **Criação** (💡 na barra de baixo, separado por um pipe dos 🔥/📌; também a primeira aba da tabela, com pipe antes de
  Priorizar): as copies do canvas em grupos categoria › card 🎬 (2+ versões da mesma `ideia:`) › copies; a copy
  sozinha fica direto na categoria, com o ponto do status. A linha 🎬 não expande: o clique abre a primeira versão (ordem
  dos formatos), e as outras ficam nas abas do modal. As versões de cada 🎬 (formato + ponto de status) ficam na coluna
  Versões, ao lado do nome, só nesta aba; a linha fica de uma altura só. Dentro da categoria, cada linha é bolinha de status › ícone (🎬 ou o
  formato da copy, `.tabela-ic`, na mesma linha do nome) › nome, recuada em relação à categoria; a coluna da esquerda fica
  vazia nessas linhas. Expandir tudo / Recolher tudo, ao lado dos filtros, abre e fecha
  as categorias. A coluna Canvas mostra o emoji e o nome do canvas de cada linha; a linha da categoria junta os canvas.
- **Formatos na tabela:** um dropdown (`FiltroFormatos`) com uma caixinha por formato e a contagem, no lugar da fileira de ícones.
- **A tabela guarda o estado de quando saiu**, por aba: busca, filtros, ordem, grupos abertos e a rolagem
  (`tabelaSalva`, `localStorage` `tabela-estado`). Os números e as barras por mês do topo saíram.

### Mapa mental (modo do canvas)

- **Barra de baixo, à direita das pastas** (só ícones, dica no hover): alinhar, organizar (só no mapa mental), mouse/trackpad
  | desenhar, ajuste automático, ajustar à tela, ✓ ver publicados, detalhes dos cards. O botão de detalhes (global,
  `canvas-midia`, desligado por padrão) mostra nos cards 🎬 os chips de formato (📱 💰…) e as imagens/vídeos; desligado,
  o card fica numa linha só (ícone, título inteiro, que quebra linha se precisar, 🔥 e o código à direita). A borda vermelha dos winners está
  desligada (só o 🔥 no canto). O ✓ é por canvas
  (`canvas-publicados#<slug>`, ligado por padrão): desligado, os cards publicados somem (`montar(..., semPub)`); os
  trazidos à mão (`visiveis`) continuam, e os arquivados seguem fora de qualquer jeito. Os botões de mapa mental, minimapa, linhas e destaque
  dos winners saíram: linhas e destaque ficam sempre ligados, o minimapa desligado, e o mapa mental alterna pela tecla **G**.
- **Um ponto de saída por canvas:** no mapa mental (vista principal), o canvas tem um card raiz lima com o ícone e o
  nome dele (`r:<slug>`, um nó `categoria` com `data.raiz`). Todas as categorias, e qualquer card sem pai, saem dele.
  Duplo clique colapsa tudo; arrastar a raiz leva a árvore e guarda o lugar (`mapa|r:<slug>`); arrastar uma categoria
  muda a ordem dela entre as irmãs (`ordem` do layout, pai = a raiz). Botão direito na raiz → "Nova copy numa categoria".
- A tecla **G** alterna **mapa mental** (o padrão) e **canvas
  livre**, lembrado por canvas (`canvas-modo#<slug>` no localStorage). As árvores vão em colunas lado a lado, para encher a
  tela em vez de virar uma fila comprida. No mapa os cards não se arrastam e não há camada de desenho: o lugar sai das
  ligações (`emArvore` em `Canvas.tsx`). A 💡 ideia é a raiz, as produções e VSLs dela vão à direita, a copy que nasceu
  de outra (`origem:`) depois da de origem. Card sem pai vira raiz, depois das ideias. A altura de cada card vem do que
  o React Flow mediu; a relayout só troca `position`/`hidden` no mesmo objeto (trocar o objeto faz o React Flow medir
  de novo, sem fim).
- **Canvas em uso (18/11/2026):** 📱 Reels (slug `reels-fia`; recebeu Diorama e Reels FID), 💰 Pico Asimov (recebeu VSL
  Carrinho BF), 📺 VSL FIA e 📺 VSL FID, mais o Inbox. Dúvidas foi apagado. No VSL FIA, cada VSL `📺 FIA X.Y` tem `categoria: "VSL X"`
  (a versão principal) e as categorias seguem em ordem numérica (`ordem` do layout, pai `r:vsls-fia`).
- **Mídia no card de copy:** se alguma versão do card tem vídeo colado (`![[x.mp4]]`, campo `video` de `_midia`), imagem
  colada, `thumb:` ou link do X/YouTube, o card mostra a mídia (sem a lista de links) logo abaixo do título; sem mídia, fica igual.
- **Categorias**: cada copy tem `categoria: "<emoji> <nome>"` no frontmatter (a copy sem ela usa a de uma irmã da
  mesma `ideia:`; sem nenhuma, "Sem categoria"). Botão direito no card → Categoria muda (`POST /api/canvas/categoria`
  `{nomes, categoria}`, `canvas.definir_categoria`), num submenu "Categoria ›" com a atual marcada; na categoria,
  "Nova copy aqui" e "Renomear" (`POST /api/canvas/categoria/renomear` `{de, para}`, `canvas.renomear_categoria`:
  reescreve o `categoria:` das copies daquele canvas e leva junto lugar, ordem e arquivamento do layout; o front leva o
  pin e o colapso). A categoria não é nota: é só esse texto no frontmatter das copies.
  No hover, o card da categoria mostra um **+** (nova copy nela) e o card do canvas um **+** (nova categoria: pede o nome e
  já a primeira copy, porque a categoria só existe nas copies). Botão direito na categoria → "Excluir categoria" manda as
  copies dela para "Sem categoria" (nenhuma é apagada); na raiz → "Nova categoria". Antes era a 💡 ideia que tinha (8 categorias por tipo de projeto, de
  17/11/2026: Skills e plugins do Claude, Ferramentas e repos open source, Design e sites com IA, 3D e vídeo com IA,
  Projetos que eu construí, Começar em IA e opinião, Vendas, Referências de outros players).
- **Hierarquia do mapa** (`emArvoreNos`): **categoria** (card preto `categoria`, id `c:<nome>`, só existe no mapa) →
  **💡 ideia com material** (o card visual de sempre, com imagem, vídeo e texto) → copies. A ideia **sem material**
  (`material: false` na API, `canvas._tem_material`: sem link, embed nem texto além da frase das notas de lugar) some
  do mapa e as produções/VSLs dela penduram direto na categoria. Ideia sem categoria cai em "Sem categoria". Cada
  categoria abre a sua coluna; colapsa pelo botão ou duplo clique. O card de copy não mostra prévia nem data.
- **Arrastar no mapa**: a categoria arrasta a árvore inteira junto e fica onde foi solta (posição `mapa|c:<nome>` no
  `pos` do layout; as categorias sem lugar se arrumam à direita das arrastadas). Ideia ou copy arrastada para cima ou
  para baixo muda de ordem entre os irmãos e volta para a coluna: a ordem fica em `ordem` do layout
  (`{id do pai: [ids]}`, `PUT /api/canvas/ordem`); quem não está na lista vem depois, do mais novo ao mais velho.
- `producao:` na copy (opcional): separa produções dentro de uma mesma ideia (chave "ideia › produção",
  `chaveProd` em `canvasApi.ts`). Ainda não há copy usando.
- **Juntar ideias**: com 2+ 💡 selecionadas, botão direito → "Juntar ideias numa só" (`POST /api/canvas/juntar`
  `{destino, origens}`, `canvas.juntar_ideias`). O corpo de cada origem entra em `## Entradas` do destino como
  `### <nome>` (os títulos dela descem dois níveis), tags e fontes se somam, as copies trocam o `ideia:` e as notas de
  origem vão para a `.trash` do vault. O destino pode ser uma delas ou um nome novo (que herda canvas e categoria da primeira).
- O botão −/+n na borda direita de um card com filhos colapsa a subárvore (`canvas-colapsadas#<slug>`). Abrir ou fechar
  (e trocar de modo) enquadra o mapa na tela (`enquadrarTudo`, sem contar os cards escondidos). Dois cliques
  continuam abrindo a nota; as alças continuam ligando cards.
- **Toda copy visível tem ideia** desde 17/11/2026: as 95 copies sem `ideia:` (canvas temáticos + Inbox não publicado)
  foram agrupadas por roteiro em ideias centrais, e as ideias citadas sem nota ganharam a nota 💡 (50 notas criadas).
  A lista do que mudou ficou fora do repo; para desfazer, esvazie o `ideia:` das copies e apague as notas criadas.
- **Plugar numa ideia que já existe**: o material entra na seção `## Entradas` da nota 💡 (`canvas._com_entrada`:
  `### dd/mm/aaaa · título` e o conteúdo; cria a seção se não houver). Pelo `POST /api/canvas/entrada` com `ideia`.
  Na tela: Radar → botão direito → "Plugar numa ideia que já existe ›"; ⌘⇧I → "Plugar numa ideia"; colar (⌘V) no
  canvas com uma 💡 ideia selecionada. A busca de ideias é o `EscolherIdeia.tsx`.

### Selo NOVO nas ideias

- **Toda 💡 ideia nova** ganha o selo **NOVO** no card (e borda lima): criada à mão (botão direito → Nova ideia, busca
  ⌘P), card do Radar (botão 💡 ou "Adicionar ao canvas"), link ou texto colado no canvas e copy criada pelo Claude
  (`canvas.criar_ideia` e `criar_entrada` chamam `marcar_nova`).
- A lista fica em `app/dados/novas.json` (`canvas.marcar_nova` / `marcar_vista`). `estado()` devolve `novas` só com as
  que continuam novas: **ganhar uma produção (uma saída com `ideia:`) tira o selo sozinho**; renomear leva o selo junto.
- Marcar como visto: clique no selo, ou botão direito → Marcar como visto (`POST /api/canvas/vista` `{nomes}`).

### Desenho livre (Excalidraw)

- A vista principal de cada canvas tem uma camada de desenho: o **Excalidraw de verdade** (`@excalidraw/excalidraw`,
  `Desenho.tsx`), com as ferramentas, atalhos, cores, estilos e o traço à mão dele, em PT-BR.
- Fica **por baixo dos cards**, com o mesmo pan/zoom do React Flow: o React Flow põe um ponto na tela em
  `cena * zoom + x`; o Excalidraw em `(cena + scrollX) * zoom`; então `scrollX = x / zoom` (os dois ocupam o mesmo
  retângulo; a camada vai até a borda). `onMove` do React Flow empurra a vista para o Excalidraw; no modo
  desenho, o pan/zoom feito dentro do Excalidraw volta para o React Flow (`onVista`).
- **Modo desenho**: **E** liga e desliga (entra com a seleção; dentro do modo desenho o E sai, e a borracha fica no 0), **⌥E** (liga e desliga, pela tecla física, também com o foco no Excalidraw; ⌘E também, mas a extensão do Claude no Chrome toma o ⌘E), botão de lápis na barra do canvas, ou qualquer tecla de ferramenta do Excalidraw no canvas (R, D, O,
  A, L, P/X e 2–8, 0; o T não entra, ele troca mouse/trackpad), que já entra com a ferramenta. A camada vem para a frente, os atalhos do canvas (⌘A, ⌘Z,
  colar, ⌘ + arrastar) ficam com o Excalidraw e as pastas do rodapé somem. **Esc** com a seleção e nada selecionado sai.
  Fora do modo desenho a camada só mostra os desenhos e não pega o mouse.
- Grava em `app/dados/canvas/<slug>.desenho.json` (`GET/PUT /api/canvas/desenho`, elementos e imagens), 700 ms depois
  do último traço, com temporário próprio e a versão anterior em `canvas-historico/`.
- As fontes do Excalidraw são servidas pelo app (`public/fonts`, copiadas de `node_modules` no `postinstall`, fora do
  git; `window.EXCALIDRAW_ASSET_PATH = "/"`): nada vem de CDN.
- Os desenhos não andam junto com os cards (são camadas separadas). Nas outras vistas (pastas, canvas próprio de um
  card) a camada não aparece.

### Gestos e o que cada um grava

| Gesto no canvas | Efeito no vault |
|---|---|
| Colar (`⌘V`) um link ou texto no vazio | nova 💡 ideia com o material (`POST /api/canvas/entrada`; YouTube é transcrito, página é lida) |
| Botão direito → Nova ideia | `💡 Nome.md` em `0 Ideias/` |
| Botão direito → Nova copy solta | copy em `1 Priorizar/` com o template |
| Soltar uma copy em cima de uma ideia/grupo | `ideia: "[[…]]"` na copy (`/api/canvas/ligar`) |
| Soltar uma copy em cima de outra copy | pergunta o nome e grava o mesmo `ideia:` nas duas (`/api/canvas/agrupar`; não cria nota 💡) |
| Ligar pelas alças (arrastar de uma borda a outro card) | o mesmo que soltar em cima |
| Botão direito → Mover para › | `grupo:` na ideia e nas copies dela (`POST /api/canvas/mover`) |
| Botão direito → Produto › | tag do produto nas copies (`POST /api/canvas/produto`) |
| `Delete` numa linha | desfaz a ligação (tira `fontes:` ou `ideia:`); cards não se apagam pelo canvas |
| Menu do card → Arquivar | só layout (`arquivados`). Botão direito no vazio → **Arquivados** abre um modal com os arquivados do canvas (abrir a nota, Desarquivar um ou todos; desarquivar põe em `visiveis`) |
| Menu → Mandar para a lixeira | `.trash/` do vault |
| `⌘Z` / `⌘⇧Z` | desfaz/refaz arrastar cards (só posição) |

Navegação: arrastar no vazio navega. **Botão Mouse/Trackpad** na barra (lembrado em `canvas-roda`): no Mac o mouse com
rolagem suave e o trackpad mandam o mesmo tipo de evento (medido: nada no evento separa os dois), então quem escolhe é o
Rodrigo. Modo trackpad: dois dedos movem, pinça dá zoom. Modo mouse: rolar dá zoom no cursor. Uma pinça volta sozinha
para o modo trackpad. O minimapa liga e desliga num botão da barra (começa desligado; `canvas-mapa`). **M** ou **T** alternam os dois modos. Os botões da barra de baixo mostram a dica (`data-dica`) depois de
0,3 s parado em cima; "mostrar tudo" saiu da barra (fica no duplo clique no vazio). Pinça, `⌘` + roda e
`⌘+` `⌘−` também dão zoom; `⌘A` seleciona todos os cards visíveis; `⌘` + arrastar faz caixa de seleção; `⌘` + clique põe/tira da seleção; duplo clique no vazio mostra tudo; botão do meio num card enquadra o card,
e dois cliques com ele fora de tudo mostram o canvas todo.

**Modo foco**: tecla **F** no canvas (ou o botão de cantos na barra) esconde navbar, breadcrumb, minimapa, pastas e a barra
de baixo, que deslizam para as bordas; a barra dos pinados fica (classe `modo-foco` no `.app`, em `App.tsx`); **Esc** volta.

## 6. As telas

A navbar do topo tem três grupos: **Canvas · Redação · Calendário · Skills** | **X · Sites · Instagram** | **Agendamento** (⌃1… na ordem; também ⌥1… e ⌘1…, mas no Chrome o ⌘1–8 é do navegador e não chega à página).
`⌘1…⌘6` trocam de página. A página atual fica no `localStorage`.

| Tela | Arquivo | O que faz |
|---|---|---|
| **Canvas** | `Canvas.tsx` | seção 5. À direita, as **pastas** do rodapé: Em edição, Agendado e Publicado |
| **Tabela** (das pastas) | `Tabela.tsx` | modal grande (90vh): contagem, destaque da pasta, média de palavras, barras por mês (filtram), filtros de formato/ano/canvas, busca, tabela ordenável (coluna Canvas). Clicar numa linha abre a copy com "← voltar" para a tabela |
| **Calendário** | `CalendarioEditorial.tsx` | as copies com `scheduled`; arrastar reagenda (grava `scheduled`). Arrastar no vazio de uma semana cria um bloco de planejamento tracejado (`planejamento.json`, não mexe em nota) |
| **X** e **Sites** | `Radar.tsx` | o radar (seção 8). X = feed "Para você"; Sites = GitHub, Hugging Face e Hacker News |
| **Redação** | `Redacao.tsx` | a tabela das copies (as mesmas abas, filtros e ações da tabela do canvas, `ModalTabela embutido`) com a nota aberta à direita, como no Obsidian (`PainelNota`), num card só, com uma divisória arrastável entre os dois lados (proporção em `redacao-largura`; duplo clique volta ao meio), e o botão 📅 Calendário: o `CalendarioEditorial` abre no lugar da nota e arrastar uma linha da tabela para um dia grava o `scheduled` (as linhas da tabela são arrastáveis com `raiz\0nome`). A Criação mostra as copies de todos os canvas. A tabela da Redação mostra só Copy, Versões, Status (seletor na célula: muda o status como o menu, com ⌘Z) e Data (campo de data na célula: grava o `scheduled` pela rota de agenda, `onData`) (as outras colunas ficam escondidas por CSS em `.tabela-embutida`). Abre com o cache de todas as notas (`tudoEmCache`) e, depois de uma mudança no vault, recarrega 1,5 s após a última (salvar a cada tecla travava a tabela). Guarda a nota aberta e se o calendário estava aberto (`redacao-aberta`, `redacao-calendario`) |
| **Instagram** | `Instagram.tsx` | canais monitorados e os Reels deles, com métricas relativas ao canal (seção 8) |
| **Agendamento** | `Calendario.tsx` | posts publicados e agendados do Instagram vindos do Metricool, com números (seção 8) |

### Sobrepostos a qualquer tela

- **Modal de nota** (`ModalNota.tsx`, 90vh): abre qualquer nota (ideia, copy, skill).
  - **1 clique num card do canvas abre a nota** (no chip de formato, aquela versão); ⌘/⇧ clique só seleciona; dois
    cliques também abrem. Clique fora ou Esc fecha.
  - Abas no topo: uma por saída da mesma ideia (pela chave `ideia:`, exista ou não a nota 💡), com o ponto de status.
    Quando a nota 💡 existe, "← 💡 Nome" volta para ela, e a ideia mostra as saídas e as entradas em botões.
    **+ Saída** cria a próxima versão num formato e abre o pedido ao Claude para escrevê-la (`pedidoSaida`).
  - Título clicável renomeia. "Mostrar no canvas" volta ao canvas principal, enquadra e seleciona o card
    (desligado se a nota está oculta lá). Lixeira com confirmação (`⌘⌫`). "Desligar da ideia", o chip do código (clique copia), ↗ "Abrir no Obsidian".
  - **Painel de propriedades** (`propriedades.ts`) no topo do editor, como no Obsidian: a primeira linha é o
    **status** (vem da pasta, não do YAML); tags em chips; datas com calendário; `publicado` em caixinha; texto em
    campo; × remove; "+ Adicionar propriedade". `scheduled` e `publicado` passam pelas ações do app (agendar, mover
    de pasta), não só pelo YAML.
  - **Editor** (`Editor.tsx` + `livePreview.ts`, CodeMirror 6): live preview do Obsidian (marcas só na linha do
    cursor), callouts, tarefas, `[[links]]` com `⌘` + clique. Salva 1 s depois de parar de digitar e com `⌘S`.
    `⌘I` manda o trecho selecionado (ou a nota) para a caixa de pedido ao Claude.
- **Busca rápida `⌘P`/`⌘O`** (`Paleta.tsx`): casa como o quick switcher do Obsidian em ideias, copies e skills; Enter
  abre no modal; sem resultado igual, oferece criar uma 💡 ideia com o texto digitado.
- **Porta do Claude** (`Pedido.tsx`), bolinha no canto inferior direito (verde = ouvindo): seção 9.
- **Breadcrumb** no topo (`App.tsx`, `.migalhas`): NEO-OBSIDIAN (todos os canvas) › canvas › vista aberta (pasta ou card
  em canvas próprio). Clicar num nível volta para ele; o canvas conta a vista pela prop `onCaminho`.

## 7. Processos do dia a dia

- **Ideia nova:** colar link/texto no canvas, botão direito → Nova ideia, 💡 num card do radar, ou o Claude Code
  pela API. Sempre em `0 Ideias/` com nome `💡 Título`.
- **Saída nova de uma ideia:** "+ Saída" no modal ou `canvas.criar_saida(ideia, formato)`: nasce em `1 Priorizar/`
  como `<formato> <título da ideia>` com `ideia: "[[💡 …]]"`. As saídas de uma ideia têm o mesmo nome; só muda o emoji
  (e um sufixo como "LP" ou "VSL" quando há duas do mesmo formato).
- **Andar no funil:** status no painel de propriedades do modal. Agendar = definir `scheduled` (e o status 🔹).
  Publicar = status Publicado (move a nota).
- **Agrupar copies que já existem:** soltar uma em cima da outra no canvas.
- **Juntar por tema:** um canvas (página inicial → Novo canvas) e botão direito nos cards → Mover para ›.
- **Tirar do caminho:** arquivar (some do canvas, nota intacta) ou lixeira (vai para `.trash/`).

## 8. Radar, X e Metricool

- **Coleta automática a cada 2 h** (`main.py`, `_coleta_automatica`): enquanto a API está de pé, roda `radar.coletar()`
  2 h depois do início da última coleta (uma coleta manual empurra a próxima). `GET /api/radar/estado` devolve `proxima`;
  o título do radar mostra no hover. Cada fonte traz o **top 50** (`TOPO` em `coletores/fontes.py`, `ALVO` em
  `coletores/x.py`): GitHub = trending do dia e da semana (a página só tem ~12 cada) completado com os repositórios
  criados nos últimos 7 dias com mais estrelas (API de busca); Hugging Face = 35 modelos + 15 spaces; Hacker News = as
  histórias das últimas 24 h por relevância. A do X abre o Chrome (e leva junto a fila de likes).
- **Coleta** (`radar.py`, botão "Atualizar" ou `uv run --directory app/backend python -m jarvis.radar`):
  GitHub Trending, Hugging Face, Hacker News (`coletores/fontes.py`, sem login) e o X (`coletores/x.py`).
  Os sinais vão para `dados/jarvis.db` (tabela `sinais`); o Haiku classifica o tipo e escreve o "por que importa".
- **X:** uma sessão do Agent SDK com `--chrome` (Claude in Chrome, no Chrome do Rodrigo já logado) rola o feed com um
  script e devolve o JSON como download em `~/Downloads` (o `javascript_tool` corta a saída em ~1 mil caracteres e
  bloqueia query strings). Com `tools=[]` é preciso desligar `ENABLE_TOOL_SEARCH` e `ENABLE_CLAUDEAI_MCP_SERVERS`, senão
  as ferramentas do Chrome ficam invisíveis.
- **Página do X = último lote.** Cada coleta do X passa ao script os ids já vistos (`db.externos_recentes`) e ele
  rola o feed até juntar posts **inéditos**; esses ganham `lote` = a hora da coleta (`db.gravar_sinais(..., lote=)`).
  São duas fases no mesmo script: os **50** inéditos do feed "Para você" (`ALVO`) e depois **50 de uma busca pelos temas**
  (`BUSCA`, com `min_faves:500` e `lang:en`, aba Mais recentes; `POPULARES`, `MIN_CURTIDAS`). O feed com 500+ era quase
  tudo fora do tema (futebol, política). O script troca para a busca com `history.pushState` + `popstate`, sem recarregar
  (o agente se perdia navegando para a URL longa). Os da busca vêm com `metricas.popular = true`. O lote do X é
  classificado logo depois da coleta dele, sem esperar o Instagram. A coleta do X leva uns 4 minutos.
  A página pede `?fonte=x&ultimo_lote=true`, então o Atualizar troca a tela inteira pelos próximos posts. Nada é
  apagado do SQLite: os curtidos de qualquer coleta ficam em **Curtidos** (`?status=curtido`, sem limite), com o link.
- **Ordem congelada** (`Radar.tsx`, `congelar`): cada card ganha um lugar quando chega e não sai dele; like e deslike
  não reordenam. A ordem recomeça ao trocar de filtro e quando uma coleta termina.
- **Cards:** 👍 ensina o ranking e guarda em **Curtidos** (filtro no topo; `status=curtido` na API); 👎 tira do feed e
  ensina o contrário (`preferencias.py`; "Reavaliar" refaz o interesse a partir de 3 votos); 💡 cria uma ideia com
  título, link, imagem e texto do card (`pronto` em `/api/canvas/entrada`) no Inbox; ◉ manda o card ao Claude (`RAD-<id>`).
- **Botão direito num card** (tweet ou site) → "Adicionar ao canvas" com a lista dos canvas (`MenuAdicionar`): cria a
  mesma 💡 ideia, mandando `X-Canvas` do canvas escolhido (a nota nasce com o `grupo:` dele). Com texto selecionado fica o
  menu do navegador.
- **Perfil "Claude Profile" do Chrome** (`CHROME_PERFIL` em `config.py`, lido de `app/dados/chrome.json`: o deviceId da extensão nele): X e Instagram do
  radar rodam só nele (cada sessão do SDK chama `select_browser` antes de tudo), longe do Chrome do dia a dia. X logado
  como @RTadewald; Instagram como **teste.asimov**, a conta própria do radar. Se a extensão for reinstalada, o id muda
  (`list_connected_browsers`).
  Se o perfil estiver fechado (a sessão responde SEM_PERFIL), `config.com_perfil` abre o Chrome nele
  (`open -na "Google Chrome" --args --profile-directory=<pasta>`; a pasta vem do Local State pelo nome "Claude Profile"),
  espera 12 s a extensão conectar e tenta de novo. Não precisa deixar o perfil aberto.
- **Instagram: canais monitorados** (`instagram_canais.py`, `Instagram.tsx`, aba Instagram, 19/11/2026). Duas vistas:
  **Canais** (cadastro à mão: @, link ou vários separados por espaço; card com foto, seguidores, nº de reels e mediana de
  views; × para de acompanhar e apaga os arquivos) e **Vídeos** (grade 9:16 com outlier = views ÷ mediana do canal,
  views e engajamento = (curtidas + comentários) ÷ views; filtros de canal, data, outlier mínimo e ordem, guardados no
  `localStorage`; clicar abre o player com o MP4 baixado). Botão **Atualizar** → `POST /api/ig/atualizar` (segundo plano,
  `GET /api/ig/estado`). Coleta: um agente (Sonnet) abre o Chrome "Claude Profile" (conta teste.asimov) e, para cada
  canal, navega a `/<canal>/reels/` e roda `SCRIPT`: lê seguidores e foto do og: da página do perfil, intercepta as
  respostas que a página busca (a grade traz views/curtidas/comentários/capa; abrir um reel na própria página, com clique
  e `history.back`, traz legenda, `taken_at`, duração e `video_versions`) e baixa `neo-igc-<prefixo>-<canal>.json` em
  ~/Downloads. A API `/api/v1/users/web_profile_info` e `/api/v1/feed/user` dão 404 nessa conta: não use. Depois o
  backend baixa fotos, capas e MP4 (`dados/ig/{fotos,capas,videos}`; os links do Instagram expiram). `POR_CANAL = 24`
  (os mais recentes, fixados incluídos); ~180 MB por canal. Dados: `dados/ig/canais.json` e `dados/ig/videos.json`.
  Rotas: `GET/POST /api/ig/canais`, `DELETE /api/ig/canais/{handle}`, `GET /api/ig/videos`, `GET /api/ig/arquivo/{tipo}/{nome}`.
  As listas vêm com `cache: 'no-store'` (o Chrome guardava a resposta em HTML de quando o Vite estava subindo).
- **Feed do Instagram no radar (desligado)**: `COLETAR_FEED_IG = False` em `radar.py`. **Instagram** (`coletores/instagram_radar.py`, aba Instagram; o `coletores/instagram.py` é outro: os Reels do próprio @rodrigotadewald para o Metricool): roda junto com a coleta do X. Duas fontes: a grade de Reels
  de cada perfil acompanhado (`app/dados/instagram_perfis.json`; começou com mavgpt, heysirio, filatov.design,
  marina_uiux, nick_saraev, que a conta segue) e a página /reels/ da conta (o algoritmo sugere; card com "sugerido").
  Para cada Reel inédito, a página `/p/<código>/` dá curtidas, comentários, data e legenda (meta `og:description`).
  Da grade, só os dos últimos 21 dias (ela começa pelos fixados); os perfis vêm antes do algoritmo no corte de 50.
  Reel com legenda em português (`_brasileiro`) fica de fora: a referência é conteúdo gringo.
  Fonte: **o algoritmo** (/reels/). A conta é treinada com 👍 no app (o like vai ao Instagram) e o feed vai melhorando.
  Meta: os **50 primeiros Reels com 1k+ curtidas** (`ALVO`, `MIN_CURTIDAS`), no máximo 3 do mesmo autor (`POR_PERFIL`):
  o script rola o /reels/ avaliando de 4 em 4 até juntar 50 + 8 de folga (`MARGEM`, para o filtro de português) ou 320
  rolagens (`ROLAGENS`). A grade dos perfis acompanhados só entra com `USAR_PERFIS = True` (desligado).
  O Haiku classifica como os outros, e "fora do tema" não aparece. A aba mostra o último lote, como o X.
- **Like espelhado no X** (`coletores/x_curtir.py`): 👍 num post do X ou num Reel do Instagram grava `x_quer=1` no SQLite (fila; o like vai para a rede de origem: no
  Instagram, o coração de 24 px da página `/p/<código>/`). A fila só vai ao
  X **junto com a coleta do X** (`radar.coletar` chama `x_curtir.espelhar()` antes de rolar o feed), porque o Claude in
  Chrome sempre abre uma janela nova: assim ela aparece uma vez por coleta, não a cada like (não há como abrir em segundo
  plano). Abre cada post no Chrome logado e clica no coração **só se o estado for diferente do pedido**, depois confere.
  Tirar o like descurte (`x_quer=0`) se já tinha sido curtido lá. O ponto no
  canto do 👍 mostra: piscando = na fila (vai na próxima coleta), azul = feito, vermelho = erro (`x_erro`; clicar de novo tenta outra vez).
  Não reposta, não segue, não responde. Para testar sem curtir nada, tire o `.click()` do script (cuidado: tire
  `unlike.click()` antes de `like.click()`, ou a troca corta a palavra ao meio).
- **Metricool** (`metricool.py`, `anuncios.py`): sessões do SDK que herdam o conector Metricool da conta e só podem
  chamar ferramentas de **leitura** (`can_use_tool` nega agendar e editar). Posts e miniaturas vão para o SQLite e
  `dados/thumbs` (os links do Instagram expiram).

## 9. A porta para o Claude Code (`porta.py`, `porta.ts`, `Pedido.tsx`)

O chat do Jarvis saiu (18/11/2026). Tudo acontece no Claude Code do terminal, que mexe nas notas direto e usa o app
pela API; o app é a porta para falar com ele. Modelo copiado do Neo Stitch.

- **Códigos.** Cada nota do canvas (Priorizar, Publicados, Ideias, Entradas) tem `codigo: NEO-042` no frontmatter:
  sequencial, nunca reaproveitado, contador em `dados/codigos.json`. Nota nova nasce com código (`notas._escrever`
  carimba arquivo novo); nota criada fora do app (Obsidian, Claude) ganha no vigia; na subida da API, `garantir_codigos`
  completa as que faltam sem mudar o mtime. Sinais do radar são `RAD-<id>` (derivado, não gravado).
  - No app: chip do código em todo card (clique copia). Card 🎬 com várias versões mostra o da primeira e "+N"; o clique
    copia os de todas as versões (também no botão direito → "Copiar códigos"). Chip na barra do modal.
  - **Para o Claude achar a nota:** `curl -s localhost:8740/api/codigo/NEO-042` (raiz, nome, caminho, texto) ou
    `grep -rl "^codigo: NEO-042" "/Users/rtadewald/Obsidian Notes/1 Copies"`.
- **Fila de pedidos.** A bolinha do canto (⌘J), "Mandar ao Claude" no menu do card, `⌘I` no
  editor e no foco do radar abrem a caixa de pedido com os anexos (códigos, trecho com linhas). Enviar (⌘↵) faz
  `POST /api/fila` → uma linha em `dados/fila.jsonl` (`ts, texto, codigos, trecho, onde`). Sem ninguém ouvindo, o pedido
  vai para a área de transferência, pronto para colar no terminal.
  - **O Claude escuta** com `Monitor(command: "<repo>/app/ouvir.sh", timeout_ms: 1800000)` e rearma a cada 30 min.
    O script faz `tail -n0 -F` da fila e toca `dados/.ouvinte` a cada 20 s; com o arquivo recente (< 60 s) a bolinha
    fica verde (evento `porta` no SSE).
- **Eventos (`GET /api/eventos`, SSE).** `mudou`: o vigia (`porta.vigiar_vault`, a cada 1,5 s) viu nota criada, editada,
  movida ou apagada; o canvas e a nota aberta recarregam (a nota só se não houver edição pendente). `tela`: o Claude mexe
  na tela com `POST /api/tela` `{acao, pagina?, canvas?, raiz?, nome?, codigo?}`; ações `pagina`, `abrir_canvas`,
  `mostrar` (vai ao card e seleciona; com `codigo` no lugar de raiz + nome), `abrir_nota`, `fechar_nota`, `foco`.
- **Onde o Rodrigo está:** o app manda (`porta.vigiarOnde`, de segundo em segundo, só quando muda) tela, canvas, vista,
  filtros, cards selecionados com código e nota aberta com código; o Claude lê em `GET /api/onde`.
- O radar e o Metricool continuam usando o SDK do Claude por conta própria (`radar.py`, `coletores/`, `metricool.py`).

## 10. API (FastAPI, `app/backend/src/jarvis/main.py`)

| Rota | Para quê |
|---|---|
| `GET /api/canvas` | estado do canvas do `X-Canvas`: ideias, entradas, produções (cada uma com `canvas`), posições, arquivados, visíveis, produtos, formatos |
| `GET/POST /api/canvases` · `DELETE /api/canvases/{slug}` · `GET /api/produtos` | lista com contagens · criar/renomear canvas · apagar (notas voltam ao Inbox) · produtos |
| `POST /api/canvas/ideia` · `entrada` · `saida` | criar 💡 ideia · ideia a partir de link/texto (ou `pronto` do radar) · saída de uma ideia |
| `POST /api/canvas/ligar` · `agrupar` · `fonte` | `ideia:` numa copy · mesmo `ideia:` em várias · `fontes:` numa ideia |
| `POST /api/canvas/mover` · `produto` · `importar` | levar cards para outro canvas (`grupo:`) · tag de produto · ⌘↵ da busca |
| `PUT /api/canvas/posicoes` · `POST /api/canvas/arquivar` | layout |
| `GET/PUT /api/canvas/desenho` | a camada de desenho (Excalidraw) do canvas do `X-Canvas` |
| `GET/PUT /api/notas/{raiz}/{nome}` | ler · salvar (com `mtime`; conflito se mudou por fora) |
| `POST /api/notas/{raiz}/{nome}/acao` | `mover` · `status` · `renomear` · `lixeira` (leva a posição do canvas junto) |
| `POST /api/notas/{raiz}/{nome}/agenda` · `GET /api/notas/agenda` | `scheduled` · calendário editorial |
| `POST /api/notas/priorizar` · `GET /api/notas-indice` | copy nova · índice da busca `⌘P` |
| `GET /api/sinais` · `POST /api/sinais/{id}/voto` | radar (`?status=curtido`) · like/deslike (dispara o like no X) |
| `POST /api/radar/atualizar` · `reavaliar` · `GET /api/radar/estado` | coleta e ranking |
| `GET /api/eventos` · `POST /api/tela` · `GET/POST /api/onde` | a porta: SSE (mudou, tela, porta) · o Claude mexe na tela · onde o Rodrigo está |
| `GET /api/codigo/{NEO-042 ou RAD-1}` · `POST /api/fila` | nota (ou sinal) de um código · pedido para o Claude Code |
| `GET /api/calendario` · `POST /api/calendario/sincronizar` · `/api/ads…` · `/api/planejamento…` | Metricool e planejamento |

`raiz` é `priorizar`, `publicados`, `ideias`, `entradas` ou `skills` (`notas.RAIZES`; no front, `notas.ts`).

## 11. Mapa dos arquivos

```
app/neo-obsidian.sh           o comando (sobe, para, abre)
app/ouvir.sh                  o Claude Code escuta a fila de pedidos (Monitor)
app/backend/src/jarvis/
  main.py                     rotas
  config.py                   VAULT, APP, DADOS (o caminho do vault é fixo aqui)
  notas.py                    status, mover, renomear (+ links), lixeira, agenda, pins do Obsidian
  canvas.py                   ideias, produções, canvas e produtos, layout, mídia dos cards
  porta.py                    códigos das notas, fila de pedidos, eventos SSE, vigia do vault, onde
  radar.py · preferencias.py · db.py · coletores/{fontes,x,x_curtir}.py   radar e like no X
  metricool.py · anuncios.py · planejamento.py · youtube.py · videos_x.py · auth.py
app/frontend/src/
  App.tsx                     navbar, breadcrumb, páginas, modal, busca, eventos da porta
  Desenho.tsx                 camada de desenho (Excalidraw) sincronizada com o canvas
  Canvas.tsx                  canvas, cards, filtros, pastas, menus, gestos (função montar = quem aparece)
  Tabela.tsx · ModalNota.tsx · Paleta.tsx · Pedido.tsx · porta.ts · Radar.tsx · CalendarioEditorial.tsx · Calendario.tsx
  Editor.tsx · livePreview.ts · propriedades.ts   o editor no jeito do Obsidian
  canvasApi.ts · api.ts · notas.ts                tipos e chamadas; notas.ts = raízes, pastas, link do Obsidian
  index.css                   todo o CSS (tokens no topo)
```

`Desempenho.tsx` não está mais na navbar. Saíram de vez: a página Ideias, a página Skills e o orbe com o leque de
skills (as skills seguem abrindo no modal pela busca `⌘P`). Não traga de volta sem pedido.

## 12. Armadilhas conhecidas

- **"Entrada"** ainda existe no código (`0 Ideias/Entradas/`, `fontes:`, card `e:`), mas o
  fluxo atual cria tudo como 💡 ideia. Não crie entradas novas; ao mexer, prefira convergir para ideia.
- **Nome com sufixo " 2"**: `_livre` evita colisão acrescentando um número. Se aparecer, foi colisão de nome.
- **Modo dev é lento:** o `neo-obsidian` roda o front pelo Vite em modo de desenvolvimento. Arrastar um card custa ~28 ms
  por movimento em dev e ~13 ms no build de produção (`npm run build`, servido pelo backend em http://localhost:8740).
- **Browser pane escondido** (testes pelo painel do app): `requestAnimationFrame` e `ResizeObserver` param, então
  `node.measured` do React Flow fica indefinido e animações de pan não rodam. Use `rf.getInternalNode` e não conclua
  que "não funciona" só por isso.
- **Aba antiga sobrescreve layout:** uma aba aberta com estado velho pode gravar posições por cima. Recarregue antes de
  arrastar coisas em teste.
- **CSS do React Flow ganha em especificidade:** para estilizar alças e linhas do `NodeResizer`, use
  `.react-flow .react-flow__resize-control.<classe>`. O `autoScale` já compensa o zoom nas alças; não escale de novo.

## 13. Onde ler mais

| Para | Leia |
|---|---|
| decisões e escopo (as Q do código) | [specs.md](specs.md) |
| visão geral e instalação | [README.md](README.md) |
| convenções do vault (emojis, templates, links, frontmatter) | `CLAUDE.md` na raiz do vault |
