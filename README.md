<div align="center">

<img src="docs/logo.svg" width="96" alt="Neo-Obsidian">

# Neo-Obsidian

**Suas notas do Obsidian num canvas. Da ideia ao post publicado.**

Um app local por cima do vault, onde cada ideia vira um card e cada card agrupa<br>
todas as versões dela: Reels, anúncio, carrossel, VSL. Com o Claude no chat ao lado.

<br>

![Python](https://img.shields.io/badge/python-3.12+-3776ab?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/fastapi-API%20local-009688?style=flat-square&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/react-19-61dafb?style=flat-square&logo=react&logoColor=black)
![React Flow](https://img.shields.io/badge/react%20flow-12-ff0072?style=flat-square)
![CodeMirror](https://img.shields.io/badge/codemirror-6-d30707?style=flat-square)
![Obsidian](https://img.shields.io/badge/obsidian-vault%20local-7c3aed?style=flat-square&logo=obsidian&logoColor=white)
![Claude Code](https://img.shields.io/badge/feito%20com-Claude%20Code-d97757?style=flat-square)

</div>

<br>

## Por quê

O Obsidian é ótimo para escrever e péssimo para enxergar o funil. Uma ideia de conteúdo vira um Reels, depois um anúncio, depois um carrossel. São notas soltas em pastas diferentes, e ninguém lembra mais qual saiu de qual, o que está agendado e o que ficou parado em edição.

O Neo-Obsidian não substitui o vault: **ele lê e escreve os mesmos arquivos `.md`**. Por cima deles, monta um canvas onde a ideia é o centro e as produções se penduram nela. Você abre o Obsidian e está tudo lá, do mesmo jeito. Abre o app e enxerga o mapa.

## Como funciona

```
 link, vídeo, texto ─▶ 💡 ideia ─▶ 🎬 produções (uma por formato)
                          │          📱 Reels · 💰 Ad · 🏞️ Carrossel · 📺 VSL
                          │                │
                          │                ▼  status = pasta + emoji no nome
                          │     Priorizar ─▶ Em edição ─▶ 🔹 Agendado ─▶ ✅ Publicado
                          ▼
                radar (X, GitHub, Hugging Face, HN) ─▶ 👍 / 👎 ─▶ vira 💡 ideia
```

1. **A ideia chega.** Cole um link ou texto no canvas, ou mande um card do radar: vira uma 💡 ideia em `1 Copies/0 Ideias`, já com o material dentro (a transcrição do YouTube, o texto da página, o post do X).
2. **As produções se agrupam.** Cada copy com `ideia: "[[💡 Nome]]"` no frontmatter entra no card daquela ideia. O card mostra um chip por formato e abre sempre no Reels.
3. **O status é o do vault.** A pasta e o emoji no nome dizem onde a copy está (Priorizar, em edição, agendada, publicada). Mudar no app move e renomeia o arquivo, e os `[[links]]` acompanham.
4. **O Claude trabalha junto.** O chat da direita é uma sessão do Claude Code rodando dentro do vault, com as skills de copy. Mande uma nota ou um trecho (`⌘I`) e peça a próxima versão: ele escreve direto na nota.

## Recursos

- **Canvas por tema** (React Flow): cada nota vive num canvas (Skills, Hacks e Dicas…, pela propriedade `grupo`), com cards de ideia, de produção e de VSL e ligações entre eles. Nota sem canvas fica no 📥 Inbox.
- **Produtos** (FIA, FID, Dados, PICO) são as tags da nota: dentro do canvas viram filtro e uma bolinha colorida no card.
- **O que já saiu, some do Inbox.** Uma produção publicada sem canvas vai para a pasta Publicado; num canvas temático ela fica.
- **Pastas** (Em edição, Agendado, Publicado) abrem uma **tabela** com estatísticas, filtros por formato, ano e canvas, barras por mês e ordenação. Clique numa linha para abrir a copy, e o "voltar" retorna à tabela.
- **Modal de nota estilo Notion:** uma aba por versão da mesma ideia, **+ Saída** para criar o próximo formato, renomear no título, "Mostrar no canvas", lixeira com confirmação (`⌘⌫`).
- **Editor como o do Obsidian** (CodeMirror 6, live preview): títulos, negrito, callouts, tarefas e `[[wikilinks]]` formatados, com as marcas aparecendo só na linha do cursor. Salva sozinho e avisa se o arquivo mudou no Obsidian em vez de sobrescrever.
- **Propriedades editáveis no card:** o frontmatter vira uma tabela como a do Obsidian. Tags em chips, datas com calendário, `publicado` em caixinha, + Adicionar propriedade. Cada mudança reescreve só a linha daquela chave.
- **Radar:** X, GitHub Trending, Hugging Face e Hacker News em cards. 👍 ensina o ranking e guarda em **Curtidos**, 👎 tira do feed e ensina o contrário. 💡 transforma o card em ideia no canvas, e "Perguntar ao Jarvis" leva para o chat. Vídeos do X tocam no próprio card.
- **Calendário editorial** pelo `scheduled` (arraste para reagendar) e **Agendamento** com os posts do Instagram via Metricool.
- **Busca rápida** `⌘P` em ideias, copies e skills, no estilo do quick switcher do Obsidian.
- **Modo construtor:** o mesmo chat pode mexer no código do app enquanto você usa, com um ponto de restauração antes de cada pedido para desfazer.

## Instalação

**Requisitos:** macOS, [uv](https://docs.astral.sh/uv/) com Python 3.12+, Node 20+, um vault do [Obsidian](https://obsidian.md/) e o [Claude Code](https://claude.com/claude-code) logado (o chat usa a assinatura, não uma chave de API).

```bash
git clone https://github.com/rtadewald/neo-obsidian.git
cd neo-obsidian

# o front (Vite + React)
npm --prefix app/frontend install

# o caminho do seu vault
$EDITOR app/backend/src/jarvis/config.py      # VAULT = Path("/caminho/do/seu/vault")

# um comando para subir tudo
ln -s "$PWD/app/neo-obsidian.sh" ~/.local/bin/neo-obsidian
neo-obsidian
```

O `neo-obsidian` sobe a API (porta 8740) e o front (porta 5180) e abre o navegador. `Ctrl+C` derruba os dois.

| Comando | O quê |
|---|---|
| `neo-obsidian` | Sobe API + front e abre o app |
| `neo-obsidian parar` | Derruba o que estiver rodando nas portas do app |
| `neo-obsidian abrir` | Só abre o navegador |

O app espera a estrutura de pastas do vault em `1 Copies/` (`0 Ideias`, `1 Priorizar`, `2 Publicados`) e as skills em `3 Skills/<nome>/SKILL.md`.

## Usar

| Atalho | O quê |
|---|---|
| `⌘P` | Buscar e abrir qualquer nota |
| `⌘I` | Mandar a nota (ou o trecho selecionado) ao chat |
| `⌘S` | Salvar agora (ele já salva sozinho depois de 1 s) |
| `⌘⌫` | Mandar a nota aberta para a lixeira (com confirmação) |
| `⌘` + clique | Abrir um `[[link]]` |
| botão direito no canvas | Nova ideia, colar como ideia, nova copy; num card: Mover para › e Produto › |
| `F` · `←` `→` · `R` | No radar: modo foco, anterior/próximo, embaralhar |

## Estrutura

```
app/
  neo-obsidian.sh       o comando: sobe API + front, para e abre
  backend/src/jarvis/   FastAPI (uv run jarvis, porta 8740)
    main.py             as rotas
    canvas.py           ideias, produções, canvas, produtos e posições
    notas.py            ler, salvar, mover, renomear e mandar para a lixeira (com os links)
    agente.py           o chat: uma sessão do Claude Code dentro do vault
    construtor.py       modo construtor, com ponto de restauração por pedido
    radar.py · preferencias.py · coletores/   o radar e o ranking pelos seus votos
    metricool.py · anuncios.py               posts, agendados e Meta Ads (leitura)
    youtube.py          transcrição pela legenda
  frontend/src/         Vite + React 19 + React Flow 12 + CodeMirror 6
    Canvas.tsx          o canvas: cards, caixas, pastas, menu
    Tabela.tsx          a tabela das pastas e das caixas
    ModalNota.tsx       o modal com as abas por versão
    Editor.tsx · livePreview.ts · propriedades.ts   o editor no jeito do Obsidian
    Radar.tsx           X e Sites
    Chat.tsx · Paleta.tsx · CalendarioEditorial.tsx · Calendario.tsx
  dados/                SQLite do radar, posições do canvas, miniaturas (fora do git)
specs.md                decisões e escopo
```

## Próximos passos

- [x] Ideia e entrada viraram uma coisa só: tudo é 💡 ideia.
- [x] Propriedades editáveis no card, como no Obsidian.
- [ ] Instagram no radar, com uma conta dedicada.
- [ ] Retreinar o ranking do radar a partir dos Curtidos.
- [ ] Caminho do vault configurável pela interface.

<br>

<div align="center">
<sub>Feito por <a href="https://github.com/rtadewald">Rodrigo Tadewald</a> com <a href="https://claude.com/claude-code">Claude Code</a> · sobre um vault do <a href="https://obsidian.md/">Obsidian</a></sub>
</div>
