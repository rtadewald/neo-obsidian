"""O chat do Jarvis: uma sessão do Claude Code por conversa, rodando dentro do vault (ou no código do app, no modo construtor)."""
import json
from pathlib import Path
from typing import AsyncIterator

from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, HookMatcher, ResultMessage,
                              StreamEvent, ToolUseBlock, create_sdk_mcp_server, tool)

from . import canvas, construtor, db, youtube
from .config import APP, ESCRITA_LIVRE, MODELO_CHAT, VAULT

FERRAMENTAS = ["Read", "Glob", "Grep", "Write", "Edit", "WebSearch", "WebFetch", "Skill", "TodoWrite"]


@tool("transcrever_youtube", "Pega a legenda (manual ou automática) de um vídeo do YouTube como texto corrido, "
      "pra ler o conteúdo sem precisar assistir. Usa o link ou o ID do vídeo.", {"url": str})
async def _transcrever_youtube(args: dict) -> dict:
    d = youtube.transcrever(args["url"])
    if "erro" in d:
        return {"content": [{"type": "text", "text": f"Não consegui: {d['erro']}"}], "is_error": True}
    aviso = " (legenda automática, pode ter erros)" if d["gerada"] else ""
    cab = f"Transcrição em {d['idioma']}{aviso}, ~{d['duracao_min']} min:\n\n"
    return {"content": [{"type": "text", "text": cab + d["texto"]}]}


def _ok(texto: str) -> dict:
    return {"content": [{"type": "text", "text": texto}]}


def _falha(e: Exception) -> dict:
    return {"content": [{"type": "text", "text": f"Não consegui: {type(e).__name__}: {e}"}], "is_error": True}


@tool("criar_ideia", "Cria uma 💡 ideia no canvas (nota em 1 Copies/0 Ideias). `fontes` são nomes de notas de entrada "
      "já existentes, separados por vírgula (pode ser vazio).", {"titulo": str, "brief": str, "fontes": str})
async def _criar_ideia(args: dict) -> dict:
    try:
        fontes = [f.strip() for f in (args.get("fontes") or "").split(",") if f.strip()]
        d = canvas.criar_ideia(args["titulo"], args.get("brief", ""), fontes)
        return _ok(f"Criada: [[{d['nome']}]]")
    except Exception as e:
        return _falha(e)


@tool("criar_saida", "Cria uma produção (copy) em 1 Priorizar ligada a uma 💡 ideia, já com o texto. `formato` é um "
      "destes emojis: 📱 Reels, 📺 VSL, 📝 Feed, 💰 Ad, 🏞️ Carrossel, 🎥 YouTube, 🎙️ Live, 🗣️ Stories. `titulo` é "
      "opcional (padrão: emoji + nome da ideia).", {"ideia": str, "formato": str, "titulo": str, "texto": str})
async def _criar_saida(args: dict) -> dict:
    try:
        d = canvas.criar_saida(args["ideia"], args["formato"], args.get("titulo", ""), args.get("texto", ""))
        return _ok(f"Criada: [[{d['nome']}]] em 1 Copies/1 Priorizar")
    except Exception as e:
        return _falha(e)


@tool("ligar_ao_canvas", "Liga notas no canvas. tipo='entrada': põe a entrada `nota` nas fontes da ideia. "
      "tipo='producao': marca a copy `nota` (de 1 Priorizar ou 2 Publicados) como saída da ideia. "
      "`desligar`=true desfaz.", {"ideia": str, "nota": str, "tipo": str, "desligar": bool})
async def _ligar(args: dict) -> dict:
    try:
        sim = not args.get("desligar")
        if args["tipo"] == "entrada":
            canvas.ligar_fonte(args["ideia"], args["nota"], sim)
        else:
            raiz = "priorizar" if (canvas.notas.PRIORIZAR / f"{args['nota']}.md").is_file() else "publicados"
            canvas.ligar_producao(raiz, args["nota"], args["ideia"] if sim else None)
        return _ok("Feito.")
    except Exception as e:
        return _falha(e)


@tool("criar_entrada", "Cria uma entrada (material bruto) a partir de um link ou de um texto: lê a página ou a "
      "transcrição do YouTube e guarda numa nota em 0 Ideias/Entradas. `ideia` opcional já liga a ela.",
      {"conteudo": str, "ideia": str})
