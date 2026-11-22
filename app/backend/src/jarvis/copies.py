"""As copies do vault para a Redação do Neo-Obsidian: listar (com status, categoria, mídia), criar, mudar status,
tags, winner e categoria, e a cor/ordem das categorias e das copies na Criação (`dados/criacao.json`).

- copy → as notas de `1 Copies/1 Priorizar` e `2 Publicados`; o status vem do nome/pasta (ver notas.py).
- `categoria:` no frontmatter agrupa a Criação. Arquivar é o status `arquivado` (21/11/2026; saiu o `arquivado: true`).
- O Canvas (mapa mental, canvas, layout, desenho, `grupo:`) saiu em 19/11/2026.
"""
import functools
import json
import re
import threading
from datetime import date, datetime
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

from . import notas, youtube
from .config import DADOS

FM = re.compile(r"^---\n(.*?)\n---\n?", re.S)
LINK = re.compile(r"\[\[([^\]|#]+)")
# orgânico: 📱 dica/hack · 💻 projeto autoral · 🗣️ opinião/dúvida · 🏞️ carrossel · 🎥 YouTube; pago: 💰 ad VSL · 📜 ad LP · 🎣 ad isca
FORMATOS = ["📱", "💻", "🗣️", "🏞️", "🎥", "💰", "📜", "🎣", "📺", "📝", "🎙️"]
ROTULO_FORMATO = {"📱": "Dica/Hack", "💻": "Projeto autoral", "🗣️": "Opinião / Dúvida", "🏞️": "Carrossel", "🎥": "YouTube",
                  "💰": "Ad VSL", "📜": "Ad LP", "🎣": "Ad Isca", "📺": "VSL", "📝": "Feed", "🎙️": "Live"}
# emojis de formato que já existem no vault (para reconhecer o formato de notas antigas)
MARCAS_FORMATO = FORMATOS + ["📩", "📚", "🧑🏼‍🏫", "✅", "🔥", "📦"]
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


# ---------- leitura ----------

_trava = threading.RLock()   # as rotas rodam em paralelo: quem grava o criacao.json passa pela trava


def _travado(f):
    @functools.wraps(f)
    def g(*a, **k):
        with _trava:
            return f(*a, **k)
    return g


