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


FERRAMENTAS_CANVAS = [_transcrever_youtube, _criar_ideia, _criar_saida, _ligar, _criar_entrada, _posicionar]
SERVIDOR_MCP = create_sdk_mcp_server("jarvis", tools=FERRAMENTAS_CANVAS)
NOMES_MCP = [f"mcp__jarvis__{n}" for n in ("transcrever_youtube", "criar_ideia", "criar_saida", "ligar_ao_canvas",
                                           "criar_entrada", "posicionar")]

INSTRUCOES = """
# Você é o Jarvis, no app Neo-Obsidian

Você conversa com o Rodrigo dentro de um app web local feito para ele ter ideias de conteúdo e transformá-las em
roteiros. A tela principal é um canvas: 💡 ideias (`1 Copies/0 Ideias/`), entradas de material bruto
(`1 Copies/0 Ideias/Entradas/`, ligadas à ideia pela propriedade `fontes:`) e produções, as copies de `1 Copies`, que
pertencem a uma ideia pela propriedade `ideia: "[[💡 Nome]]"`. Uma ideia gera várias saídas (📱 Reels, 💰 Ad, 🏞️
Carrossel...) da mesma copy com adaptações; as saídas têm o mesmo nome da ideia, só muda o emoji (e um sufixo como
"LP" ou "VSL" se precisar). Para criar e ligar essas notas, prefira as ferramentas `criar_ideia`, `criar_saida`,
`criar_entrada` e `ligar_ao_canvas` (elas cuidam do frontmatter); o canvas se atualiza sozinho depois da resposta. O diretório atual é o vault do Obsidian dele: use as notas como base de
conhecimento e as skills dele (`3 Skills/`) para hooks, roteiros e carrosséis.

- Responda em PT-BR, curto e direto; o chat ocupa uma coluna estreita. Use listas curtas, nada de tabelas largas.
- Você pode escrever sem perguntar só em `1 Copies/0 Ideias/` e `1 Copies/1 Priorizar/`. Fora delas, proponha a mudança
  e espere o Rodrigo confirmar no chat; o app bloqueia a escrita direta.
- Notas novas seguem o template `2 Notas/Engine/templates/T - Copy.md` e a convenção de emojis do CLAUDE.md do vault.
- Quando o contexto trouxer um sinal do radar, trate-o como a fonte da conversa.
- Mensagem que começa com `📡 Sinal do radar · fonte · autor · url` seguida de linhas `> ...` traz o sinal do radar que o
  Rodrigo está vendo; "este", "isso" e afins se referem a ele. Abra a url se precisar de mais detalhe.
- Mensagem que começa com `📎 [[nota]] · linhas X–Y · `caminho`` seguida de linhas `> ...` traz um trecho que o Rodrigo
  selecionou no editor do app. "Isso", "esse trecho" e afins se referem a ele. Para editar, leia o arquivo e use Edit
  trocando exatamente esse trecho (o texto da nota já está salvo no disco); o app recarrega a nota sozinho depois da
  resposta. Pedido de reescrita ou encurtamento: aplique direto na nota e responda só com o resultado e uma linha do que
  mudou. Pedido de hooks ou ideias: responda no chat, sem mexer na nota.
- Link do YouTube no chat: use `transcrever_youtube` pra ler a legenda (não precisa de WebFetch pra isso, a página
  do YouTube não carrega o texto). Nunca diga que não consegue assistir vídeo do YouTube.
"""


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
"""


async def _guarda_app(entrada, tool_use_id, contexto):
    alvo = (entrada.get("tool_input") or {}).get("file_path", "")
    p = Path(alvo if Path(alvo).is_absolute() else APP / alvo).resolve()
    if p.is_relative_to(APP.resolve()) and not p.is_relative_to((APP / "dados").resolve()):
        return {}
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": "No modo construtor só dá para escrever no código do app."}}


def _opcoes_app(sessao: str | None) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        cwd=str(APP), setting_sources=["user"], model=MODELO_CHAT,
        tools=["Read", "Glob", "Grep", "Write", "Edit", "TodoWrite"],
        allowed_tools=["Read", "Glob", "Grep", "TodoWrite"],
        permission_mode="acceptEdits", resume=sessao, include_partial_messages=True,
        system_prompt={"type": "preset", "preset": "claude_code", "append": INSTRUCOES_APP},
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


async def conversar(conversa: str, texto: str, sinal_id: int | None = None, modo: str = "vault") -> AsyncIterator[dict]:
    """Envia uma mensagem e devolve eventos para o front: texto (delta), ferramenta, fim, erro."""
    db.guardar_mensagem(conversa, "usuario", texto)
    sessao = db.sessao_da_conversa(conversa)
    resposta: list[str] = []
    try:
        if modo == "app":
            construtor.ponto(texto)
        opcoes = _opcoes_app(sessao) if modo == "app" else _opcoes(sessao, _contexto_sinal(sinal_id))
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
