"""Notas do vault abertas no modal: as copies de `1 Copies` e as skills de `3 Skills`.

Status da copy, do jeito que o Rodrigo já marca no Obsidian:
- ideia     → nota solta em 1 Copies/1 Priorizar
- edicao    → nome começa com 🧑🏼‍🔧
- agendado  → nome começa com 🔹
- publicado → está em 1 Copies/2 Publicados com `publicado: true` (publicar move para lá e tira 🔹/🧑🏼‍🔧)

Leitura e escrita pelo editor do app. Só arquivos .md diretamente dentro dessas pastas (ou o SKILL.md de cada
skill); nada de subir de pasta. Apagar não apaga: move para a lixeira do vault (`.trash`, a do Obsidian).
Cada salvamento confere a data de modificação: se o arquivo mudou por fora (Obsidian aberto ao mesmo tempo),
devolve conflito em vez de sobrescrever.
"""
import json
import os
import re
import unicodedata
import tempfile
import time
from datetime import datetime
from pathlib import Path

from .config import VAULT

COPIES = VAULT / "1 Copies"
PASTAS = {
    "priorizar": COPIES / "1 Priorizar",
    "publicados": COPIES / "2 Publicados",
}
PRIORIZAR = PASTAS["priorizar"]
IDEIAS = COPIES / "0 Ideias"
# 💡 ideias e entradas (material bruto) do canvas: abrem no mesmo editor, mas não têm status nem entram na agenda
EXTRAS = {"ideias": IDEIAS, "entradas": IDEIAS / "Entradas"}
TODAS = {**PASTAS, **EXTRAS}
SKILLS = VAULT / "3 Skills"
LIXEIRA = VAULT / ".trash"
TEMPLATE_COPY = VAULT / "2 Notas" / "Engine" / "templates" / "T-Copy.md"
RAIZES = {**{k: str(p.relative_to(VAULT)) for k, p in TODAS.items()}, "skills": "3 Skills"}
NOME_RUIM = re.compile(r"[/\\\x00]|^\.|\.\.")
PINS = VAULT / ".obsidian" / "plugins" / "file-explorer-plus" / "data.json"
PREFIXO = {"gravar": "🔴", "edicao": "🧑🏼‍🔧", "agendado": "🔹"}   # 🔴 gravar: copy pronta, falta gravar
# um ou mais marcadores de status no começo do nome (🔹, 🧑‍🔧 com ou sem tom de pele)
MARCAS = re.compile("^(?:\U0001F539|\U0001F534|\U0001F9D1[\U0001F3FB-\U0001F3FF]?\u200d\U0001F527)+")


class Conflito(Exception):
    pass


def _arquivo_skill(rel: str) -> Path | None:
    """Um .md qualquer dentro de 3 Skills (ex.: `viral-hooks/references/guia.md`), sem sair da pasta nem entrar
    em pastas escondidas."""
    partes = rel.split("/")
    if len(partes) < 2 or not rel.endswith(".md") or any(not x or x.startswith(".") or "\\" in x or "\x00" in x for x in partes):
        return None
    p = (SKILLS / rel).resolve()
    return p if p.is_relative_to(SKILLS.resolve()) else None


def _caminho(raiz: str, nome: str) -> Path | None:
    if raiz == "skills" and "/" in nome:   # arquivo de apoio da skill (references/, exemplos…)
        return _arquivo_skill(nome)
    if NOME_RUIM.search(nome):
        return None
    if raiz in TODAS:
        return TODAS[raiz] / (nome if nome.endswith(".md") else nome + ".md")
    if raiz == "skills":
        return SKILLS / nome / "SKILL.md"
    return None


def _previa(texto: str) -> str:
    corpo = re.sub(r"^---\n.*?\n---\n", "", texto, flags=re.S)
    linhas = [l.strip("#>*- ").strip() for l in corpo.splitlines()]
    return next((l for l in linhas if len(l) > 12), "")[:140]


def _arquivos(raiz: str) -> list[tuple[str, Path]]:
    if raiz in TODAS:
        return [(p.stem, p) for p in TODAS[raiz].glob("*.md")] if TODAS[raiz].is_dir() else []
    if raiz == "skills":
        return [(p.parent.name, p) for p in SKILLS.glob("*/SKILL.md")]
    return []


def status(raiz: str, nome: str) -> str:
    if raiz == "publicados":
        return "publicado"
    if raiz != "priorizar":
        return ""
    m = MARCAS.match(nome)
    if not m:
        return "ideia"
    return "agendado" if "\U0001F539" in m.group(0) else "gravar" if "\U0001F534" in m.group(0) else "edicao"


