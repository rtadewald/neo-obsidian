# Neo-Obsidian — guia para agentes

Leia este arquivo inteiro antes de mexer em qualquer coisa. Ele descreve o que o app é, como os dados vivem no vault,
o que cada tela faz e quais regras não se quebram. O que estiver aqui é regra; se o código discordar, o código vale e
este arquivo precisa ser corrigido no mesmo commit.

## 1. O que é

O Neo-Obsidian é um app web local por cima do vault do Obsidian do Rodrigo (`/Users/rtadewald/Obsidian Notes`).
Ele não tem banco de notas próprio: **lê e escreve os mesmos `.md` do vault**. Por cima deles monta um canvas em que
cada 💡 ideia de conteúdo é um card e as produções dela (📱 Reels, 💰 Ad, 🏞️ Carrossel, 📺 VSL…) se penduram nela.
Ao lado, um chat com o Claude Code (o "Jarvis") que roda dentro do vault, com as skills de copy.

- `app/backend/` — FastAPI em Python 3.12, rodado com `uv` (porta **8740**). O pacote Python ainda se chama `jarvis`
  (nome antigo do projeto); não renomeie.
- `app/frontend/` — Vite + React 19 + TypeScript + React Flow 12 (`@xyflow/react`) + CodeMirror 6 (porta **5180**,
  repassa `/api` para a 8740).
- `app/dados/` — o estado que não é nota: SQLite do radar, layout do canvas, miniaturas. **Fora do git.**
- `specs.md` — decisões e escopo (as "Q" citadas no código, como Q9, Q27, Q30, estão lá).
- `wireframes/` — os `.wf` da fase de desenho. `prototipos/` e `design-systems/` ficam fora do git.

## 2. As regras

1. **O vault é a fonte da verdade.** Status, formato, ideia, caixa: tudo está no nome do arquivo, na pasta ou no
   frontmatter da nota. O app só deriva. Nunca guarde em `app/dados/` algo que o Obsidian precisaria saber.
2. **Escreva no vault pelas funções do backend** (`notas.py`, `canvas.py`), não com `open().write()` solto. Elas
   escrevem de forma atômica (`notas._escrever`: arquivo temporário + `os.replace`), mantêm os `[[links]]`, os pins
   do Obsidian e as posições do canvas em ordem.
3. **Nunca leia e escreva o mesmo arquivo na mesma expressão.** `open(p, "w").write(open(p).read() …)` trunca o arquivo
   antes de ler e já apagou uma nota real. Leia, guarde em variável, depois escreva. Em operação em lote no vault,
   faça backup antes (no scratchpad) e confira o diff.
4. **Nada se apaga de verdade.** Apagar uma nota manda para `.trash/` do vault (a lixeira do Obsidian), via
   `notas.para_lixeira`. Caixa apagada só sai do layout; as notas continuam.
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
3 Skills/<nome>/SKILL.md   as skills (o chat usa; o modal abre e edita)
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
| `grupo` | ideia ou copy | nome da **caixa** do canvas onde o card está |
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

| Card | Id | De onde vem |
|---|---|---|
| 💡 **ideia** | `i:<nome>` | uma nota em `0 Ideias/` |
| 🎬 **produção (grupo)** | `g:<nome da ideia>` | as copies com o mesmo `ideia:`; um card só com um chip por formato |
| **copy solta** | `p:<raiz>/<nome>` | copy sem `ideia:` (ou com uma ideia que só tem ela) |
| **caixa** | `c:<id>` | retângulo colorido em `app/dados/canvas.json` → `caixas` |
| entrada (legado) | `e:<nome>` | nota em `0 Ideias/Entradas/` |

- **O grupo 🎬 não precisa de nota 💡.** Basta duas ou mais copies com o mesmo `ideia: "[[💡 X]]"`, mesmo que
  `💡 X.md` não exista. Com uma copy só e sem a nota, ela fica solta. Com a nota 💡, a ideia vira card próprio e uma
  seta liga a ideia ao grupo.
