"""O que o Rodrigo gosta no radar, aprendido dos likes e deslikes.

Duas camadas, as duas baratas:
1. Afinidade local (na hora, sem modelo): cada voto conta para a fonte, o tipo, o autor e as palavras do sinal.
   Um sinal novo herda a média do que ele tem em comum com os votados (de -1 a 1).
2. Interesse do Haiku (na classificação): o prompt leva exemplos do que ele curtiu e rejeitou, e o modelo
   dá uma nota de 0 a 100 de quanto o item combina com esse gosto. Generaliza além das palavras exatas.

Pontuação final (0 a 100) = 55% potencial da fonte + 30% interesse + até ±20 pela afinidade.
"""
import re
import time
from collections import defaultdict

from . import db

PARADAS = set("""para com que uma por mais como dos das nos nas não sem isso este esta esse essa aqui você seu sua
the and for with that this from your have will what about into just more than they them their when where which
http https www com status view views like likes shows show just new novo nova agora muito simplesmente really""".split())
PESO = {"fonte": 0.6, "tipo": 1.0, "autor": 1.4, "palavra": 0.5}

_cache: tuple[float, dict] | None = None


def _feicoes(s: dict) -> list[tuple[str, str]]:
    f = [("fonte", s["fonte"])]
    if s.get("tipo"):
        f.append(("tipo", s["tipo"]))
    if s.get("autor") and s["fonte"] == "x":
        f.append(("autor", s["autor"].lower()))
    texto = f"{s.get('titulo') or ''} {s.get('resumo') or ''}".lower()
    palavras = {w for w in re.findall(r"[a-zà-ú0-9][a-zà-ú0-9.+-]{3,}", texto) if w not in PARADAS and not w.isdigit()}
    f += [("palavra", w) for w in list(palavras)[:40]]
    return f


def perfil() -> dict:
    """{(classe, valor): (likes, deslikes)}. Recalculado no máximo a cada 5 s."""
    global _cache
    if _cache and time.time() - _cache[0] < 5:
        return _cache[1]
    cont: dict = defaultdict(lambda: [0, 0])
    for s in db.votados():
        for k in _feicoes(s):
            cont[k][0 if s["voto"] > 0 else 1] += 1
    _cache = (time.time(), dict(cont))
    return _cache[1]


def invalidar():
    global _cache
    _cache = None


def afinidade(s: dict, p: dict) -> tuple[float, list[str]]:
    if not p:
        return 0.0, []
    soma = peso = 0.0
    fortes = []
    for k in _feicoes(s):
        if k not in p:
            continue
        l, d = p[k]
        w = (l - d) / (l + d + 1)            # -1..1, encolhido quando há poucos votos
        conf = PESO[k[0]] * min(1.0, (l + d) / 2)
        soma += w * conf
        peso += conf
        if abs(w) >= 0.4 and k[0] != "fonte":
            fortes.append((abs(w) * conf, ("+" if w > 0 else "−") + (k[1] if k[0] != "tipo" else f"tipo {k[1]}")))
    if not peso:
        return 0.0, []
    fortes.sort(reverse=True)
    return round(soma / max(peso, 1.5), 3), [m for _, m in fortes[:3]]


def pontuar(s: dict) -> float:
    if s.get("voto", 0) > 0:
        return 100.0
    interesse = s.get("interesse")
    base = 0.55 * (s.get("nota") or 0) + 0.30 * (interesse if interesse is not None else 50) + 7.5
    return round(max(0.0, min(100.0, base + 20 * (s.get("afinidade") or 0))), 1)


def exemplos(n: int = 12) -> str:
    """Trecho para o prompt da classificação: o que ele curtiu e o que rejeitou."""
    vs = db.votados()
    gostou = [s for s in vs if s["voto"] > 0][:n]
    nao = [s for s in vs if s["voto"] < 0][:n]
    if not gostou and not nao:
        return "(ele ainda não votou em nada: use o bom senso para o público dele)"
    linha = lambda s: f"- [{s['fonte']}{'/' + s['tipo'] if s['tipo'] else ''}] {(s['titulo'] or '')[:110]}"
    return ("Curtiu:\n" + ("\n".join(map(linha, gostou)) or "(nada)") +
            "\nRejeitou:\n" + ("\n".join(map(linha, nao)) or "(nada)"))
