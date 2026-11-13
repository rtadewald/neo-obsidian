"""O canvas do Neo-Obsidian: ideias (💡), entradas (material bruto) e produções (as copies de sempre).

- 💡 ideia      → `1 Copies/0 Ideias/💡 Nome.md`, sem status. Lista as entradas em `fontes:`.
- entrada       → `1 Copies/0 Ideias/Entradas/<emoji> Título.md` (▶️ YouTube, 📸 Instagram, 🔗 link, 💭 texto),
                  com `url`, `tipo` e `thumb` no frontmatter e o material (transcrição, texto da página) no corpo.
- produção      → as copies de `1 Priorizar` e `2 Publicados`, que seguem o fluxo de status por nome/pasta.
                  Pertence a uma ideia quando tem `ideia: "[[💡 Nome]]"` no frontmatter; nota sem ideia é normal.

Posição dos cards e cards arquivados (escondidos do canvas) ficam em `app/dados/canvas.json`, fora do vault.
"""
import json
import re
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
    return "---\n" + "\n".join(linhas) + "\n---\n" + (corpo if corpo.startswith("\n") or not corpo else "\n" + corpo)


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

def _layout() -> dict:
    try:
        d = json.loads(ARQ.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = {}
    d.setdefault("pos", {})
    d.setdefault("arquivados", [])
    return d


def _gravar_layout(d: dict):
    DADOS.mkdir(parents=True, exist_ok=True)
    tmp = ARQ.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(ARQ)


def estado() -> dict:
    ideias, entradas, producoes = [], [], []
    for nome, p in notas._arquivos("ideias"):
        t = _ler(p)
        fm = _fm(t)
        ideias.append({"nome": nome, "previa": notas._previa(t), "fontes": [x for x in map(_alvo, _lista(fm, "fontes")) if x],
                       "mtime": p.stat().st_mtime})
    for nome, p in notas._arquivos("entradas"):
        t = _ler(p)
        fm = _fm(t)
        entradas.append({"nome": nome, "url": _valor(fm, "url") or "", "tipo": _valor(fm, "tipo") or "link",
                         "thumb": _valor(fm, "thumb") or "", "previa": notas._previa(t), "mtime": p.stat().st_mtime})
    for raiz in notas.PASTAS:
        for nome, p in notas._arquivos(raiz):
            t = _ler(p, 3000)
            fm = _fm(t)
            sched = notas._scheduled(t)
            st = p.stat()
            producoes.append({"nome": nome, "raiz": raiz, "status": notas.status(raiz, nome), "scheduled": sched,
                              "ano": (sched or datetime.fromtimestamp(getattr(st, "st_birthtime", st.st_mtime)).strftime("%Y"))[:4],
                              "formato": _formato(nome), "ideia": _alvo(_valor(fm, "ideia")),
                              "previa": notas._previa(t), "mtime": st.st_mtime})
    lay = _layout()
    return {"ideias": ideias, "entradas": entradas, "producoes": producoes, "pos": lay["pos"],
            "arquivados": lay["arquivados"], "formatos": [{"emoji": f, "nome": ROTULO_FORMATO[f]} for f in FORMATOS]}


def posicoes(pos: dict[str, dict]):
    d = _layout()
    for k, v in pos.items():
        d["pos"][k] = {"x": round(float(v["x"])), "y": round(float(v["y"]))}
    _gravar_layout(d)


def arquivar(id_: str, sim: bool):
    d = _layout()
    d["arquivados"] = [a for a in d["arquivados"] if a != id_] + ([id_] if sim else [])
    _gravar_layout(d)


def _renomear_pos(antes: str, depois: str):
    d = _layout()
    if antes in d["pos"]:
        d["pos"][depois] = d["pos"].pop(antes)
        _gravar_layout(d)


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


def criar_entrada(conteudo: str, ideia: str | None = None, pos: dict | None = None) -> dict:
    """Link ou texto colado no canvas vira uma nota de entrada já com o material dentro."""
    conteudo = conteudo.strip()
    if not conteudo:
        raise ValueError("entrada vazia")
    url = conteudo if re.fullmatch(r"https?://\S+", conteudo) else ""
    fm = {"url": url, "tipo": "texto", "thumb": ""}
    corpo, titulo, emoji = conteudo, conteudo.split("\n")[0][:70], "💭"
    if url and youtube.id_do_link(url):
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
    titulo = _limpo(re.sub(r"\s+", " ", titulo))[:80] or "Entrada"
    pasta = notas.EXTRAS["entradas"]
    pasta.mkdir(parents=True, exist_ok=True)
    p = _livre(pasta, f"{emoji} {titulo}")
    cab = "---\n" + "".join(f'{k}: "{v}"\n' for k, v in fm.items() if v or k in ("url", "tipo")) + "tags:\n---\n\n"
    notas._escrever(p, cab + corpo.strip() + "\n")
    if pos:
        posicoes({f"e:{p.stem}": pos})
    if ideia:
        ligar_fonte(ideia, p.stem, True)
    return {"nome": p.stem, "raiz": "entradas"}


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
    if ideia:
        _caminho_ideia(ideia)
    p = notas._caminho(raiz, nome)
    if not p or not p.is_file():
        raise FileNotFoundError(nome)
    t = _ler(p, None)
    notas._escrever(p, _definir(t, "ideia", f"[[{ideia}]]" if ideia else None))


def agrupar(titulo: str, producoes: list[dict], pos: dict | None = None) -> dict:
    i = criar_ideia(titulo, pos=pos)
    for pr in producoes:
        ligar_producao(pr["raiz"], pr["nome"], i["nome"])
    return i


def criar_saida(ideia: str, formato: str, titulo: str = "", texto: str = "") -> dict:
    """Nova produção em Priorizar ligada à ideia: `<formato> <nome da ideia>` (ou o título dado)."""
    _caminho_ideia(ideia)
    if formato not in FORMATOS:
        raise ValueError(f"formato inválido (use um de {' '.join(FORMATOS)})")
    nome = _limpo(titulo) if titulo.strip() else f"{formato} {_base(ideia)}"
    if not nome.startswith(formato):
        nome = f"{formato} {nome}"
    p = _livre(notas.PRIORIZAR, nome)
    cab = f'---\npublicado: false\nscheduled:\nideia: "[[{ideia}]]"\ntags:\n---\n\n'
    notas._escrever(p, cab + (texto.strip() + "\n" if texto.strip() else ""))
    return {"nome": p.stem, "raiz": "priorizar"}


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
