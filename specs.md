# Jarvis Conteúdo — specs

> **Revisão de 10/nov/2026 (Q20 a Q32).** Estas decisões substituem o que estiver diferente nas seções abaixo:
>
> - **Sem workspaces (Q26).** A navbar vira **Radar · Ideias · Desempenho · Skills · Calendário · Config**. FIA, FID e
>   Pessoal passam a ser uma etiqueta de produto na ideia, que escolhe o contexto da mesa (docs `[FIA]_…`, `[FID]_…`).
> - **Radar único (Q20, Q21).** Um feed só de "coisa legal", sem separar por produto: modelos de IA novos, técnicas,
>   projetos, assuntos em alta, GitHub Trending, posts e Reels virais com alcance acima da média, skills. A IA classifica
>   o tipo de cada item.
> - **Fontes (Q20, Q27, Q31):**
>   - **X:** o Jarvis lê o feed "Para você" da conta do Rodrigo pela extensão **Claude in Chrome**, no Chrome dele, já
>     logado. Junta os 50 primeiros posts e recomenda os de maior potencial. Só leitura: não curte, não reposta, não segue.
>   - **Instagram:** uma conta dedicada, criada e logada pelo Rodrigo (o Jarvis não cria contas nem digita senhas). O
>     Jarvis consome o feed e os Reels para treinar o algoritmo e segue só criadores que o Rodrigo aprovar (Q28).
>   - **Sem login:** GitHub Trending, Hugging Face Trending, Hacker News e changelogs de laboratórios (Q31).
>   - **YouTube:** fora por enquanto.
> - **Viralizou acima da média (Q29):** views comparadas à média dos últimos posts do próprio perfil para criadores
>   recorrentes (média guardada no banco); views ÷ seguidores como estimativa para quem aparece pela primeira vez.
> - **Agente e vault (Q30, revisto em 15/11/2026):** lê e escreve o vault inteiro (menos `.obsidian/`, `.trash/`, `.git/`) e
>   usa o app inteiro como o Rodrigo, pelas mesmas rotas da API; confirma no chat antes de apagar ou de mudanças em massa.
>   O modo construtor (o chat mexendo no código do app) saiu.
> - **Metricool na v1 (Q23):** histórico de posts, desempenho de cada um e agendados dos próximos dias, no painel e no
>   chat. Só leitura. Pela API REST (planos Advanced/Custom; token em Account Settings > API) ou, sem esse plano, pelo MCP
>   remoto com OAuth (histórico limitado ao plano) — **depende do plano (Q32, em aberto)**.
> - **Visual (Q22):** design system **JCO-359** (vidro claro, Raleway, acento lima). Cores e materiais em variáveis, para
>   um seletor de temas depois.
> - **Wireframes (Q23):** não há mais rodada de wireframe; as telas são construídas direto no design system.
> - **Stack (Q24):** FastAPI + `claude-agent-sdk` (Python), SQLite, coletores em Python, front React + Vite com SSE.
> - **Código (Q25):** `20-neo-obsidian/app/`, com `git init`; protótipos e design systems fora do git.
> - **Em aberto:** frequência da coleta do X (recomendação: 2x por dia + botão "Atualizar"); plano do Metricool (Q32);
>   se o Claude in Chrome funciona em sessões do SDK e em execução agendada (em verificação).