async def _criar_entrada(args: dict) -> dict:
    try:
        d = canvas.criar_entrada(args["conteudo"], args.get("ideia") or None)
        return _ok(f"Criada: [[{d['nome']}]]")
    except Exception as e:
        return _falha(e)


@tool("posicionar", "Põe um card do canvas ao lado de outro. Use o nome das notas.", {"card": str, "perto_de": str})
async def _posicionar(args: dict) -> dict:
    try:
        canvas.posicionar_perto(args["card"], args["perto_de"])
        return _ok("Posicionado.")
    except Exception as e:
        return _falha(e)


@tool("mudar_status", "Muda o status de uma copy (nome da nota, sem .md): ideia (Priorizar/backlog), edicao, agendado "
      "ou publicado. Renomeia (🧑🏼‍🔧/🔹 no começo do nome) ou move para 1 Copies/2 Publicados com publicado: true, "
      "e leva o card do canvas junto. Nunca faça isso renomeando ou movendo o arquivo à mão.", {"nota": str, "status": str})
async def _mudar_status(args: dict) -> dict:
    try:
        d = canvas.mudar_status(args["nota"], args["status"])
        return _ok(f"Feito: [[{d['nome']}]] em {canvas.notas.RAIZES[d['raiz']]}")
    except Exception as e:
        return _falha(e)


@tool("agendar", "Define a data de publicação (scheduled) de uma copy. `data` no formato AAAA-MM-DD. Não muda o status: "
      "para marcar como agendada, use também mudar_status com status=agendado.", {"nota": str, "data": str})
async def _agendar(args: dict) -> dict:
    try:
        raiz, nome = canvas.achar(args["nota"])
        canvas.notas.mudar_agenda(raiz, nome, args["data"])
        return _ok("Agendada.")
    except Exception as e:
        return _falha(e)


@tool("colocar_na_caixa", "Põe notas numa caixa do canvas (grava `grupo:` nelas e põe o card dentro da caixa). `notas`: nomes "
      "separados por | . `caixa`: nome exato de uma caixa existente (use listar_caixas); vazio tira da caixa.",
      {"notas": str, "caixa": str})
async def _colocar_na_caixa(args: dict) -> dict:
    try:
        nomes = [n.strip() for n in args["notas"].split("|") if n.strip()]
        d = canvas.colocar_na_caixa(nomes, args.get("caixa") or None)
        return _ok(f"{len(d['cards'])} card(s) {'na caixa ' + d['caixa'] if d['caixa'] else 'fora das caixas'}.")
    except Exception as e:
        return _falha(e)


@tool("listar_caixas", "Lista as caixas do canvas (nome, se está arquivada e quantas notas têm o grupo dela).", {})
async def _listar_caixas(args: dict) -> dict:
    try:
        return _ok(json.dumps(canvas.listar_caixas(), ensure_ascii=False))
    except Exception as e:
        return _falha(e)


@tool("marcar_winner", "Marca (ou desmarca, com sim=false) uma copy como winner 🔥: põe/tira a tag 🔥 nas tags da nota. "
      "O card ganha borda vermelha no canvas.", {"nota": str, "sim": bool})
async def _marcar_winner(args: dict) -> dict:
    try:
        raiz, nome = canvas.achar(args["nota"])
        canvas.marcar_winner([{"raiz": raiz, "nome": nome}], args.get("sim", True) is not False)
        return _ok("Feito.")
    except Exception as e:
        return _falha(e)


FERRAMENTAS_CANVAS = [_transcrever_youtube, _criar_ideia, _criar_saida, _ligar, _criar_entrada, _posicionar,
                      _mudar_status, _agendar, _colocar_na_caixa, _listar_caixas, _marcar_winner]
SERVIDOR_MCP = create_sdk_mcp_server("jarvis", tools=FERRAMENTAS_CANVAS)
NOMES_MCP = [f"mcp__jarvis__{n}" for n in ("transcrever_youtube", "criar_ideia", "criar_saida", "ligar_ao_canvas",
                                           "criar_entrada", "posicionar", "mudar_status", "agendar", "colocar_na_caixa",
                                           "listar_caixas", "marcar_winner")]