def indice() -> list[dict]:
    """Só nomes e datas de todas as pastas, para a busca rápida (⌘P). Barato: não abre os arquivos."""
    out = []
    for raiz in [*TODAS, "skills"]:
        for nome, p in _arquivos(raiz):
            try:
                out.append({"nome": nome, "raiz": raiz, "mtime": p.stat().st_mtime, "status": status(raiz, nome)})
            except OSError:
                pass
    return out


def ler(raiz: str, nome: str) -> dict | None:
    p = _caminho(raiz, nome)
    if not p or not p.is_file():
        return None
    return {"nome": nome, "raiz": raiz, "caminho": str(p.relative_to(VAULT)),
            "texto": p.read_text(encoding="utf-8", errors="replace"), "mtime": p.stat().st_mtime}


def _escrever(p: Path, texto: str):
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".jarvis-", suffix=".md")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(texto)
    os.replace(tmp, p)


def salvar(raiz: str, nome: str, texto: str, mtime: float | None) -> dict:
    p = _caminho(raiz, nome)
    if not p or not p.is_file():
        raise FileNotFoundError(nome)
    atual = p.stat().st_mtime
    if mtime is not None and abs(atual - mtime) > 0.001:
        raise Conflito(f"{p.name} mudou fora do app")
    _escrever(p, texto)
    return {"mtime": p.stat().st_mtime}


def _categoria(texto: str) -> str:
    m = re.match(r"^---\n(.*?)\n---", texto, flags=re.S)
    c = re.search(r"^category:\s*(.+)$", m.group(1), flags=re.M) if m else None
    return c.group(1).strip().strip('"\'') if c else "Outras"


def _descricao(texto: str) -> str:
    m = re.match(r"^---\n(.*?)\n---", texto, flags=re.S)
    d = re.search(r"^description:\s*(.+)$", m.group(1), flags=re.M) if m else None
    return d.group(1).strip().strip('"\'') if d else _previa(texto)


def lista_skills() -> list[dict]:
    """As skills de 3 Skills, em ordem alfabética: nome, descrição do frontmatter e os outros .md da pasta."""
    out = []
    for p in sorted(SKILLS.glob("*/SKILL.md"), key=lambda x: x.parent.name.lower()):
        pasta = p.parent
        try:
            texto = p.read_text(encoding="utf-8", errors="replace")
            outros = sorted(str(x.relative_to(SKILLS)) for x in pasta.rglob("*.md")
                            if x != p and not any(y.startswith(".") for y in x.relative_to(pasta).parts))
            out.append({"nome": pasta.name, "descricao": _descricao(texto), "categoria": _categoria(texto),
                        "mtime": p.stat().st_mtime, "arquivos": outros})
        except OSError:
            pass
    return out


def criar_skill(nome: str, descricao: str = "", categoria: str = "Copywriting") -> dict:
    """Pasta nova em 3 Skills com um SKILL.md no formato das outras (frontmatter name/description)."""
    slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()).strip("-")
    if not slug:
        raise ValueError("Dê um nome à skill.")
    pasta = SKILLS / slug
    if pasta.exists():
        raise FileExistsError(slug)
    pasta.mkdir(parents=True)
    desc = descricao.strip() or "Descreva aqui quando usar esta skill."
    _escrever(pasta / "SKILL.md", f"---\nname: {slug}\ndescription: {desc}\ncategory: {categoria.strip() or 'Copywriting'}\n---\n\n# {nome.strip()}\n\n")
    return {"raiz": "skills", "nome": slug}


def criar(titulo: str) -> dict:
    """Nova copy em Priorizar com o frontmatter do template de Copy (publicado: false, scheduled, tags)."""
    titulo = re.sub(r"[/\\:]", "-", titulo).strip() or "Sem título"
    p = PRIORIZAR / f"{titulo}.md"
    if p.exists():
        raise FileExistsError(p.name)
    modelo = "---\npublicado: false\nscheduled:\ntags:\n---\n\n"
    if TEMPLATE_COPY.is_file():
        t = TEMPLATE_COPY.read_text(encoding="utf-8", errors="replace")
        m = re.match(r"^---\n.*?\n---\n", t, flags=re.S)
        if m and "<%" not in m.group(0):
            modelo = m.group(0) + "\n"
    p.write_text(modelo, encoding="utf-8")
    return {"nome": p.stem, "raiz": "priorizar", "mtime": p.stat().st_mtime,
            "criado": datetime.now().isoformat(timespec="seconds")}


SCHED = re.compile(r'(?m)^scheduled:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$')


DATA = re.compile(r"\d{4}-\d{2}-\d{2}")


