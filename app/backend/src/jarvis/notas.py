"""Notas do vault abertas no modal: as copies de `1 Copies` e as skills de `3 Skills`.

Status da copy, do jeito que o Rodrigo já marca no Obsidian:
- ideia     → nota solta em 1 Copies/1 Priorizar
- edicao    → nome começa com 🧑🏼‍🔧
- agendado  → nome começa com 🔹
- publicado → está em 1 Copies/2 Publicados com `status: publicado` (desde 19/11/2026 não existe mais `publicado:`)

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


# O status da copy é a propriedade `status:` da nota (desde 19/11/2026; antes eram 🔴/🧑🏼‍🔧/🔹 no começo do nome).
# Valores no vault: ideia, gravar, edicao, agendado, publicado (19/11/2026: "priorizar" virou "ideia"; o antigo ainda é lido).
STATUS_VAULT = {"ideia": "ideia", "gravar": "gravar", "edicao": "edicao", "agendado": "agendado", "publicado": "publicado"}
DO_VAULT = {**{v: k for k, v in STATUS_VAULT.items()}, "priorizar": "ideia"}
_STATUS_RE = re.compile(r"\A---\n(?:.*\n)*?status:[ \t]*\"?([\w-]*)\"?[ \t]*\n(?:.*\n)*?---", re.M)


def status(raiz: str, nome: str, texto: str | None = None) -> str:
    """O status da copy: `publicado` em 2 Publicados; em Priorizar, a propriedade `status:` (vazia = ideia)."""
    if raiz == "publicados":
        return "publicado"
    if raiz != "priorizar":
        return ""
    if texto is None:
        p = _caminho(raiz, nome)
        try:
            texto = p.read_text(encoding="utf-8", errors="replace")[:3000] if p else ""
        except OSError:
            texto = ""
    m = _STATUS_RE.match(texto or "")
    st = DO_VAULT.get((m.group(1) if m else "").lower(), "ideia")
    return "ideia" if st == "publicado" else st


# corpo das notas (sem o frontmatter) em memória, pelo mtime: a busca do ⌘O lê daqui (e o começo, para o status)
_CORPOS: dict[Path, tuple[float, str, str, str]] = {}


def _sem_acento(t: str) -> str:
    """Minúsculas sem acento, um caractere por caractere (mesmo comprimento: as posições batem com o original)."""
    return "".join((unicodedata.normalize("NFD", c)[0] if c.strip() else " ").lower() for c in t)


def _lido(p: Path) -> tuple[float, str, str, str]:
    """(mtime, corpo corrido, corpo sem acento, os primeiros 3000 caracteres do arquivo), relido só quando muda."""
    mt = p.stat().st_mtime
    c = _CORPOS.get(p)
    if not c or c[0] != mt:
        texto = p.read_text(encoding="utf-8", errors="replace")
        corpo = re.sub(r"\A---\n.*?\n---\n?", "", texto, flags=re.S)
        corpo = re.sub(r"\s+", " ", corpo).strip()
        c = _CORPOS[p] = (mt, corpo, _sem_acento(corpo), texto[:3000])
    return c


def _corpo(p: Path) -> tuple[str, str]:
    c = _lido(p)
    return c[1], c[2]


def _limpar_md(t: str) -> str:
    """Texto corrido para a prévia: sem negrito, títulos, links markdown/wiki e embeds."""
    t = re.sub(r"!\[\[[^\]]*\]\]", "", t)
    t = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"[*_`#>]+", "", t)
    return re.sub(r"\s+", " ", t).strip()


def indice() -> list[dict]:
    """Nomes, datas e uma prévia do começo de cada nota, para a busca rápida (⌘O)."""
    out = []
    for raiz in [*TODAS, "skills"]:
        for nome, p in _arquivos(raiz):
            try:
                mt, corpo, _, cabeca = _lido(p)
                out.append({"nome": nome, "raiz": raiz, "mtime": mt, "status": status(raiz, nome, cabeca) if raiz in PASTAS else "",
                            "previa": _limpar_md(corpo[:600])[:160]})
            except OSError:
                pass
    return out


def buscar_conteudo(q: str, limite: int = 40) -> list[dict]:
    """Notas cujo texto tem todas as palavras da busca (sem acento, sem caixa). Volta o trecho em volta da 1ª ocorrência,
    com as posições das palavras dentro do trecho, para o realce."""
    termos = [t for t in _sem_acento(q).split() if t]
    if not termos:
        return []
    frase = " ".join(termos)
    out = []
    for raiz in [*TODAS, "skills"]:
        for nome, p in _arquivos(raiz):
            try:
                corpo, norm = _corpo(p)
            except OSError:
                continue
            if not all(t in norm for t in termos):
                continue
            i = norm.find(frase)
            exato = i >= 0
            if not exato:
                i = min(norm.find(t) for t in termos)
            ini = max(0, i - 60)
            ini = norm.rfind(" ", 0, ini) + 1 if ini else 0
            fim = min(len(corpo), i + 140)
            trecho, tnorm = corpo[ini:fim], norm[ini:fim]
            marcas = []
            for t in ([frase] if exato else termos):
                k = tnorm.find(t)
                while k >= 0:
                    marcas.append([k + (1 if ini else 0), len(t)])
                    k = tnorm.find(t, k + len(t))
            out.append({"nome": nome, "raiz": raiz, "trecho": ("…" if ini else "") + trecho + ("…" if fim < len(corpo) else ""),
                        "marcas": marcas, "n": sum(norm.count(t) for t in termos), "exato": exato, "mtime": p.stat().st_mtime})
    out.sort(key=lambda x: (not x["exato"], -x["n"], -x["mtime"]))
    return out[:limite]


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
    """Nova copy em Priorizar com o frontmatter do template de Copy (status: ideia, scheduled, notion, tags, categoria)."""
    titulo = re.sub(r"[/\\:]", "-", titulo).strip() or "Sem título"
    p = PRIORIZAR / f"{titulo}.md"
    if p.exists():
        raise FileExistsError(p.name)
    modelo = "---\nstatus: ideia\nscheduled:\nnotion:\ntags:\ncategoria:\n---\n\n"
    if TEMPLATE_COPY.is_file():
        t = TEMPLATE_COPY.read_text(encoding="utf-8", errors="replace")
        m = re.match(r"^---\n.*?\n---\n", t, flags=re.S)
        if m and "<%" not in m.group(0):
            modelo = m.group(0) + "\n"
    p.write_text(modelo, encoding="utf-8")
    return {"nome": p.stem, "raiz": "priorizar", "mtime": p.stat().st_mtime,
            "criado": datetime.now().isoformat(timespec="seconds")}




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
                out.append({"nome": nome, "raiz": raiz, "scheduled": data, "datas": ds, "status": status(raiz, nome, texto)})
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


def mover(raiz: str, nome: str, destino: str) -> dict:
    """Muda de pasta. Publicar grava `status: publicado`; tirar de Publicados volta para `status: ideia`."""
    if raiz not in PASTAS or destino not in PASTAS or raiz == destino:
        raise ValueError("movimento inválido")
    p = _caminho(raiz, nome)
    if not p or not p.is_file():
        raise FileNotFoundError(nome)
    PASTAS[destino].mkdir(exist_ok=True)
    novo = nome
    alvo = PASTAS[destino] / f"{novo}.md"
    if alvo.exists():
        raise FileExistsError(alvo.name)
    if destino == "publicados" or raiz == "publicados":
        texto = p.read_text(encoding="utf-8", errors="replace")
        texto = re.sub(r"(?m)^publicado:.*\n", "", texto, count=1)   # a propriedade antiga, se sobrou
        _escrever(p, _definir_prop(texto, "status", "publicado" if destino == "publicados" else "ideia"))
    os.rename(p, alvo)
    _trocar_fixada(f"{raiz}/{nome}", f"{destino}/{novo}")
    return {"nome": novo, "raiz": destino, "mtime": alvo.stat().st_mtime}


def _definir_prop(texto: str, chave: str, valor: str | None) -> str:
    """Troca (ou cria, ou tira com None) uma propriedade simples no frontmatter, sem mexer no resto."""
    m = re.match(r"\A---\n(.*?)\n---", texto, re.S)
    fm, corpo = (m.group(1), texto[m.end():]) if m else ("", "\n" + texto)
    linhas = [l for l in fm.split("\n")] if fm else []
    i = next((k for k, l in enumerate(linhas) if re.match(rf"^{re.escape(chave)}:", l)), None)
    if i is not None:
        del linhas[i]
    else:
        i = len(linhas)
    if valor is not None:
        linhas.insert(i, f"{chave}: {valor}")
    return "---\n" + "\n".join(linhas) + "\n---" + corpo


def mudar_status(raiz: str, nome: str, novo_status: str) -> dict:
    """ideia / gravar / edicao / agendado: grava a propriedade `status:` (a nota fica em Priorizar, o nome não muda)."""
    if raiz != "priorizar" or novo_status not in ("ideia", "gravar", "edicao", "agendado"):
        raise ValueError("status inválido")
    p = _caminho(raiz, nome)
    if not p or not p.is_file():
        raise FileNotFoundError(nome)
    _escrever(p, _definir_prop(p.read_text(encoding="utf-8", errors="replace"), "status", STATUS_VAULT[novo_status]))
    return {"nome": nome, "raiz": raiz, "mtime": p.stat().st_mtime}


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
