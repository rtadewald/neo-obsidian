"""API do Neo-Obsidian. Dev: `uv run jarvis` (porta 8740). O front (Vite) faz proxy de /api para cá."""
import asyncio
import time
import json

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import agente, anuncios, instagram_canais, auth, copies, db, metricool, notas, planejamento, porta, preferencias, radar, videos_x
from .config import FRONT_DIST

MODO_AUTH = auth.preparar()
db.iniciar()
app = FastAPI(title="Neo-Obsidian")


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


# ---------- coleta automática: uma vez por dia, contada da última coleta, enquanto o app está de pé ----------
INTERVALO_COLETA = 24 * 3600
_proxima: float | None = None


def _quando_proxima() -> float:
    u = db.ultima_coleta()
    return (u["inicio"] + INTERVALO_COLETA) if u and u.get("inicio") else time.time() + 60


async def _coleta_automatica():
    global _tarefa, _proxima
    await asyncio.sleep(60)   # deixa o app subir antes da primeira (se já passou um dia)
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
    """Se há coleta rodando, a última coleta e quando roda a próxima (automática, uma vez por dia)."""
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


class ArquivarNota(BaseModel):
    raiz: str
    nome: str
    sim: bool = True


@app.post("/api/copies/arquivar")
def copies_arquivar(corpo: ArquivarNota):
    """Arquiva (`arquivado: true` na nota) ou desarquiva: a arquivada sai da Criação da Redação."""
    return _erros(lambda: copies.arquivar_nota(corpo.raiz, corpo.nome, corpo.sim))


@app.get("/api/criacao")
def criacao():
    """A Criação da Redação: cor de cada categoria, ordem das categorias e a ordem das copies dentro de cada uma."""
    return copies.criacao()


@app.post("/api/criacao")
def criacao_salvar(corpo: dict):
    """Muda o que vier: `cores` ({categoria: cor}), `categorias` (a ordem), `ordem` ({categoria: [raiz/nome]}) e/ou `arquivadas`."""
    return copies.salvar_criacao(corpo)


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
    acao: str                  # pagina | abrir_nota | mostrar (abre numa aba da Redação; nova=True: aba nova)
    pagina: str | None = None
    nova: bool | None = None
    raiz: str | None = None
    nome: str | None = None


@app.post("/api/tela")
def tela(t: Tela):
    """O Claude Code mexe na tela do Rodrigo, como ele faria com o mouse."""
    ev = {"t": "tela", **t.model_dump(exclude_none=True)}
    porta.publicar(ev)
    return {"ok": True, "app_aberto": bool(porta._filas)}


@app.get("/api/onde")
def onde_ler():
    """Onde o Rodrigo está no app agora: tela, nota aberta, abas da Redação."""
    return porta.onde


@app.post("/api/onde")
def onde_gravar(corpo: dict):
    porta.onde.clear()
    porta.onde.update(corpo)
    return {"ok": True}


@app.on_event("startup")
async def _ligar_porta():
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
    """Busca rápida (⌘O) e o seletor de [[links]] do editor: nome, raiz, data e prévia de cada nota."""
    return {"itens": notas.indice()}


@app.get("/api/notas-busca")
def notas_busca(q: str = ""):
    """Busca dentro do texto das notas (⌘O, depois dos nomes): o trecho com as palavras encontradas."""
    return {"itens": notas.buscar_conteudo(q)}


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
        copies.renomeou(raiz, nome, d["raiz"], d["nome"])
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
        copies.marcar_nova(d["nome"])
        return d
    except FileExistsError:
        raise HTTPException(409, "já existe uma nota com esse nome")


# ---------- copies (a Redação lista e mexe nelas) ----------

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


@app.get("/api/copies")
def copies_estado():
    return copies.estado()


@app.get("/api/anexo/{nome:path}")
def anexo(nome: str):
    p = copies.anexo(nome)
    if not p:
        raise HTTPException(404, "anexo não encontrado")
    return FileResponse(p)


class StatusNotas(BaseModel):
    notas: list[str]
    status: str   # ideia | edicao | agendado | publicado