def _json(arq: Path, padrao):
    try:
        return json.loads(arq.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return padrao


URL = re.compile(r"https?://[^\s)\]>\"']+")
IMG = re.compile(r"!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\((https?://[^)\s]+)\)")
EXT_IMG = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif")
EXT_VIDEO = (".mp4", ".mov", ".webm", ".m4v")


def _midia(texto: str) -> dict:
    """Links, primeira imagem e se a nota já tem copy (texto além de links, imagens e títulos)."""
    corpo = FM.sub("", texto, count=1)
    img = None
    for m in IMG.finditer(corpo):
        alvo = m.group(2) or f"/api/anexo/{m.group(1).strip()}"
        if m.group(2) or m.group(1).lower().endswith(EXT_IMG):
            img = alvo
            break
    video = None   # vídeo colado na nota (`![[gravação.mp4]]` ou `![](…mp4)`)
    for m in IMG.finditer(corpo):
        alvo = m.group(2) or m.group(1).strip()
        if alvo.lower().split("?")[0].endswith(EXT_VIDEO):
            video = m.group(2) or f"/api/anexo/{alvo}"
            break
    links = list(dict.fromkeys(u.rstrip(".,;") for u in URL.findall(IMG.sub("", corpo))))[:6]
    resto = re.sub(r"^#.*$", "", IMG.sub("", URL.sub("", corpo)), flags=re.M)
    copia = len(re.sub(r"[\s\-*>#=_|`]+", " ", resto).strip()) >= 80
    return {"links": links, "imagem": img, "video": video, "copia": copia}


# uma linha por arquivo, guardada pelo (mtime, tamanho) e pelo dia (a data que vale do `scheduled` depende de hoje):
# a Redação relê /api/copies a cada mudança, e só as notas que mudaram são lidas de novo
_LINHAS: dict[Path, tuple[tuple, dict]] = {}


def _linha(raiz: str, nome: str, p: Path) -> dict:
    st = p.stat()
    chave = (raiz, st.st_mtime_ns, st.st_size, date.today())
    c = _LINHAS.get(p)
    if c and c[0] == chave:
        return c[1]
    inteiro = _ler(p, None)
    t = inteiro[:3000]
    fm = _fm(t)
    sched = notas._scheduled(t)
    criado = getattr(st, "st_birthtime", st.st_mtime)
    corpo = FM.sub("", inteiro, count=1)
    tags = _lista(fm, "tags")
    midia = _midia(t)
    if not midia["imagem"] and _valor(fm, "thumb"):
        midia["imagem"] = _valor(fm, "thumb")
    linha = {"nome": nome, "raiz": raiz, "status": notas.status(raiz, nome, t), "scheduled": sched, "datas": notas._datas(t),
             "ano": (sched or datetime.fromtimestamp(criado).strftime("%Y"))[:4],
             "formato": _formato(nome), "origem": _alvo(_valor(fm, "origem")),
             "previa": notas._previa(t), "mtime": st.st_mtime, "criado": criado,
             "palavras": len(re.findall(r"[\wÀ-ÿ]+", URL.sub("", IMG.sub("", corpo)))),
             "winner": WINNER in tags, "tags": tags,
             "categoria": _valor(fm, "categoria") or None, **midia}
    _LINHAS[p] = (chave, linha)
    return linha


def _todas() -> dict:
    """Todas as copies (1 Priorizar e 2 Publicados), uma linha por nota."""
    vivas, producoes = set(), []
    for raiz in notas.PASTAS:
        for nome, p in notas._arquivos(raiz):
            try:
                producoes.append(_linha(raiz, nome, p))
                vivas.add(p)
            except OSError:
                pass
    for p in [q for q in _LINHAS if q not in vivas]:   # renomeadas, movidas, apagadas
        del _LINHAS[p]
    return {"producoes": producoes}


# ---------- copies novas: criadas (⌘K, radar) ou com uma ideia plugada, até o Rodrigo abrir a nota uma vez ----------

NOVAS = DADOS / "novas.json"
_trava_novas = threading.Lock()


def novas() -> list[str]:
    return _json(NOVAS, [])


def marcar_nova(nome: str, sim: bool = True):
    with _trava_novas:
        l = [n for n in novas() if n != nome] + ([nome] if sim else [])
        DADOS.mkdir(parents=True, exist_ok=True)
        NOVAS.write_text(json.dumps(l, ensure_ascii=False), encoding="utf-8")


def estado() -> dict:
    """Todas as copies do vault e os formatos: o que a Redação lista."""
    t, n = _todas(), set(novas())
    if n:
        t["producoes"] = [p | {"nova": True} if p["nome"] in n else p for p in t["producoes"]]
    return {**t, "formatos": [{"emoji": f, "nome": ROTULO_FORMATO[f]} for f in FORMATOS]}


# ---------- Criação (Redação): cor e ordem das categorias e das copies; arquivar ----------
# Dois níveis (22/11/2026): os grupos (`—<id>|<nome>` na lista) são o principal e as categorias abaixo deles, o
# secundário. A nota guarda só o nome do secundário (`categoria: "Dicas & Hacks"`); o ícone fica em `icones`: o do
# grupo vale para os filhos, e o filho pode ter o seu. `arquivadas` guarda categorias e ids de grupo (`—<id>`).
# `tipos`: "funil" (pago) para grupos e categorias soltas; o resto é quadro (orgânico). A categoria num grupo segue o grupo.

CRIACAO = DADOS / "criacao.json"


def criacao() -> dict:
    d = _json(CRIACAO, {})
    return {"cores": d.get("cores", {}), "icones": d.get("icones", {}), "tipos": d.get("tipos", {}), "categorias": d.get("categorias", []), "ordem": d.get("ordem", {}),
            "arquivadas": d.get("arquivadas", [])}


@_travado
def salvar_criacao(mudanca: dict) -> dict:
    d = criacao()
    for k in ("cores", "icones", "tipos", "ordem"):
        if isinstance(mudanca.get(k), dict):
            d[k] = {**d[k], **mudanca[k]}
            d[k] = {c: v for c, v in d[k].items() if v not in (None, "", [])}
    for k in ("categorias", "arquivadas"):   # arquivadas: categorias fora do menu e da Criação (as copies ficam como estão)
        if isinstance(mudanca.get(k), list):
            d[k] = list(dict.fromkeys(str(x) for x in mudanca[k]))
    DADOS.mkdir(parents=True, exist_ok=True)
    CRIACAO.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    return d


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


def _nova_copy(titulo: str, corpo: str, categoria: str | None = None, extras: dict | None = None) -> Path:
    """Copy nova em Priorizar com o frontmatter do T-Copy, a `categoria:` (a caixa do mapa) e o que vier em `extras`
    (url, tipo, thumb do material). Não há mais 💡 ideia à parte: tudo nasce copy, numa categoria."""
    p = _livre(notas.PRIORIZAR, _limpo(titulo) or "Nova copy")
    cab = ["status: ideia", "scheduled:", "notion:", "tags:", f'categoria: "{categoria}"' if categoria else "categoria:"]
    cab += [f'{k}: "{v}"' for k, v in (extras or {}).items() if v]
    notas._escrever(p, "---\n" + "\n".join(cab) + "\n---\n\n" + (corpo.strip() + "\n" if corpo.strip() else ""))
    marcar_nova(p.stem)
    return p


def criar_ideia(titulo: str, brief: str = "", fontes: list[str] | None = None, pos: dict | None = None, categoria: str | None = None) -> dict:
    """(Nome antigo.) Cria uma copy em Priorizar, na categoria dada."""
    titulo = _limpo(re.sub(r"^💡\s*", "", titulo)) or "Nova copy"
    links = "\n".join(f"[[{f}]]" for f in (fontes or []))
    p = _nova_copy(titulo, "\n\n".join(x for x in [brief.strip(), links] if x), categoria)
    return {"nome": p.stem, "raiz": "priorizar"}


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


def criar_entrada(conteudo: str, ideia: str | None = None, pos: dict | None = None, pronto: dict | None = None, categoria: str | None = None) -> dict:
    """Link ou texto colado no canvas vira uma 💡 ideia já com o material dentro.
    Com `ideia`, o link/texto entra no fim daquela ideia em vez de virar outra.
    Com `pronto` ({titulo, url, thumb}), a ideia vem de um card do radar: usa o que o card já tem, sem ler a página."""
    conteudo = conteudo.strip()
    if not conteudo:
        raise ValueError("ideia vazia")
    if ideia:   # plugar numa copy que já existe: vira uma entrada na seção "## Entradas" da nota
        p = _caminho_ideia(ideia)
        notas._escrever(p, _com_entrada(_ler(p, None), conteudo, (pronto or {}).get("titulo") or ""))
        marcar_nova(p.stem)
        return {"nome": p.stem, "raiz": achar(p.stem)[0]}
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
    titulo = _limpo(re.sub(r"\s+", " ", titulo))[:80] or "Nova copy"
    p = _nova_copy(titulo, corpo, categoria, fm)
    return {"nome": p.stem, "raiz": "priorizar"}


def _com_entrada(texto: str, conteudo: str, titulo: str = "", data: bool = True) -> str:
    """Põe a entrada (data, título e o material) no fim da seção "## Entradas" da ideia; cria a seção no fim se não houver."""
    from datetime import date
    cab = " · ".join(x for x in [date.today().strftime('%d/%m/%Y') if data else "", titulo.strip()] if x) or date.today().strftime('%d/%m/%Y')
    bloco = f"### {cab}" + (f"\n\n{conteudo.strip()}" if conteudo.strip() else "") + "\n"
    m = re.search(r"^## Entradas[ \t]*$", texto, re.M)
    if not m:
        return texto.rstrip() + f"\n\n## Entradas\n\n{bloco}"
    prox = re.search(r"^## ", texto[m.end():], re.M)   # a próxima seção do mesmo nível fecha a de Entradas
    fim = m.end() + prox.start() if prox else len(texto)
    return texto[:fim].rstrip() + f"\n\n{bloco}" + ("\n" + texto[fim:] if prox else "")


def _caminho_ideia(ideia: str) -> Path:
    raiz, nome = achar(ideia)
    return notas.TODAS[raiz] / f"{nome}.md"


def renomeou(raiz: str, antes: str, raiz_depois: str, depois: str):
    """Renomeou, mudou status ou publicou: a ordem da Criação segue o nome novo."""
    if antes != depois and antes in novas():
        marcar_nova(antes, False)
        marcar_nova(depois)
    velho, novo = f"{raiz}/{antes}", f"{raiz_depois}/{depois}"
    d = criacao()
    if any(velho in v for v in d["ordem"].values()):
        salvar_criacao({"ordem": {c: [novo if x == velho else x for x in v] for c, v in d["ordem"].items()}})


# ---------- mídia dos cards ----------

ANEXOS = notas.VAULT / "2 Notas" / "Engine" / "attachments"


def anexo(nome: str) -> Path | None:
    """Imagem colada numa nota (`![[Pasted image ….png]]`): fica em attachments, ou em outro canto do vault."""
    nome = Path(nome).name
    p = ANEXOS / nome
    if p.is_file():
        return p
    return next((q for q in notas.VAULT.rglob(nome) if ".trash" not in q.parts and ".obsidian" not in q.parts), None)


# ---------- frontmatter em lote ----------


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


# ---------- as mesmas ações do app, pelo nome da nota (as rotas e o Claude Code usam) ----------

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
    """ideia | gravar | edicao | agendado (1 Priorizar) · publicado | ativo | inativo | arquivado (2 Publicados): a pasta
    acompanha o status e a propriedade `status:` fica gravada.
    A posição do card no canvas vai junto (como no app)."""
    raiz, nome = achar(nome)
    if raiz not in notas.PASTAS:
        raise ValueError("só copies (1 Priorizar ou 2 Publicados) têm status")
    if status not in notas.STATUS_VAULT:
        raise ValueError("status é ideia, gravar, edicao, agendado, publicado, ativo, inativo ou arquivado")
    antes = (raiz, nome)
    if status in notas.FIM:
        d = notas.mover(raiz, nome, "publicados") if raiz != "publicados" else {"raiz": raiz, "nome": nome}
        if status != notas.status(d["raiz"], d["nome"]):
            d = notas.mudar_status(d["raiz"], d["nome"], status)
    else:
        d = notas.mover(raiz, nome, "priorizar") if raiz == "publicados" else {"raiz": raiz, "nome": nome}
        if status != notas.status(d["raiz"], d["nome"]):
            d = notas.mudar_status(d["raiz"], d["nome"], status)
    if (d["raiz"], d["nome"]) != antes:
        renomeou(antes[0], antes[1], d["raiz"], d["nome"])
    return {"raiz": d["raiz"], "nome": d["nome"]}


def definir_tags(nome: str, tags: list[str]) -> list[str]:
    """Troca as tags da nota (coluna Tags da tabela). Devolve as de antes, para o ⌘Z do app."""
    raiz, nome = achar(nome)
    p = notas._caminho(raiz, nome)
    t = _ler(p, None)
    antes = _lista(_fm(t), "tags")
    novas = list(dict.fromkeys(x.strip().lstrip("#") for x in tags if x.strip().lstrip("#")))
    if novas != antes:
        notas._escrever(p, _definir(t, "tags", novas))
    return antes


def definir_categoria(nomes: list[str], categoria: str | None) -> int:
    """Põe as copies numa categoria (a caixa do mapa mental): `categoria:` no frontmatter. Vazio tira (Sem categoria)."""
    cat = (categoria or "").strip()
    cat = None if not cat or cat == "Sem categoria" else cat
    n = 0
    for nome in nomes:
        raiz, nome = achar(nome)
        p = notas.TODAS[raiz] / f"{nome}.md"
        t = _ler(p, None)
        if _valor(_fm(t), "categoria") == cat:
            continue
        notas._escrever(p, _definir(t, "categoria", cat))
        n += 1
    return n


@_travado
def renomear_categoria(de: str, para: str) -> int:
    """Renomeia uma categoria: o `categoria:` de cada copy com esse nome, e a cor e a ordem dela na Criação."""
    de, para = de.strip(), para.strip()
    if not para or para == de:
        return 0
    n = 0
    for pr in _todas()["producoes"]:
        if pr.get("categoria") == de:
            p = notas.TODAS[pr["raiz"]] / f"{pr['nome']}.md"
            notas._escrever(p, _definir(_ler(p, None), "categoria", para))
            n += 1
    d = criacao()
    salvar_criacao({"cores": {para: d["cores"].get(de), de: None}, "ordem": {para: d["ordem"].get(de), de: None},
                    "icones": {para: d["icones"].get(de), de: None}, "tipos": {para: d["tipos"].get(de), de: None},
                    "categorias": [para if c == de else c for c in d["categorias"]],
                    "arquivadas": [para if c == de else c for c in d["arquivadas"]]})
    return n

