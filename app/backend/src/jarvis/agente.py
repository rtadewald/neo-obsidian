"""O chat do Jarvis: uma sessão do Claude Code por conversa, rodando dentro do vault. Ele usa o app inteiro como o
Rodrigo usa: a ferramenta `app` chama as mesmas rotas da API que a interface chama, e `tela` mexe na tela dele."""
import inspect
import json
import re
from pathlib import Path
from typing import AsyncIterator

from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, HookMatcher, ResultMessage,
                              StreamEvent, ToolUseBlock, create_sdk_mcp_server, tool)

import httpx

from . import canvas, db, notas, youtube
from .config import APP, MODELO_CHAT, VAULT

FERRAMENTAS = ["Read", "Glob", "Grep", "Write", "Edit", "Bash", "WebSearch", "WebFetch", "Skill", "TodoWrite"]


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


@tool("mover_para_canvas", "Leva notas para outro canvas (grava `grupo:` nelas, com a 💡 ideia e as copies delas juntas, "
      "e dá lugar aos cards lá). `notas`: nomes separados por | . `canvas`: nome de um canvas (use listar_canvas); "
      "vazio ou 'Inbox' tira o grupo (a nota volta para o Inbox).",
      {"notas": str, "canvas": str})
async def _mover_para_canvas(args: dict) -> dict:
    try:
        nomes = [n.strip() for n in args["notas"].split("|") if n.strip()]
        d = canvas.mover_para_canvas(nomes, args.get("canvas") or None)
        return _ok(f"{len(d['cards'])} card(s) em {d['canvas']}.")
    except Exception as e:
        return _falha(e)


@tool("listar_canvas", "Lista os canvas (onde as notas vivem; cada um é um valor de `grupo:`) com quantas notas cada um tem.", {})
async def _listar_canvas(args: dict) -> dict:
    try:
        return _ok(json.dumps(canvas.listar_canvas(), ensure_ascii=False))
    except Exception as e:
        return _falha(e)


@tool("marcar_produto", "Põe (sim=true) ou tira (sim=false) notas de um produto: a tag dele nas tags da nota. "
      "`notas`: nomes separados por | . `produto`: fia, fid, dados ou pico (ou outro de app/dados/produtos.json).",
      {"notas": str, "produto": str, "sim": bool})
async def _marcar_produto(args: dict) -> dict:
    try:
        nomes = [n.strip() for n in args["notas"].split("|") if n.strip()]
        n = canvas.no_produto(nomes, args["produto"].strip().lower(), args.get("sim", True) is not False)
        return _ok(f"{n} nota(s) mudaram.")
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


# ---------- o app inteiro: a API (o que a interface faz) e a tela do Rodrigo ----------
_eventos: list[dict] = []   # o que as ferramentas pedem ao front nesta resposta (recarregar, abrir canvas, mostrar card…)
_canvas_da_vez = "inbox"    # o canvas aberto quando a mensagem chegou: o padrão do X-Canvas


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
        if not caminho.startswith("/api/") or caminho.startswith("/api/chat") or f not in caminho.lower():
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
      "Tudo o que o Rodrigo faz na tela passa por aqui (criar/renomear/arquivar/apagar notas e canvas, mover cards, "
      "posições, status, produto, ligar ideia e produção, desenho do canvas…). `corpo` é JSON (objeto) ou vazio; em GET "
      "vira query. `canvas` é o slug do canvas (vazio = o que o Rodrigo está vendo). O canvas na tela recarrega sozinho "
      "depois de cada mudança.", {
          "type": "object",
          "properties": {"metodo": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE"]},
                         "rota": {"type": "string", "description": "ex.: /api/canvas ou /api/notas/ideias/💡 Nome"},
                         "corpo": {"type": "string", "description": "JSON"},
                         "canvas": {"type": "string"}},
          "required": ["metodo", "rota"]})
