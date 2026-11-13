# Jarvis Conteúdo — v0

Painel de ideias vivas com o chat do Jarvis à direita. Decisões e escopo: [../specs.md](../specs.md).

## Rodar

```bash
uv run --directory backend jarvis        # API em http://127.0.0.1:8740
npm --prefix frontend run dev            # app em http://localhost:5180
```

No Claude Code desta pasta, os dois estão em `.claude/launch.json` (`jarvis-api` e `jarvis-web`).

**Login:** o agente usa a assinatura do Claude Code (decisão Q9), não chave de API. Se o chat ou a classificação
reclamarem de autenticação, rode `claude /login` num terminal. A troca para chave de API fica só em
`backend/src/jarvis/auth.py`.

## O que a v0 faz

- **Radar:** coleta GitHub Trending, Hugging Face Trending (modelos e spaces) e a primeira página do Hacker News, sem
  login e sem LLM (`backend/src/jarvis/coletores/fontes.py`). A nota de 0 a 100 é relativa ao 1º de cada fonte na
  coleta. O Haiku classifica o tipo e escreve o "por que importa" dos sinais novos (`radar.py`).
  Coletar pela linha de comando (para agendar no `launchd`): `uv run --directory backend python -m jarvis.radar`.
- **Cards:** salvar, descartar, abrir a fonte e levar para o chat (o card vira o contexto da conversa). Filtros por tipo
  e por fonte; "Salvos" mostra só os salvos.
- **Chat:** uma sessão do Claude Code retomada a cada mensagem (`agente.py`), rodando dentro do vault com o `CLAUDE.md`
  e as skills. Lê o vault inteiro; escreve sozinho só em `1 Copies/0 Ideias/` e `1 Copies/1 Priorizar/` (um hook
  `PreToolUse` bloqueia o resto). Sem Bash.
- **Dados:** SQLite em `dados/jarvis.db` (fora do git).

- **X:** `coletores/x.py` abre uma sessão do SDK com `--chrome` (Claude in Chrome, no Chrome do Rodrigo já logado), lê o
  feed "Para você" rolando a página por script (~50 posts, sem anúncios), fecha a aba e grava. Só leitura. Leva ~2 min e
  roda junto com "Atualizar". Detalhes que custaram testes:
  - com `tools=[]` as ferramentas do Chrome ficam adiadas e invisíveis: a sessão desliga `ENABLE_TOOL_SEARCH` e os
    conectores da conta (`ENABLE_CLAUDEAI_MCP_SERVERS`);
  - o `javascript_tool` não espera Promises, corta a saída em ~1 mil caracteres e bloqueia texto com `chave=valor` ou query
    string: o script roda em segundo plano, o modelo só confere "PRONTO", e o JSON chega como download em `~/Downloads`
    (`jarvis-x-<id>.json`), que o backend lê e apaga;
  - posts sem relação com tecnologia viram tipo `fora` e ficam escondidos (aba "Fora do tema").

- **Calendário:** `metricool.py` abre uma sessão do SDK que herda o conector **Metricool** da conta claude.ai (espera
  ele conectar, uns 2 s) e só pode chamar ferramentas de leitura (`can_use_tool` nega agendar/editar). Traz os Reels e
  posts dos últimos 60 dias com números e os agendados dos próximos 45, grava em `posts` e baixa as miniaturas para
  `dados/thumbs` (os links do Instagram expiram; o agendado usa o 1º quadro do vídeo, via ffmpeg). Botão "Sincronizar"
  na página; pela linha de comando: `uv run --directory backend python -m jarvis.metricool`.
- **Skills:** o orbe lima no canto inferior esquerdo abre o leque com as 18 skills de `3 Skills/` (e Config); a página
  Skills lê o `SKILL.md` (só leitura).

## Ainda não

- Instagram com conta dedicada.
- Metricool (depende do plano, Q32), mesa da ideia, Skills, Calendário, Config, seletor de temas.
- Agendamento automático do radar (`launchd`).

## Novidades (10/11/2026)

- **Radar: like/deslike.** 👍 fixa o sinal no topo e ensina o ranking; 👎 tira do feed e ensina o contrário. A pontuação junta 55% do potencial na fonte, 30% do interesse (nota do Haiku a partir dos seus votos) e até ±20 pela afinidade local com fonte, tipo, autor e palavras dos sinais votados (`preferencias.py`). Passe o mouse no número para ver a conta. O botão **Reavaliar** aparece a partir de 3 votos e refaz o interesse dos 120 sinais mais recentes.
- **Radar: vídeos do X tocam no card.** O MP4 vem do FxTwitter (`api.fxtwitter.com`, público) e fica guardado em `metricas.video`. Toca mudo quando metade do card está visível e pausa quando sai da tela; o clique liga o som. O `index.html` usa `referrer: no-referrer` porque o CDN do X recusa (403) pedidos com Referer de outro site.
- **Ideias: notas como no Obsidian.** Abre as copies de `1 Copies/1 Priorizar` e as skills de `3 Skills`, com leitura renderizada (propriedades, wikilinks, tarefas, callouts) e edição no CodeMirror. Salva sozinho 1 s depois de você parar de digitar e também no ⌘S. Se o arquivo mudou no Obsidian, o app avisa em vez de sobrescrever. **Nova copy** cria a nota em Priorizar com o frontmatter de Copy. As skills do orbe também abrem aqui.
- **Desempenho: Meta Ads pelo Metricool.** Mostra investimento por dia, resultados, custo por resultado, ROAS, CTR, CPM e CPC, a tabela de campanhas e os anúncios ranqueados pelo custo por resultado. São quatro consultas de leitura (anúncio × dia, evolution, campaigns, ads) dos últimos 30 dias (`anuncios.py`). Rode pelo botão Sincronizar ou com `uv run python -m jarvis.anuncios`.
