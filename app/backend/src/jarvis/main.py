"""API do Neo-Obsidian. Dev: `uv run jarvis` (porta 8740). O front (Vite) faz proxy de /api para cá."""
import asyncio
import time
import json

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import anuncios, instagram_canais, auth, canvas, db, metricool, notas, planejamento, porta, preferencias, radar, videos_x
from .config import FRONT_DIST

MODO_AUTH = auth.preparar()
db.iniciar()
app = FastAPI(title="Neo-Obsidian")


@app.middleware("http")
async def canvas_da_requisicao(request, call_next):
    """O app diz em qual canvas está (cabeçalho X-Canvas): o layout e o `grupo:` das notas novas seguem ele.
    `todos` é o canvas interno com todas as notas (as pastas globais); o que não existir vira o Inbox."""
    slug = request.headers.get("x-canvas") or "inbox"
    marca = canvas._atual.set(slug if slug == "todos" or any(c["slug"] == slug for c in canvas.lista_canvases()) else "inbox")
    try:
        return await call_next(request)
    finally:
        canvas._atual.reset(marca)


@app.get("/api/saude")
def saude():
    return {"ok": True, "auth": MODO_AUTH, "ultima_coleta": db.ultima_coleta()}


@app.get("/api/sinais")
def sinais(status: str | None = None, fonte: str | None = None, tipo: str | None = None, ultimo_lote: bool = False):
    return db.listar_sinais(status, fonte, tipo, ultimo_lote=ultimo_lote)


class Status(BaseModel):
    status: str


@app.post("/api/sinais/{id_}/status")
def status_sinal(id_: int, corpo: Status):
    if corpo.status not in ("novo", "salvo", "descartado"):
        raise HTTPException(400, "status inválido")
    db.mudar_status(id_, corpo.status)
    return {"ok": True}


class Voto(BaseModel):
    voto: int


@app.post("/api/sinais/{id_}/voto")
def votar(id_: int, corpo: Voto):
    if corpo.voto not in (-1, 0, 1):
        raise HTTPException(400, "voto é -1, 0 ou 1")
    db.votar(id_, corpo.voto)
    preferencias.invalidar()
    db.querer_no_x(id_, corpo.voto == 1)   # post do X: o like vai para o X de verdade na próxima coleta do X
    return {"ok": True}


@app.get("/api/radar/gosto")
def gosto():
    vs = db.votados()
    p = preferencias.perfil()
    top = sorted(((l - d) / (l + d + 1), k) for k, (l, d) in p.items() if k[0] != "fonte" and l + d >= 2)
    return {"likes": sum(v["voto"] > 0 for v in vs), "deslikes": sum(v["voto"] < 0 for v in vs),
            "gosta": [f"{k[1]}" for w, k in reversed(top) if w > 0.3][:8],
            "evita": [f"{k[1]}" for w, k in top if w < -0.3][:8]}


_reav: asyncio.Task | None = None


@app.post("/api/radar/reavaliar")
async def reavaliar():
    global _reav
    if _reav and not _reav.done():
        return {"status": "ja_rodando"}
    _reav = asyncio.create_task(radar.reavaliar())
    return {"status": "iniciado"}


@app.get("/api/sinais/{id_}/video")
async def video_x(id_: int):
    return {"video": await asyncio.to_thread(videos_x.video, id_)}


_tarefa: asyncio.Task | None = None


@app.post("/api/radar/atualizar")
async def atualizar():
    global _tarefa
    if _tarefa and not _tarefa.done():
        return {"status": "ja_rodando"}
    _tarefa = asyncio.create_task(radar.coletar())
    return {"status": "iniciado"}


# ---------- coleta automática: a cada 2 h, contadas da última coleta, enquanto o app está de pé ----------
INTERVALO_COLETA = 2 * 3600
_proxima: float | None = None


def _quando_proxima() -> float:
    u = db.ultima_coleta()
    return (u["inicio"] + INTERVALO_COLETA) if u and u.get("inicio") else time.time() + 60


