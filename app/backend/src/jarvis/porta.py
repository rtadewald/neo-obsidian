"""A porta entre o app e o Claude Code (que roda no terminal, fora do app).

- Eventos: o app abre `GET /api/eventos` (SSE). Chega `mudou` quando uma nota do vault muda (o Claude editou daqui)
  e `tela` quando o Claude manda mexer na tela (`POST /api/tela`).
- Onde: o app conta onde o Rodrigo está (tela, nota aberta, abas da Redação); o Claude lê em `GET /api/onde`.
"""
import asyncio
import re
from pathlib import Path

from . import notas

FM = re.compile(r"\A---\n(.*?)\n---\n?", re.S)


def _arquivos() -> list[Path]:
    out = []
    for raiz in notas.TODAS:
        out += [p for _, p in notas._arquivos(raiz)]
    return out


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
        while True:
            try:
                yield await asyncio.wait_for(q.get(), 15)
            except asyncio.TimeoutError:
                yield {"t": "ping"}
    finally:
        _filas.discard(q)


def _assinatura() -> tuple:
    """Muda quando qualquer copy é criada, editada, movida ou apagada."""
    tot, n = 0.0, 0
    for p in _arquivos():
        try:
            tot += p.stat().st_mtime
            n += 1
        except OSError:
            pass
    return (n, round(tot, 3))


async def vigiar_vault():
    """De segundo em segundo e meio: nota mudou fora do app (o Claude editou) → evento `mudou`."""
    antes = await asyncio.to_thread(_assinatura)
    while True:
        await asyncio.sleep(1.5)
        try:
            agora = await asyncio.to_thread(_assinatura)
            if agora != antes:
                antes = agora
                publicar({"t": "mudou"})
        except Exception:  # noqa: BLE001 — o vigia não pode morrer
            pass
