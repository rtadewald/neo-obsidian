"""O canvas do Neo-Obsidian: ideias (💡), entradas (material bruto) e produções (as copies de sempre).

- 💡 ideia      → `1 Copies/0 Ideias/💡 Nome.md`, sem status. Pode ser só um nome ou já trazer o material bruto:
                  link ou texto colado vira ideia com `url`, `tipo` e `thumb` no frontmatter e o material
                  (transcrição, texto da página) no corpo. (Antes isso era um tipo à parte, "entrada"; agora é tudo ideia.)
- produção      → as copies de `1 Priorizar` e `2 Publicados`, que seguem o fluxo de status por nome/pasta.
                  Pertence a uma ideia quando tem `ideia: "[[💡 Nome]]"` no frontmatter; nota sem ideia é normal.

Dois eixos, independentes:
- canvas  → onde a nota vive: a propriedade `grupo: "<canvas>"` (uma só por nota). Sem grupo, a nota fica no 📥 Inbox.
            Cada canvas tem o seu layout (posições, arquivados, visíveis) em `app/dados/canvas/<slug>.json`.
- produto → a que produto a nota pertence (FIA, FID, Dados, PICO…): as tags dela (prefixos em `app/dados/produtos.json`).
            No app é só um filtro dentro do canvas e uma corzinha no card; produtos diferentes convivem no mesmo canvas.
"""
import contextvars
import functools
import json
import os
import re
import shutil
import tempfile
import threading
import unicodedata
from datetime import datetime
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

from . import notas, youtube
from .config import DADOS

FM = re.compile(r"^---\n(.*?)\n---\n?", re.S)
LINK = re.compile(r"\[\[([^\]|#]+)")
FORMATOS = ["📱", "📺", "📝", "💰", "🏞️", "🎥", "🎙️", "🗣️"]
ROTULO_FORMATO = {"📱": "Reels", "📺": "VSL", "📝": "Feed", "💰": "Ad", "🏞️": "Carrossel", "🎥": "YouTube",
                  "🎙️": "Live", "🗣️": "Stories"}
# emojis de formato que já existem no vault (para reconhecer o formato de notas antigas)
MARCAS_FORMATO = FORMATOS + ["📩", "🎣", "📚", "💻", "🧑🏼‍🏫", "✅", "🔥", "📦"]
WINNER = "🔥"   # tag de copy que performou acima da média (o card ganha borda vermelha)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}


# ---------- frontmatter ----------

def _fm(texto: str) -> str:
    m = FM.match(texto)
    return m.group(1) if m else ""


def _valor(fm: str, chave: str) -> str | None:
    m = re.search(rf"(?m)^{re.escape(chave)}:[ \t]*(.*)$", fm)
    return m.group(1).strip().strip('"\'') if m else None


def _lista(fm: str, chave: str) -> list[str]:
    """Valores de uma lista YAML simples (em bloco `- x` ou inline `[a, b]`)."""
    m = re.search(rf"(?m)^{re.escape(chave)}:[ \t]*(.*)$", fm)
    if not m:
        return []
    inline = m.group(1).strip()
    if inline:
        return [v.strip().strip('"\'') for v in inline.strip("[]").split(",") if v.strip()]
    out = []
    for linha in fm[m.end():].split("\n")[1:]:
        lm = re.match(r"^\s+-\s*(.*)$", linha)
        if not lm:
            break
        out.append(lm.group(1).strip().strip('"\''))
    return out


def _alvo(v: str | None) -> str | None:
    m = LINK.search(v or "")
    return m.group(1).strip() if m else None


def _definir(texto: str, chave: str, valor: str | list[str] | None) -> str:
    """Troca (ou cria, ou tira com None) uma propriedade no frontmatter, sem mexer no resto."""
    m = FM.match(texto)
    fm, corpo = (m.group(1), texto[m.end():]) if m else ("", "\n" + texto)
    linhas = fm.split("\n") if fm else []
    i = next((k for k, l in enumerate(linhas) if re.match(rf"^{re.escape(chave)}:", l)), None)
    if i is not None:   # tira a chave e os itens de lista que vêm debaixo dela
        j = i + 1
        while j < len(linhas) and re.match(r"^\s+-", linhas[j]):
            j += 1
        del linhas[i:j]
    else:
        i = len(linhas)
    if valor is not None:
        if isinstance(valor, list):
            novas = [f"{chave}:"] + [f'  - "{v}"' for v in valor]
        else:
            novas = [f'{chave}: "{valor}"']
        linhas[i:i] = novas
    # o FM já consumiu a quebra depois do `---`: o corpo volta exatamente como estava (sem linha em branco a mais)
    return "---\n" + "\n".join(linhas) + "\n---\n" + corpo


def _ler(p: Path, limite: int | None = 4000) -> str:
    try:
        t = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return t if limite is None else t[:limite]


def _formato(nome: str) -> str:
    base = notas.MARCAS.sub("", nome).lstrip("👁️").lstrip()
    for m in sorted(MARCAS_FORMATO, key=len, reverse=True):
        if base.startswith(m) or m in base[:6]:
            return m
    return "📄"


def _base(nome: str) -> str:
    """Nome sem marcas de status, formato e 💡: o "título da ideia"."""
    t = notas.MARCAS.sub("", nome)
    t = re.sub(r"^[\W_]+", "", t, flags=re.U)
    return t.strip() or nome


# ---------- leitura ----------

# O layout é lido, alterado e regravado por várias rotas, que o FastAPI roda em paralelo. Sem trava, duas gravações
# dividiam o mesmo .tmp e geravam um JSON quebrado, que era lido como layout vazio e regravado por cima de tudo
# (aconteceu: posições sumiram).
_trava = threading.RLock()
HISTORICO = DADOS / "canvas-historico"   # cópia de cada versão antes de gravar por cima (as últimas 200)


class LayoutIlegivel(RuntimeError):
    pass


def _travado(f):
    @functools.wraps(f)
    def g(*a, **k):
        with _trava:
            return f(*a, **k)
    return g