INSTRUCOES = """
# Você é o Jarvis, no app Neo-Obsidian

Você conversa com o Rodrigo dentro do Neo-Obsidian, um app web local por cima do vault do Obsidian dele (o diretório
atual). O app não tem banco de notas: ele lê e escreve os mesmos `.md` do vault. Você também. O guia completo do app
(regras, telas, gestos) está em `__AGENTS__`: leia quando precisar de detalhe.

## As pastas e o de-para (é o vault que manda; o app só mostra)
- `1 Copies/0 Ideias/💡 Nome.md` → 💡 ideia. Pode ter o material bruto dentro (link, transcrição, texto) e `url`,
  `tipo`, `thumb` no frontmatter. Sem status.
- `1 Copies/1 Priorizar/` → copies vivas. Status pelo começo do nome: sem marca = ideia/backlog; `🧑🏼‍🔧` = em edição;
  `🔹` = agendada.
- `1 Copies/2 Publicados/` → publicadas, com `publicado: true`.
- Formato pelo emoji depois da marca: 📱 Reels · 💰 Ad · 🏞️ Carrossel · 📺 VSL · 🎥 YouTube · 📝 Feed · 🎙️ Live · 🗣️ Stories.
  (De-para já aplicado: 🔥 virou tag, não formato; ✅ CTA virou 💰; 🎣 virou 📱.)
- Frontmatter de copy (`2 Notas/Engine/templates/T-Copy.md`): `publicado`, `scheduled: "AAAA-MM-DD"`,
  `ideia: "[[💡 Nome]]"`, `grupo` (caixa), `notion` (link do card no Notion), `tags` (lista; vazia fica `tags:`, nunca
  apague a chave).
- **Notion ↔ Obsidian**: toda copy tem (ou deve ter) o card dela na base do Notion "Edição e Publicação - 2026"
  (Marketing). Quando você criar, agendar, publicar ou achar o card de uma copy no Notion, grave o link na propriedade
  `notion:` da nota (vários cards da mesma copy — LP e VSL, versões, retestes — viram lista). Para achar: o título do
  card vem com códigos (`[VSL]_1090_Caveman`, `P2🟡BF26_Claude_Mods_Carrinho`, `… — v15`); compare pelo nome da copy, pelo
  formato (📱 = 📸 Reels / Tiktok, 💰 = 💰 Criativo, 📺 = 📺 VSL) e por [VSL]/[LP] e Captura/Carrinho.
- Links sempre `[[título]]`. `ideia:` sempre entre aspas.
- `3 Skills/<nome>/SKILL.md` → as skills dele (use para hooks, roteiros, carrosséis, VSLs).

## O canvas (a tela principal)
- Três tipos de card: 💡 ideia, 🎬 produção e 📺 VSL. Uma produção junta as versões curtas da mesma copy (Reels,
  carrosséis, ads… com o mesmo `ideia:`), um chip por formato; copy sem `ideia:` é uma produção de uma nota só.
  Cada VSL (📺) tem card próprio, nunca entra numa produção, ligada por uma linha à ideia quando tem `ideia:`.
- As saídas de uma ideia têm o mesmo nome; só muda o emoji (e um sufixo como "LP" ou "VSL" se precisar).
- Caixas: retângulos coloridos que agrupam por tema; quem está dentro tem `grupo: "<caixa>"`. Publicada fora de caixa
  ativa some do canvas (fica nas pastas da direita: Em edição, Agendado, Publicado, Caixas, que abrem tabelas).
- 🔥 winner = tag `🔥` nas tags: o card ganha borda vermelha.
- As abas X e Sites são o radar (sinais da internet); 👍 ensina o gosto dele e 💡 vira ideia no canvas.

## Como agir (use as ferramentas: elas mantêm links, pins do Obsidian e o lugar do card no canvas)
- Criar ideia: `criar_ideia` (ou `criar_entrada` com um link/texto, que lê a página ou a transcrição).
- Criar uma versão de uma ideia: `criar_saida` (já com o texto). Juntar copies que já existem numa produção:
  `ligar_ao_canvas` com tipo=producao.
- Mudar status ou publicar: `mudar_status`. Data: `agendar`. Caixa: `listar_caixas` e `colocar_na_caixa`.
  Winner: `marcar_winner`. Posição: `posicionar`.
- Nunca renomeie, mova ou apague arquivos à mão para mudar status ou pasta: a ferramenta faz isso direito.
- Você escreve sem perguntar só em `1 Copies/0 Ideias/` e `1 Copies/1 Priorizar/` (Edit/Write); fora delas, proponha e
  espere o Rodrigo confirmar no chat (o app bloqueia). Editar texto de uma copy: Edit direto no arquivo, sem mexer no
  frontmatter além do necessário.
- O canvas se atualiza sozinho depois da sua resposta.

## Conversa
- Responda em PT-BR, curto e direto; o chat ocupa uma coluna estreita. Listas curtas, nada de tabelas largas.
- Mensagem que começa com `📡 Sinal do radar · fonte · autor · url` seguida de linhas `> ...` traz o sinal do radar que o
  Rodrigo está vendo; "este", "isso" e afins se referem a ele. Abra a url se precisar de mais detalhe.
- Mensagem que começa com `📎 [[nota]] · linhas X–Y · `caminho`` seguida de linhas `> ...` traz um trecho que o Rodrigo
  selecionou no editor do app. "Isso", "esse trecho" e afins se referem a ele. Para editar, leia o arquivo e use Edit
  trocando exatamente esse trecho (o texto da nota já está salvo no disco); o app recarrega a nota sozinho depois da
  resposta. Pedido de reescrita ou encurtamento: aplique direto na nota e responda só com o resultado e uma linha do que
  mudou. Pedido de hooks ou ideias: responda no chat, sem mexer na nota.
- Linha `🖼️ ![[Pasted image ….png]]` é uma imagem que o Rodrigo colou no chat: abra com Read em
  `2 Notas/Engine/attachments/<nome>` (você vê a imagem) antes de responder. Ela já está no vault: para usá-la numa nota,
  basta escrever o mesmo `![[...]]`.
- Link do YouTube no chat: use `transcrever_youtube` pra ler a legenda (não precisa de WebFetch pra isso, a página
  do YouTube não carrega o texto). Nunca diga que não consegue assistir vídeo do YouTube.
""".replace("__AGENTS__", str(APP.parent / "AGENTS.md"))


