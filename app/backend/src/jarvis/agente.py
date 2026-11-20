"""O chat do app: uma sessão do Claude Code (Claude Agent SDK) por conversa, rodando dentro do vault, com as skills de
lá. Ele usa o app como o Rodrigo usa: a ferramenta `app` chama as mesmas rotas da API que a interface chama, e `tela`
mexe na tela dele (trocar de página, abrir uma copy numa aba da Redação)."""
import inspect
import json
from typing import AsyncIterator

import httpx
from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, ResultMessage, StreamEvent,
                              ToolUseBlock, create_sdk_mcp_server, tool)

from . import copies, db, notas, youtube
from .config import APP, MODELO_CHAT, VAULT

FERRAMENTAS = ["Read", "Glob", "Grep", "Write", "Edit", "Bash", "WebSearch", "WebFetch", "Skill", "TodoWrite"]
PAGINAS = ["Redação", "Calendário", "Skills", "Instagram", "X", "Sites", "Agendamento"]


def _ok(texto: str) -> dict:
    return {"content": [{"type": "text", "text": texto}]}


def _falha(e: Exception) -> dict:
    return {"content": [{"type": "text", "text": f"Não consegui: {type(e).__name__}: {e}"}], "is_error": True}


@tool("transcrever_youtube", "Pega a legenda (manual ou automática) de um vídeo do YouTube como texto corrido, "
      "pra ler o conteúdo sem precisar assistir. Usa o link ou o ID do vídeo.", {"url": str})
async def _transcrever_youtube(args: dict) -> dict:
    d = youtube.transcrever(args["url"])
    if "erro" in d:
        return {"content": [{"type": "text", "text": f"Não consegui: {d['erro']}"}], "is_error": True}
    aviso = " (legenda automática, pode ter erros)" if d["gerada"] else ""
    return _ok(f"Transcrição em {d['idioma']}{aviso}, ~{d['duracao_min']} min:\n\n" + d["texto"])


# ---------- o app inteiro: a API (o que a interface faz) e a tela do Rodrigo ----------
_eventos: list[dict] = []   # o que as ferramentas pedem ao front nesta resposta (recarregar, trocar de página, abrir nota)


def _api():
    from .main import app as api   # tarde, para não importar main ao importar agente
    return api


@tool("rotas", "Lista as rotas da API do Neo-Obsidian (as mesmas que a interface usa), com o que cada uma faz e o corpo "
      "que recebe. Use antes de `app` quando não souber a rota.", {"filtro": str})
async def _rotas(args: dict) -> dict:
    f = (args.get("filtro") or "").lower()
    linhas = []
    for r in _api().routes:
        caminho, metodos = getattr(r, "path", ""), sorted(getattr(r, "methods", None) or [])
        if not caminho.startswith("/api/") or caminho.startswith(("/api/chat", "/api/eventos")) or f not in caminho.lower():
            continue
        fn = getattr(r, "endpoint", None)
        doc = (inspect.getdoc(fn) or "").split("\n")[0] if fn else ""
        corpo = ""
        for prm in (inspect.signature(fn).parameters.values() if fn else []):
            campos = getattr(prm.annotation, "model_fields", None)
            if campos:
                corpo = " corpo {" + ", ".join(f"{k}: {str(v.annotation).replace('typing.', '')}" for k, v in campos.items()) + "}"
        linhas.append(f"{'/'.join(m for m in metodos if m != 'HEAD')} {caminho}{corpo}{(' · ' + doc) if doc else ''}")
    return _ok("\n".join(linhas) or "Nenhuma rota com esse filtro.")


@tool("app", "Usa o app do jeito que a interface usa: chama uma rota da API do Neo-Obsidian (veja `rotas`). "
      "Status, tags, categoria, data, winner, arquivar, renomear, mover, lixeira, criar copy… `corpo` é JSON (objeto) "
      "ou vazio; em GET vira query. A tela do Rodrigo recarrega sozinha depois de cada mudança.", {
          "type": "object",
          "properties": {"metodo": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE"]},
                         "rota": {"type": "string", "description": "ex.: /api/copies ou /api/copies/status"},
                         "corpo": {"type": "string", "description": "JSON"}},
          "required": ["metodo", "rota"]})
async def _app(args: dict) -> dict:
    try:
        metodo, rota = args["metodo"].upper(), args["rota"].strip()
        if not rota.startswith("/api/") or rota.startswith(("/api/chat", "/api/eventos")):
            raise ValueError("só rotas /api/ do app (fora o próprio chat e o fluxo de eventos)")
        corpo = json.loads(args["corpo"]) if (args.get("corpo") or "").strip() else None
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_api()), base_url="http://neo", timeout=120) as c:
            r = await c.request(metodo, rota, params=corpo if metodo == "GET" and isinstance(corpo, dict) else None,
                                json=corpo if metodo != "GET" else None)
        if metodo != "GET" and r.status_code < 400:
            _eventos.append({"t": "mudou"})
        texto = r.text
        if len(texto) > 24000:
            texto = texto[:24000] + f"\n… (cortado: {len(r.text)} caracteres; filtre ou peça uma rota mais específica)"
        return {"content": [{"type": "text", "text": f"HTTP {r.status_code}\n{texto}"}], "is_error": r.status_code >= 400}
    except Exception as e:
        return _falha(e)