# ---------- canvas e produtos ----------
# A rota diz qual canvas pelo cabeçalho X-Canvas (main.py põe em `_atual`); as funções daqui usam esse por padrão.
# Além dos canvas da lista há dois internos: `inbox` (notas sem grupo) e `todos` (todas as notas, para as pastas globais).
LAYOUTS = DADOS / "canvas"
CANVASES = DADOS / "canvases.json"
PRODUTOS = DADOS / "produtos.json"
NOVAS = DADOS / "novas.json"   # 💡 ideias que chegaram de fora (radar, link colado, Jarvis) e ainda não foram usadas nem vistas
INBOX = {"slug": "inbox", "nome": "Inbox", "icone": "📥", "cor": "#e6e1d8"}
TODOS = {"slug": "todos", "nome": "Todas as notas", "icone": "🗂️", "cor": "#e6e1d8"}
_atual: contextvars.ContextVar[str] = contextvars.ContextVar("canvas", default="inbox")
CORES_CANVAS = ["#f6e3b4", "#f8d3c5", "#f3c9d9", "#dccff2", "#c9daf5", "#c4e6e0", "#d3ecc4", "#e6e1d8"]


def _slug(nome: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()).strip("-") or "canvas"


def _json(arq: Path, padrao):
    try:
        return json.loads(arq.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return padrao


def lista_canvases() -> list[dict]:
    """Os canvas temáticos (cada um é um valor de `grupo:`), na ordem que o Rodrigo arrastou (`ordem`; os sem ordem,
    em ordem alfabética, no fim), depois o Inbox."""
    d = sorted(_json(CANVASES, []), key=lambda c: (c.get("ordem", 10**6), c["nome"].lower()))
    return [*d, INBOX]


@_travado
def ordenar_canvases(slugs: list[str]) -> list[dict]:
    """Grava a ordem arrastada (pastas da esquerda e página Todos os canvas). Os que não vierem ficam no fim."""
    lista = [c for c in lista_canvases() if c["slug"] != "inbox"]
    pos = {s: i for i, s in enumerate(slugs)}
    for i, c in enumerate(sorted(lista, key=lambda c: (pos.get(c["slug"], 10**6 + lista.index(c))))):
        c["ordem"] = i
    _gravar_canvases(lista)
    return lista_canvases()


def lista_produtos() -> list[dict]:
    """Produtos: nome, ícone, cor e os prefixos de tag que dizem que a nota é dele (ex.: 🤖fia)."""
    return _json(PRODUTOS, [])


CORES_PRODUTO = ["#e0a32e", "#5b8def", "#e0679f", "#3fae7a", "#9b6be0", "#e2683c", "#2bb0c0", "#8a8f98"]


@_travado
def novo_produto(nome: str, icone: str = "") -> dict:
    """Cadastra um produto em produtos.json. A tag dele segue o padrão das outras: ícone + nome em minúsculas, sem
    espaço (ex.: 🎓 Dados → 🎓dados). Devolve o produto criado."""
    nome = nome.strip()
    if not nome:
        raise ValueError("Dê um nome ao produto.")
    lista = lista_produtos()
    slug = _slug(nome)
    if any(p["slug"] == slug or p["nome"].lower() == nome.lower() for p in lista):
        raise ValueError(f"Já existe um produto {nome}.")
    icone = icone.strip()
    tag = f"{icone}{re.sub(r'[^a-z0-9]+', '', slug)}"
    usadas = {p.get("cor") for p in lista}
    cor = next((c for c in CORES_PRODUTO if c not in usadas), CORES_PRODUTO[len(lista) % len(CORES_PRODUTO)])
    p = {"slug": slug, "nome": nome, "icone": icone, "tags": [tag], "cor": cor}
    PRODUTOS.parent.mkdir(parents=True, exist_ok=True)
    PRODUTOS.write_text(json.dumps([*lista, p], ensure_ascii=False, indent=1), encoding="utf-8")
    return p


def canvas_info(slug: str | None = None) -> dict:
    slug = slug or _atual.get()
    if slug == "todos":
        return TODOS
    return next((c for c in lista_canvases() if c["slug"] == slug), INBOX)


def _canvas_por_nome(nome: str) -> dict:
    c = next((c for c in lista_canvases() if c["nome"].lower() == nome.strip().lower() or c["slug"] == nome.strip()), None)
    if not c:
        raise FileNotFoundError(f"canvas {nome} (canvas: {', '.join(x['nome'] for x in lista_canvases())})")
    return c


def _arq(slug: str | None = None) -> Path:
    return LAYOUTS / f"{canvas_info(slug)['slug']}.json"


def _gravar_canvases(lista: list[dict]):
    DADOS.mkdir(parents=True, exist_ok=True)
    CANVASES.write_text(json.dumps([c for c in lista if c["slug"] != "inbox"], ensure_ascii=False, indent=1), encoding="utf-8")


@_travado
def salvar_canvas(c: dict) -> dict:
    """Cria (sem slug) ou edita um canvas: nome, ícone, cor e arquivado. Renomear leva o nome novo para o `grupo:` das notas."""
    lista = [x for x in lista_canvases() if x["slug"] != "inbox"]
    nome = _limpo(c.get("nome") or "").strip()
    atual = next((x for x in lista if x["slug"] == c.get("slug")), None)
    if c.get("slug") and atual is None:
        raise FileNotFoundError(f"canvas {c['slug']}")
    if nome and any(x["nome"].lower() == nome.lower() and x is not atual for x in lista):
        raise FileExistsError(f"canvas {nome}")
    if atual is None:
        if not nome:
            raise ValueError("dê um nome ao canvas")
        slug, n = _slug(nome), 2
        while any(x["slug"] == slug for x in [*lista, INBOX, TODOS]):
            slug, n = f"{_slug(nome)}-{n}", n + 1
        atual = {"slug": slug, "nome": nome, "icone": "🗂️", "cor": CORES_CANVAS[len(lista) % len(CORES_CANVAS)],
                 "criado": datetime.now().isoformat(timespec="seconds")}
        lista.append(atual)
    elif nome and nome != atual["nome"]:
        _trocar_grupo(atual["nome"], nome)
        atual["nome"] = nome
    for k in ("icone", "cor"):
        if c.get(k):
            atual[k] = c[k].strip()[:9]
    if c.get("arquivado") is not None:   # arquivado: sai das pastas da esquerda e vai para a linha de baixo da página
        if c["arquivado"]:
            atual["arquivado"] = True
        else:
            atual.pop("arquivado", None)
    _gravar_canvases(lista)
    return atual


@_travado
def apagar_canvas(slug: str) -> int:
    """Tira o canvas da lista; as notas dele voltam para o Inbox (perdem o `grupo:`). O layout vai para o histórico."""
    lista = [x for x in lista_canvases() if x["slug"] != "inbox"]
    c = next((x for x in lista if x["slug"] == slug), None)
    if not c:
        raise FileNotFoundError(f"canvas {slug}")
    _gravar_canvases([x for x in lista if x["slug"] != slug])
    arq = _arq(slug)
    if arq.is_file():
        HISTORICO.mkdir(exist_ok=True)
        shutil.move(arq, HISTORICO / f"{slug}-apagado-{datetime.now():%Y%m%d-%H%M%S}.json")
    return _trocar_grupo(c["nome"], None)


def _da_tag(tags: list[str], prefixos: list[str]) -> bool:
    return any(t.lstrip("#").startswith(p) for t in tags for p in prefixos)


def marcar_no_canvas(raiz: str, nome: str):
    """Nota criada dentro de um canvas temático já nasce nele (`grupo:`); no Inbox fica sem grupo."""
    c = canvas_info()
    p = notas._caminho(raiz, nome)
    if c["slug"] in ("inbox", "todos") or not p or not p.is_file():
        return
    t = _ler(p, None)
    gs = _lista(_fm(t), "grupo")
    if c["nome"] not in gs:
        gs = [*gs, c["nome"]]
        notas._escrever(p, _definir(t, "grupo", gs if len(gs) > 1 else gs[0]))


def _layout(slug: str | None = None) -> dict:
    arq = _arq(slug)
    try:
        d = json.loads(arq.read_text(encoding="utf-8"))
    except FileNotFoundError:
        d = {}
    except (OSError, ValueError) as e:   # nunca tratar um arquivo quebrado como vazio: a próxima gravação apagaria tudo
        raise LayoutIlegivel(f"{arq.name} ilegível ({e}); restaure de {HISTORICO.name}/") from e
    d.setdefault("pos", {})
    d.setdefault("arquivados", [])
    d.setdefault("visiveis", [])   # cards trazidos à mão: aparecem mesmo publicados no Inbox
    return d


def _gravar_layout(d: dict, slug: str | None = None):
    with _trava:
        LAYOUTS.mkdir(parents=True, exist_ok=True)
        arq = _arq(slug)
        if arq.is_file():
            HISTORICO.mkdir(exist_ok=True)
            pref = arq.stem   # cada canvas tem o seu histórico
            shutil.copy2(arq, HISTORICO / f"{pref}-{datetime.now():%Y%m%d-%H%M%S-%f}.json")
            for velho in sorted(HISTORICO.glob(f"{pref}-*.json"))[:-200]:
                velho.unlink(missing_ok=True)
        fd, tmp = tempfile.mkstemp(dir=LAYOUTS, prefix=".canvas-", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(d, ensure_ascii=False, indent=1))
        os.replace(tmp, arq)


# ---------- desenho (Excalidraw) ----------
# Cada canvas tem a sua camada de desenho: os elementos e os arquivos (imagens) do Excalidraw, num arquivo à parte do
# layout (`<slug>.desenho.json`), com o mesmo cuidado: temporário próprio e a versão anterior no histórico.

def _arq_desenho(slug: str | None = None) -> Path:
    return LAYOUTS / f"{canvas_info(slug)['slug']}.desenho.json"


def desenho(slug: str | None = None) -> dict:
    arq = _arq_desenho(slug)
    try:
        d = json.loads(arq.read_text(encoding="utf-8"))
    except FileNotFoundError:
        d = {}
    except (OSError, ValueError) as e:
        raise LayoutIlegivel(f"{arq.name} ilegível ({e}); restaure de {HISTORICO.name}/") from e
    return {"elements": d.get("elements", []), "files": d.get("files", {})}


@_travado
def salvar_desenho(d: dict, slug: str | None = None):
    LAYOUTS.mkdir(parents=True, exist_ok=True)
    arq = _arq_desenho(slug)
    if arq.is_file():
        HISTORICO.mkdir(exist_ok=True)
        pref = arq.stem.replace(".", "-")
        shutil.copy2(arq, HISTORICO / f"{pref}-{datetime.now():%Y%m%d-%H%M%S-%f}.json")
        for velho in sorted(HISTORICO.glob(f"{pref}-*.json"))[:-100]:
            velho.unlink(missing_ok=True)
    fd, tmp = tempfile.mkstemp(dir=LAYOUTS, prefix=".desenho-", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps({"elements": d.get("elements", []), "files": d.get("files", {})}, ensure_ascii=False))
    os.replace(tmp, arq)


URL = re.compile(r"https?://[^\s)\]>\"']+")
IMG = re.compile(r"!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\((https?://[^)\s]+)\)")
EXT_IMG = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif")


def _midia(texto: str) -> dict:
    """Links, primeira imagem e se a nota já tem copy (texto além de links, imagens e títulos)."""
    corpo = FM.sub("", texto, count=1)
    img = None
    for m in IMG.finditer(corpo):
        alvo = m.group(2) or f"/api/anexo/{m.group(1).strip()}"
        if m.group(2) or m.group(1).lower().endswith(EXT_IMG):
            img = alvo
            break
    links = list(dict.fromkeys(u.rstrip(".,;") for u in URL.findall(IMG.sub("", corpo))))[:6]
    resto = re.sub(r"^#.*$", "", IMG.sub("", URL.sub("", corpo)), flags=re.M)
    copia = len(re.sub(r"[\s\-*>#=_|`]+", " ", resto).strip()) >= 80
    return {"links": links, "imagem": img, "copia": copia}


def _todas() -> dict:
    """Todas as notas do canvas (ideias, entradas e copies), cada uma com `canvas`: o nome do canvas onde ela vive.
    Copy sem `grupo:` vai junto com a ideia dela; ideia sem `grupo:` vai com a maioria das copies dela. Grupo que não é
    canvas nenhum (ou vazio) = Inbox."""
    ideias, entradas, producoes = [], [], []
    for nome, p in notas._arquivos("ideias"):
        t = _ler(p)
        fm = _fm(t)
        m = _midia(t)
        if not m["imagem"] and _valor(fm, "thumb"):
            m["imagem"] = _valor(fm, "thumb")
        ideias.append({"nome": nome, "previa": notas._previa(t), **m, "grupo": _valor(fm, "grupo"), "grupos": _lista(fm, "grupo"), "tags": _lista(fm, "tags"), "fontes": [x for x in map(_alvo, _lista(fm, "fontes")) if x],
                       "mtime": p.stat().st_mtime})
    for nome, p in notas._arquivos("entradas"):
        t = _ler(p)
        fm = _fm(t)
        entradas.append({"nome": nome, "url": _valor(fm, "url") or "", "tipo": _valor(fm, "tipo") or "link",
                         "thumb": _valor(fm, "thumb") or "", "grupo": _valor(fm, "grupo"), "grupos": _lista(fm, "grupo"), "tags": _lista(fm, "tags"),
                         "previa": notas._previa(t), "mtime": p.stat().st_mtime})
    for raiz in notas.PASTAS:
        for nome, p in notas._arquivos(raiz):
            inteiro = _ler(p, None)
            t = inteiro[:3000]
            fm = _fm(t)
            sched = notas._scheduled(t)
            st = p.stat()
            corpo = FM.sub("", inteiro, count=1)
            palavras = len(re.findall(r"[\wÀ-ÿ]+", URL.sub("", IMG.sub("", corpo))))
            producoes.append({"nome": nome, "raiz": raiz, "status": notas.status(raiz, nome), "scheduled": sched, "datas": notas._datas(t),
                              "ano": (sched or datetime.fromtimestamp(getattr(st, "st_birthtime", st.st_mtime)).strftime("%Y"))[:4],
                              "formato": _formato(nome), "ideia": _alvo(_valor(fm, "ideia")), "grupo": _valor(fm, "grupo"), "grupos": _lista(fm, "grupo"),
                              "previa": notas._previa(t), "mtime": st.st_mtime, "criado": getattr(st, "st_birthtime", st.st_mtime),
                              "palavras": palavras, "winner": WINNER in _lista(fm, "tags"), "tags": _lista(fm, "tags"), **_midia(t)})
    # `grupo:` pode ter vários canvas (a nota vive em todos). `canvases` = os válidos; `canvas` = o primeiro (ou None)
    nomes = {c["nome"] for c in lista_canvases() if c["slug"] != "inbox"}
    validos = lambda gs: [g for g in dict.fromkeys(gs) if g in nomes]
    por_ideia: dict[str, list[str]] = {}
    for pr in producoes:
        if pr["ideia"]:
            por_ideia.setdefault(pr["ideia"], []).extend(validos(pr["grupos"]))
    for i in ideias:   # ideia sem grupo vive onde as copies dela vivem
        i["canvases"] = validos(i["grupos"]) or list(dict.fromkeys(por_ideia.get(i["nome"], [])))
    da_ideia = {i["nome"]: i["canvases"] for i in ideias}
    for pr in producoes:   # copy sem grupo vive onde a ideia dela vive
        pr["canvases"] = validos(pr["grupos"]) or da_ideia.get(pr["ideia"] or "", [])
    for e in entradas:
        e["canvases"] = validos(e["grupos"])
    for x in (*ideias, *producoes, *entradas):
        x["canvas"] = x["canvases"][0] if x["canvases"] else None
    return {"ideias": ideias, "entradas": entradas, "producoes": producoes}


def _gravar_novas(nomes: list[str]):
    DADOS.mkdir(parents=True, exist_ok=True)
    NOVAS.write_text(json.dumps(list(dict.fromkeys(nomes)), ensure_ascii=False, indent=1), encoding="utf-8")


def marcar_nova(nome: str):
    """Ideia que chegou de fora ganha o selo NOVO no card, até ser usada (ganhar uma produção) ou vista."""
    _gravar_novas([*_json(NOVAS, []), nome])


def marcar_vista(nomes: list[str]):
    _gravar_novas([n for n in _json(NOVAS, []) if n not in set(nomes)])


def _novas(tudo: dict) -> list[str]:
    """As novas que continuam novas: a 💡 ideia existe e ainda não tem produção (usar a ideia tira o selo sozinho);
    a copy criada à mão (⌘⇧N, nova copy) fica nova até ser vista (aberta ou o selo clicado)."""
    usadas = {p.get("ideia") for p in tudo["producoes"]}
    ideias = {i["nome"] for i in tudo["ideias"]}
    copias = {p["nome"] for p in tudo["producoes"]}
    lista = _json(NOVAS, [])
    vivas = [n for n in lista if (n in ideias and n not in usadas) or n in copias]
    if len(vivas) != len(lista):
        _gravar_novas(vivas)
    return vivas


def estado(slug: str | None = None) -> dict:
    info = canvas_info(slug)
    tudo = _todas()
    novas = _novas(tudo)
    if info["slug"] != "todos":   # o canvas mostra as notas que vivem nele (Inbox: as que não vivem em nenhum)
        alvo = None if info["slug"] == "inbox" else info["nome"]
        tudo = {k: [x for x in v if (alvo in x["canvases"] if alvo else not x["canvases"])] for k, v in tudo.items()}
    lay = _layout(info["slug"])
    return {"canvas": info, "produtos": lista_produtos(), "visiveis": lay["visiveis"], **tudo, "pos": lay["pos"],
            "arquivados": lay["arquivados"], "novas": novas,
            "formatos": [{"emoji": f, "nome": ROTULO_FORMATO[f]} for f in FORMATOS]}


@_travado
def posicoes(pos: dict[str, dict]):
    d = _layout()
    for k, v in pos.items():
        d["pos"][k] = {"x": round(float(v["x"])), "y": round(float(v["y"]))}
    _gravar_layout(d)


@_travado
def arquivar(id_: str, sim: bool):
    """Arquivar esconde o card deste canvas. Desarquivar põe em `visiveis` também: senão uma copy publicada no Inbox
    continuaria escondida pela regra das publicadas."""
    d = _layout()
    d["arquivados"] = [a for a in d["arquivados"] if a != id_] + ([id_] if sim else [])
    d["visiveis"] = [a for a in d["visiveis"] if a != id_] + ([] if sim else [id_])
    _gravar_layout(d)


@_travado
def _renomear_pos(antes: str, depois: str):
    """A nota mudou de nome/pasta: o card fica no mesmo lugar em todos os canvas (e nas vistas `<vista>|<id>`)."""
    for c in [*lista_canvases(), TODOS]:
        if not _arq(c["slug"]).is_file():
            continue
        d = _layout(c["slug"])
        mudou = False
        for k in list(d["pos"]):
            if k == antes or k.endswith("|" + antes):
                d["pos"][k[: len(k) - len(antes)] + depois] = d["pos"].pop(k)
                mudou = True
        if antes in d["arquivados"]:
            d["arquivados"] = [depois if a == antes else a for a in d["arquivados"]]
            mudou = True
        if mudou:
            _gravar_layout(d, c["slug"])


# ---------- escrita ----------

def _limpo(titulo: str) -> str:
    return re.sub(r"[/\\:\x00]", "-", titulo).strip()


def _livre(pasta: Path, nome: str) -> Path:
    p = pasta / f"{nome}.md"
    n = 2
    while p.exists():
        p = pasta / f"{nome} {n}.md"
        n += 1
    return p


def criar_ideia(titulo: str, brief: str = "", fontes: list[str] | None = None, pos: dict | None = None) -> dict:
    titulo = _limpo(re.sub(r"^💡\s*", "", titulo)) or "Nova ideia"
    notas.IDEIAS.mkdir(parents=True, exist_ok=True)
    p = notas.IDEIAS / f"💡 {titulo}.md"
    if p.exists():
        raise FileExistsError(p.name)
    links = [f"[[{f}]]" for f in (fontes or [])]
    texto = _definir("---\norigin:\ntags:\n---\n", "fontes", links or None) + (f"\n{brief.strip()}\n" if brief.strip() else "\n")
    notas._escrever(p, texto)
    marcar_no_canvas("ideias", p.stem)
    marcar_nova(p.stem)   # toda ideia nova nasce com o selo NOVO (criada à mão, pelo Jarvis, pela busca)
    if pos:
        posicoes({f"i:{p.stem}": pos})
    return {"nome": p.stem, "raiz": "ideias"}


def _texto_pagina(url: str) -> dict:
    r = httpx.get(url, headers=UA, timeout=15, follow_redirects=True)
    r.raise_for_status()
    s = BeautifulSoup(r.text, "html.parser")
    meta = lambda *ks: next((m.get("content") for k in ks for m in s.find_all("meta", attrs={"property": k}) + s.find_all("meta", attrs={"name": k}) if m.get("content")), "")
    titulo = meta("og:title", "twitter:title") or (s.title.string.strip() if s.title and s.title.string else url)
    for t in s(["script", "style", "nav", "footer", "header", "aside", "form"]):
        t.decompose()
    paragrafos = [p.get_text(" ", strip=True) for p in s.find_all(["p", "h2", "h3", "li"])]
    corpo = "\n\n".join(x for x in paragrafos if len(x) > 40)[:12000]
    return {"titulo": titulo, "thumb": meta("og:image", "twitter:image"), "descricao": meta("og:description", "description"),
            "corpo": corpo}


def criar_entrada(conteudo: str, ideia: str | None = None, pos: dict | None = None, pronto: dict | None = None) -> dict:
    """Link ou texto colado no canvas vira uma 💡 ideia já com o material dentro.
    Com `ideia`, o link/texto entra no fim daquela ideia em vez de virar outra.
    Com `pronto` ({titulo, url, thumb}), a ideia vem de um card do radar: usa o que o card já tem, sem ler a página."""
    conteudo = conteudo.strip()
    if not conteudo:
        raise ValueError("ideia vazia")
    if ideia:
        p = _caminho_ideia(ideia)
        notas._escrever(p, _ler(p, None).rstrip() + f"\n\n{conteudo}\n")
        return {"nome": p.stem, "raiz": "ideias"}
    url = conteudo if re.fullmatch(r"https?://\S+", conteudo) else ""
    fm = {"url": url, "tipo": "texto", "thumb": ""}
    corpo, titulo, emoji = conteudo, conteudo.split("\n")[0][:70], "💭"
    if pronto:
        fm.update(url=pronto.get("url") or "", tipo="radar", thumb=pronto.get("thumb") or "")
        titulo = pronto.get("titulo") or titulo
    elif url and youtube.id_do_link(url):
        vid = youtube.id_do_link(url)
        fm.update(tipo="youtube", thumb=f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg")
        emoji, titulo = "▶️", vid
        try:
            o = httpx.get("https://www.youtube.com/oembed", params={"url": url, "format": "json"}, timeout=10).json()
            titulo = o.get("title") or titulo
            fm["autor"] = o.get("author_name", "")
        except Exception:
            pass
        d = youtube.transcrever(url)
        corpo = f"{url}\n\n## Transcrição\n\n{d['texto']}" if "texto" in d else f"{url}\n\n(sem legenda: {d.get('erro')})"
    elif url:
        insta = "instagram.com" in url
        fm["tipo"] = "instagram" if insta else "link"
        emoji = "📸" if insta else "🔗"
        try:
            pg = _texto_pagina(url)
            titulo = pg["titulo"]
            fm["thumb"] = pg["thumb"]
            corpo = "\n\n".join(x for x in [url, pg["descricao"] and f"> {pg['descricao']}", pg["corpo"]] if x)
        except Exception as e:
            titulo = re.sub(r"^https?://(www\.)?", "", url)[:60]
            corpo = f"{url}\n\n(não consegui ler a página: {type(e).__name__})"
    titulo = _limpo(re.sub(r"\s+", " ", titulo))[:80] or "Nova ideia"
    notas.IDEIAS.mkdir(parents=True, exist_ok=True)
    p = _livre(notas.IDEIAS, f"💡 {titulo}")
    cab = "---\n" + "".join(f'{k}: "{v}"\n' for k, v in fm.items() if v or k in ("url", "tipo")) + "tags:\n---\n\n"
    notas._escrever(p, cab + corpo.strip() + "\n")
    marcar_no_canvas("ideias", p.stem)
    marcar_nova(p.stem)
    if pos:
        posicoes({f"i:{p.stem}": pos})
    return {"nome": p.stem, "raiz": "ideias"}


def _caminho_ideia(ideia: str) -> Path:
    p = notas.IDEIAS / f"{ideia}.md"
    if not p.is_file():
        raise FileNotFoundError(ideia)
    return p


def ligar_fonte(ideia: str, entrada: str, sim: bool):
    p = _caminho_ideia(ideia)
    t = _ler(p, None)
    atuais = [x for x in map(_alvo, _lista(_fm(t), "fontes")) if x]
    novas = [x for x in atuais if x != entrada] + ([entrada] if sim else [])
    notas._escrever(p, _definir(t, "fontes", [f"[[{x}]]" for x in novas] or None))


def ligar_producao(raiz: str, nome: str, ideia: str | None):
    if raiz not in notas.PASTAS:
        raise ValueError("só copies de 1 Priorizar ou 2 Publicados")
    p = notas._caminho(raiz, nome)
    if not p or not p.is_file():
        raise FileNotFoundError(nome)
    t = _ler(p, None)
    notas._escrever(p, _definir(t, "ideia", f"[[{ideia}]]" if ideia else None))


def agrupar(titulo: str, producoes: list[dict], pos: dict | None = None) -> dict:
    """Junta copies num card de produção 🎬. Não cria nota 💡: o grupo é só a chave `ideia:` em cada copy."""
    nome = f"💡 {_limpo(re.sub(r'^💡\s*', '', titulo)) or 'Produção'}"
    for pr in producoes:
        ligar_producao(pr["raiz"], pr["nome"], nome)
    if pos:
        posicoes({f"g:{nome}": pos})
    return {"nome": nome, "raiz": "ideias"}


def criar_saida(ideia: str, formato: str, titulo: str = "", texto: str = "") -> dict:
    """Nova produção em Priorizar ligada à ideia: `<formato> <nome da ideia>` (ou o título dado)."""
    if formato not in FORMATOS:
        raise ValueError(f"formato inválido (use um de {' '.join(FORMATOS)})")
    nome = _limpo(titulo) if titulo.strip() else f"{formato} {_base(ideia)}"
    if not nome.startswith(formato):
        nome = f"{formato} {nome}"
    p = _livre(notas.PRIORIZAR, nome)
    cab = f'---\npublicado: false\nscheduled:\nideia: "[[{ideia}]]"\ngrupo:\nnotion:\ntags:\n---\n\n'   # o mesmo de T-Copy.md
    notas._escrever(p, cab + (texto.strip() + "\n" if texto.strip() else ""))
    marcar_no_canvas("priorizar", p.stem)
    return {"nome": p.stem, "raiz": "priorizar"}


@_travado
def posicionar_perto(card: str, perto_de: str):
    """Para o agente: põe o card ao lado de outro (ids `i:`, `e:` ou `p:raiz/nome`, ou só o nome da nota)."""
    d = _layout()
    achar = lambda n: n if n in d["pos"] else next((k for k in d["pos"] if k.split(":", 1)[-1].split("/")[-1] == n), None)
    alvo = achar(perto_de)
    if not alvo:
        raise ValueError(f"{perto_de} ainda não tem posição no canvas")
    base = d["pos"][alvo]
    chave = achar(card) or (card if ":" in card else f"i:{card}" if card.startswith("💡") else f"e:{card}")
    d["pos"][chave] = {"x": base["x"] + 320, "y": base["y"]}
    _gravar_layout(d)


def _id(raiz: str, nome: str) -> str:
    return {"ideias": f"i:{nome}", "entradas": f"e:{nome}"}.get(raiz, f"p:{raiz}/{nome}")


def renomeou(raiz: str, antes: str, raiz_depois: str, depois: str):
    """Renomeou, mudou status ou publicou: o card continua no mesmo lugar do canvas."""
    _renomear_pos(_id(raiz, antes), _id(raiz_depois, depois))
    if antes in _json(NOVAS, []):
        _gravar_novas([depois if n == antes else n for n in _json(NOVAS, [])])


# ---------- mídia dos cards ----------

ANEXOS = notas.VAULT / "2 Notas" / "Engine" / "attachments"
_videos_x: dict[str, dict | None] = {}


def anexo(nome: str) -> Path | None:
    """Imagem colada numa nota (`![[Pasted image ….png]]`): fica em attachments, ou em outro canto do vault."""
    nome = Path(nome).name
    p = ANEXOS / nome
    if p.is_file():
        return p
    return next((q for q in notas.VAULT.rglob(nome) if ".trash" not in q.parts and ".obsidian" not in q.parts), None)


def video_x(url: str) -> dict | None:
    """Capa e MP4 de um post do X (via FxTwitter), para o card tocar o vídeo como no radar."""
    m = re.search(r"(?:x|twitter)\.com/[^/]+/status/(\d+)", url)
    if not m:
        return None
    if m.group(1) in _videos_x:
        return _videos_x[m.group(1)]
    from . import videos_x
    try:
        r = httpx.get(videos_x.API.format(m.group(1)), timeout=12, headers={"User-Agent": "jarvis-conteudo/0.1"})
        r.raise_for_status()
        tw = r.json().get("tweet") or {}
    except Exception:
        return None
    media = tw.get("media") or {}
    capa = next((f.get("thumbnail_url") or f.get("url") for f in media.get("all") or [] if f.get("thumbnail_url") or f.get("type") == "photo"), None)
    info = {"video": videos_x._melhor(media), "imagem": capa, "texto": (tw.get("text") or "")[:200]}
    _videos_x[m.group(1)] = info
    return info


# ---------- frontmatter em lote ----------

def _notas_do_canvas():
    for raiz in ("ideias", "entradas", *notas.PASTAS):
        for nome, p in notas._arquivos(raiz):
            yield raiz, nome, p


@_travado
def definir_grupo(alvos: list[dict], grupo: str | None) -> list[dict]:
    """Grava `grupo` nas notas. Devolve só as que mudaram, com o valor de antes (o ⌘Z do app usa isso)."""
    mudou = []
    for a in alvos:
        p = notas._caminho(a["raiz"], a["nome"])
        if not p or not p.is_file():
            raise FileNotFoundError(a["nome"])
        t = _ler(p, None)
        antes = _valor(_fm(t), "grupo") or None
        if antes != (grupo or None):
            notas._escrever(p, _definir(t, "grupo", grupo or None))
            mudou.append({"nota": {"raiz": a["raiz"], "nome": a["nome"]}, "antes": antes, "depois": grupo or None})
    return mudou


def marcar_winner(alvos: list[dict], sim: bool) -> int:
    """Põe ou tira a tag 🔥 (winner) nas notas, mantendo as outras tags. Devolve quantas mudaram."""
    n = 0
    for a in alvos:
        p = notas._caminho(a["raiz"], a["nome"])
        if not p or not p.is_file():
            raise FileNotFoundError(a["nome"])
        t = _ler(p, None)
        tags = _lista(_fm(t), "tags")
        novas = [x for x in tags if x != WINNER] + ([WINNER] if sim else [])
        if novas != tags:
            notas._escrever(p, _definir(t, "tags", novas))   # lista vazia fica `tags:` (a chave não some)
            n += 1
    return n


def _trocar_grupo(antigo: str, novo: str | None) -> int:
    """Renomear (novo) ou apagar (None) um canvas: troca ou tira o nome dele no `grupo:` das notas (que pode ter vários)."""
    n = 0
    for _, _, p in _notas_do_canvas():
        t = _ler(p, None)
        gs = _lista(_fm(t), "grupo")
        if antigo in gs:
            gs = list(dict.fromkeys([novo if g == antigo else g for g in gs if novo or g != antigo]))
            notas._escrever(p, _definir(t, "grupo", (gs if len(gs) > 1 else gs[0]) if gs else None))
            n += 1
    return n


# ---------- para o agente do chat: as mesmas ações do app, pelo nome da nota ----------

def achar(nome: str) -> tuple[str, str]:
    """Raiz de uma nota pelo nome (sem .md). Procura em Priorizar, Publicados, Ideias e Entradas, nessa ordem."""
    nome = nome.strip().removesuffix(".md").strip("[]")
    for raiz in ("priorizar", "publicados", "ideias", "entradas"):
        if (notas.TODAS[raiz] / f"{nome}.md").is_file():
            return raiz, nome
    # sem a marca de status (o nome muda ao virar 🧑🏼‍🔧/🔹 ou ao publicar): compara sem as marcas dos dois lados
    base = notas.MARCAS.sub("", nome).strip()
    for raiz in ("priorizar", "publicados"):
        for n, _ in notas._arquivos(raiz):
            if notas.MARCAS.sub("", n).strip() == base:
                return raiz, n
    raise FileNotFoundError(nome)


def mudar_status(nome: str, status: str) -> dict:
    """ideia | gravar | edicao | agendado | publicado. Publicar move para 2 Publicados; despublicar volta para Priorizar.
    A posição do card no canvas vai junto (como no app)."""
    raiz, nome = achar(nome)
    if raiz not in notas.PASTAS:
        raise ValueError("só copies (1 Priorizar ou 2 Publicados) têm status")
    if status not in ("ideia", "gravar", "edicao", "agendado", "publicado"):
        raise ValueError("status é ideia, gravar, edicao, agendado ou publicado")
    antes = (raiz, nome)
    if status == "publicado":
        d = notas.mover(raiz, nome, "publicados") if raiz != "publicados" else {"raiz": raiz, "nome": nome}
    else:
        d = notas.mover(raiz, nome, "priorizar") if raiz == "publicados" else {"raiz": raiz, "nome": nome}
        if status != notas.status(d["raiz"], d["nome"]):
            d = notas.mudar_status(d["raiz"], d["nome"], status)
    if (d["raiz"], d["nome"]) != antes:
        renomeou(antes[0], antes[1], d["raiz"], d["nome"])
    return {"raiz": d["raiz"], "nome": d["nome"]}


def _id_do_card(raiz: str, nome: str) -> str:
    """O id do card que mostra a nota no canvas (a mesma regra do app: produção 🎬 com 2+ saídas ou com nota 💡)."""
    if raiz in ("ideias", "entradas"):
        return _id(raiz, nome)
    if _formato(nome) == "📺":   # VSL tem card próprio, nunca entra no card de produção
        return f"p:{raiz}/{nome}"
    ideia = _alvo(_valor(_fm(_ler(notas._caminho(raiz, nome))), "ideia"))
    if ideia:
        irmas = sum(1 for r in notas.PASTAS for n, p in notas._arquivos(r)
                    if _formato(n) != "📺" and _alvo(_valor(_fm(_ler(p)), "ideia")) == ideia)
        if irmas >= 2 or (notas.IDEIAS / f"{ideia}.md").is_file():
            return f"g:{ideia}"
    return f"p:{raiz}/{nome}"


def _familia(raiz: str, nome: str) -> tuple[str, list[dict]]:
    """O card da nota e todas as notas que andam com ele: a 💡 ideia e as copies dela (as saídas e a VSL)."""
    card = _id_do_card(raiz, nome)
    ideia = nome if raiz == "ideias" else card[2:] if card.startswith("g:") else \
        _alvo(_valor(_fm(_ler(notas._caminho(raiz, nome))), "ideia")) if raiz in notas.PASTAS else None
    alvos = [{"raiz": raiz, "nome": nome}]
    if ideia:
        alvos = [{"raiz": r, "nome": n} for r in notas.PASTAS for n, p in notas._arquivos(r) if _alvo(_valor(_fm(_ler(p)), "ideia")) == ideia]
        if (notas.IDEIAS / f"{ideia}.md").is_file():
            alvos.append({"raiz": "ideias", "nome": ideia})
        if {"raiz": raiz, "nome": nome} not in alvos:
            alvos.append({"raiz": raiz, "nome": nome})
    return card, alvos


@_travado
def mover_para_canvas(nomes: list[str], destino: str | None) -> dict:
    """Leva as notas (com a ideia e as copies delas, para o card não se partir) para outro canvas: grava `grupo:` e dá
    lugar aos cards lá, numa fileira abaixo do que já existe. `destino` vazio ou "Inbox" = sem grupo."""
    c = INBOX if not destino or destino.strip().lower() in ("inbox", "📥 inbox") else _canvas_por_nome(destino)
    grupo = None if c["slug"] == "inbox" else c["nome"]
    d = _layout(c["slug"])
    base_y = max([v["y"] for v in d["pos"].values()] + [-300]) + 300
    cards, mudou, novos = [], 0, 0
    for nome in nomes:
        raiz, nome = achar(nome)
        card, alvos = _familia(raiz, nome)
        mudou += len(definir_grupo(alvos, grupo))
        for a in alvos:   # todos os cards da família (ideia, produção, VSL) ganham lugar e saem dos arquivados
            k = _id_do_card(a["raiz"], a["nome"])
            if k in cards:
                continue
            cards.append(k)
            if k not in d["pos"]:
                d["pos"][k] = {"x": (novos % 6) * 304, "y": base_y + (novos // 6) * 260}
                novos += 1
            d["arquivados"] = [x for x in d["arquivados"] if x != k]
            if k not in d["visiveis"]:
                d["visiveis"].append(k)
    _gravar_layout(d, c["slug"])
    return {"cards": cards, "canvas": c["nome"], "notas": mudou}


@_travado
def canvas_da_nota(nomes: list[str], destino: str, sim: bool) -> dict:
    """Canvas › (menu do card): marca (sim) ou desmarca um canvas nas notas, com a ideia e as copies delas. Uma nota
    vive em quantos canvas quiser (`grupo:` vira lista). Desmarcar o último leva a nota para o Inbox."""
    c = _canvas_por_nome(destino)
    d = _layout(c["slug"])
    base_y = max([v["y"] for v in d["pos"].values()] + [-300]) + 300
    tudo = {x["nome"]: x for k in ("ideias", "producoes", "entradas") for x in _todas()[k]}
    cards, mudou, novos = [], 0, 0
    for nome in nomes:
        raiz, nome = achar(nome)
        _, alvos = _familia(raiz, nome)
        for a in alvos:
            p = notas._caminho(a["raiz"], a["nome"])
            if not p or not p.is_file():
                continue
            t = _ler(p, None)
            atuais = tudo.get(a["nome"], {}).get("canvases") or _lista(_fm(t), "grupo")   # herdado da ideia conta
            gs = list(dict.fromkeys([*atuais, c["nome"]])) if sim else [g for g in atuais if g != c["nome"]]
            if gs != _lista(_fm(t), "grupo"):
                notas._escrever(p, _definir(t, "grupo", (gs if len(gs) > 1 else gs[0]) if gs else None))
                mudou += 1
            if sim:   # o card ganha lugar no canvas marcado e sai dos arquivados dele
                k = _id_do_card(a["raiz"], a["nome"])
                if k in cards:
                    continue
                cards.append(k)
                if k not in d["pos"]:
                    d["pos"][k] = {"x": (novos % 6) * 304, "y": base_y + (novos // 6) * 260}
                    novos += 1
                d["arquivados"] = [x for x in d["arquivados"] if x != k]
    if sim:
        _gravar_layout(d, c["slug"])
    return {"cards": cards, "canvas": c["nome"], "notas": mudou}


def listar_canvas() -> list[dict]:
    """Os canvas (nome, quantas notas vivem em cada um) e os produtos (nome e tags), para o agente."""
    return [{"canvas": c["nome"], "slug": c["slug"], **{k: v for k, v in r.items() if k in ("ideias", "producoes", "vsls")}}
            for c, r in ((c, next(x for x in resumos() if x["slug"] == c["slug"])) for c in lista_canvases())]


# ---------- imagens coladas no chat ----------

TIPOS_IMAGEM = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}


def salvar_imagem(dados: bytes, tipo: str) -> dict:
    """Imagem colada no chat vai para os anexos do vault, com o nome que o Obsidian daria (`Pasted image <data>.png`):
    o agente lê o arquivo e a imagem fica no vault para usar numa nota com `![[...]]`."""
    ext = TIPOS_IMAGEM.get(tipo)
    if not ext:
        raise ValueError("formato de imagem não suportado (png, jpg, webp ou gif)")
    if len(dados) > 15 * 1024 * 1024:
        raise ValueError("imagem maior que 15 MB")
    ANEXOS.mkdir(parents=True, exist_ok=True)
    base = f"Pasted image {datetime.now():%Y%m%d%H%M%S}"
    p, n = ANEXOS / f"{base}.{ext}", 1
    while p.exists():
        p, n = ANEXOS / f"{base} {n}.{ext}", n + 1
    p.write_bytes(dados)
    return {"nome": p.name, "caminho": str(p.relative_to(notas.VAULT))}


def resumos() -> list[dict]:
    """Contagens de cada canvas (e de cada produto dentro dele) lendo as notas uma vez só."""
    tudo = _todas()
    prods = lista_produtos()
    out = []
    for c in lista_canvases():
        alvo = None if c["slug"] == "inbox" else c["nome"]
        dentro = lambda x: alvo in x["canvases"] if alvo else not x["canvases"]
        pr = [p for p in tudo["producoes"] if dentro(p)]
        ideias = [i for i in tudo["ideias"] if dentro(i)]
        out.append({**c, "ideias": len(ideias), "producoes": sum(1 for p in pr if p["formato"] != "📺"),
                    "vsls": sum(1 for p in pr if p["formato"] == "📺"), "publicadas": sum(1 for p in pr if p["status"] == "publicado"),
                    "produtos": {x["slug"]: sum(1 for p in pr if _da_tag(p["tags"], x["tags"])) for x in prods}})
    return out


def no_produto(nomes: list[str], slug: str, sim: bool) -> int:
    """Põe (a tag do produto) ou tira (todas as tags dos prefixos dele, inclusive subtags) as notas de um produto.
    Uma nota pode ser de vários produtos: é só ter as tags deles."""
    info = next((x for x in lista_produtos() if x["slug"] == slug), None)
    if not info:
        raise FileNotFoundError(f"produto {slug}")
    n = 0
    for nome in nomes:
        raiz, nome = achar(nome)
        p = notas._caminho(raiz, nome)
        t = _ler(p, None)
        tags = _lista(_fm(t), "tags")
        novas = (tags + [info["tags"][0]]) if sim and not _da_tag(tags, info["tags"]) else \
                ([x for x in tags if not _da_tag([x], info["tags"])] if not sim else tags)
        if novas != tags:
            notas._escrever(p, _definir(t, "tags", novas))
            n += 1
    return n


def importar(nome: str) -> dict:
    """⌘↵ na busca: traz a nota (com a família dela) para o canvas atual, fora dos arquivados e visível mesmo publicada.
    Devolve o id do card para o app enquadrar."""
    raiz, nome = achar(nome)
    info = canvas_info()
    if info["slug"] == "todos":
        raise ValueError("abra um canvas para trazer a nota")
    mover_para_canvas([nome], info["nome"])
    raiz, nome = achar(nome)
    return {"card": _id_do_card(raiz, nome), "raiz": raiz, "nome": nome, "canvas": info["nome"]}
