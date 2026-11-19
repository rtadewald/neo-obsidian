"""A porta entre o app e o Claude Code (que roda no terminal, fora do app).

- Códigos: cada nota do canvas tem `codigo: NEO-042` no frontmatter (sequencial, nunca reaproveitado). O Rodrigo copia
  o código no app e cola no Claude Code; o Claude acha a nota com `GET /api/codigo/NEO-042` (ou grep no vault).
- Fila: os pedidos que o Rodrigo manda do app (`POST /api/fila`) viram linhas em `dados/fila.jsonl`. O Claude Code
  escuta com `ouvir.sh` (Monitor) e marca que está ouvindo tocando `dados/.ouvinte`.
- Eventos: o app abre `GET /api/eventos` (SSE). Chega `mudou` quando uma nota do vault muda (o Claude editou daqui)
  e `tela` quando o Claude manda mexer na tela (`POST /api/tela`).
- Onde: o app conta onde o Rodrigo está (tela, canvas, seleção, nota aberta); o Claude lê em `GET /api/onde`.
"""
import asyncio
import fcntl
import json
import os
import re
import time
from pathlib import Path

from . import notas
from .config import DADOS

PREFIXO = "NEO"
CODIGO = re.compile(rf"\b{PREFIXO}-(\d{{3,}})\b")
CONTADOR = DADOS / "codigos.json"
FILA = DADOS / "fila.jsonl"
OUVINTE = DADOS / ".ouvinte"
FM = re.compile(r"\A---\n(.*?)\n---\n?", re.S)


# ---------- códigos ----------

def _codigo_de(texto: str) -> str | None:
    m = FM.match(texto)
    if not m:
        return None
    c = re.search(r"^codigo:\s*\"?([A-Z]+-\d+)\"?\s*$", m.group(1), re.M)
    return c.group(1) if c else None


def _com_codigo(texto: str, cod: str) -> str:
    m = FM.match(texto)
    if not m:
        return f"---\ncodigo: {cod}\n---\n{texto}"
    fm = m.group(1)
    return f"---\n{fm}\ncodigo: {cod}\n---\n{texto[m.end():]}"


def _arquivos() -> list[Path]:
    out = []
    for raiz in notas.TODAS:
        out += [p for _, p in notas._arquivos(raiz)]
    return out


def garantir_codigos(caminhos: list[Path] | None = None, manter_data: bool = False) -> int:
    """Dá código às notas que ainda não têm (as mais antigas primeiro). `manter_data`: o mtime não muda (a carga
    inicial; nota nova ganha mtime novo, para um editor aberto nela recarregar o texto com o código)."""
    DADOS.mkdir(parents=True, exist_ok=True)
    ps = caminhos if caminhos is not None else _arquivos()
    with open(DADOS / ".codigos.lock", "w") as trava:
        fcntl.flock(trava, fcntl.LOCK_EX)
        try:
            n = json.loads(CONTADOR.read_text()).get("contador", 0)
        except (OSError, ValueError):
            n = 0
        sem = []
        for p in ps:
            try:
                t = p.read_text(encoding="utf-8")
            except OSError:
                continue
            if not _codigo_de(t):
                sem.append((p, t))
        sem.sort(key=lambda x: getattr(x[0].stat(), "st_birthtime", x[0].stat().st_mtime))
        for p, t in sem:
            n += 1
            st = p.stat()
            notas._escrever(p, _com_codigo(t, f"{PREFIXO}-{n:03d}"))
            if manter_data:
                os.utime(p, (st.st_atime, st.st_mtime))
        if sem:
            CONTADOR.write_text(json.dumps({"contador": n}))
    return len(sem)


def novo_codigo() -> str:
    DADOS.mkdir(parents=True, exist_ok=True)
    with open(DADOS / ".codigos.lock", "w") as trava:
        fcntl.flock(trava, fcntl.LOCK_EX)
        try:
            n = json.loads(CONTADOR.read_text()).get("contador", 0) + 1
        except (OSError, ValueError):
            n = 1
        CONTADOR.write_text(json.dumps({"contador": n}))
    return f"{PREFIXO}-{n:03d}"


def carimbar(texto: str) -> str:
    """Nota nova (criada pelo app) já nasce com código."""
    return texto if _codigo_de(texto) else _com_codigo(texto, novo_codigo())


def achar_codigo(cod: str) -> dict | None:
    """Nota com esse código: raiz, nome, caminho no vault e o texto inteiro."""
    cod = cod.strip().upper()
    for raiz in notas.TODAS:
        for nome, p in notas._arquivos(raiz):
            try:
                t = p.read_text(encoding="utf-8")
            except OSError:
                continue
            if _codigo_de(t) == cod:
                return {"codigo": cod, "raiz": raiz, "nome": nome, "caminho": str(p), "texto": t}
    return None


# ---------- fila de pedidos para o Claude Code ----------

def enfileirar(pedido: dict) -> dict:
    DADOS.mkdir(parents=True, exist_ok=True)
    linha = {"ts": time.strftime("%Y-%m-%d %H:%M:%S"), **pedido}
    with open(FILA, "a", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.write(json.dumps(linha, ensure_ascii=False) + "\n")
    return linha


def ouvinte_vivo() -> bool:
    try:
        return time.time() - OUVINTE.stat().st_mtime < 60
    except OSError:
        return False


# ---------- eventos para o app (SSE) e onde o Rodrigo está ----------

_filas: set[asyncio.Queue] = set()
onde: dict = {}


def publicar(ev: dict):
    for q in list(_filas):
        q.put_nowait(ev)


async def assinar():
    q: asyncio.Queue = asyncio.Queue()
    _filas.add(q)
    try:
        yield {"t": "porta", "ouvindo": ouvinte_vivo()}
        while True:
            try:
                yield await asyncio.wait_for(q.get(), 15)
            except asyncio.TimeoutError:
                yield {"t": "porta", "ouvindo": ouvinte_vivo()}
    finally:
        _filas.discard(q)


def _assinatura() -> tuple:
    """Muda quando qualquer nota do canvas é criada, editada, movida ou apagada."""
    tot, n = 0.0, 0
    for p in _arquivos():
        try:
            tot += p.stat().st_mtime
            n += 1
        except OSError:
            pass
    return (n, round(tot, 3))


async def vigiar_vault():
    """De segundo em segundo e meio: nota mudou fora do app (o Claude editou) → código nas novas e evento `mudou`."""
    antes = await asyncio.to_thread(_assinatura)
    while True:
        await asyncio.sleep(1.5)
        try:
            agora = await asyncio.to_thread(_assinatura)
            if agora != antes:
                if await asyncio.to_thread(garantir_codigos):
                    agora = await asyncio.to_thread(_assinatura)
                antes = agora
                publicar({"t": "mudou"})
        except Exception:  # noqa: BLE001 — o vigia não pode morrer
            pass