- **O card de grupo abre sempre no 📱 Reels** quando há um (entre vários Reels, o que está para sair).
- **Caixa = `grupo:` nas notas.** Soltar um card dentro de uma caixa grava `grupo: "<nome da caixa>"` na nota (ou em
  todas as saídas do grupo); tirar apaga a chave. Renomear a caixa reescreve o `grupo` de todas as notas de dentro.
  Arquivar a caixa esconde a caixa e tudo que tem dentro do canvas principal.

### `app/dados/canvas.json`

```json
{ "pos": { "i:💡 Nome": {"x": 0, "y": 0}, "edicao|p:priorizar/…": {…} },
  "arquivados": ["p:priorizar/…"],
  "caixas": [{ "id": "cx…", "nome": "Skills", "cor": "#f6e3b4", "x": 0, "y": 0, "w": 720, "h": 460, "arquivada": false }] }
```

A posição no canvas principal e no canvas de uma caixa usa o id puro; nas outras vistas, `<vista>|<id>`. Quando uma
nota muda de nome ou de pasta pela API de ação, `canvas.renomeou` leva a posição junto. **Se você renomear ou mover
uma nota por fora do app, migre a chave em `pos` também**, senão o card perde o lugar.

### O que aparece no canvas principal

- Arquivado à mão (menu → Arquivar) não aparece.
- **Copy publicada conta como arquivada**, a não ser que esteja numa caixa ativa (`grupo` = nome de caixa não
  arquivada). Ideia aparece se não tem saída ou se alguma saída está viva.
- O seletor no topo filtra: Todos, Backlog, Em edição, Agendado.
- Vistas (`Visao` em `Canvas.tsx`): `principal`, `caixa:<id>` (o canvas próprio da caixa), `foco:<id>` (um card e
  tudo que está ligado a ele), além de `edicao`, `agendado` e `pub-<ano>`. A barra lateral guarda as vistas pinadas e
  o histórico.

### Gestos e o que cada um grava

| Gesto no canvas | Efeito no vault |
|---|---|
| Colar (`⌘V`) um link ou texto no vazio | nova 💡 ideia com o material (`POST /api/canvas/entrada`; YouTube é transcrito, página é lida) |
| Botão direito → Nova ideia | `💡 Nome.md` em `0 Ideias/` |
| Botão direito → Nova copy solta | copy em `1 Priorizar/` com o template |
| Botão direito → Nova caixa | só layout |
| Soltar uma copy em cima de uma ideia/grupo | `ideia: "[[…]]"` na copy (`/api/canvas/ligar`) |
| Soltar uma copy em cima de outra copy | pergunta o nome e grava o mesmo `ideia:` nas duas (`/api/canvas/agrupar`; não cria nota 💡) |
| Ligar pelas alças (arrastar de uma borda a outro card) | o mesmo que soltar em cima |
| Soltar dentro/fora de uma caixa | `grupo:` na nota |
| `Delete` numa linha | desfaz a ligação (tira `fontes:` ou `ideia:`); cards não se apagam pelo canvas |
| Menu do card → Arquivar | só layout (`arquivados`) |
| Menu → Mandar para a lixeira | `.trash/` do vault |
| `⌘Z` / `⌘⇧Z` | desfaz/refaz movimentos de cards (só layout) |

Navegação (igual ao Neo Stitch): arrastar no vazio navega; scroll/pinça/`⌘+` `⌘−` dão zoom; `⌘` + arrastar faz caixa
de seleção; `⌘` + clique põe/tira da seleção; duplo clique no vazio mostra tudo; botão do meio num card enquadra.
A caixa se arrasta inteira e redimensiona pelos cantos (alça grande e invisível, ponto pequeno visível).

## 6. As telas

A navbar do topo tem três grupos: **Canvas · Calendário** | **X · Sites · Instagram** | **Agendamento**.
`⌘1…⌘6` trocam de página. A página atual fica no `localStorage`.

