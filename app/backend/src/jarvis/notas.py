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
PREFIXO = {"edicao": "🧑🏼‍🔧", "agendado": "🔹"}
# um ou mais marcadores de status no começo do nome (🔹, 🧑‍🔧 com ou sem tom de pele)
MARCAS = re.compile("^(?:\U0001F539|\U0001F9D1[\U0001F3FB-\U0001F3FF]?\u200d\U0001F527)+")


class Conflito(Exception):
    pass


def _caminho(raiz: str, nome: str) -> Path | None:
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
    return "agendado" if "\U0001F539" in m.group(0) else "edicao"


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


def _scheduled(texto: str) -> str | None:
    m = re.match(r"^---\n(.*?)\n---\n", texto, flags=re.S)
    if not m:
        return None
    sm = SCHED.search(m.group(1))
    return sm.group(1) if sm else None


def agenda() -> list[dict]:
    """Notas de `1 Copies` com `scheduled` preenchido: o calendário editorial."""
    out = []
    for raiz in PASTAS:
        for nome, p in _arquivos(raiz):
            try:
                texto = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            data = _scheduled(texto)
            if data:
                out.append({"nome": nome, "raiz": raiz, "scheduled": data, "status": status(raiz, nome)})
    return out


def _definir_scheduled(texto: str, data: str) -> str:
    linha = f'scheduled: "{data}"'
    m = re.match(r"^---\n(.*?)\n---\n", texto, flags=re.S)
    if not m:
        return f"---\n{linha}\n---\n\n" + texto
    fm = m.group(1)
    # troca a linha `scheduled:` que já existir, mesmo vazia (toda copy nasce com `scheduled:`): antes ela ficava
    # e uma segunda era acrescentada no fim
    qualquer = re.compile(r"(?m)^scheduled:.*$")
    fm = qualquer.sub(linha, fm, count=1) if qualquer.search(fm) else (f"{fm}\n{linha}" if fm.strip() else linha)
    return f"---\n{fm}\n---\n" + texto[m.end():]


def mudar_agenda(raiz: str, nome: str, data: str) -> dict:
    """Arrastar no calendário editorial: muda só a propriedade `scheduled` da nota."""
    if raiz not in PASTAS:
        raise ValueError("raiz inválida")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", data):
        raise ValueError("data inválida (use AAAA-MM-DD)")
    p = _caminho(raiz, nome)
    if not p or not p.is_file():
        raise FileNotFoundError(nome)
    texto = p.read_text(encoding="utf-8", errors="replace")
    _escrever(p, _definir_scheduled(texto, data))
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
    """ideia / edicao / agendado: troca só o marcador no começo do nome (a nota fica em Priorizar)."""
    if raiz != "priorizar" or novo_status not in ("ideia", "edicao", "agendado"):
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