@app.post("/api/copies/status")
def copies_status(corpo: StatusNotas):
    """Muda o status de várias copies (tabela das pastas: seleção múltipla e botão direito)."""
    return {"notas": _erros(lambda: [copies.mudar_status(n, corpo.status) for n in corpo.notas])}


class TagsNota(BaseModel):
    nome: str
    tags: list[str]


@app.post("/api/copies/tags")
def copies_tags(corpo: TagsNota):
    """Coluna Tags da tabela: grava a lista inteira e devolve a de antes (o ⌘Z volta para ela)."""
    return {"antes": _erros(lambda: copies.definir_tags(corpo.nome, corpo.tags))}


class Winner(BaseModel):
    notas: list[dict]
    sim: bool = True


@app.post("/api/copies/winner")
def copies_winner(corpo: Winner):
    return {"mudou": _erros(lambda: copies.marcar_winner(corpo.notas, corpo.sim))}


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


@app.post("/api/copies/categoria/renomear")
def copies_categoria_renomear(corpo: RenomearCategoria):
    """Renomeia a categoria nas copies (e leva a cor e a ordem dela na Criação)."""
    return _erros(lambda: {"mudadas": copies.renomear_categoria(corpo.de, corpo.para)})


@app.post("/api/copies/categoria")
def copies_categoria(corpo: Categoria):
    """Muda a categoria das copies."""
    return _erros(lambda: {"mudadas": copies.definir_categoria(corpo.nomes, corpo.categoria)})


class Vista(BaseModel):
    nome: str


@app.post("/api/copies/vista")
def copies_vista(corpo: Vista):
    """O Rodrigo abriu a nota: ela deixa de ser nova (o 💡 some da categoria)."""
    era = corpo.nome in copies.novas()
    if era:
        copies.marcar_nova(corpo.nome, False)
    return {"era_nova": era}


@app.post("/api/copies/ideia")
def copies_ideia(corpo: NovaIdeia):
    return _erros(lambda: copies.criar_ideia(corpo.titulo, corpo.brief, pos=corpo.pos and corpo.pos.model_dump(), categoria=corpo.categoria))


class NovaEntrada(BaseModel):
    conteudo: str
    ideia: str | None = None
    pos: Pos | None = None
    pronto: dict | None = None   # {titulo, url, thumb}: ideia vinda de um card do radar
    categoria: str | None = None


@app.post("/api/copies/entrada")
def copies_entrada(corpo: NovaEntrada):
    return _erros(lambda: copies.criar_entrada(corpo.conteudo, corpo.ideia, corpo.pos and corpo.pos.model_dump(), corpo.pronto, corpo.categoria))


class Ref(BaseModel):
    raiz: str
    nome: str


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


# ---------- chat (Claude Agent SDK rodando no vault, na coluna da direita) ----------

class Mensagem(BaseModel):
    conversa: str = "geral"
    texto: str
    onde: str = ""             # onde o Rodrigo está no app (tela, nota aberta): vai para o contexto do agente
    nota: dict | None = None   # {raiz, nome}: a nota aberta na Redação; vira uma linha no começo da mensagem


@app.post("/api/chat")
async def chat(m: Mensagem):
    async def eventos():
        async for ev in agente.conversar(m.conversa, m.texto, m.onde, m.nota):
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
    return StreamingResponse(eventos(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/chat/{conversa}")
def chat_historico(conversa: str):
    return db.mensagens(conversa)


@app.get("/api/chats")
def chats():
    """As conversas do chat (mais recente primeiro): id, titulo, n de mensagens, atualizado_em."""
    return db.lista_conversas()


@app.delete("/api/chats/{conversa}")
def chats_apagar(conversa: str):
    """Apaga uma conversa do chat (as mensagens e a sessão)."""
    db.apagar_conversa(conversa)
    return {"ok": True}


class ImagemColada(BaseModel):
    dados: str          # base64 (sem o prefixo data:)
    tipo: str           # image/png, image/jpeg…


@app.post("/api/chat/imagem")
def chat_imagem(corpo: ImagemColada):
    import base64
    try:
        return copies.salvar_imagem(base64.b64decode(corpo.dados), corpo.tipo)
    except ValueError as e:
        raise HTTPException(400, str(e))


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