| Tela | Arquivo | O que faz |
|---|---|---|
| **Canvas** | `Canvas.tsx` | seção 5. À direita, as **pastas flutuantes** Em edição, Agendado, Publicado e Caixas |
| **Tabela** (das pastas) | `Tabela.tsx` | modal grande (90vh): contagem, destaque da pasta, média de palavras, barras por mês (filtram), filtros de formato/ano/caixa, busca, tabela ordenável. Clicar numa linha abre a copy com "← voltar" para a tabela. Aba **Caixas**: todas as caixas com contagens e Arquivar/Desarquivar |
| **Calendário** | `CalendarioEditorial.tsx` | as copies com `scheduled`; arrastar reagenda (grava `scheduled`). Arrastar no vazio de uma semana cria um bloco de planejamento tracejado (`planejamento.json`, não mexe em nota) |
| **X** e **Sites** | `Radar.tsx` | o radar (seção 8). X = feed "Para você"; Sites = GitHub, Hugging Face e Hacker News |
| **Instagram** | `EmBreve.tsx` | ainda não existe |
| **Agendamento** | `Calendario.tsx` | posts publicados e agendados do Instagram vindos do Metricool, com números (seção 8) |

### Sobrepostos a qualquer tela

- **Modal de nota** (`ModalNota.tsx`, 90vh): abre qualquer nota (ideia, copy, skill).
  - Abas no topo: uma por saída da mesma ideia (pela chave `ideia:`, exista ou não a nota 💡), com o ponto de status.
    Quando a nota 💡 existe, "← 💡 Nome" volta para ela, e a ideia mostra as saídas e as entradas em botões.
    **+ Saída** cria a próxima versão num formato e pede ao Jarvis para escrevê-la (`pedidoSaida`).
  - Título clicável renomeia. "Mostrar no canvas" volta ao canvas principal, enquadra e seleciona o card
    (desligado se a nota está oculta lá). Lixeira com confirmação (`⌘⌫`). "Desligar da ideia", "Perguntar ao
    Jarvis", ↗ "Abrir no Obsidian".
  - **Painel de propriedades** (`propriedades.ts`) no topo do editor, como no Obsidian: a primeira linha é o
    **status** (vem da pasta, não do YAML); tags em chips; datas com calendário; `publicado` em caixinha; texto em
    campo; × remove; "+ Adicionar propriedade". `scheduled` e `publicado` passam pelas ações do app (agendar, mover
    de pasta), não só pelo YAML.
  - **Editor** (`Editor.tsx` + `livePreview.ts`, CodeMirror 6): live preview do Obsidian (marcas só na linha do
    cursor), callouts, tarefas, `[[links]]` com `⌘` + clique. Salva 1 s depois de parar de digitar e com `⌘S`.
    `⌘I` manda o trecho selecionado (ou a nota) ao chat.
- **Busca rápida `⌘P`/`⌘O`** (`Paleta.tsx`): casa como o quick switcher do Obsidian em ideias, copies e skills; Enter
  abre no modal; sem resultado igual, oferece criar uma 💡 ideia com o texto digitado.
- **Chat do Jarvis** (`Chat.tsx`), coluna da direita, redimensionável: seção 9.
- **Orbe** (canto inferior esquerdo, `Menu.tsx`): o leque com as skills de `3 Skills/` (abrem no modal), "Todas as
  skills" (abre a busca) e Config.

## 7. Processos do dia a dia

- **Ideia nova:** colar link/texto no canvas, botão direito → Nova ideia, 💡 num card do radar, ou o chat
  (`criar_ideia`). Sempre em `0 Ideias/` com nome `💡 Título`.
- **Saída nova de uma ideia:** "+ Saída" no modal ou `canvas.criar_saida(ideia, formato)`: nasce em `1 Priorizar/`
  como `<formato> <título da ideia>` com `ideia: "[[💡 …]]"`. As saídas de uma ideia têm o mesmo nome; só muda o emoji
  (e um sufixo como "LP" ou "VSL" quando há duas do mesmo formato).
- **Andar no funil:** status no painel de propriedades do modal. Agendar = definir `scheduled` (e o status 🔹).
  Publicar = status Publicado (move a nota).