async def _coleta_automatica():
    global _tarefa, _proxima
    await asyncio.sleep(60)   # deixa o app subir antes da primeira (se já passou das 2 h)
    while True:
        _proxima = _quando_proxima()
        espera = _proxima - time.time()
        if espera > 0:
            await asyncio.sleep(min(espera, 600))   # acorda de 10 em 10 min: uma coleta manual empurra a próxima
            continue
        if not (_tarefa and not _tarefa.done()):
            _tarefa = asyncio.create_task(radar.coletar())
            await _tarefa
        else:
            await asyncio.sleep(60)


@app.on_event("startup")
async def _ligar_coleta_automatica():
    asyncio.create_task(_coleta_automatica())


@app.get("/api/radar/estado")
def estado():
    """Se há coleta rodando, a última coleta e quando roda a próxima (automática, a cada 2 h)."""
    return {"rodando": bool(_tarefa and not _tarefa.done()), "reavaliando": bool(_reav and not _reav.done()),
            "ultima": db.ultima_coleta(), "proxima": _proxima or _quando_proxima()}


# ---------- Instagram: canais monitorados e os Reels deles (ver instagram_canais.py) ----------

class NovoCanalIG(BaseModel):
    perfis: str   # um ou vários (@, link ou nome), separados por espaço, vírgula ou linha


@app.get("/api/ig/canais")
def ig_canais():
    return instagram_canais.canais()