def _datas(texto: str) -> list[str]:
    """Todas as datas de `scheduled` (uma, ou uma lista quando a copy foi postada mais de uma vez), em ordem."""
    m = re.match(r"^---\n(.*?)\n---\n", texto, flags=re.S)
    if not m:
        return []
    linhas = m.group(1).split("\n")
    for i, l in enumerate(linhas):
        if not re.match(r"^scheduled:", l):
            continue
        resto = l.split(":", 1)[1]
        achadas = DATA.findall(resto)   # `scheduled: 2026-09-10` ou `scheduled: [2026-09-10, 2026-10-02]`
        for x in linhas[i + 1:]:          # lista em blocos: `  - "2026-09-10"`
            if not re.match(r"^\s+-\s", x):
                break
            achadas += DATA.findall(x)
        return sorted(dict.fromkeys(achadas))
    return []


def _scheduled(texto: str) -> str | None:
    """A data que vale para a nota: a próxima a partir de hoje; se todas já passaram, a mais recente."""
    ds = _datas(texto)
    if not ds:
        return None
    hoje = datetime.now().strftime("%Y-%m-%d")
    return next((d for d in ds if d >= hoje), ds[-1])


def agenda() -> list[dict]:
    """Notas de `1 Copies` com `scheduled` preenchido: o calendário editorial. Uma entrada por data (repostagens
    aparecem em cada dia em que foram postadas)."""
    out = []
    for raiz in PASTAS:
        for nome, p in _arquivos(raiz):
            try:
                texto = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            ds = _datas(texto)
            for data in ds:
                out.append({"nome": nome, "raiz": raiz, "scheduled": data, "datas": ds, "status": status(raiz, nome)})
    return out


def _definir_scheduled(texto: str, datas: str | list[str]) -> str:
    """Grava `scheduled`: uma data numa linha só; várias, como lista YAML (uma por linha)."""
    ds = [datas] if isinstance(datas, str) else sorted(dict.fromkeys(datas))
    linha = f'scheduled: "{ds[0]}"' if len(ds) == 1 else "scheduled:\n" + "\n".join(f'  - "{d}"' for d in ds)
    m = re.match(r"^---\n(.*?)\n---\n", texto, flags=re.S)
    if not m:
        return f"---\n{linha}\n---\n\n" + texto
    fm = m.group(1)
    # troca o `scheduled:` que já existir (com a lista dele, se for lista), mesmo vazio (toda copy nasce com `scheduled:`)
    qualquer = re.compile(r"(?m)^scheduled:.*(?:\n[ \t]+-[^\n]*)*")
    fm = qualquer.sub(lambda _: linha, fm, count=1) if qualquer.search(fm) else (f"{fm}\n{linha}" if fm.strip() else linha)
    return f"---\n{fm}\n---\n" + texto[m.end():]


def mudar_agenda(raiz: str, nome: str, data: str | None = None, de: str | None = None, datas: list[str] | None = None) -> dict:
    """Muda `scheduled` pelo app. `datas`: troca a lista inteira (propriedade da nota). `data` + `de`: arrastar uma
    das datas no calendário (as outras ficam). Só `data`: a nota passa a ter essa data."""
    if raiz not in PASTAS:
        raise ValueError("raiz inválida")
    novas = datas if datas is not None else [data] if data else []
    if not novas or any(not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) for d in novas):
        raise ValueError("data inválida (use AAAA-MM-DD)")
    p = _caminho(raiz, nome)
    if not p or not p.is_file():
        raise FileNotFoundError(nome)
    texto = p.read_text(encoding="utf-8", errors="replace")
    if datas is None and de:
        atuais = _datas(texto)
        if de in atuais:
            novas = [data if d == de else d for d in atuais]
    _escrever(p, _definir_scheduled(texto, novas))
    return {"mtime": p.stat().st_mtime}


def _marcar_publicado(texto: str, valor: bool) -> str:
    v = "true" if valor else "false"
    m = re.match(r"^---\n(.*?)\n---\n", texto, flags=re.S)
    if not m:
        return f"---\npublicado: {v}\nscheduled:\ntags:\n---\n\n" + texto
    fm = m.group(1)
    fm = re.sub(r"(?m)^publicado:.*$", f"publicado: {v}", fm) if re.search(r"(?m)^publicado:", fm) else f"publicado: {v}\n" + fm
    return f"---\n{fm}\n---\n" + texto[m.end():]


def mover(raiz: str, nome: str, destino: str) -> dict:
    """Muda de pasta. Publicar marca `publicado: true` e tira 🔹/🧑🏼‍🔧 do nome; tirar de Publicados volta a false."""
    if raiz not in PASTAS or destino not in PASTAS or raiz == destino:
        raise ValueError("movimento inválido")
    p = _caminho(raiz, nome)
    if not p or not p.is_file():
        raise FileNotFoundError(nome)
    PASTAS[destino].mkdir(exist_ok=True)
    novo = MARCAS.sub("", nome).lstrip() or nome if destino == "publicados" else nome
    alvo = PASTAS[destino] / f"{novo}.md"
    if alvo.exists():
        raise FileExistsError(alvo.name)
    if destino == "publicados" or raiz == "publicados":
        texto = p.read_text(encoding="utf-8", errors="replace")
        _escrever(p, _marcar_publicado(texto, destino == "publicados"))
    os.rename(p, alvo)
    _trocar_fixada(f"{raiz}/{nome}", f"{destino}/{novo}")
    return {"nome": novo, "raiz": destino, "mtime": alvo.stat().st_mtime}