- **Agrupar copies que já existem:** soltar uma em cima da outra no canvas.
- **Juntar por tema:** caixa (botão direito → Nova caixa) e arrastar os cards para dentro.
- **Tirar do caminho:** arquivar (some do canvas, nota intacta) ou lixeira (vai para `.trash/`).

## 8. Radar, X e Metricool

- **Coleta** (`radar.py`, botão "Atualizar" ou `uv run --directory app/backend python -m jarvis.radar`):
  GitHub Trending, Hugging Face, Hacker News (`coletores/fontes.py`, sem login) e o X (`coletores/x.py`).
  Os sinais vão para `dados/jarvis.db` (tabela `sinais`); o Haiku classifica o tipo e escreve o "por que importa".
- **X:** uma sessão do Agent SDK com `--chrome` (Claude in Chrome, no Chrome do Rodrigo já logado) rola o feed com um
  script e devolve o JSON como download em `~/Downloads` (o `javascript_tool` corta a saída em ~1 mil caracteres e
  bloqueia query strings). Com `tools=[]` é preciso desligar `ENABLE_TOOL_SEARCH` e `ENABLE_CLAUDEAI_MCP_SERVERS`, senão
  as ferramentas do Chrome ficam invisíveis.
- **Cards:** 👍 ensina o ranking e guarda em **Curtidos** (filtro no topo; `status=curtido` na API); 👎 tira do feed e
  ensina o contrário (`preferencias.py`; "Reavaliar" refaz o interesse a partir de 3 votos); 💡 cria uma ideia com
  título, link, imagem e texto do card (`pronto` em `/api/canvas/entrada`); ◉ leva o card ao chat.
- **Like espelhado no X** (`coletores/x_curtir.py`): 👍 num post do X grava `x_quer=1` no SQLite; um trabalhador em
  segundo plano junta os pedidos (4 s), abre cada post no Chrome logado e clica no coração **só se o estado for
  diferente do pedido**, depois confere. Tirar o like descurte (`x_quer=0`) se já tinha sido curtido lá. O ponto no
  canto do 👍 mostra: piscando = indo, azul = feito, vermelho = erro (`x_erro`; clicar de novo tenta outra vez).
  Não reposta, não segue, não responde. Para testar sem curtir nada, tire o `.click()` do script (cuidado: tire
  `unlike.click()` antes de `like.click()`, ou a troca corta a palavra ao meio).
- **Metricool** (`metricool.py`, `anuncios.py`): sessões do SDK que herdam o conector Metricool da conta e só podem
  chamar ferramentas de **leitura** (`can_use_tool` nega agendar e editar). Posts e miniaturas vão para o SQLite e
  `dados/thumbs` (os links do Instagram expiram).

## 9. O chat (Jarvis) e o modo construtor

- `agente.py`: uma sessão do Claude Code por conversa, retomada a cada mensagem, com o login da assinatura (Q9).
- **Modo vault** (padrão): `cwd` = o vault, com o `CLAUDE.md` e as skills dele. Lê tudo, mas **escreve sozinho só em
  `1 Copies/0 Ideias/` e `1 Copies/1 Priorizar/`**: um hook `PreToolUse` nega Write/Edit fora delas (Q30). Sem Bash.
  Ferramentas próprias (MCP `jarvis`): `criar_ideia`, `criar_saida`, `ligar_ao_canvas`, `criar_entrada`,
  `posicionar`, `transcrever_youtube`. Prefira-as a escrever frontmatter à mão.
- Mensagens que o app monta: `📡 Sinal do radar · fonte · autor · url` + linhas `> …` (o card em foco) e
  `📎 [[nota]] · linhas X–Y · caminho` + linhas `> …` (o trecho do editor, `⌘I`).
- **Modo construtor** (botão no chat): o mesmo chat mexe no código de `app/` enquanto o Rodrigo usa. Antes de cada
  pedido, `construtor.py` guarda um ponto de restauração (commit solto do git, com índice temporário; não toca no
  histórico) e o chat ganha "Desfazer". Não escreve em `app/dados/`.

## 10. API (FastAPI, `app/backend/src/jarvis/main.py`)