def _dentro(caminho: str) -> bool:
    p = Path(caminho if Path(caminho).is_absolute() else VAULT / caminho).resolve()
    return any(p.is_relative_to(d.resolve()) for d in ESCRITA_LIVRE)


async def _guarda_escrita(entrada, tool_use_id, contexto):
    """PreToolUse: Write/Edit só nas pastas liberadas (Q30). Roda sempre, mesmo com regras de allow do usuário."""
    alvo = (entrada.get("tool_input") or {}).get("file_path", "")
    if _dentro(alvo):
        return {}
    return {"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny",
        "permissionDecisionReason": f"O Jarvis só escreve em 1 Copies/0 Ideias e 1 Copies/1 Priorizar. "
                                    f"Mostre a mudança para {alvo} no chat e peça confirmação ao Rodrigo."}}


def _opcoes(sessao: str | None, contexto: str) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        cwd=str(VAULT), setting_sources=["user", "project"], model=MODELO_CHAT,
        tools=FERRAMENTAS, mcp_servers={"jarvis": SERVIDOR_MCP},
        allowed_tools=["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Skill", "TodoWrite", *NOMES_MCP],
        permission_mode="acceptEdits", resume=sessao, include_partial_messages=True,
        system_prompt={"type": "preset", "preset": "claude_code", "append": INSTRUCOES + contexto},
        hooks={"PreToolUse": [HookMatcher(matcher="Write|Edit", hooks=[_guarda_escrita])]},
    )


INSTRUCOES_APP = """
# Você é o Jarvis, no modo construtor do Neo-Obsidian

O Rodrigo está usando o app agora e pediu uma mudança nele. O diretório atual é o código do app: `backend/`
(FastAPI, Python, `uv`) e `frontend/` (React + Vite + TypeScript, CSS em `frontend/src/index.css`). O Vite recarrega a
tela sozinho quando você salva um arquivo do front; mudança no backend precisa reiniciar a API (avise).

- Responda em PT-BR, curto. Faça a mudança pedida e diga em uma linha o que mudou.
- Você só escreve dentro desta pasta. Não mexa em `dados/` (banco e layout do usuário).
- Antes de cada pedido o app guarda um ponto de restauração; o Rodrigo tem um botão "desfazer" no chat.
- Siga o estilo do código que já existe: nomes em PT-BR, poucos comentários, sem abstrações a mais.
- Antes de mexer, leia o guia do app em `__AGENTS__` (regras, modelo do canvas, armadilhas conhecidas).
""".replace("__AGENTS__", str(APP.parent / "AGENTS.md"))


