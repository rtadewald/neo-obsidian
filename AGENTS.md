# Neo-Obsidian — guia para agentes

Leia este arquivo inteiro antes de mexer em qualquer coisa. Ele descreve o que o app é, como os dados vivem no vault,
o que cada tela faz e quais regras não se quebram. O que estiver aqui é regra; se o código discordar, o código vale e
este arquivo precisa ser corrigido no mesmo commit.

## 1. O que é

O Neo-Obsidian é um app web local por cima do vault do Obsidian do Rodrigo (`/Users/rtadewald/Obsidian Notes`).
Ele não tem banco de notas próprio: **lê e escreve os mesmos `.md` do vault**. A tela principal é a **Redação**
(seção 5): uma tabela das copies com a nota aberta ao lado, em abas, como no Obsidian.

> **Histórico.** Até 18/11/2026 havia 💡 ideias separadas; viraram copies. Em 19/11/2026 saíram o **Canvas** inteiro
> (mapa mental, canvas, layout, desenho, o `grupo:` das notas), o agrupamento de versões (🎬, `ideia:`, que saiu de todas as copies), os códigos
> `NEO-###` e o chat do Jarvis (o chat voltou na mesma noite, sem canvas: seção 9). O que restar desses nomes no código é legado. Backups: `backups-locais/` (fora do git)
> e o commit `96020d1`.

O app não tem IA dentro: ele é a **porta para o Claude Code** que roda no terminal (seção 9). O Rodrigo fala com o
Claude no terminal, citando a nota pelo nome; o Claude mexe nas notas e na tela pela API.

- `app/backend/` — FastAPI em Python 3.12, rodado com `uv` (porta **8740**). O pacote Python ainda se chama `jarvis`
  (nome antigo do projeto); não renomeie.
- `app/frontend/` — Vite + React 19 + TypeScript + CodeMirror 6 (porta **5180**,
  repassa `/api` para a 8740).
- `app/dados/` — o estado que não é nota: SQLite do radar, `criacao.json` (cor e ordem da Criação), Instagram, miniaturas. **Fora do git.**
- `specs.md` — decisões e escopo (as "Q" citadas no código, como Q9, Q27, Q30, estão lá).
- `wireframes/` — os `.wf` da fase de desenho. `prototipos/` e `design-systems/` ficam fora do git.

## 2. As regras

1. **O vault é a fonte da verdade.** Status, formato, categoria, arquivado: tudo está no nome do arquivo, na pasta ou no
   frontmatter da nota. O app só deriva. Nunca guarde em `app/dados/` algo que o Obsidian precisaria saber.
2. **Escreva no vault pelas funções do backend** (`notas.py`, `copies.py`), não com `open().write()` solto. Elas
   escrevem de forma atômica (`notas._escrever`: arquivo temporário + `os.replace`), mantêm os `[[links]]` e os pins
   do Obsidian em ordem.
3. **Nunca leia e escreva o mesmo arquivo na mesma expressão.** `open(p, "w").write(open(p).read() …)` trunca o arquivo
   antes de ler e já apagou uma nota real. Leia, guarde em variável, depois escreva. Em operação em lote no vault,
   faça backup antes (no scratchpad) e confira o diff.
4. **Nada se apaga de verdade.** Apagar uma nota manda para `.trash/` do vault (a lixeira do Obsidian), via
   `notas.para_lixeira`. Arquivar é o status `arquivado` (vai para Publicados e some das listas).