| Rota | Para quê |
|---|---|
| `GET /api/canvas` | estado do canvas: ideias, entradas, produções, posições, arquivados, caixas, formatos |
| `POST /api/canvas/ideia` · `entrada` · `saida` | criar 💡 ideia · ideia a partir de link/texto (ou `pronto` do radar) · saída de uma ideia |
| `POST /api/canvas/ligar` · `agrupar` · `fonte` | `ideia:` numa copy · mesmo `ideia:` em várias · `fontes:` numa ideia |
| `POST /api/canvas/grupo` · `caixa` · `DELETE /api/canvas/caixa/{id}` | `grupo:` nas notas · criar/editar caixa · apagar caixa |
| `PUT /api/canvas/posicoes` · `POST /api/canvas/arquivar` | layout |
| `GET/PUT /api/notas/{raiz}/{nome}` | ler · salvar (com `mtime`; conflito se mudou por fora) |
| `POST /api/notas/{raiz}/{nome}/acao` | `mover` · `status` · `renomear` · `lixeira` (leva a posição do canvas junto) |
| `POST /api/notas/{raiz}/{nome}/agenda` · `GET /api/notas/agenda` | `scheduled` · calendário editorial |
| `POST /api/notas/priorizar` · `GET /api/notas-indice` | copy nova · índice da busca `⌘P` |
| `GET /api/sinais` · `POST /api/sinais/{id}/voto` | radar (`?status=curtido`) · like/deslike (dispara o like no X) |
| `POST /api/radar/atualizar` · `reavaliar` · `GET /api/radar/estado` | coleta e ranking |
| `POST /api/chat` · `GET /api/construtor` · `POST /api/construtor/desfazer` | chat e modo construtor |
| `GET /api/calendario` · `POST /api/calendario/sincronizar` · `/api/ads…` · `/api/planejamento…` | Metricool e planejamento |

`raiz` é `priorizar`, `publicados`, `ideias`, `entradas` ou `skills` (`notas.RAIZES`; no front, `notas.ts`).

## 11. Mapa dos arquivos

```
app/neo-obsidian.sh           o comando (sobe, para, abre)
app/backend/src/jarvis/
  main.py                     rotas
  config.py                   VAULT, APP, DADOS (o caminho do vault é fixo aqui)
  notas.py                    status, mover, renomear (+ links), lixeira, agenda, pins do Obsidian
  canvas.py                   ideias, produções, grupos, caixas, layout, mídia dos cards
  agente.py · construtor.py   chat (vault e construtor) e pontos de restauração
  radar.py · preferencias.py · db.py · coletores/{fontes,x,x_curtir}.py   radar e like no X
  metricool.py · anuncios.py · planejamento.py · youtube.py · videos_x.py · skills.py · auth.py
app/frontend/src/
  App.tsx                     navbar, páginas, modal, busca, chat, orbe
  Canvas.tsx                  canvas, cards, caixas, pastas, menus, gestos (função montar = quem aparece)
  Tabela.tsx · ModalNota.tsx · Paleta.tsx · Chat.tsx · Radar.tsx · CalendarioEditorial.tsx · Calendario.tsx · Menu.tsx
  Editor.tsx · livePreview.ts · propriedades.ts   o editor no jeito do Obsidian
  canvasApi.ts · api.ts · notas.ts                tipos e chamadas; notas.ts = raízes, pastas, link do Obsidian
  index.css                   todo o CSS (tokens no topo)
```

`Skills.tsx`, `Desempenho.tsx` e `Ideias` não estão mais na navbar (a página Ideias foi removida; as skills abrem no
modal). Não traga de volta sem pedido.

## 12. Armadilhas conhecidas

- **"Entrada"** ainda existe no código e nas instruções do chat (`0 Ideias/Entradas/`, `fontes:`, card `e:`), mas o
  fluxo atual cria tudo como 💡 ideia. Não crie entradas novas; ao mexer, prefira convergir para ideia.
- **Nome com sufixo " 2"**: `_livre` evita colisão acrescentando um número. Se aparecer, foi colisão de nome.
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