def mudar_status(raiz: str, nome: str, novo_status: str) -> dict:
    """ideia / gravar / edicao / agendado: troca só o marcador no começo do nome (a nota fica em Priorizar)."""
    if raiz != "priorizar" or novo_status not in ("ideia", "gravar", "edicao", "agendado"):
        raise ValueError("status inválido")
    base = MARCAS.sub("", nome)
    return renomear(raiz, nome, PREFIXO.get(novo_status, "") + base)


def renomear(raiz: str, nome: str, novo: str) -> dict:
    novo = re.sub(r"[/\\:]", "-", novo).strip().removesuffix(".md")
    if raiz not in TODAS or not novo or NOME_RUIM.search(novo):
        raise ValueError("nome inválido")
    p = _caminho(raiz, nome)
    if not p or not p.is_file():
        raise FileNotFoundError(nome)
    alvo = p.with_name(novo + ".md")
    if alvo.exists():
        raise FileExistsError(alvo.name)
    os.rename(p, alvo)
    _trocar_fixada(f"{raiz}/{nome}", f"{raiz}/{novo}")
    if raiz in EXTRAS:
        trocar_links(nome, novo)
    return {"nome": novo, "raiz": raiz, "mtime": alvo.stat().st_mtime}


def trocar_links(antes: str, depois: str):
    """Renomeou uma 💡 ou entrada: acompanha os [[links]] em `1 Copies` (o Obsidian faria o mesmo)."""
    padrao = re.compile(r"\[\[" + re.escape(antes) + r"(?=[\]|#])")
    for p in COPIES.rglob("*.md"):
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if f"[[{antes}" in t:
            novo_t = padrao.sub("[[" + depois, t)
            if novo_t != t:
                _escrever(p, novo_t)


def para_lixeira(raiz: str, nome: str) -> dict:
    """Não apaga: move para `.trash` do vault (dá para recuperar pelo Obsidian ou pelo Finder)."""
    if raiz not in TODAS:
        raise ValueError("só copies, ideias e entradas vão para a lixeira")
    p = _caminho(raiz, nome)
    if not p or not p.is_file():
        raise FileNotFoundError(nome)
    LIXEIRA.mkdir(exist_ok=True)
    alvo = LIXEIRA / p.name
    if alvo.exists():
        alvo = LIXEIRA / f"{p.stem} {int(time.time())}.md"
    os.rename(p, alvo)
    _trocar_fixada(f"{raiz}/{nome}", None)
    return {"lixeira": str(alvo.relative_to(VAULT))}


# --- pins do File Explorer++ no Obsidian: renomear, mover ou apagar uma nota acompanha o pin dela ---

def _rel(raiz: str, nome: str) -> str | None:
    p = _caminho(raiz, nome)
    return str(p.relative_to(VAULT)) if p else None


def _de_rel(rel: str) -> str | None:
    for raiz, pasta in PASTAS.items():
        r = str(pasta.relative_to(VAULT)) + "/"
        if rel.startswith(r) and rel.endswith(".md") and "/" not in rel[len(r):]:
            return f"{raiz}/{rel[len(r):-3]}"
    m = re.fullmatch(r"3 Skills/([^/]+)/SKILL\.md", rel)
    return f"skills/{m.group(1)}" if m else None


def _pins() -> dict:
    try:
        return json.loads(PINS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _gravar_pins(d: dict):
    fd, tmp = tempfile.mkstemp(dir=PINS.parent, prefix=".jarvis-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.replace(tmp, PINS)


def _caminhos_fixados(d: dict) -> list[dict]:
    return (d.get("pinFilters") or {}).get("paths") or []


def _trocar_fixada(antes: str, depois: str | None):
    """Renomeou, moveu ou mandou para a lixeira: acompanha o pin no Obsidian."""
    r_antes = _rel(*antes.split("/", 1))
    d = _pins()
    lista = _caminhos_fixados(d)
    if not r_antes or not any(f.get("pattern") == r_antes for f in lista):
        return
    if depois is None:
        d["pinFilters"]["paths"] = [f for f in lista if f.get("pattern") != r_antes]
    else:
        r_depois = _rel(*depois.split("/", 1))
        for f in lista:
            if f.get("pattern") == r_antes:
                f["pattern"] = r_depois
    _gravar_pins(d)
