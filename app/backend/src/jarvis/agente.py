"""O chat do Jarvis: uma sessão do Claude Code por conversa, rodando dentro do vault."""
import json
from pathlib import Path
from typing import AsyncIterator

from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, HookMatcher, ResultMessage,
                              StreamEvent, ToolUseBlock, create_sdk_mcp_server, tool)

from . import db, youtube
from .config import ESCRITA_LIVRE, MODELO_CHAT, VAULT

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


SERVIDOR_MCP = create_sdk_mcp_server("jarvis", tools=[_transcrever_youtube])

INSTRUCOES = """
# Você é o Jarvis, no app Jarvis Conteúdo

Você conversa com o Rodrigo dentro de um painel web local feito para ele ter ideias de conteúdo (Reels e carrosséis
no Instagram) e transformá-las em roteiros. O diretório atual é o vault do Obsidian dele: use as notas como base de
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
        allowed_tools=["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Skill", "TodoWrite",
                       "mcp__jarvis__transcrever_youtube"],
        permission_mode="acceptEdits", resume=sessao, include_partial_messages=True,
        system_prompt={"type": "preset", "preset": "claude_code", "append": INSTRUCOES + contexto},
        hooks={"PreToolUse": [HookMatcher(matcher="Write|Edit", hooks=[_guarda_escrita])]},
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
    if isinstance(alvo, str) and alvo.startswith(str(VAULT)):
        alvo = alvo[len(str(VAULT)) + 1:]
    return str(alvo)[:90]


def _erro_legivel(msg: str) -> str:
    if "authenticate" in msg or "OAuth" in msg:
        return "O login do Claude Code expirou. Rode `claude /login` num terminal e tente de novo."
    return msg[:400]


async def conversar(conversa: str, texto: str, sinal_id: int | None = None) -> AsyncIterator[dict]:
    """Envia uma mensagem e devolve eventos para o front: texto (delta), ferramenta, fim, erro."""
    db.guardar_mensagem(conversa, "usuario", texto)
    sessao = db.sessao_da_conversa(conversa)
    resposta: list[str] = []
    try:
        async with ClaudeSDKClient(_opcoes(sessao, _contexto_sinal(sinal_id))) as cli:
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
