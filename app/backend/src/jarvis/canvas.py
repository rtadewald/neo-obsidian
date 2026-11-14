"""O canvas do Neo-Obsidian: ideias (💡), entradas (material bruto) e produções (as copies de sempre).

- 💡 ideia      → `1 Copies/0 Ideias/💡 Nome.md`, sem status. Pode ser só um nome ou já trazer o material bruto:
                  link ou texto colado vira ideia com `url`, `tipo` e `thumb` no frontmatter e o material
                  (transcrição, texto da página) no corpo. (Antes isso era um tipo à parte, "entrada"; agora é tudo ideia.)
- produção      → as copies de `1 Priorizar` e `2 Publicados`, que seguem o fluxo de status por nome/pasta.
                  Pertence a uma ideia quando tem `ideia: "[[💡 Nome]]"` no frontmatter; nota sem ideia é normal.

Posição dos cards e cards arquivados (escondidos do canvas) ficam em `app/dados/canvas.json`, fora do vault.
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

ARQ = DADOS / "canvas.json"
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

# O layout é lido, alterado e regravado por várias rotas, que o FastAPI roda em paralelo (arrastar uma caixa manda
# posição, caixa e grupo quase juntos). Sem trava, duas gravações dividiam o mesmo .tmp e geravam um JSON quebrado,
# que era lido como layout vazio e regravado por cima de tudo (aconteceu: caixas e posições sumiram).
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


# ---------- canvas isolados (como os projetos do Neo Stitch) ----------
# Cada canvas tem o seu layout (posições, caixas, arquivados). "geral" é o de sempre (canvas.json) e mostra tudo; os
# outros mostram só as notas com uma tag que começa por um dos prefixos dele (ex.: 🤖fia) e as ideias dessas notas.
# A rota diz qual canvas pelo cabeçalho X-Canvas (main.py põe em `_atual`); as funções daqui usam esse por padrão.
CANVASES = DADOS / "canvases.json"
_atual: contextvars.ContextVar[str] = contextvars.ContextVar("canvas", default="geral")
GERAL = {"slug": "geral", "nome": "Geral", "icone": "🗂️", "tags": []}


CONFIG = DADOS / "canvas-config.json"   # {"geral_oculto": true}: o Geral sai da lista (continua servindo as pastas globais)


def geral_oculto() -> bool:
    try:
        return bool(json.loads(CONFIG.read_text(encoding="utf-8")).get("geral_oculto"))
    except (OSError, ValueError):
        return False


def lista_canvases() -> list[dict]:
    try:
        d = json.loads(CANVASES.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = []
    return [GERAL, *[c for c in d if c.get("slug") != "geral"]]


def canvas_info(slug: str | None = None) -> dict:
    slug = slug or _atual.get()
    return next((c for c in lista_canvases() if c["slug"] == slug), GERAL)


def _arq(slug: str | None = None) -> Path:
    slug = canvas_info(slug)["slug"]
    return ARQ if slug == "geral" else DADOS / f"canvas@{slug}.json"


def salvar_canvas(c: dict) -> dict:
    """Cria (sem slug) ou edita um canvas: nome, ícone e os prefixos de tag que ele mostra."""
    with _trava:
        outros = [x for x in lista_canvases() if x["slug"] != "geral"]
        nome = _limpo(c.get("nome") or "").strip()
        atual = next((x for x in outros if x["slug"] == c.get("slug")), None)
        if atual is None:
            if not nome:
                raise ValueError("dê um nome ao canvas")
            slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()).strip("-") or "canvas"
            if any(x["slug"] == slug for x in lista_canvases()):
                raise FileExistsError(f"canvas {slug}")
            atual = {"slug": slug, "nome": nome, "icone": "🗂️", "tags": [], "criado": datetime.now().isoformat(timespec="seconds")}
            outros.append(atual)
        elif nome:
            atual["nome"] = nome
        if c.get("icone"):
            atual["icone"] = c["icone"].strip()[:4]
        if c.get("tags") is not None:
            atual["tags"] = [t.strip().lstrip("#") for t in c["tags"] if t.strip()]
        DADOS.mkdir(parents=True, exist_ok=True)
        CANVASES.write_text(json.dumps(outros, ensure_ascii=False, indent=1), encoding="utf-8")
        return atual


def _da_tag(tags: list[str], prefixos: list[str]) -> bool:
    return any(t.lstrip("#").startswith(p) for t in tags for p in prefixos)


def marcar_no_canvas(raiz: str, nome: str):
    """Nota criada dentro de um canvas de produto já nasce com a tag dele (o primeiro prefixo, ex.: 🤖fia)."""
    tags = canvas_info()["tags"]
    p = notas._caminho(raiz, nome)
    if not tags or not p or not p.is_file():
        return
    t = _ler(p, None)
    atuais = _lista(_fm(t), "tags")
    if not _da_tag(atuais, tags):
        notas._escrever(p, _definir(t, "tags", atuais + [tags[0]]))


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
    d.setdefault("caixas", [])
    d.setdefault("visiveis", [])   # cards trazidos à mão (⌘↵ na busca): aparecem mesmo publicados e fora de caixa
    return d


def _gravar_layout(d: dict, slug: str | None = None):
    with _trava:
        DADOS.mkdir(parents=True, exist_ok=True)
        arq = _arq(slug)
        if arq.is_file():
            HISTORICO.mkdir(exist_ok=True)
            pref = arq.stem   # canvas-… (geral) ou canvas@fia-… (cada canvas tem o seu histórico)
            shutil.copy2(arq, HISTORICO / f"{pref}-{datetime.now():%Y%m%d-%H%M%S-%f}.json")
            for velho in sorted(HISTORICO.glob(f"{pref}-*.json"))[:-200]:
                velho.unlink(missing_ok=True)
        fd, tmp = tempfile.mkstemp(dir=DADOS, prefix=".canvas-", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(d, ensure_ascii=False, indent=1))
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


def estado() -> dict:
    ideias, entradas, producoes = [], [], []
    for nome, p in notas._arquivos("ideias"):
        t = _ler(p)
        fm = _fm(t)
        m = _midia(t)
        if not m["imagem"] and _valor(fm, "thumb"):
            m["imagem"] = _valor(fm, "thumb")
        ideias.append({"nome": nome, "previa": notas._previa(t), **m, "grupo": _valor(fm, "grupo"), "tags": _lista(fm, "tags"), "fontes": [x for x in map(_alvo, _lista(fm, "fontes")) if x],
                       "mtime": p.stat().st_mtime})
    for nome, p in notas._arquivos("entradas"):
        t = _ler(p)
        fm = _fm(t)
        entradas.append({"nome": nome, "url": _valor(fm, "url") or "", "tipo": _valor(fm, "tipo") or "link",
                         "thumb": _valor(fm, "thumb") or "", "grupo": _valor(fm, "grupo"), "previa": notas._previa(t), "mtime": p.stat().st_mtime})
    for raiz in notas.PASTAS:
        for nome, p in notas._arquivos(raiz):
            inteiro = _ler(p, None)
            t = inteiro[:3000]
            fm = _fm(t)
            sched = notas._scheduled(t)
            st = p.stat()
            corpo = FM.sub("", inteiro, count=1)
            palavras = len(re.findall(r"[\wÀ-ÿ]+", URL.sub("", IMG.sub("", corpo))))
            producoes.append({"nome": nome, "raiz": raiz, "status": notas.status(raiz, nome), "scheduled": sched,
                              "ano": (sched or datetime.fromtimestamp(getattr(st, "st_birthtime", st.st_mtime)).strftime("%Y"))[:4],
                              "formato": _formato(nome), "ideia": _alvo(_valor(fm, "ideia")), "grupo": _valor(fm, "grupo"),
                              "previa": notas._previa(t), "mtime": st.st_mtime, "criado": getattr(st, "st_birthtime", st.st_mtime),
                              "palavras": palavras, "winner": WINNER in _lista(fm, "tags"), "tags": _lista(fm, "tags"), **_midia(t)})
    info = canvas_info()
    if info["tags"]:   # canvas de produto: só as copies com a tag dele e as ideias delas (ou com a tag)
        producoes = [p for p in producoes if _da_tag(p["tags"], info["tags"])]
        ligadas = {p["ideia"] for p in producoes if p["ideia"]}
        ideias = [i for i in ideias if _da_tag(i["tags"], info["tags"]) or i["nome"] in ligadas]
        entradas = []
    lay = _layout()
    return {"canvas": info, "visiveis": lay["visiveis"], "ideias": ideias, "entradas": entradas, "producoes": producoes, "pos": lay["pos"],
            "arquivados": lay["arquivados"], "caixas": lay["caixas"], "formatos": [{"emoji": f, "nome": ROTULO_FORMATO[f]} for f in FORMATOS]}


@_travado
def posicoes(pos: dict[str, dict]):
    d = _layout()
    for k, v in pos.items():
        d["pos"][k] = {"x": round(float(v["x"])), "y": round(float(v["y"]))}
    _gravar_layout(d)


@_travado
def arquivar(id_: str, sim: bool):
    d = _layout()
    d["arquivados"] = [a for a in d["arquivados"] if a != id_] + ([id_] if sim else [])
    _gravar_layout(d)


@_travado
def _renomear_pos(antes: str, depois: str):
    """A nota mudou de nome/pasta: o card fica no mesmo lugar em todos os canvas (e nas vistas `<vista>|<id>`)."""
    for c in lista_canvases():
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


# ---------- caixas: demarcações coloridas no canvas que agrupam assuntos ----------
# A caixa (nome, cor, retângulo, arquivada) fica no layout; quem está dentro dela ganha `grupo: "<nome>"` na nota.

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


def definir_grupos(itens: list[dict]) -> list[dict]:
    """Vários `{notas, grupo}` de uma vez, na ordem (um arraste de vários cards vira um pedido só)."""
    return [m for it in itens for m in definir_grupo(it["notas"], it.get("grupo"))]


def _trocar_grupo(antigo: str, novo: str | None) -> int:
    n = 0
    for _, _, p in _notas_do_canvas():
        t = _ler(p, None)
        if _valor(_fm(t), "grupo") == antigo:
            notas._escrever(p, _definir(t, "grupo", novo))
            n += 1
    return n


@_travado
def salvar_caixa(c: dict) -> dict:
    """Cria ou atualiza uma caixa. Renomear leva o novo nome para a propriedade `grupo` das notas de dentro."""
    d = _layout()
    atual = next((x for x in d["caixas"] if x["id"] == c.get("id")), None)
    if c.get("id") and atual is None:   # pedido para uma caixa que não existe mais: nunca criar uma "Caixa" no lugar
        raise FileNotFoundError(f"caixa {c['id']} (recarregue a página)")
    nome = _limpo(c.get("nome") or "") or (atual["nome"] if atual else "Caixa")   # sem nome no pedido: mantém o atual
    if any(x["nome"] == nome and x is not atual for x in d["caixas"]):
        raise FileExistsError(f"caixa {nome}")
    if atual is None:
        atual = {"id": c.get("id") or f"cx{int(datetime.now().timestamp() * 1000)}", "nome": nome, "cor": "#f6e3b4",
                 "x": 0, "y": 0, "w": 640, "h": 420, "arquivada": False}
        d["caixas"].append(atual)
    elif atual["nome"] != nome:
        _trocar_grupo(atual["nome"], nome)
    atual["nome"] = nome
    for k in ("cor", "arquivada"):
        if c.get(k) is not None:
            atual[k] = c[k]
    for k in ("x", "y", "w", "h"):
        if c.get(k) is not None:
            atual[k] = round(float(c[k]))
    _gravar_layout(d)
    return atual


@_travado
def apagar_caixa(id_: str) -> int:
    """Tira a caixa do canvas; as notas de dentro continuam, só perdem a propriedade `grupo`."""
    d = _layout()
    c = next((x for x in d["caixas"] if x["id"] == id_), None)
    if not c:
        raise FileNotFoundError(id_)
    d["caixas"] = [x for x in d["caixas"] if x["id"] != id_]
    _gravar_layout(d)
    return _trocar_grupo(c["nome"], None)


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
    """ideia | edicao | agendado | publicado. Publicar move para 2 Publicados; despublicar volta para Priorizar.
    A posição do card no canvas vai junto (como no app)."""
    raiz, nome = achar(nome)
    if raiz not in notas.PASTAS:
        raise ValueError("só copies (1 Priorizar ou 2 Publicados) têm status")
    if status not in ("ideia", "edicao", "agendado", "publicado"):
        raise ValueError("status é ideia, edicao, agendado ou publicado")
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
    """O id do card que mostra a nota no canvas principal (a mesma regra do app: produção 🎬 com 2+ saídas ou com nota 💡)."""
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


@_travado
def colocar_na_caixa(nomes: list[str], caixa: str | None) -> dict:
    """Põe as notas numa caixa: grava `grupo` (em todas as saídas do card) e põe o card dentro do retângulo da caixa,
    no próximo lugar livre da grade (a caixa cresce para baixo se precisar). `caixa` vazio tira da caixa."""
    slug = _atual.get()
    if caixa:   # a caixa pode estar em qualquer canvas (o agente não sabe em qual o Rodrigo está)
        onde = next((c["slug"] for c in lista_canvases() if any(x["nome"] == caixa for x in _layout(c["slug"])["caixas"])), None)
        if not onde:
            raise FileNotFoundError(f"caixa {caixa} (caixas: {', '.join(x['nome'] for x in listar_caixas())})")
        slug = onde
    d = _layout(slug)
    cx = next((c for c in d["caixas"] if c["nome"] == caixa), None) if caixa else None
    feitos = []
    for nome in nomes:
        raiz, nome = achar(nome)
        card = _id_do_card(raiz, nome)
        alvos = [{"raiz": raiz, "nome": nome}]
        if card.startswith("g:"):
            alvos = [{"raiz": r, "nome": n} for r in notas.PASTAS for n, p in notas._arquivos(r)
                     if _formato(n) != "📺" and _alvo(_valor(_fm(_ler(p)), "ideia")) == card[2:]]
        definir_grupo(alvos, caixa)
        if cx:
            dentro = [v for k, v in d["pos"].items() if "|" not in k and k != card
                      and cx["x"] <= v["x"] + 135 <= cx["x"] + cx["w"] and cx["y"] <= v["y"] + 60 <= cx["y"] + cx["h"]]
            cols = max(1, (cx["w"] - 80 + 34) // 304)
            i = len(dentro)
            d["pos"][card] = {"x": cx["x"] + 40 + (i % cols) * 304, "y": cx["y"] + 80 + (i // cols) * 260}
            cx["h"] = max(cx["h"], 80 + (i // cols + 1) * 260 + 20)
        feitos.append(card)
    _gravar_layout(d, slug)
    return {"cards": feitos, "caixa": caixa}


def listar_caixas() -> list[dict]:
    """As caixas de todos os canvas (nome, canvas, se está arquivada e quantas notas têm o grupo dela)."""
    conta: dict[str, int] = {}
    for _, _, p in _notas_do_canvas():
        g = _valor(_fm(_ler(p)), "grupo")
        if g:
            conta[g] = conta.get(g, 0) + 1
    return [{"nome": x["nome"], "canvas": c["nome"], "arquivada": x["arquivada"], "notas": conta.get(x["nome"], 0)}
            for c in lista_canvases() for x in _layout(c["slug"])["caixas"]]


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
    """Contagens de cada canvas lendo as notas uma vez só (o recorte por tag é feito na memória)."""
    marca = _atual.set("geral")
    try:
        e = estado()
    finally:
        _atual.reset(marca)
    out = []
    for c in lista_canvases():
        if c["slug"] == "geral" and geral_oculto():
            continue
        prods, ideias = e["producoes"], e["ideias"]
        if c["tags"]:
            prods = [p for p in prods if _da_tag(p["tags"], c["tags"])]
            ligadas = {p["ideia"] for p in prods if p["ideia"]}
            ideias = [i for i in ideias if _da_tag(i["tags"], c["tags"]) or i["nome"] in ligadas]
        out.append({**c, "ideias": len(ideias), "producoes": sum(1 for p in prods if p["formato"] != "📺"),
                    "vsls": sum(1 for p in prods if p["formato"] == "📺"), "publicadas": sum(1 for p in prods if p["status"] == "publicado"),
                    "caixas": len(_layout(c["slug"])["caixas"])})
    return out


def no_canvas(nomes: list[str], slug: str, sim: bool) -> int:
    """Põe (tag do canvas) ou tira (todas as tags dos prefixos dele, inclusive as subtags) as notas de um canvas.
    Um card pode estar em vários canvas: é só ter as tags deles."""
    info = canvas_info(slug)
    if not info["tags"]:
        raise ValueError("esse canvas não é por tag")
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


@_travado
def importar(nome: str) -> dict:
    """⌘↵ na busca: traz a nota para o canvas atual. Ganha a tag dele (se for de produto), sai dos arquivados e fica
    na lista `visiveis` (aparece mesmo publicada e fora de caixa). Devolve o id do card para o app enquadrar."""
    raiz, nome = achar(nome)
    info = canvas_info()
    card = _id_do_card(raiz, nome)
    if info["tags"]:   # todas as notas do card (a produção inteira), senão no canvas ela vira outro card
        irmas = [nome]
        if card.startswith("g:"):
            irmas = [n for r in notas.PASTAS for n, p in notas._arquivos(r)
                     if _formato(n) != "📺" and _alvo(_valor(_fm(_ler(p)), "ideia")) == card[2:]]
        no_canvas(irmas, info["slug"], True)
    d = _layout()
    d["arquivados"] = [a for a in d["arquivados"] if a != card]
    if card not in d["visiveis"]:
        d["visiveis"].append(card)
    _gravar_layout(d)
    return {"card": card, "raiz": raiz, "nome": nome, "canvas": info["nome"]}