async def _guarda_app(entrada, tool_use_id, contexto):
    alvo = (entrada.get("tool_input") or {}).get("file_path", "")
    p = Path(alvo if Path(alvo).is_absolute() else APP / alvo).resolve()
    if p.is_relative_to(APP.resolve()) and not p.is_relative_to((APP / "dados").resolve()):
        return {}
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": "No modo construtor só dá para escrever no código do app."}}


def _opcoes_app(sessao: str | None, aqui: str = "") -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        cwd=str(APP), setting_sources=["user"], model=MODELO_CHAT,
        tools=["Read", "Glob", "Grep", "Write", "Edit", "TodoWrite"],
        allowed_tools=["Read", "Glob", "Grep", "TodoWrite"],
        permission_mode="acceptEdits", resume=sessao, include_partial_messages=True,
        system_prompt={"type": "preset", "preset": "claude_code", "append": INSTRUCOES_APP + aqui},
        hooks={"PreToolUse": [HookMatcher(matcher="Write|Edit", hooks=[_guarda_app])]},
    )


def _contexto_sinal(sinal_id: int | None) -> str:
    s = db.sinal(sinal_id) if sinal_id else None
    if not s:
        return ""
    campos = {k: s[k] for k in ("fonte", "titulo", "url", "resumo", "autor", "destaque", "tipo", "porque")}
    return "\n## Sinal do radar em foco\n```json\n" + json.dumps(campos, ensure_ascii=False, indent=1) + "\n```\n"


def _resumo_ferramenta(b: ToolUseBlock) -> str:
    i = b.input or {}
    alvo = i.get("file_path") or i.get("pattern") or i.get("query") or i.get("url") or i.get("skill") or ""
    for raiz in (str(VAULT), str(APP)):
        if isinstance(alvo, str) and alvo.startswith(raiz):
            alvo = alvo[len(raiz) + 1:]
    return str(alvo)[:90]


def _erro_legivel(msg: str) -> str:
    if "authenticate" in msg or "OAuth" in msg:
        return "O login do Claude Code expirou. Rode `claude /login` num terminal e tente de novo."
    return msg[:400]


async def conversar(conversa: str, texto: str, sinal_id: int | None = None, modo: str = "vault", onde: str = "") -> AsyncIterator[dict]:
    """Envia uma mensagem e devolve eventos para o front: texto (delta), ferramenta, fim, erro."""
    db.guardar_mensagem(conversa, "usuario", texto)
    sessao = db.sessao_da_conversa(conversa)
    resposta: list[str] = []
    try:
        if modo == "app":
            construtor.ponto(texto)
        # onde o Rodrigo está no app agora (tela, canvas, caixa, nota aberta, seleção): vai em toda mensagem
        aqui = f"\n## Onde o Rodrigo está no app agora\n{onde.strip()}\n" if onde.strip() else ""
        opcoes = _opcoes_app(sessao, aqui) if modo == "app" else _opcoes(sessao, _contexto_sinal(sinal_id) + aqui)
        async with ClaudeSDKClient(opcoes) as cli:
            await cli.query(texto)
            async for m in cli.receive_response():
                if isinstance(m, StreamEvent):
                    ev = m.event
                    if ev.get("type") == "content_block_delta" and ev.get("delta", {}).get("type") == "text_delta" \
                            and not m.parent_tool_use_id:
                        resposta.append(ev["delta"]["text"])
                        yield {"t": "texto", "v": ev["delta"]["text"]}
                    elif ev.get("type") == "message_start" and resposta and not m.parent_tool_use_id:
                        resposta.append("\n\n")
                        yield {"t": "texto", "v": "\n\n"}
                elif isinstance(m, AssistantMessage) and not m.parent_tool_use_id:
                    for b in m.content:
                        if isinstance(b, ToolUseBlock):
                            yield {"t": "ferramenta", "nome": b.name, "alvo": _resumo_ferramenta(b)}
                elif isinstance(m, ResultMessage):
                    db.guardar_sessao(conversa, m.session_id)
                    if m.is_error:
                        yield {"t": "erro", "v": _erro_legivel(m.result or m.subtype)}
                    yield {"t": "fim", "sessao": m.session_id, "custo": m.total_cost_usd}
    except Exception as e:
        yield {"t": "erro", "v": _erro_legivel(str(e))}
    finally:
        final = "".join(resposta).strip()
        if final:
            db.guardar_mensagem(conversa, "jarvis", final)
