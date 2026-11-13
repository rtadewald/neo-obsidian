"""Blocos de planejamento do calendário editorial: "essa semana, carrossel", "aquela, FIA".
Só um desenho no calendário (tracejado, com um texto curto) — não mexe em nenhuma nota.
Guardado num JSON só do app (fora do vault), igual ads.json."""
import json
import time
import uuid

from .config import DADOS

ARQ = DADOS / "planejamento.json"


def listar() -> list[dict]:
    try:
        return json.loads(ARQ.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []


def _gravar(itens: list[dict]):
    DADOS.mkdir(parents=True, exist_ok=True)
    ARQ.write_text(json.dumps(itens, ensure_ascii=False, indent=2), encoding="utf-8")


def criar(inicio: str, fim: str, texto: str, cor: str | None = None) -> dict:
    item = {"id": uuid.uuid4().hex[:10], "inicio": inicio, "fim": fim, "texto": texto.strip()[:60],
            "cor": cor, "criado": time.time()}
    itens = listar()
    itens.append(item)
    _gravar(itens)
    return item


def atualizar(id_: str, **campos) -> dict | None:
    itens = listar()
    for it in itens:
        if it["id"] == id_:
            it.update({k: v for k, v in campos.items() if v is not None})
            _gravar(itens)
            return it
    return None


def apagar(id_: str) -> bool:
    itens = listar()
    novo = [i for i in itens if i["id"] != id_]
    if len(novo) == len(itens):
        return False
    _gravar(novo)
    return True