async def _app(args: dict) -> dict:
    try:
        metodo, rota = args["metodo"].upper(), args["rota"].strip()
        if not rota.startswith("/api/") or rota.startswith("/api/chat"):
            raise ValueError("só rotas /api/ do app (fora o próprio chat)")
        corpo = json.loads(args["corpo"]) if (args.get("corpo") or "").strip() else None
        cab = {"X-Canvas": (args.get("canvas") or _canvas_da_vez).strip()}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_api()), base_url="http://neo", timeout=120) as c:
            r = await c.request(metodo, rota, headers=cab, params=corpo if metodo == "GET" and isinstance(corpo, dict) else None,
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
    """Acha a nota pelo nome, tolerando o emoji 💡 que falta ou um pedaço do nome."""
    for n in (alvo, f"💡 {alvo}"):
        try:
            return canvas.achar(n)
        except FileNotFoundError:
            pass
    a = alvo.lower()
    for raiz in ("ideias", "priorizar", "publicados", "entradas"):
        for n, _ in notas._arquivos(raiz):
            if a in n.lower():
                return raiz, n
    raise FileNotFoundError(alvo)


def _canvas_da_nota(nome: str) -> str | None:
    t = canvas._todas()
    for item in [*t["ideias"], *t["producoes"]]:
        if nome in (item.get("nome"), *[s.get("nome") for s in item.get("saidas", []) if isinstance(s, dict)]):
            return canvas._canvas_por_nome(item["canvas"])["slug"] if item.get("canvas") else "inbox"
    return None


@tool("tela", "Mexe na tela do Rodrigo, como ele faria com o mouse: acao = pagina (alvo: Canvas, Calendário, X, Sites, "
      "Instagram, Agendamento), abrir_canvas (alvo: nome ou slug do canvas; vazio = página com todos), mostrar (alvo: "
      "nome da nota: abre o canvas dela, enquadra e seleciona o card), abrir_nota (alvo: nome da nota, abre no modal), "
      "fechar_nota, foco (liga/desliga o modo foco).", {"acao": str, "alvo": str})
async def _tela(args: dict) -> dict:
    try:
        acao, alvo = args["acao"].strip(), (args.get("alvo") or "").strip()
        ev: dict = {"t": "tela", "acao": acao}
        if acao == "pagina":
            ev["pagina"] = alvo
        elif acao == "abrir_canvas":
            ev["canvas"] = canvas._canvas_por_nome(alvo)["slug"] if alvo else None
        elif acao in ("mostrar", "abrir_nota"):
            raiz, nome = _achar(alvo)
            ev.update(raiz=raiz, nome=nome, canvas=_canvas_da_nota(nome))
        elif acao not in ("fechar_nota", "foco"):
            raise ValueError("acao: pagina, abrir_canvas, mostrar, abrir_nota, fechar_nota ou foco")
        _eventos.append(ev)
        return _ok("Feito na tela.")
    except Exception as e:
        return _falha(e)


FERRAMENTAS_CANVAS = [_transcrever_youtube, _criar_ideia, _criar_saida, _ligar, _criar_entrada, _posicionar,
                      _mudar_status, _agendar, _mover_para_canvas, _listar_canvas, _marcar_produto, _marcar_winner,
                      _rotas, _app, _tela]
SERVIDOR_MCP = create_sdk_mcp_server("jarvis", tools=FERRAMENTAS_CANVAS)
NOMES_MCP = [f"mcp__jarvis__{n}" for n in ("transcrever_youtube", "criar_ideia", "criar_saida", "ligar_ao_canvas",
                                           "criar_entrada", "posicionar", "mudar_status", "agendar", "mover_para_canvas",
                                           "listar_canvas", "marcar_produto", "marcar_winner", "rotas", "app", "tela")]

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
  `ideia: "[[💡 Nome]]"`, `grupo` (o canvas onde a nota vive), `notion` (link do card no Notion), `tags` (lista; vazia fica `tags:`, nunca
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
- Canvas = onde a nota vive, por tema (Skills, Hacks e Dicas, Storytelling…): a propriedade `grupo: "<canvas>"`, uma
  só por nota. Sem grupo, a nota fica no 📥 Inbox. A página inicial (clique em NEO-OBSIDIAN) lista os canvas.
- Produto (FIA 🤖fia, FID 🖼️fid, Dados 📊dados, PICO 💰bf26) = as tags da nota. Não é lugar: dentro de um canvas é só um
  filtro (chips na barra) e uma bolinha colorida no card. Produtos diferentes convivem no mesmo canvas.
- Publicada fica no canvas dela; no Inbox, publicada some (fica na pasta Publicado). As pastas do rodapé (Em edição,
  Agendado, Publicado) são globais e abrem tabelas.
- 🔥 winner = tag `🔥` nas tags: o card ganha borda vermelha.
- As abas X e Sites são o radar (sinais da internet); 👍 ensina o gosto dele e 💡 vira ideia no canvas.

## Como agir (use as ferramentas: elas mantêm links, pins do Obsidian e o lugar do card no canvas)
- Criar ideia: `criar_ideia` (ou `criar_entrada` com um link/texto, que lê a página ou a transcrição).
- Criar uma versão de uma ideia: `criar_saida` (já com o texto). Juntar copies que já existem numa produção:
  `ligar_ao_canvas` com tipo=producao.
- Mudar status ou publicar: `mudar_status`. Data: `agendar`. Canvas: `listar_canvas` e `mover_para_canvas`. Produto: `marcar_produto`.
  Winner: `marcar_winner`. Posição: `posicionar`.
- Nunca renomeie, mova ou apague arquivos à mão para mudar status ou pasta: a ferramenta faz isso direito.
- Você pode escrever em qualquer nota do vault (Edit/Write); evite `.obsidian/` e `.trash/`. Nota atômica nova vai
  em `2 Notas/` com o frontmatter do template (`2 Notas/Engine/templates/T - Atomic Note.md`: `origin`, `tags`); para
  ligar, ponha o `[[link]]` no texto das duas notas. Editar texto de uma copy: Edit direto no arquivo, sem mexer no
  frontmatter além do necessário.

## Terminal (Bash)
- Você tem Bash, como um Claude Code no terminal: baixar vídeo (`yt-dlp`, ou `ffmpeg -i <m3u8>` para player vturb/
  ConverteAI: o `main.m3u8` está no `player.js` da página), extrair áudio (`ffmpeg`), transcrever (`whisper <audio>
  --model small --language Portuguese`, ~1 min por minuto de vídeo; rode em segundo plano se for longo), scripts Python.
- Arquivos temporários (vídeo, áudio) vão em `/tmp/jarvis/`, nunca no vault; no vault entra só o resultado (a
  transcrição na nota, uma imagem em `2 Notas/Engine/attachments/`).
- Não há trava nenhuma: você roda como o Rodrigo no terminal dele. Por isso, antes de apagar (prefira `mv` para
  `~/.Trash`), de mexer em `.obsidian/`, de `git push` ou de qualquer coisa sem volta, confirme com ele no chat.

## Você usa o app inteiro, como o Rodrigo
- Tudo o que ele faz na tela você faz pela ferramenta `app`, que chama as mesmas rotas da API que a interface chama
  (`rotas` lista todas, com o corpo de cada uma). Prefira as ferramentas específicas acima quando existirem; para o
  resto (renomear, arquivar, lixeira, criar/renomear/arquivar canvas, cor, posições, desenho, planejamento…), use `app`.
  Sem `canvas`, a chamada vale para o canvas que ele está vendo agora.
- ids dos cards (arquivar, posições): `i:💡 Nome` = card da ideia; `g:💡 Nome` = a produção agrupada dela (as copies
  curtas com aquele `ideia:`); `p:priorizar/<nome>` ou `p:publicados/<nome>` = copy solta ou VSL; `e:<nome>` = entrada.
  Confira com `GET /api/canvas` quando tiver dúvida.
- `tela` mexe na tela dele: trocar de aba, abrir um canvas, mostrar um card (enquadra e seleciona), abrir uma nota no
  modal, modo foco. Depois de criar ou mexer em algo, mostre com `tela` → mostrar quando ajudar ele a ver.
- O canvas recarrega sozinho a cada mudança. "Esses", "os selecionados" = os cards selecionados (vêm em "Onde o
  Rodrigo está").
- Antes de apagar (lixeira, excluir canvas) ou de mexer em muita coisa de uma vez, confirme com ele no chat.

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


def _opcoes(sessao: str | None, contexto: str) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        cwd=str(VAULT), setting_sources=["user", "project"], model=MODELO_CHAT,
        tools=FERRAMENTAS, mcp_servers={"jarvis": SERVIDOR_MCP},
        allowed_tools=["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch", "Skill", "TodoWrite", *NOMES_MCP],
        permission_mode="bypassPermissions", resume=sessao, include_partial_messages=True,
        system_prompt={"type": "preset", "preset": "claude_code", "append": INSTRUCOES + contexto},
        # sem travas: o Rodrigo quis o Jarvis igual ao Claude Code no terminal (Bash e escrita em qualquer lugar)
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


def _com_nota(texto: str, nota: dict | None) -> str:
    """Com uma nota aberta no app, a mensagem vai com uma linha dizendo qual (o histórico guarda só o texto dele)."""
    if not nota or not nota.get("nome"):
        return texto
    p = notas._caminho(nota.get("raiz", ""), nota["nome"])
    onde_esta = f" · `{p.relative_to(VAULT)}`" if p and p.is_file() else ""
    return f"[Nota aberta no app agora: [[{nota['nome']}]]{onde_esta}. Quando ele falar de \"esta copy\" ou \"aqui\", é ela.]\n\n{texto}"


async def conversar(conversa: str, texto: str, sinal_id: int | None = None, onde: str = "", canvas_slug: str = "",
                    nota: dict | None = None) -> AsyncIterator[dict]:
    """Envia uma mensagem e devolve eventos para o front: texto (delta), ferramenta, mudou, tela, fim, erro."""
    global _canvas_da_vez
    db.guardar_mensagem(conversa, "usuario", texto)
    sessao = db.sessao_da_conversa(conversa)
    resposta: list[str] = []
    _eventos.clear()
    _canvas_da_vez = canvas_slug or "inbox"
    canvas._atual.set(_canvas_da_vez)   # as ferramentas específicas (criar_ideia…) criam no canvas que ele está vendo
    try:
        # onde o Rodrigo está no app agora (tela, canvas, filtros, nota aberta, seleção): vai em toda mensagem
        aqui = f"\n## Onde o Rodrigo está no app agora\n{onde.strip()}\n" if onde.strip() else ""
        opcoes = _opcoes(sessao, _contexto_sinal(sinal_id) + aqui)
        async with ClaudeSDKClient(opcoes) as cli:
            await cli.query(_com_nota(texto, nota))
            async for m in cli.receive_response():
                while _eventos:   # o que as ferramentas pediram ao front (recarregar o canvas, abrir, mostrar…)
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