@app.post("/api/ig/canais")
def ig_canal_novo(corpo: NovoCanalIG):
    try:
        return {"novos": instagram_canais.adicionar(corpo.perfis)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/ig/canais/{handle}")
def ig_canal_apagar(handle: str):
    instagram_canais.remover(handle)
    return {"ok": True}


@app.get("/api/ig/videos")
def ig_videos():
    """Os Reels coletados, com outlier (views ÷ mediana do canal), views e engajamento."""
    return instagram_canais.videos()


class AtualizarIG(BaseModel):
    so: list[str] | None = None


_ig_tarefa: asyncio.Task | None = None


@app.post("/api/ig/atualizar")
async def ig_atualizar(corpo: AtualizarIG | None = None):
    """Dispara a coleta em segundo plano (o agente abre o Instagram no Chrome logado)."""
    global _ig_tarefa
    if instagram_canais.estado["rodando"]:
        return {"status": "já rodando"}

    async def rodar():
        try:
            await instagram_canais.atualizar(corpo.so if corpo else None)
        except Exception:  # noqa: BLE001 — o erro fica em estado["erro"]
            pass
    _ig_tarefa = asyncio.create_task(rodar())
    return {"status": "iniciado"}


@app.get("/api/ig/estado")
def ig_estado():
    return instagram_canais.estado


@app.get("/api/ig/arquivo/{tipo}/{nome}")
def ig_arquivo(tipo: str, nome: str):
    p = instagram_canais.arquivo(tipo, nome)
    if not p:
        raise HTTPException(404, "arquivo não encontrado")
    return FileResponse(p)


# ---------- a porta para o Claude Code (ver porta.py) ----------

@app.get("/api/eventos")
async def eventos():
    """SSE para o app: `mudou` (uma nota mudou no vault), `tela` (o Claude mexe na tela) e `porta` (se ele ouve)."""
    async def corpo():
        async for ev in porta.assinar():
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
    return StreamingResponse(corpo(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class Tela(BaseModel):
    acao: str                  # pagina | abrir_canvas | mostrar | abrir_nota | fechar_nota | foco
    pagina: str | None = None
    canvas: str | None = None  # slug
    raiz: str | None = None
    nome: str | None = None
    codigo: str | None = None  # no lugar de raiz + nome


@app.post("/api/tela")
def tela(t: Tela):
    """O Claude Code mexe na tela do Rodrigo, como ele faria com o mouse."""
    ev = {"t": "tela", **t.model_dump(exclude_none=True)}
    if t.codigo:
        n = porta.achar_codigo(t.codigo)
        if not n:
            raise HTTPException(404, f"nenhuma nota com o código {t.codigo}")
        ev |= {"raiz": n["raiz"], "nome": n["nome"]}
    porta.publicar(ev)
    return {"ok": True, "app_aberto": bool(porta._filas)}


@app.get("/api/onde")
def onde_ler():
    """Onde o Rodrigo está no app agora: tela, canvas, vista, filtros, cards selecionados (com código), nota aberta."""
    return porta.onde


@app.post("/api/onde")
def onde_gravar(corpo: dict):
    porta.onde.clear()
    porta.onde.update(corpo)
    return {"ok": True}


@app.get("/api/codigo/{cod}")
def codigo(cod: str):
    """A nota de um código (NEO-042): raiz, nome, caminho no vault e o texto."""
    if cod.upper().startswith("RAD-"):   # sinal do radar
        s = db.sinal(int(cod[4:])) if cod[4:].isdigit() else None
        if not s:
            raise HTTPException(404, f"nenhum sinal com o código {cod}")
        return {"codigo": cod.upper(), "sinal": s}
    n = porta.achar_codigo(cod)
    if not n:
        raise HTTPException(404, f"nenhuma nota com o código {cod}")
    return n


class Pedido(BaseModel):
    texto: str = ""
    codigos: list[str] = []      # notas (NEO-042) ou sinais do radar (RAD-123) de que o pedido fala
    trecho: dict | None = None   # {codigo, linhaIni, linhaFim, texto}: o trecho selecionado no editor
    onde: dict | None = None


@app.post("/api/fila")
def fila(p: Pedido):
    """Pedido do Rodrigo, feito no app, para o Claude Code (que escuta `dados/fila.jsonl`)."""
    linha = porta.enfileirar({"texto": p.texto, "codigos": p.codigos, "trecho": p.trecho, "onde": p.onde or porta.onde})
    return {"ok": True, "ouvindo": porta.ouvinte_vivo(), "ts": linha["ts"]}


@app.on_event("startup")
async def _ligar_porta():
    await asyncio.to_thread(porta.garantir_codigos, None, True)
    asyncio.create_task(porta.vigiar_vault())


@app.get("/api/metricool/estado")
def metricool_estado():
    return {"conectado": True, "motivo": "Lido pelo conector Metricool da conta claude.ai, só leitura."}


_sync: asyncio.Task | None = None


@app.get("/api/calendario")
def calendario(de: str, ate: str):
    """Posts publicados e agendados entre duas datas ISO (ate exclusivo)."""
    return {"posts": metricool.listar(de, ate), "sincronizando": bool(_sync and not _sync.done())}


@app.post("/api/calendario/sincronizar")
async def sincronizar():
    global _sync
    if _sync and not _sync.done():
        return {"status": "ja_rodando"}
    _sync = asyncio.create_task(metricool.sincronizar())
    return {"status": "iniciado"}


@app.get("/api/notas-indice")
def notas_indice():
    """Busca rápida (⌘P/⌘O): as notas e também as 💡 ideias que existem só como grupo de copies (`ideia:` sem nota 💡).
    Essas abrem na versão principal do grupo (o 📱 Reels quando houver)."""
    itens = notas.indice()
    try:
        tudo = canvas._todas()
        com_nota = {i["nome"] for i in tudo["ideias"]}
        grupos: dict[str, list[dict]] = {}
        for p in tudo["producoes"]:
            if p["ideia"] and p["ideia"] not in com_nota:
                grupos.setdefault(p["ideia"], []).append(p)
        for nome, ps in grupos.items():
            ps.sort(key=lambda p: (p["formato"] != "📱", p["status"] == "publicado", -p["mtime"]))
            principal = ps[0]
            itens.append({"nome": nome if nome.startswith("💡") else f"💡 {nome}", "raiz": "grupo", "mtime": max(p["mtime"] for p in ps),
                          "status": "", "abrir": {"raiz": principal["raiz"], "nome": principal["nome"]}, "versoes": len(ps)})
    except Exception:   # a busca nunca quebra por causa dos grupos
        pass
    return {"itens": itens}


@app.get("/api/notas/agenda")
def notas_agenda():
    """Notas de 1 Copies com `scheduled`, para o calendário editorial de Ideias."""
    return {"itens": notas.agenda()}


class Agendar(BaseModel):
    data: str | None = None          # AAAA-MM-DD
    de: str | None = None            # arrastar no calendário: qual das datas da nota mudou
    datas: list[str] | None = None   # a lista inteira (nota postada mais de uma vez)


@app.post("/api/notas/{raiz}/{nome:path}/agenda")
def nota_agendar(raiz: str, nome: str, corpo: Agendar):
    try:
        return notas.mudar_agenda(raiz, nome, corpo.data, corpo.de, corpo.datas)
    except FileNotFoundError:
        raise HTTPException(404, "nota não encontrada")
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/planejamento")
def planejamento_listar():
    return {"itens": planejamento.listar()}


class Bloco(BaseModel):
    inicio: str
    fim: str
    texto: str
    cor: str | None = None


@app.post("/api/planejamento")
def planejamento_criar(corpo: Bloco):
    return planejamento.criar(corpo.inicio, corpo.fim, corpo.texto, corpo.cor)


class BlocoParcial(BaseModel):
    inicio: str | None = None
    fim: str | None = None
    texto: str | None = None
    cor: str | None = None


@app.put("/api/planejamento/{id_}")
def planejamento_atualizar(id_: str, corpo: BlocoParcial):
    item = planejamento.atualizar(id_, **corpo.model_dump())
    if not item:
        raise HTTPException(404, "bloco não encontrado")
    return item


@app.delete("/api/planejamento/{id_}")
def planejamento_apagar(id_: str):
    if not planejamento.apagar(id_):
        raise HTTPException(404, "bloco não encontrado")
    return {"ok": True}


class Acao(BaseModel):
    acao: str                   # mover | renomear | status | lixeira
    destino: str | None = None  # mover: priorizar | publicados · status: ideia | edicao | agendado
    novo: str | None = None     # para renomear


@app.post("/api/notas/{raiz}/{nome:path}/acao")
def nota_acao(raiz: str, nome: str, corpo: Acao):
    d = _nota_acao(raiz, nome, corpo)
    if isinstance(d, dict) and d.get("nome") and (d["nome"] != nome or d.get("raiz") != raiz):
        canvas.renomeou(raiz, nome, d["raiz"], d["nome"])
    return d


def _nota_acao(raiz: str, nome: str, corpo: Acao):
    try:
        if corpo.acao == "mover":
            return notas.mover(raiz, nome, corpo.destino or "")
        if corpo.acao == "renomear":
            return notas.renomear(raiz, nome, corpo.novo or "")
        if corpo.acao == "status":
            return notas.mudar_status(raiz, nome, corpo.destino or "")
        if corpo.acao == "lixeira":
            return notas.para_lixeira(raiz, nome)
    except FileExistsError:
        raise HTTPException(409, "já existe uma nota com esse nome lá")
    except FileNotFoundError:
        raise HTTPException(404, "nota não encontrada")
    except ValueError as e:
        raise HTTPException(400, str(e))
    raise HTTPException(400, "ação desconhecida")


@app.get("/api/skills")
def skills_lista():
    return notas.lista_skills()


class NovaSkill(BaseModel):
    nome: str
    descricao: str = ""
    categoria: str = "Copywriting"


@app.post("/api/skills")
def skill_nova(corpo: NovaSkill):
    try:
        return notas.criar_skill(corpo.nome, corpo.descricao, corpo.categoria)
    except FileExistsError:
        raise HTTPException(409, "já existe uma skill com esse nome")
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/notas/{raiz}/{nome:path}")
def nota_ler(raiz: str, nome: str):
    n = notas.ler(raiz, nome)
    if not n:
        raise HTTPException(404, "nota não encontrada")
    return n


class Salvar(BaseModel):
    texto: str
    mtime: float | None = None


@app.put("/api/notas/{raiz}/{nome:path}")
def nota_salvar(raiz: str, nome: str, corpo: Salvar):
    try:
        return notas.salvar(raiz, nome, corpo.texto, corpo.mtime)
    except notas.Conflito as e:
        raise HTTPException(409, str(e))
    except FileNotFoundError:
        raise HTTPException(404, "nota não encontrada")


class Nova(BaseModel):
    titulo: str


@app.post("/api/notas/priorizar")
def nota_nova(corpo: Nova):
    try:
        d = notas.criar(corpo.titulo)
        canvas.marcar_no_canvas(d["raiz"], d["nome"])
        canvas.marcar_nova(d["nome"])   # copy nova também nasce com o selo NOVO
        return d
    except FileExistsError:
        raise HTTPException(409, "já existe uma nota com esse nome")


# ---------- canvas ----------

def _erros(f):
    try:
        return f()
    except FileExistsError as e:
        raise HTTPException(409, f"já existe: {e}")
    except FileNotFoundError as e:
        raise HTTPException(404, f"não encontrada: {e}")
    except ValueError as e:
        raise HTTPException(400, str(e))


class Pos(BaseModel):
    x: float
    y: float


@app.get("/api/canvases")
def canvases():
    """Os canvas, com quantos cards de cada tipo (e de cada produto) cada um tem: página inicial e seletor."""
    return canvas.resumos()


@app.get("/api/produtos")
def produtos():
    return canvas.lista_produtos()


class NovoProduto(BaseModel):
    nome: str
    icone: str = ""


@app.post("/api/produtos")
def produto_novo(corpo: NovoProduto):
    return _erros(lambda: canvas.novo_produto(corpo.nome, corpo.icone))


class NovoCanvas(BaseModel):
    slug: str | None = None
    nome: str | None = None
    icone: str | None = None
    cor: str | None = None
    arquivado: bool | None = None


@app.post("/api/canvases")
def canvases_salvar(corpo: NovoCanvas):
    """Sem slug cria; com slug edita (renomear troca o `grupo:` das notas do canvas)."""
    return _erros(lambda: canvas.salvar_canvas(corpo.model_dump()))


class OrdemCanvases(BaseModel):
    slugs: list[str]


@app.post("/api/canvases/ordem")
def canvases_ordem(corpo: OrdemCanvases):
    """Muda a ordem dos canvas (arrastar nas pastas da esquerda ou na página Todos os canvas). O Inbox fica no fim."""
    return _erros(lambda: canvas.ordenar_canvases(corpo.slugs))


@app.delete("/api/canvases/{slug}")
def canvases_apagar(slug: str):
    """As notas do canvas voltam para o Inbox (perdem o `grupo:`)."""
    return {"notas": _erros(lambda: canvas.apagar_canvas(slug))}


@app.get("/api/canvas")
def canvas_estado():
    return canvas.estado()


@app.get("/api/anexo/{nome:path}")
def anexo(nome: str):
    p = canvas.anexo(nome)
    if not p:
        raise HTTPException(404, "anexo não encontrado")
    return FileResponse(p)


@app.get("/api/canvas/x")
def canvas_x(url: str):
    return canvas.video_x(url) or {}


class MoverCanvas(BaseModel):
    notas: list[str]             # nomes das notas (uma por card basta: a ideia e as copies dela vão junto)
    canvas: str | None = None    # nome do canvas; vazio ou "Inbox" tira o grupo


class CanvasDaNota(BaseModel):
    notas: list[str]
    canvas: str
    sim: bool = True


@app.post("/api/canvas/canvas")
def canvas_canvas(corpo: CanvasDaNota):
    """Canvas › do menu: a nota (com a família) passa a viver também neste canvas (sim) ou sai dele."""
    return _erros(lambda: canvas.canvas_da_nota(corpo.notas, corpo.canvas, corpo.sim))


@app.post("/api/canvas/mover")
def canvas_mover(corpo: MoverCanvas):
    return _erros(lambda: canvas.mover_para_canvas(corpo.notas, corpo.canvas))


class StatusNotas(BaseModel):
    notas: list[str]
    status: str   # ideia | edicao | agendado | publicado


@app.post("/api/canvas/status")
def canvas_status(corpo: StatusNotas):
    """Muda o status de várias copies (tabela das pastas: seleção múltipla e botão direito)."""
    return {"notas": _erros(lambda: [canvas.mudar_status(n, corpo.status) for n in corpo.notas])}


class Importar(BaseModel):
    nome: str


@app.post("/api/canvas/importar")
def canvas_importar(corpo: Importar):
    return _erros(lambda: canvas.importar(corpo.nome))


class NoProduto(BaseModel):
    notas: list[str]
    produto: str   # slug do produto (fia, fid…)
    sim: bool = True


@app.post("/api/canvas/produto")
def canvas_produto(corpo: NoProduto):
    return {"mudou": _erros(lambda: canvas.no_produto(corpo.notas, corpo.produto, corpo.sim))}


class JuntarIdeias(BaseModel):
    destino: str          # ideia que já existe ou nome novo
    origens: list[str]    # as que somem (o conteúdo vai para o destino)


@app.post("/api/canvas/juntar")
def canvas_juntar(corpo: JuntarIdeias):
    return _erros(lambda: canvas.juntar_ideias(corpo.destino, corpo.origens))


class TagsNota(BaseModel):
    nome: str
    tags: list[str]


@app.post("/api/canvas/tags")
def canvas_tags(corpo: TagsNota):
    """Coluna Tags da tabela: grava a lista inteira e devolve a de antes (o ⌘Z volta para ela)."""
    return {"antes": _erros(lambda: canvas.definir_tags(corpo.nome, corpo.tags))}


class Winner(BaseModel):
    notas: list[dict]
    sim: bool = True


@app.post("/api/canvas/winner")
def canvas_winner(corpo: Winner):
    return {"mudou": _erros(lambda: canvas.marcar_winner(corpo.notas, corpo.sim))}


@app.get("/api/canvas/desenho")
def canvas_desenho():
    """A camada de desenho (Excalidraw) do canvas do X-Canvas: elementos e arquivos."""
    return _erros(canvas.desenho)


@app.put("/api/canvas/desenho")
def canvas_salvar_desenho(corpo: dict):
    _erros(lambda: canvas.salvar_desenho(corpo))
    return {"ok": True}


class OrdemFilhos(BaseModel):
    pai: str
    filhos: list[str]


@app.put("/api/canvas/ordem")
def canvas_ordem(corpo: OrdemFilhos):
    """Mapa mental: grava a ordem dos filhos de um card (categoria ou ideia)."""
    canvas.ordenar(corpo.pai, corpo.filhos)
    return {"ok": True}


@app.put("/api/canvas/posicoes")
def canvas_posicoes(corpo: dict[str, Pos]):
    canvas.posicoes({k: v.model_dump() for k, v in corpo.items()})
    return {"ok": True}


class Arquivar(BaseModel):
    id: str
    sim: bool = True


class Vistas(BaseModel):
    nomes: list[str]


@app.post("/api/canvas/vista")
def canvas_vista(corpo: Vistas):
    """Marca 💡 ideias como vistas: tira o selo NOVO dos cards (nomes das ideias, com o 💡)."""
    canvas.marcar_vista(corpo.nomes)
    return {"ok": True}


@app.post("/api/canvas/arquivar")
def canvas_arquivar(corpo: Arquivar):
    """Arquiva (sim) ou desarquiva um card do canvas. id do card: `i:💡 Nome` (ideia), `g:💡 Nome` (produção agrupada
    da ideia), `p:<raiz>/<nome>` (copy solta ou VSL; raiz priorizar ou publicados), `e:<nome>` (entrada)."""
    canvas.arquivar(corpo.id, corpo.sim)
    return {"ok": True}


class NovaIdeia(BaseModel):
    titulo: str
    brief: str = ""
    pos: Pos | None = None
    categoria: str | None = None


class Categoria(BaseModel):
    nomes: list[str]
    categoria: str | None = None


class RenomearCategoria(BaseModel):
    de: str
    para: str


@app.post("/api/canvas/categoria/renomear")
def canvas_categoria_renomear(corpo: RenomearCategoria):
    """Mapa mental: renomeia a categoria nas copies do canvas aberto (e o card dela no layout)."""
    return _erros(lambda: {"mudadas": canvas.renomear_categoria(corpo.de, corpo.para)})


@app.post("/api/canvas/categoria")
def canvas_categoria(corpo: Categoria):
    """Mapa mental: muda a categoria das copies (a caixa onde elas vivem)."""
    return _erros(lambda: {"mudadas": canvas.definir_categoria(corpo.nomes, corpo.categoria)})


@app.post("/api/canvas/ideia")
def canvas_ideia(corpo: NovaIdeia):
    return _erros(lambda: canvas.criar_ideia(corpo.titulo, corpo.brief, pos=corpo.pos and corpo.pos.model_dump(), categoria=corpo.categoria))


class NovaEntrada(BaseModel):
    conteudo: str
    ideia: str | None = None
    pos: Pos | None = None
    pronto: dict | None = None   # {titulo, url, thumb}: ideia vinda de um card do radar
    categoria: str | None = None


@app.post("/api/canvas/entrada")
def canvas_entrada(corpo: NovaEntrada):
    return _erros(lambda: canvas.criar_entrada(corpo.conteudo, corpo.ideia, corpo.pos and corpo.pos.model_dump(), corpo.pronto, corpo.categoria))


class Fonte(BaseModel):
    ideia: str
    entrada: str
    sim: bool = True


@app.post("/api/canvas/fonte")
def canvas_fonte(corpo: Fonte):
    _erros(lambda: canvas.ligar_fonte(corpo.ideia, corpo.entrada, corpo.sim))
    return {"ok": True}


class Ref(BaseModel):
    raiz: str
    nome: str


class Ligar(BaseModel):
    producao: Ref
    ideia: str | None = None


@app.post("/api/canvas/ligar")
def canvas_ligar(corpo: Ligar):
    _erros(lambda: canvas.ligar_producao(corpo.producao.raiz, corpo.producao.nome, corpo.ideia))
    return {"ok": True}


class Origem(BaseModel):
    producao: Ref
    origem: str | None = None


@app.post("/api/canvas/origem")
def canvas_origem(corpo: Origem):
    _erros(lambda: canvas.ligar_origem(corpo.producao.raiz, corpo.producao.nome, corpo.origem))
    return {"ok": True}


class Agrupar(BaseModel):
    titulo: str
    producoes: list[Ref]
    pos: Pos | None = None


@app.post("/api/canvas/agrupar")
def canvas_agrupar(corpo: Agrupar):
    return _erros(lambda: canvas.agrupar(corpo.titulo, [r.model_dump() for r in corpo.producoes],
                                         corpo.pos and corpo.pos.model_dump()))


class Saida(BaseModel):
    ideia: str
    formato: str
    titulo: str = ""


@app.post("/api/canvas/saida")
def canvas_saida(corpo: Saida):
    return _erros(lambda: canvas.criar_saida(corpo.ideia, corpo.formato, corpo.titulo))


class ParaCopy(BaseModel):
    ideia: str
    formato: str


@app.post("/api/canvas/virar-copy")
def canvas_virar_copy(corpo: ParaCopy):
    return _erros(lambda: canvas.transformar_em_copy(corpo.ideia, corpo.formato))


@app.get("/api/ads")
def ads():
    return anuncios.painel() | {"sincronizando": bool(_ads and not _ads.done())}


@app.post("/api/ads/sincronizar")
async def ads_sincronizar():
    global _ads
    if _ads and not _ads.done():
        return {"status": "ja_rodando"}
    _ads = asyncio.create_task(anuncios.sincronizar())
    return {"status": "iniciado"}


app.mount("/api/thumbs", StaticFiles(directory=metricool.THUMBS, check_dir=False), name="thumbs")


if FRONT_DIST.exists():  # build de produção servido pelo próprio backend
    app.mount("/assets", StaticFiles(directory=FRONT_DIST / "assets"), name="assets")

    @app.get("/{caminho:path}")
    def spa(caminho: str):
        alvo = FRONT_DIST / caminho
        return FileResponse(alvo if caminho and alvo.is_file() else FRONT_DIST / "index.html")


def rodar():
    import uvicorn
    uvicorn.run("jarvis.main:app", host="127.0.0.1", port=8740, reload=False)