App web local e pessoal do Rodrigo para **ter ideias de conteúdo e transformá-las em roteiros**. Este documento reúne o que
foi decidido no grill-me de 07/nov/2026 (perguntas Q1 a Q19), nos ajustes de wireframe e no levantamento feito na
mesma sessão. O que ainda não foi decidido está no fim, em [Em aberto](#em-aberto).

## 1. Objetivo

- **O que é:** um painel de **ideias vivas**. Mostra o que está viralizando (X, Instagram, YouTube), notícias e projetos
  novos, e cada item pode ser puxado para virar um Reel ou um carrossel com as skills do vault.
- **Métrica de sucesso:** o tempo entre clicar numa ideia e ter o roteiro pronto (Q1). Mais peças publicadas vêm como
  consequência.
- **Usuário:** só o Rodrigo (Q2). Sem login, sem multiusuário, sem hospedagem.

## 2. Plataforma e agente

| Decisão | Escolha |
|---|---|
| Onde roda (Q11) | Web local, no navegador em `localhost`. Caminho aberto para acessar pelo celular (rede local ou Tailscale) depois. |
| Agente | Claude Code via Claude Agent SDK, com o harness completo: tools, subagentes, hooks, MCP, skills e `CLAUDE.md` do vault. |
| Autenticação (Q9) | O login da assinatura do Rodrigo, não chave de API. **Isolada num único módulo do backend**: a documentação do SDK manda usar chave de API e não trata o caso de um app pessoal; se a Anthropic restringir, a troca muda só esse módulo. |
| Voz (Q13) | Fora. No futuro, no máximo ditado: o Rodrigo fala, o app transcreve e o Jarvis responde em texto. |

**O que o SDK oferece** (levantamento de 07/nov, documentação oficial):

- `settingSources` carrega settings, `CLAUDE.md`, skills, commands e agents de `~/.claude/` e de `<cwd>/.claude/`;
  `skills` escolhe quais ficam ativas.
- **Sessões:** `session_id` em cada resultado; `resume` retoma, `forkSession` bifurca; `listSessions()` e
  `getSessionMessages()` listam e leem. Cada sessão é um subprocesso `claude` (o limite é a RAM).
- **Streaming:** `includePartialMessages` emite os deltas de texto e de chamadas de ferramenta.
- **Aprovações:** `canUseTool` recebe cada chamada que pede permissão e devolve `allow` ou `deny`. `AskUserQuestion`
  também passa por ele.
- **Tarefas agendadas:** `claude -p` (sem `--bare`, para usar o login da assinatura via `CLAUDE_CODE_OAUTH_TOKEN`). No
  macOS, via `launchd`; a máquina precisa estar acordada.
- **Não confirmado:** duas retomadas simultâneas da mesma sessão.

Conectores da conta claude.ai (Notion, Metricool) **não** são herdados por um app próprio: o backend vai precisar de
credenciais próprias ou de servidores MCP configurados localmente.

## 3. Estrutura das telas

- **Topo:** navbar horizontal fina. Wordmark "JARVIS" à esquerda; no centro, as páginas
  (FIA · FID · Pessoal · Skills · Calendário · Config); avatar à direita. **Sem barra lateral** (wireframe aprovado:
  `wireframes/v2/out/01a-painel-navbar-topo.png`).
- **Abaixo, duas colunas:** 70% com a página; 30% com o chat do Jarvis, de cima a baixo.
- **Chat contextual (Q15):** sabe o que está na tela. No painel, conversa sobre os sinais daquele workspace; na mesa,
  trabalha naquela ideia. **Uma sessão do agente por workspace e uma por ideia**, guardadas pelo `session_id`.

## 4. Workspaces (Q3)

Cada aba é um **workspace configurável**: temas, fontes do radar, concorrentes e referências, skills ativas e formatos.
Os primeiros são **FIA**, **FID** e **Pessoal** (@rodrigotadewald). Um workspace novo é basicamente um arquivo de
configuração. O formato (Reel, carrossel) é filtro dentro do workspace, não aba.

## 5. Telas

### 5.1 Painel do workspace (v1)

Cabeçalho com o nome do workspace, filtros por fonte (Tudo · X · Web · YouTube · Instagram) e botão "Atualizar".
Seções (Q16):

1. **Hoje:** notícias do X e da web. Fonte, título e uma linha de "por que importa".
2. **Viralizando:** cards grandes de YouTube e Instagram, com thumbnail.
3. **Concorrentes:** alternância **Rivais / Referências**; tabela de perfis com posts na semana e nota.
4. **Minhas ideias:** kanban Salvas · Em desenvolvimento · Pronto.

Concorrentes e Minhas ideias ficam lado a lado na base.

**Card de sinal (Q17):**

- thumbnail, título, fonte, autor, data e a métrica principal;
- **nota de viralidade:** views comparadas à média daquele autor (ex.: "8,4x a média"), não as views brutas;
- uma linha da IA: **por que importa para este workspace**;
- ações: salvar, descartar, abrir na mesa, e "gerar roteiro" com escolha da skill (Reel ou carrossel).

### 5.2 Mesa da ideia (v1) — o loop central (Q4, Q18)

- **Esquerda, a fonte:** vídeo ou post embutido, números e transcrição.
- **Centro, o desenvolvimento:**
  - **Peças desta ideia:** uma ideia pode gerar várias peças (um Reel e um carrossel);
  - ângulos sugeridos;
  - hooks, com a skill `viral-hooks`;
  - seletor de formato: Reel (`reels-builder`) ou carrossel (`carrossel-builder`);
  - editor do roteiro, com prévia slide a slide quando for carrossel.
- **Direita:** o chat daquela ideia.
- **"Mandar p/ Priorizar"** move a nota para `1 Copies/1 Priorizar`.

### 5.3 Skills (v2, Q19)

Lista de skills à esquerda e editor do `SKILL.md` (e dos arquivos de `references/`) no centro. Grava direto no vault; o
chat propõe mudanças com diff antes de salvar. Botão "Testar" reservado para depois.

### 5.4 Calendário (v2, Q6)

Mês, **somente leitura**: os Prazos do Notion e o que está agendado no Metricool. Aponta dias vazios e sugere ideias para
eles. Escrever no Notion fica para depois, quando o fluxo estiver provado.

### 5.5 Config do workspace

Identidade, fontes do radar (liga e desliga, temas, horário de atualização), concorrentes e referências, skills ativas.

## 6. Ciclo de vida da ideia (Q12)

| Estágio | Onde fica |
|---|---|
| **Sinal** — item bruto do radar | Banco do app. Descartável. |
| **Ideia salva** — marcada como interessante | Banco do app. |
| **Em desenvolvimento** — aberta na mesa | Nota no vault, em `1 Copies/0 Ideias/` (pasta nova). |
| **Roteiro pronto** | A nota vai para `1 Copies/1 Priorizar`. Daí em diante entram Notion e Metricool, como hoje. |

Só vira nota no vault o que o Rodrigo puxar para desenvolver. Notas novas seguem o frontmatter do template
`T - Copy.md` e a convenção de emojis do vault.

## 7. Escopo

- **v1 (Q5):** chat, radar e mesa da ideia, começando por um workspace (FIA). Prova o ciclo do sinal até o roteiro.
- **v2:** Skills, Calendário, os demais workspaces.
- **Depois:** testar skills na tela, rastrear onde cada skill foi usada, escrita no Notion, ditado, acesso pelo celular.

O wireframe e o front cobrem o app inteiro (Q14), com as telas de v2 marcadas, para a navegação não precisar mudar.

## 8. Custo

A coleta do radar roda em **scripts comuns, sem LLM**. Um modelo barato (Haiku) dá a nota e escreve a linha de "por que
importa" de cada item; o modelo forte entra só no chat e na mesa. Com o login da assinatura, o limite é o da assinatura,
não o custo por token.

## 9. Visual

- Direção do grill-me (Q10): manter a linguagem do Jarvis com layout de painel, priorizando a leitura (muitos cards,
  thumbnails grandes, números legíveis). É um painel de trabalho, não um HUD de filme.
- Depois disso, a exploração foi para o **glass**: 31 design systems gerados no Neo Stitch
  (`21-neo-stitch/projects/jarvis-conteudo/ds/`, filtro **Design Systems** no canvas; cópia antiga em
  `20-neo-obsidian/design-systems/`). O que for escolhido vira a base do front.
- **Escala:** dashboard normal em 1536 px — corpo de 13 a 14,5 px, título de painel de 17 a 20 px, botões de 30 a 38 px
  de altura (tabela completa nas skills `img2html` e `video2html`, seção Scale).
- Formato: desktop 16:9, tela cheia. Conteúdo em PT-BR.

## 10. O que já existe

| O quê | Onde | Situação |
|---|---|---|
| Wireframes | `20-neo-obsidian/wireframes/` (`.wf` e PNGs; aprovado: `v2/01a-painel-navbar-topo`) | Só o painel foi revisto; mesa, skills, calendário e config estão na v1 do wireframe, ainda com a barra lateral. |
| Brief do front | `21-neo-stitch/projects/jarvis-conteudo/brief.md` | Telas e visual, sem backend. |
| Design systems | `21-neo-stitch/projects/jarvis-conteudo/ds/` | 31 catálogos (Overview e Components), reescalados em 09/nov. |
| Editor de skills e grafo de notas | `21-neo-stitch/projects/jarvisos/impl/JAR-243/v1.2/` | Protótipo; as skills ficam em `localStorage`, sem gravar no disco. |
| Voz (OpenAI Realtime) | `AI Projects/35_jarvis_os` (FastAPI) | Fora do escopo; só voz e webcam. |
| Skills do vault | `Obsidian Notes/3 Skills/` | 18 skills; `SKILL.md` com frontmatter `name` e `description`, corpo livre. O parser precisa tolerar variações. |

## 11. Dados e integrações (levantamento de 07/nov)

- **Coletores:** nenhuma das skills de radar (`social-feed-radar-operations`, `ai-signal-report`, `pesquisa-reels`) é um
  coletor executável; são métodos em markdown. O radar precisa ser **construído quase do zero** e é o maior risco da v1.
  - **X:** o coletor descrito roda no Mac mini (Hermes), fora do alcance desta máquina. Sem API do X.
  - **Instagram:** só método via navegador logado, frágil (a própria skill admite).
  - **YouTube:** nada além do `yt-dlp` instalado.
  - **Web:** busca do agente; há uma chave de SerpAPI disponível.
- **Concorrentes:** não há lista oficial. O mais próximo são dumps de 2024/2025 em `Tools/7_reels_downloader/databases/`
  (`alinefreitas.cc`, `fernandomiranda777`, `jeffnippard`, `kallaway`, `nick_saraev`, `rick_miura`, `rourkeheath`), que
  dependem de um token da Graph API não verificado.
- **Calendário:** roteiro no Obsidian, operação e Prazo no Notion (base "Edição e Publicação - 2026"), publicação no
  Metricool. O `scheduled` do vault espelha o Prazo do card. **O app não altera o schema da base do Notion** (a skill
  `publicar` alerta que mexer em Campanha pode apagar centenas de opções) e não cria cards sem aprovação.
- **Vault:** `1 Copies/` tem na prática duas pastas, `1 Priorizar` e `2 Publicados` (o `CLAUDE.md` do vault ainda
  descreve quatro). Tags seguem `<produto>/<funil>` (ex.: `🤖fia/ad-vsl`), o que ajuda a separar workspaces, mas não
  cobre todas as notas.

## Em aberto

1. **Fontes do radar na v1 (Q7).** Recomendação: YouTube + web + concorrentes do YouTube, as mais estáveis; X e Instagram
   depois. O X entra já se o coletor do Mac mini ainda estiver vivo — **confirmar**.
2. **Concorrentes e referências por workspace (Q8).** 5 a 10 nomes por workspace, separando **rivais** (disputam o mesmo
   público) de **referências** (formato a estudar).
3. **Design system escolhido** entre os 31.
4. **Stack do front e do backend:** framework do front, linguagem do backend (Python ou TypeScript para o SDK), banco do
   app (sinais e ideias salvas), agendador do radar.
5. **Wireframes das telas restantes** (mesa, skills, calendário, config) no layout navbar + 70/30.
6. **Onde o app mora:** este repositório (`20-neo-obsidian`) ou uma pasta nova.