def _achar(alvo: str) -> tuple[str, str]:
    """Acha a nota pelo nome (sem as marcas de status) ou por um pedaço do nome."""
    try:
        return copies.achar(alvo)
    except FileNotFoundError:
        pass
    a = alvo.lower().strip()
    for raiz in ("priorizar", "publicados", "skills"):
        for n, _ in notas._arquivos(raiz):
            if a and a in n.lower():
                return raiz, n
    raise FileNotFoundError(alvo)


@tool("tela", "Mexe na tela do Rodrigo, como ele faria com o mouse: acao = pagina (alvo: Redação, Calendário, Skills, Instagram, X, "
      "Sites ou Agendamento) ou abrir_nota (alvo: nome da nota, ou um pedaço dele; abre numa aba da Redação). "
      "`nova`=true abre numa aba nova em vez da da frente.", {"acao": str, "alvo": str, "nova": bool})
async def _tela(args: dict) -> dict:
    try:
        acao, alvo = args["acao"].strip(), (args.get("alvo") or "").strip()
        ev: dict = {"t": "tela", "acao": acao}
        if acao == "pagina":
            if alvo not in PAGINAS:
                raise ValueError(f"página: {', '.join(PAGINAS)}")
            ev["pagina"] = alvo
        elif acao in ("abrir_nota", "mostrar"):
            raiz, nome = _achar(alvo)
            ev.update(acao="abrir_nota", raiz=raiz, nome=nome, nova=bool(args.get("nova")))
        else:
            raise ValueError("acao: pagina ou abrir_nota")
        _eventos.append(ev)
        return _ok("Feito na tela.")
    except Exception as e:
        return _falha(e)


SERVIDOR_MCP = create_sdk_mcp_server("neo", tools=[_transcrever_youtube, _rotas, _app, _tela])
NOMES_MCP = [f"mcp__neo__{n}" for n in ("transcrever_youtube", "rotas", "app", "tela")]

INSTRUCOES = """
# Você é o chat do Neo-Obsidian

Você conversa com o Rodrigo dentro do Neo-Obsidian, um app web local por cima do vault do Obsidian dele (o diretório
atual). O app não tem banco de notas: ele lê e escreve os mesmos `.md` do vault. Você também. As regras do vault estão
no `CLAUDE.md` dele (já carregado) e o guia do app (telas, rotas, de-para) está em `__AGENTS__`: leia quando precisar.

## As copies (o vault manda; o app só mostra)
- `1 Copies/1 Priorizar/` → copies vivas. `1 Copies/2 Publicados/` → publicadas.
- Status = a propriedade `status:` no frontmatter: ideia → gravar → edicao → agendado → publicado. Publicar move a nota
  para `2 Publicados`. Não existe mais 💡 ideia separada nem canvas: a ideia é a própria copy.
- Formato pelo emoji do começo do nome: 📱 Reels · 💰 Ad · 🏞️ Carrossel · 📺 VSL · 🎥 YouTube · 📝 Feed · 🎙️ Live · 🗣️ Stories.
- Frontmatter da copy (`2 Notas/Engine/templates/T-Copy.md`): `status`, `scheduled: "AAAA-MM-DD"`, `notion` (link do
  card no Notion; vários viram lista), `tags` (lista; vazia fica `tags:`, nunca apague a chave; produto: 🤖fia, 🖼️fid,
  💰bf26, 📊dados; 🔥 = winner), `categoria` (agrupa a Redação, ex.: "📱 Dicas & Hacks"), `arquivado: true` (sai da Criação).
- Links sempre `[[título]]`. `3 Skills/<nome>/SKILL.md` são as skills dele (hooks, roteiros, carrosséis, VSLs): use-as.

## Como agir
- Status, tags, categoria, winner, data, arquivar, renomear, mover, lixeira e criar copy: pela ferramenta `app`, nas
  mesmas rotas que a interface usa (`rotas` lista todas com o corpo). Ex.: `POST /api/copies/status` {notas, status},
  `POST /api/copies/tags` {nome, tags}, `POST /api/copies/categoria` {nomes, categoria},
  `POST /api/notas/{raiz}/{nome}/agenda` {data}, `POST /api/copies/ideia` {titulo, brief, categoria}.
  Nunca renomeie, mova ou apague arquivos à mão para mudar status ou pasta: a rota faz isso direito (links e pins).
- Texto de uma nota: Edit direto no arquivo, sem mexer no frontmatter além do necessário. Nota atômica nova vai em
  `2 Notas/` com o frontmatter do template (`origin`, `tags`). Evite `.obsidian/` e `.trash/`.
- `tela` mexe na tela dele: trocar de página ou abrir uma nota numa aba da Redação. Depois de criar ou mexer numa copy,
  abra com `tela` quando ajudar ele a ver. A tela recarrega sozinha a cada mudança.
- Antes de apagar ou de mexer em muita coisa de uma vez, confirme com ele no chat.

## Terminal (Bash)
- Você tem Bash, como um Claude Code no terminal: baixar vídeo (`yt-dlp`, ou `ffmpeg -i <m3u8>`), extrair áudio
  (`ffmpeg`), transcrever (`whisper <audio> --model small --language Portuguese`, em segundo plano se for longo), scripts.
- Arquivos temporários (vídeo, áudio) vão em `/tmp/jarvis/`, nunca no vault; no vault entra só o resultado (a
  transcrição na nota, uma imagem em `2 Notas/Engine/attachments/`).
- Não há trava: você roda como o Rodrigo. Antes de apagar (prefira `mv` para `~/.Trash`), de mexer em `.obsidian/`, de
  `git push` ou de qualquer coisa sem volta, confirme com ele no chat.

## Conversa
- Responda em PT-BR, curto e direto: o chat ocupa uma coluna estreita. Listas curtas, nada de tabelas largas.
- Cada mensagem pode vir com "Onde o Rodrigo está no app agora" e com a nota aberta: "esta copy", "aqui" = ela.
- Mensagem que começa com `📎 [[nota]] · linhas X–Y · `caminho`` seguida de linhas `> ...` traz um trecho que ele
  selecionou. Para editar, leia o arquivo e use Edit trocando exatamente esse trecho; o app recarrega a nota sozinho.
- Linha `🖼️ ![[Pasted image ….png]]` é uma imagem que ele colou no chat: abra com Read em
  `2 Notas/Engine/attachments/<nome>` antes de responder. Para usá-la numa nota, basta o mesmo `![[...]]`.
- Link do YouTube: use `transcrever_youtube` (a página do YouTube não traz o texto). Nunca diga que não consegue ver.
""".replace("__AGENTS__", str(APP.parent / "AGENTS.md"))


