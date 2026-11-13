"""Leitura das skills do vault (`3 Skills/<nome>/SKILL.md`). Só leitura por enquanto."""
import re

from .config import VAULT

PASTA = VAULT / "3 Skills"
NOME_OK = re.compile(r"^[\w.-]+$")


def _frontmatter(texto: str) -> tuple[dict, str]:
    """Frontmatter YAML simples (chave: valor numa linha). As skills variam; o parser tolera o que não entende."""
    if not texto.startswith("---"):
        return {}, texto
    fim = texto.find("\n---", 3)
    if fim < 0:
        return {}, texto
    meta = {}
    for linha in texto[3:fim].splitlines():
        m = re.match(r"^(\w[\w-]*):\s*(.*)$", linha)
        if m:
            meta[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return meta, texto[fim + 4:].lstrip("\n")


def _grupo(nome: str) -> str:
    if nome.startswith("vsl"):
        return "VSL"
    if any(k in nome for k in ("reels", "hook", "carrossel", "roteiro")):
        return "Reels e carrosséis"
    if any(k in nome for k in ("radar", "signal", "pesquisa")):
        return "Pesquisa"
    return "Copy"


def listar() -> list[dict]:
    itens = []
    for f in sorted(PASTA.glob("*/SKILL.md")):
        meta, _ = _frontmatter(f.read_text(encoding="utf-8", errors="replace"))
        nome = f.parent.name
        refs = f.parent / "references"
        itens.append({"nome": nome, "descricao": meta.get("description", ""), "grupo": _grupo(nome),
                      "referencias": len(list(refs.glob("*"))) if refs.is_dir() else 0})
    return itens


def ler(nome: str) -> dict | None:
    if not NOME_OK.match(nome):
        return None
    f = PASTA / nome / "SKILL.md"
    if not f.is_file():
        return None
    meta, corpo = _frontmatter(f.read_text(encoding="utf-8", errors="replace"))
    refs = f.parent / "references"
    return {"nome": nome, "descricao": meta.get("description", ""), "corpo": corpo,
            "referencias": sorted(p.name for p in refs.glob("*")) if refs.is_dir() else []}
