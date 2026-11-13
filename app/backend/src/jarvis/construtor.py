"""Modo construtor: o agente do chat mexe no código do próprio app, e cada pedido pode ser desfeito.

Antes de cada pedido guardo um ponto de restauração da pasta `app/` como um commit solto do git (índice temporário,
sem tocar no índice nem no histórico do Rodrigo). "Desfazer" volta a pasta para o último ponto: reescreve os
arquivos daquele momento e apaga os que o agente criou depois. Pastas ignoradas (dados, node_modules, .venv) ficam fora.
"""
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

from .config import APP, DADOS

REPO = APP.parent
PONTOS = DADOS / "construtor.json"
MAX = 30


def _git(*args: str, indice: str | None = None, input_: str | None = None) -> str:
    env = {**os.environ, **({"GIT_INDEX_FILE": indice} if indice else {})}
    r = subprocess.run(["git", *args], cwd=REPO, env=env, capture_output=True, text=True, input=input_)
    if r.returncode:
        raise ValueError(f"git {args[0]}: {r.stderr.strip()[:300]}")
    return r.stdout


def _pontos() -> list[dict]:
    try:
        return json.loads(PONTOS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def _gravar(p: list[dict]):
    DADOS.mkdir(parents=True, exist_ok=True)
    PONTOS.write_text(json.dumps(p[-MAX:], ensure_ascii=False, indent=1), encoding="utf-8")


def ponto(pedido: str) -> str:
    with tempfile.TemporaryDirectory() as d:
        idx = str(Path(d) / "index")
        _git("read-tree", "--empty", indice=idx)
        _git("add", "-A", "--", "app", indice=idx)
        arvore = _git("write-tree", indice=idx).strip()
    pai = ["-p", "HEAD"] if _git("rev-parse", "--verify", "-q", "HEAD").strip() else []
    commit = _git("commit-tree", arvore, *pai, "-m", f"ponto do construtor: {pedido[:80]}").strip()
    _git("update-ref", f"refs/neo/pontos/{int(time.time() * 1000)}", commit)   # o git não recolhe o commit solto
    _gravar(_pontos() + [{"commit": commit, "quando": time.time(), "pedido": pedido[:200]}])
    return commit


def desfazer() -> dict:
    pts = _pontos()
    if not pts:
        raise ValueError("não há mudança do construtor para desfazer")
    ult = pts[-1]
    no_ponto = {}   # caminho → blob, como estava antes do pedido
    for linha in _git("ls-tree", "-r", "-z", ult["commit"], "--", "app").split("\0"):
        if linha:
            meta, rel = linha.split("\t", 1)
            no_ponto[rel] = meta.split()[2]
    agora = set(_git("ls-files", "-co", "--exclude-standard", "--", "app").splitlines())
    for rel in agora - set(no_ponto):
        (REPO / rel).unlink(missing_ok=True)
    # só reescreve o que mudou (reescrever tudo faria o Vite recarregar a página inteira)
    existentes = [r for r in no_ponto if (REPO / r).is_file()]
    hashes = _git("hash-object", "--stdin-paths", input_="\n".join(existentes)).split() if existentes else []
    atuais = dict(zip(existentes, hashes))
    for rel, blob in no_ponto.items():
        if atuais.get(rel) != blob:
            p = REPO / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(subprocess.run(["git", "cat-file", "blob", blob], cwd=REPO, capture_output=True, check=True).stdout)
    _gravar(pts[:-1])
    return {"desfeito": ult["pedido"], "restam": len(pts) - 1}


def estado() -> dict:
    pts = _pontos()
    return {"pontos": len(pts), "ultimo": pts[-1]["pedido"] if pts else None}