def _opcoes(sessao: str | None, contexto: str) -> ClaudeAgentOptions:
    # sem travas: o Rodrigo quis o chat igual ao Claude Code no terminal (Bash e escrita em qualquer lugar)
    return ClaudeAgentOptions(
        cwd=str(VAULT), setting_sources=["user", "project"], model=MODELO_CHAT,
        tools=FERRAMENTAS, mcp_servers={"neo": SERVIDOR_MCP},
        allowed_tools=["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch", "Skill", "TodoWrite", *NOMES_MCP],
        permission_mode="bypassPermissions", resume=sessao, include_partial_messages=True,
        system_prompt={"type": "preset", "preset": "claude_code", "append": INSTRUCOES + contexto},
    )


def _resumo_ferramenta(b: ToolUseBlock) -> str:
    i = b.input or {}
    alvo = i.get("file_path") or i.get("pattern") or i.get("query") or i.get("url") or i.get("skill") \
        or i.get("rota") or i.get("alvo") or i.get("command") or ""
    for raiz in (str(VAULT), str(APP)):
        if isinstance(alvo, str) and alvo.startswith(raiz):
            alvo = alvo[len(raiz) + 1:]
    return str(alvo)[:90]


def _erro_legivel(msg: str) -> str:
    if "authenticate" in msg or "OAuth" in msg:
        return "O login do Claude Code expirou. Rode `claude /login` num terminal e tente de novo."
    return msg[:400]


def _com_nota(texto: str, nota: dict | None) -> str:
    """Com uma nota aberta no app, a mensagem vai com uma linha dizendo qual (o histórico guarda só o texto dele)."""
    if not nota or not nota.get("nome"):
        return texto
    p = notas._caminho(nota.get("raiz", ""), nota["nome"])
    onde_esta = f" · `{p.relative_to(VAULT)}`" if p and p.is_file() else ""
    return f"[Nota aberta no app agora: [[{nota['nome']}]]{onde_esta}. Quando ele falar de \"esta copy\" ou \"aqui\", é ela.]\n\n{texto}"


async def conversar(conversa: str, texto: str, onde: str = "", nota: dict | None = None) -> AsyncIterator[dict]:
    """Envia uma mensagem e devolve eventos para o front: texto (delta), ferramenta, mudou, tela, fim, erro."""
    db.guardar_mensagem(conversa, "usuario", texto)
    sessao = db.sessao_da_conversa(conversa)
    resposta: list[str] = []
    _eventos.clear()
    try:
        aqui = f"\n## Onde o Rodrigo está no app agora\n{onde.strip()}\n" if onde.strip() else ""
        async with ClaudeSDKClient(_opcoes(sessao, aqui)) as cli:
            await cli.query(_com_nota(texto, nota))
            async for m in cli.receive_response():
                while _eventos:   # o que as ferramentas pediram ao front (recarregar, trocar de página, abrir nota)
                    yield _eventos.pop(0)
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
                    while _eventos:
                        yield _eventos.pop(0)
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