5. **Frontmatter se edita por linha.** Mude só a chave que precisa (`copies._definir`, `notas._definir_scheduled`,
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
- Não há testes automáticos. Teste no navegador e **limpe o que criou** (copy de teste vai para a lixeira, cor/ordem de
  teste sai do `criacao.json`, nota real alterada volta do backup).

## 4. O vault: pastas, status e o de-para

```
1 Copies/
  1 Priorizar/         copies vivas: backlog, em edição, agendadas
  2 Publicados/        copies concluídas (status: publicado, ativo, inativo ou arquivado)
2 Notas/Engine/
  templates/           T - Copy.md é o frontmatter de toda copy nova
  attachments/         imagens coladas (![[Pasted image ….png]])
3 Skills/<nome>/SKILL.md   as skills (o Claude Code usa; o modal abre e edita)
.trash/                a lixeira do Obsidian (para onde o app "apaga")
```

### Status da copy (propriedade `status:` na nota)

| Status (código no app) | Rótulo no app | Como está no vault |
|---|---|---|
| `ideia` | 💡 Ideia | `status: ideia` (ou sem a propriedade), em `1 Priorizar/` |
| `gravar` | Gravar | `status: gravar` |
| `edicao` | Em edição | `status: edicao` |
| `agendado` | Agendado | `status: agendado` |
| `referencia` | 🔖 Referência | `status: referencia`, em `1 Priorizar/` (material de referência; fica fora do menu de status, só nos seletores) |
| `publicado` | ✅ Publicado | em `2 Publicados/`, com `status: publicado` (orgânico; sem a propriedade em Publicados também é publicado) |
| `ativo` | 🟢 Ativo | em `2 Publicados/`, `status: ativo` (VSL e ads no ar) |
| `inativo` | ⏸️ Inativo | em `2 Publicados/`, `status: inativo` (VSL e ads parados; em 21/11/2026 as 333 💰/📺 publicadas viraram inativo) |
| `arquivado` | 🗄️ Arquivado | em `2 Publicados/`, `status: arquivado`: some das listas (só no filtro dele e em Arquivados; substituiu o `arquivado: true` em 21/11/2026) |

- Mudar entre os status de Priorizar **só grava a propriedade** (`notas.mudar_status`); o nome da nota não muda.
  Desde 19/11/2026 as marcas no nome (`🧑🏼‍🔧`, `🔹`, `👁️`) saíram: 33 notas migradas para a propriedade, e o 👁️ que
  sobrava em 28 nomes também.
- Os de conclusão (`notas.FIM`: publicado, ativo, inativo, arquivado) **movem** para `2 Publicados/` e gravam o `status:`
  (`copies.mudar_status` → `notas.mover` + `notas.mudar_status`). Voltar para um dos outros faz o caminho inverso (volta
  para `1 Priorizar/`). No calendário, o checkbox conclui como ativo (💰 📺) ou publicado. No menu da Redação, Ativo é item
  normal (depois de Agendado); Publicado e Inativo são links sublinhados discretos, sem contagem, embaixo, e Arquivado só um ícone.
- **Priorizar é o pin** (botão direito → 📌 Priorizar; ids `p:raiz/nome` em `canvas-pinados`): as pinadas ficam no topo da
  própria categoria (ou da lista), com 📌, fundo amarelo e um traço separando das demais, fora dos filtros e da ordenação.
- Copy nova (⌘K, ⌥N ou "+ Nova copy" na Redação) nasce com o frontmatter do `T-Copy.md` (`status: ideia`,
  `scheduled`, `notion`, `tags`, `colecao`) e o ícone do formato, então aparece na Criação. A janela também mostra as categorias (começa na escolhida no menu, se for uma só, ou na última usada) e grava o `categoria:`.
- Leitura: `notas.status(raiz, nome)`; `notas.STATUS_VAULT`/`DO_VAULT` traduzem o código do app para o vault.

### Formato (emoji depois da marca de status)

| Emoji | Formato | | Emoji | Formato |
|---|---|---|---|---|
| 📱 | Reels | | 🏞️ | Carrossel / estático |
| 💰 | Ad (tráfego pago) | | 🎥 | YouTube |
| 📺 | VSL | | 🎙️ | Live |
| 📝 | Feed | | 🗣️ | Stories |

São os `copies.FORMATOS`, na ordem de `copies.ROTULO_FORMATO`; o front ordena as abas por `ORDEM_FORMATO`
(`canvasApi.ts`). Marcas antigas ainda reconhecidas no nome (`MARCAS_FORMATO`): `📩 🎣 📚 💻 🧑🏼‍🏫 ✅ 🔥 📦`. Nota sem
emoji conhecido aparece como `📄`. O nome sem marcas nem emoji é o título da copy (`copies._base`). A Criação agrupa por estes ícones (seção 5).

**De-para já aplicado no vault** (não reverta; use como regra para notas novas):

- `🔥 Nome` → `📱 Nome` com a tag `"🔥"` em `tags:` (o fogo virou tag, não formato).
- `✅ … CTA` → `💰` (Ad). O ✅ verde não é formato.
- `🎣 Isca …` → `📱` (Reels).
- "Entrada" (material bruto) deixou de ser tipo à parte: link ou texto colado vira 💡 ideia.

### Frontmatter

| Chave | Em quê | O que é |
|---|---|---|
| `scheduled` | copy | `"AAAA-MM-DD"`, a data de publicação; o calendário editorial lê e grava |
| `tags` | todas | lista YAML; vazia fica `tags:` (nunca apague a chave) |
| `colecao` | copy | a coleção (antes `categoria:`, e `funil:` por algumas horas; ainda lidas): agrupa a Criação e o menu Coleções da Redação. No painel de propriedades da nota é um select com as categorias do `criacao.json` (sempre gravada entre aspas) |
| `notion` | copy | link do card no Notion (base "Edição e Publicação - 2026"); vários cards da mesma copy (versões, LP/VSL, retestes) viram lista. O painel mostra como "Notion ↗" |
| `origin` | ideia | wikilink do projeto/tema pai (padrão do vault) |
| `fontes` | ideia | lista de `[[…]]` das entradas ligadas (legado) |
| `url`, `tipo`, `thumb`, `autor` | ideia | o material bruto: `tipo` é `texto`, `link`, `youtube`, `instagram` ou `radar` |

Copy nova nasce em `1 Priorizar/` com o frontmatter do T-Copy (`notas.criar`) ou `status: ideia / scheduled: /
notion: / tags: / colecao:` (`copies._nova_copy`, para ⌘K, link colado e o radar).

### Links

- Sempre `[[wikilinks]]` por título simples (`[[💡 Img 2 HTML]]`), nunca link markdown para nota do vault.
- Renomear uma 💡 ideia pelo app reescreve os `[[links]]` para ela em todo `1 Copies/` (`notas.trocar_links`), como o
  Obsidian faria. Renomear uma copy **não** reescreve links (copies quase não são linkadas).
- Imagens: `![[Pasted image AAAAMMDDHHMMSS.png]]`, resolvidas em `2 Notas/Engine/attachments/` (rota `/api/anexo/…`).
- Nomes de arquivo têm espaços, emojis e acentos: **sempre aspas** em comandos de shell.

### Conflito com o Obsidian aberto

Cada `PUT /api/notas/…` manda o `mtime` que o editor leu. Se o arquivo mudou por fora, a API devolve conflito e o
modal mostra "recarregar" em vez de sobrescrever. Não contorne isso.

## 5. A Redação (`Redacao.tsx`, `Tabela.tsx`)

- **Layout:** um card só, com a tabela à esquerda e a nota (ou o calendário) à direita; divisória arrastável
  (`redacao-largura`; duplo clique volta ao meio). **Atalhos do modo esc** (fora de campos e do editor): **⌘B** esconde/mostra a tabela, fica só a copy ou o calendário (no editor, sem texto selecionado, também vale; com seleção é negrito; o botão ⇤ faz o mesmo); **⌘P** esconde/mostra a copy, fica a tabela inteira (as abas de notas ficam guardadas; clicar numa copy volta); **⌘[** esconde/mostra o menu de categorias (`redacao-sem-cats`); **⌘]** esconde/mostra Status e Data no modo copy (`redacao-sem-colunas`); o ⌘[ e o ⌘] se reconhecem pelo caractere (`e.key`), não pela tecla física: no teclado ABNT2 o `[` fica na tecla do `]` americano; **⌘C** vai para a aba Calendário e volta (só sem texto selecionado; o calendário saiu da Redação); **⌘A** seleciona todas as copies visíveis na tabela (Esc limpa a seleção); **⌘D** ou **⌘⌫** mandam para a lixeira as selecionadas ou a copy aberta (pede confirmação; no editor o ⌘⌫ segue apagando a linha). Um clique no título da copy aberta abre a edição do nome com o cursor onde foi o clique (duplo clique seleciona tudo). Clicar no emoji do título abre o seletor de ícone (os formatos sugeridos e um campo para qualquer emoji; ⌃⌘Espaço abre os do Mac): escolher renomeia a nota trocando só o emoji. Abrir uma copy (⌘O, clique, aba) abre o grupo dela na tabela e rola até a linha. **⌘1…** (ou ⌃) trocam de página na ordem da navbar (⌘1 Redação, ⌘2 Calendário…), também com copy aberta e no modo W; no modo copy, **⌥1…⌥9** vão para as abas de nota. A tabela é uma tela só (a Criação, por categoria): o **status** é a primeira seção do menu da esquerda, acima das categorias (clicar filtra, ⌘ soma, soltar uma copy muda o status dela); sem status escolhido, as publicadas aparecem no fim, depois de um traço (visíveis por padrão; "Esconder publicados" guarda a escolha em `tabela-ver-pub`). No botão **Filtrar**, cada chip de status tem três estados: um clique mostra só ele, o segundo esconde (filtro reverso, riscado; `filtros.fora`), o terceiro volta ao neutro; sem escolha, **Agendado e Publicado ficam escondidos** (`FORA_PADRAO` na `Tabela.tsx`), e escolher um status escondido mostra ele. A barra não tem mais o "Limpar filtros" (fica dentro do Filtrar).
- **Abas de notas** sobre o painel, como no Obsidian (`redacao-abas` no `localStorage`): clique numa linha abre na aba
  da frente; **⌘+clique** (ou ⌘↵ na busca ⌘O) abre numa aba nova; × ou clique do meio fecha. Enter na busca abre na
  aba da frente.
- **Abas da tabela:** Criação · Gravar | Em edição · Agendado · Publicados, com o ícone de cada status, o nome e o número (Priorizar e Winners saíram em 19/11/2026).
  - **Criação:** as copies com ícone de formato (📱 📝 🏞️ 💻 📚 💰 📺, `GRUPO_FORMATO`) agrupadas pela **categoria**
    (`colecao:` da copy; sem ela, "Sem coleção" no fim). Ordem padrão (sem status escolhido): **ativos** no topo, depois as **pinadas**, depois as em andamento (ideia, gravar, edição, agendado); publicado e inativo ficam no bloco "Mostrar publicados" do fim, **recolhido por padrão** (`tabela-ver-pub-2`); arquivado não aparece (só no filtro dele).
    Botão direito na categoria → cor pastel (a linha e as copies dela ficam na cor). Arrastar categoria sobre
    categoria muda a ordem; arrastar copy sobre copy muda a posição (e a categoria, se for de outro grupo). Cor e ordem em
    `dados/criacao.json` (`GET/POST /api/criacao`).
- **Coleções** (22/11/2026): a seção de categorias do menu se chama **Coleções** (orgânico e pago juntos) e a
  propriedade da copy é `colecao:` (antes `categoria:`; por algumas horas `funil:`; as duas ainda lidas e trocadas na
  mesma linha por `copies._gravar_colecao`; por dentro do app o campo segue "categoria"). No mesmo dia houve Quadros/
  Funis e Projetos embaixo de Ideia, desfeitos: o tipo ficou guardado em `tipos` e o backend ainda aceita `projetos` no
  `criacao.json`, sem uso no front. Coleção nova nasce solta, no topo; as que só existem nas notas também. Status com 0 copies somem (a não ser escolhidos ou pinados).
- **Os 4 grupos fixos** (22/11/2026, pedido do Rodrigo): 📱 Reels FIA (FIA Reels), 📱 Reels FID (FID Reels), 📺 VSL FIA (VSL FIA, LP FIA, VSL Carrinho) e 📺 VSL FID (VSL FID, LP FID). Os nomes dos grupos não mudam mais; cada um tem uma sessão editora no 19-agent-video-editor. As notas não mudaram (`colecao:` segue o nome da coleção).
- **Grupo nas Coleções:** clicar no grupo filtra todas as coleções dele (clicar de novo tira; ⌘ soma às já escolhidas); a setinha à direita abre e fecha o grupo.
- **Divisor simples** nas Coleções: `·sep:<id>` na lista do `criacao.json` (não é coleção nem grupo; `ehSeparador`):
  só uma linha; com o cursor em cima, "+" põe outro abaixo e "−" tira; arrastável. Cria pelo ícone de linha no título
  "Coleções" ou pelo botão direito no vazio do menu.
- **Calendário:** um controle ao lado do Hoje muda a altura dos dias (`cal-altura`; duplo clique volta a 140 px). A aba
  Calendário não tem a barra do "+ Nova copy" (o ⌘K continua). A Criação fica guardada entre Redação e Calendário
  (`criacaoCache`), para a troca de aba não piscar.
- **Categorias em dois níveis** (22/11/2026): os **grupos** (divisores `—<id>|<nome>` na lista do `criacao.json`) são
  o principal (só nome e cor) e as **categorias** abaixo deles, o secundário (ícone e nome). Toda copy fica num
  secundário. A nota guarda só o nome (`colecao: "Dicas & Hacks"`); o ícone da categoria fica em `icones` no
  `criacao.json` (`iconeCat`/`rotuloCat` em `Categorias.tsx`). Arrastar um grupo leva as categorias dele junto e o
  bloco cai antes ou depois do grupo de destino, nunca no meio (`moverNaLista` em `Tabela.tsx`). Em 22/11/2026
  as 251 notas perderam o emoji do nome; "💰 VSL FIA/FID" viraram "Ads VSL FIA/FID" e "📺 VSL FIA/FID", "VSL FIA/FID"
  (backup em `dados/antes-categorias-*`). Arquivar vale para os dois: `arquivadas` guarda nomes de categoria e ids de
  grupo (grupo arquivado leva as categorias dele; `arquivadaCat`). O ícone **Arquivados** fica no título "Coleções" (aparece no hover) e no botão direito do vazio do menu.
- **Menu de categorias** à esquerda da tabela (`Categorias.tsx`): a seção se chama **Coleções**; os grupos (nome em caixa alta e uma bolinha com a cor; botão direito: Renomear
  , Arquivar, Deletar, cor), cada categoria (com a contagem da aba) e "+ Nova categoria" (entra na lista do
  `criacao.json`, mesmo sem copy; criar e renomear abrem ali mesmo um editor com o ícone e o nome). Clique filtra (⌘ soma), soltar uma copy (ou a
  seleção) muda a categoria, arrastar categoria muda a ordem, botão direito: cor, renomear, apagar (só vazia).
  No topo, a categoria especial **📌 Pinados**: só as pinadas da aba (soltar uma copy ali pina).
  Botão direito → **🗄️ Arquivar** (categoria ou grupo): sai do menu e da Criação (a não ser escolhida) e aparece na
  janela **Arquivados** (ícone no título "Coleções" ou botão direito no vazio do menu), de onde desarquiva; as copies não mudam.
- **Formatos** (22/11/2026): orgânico 📱 Dica/Hack · 💻 Projeto autoral · 🗣️ Opinião/Dúvida · 🏞️ Carrossel · 🎥 YouTube;
  pago 💰 Ad VSL · 📜 Ad LP · 🎣 Ad Isca (as 15 notas "💰 LP - …" e "💰 ISCA - …" foram renomeadas para 📜 e 🎣). A coluna
  **Formatos** junta as notas da mesma copy pelo nome (sem o emoji e sem "VSL - ", "LP - ", "ISCA - "; `familia` em
  `Tabela.tsx`): os formatos que ela tem aparecem ligados (clicar abre a nota), um traço, e os que não tem, apagados. Na nota aberta (Redação e modal do Calendário), quando a família tem mais de uma nota, os mesmos ícones aparecem ao lado do caminho: o da nota marcado, os outros abrem a versão (`slotsFormatos`/`familia` em `canvasApi.ts`). Clicar num formato apagado propõe criar a nota dele (`NovoFormato.tsx`): pergunta a coleção (começa na da original), dá o nome ("💰 VSL - …", "📜 LP - …", "🎣 ISCA - …", "🏞️ …") e a nota nasce em Priorizar com o texto da original e um link `Base: [[original]]`. As copies ativas ficam numa caixa verde na tabela (`tr.is-ativo`). O botão **🔥 Winners** (barra de cima da tabela, `tabela-winners`) põe as winners (tag 🔥) da seleção atual, de qualquer status menos arquivado, no topo de tudo numa caixa vermelha (`tr.is-winner`); uma winner ativa sai do bloco dos ativos. O Reels ocupa uma posição só (📱, 🗣️ ou 💻, o que a copy tiver; sem Reels, 📱 apagado); depois 🏞️ e os pagos. YouTube fica de fora por enquanto.
- **Menu: hierarquia dos grupos:** o grupo tem ícone e nome maiores; as categorias dentro dele vêm recuadas e sem
  ícone; categoria solta mostra o ícone dela. A Ideia, no Status, fica em negrito.
- **Colunas da tabela:** botão **Colunas** na barra de cima: marcar quais aparecem depois da Copy (Data, Status,
  Categoria, Tags, Palavras, Editada) e arrastar a ordem (`tabela-colunas-modo` no localStorage, uma lista por modo); arrastar o próprio cabeçalho também muda a ordem. Toda coluna muda de largura
  pela borda direita do cabeçalho (`tabela-larguras`; duplo clique volta ao padrão); o vazio do fim fica com a sobra.
  A escolha de colunas é por modo, cada um com a sua (`tabela-colunas-modo`): vendo um status (padrão Data, Categoria) e vendo as categorias (padrão Data, Status); as marcadas sempre aparecem. Status e categoria do menu são excludentes.
- **Pinar status e categorias:** alfinete com o cursor sobre o item (pinado, fica vermelho e sempre à vista) ou botão
  direito → 📌 Pinar. Com o pai recolhido (a seção Status/Categorias ou o grupo), os pinados continuam à vista
  (`cats-pinados` no localStorage, chaves `st:<status>` e `cat:<nome>`; `usePinsMenu` em `Categorias.tsx`).
- **Copies novas:** criar uma copy (⌘K, paleta, radar) ou plugar uma ideia numa copy marca a nota em
  `dados/novas.json` (`copies.marcar_nova`; `/api/copies` devolve `nova: true`). A linha ganha o selo **new** e a
  categoria um 💡 piscando, e fica à vista como pinada. Abrir a nota tira (`POST /api/copies/vista`); a abertura
  automática logo depois de criar não conta (`recemCriadas` em `canvasApi.ts`). Renomear leva a marca junto. O botão direito na linha também marca ou tira à mão ("💡 Marcar como new" / "Tirar o new", `POST /api/copies/nova {nome, sim}`).
- **Links no editor:** `[[` abre um seletor de notas (nomes de `GET /api/notas-indice`); Enter grava `[[Nome]]`.
  Clique num [[link]] abre na aba da frente, ⌘+clique numa aba nova. A seta **←** nas abas volta para a copy anterior.
- **⇧+clique** numa linha seleciona da última clicada até ela. A pinada é marcada só pelo 📌.
  "+ Divisor" põe um traço arrastável (entrada `—…` na lista do `criacao.json`; botão direito tira).
- **Mostrar publicados** (fim da Criação): botão que abre, depois de um traço, as copies publicadas com ícone de
  formato (mesma categoria escolhida), mais recentes primeiro.
- **Modo copy** (copy aberta): a mesma tabela à esquerda (abas, menu de categorias, grupos, colunas); a copy fica
  numa coluna central. O menu de categorias muda de largura pela borda direita (`cats-largura`).
- **📅 Calendário** fica no canto superior direito, junto das abas de copy (sem copy aberta, no topo da tabela). Data vazia não mostra dd/mm/aaaa (o ícone aparece no hover da linha). A divisória muda a largura da tabela (`redacao-lateral-tabela`).
- **Colunas:** Copy (sem prévia), Status (seletor com ícone, com ⌘Z) e
  Data (campo de data: grava o `scheduled`). Larguras como numa planilha: a alça na borda direita muda só aquela coluna
  e empurra as outras (`tabela-larguras`); a Data fica com a sobra e, passando do painel, a tabela rola para o lado.
- **⇅ Ordenar:** um clique por campo (↑, de novo ↓, de novo tira); a ordem dos cliques é a prioridade (`regras` no
  estado da tabela). Com regras, elas passam por cima do cabeçalho e da ordem arrastada na Criação.
- **Seleção:** arrastar o mouse fora do nome desenha a caixa e seleciona várias (⌘/⇧ somam); pelo nome, a linha
  continua arrastando para o calendário.
- **Filtrar** (no lugar da busca, que saiu da Redação: o ⌘O busca): chips de Status e Data (com/sem; a coleção vai pelo menu);
  um clique liga ou desliga. A tabela guarda o estado de quando saiu (`tabela-estado`).
- **Botão direito numa copy:** priorizar, renomear, arquivar | tags | deletar (abrir saiu: é só clicar); fora da Criação, também mover de status.
- **📅 Calendário:** o `CalendarioEditorial` abre no lugar da nota; arrastar uma linha da tabela para um dia agenda.
- **Velocidade:** abre com o cache (`tudoEmCache`) e recarrega 1,5 s depois da última mudança no vault.

## 6. As telas

A navbar tem três grupos: **Redação · Calendário · Skills** | **Instagram · X · Sites** | **Agendamento**. **⌃1…** trocam de aba (também ⌥1…;
o ⌘1–8 o Chrome guarda para as abas dele). A página atual fica no `localStorage`; a Redação é a padrão.

| Tela | Arquivo | O que faz |
|---|---|---|
| **Redação** | `Redacao.tsx` | seção 5 |
| **Calendário** | `Redacao.tsx` (`calendario`) | a mesma tabela da Redação (filtros, menu, atalhos) com o calendário sempre à direita: arrastar uma linha para um dia agenda a copy. O calendário é contínuo: as semanas seguem sem quebra de mês (a virada é uma escadinha; o mês fica na margem). Acima dele, ícones filtram o tipo de copy pelo emoji do nome (Todos por padrão; 📱 🏞️ 💰 📺 📚 🎥 Outros; clicar soma ou tira; `cal-tipos` no localStorage), carrega mais semanas ao rolar perto das pontas, abre com a semana de hoje no topo, ‹ › pulam de mês e o título mostra os meses à vista. O checkbox de cada copy no calendário publica (status publicado, vai para 2 Publicados); desmarcar volta para Priorizar como agendado (⌘Z desfaz). Abrir uma copy (clique na linha ou no calendário) abre um modal com o nome, as propriedades e o texto, tudo editável (Esc ou clique fora fecha; "Abrir na Redação ↗" leva para lá); ⌘+clique vai direto para a Redação. O ⌘C volta para a Redação |
| **X** e **Sites** | `Radar.tsx` | o radar (seção 8). Botão direito num card → criar copy em Priorizar |
| **Instagram** | `Instagram.tsx` | canais monitorados e os Reels deles, com métricas relativas ao canal (seção 8) |
| **Agendamento** | `Calendario.tsx` | posts publicados e agendados do Instagram vindos do Metricool (seção 8) |

### Em qualquer tela

- **Busca `⌘O`** (`Paleta.tsx`): primeiro pelo nome, depois dentro do texto (`GET /api/notas-busca`, corpos em cache
  pelo mtime em `notas._CORPOS`), por último os nomes que só casam letra a letra. Embaixo de cada nome, a prévia do
  começo da nota ou o trecho onde as palavras apareceram (marcado). Copies e skills; Enter abre na aba da frente da Redação, ⌘↵ numa
  aba nova; sem resultado igual, oferece criar a copy.
- **Esc** dentro do editor ou de um campo só sai dele: W, ⌘B, ⌘P, ⌘[, ⌘], ⌘C, ⌘D e os outros atalhos voltam a valer.
- **⌘K**: copy nova (`NovoRapido.tsx`), nasce em Priorizar e abre numa aba nova (⌥N também).
- **⌘I**: abre o chat da direita e foca o campo; com texto selecionado no editor da copy (editor em foco), manda o
  trecho junto (`📎 [[nota]] · linhas X–Y`).
- **Painel da nota** (`PainelNota.tsx`): propriedades como no Obsidian (status na primeira linha, tags,
  datas, `publicado`), editor CodeMirror com live preview, salva 1 s depois de parar.
- **Largura do card:** as alças nas bordas esquerda e direita da Redação estreitam o card inteiro (centralizado,
  guardado em `redacao-card`); duplo clique volta a ocupar tudo. A copy fica sempre numa coluna central.

## 7. Processos do dia a dia

- **Copy nova:** ⌘K, a busca ⌘O (criar), link colado na caixa do ⌘K, ou um card do radar (botão direito → criar copy).
- **Andar no funil:** o seletor de status na tabela ou no painel. Agendar = data na célula ou arrastar para o
  calendário. Publicar = status Publicado (move a nota para `2 Publicados/`).
- **Tirar do caminho:** arquivar (sai da Criação, nota intacta) ou deletar (vai para `.trash/`).

## 8. Radar, X e Metricool

- **Coleta automática uma vez por dia** (`main.py`, `_coleta_automatica`): enquanto a API está de pé, roda `radar.coletar()`
  24 h depois do início da última coleta (uma coleta manual empurra a próxima). `GET /api/radar/estado` devolve `proxima`;
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
  ensina o contrário (`preferencias.py`; "Reavaliar" refaz o interesse a partir de 3 votos); 💡 cria uma copy em
  Priorizar com título, link, imagem e texto do card (`pronto` em `/api/copies/entrada`); ◉ manda o card ao Claude.
- **Botão direito num card** (tweet ou site) → "Criar copy em Priorizar" ou plugar numa copy que já existe
  (`MenuAdicionar`). Com texto selecionado fica o menu do navegador.
- **Perfil "Claude Profile" do Chrome** (`CHROME_PERFIL` em `config.py`, lido de `app/dados/chrome.json`: o deviceId da extensão nele): X e Instagram do
  radar rodam só nele (cada sessão do SDK chama `select_browser` antes de tudo), longe do Chrome do dia a dia. X logado
  como @RTadewald; Instagram como **teste.asimov**, a conta própria do radar. Se a extensão for reinstalada, o id muda
  (`list_connected_browsers`).
  Se o perfil estiver fechado (a sessão responde SEM_PERFIL), `config.com_perfil` abre o Chrome nele
  (`open -na "Google Chrome" --args --profile-directory=<pasta>`; a pasta vem do Local State pelo nome "Claude Profile"),
  espera 12 s a extensão conectar e tenta de novo. Não precisa deixar o perfil aberto.
- **Instagram: canais monitorados** (`instagram_canais.py`, `Instagram.tsx`, aba Instagram, 19/11/2026). Duas vistas:
  **Canais** (cadastro à mão: @, link ou vários separados por espaço; card com foto, seguidores, nº de reels e mediana de
  curtidas; × para de acompanhar e apaga os arquivos) e **Vídeos** (grade 9:16 com outlier = curtidas ÷ mediana das curtidas do canal (views podem vir de tráfego pago;
  curtidas ocultas, `like_and_view_counts_disabled` ou ≤ 5 com 10 mil+ views, viram "oculto" e saem da mediana), curtidas,
  views e engajamento = (curtidas + comentários) ÷ views; filtros de canal, data e outlier mínimo e, depois de um traço, os botões de ordem (Outlier, Curtidas, Views, Mais recentes,
  Engajamento), guardados no `localStorage`; clicar abre o Reel no Instagram, numa aba nova). Botão **Atualizar** → `POST /api/ig/atualizar` (segundo plano,
  `GET /api/ig/estado`). Cada lote já grava (parar no meio não perde o coletado) e Reels com mais de `MAX_DIAS = 30` dias não entram; parar a API cancela a coleta (`on_event shutdown`). Coleta em lotes de `LOTE = 5` canais, um agente por lote (com muitos numa rodada só ele desistia depois dos primeiros; um lote que falha não derruba os outros, e `estado.etapa` mostra "coletando 6–10 de 49"): um agente (Sonnet) abre o Chrome "Claude Profile" (conta teste.asimov) e, para cada
  canal, navega a `/<canal>/reels/` e roda `SCRIPT`: lê seguidores e foto do og: da página do perfil, intercepta as
  respostas que a página busca (a grade traz views/curtidas/comentários/capa; abrir um reel na própria página, com clique
  e `history.back`, traz legenda, `taken_at`, duração e `video_versions`) e baixa `neo-igc-<prefixo>-<canal>.json` em
  ~/Downloads. A API `/api/v1/users/web_profile_info` e `/api/v1/feed/user` dão 404 nessa conta: não use. Depois o
  backend baixa só fotos e capas (`dados/ig/{fotos,capas}`; os links do Instagram expiram); os MP4 não. `POR_CANAL = 10`
  (os mais recentes de cada coleta, fixados incluídos; o `videos.json` acumula: Reels de coletas antigas ficam, os repetidos só atualizam as métricas). Dados: `dados/ig/canais.json` e `dados/ig/videos.json`.
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

## 9. O chat da direita e a porta para o Claude Code

### O chat (`Chat.tsx`, `agente.py`)

Voltou em 19/11/2026 (tinha saído no `96020d1`), sem as ferramentas de canvas. É o Claude Code pelo **Claude Agent SDK**
rodando com `cwd` no vault (`setting_sources` user + project: lê o `CLAUDE.md` do vault e as skills de `3 Skills` pelo
symlink `.claude/skills`), modelo `MODELO_CHAT` (`config.py`), `bypassPermissions` e Bash livre, como no terminal.

- **Coluna da direita** do `.corpo` (`com-chat`/`sem-chat`), na mesma janela da página: com o chat aberto, a janela é o
  `.corpo::before` e a página (Redação, Instagram) perde o cartão próprio; só uma linha separa os dois. **⌘J** abre e
  fecha; **⌘I** abre e foca (com seleção no editor, leva o trecho); recolhido vira a bolinha no canto inferior direito. A borda esquerda arrasta a largura (`chat-w`, limitada a 40vw na tela; duplo clique volta ao padrão).
- **Conversas:** cada uma tem o histórico (`mensagens`) e a sessão do Claude retomada (`conversas.sessao`) no
  `dados/jarvis.db`. Relógio = conversas anteriores; + = nova. A conversa aberta fica em `chat-conversa`.
- **Rotas:** `POST /api/chat` (SSE: `texto`, `ferramenta`, `mudou`, `tela`, `fim`, `erro`), `GET /api/chat/{conversa}`,
  `GET /api/chats`, `DELETE /api/chats/{conversa}`, `POST /api/chat/imagem` (imagem colada vai para os anexos do vault
  e entra na mensagem como `🖼️ ![[...]]`).
- **Ferramentas próprias** (MCP `neo`): `rotas` (lista a API), `app` (chama qualquer rota `/api/` pelo ASGI, sem rede;
  escrita emite `mudou`), `tela` (`pagina` ou `abrir_nota`, que abre numa aba da Redação) e `transcrever_youtube`.
- Cada mensagem leva "onde o Rodrigo está" (página e nota aberta) e a nota aberta vira uma linha no começo do texto.
- No campo: Enter envia (ocupado: entra na fila), Esc para a resposta, `/` abre o seletor de skills, ⌘V cola imagem,
  ⌘⇧D dita (reconhecimento de voz do navegador).

### A porta para o Claude Code do terminal (`porta.py`, `porta.ts`)

O Claude Code do terminal mexe nas notas direto e usa o app pela API; o app é a porta para falar com ele. Modelo
copiado do Neo Stitch.

- **Sem caixa de pedido** (desde 19/11/2026): a fila (`/api/fila`, `dados/fila.jsonl`) e o `ouvir.sh` saíram (a
  bolinha e o ⌘J agora são do chat da direita). O Rodrigo cita a nota pelo nome no terminal; `GET /api/onde` diz o que está aberto.
- **Eventos (`GET /api/eventos`, SSE).** `mudou`: o vigia (`porta.vigiar_vault`, a cada 1,5 s) viu nota criada, editada,
  movida ou apagada; a Redação e a nota aberta recarregam (a nota só se não houver edição pendente). `tela`: o Claude
  mexe na tela com `POST /api/tela` `{acao, pagina?, raiz?, nome?, nova?}`; ações `pagina`, `abrir_nota` (abre numa
  aba da Redação; `nova: true` numa aba nova) e `mostrar`.
- **Onde o Rodrigo está:** o app manda (`porta.vigiarOnde`, de segundo em segundo, só quando muda) a página e a nota
  aberta; o Claude lê em `GET /api/onde`.
- O radar e o Metricool continuam usando o SDK do Claude por conta própria (`radar.py`, `coletores/`, `metricool.py`).

## 10. API (FastAPI, `app/backend/src/jarvis/main.py`)

| Rota | Para quê |
|---|---|
| `GET /api/copies` | todas as copies (status, formato, categoria, mídia) e os formatos. Cada nota fica em cache pelo mtime: só as que mudaram são relidas |
| `POST /api/copies/status` · `tags` · `winner` · `categoria` · `categoria/renomear` | ações nas copies (pelo nome) |
| `POST /api/copies/ideia` · `entrada` | copy nova em Priorizar · copy a partir de link/texto (ou `pronto` do radar) |
| `GET/POST /api/criacao` | grupos e categorias (lista com divisores), `icones`, cores, `arquivadas` e a ordem das copies na Criação (`dados/criacao.json`) |
| `GET/PUT /api/notas/{raiz}/{nome}` | ler · salvar (com `mtime`; conflito se mudou por fora) |
| `POST /api/notas/{raiz}/{nome}/acao` | `mover` · `status` · `renomear` · `lixeira` |
| `POST /api/notas/{raiz}/{nome}/agenda` · `GET /api/notas/agenda` | `scheduled` · calendário editorial |
| `POST /api/notas/priorizar` · `GET /api/notas-indice` | copy nova · índice da busca `⌘O` |
| `GET /api/sinais` · `POST /api/sinais/{id}/voto` | radar (`?status=curtido`) · like/deslike (dispara o like no X) |
| `POST /api/radar/atualizar` · `reavaliar` · `GET /api/radar/estado` | coleta e ranking |
| `GET /api/eventos` · `POST /api/tela` · `GET/POST /api/onde` | a porta: SSE (mudou, tela, porta) · o Claude mexe na tela · onde o Rodrigo está |
| `GET /api/calendario` · `POST /api/calendario/sincronizar` · `/api/ads…` · `/api/planejamento…` | Metricool e planejamento |

`raiz` é `priorizar`, `publicados`, `ideias`, `entradas` ou `skills` (`notas.RAIZES`; no front, `notas.ts`).

## 11. Mapa dos arquivos

```
app/neo-obsidian.sh           o comando (sobe, para, abre)
app/backend/src/jarvis/
  main.py                     rotas
  config.py                   VAULT, APP, DADOS (o caminho do vault é fixo aqui)
  notas.py                    status, mover, renomear (+ links), lixeira, agenda, pins do Obsidian
  copies.py                   as copies (lista, mídia, criar, status, tags, categoria, arquivar) e a Criação (cor/ordem)
  instagram_canais.py         Instagram: canais, coleta pelo Chrome, capas, métricas
  porta.py                    eventos SSE, vigia do vault, onde
  agente.py                   o chat da direita: Claude Agent SDK no vault (ferramentas rotas, app, tela, youtube)
  radar.py · preferencias.py · db.py · coletores/{fontes,x,x_curtir}.py   radar e like no X
  metricool.py · anuncios.py · planejamento.py · youtube.py · videos_x.py · auth.py
app/frontend/src/
  App.tsx                     navbar, breadcrumb, páginas, busca, eventos da porta
  Redacao.tsx · Tabela.tsx    a Redação: tabela (Criação, status, categorias) + nota em abas + calendário
  PainelNota.tsx              propriedades + editor da nota (Redação e Skills)
  Chat.tsx                    o chat da direita (⌘J): conversas, fila, imagens, ditado, / skills
  Paleta.tsx · NovoRapido.tsx · porta.ts · Radar.tsx · Instagram.tsx · CalendarioEditorial.tsx · Calendario.tsx
  Editor.tsx · livePreview.ts · propriedades.ts   o editor no jeito do Obsidian
  canvasApi.ts · api.ts · notas.ts                tipos e chamadas (o nome canvasApi é legado); notas.ts = raízes, pastas, link do Obsidian
  index.css                   todo o CSS (tokens no topo)
```

`Desempenho.tsx` (Meta Ads, `/api/ads`) está guardado fora da navbar. Saíram na limpeza de 19/11/2026: o ModalNota
(modal de nota com versões), EmBreve, o selo NOVO antigo, as abas Winners/Pinados/Skills da tabela e o CSS sem uso. Saíram de vez: o Canvas (Canvas.tsx, Canvases.tsx, PaletaCanvas.tsx,
Desenho.tsx), a página Calendário (virou o calendário da Redação; Skills voltou a ser página da navbar) e os códigos NEO.
Não traga de volta sem pedido.

## 12. Armadilhas conhecidas

- **`ideias` / `entradas`** ainda são raízes em `notas.py` e `notas.ts` (a pasta `0 Ideias/` não existe mais). O
  `/api/copies` só lê Priorizar e Publicados. "Plugar" um link numa copy (`POST /api/copies/entrada` com `ideia`) põe o
  material na seção "## Entradas" da própria copy.
- **Velocidade:** a tabela muda status, tags, categoria, data e arquivar na hora (`naHora` na Redação) e só depois relê
  `/api/copies`; `carregarTudo` junta pedidos simultâneos. ⌘Z / ⌘⇧Z (fora do editor) desfazem status e tags.
- **Nome com sufixo " 2"**: `_livre` evita colisão acrescentando um número. Se aparecer, foi colisão de nome.
- **Cache do navegador:** listas buscadas logo depois de reiniciar o servidor podem ficar com a página HTML em cache;
  use `cache: 'no-store'` nas listas que mudam (já está em `carregarTudo`, Instagram e Criação).

## 13. Onde ler mais

| Para | Leia |
|---|---|
| decisões e escopo (as Q do código) | [specs.md](specs.md) |
| visão geral e instalação | [README.md](README.md) |
| convenções do vault (emojis, templates, links, frontmatter) | `CLAUDE.md` na raiz do vault |
