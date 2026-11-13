"""Meta Ads pelo Metricool (conta conectada na marca rodrigotadewald), só leitura.

Três consultas por sincronização, todas do conector metaAds:
- evolution (FAEV): investimento, impressões, alcance, cliques, ROAS e valor de conversão por dia;
- campaigns (FACA): uma linha por campanha no período;
- ads (FADE): uma linha por anúncio, com a miniatura do criativo.
"""
import asyncio
import json
import time
from datetime import datetime, timedelta

import httpx

from . import db
from .config import DADOS
from .metricool import BRAND, _baixa_thumb, _numero, chamar

EVOL = ["FAEV01", "FAEV02", "FAEV04", "FAEV05", "FAEV09", "FAEV10"]
CAMP = ["FACA06", "FACA05", "FACA07", "FACA03", "FACA13", "FACA10", "FACA12", "FACA14", "FACA44", "FACA156", "FACA157",
        "FACA22", "FACA23", "FACA149", "FACA43"]
ADS = ["FADE03", "FADE04", "FADE06", "FADE13", "FADE15", "FADE16", "FADE11", "FADE37", "FADE149", "FADE150", "FADE72",
       "FADE73", "FADE142", "FADE147"]
DIARIO = ["FADE08", "FADE13", "FADE15", "FADE11", "FADE149", "FADE73"]   # anúncio x dia: soma vira a série diária
ESTADO = DADOS / "ads.json"
_rodando = asyncio.Lock()


def estado() -> dict:
    try:
        return json.loads(ESTADO.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _salvar_estado(**kw):
    ESTADO.parent.mkdir(parents=True, exist_ok=True)
    ESTADO.write_text(json.dumps(estado() | kw, ensure_ascii=False))


def _dia(v) -> str | None:
    s = str(v or "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) >= 8 and s[:8].isdigit() else None


def _metricas(d: dict, k: dict) -> dict:
    """k: nome -> fieldId. Deriva CTR, CPC, CPM e custo por resultado dos totais (as médias do Metricool são por linha)."""
    m = {nome: _numero(d.get(f)) for nome, f in k.items()}
    g, imp, cli, res = m.get("gasto") or 0, m.get("impressoes") or 0, m.get("cliques_link") or m.get("cliques") or 0, m.get("resultados") or 0
    m["ctr"] = cli / imp * 100 if imp else None
    m["cpc"] = g / cli if cli else None
    m["cpm"] = g / imp * 1000 if imp else None
    m["custo_resultado"] = g / res if res else None
    return m


def converter(brutos: list[tuple[dict, dict]], http: httpx.Client | None = None) -> tuple[list[dict], list[dict]]:
    dias, itens = [], []
    for entrada, dado in brutos:
        campos = entrada.get("metrics") or []
        linhas = dado.get("rows") or []
        if campos == EVOL:
            for r in linhas:
                d = dict(zip(EVOL, r))
                dia = _dia(r[-1]) if len(r) > len(EVOL) else None
                if not dia:
                    continue
                if any(x["dia"] == dia for x in dias):  # a série por anúncio x dia tem prioridade
                    continue
                dias.append({"dia": dia, "impressoes": _numero(d["FAEV01"]), "alcance": _numero(d["FAEV02"]),
                             "gasto": _numero(d["FAEV04"]), "cliques": _numero(d["FAEV05"]),
                             "roas": _numero(d["FAEV09"]), "valor": _numero(d["FAEV10"])})
        elif campos == DIARIO:
            por_dia: dict[str, dict] = {}
            for r in linhas:
                d = dict(zip(DIARIO, r))
                dia = _dia(d["FADE08"])
                if not dia:
                    continue
                a = por_dia.setdefault(dia, {"dia": dia, "gasto": 0.0, "impressoes": 0.0, "cliques": 0.0, "valor": 0.0,
                                             "resultados": 0.0, "alcance": None, "roas": None})
                for nome, f in (("gasto", "FADE13"), ("impressoes", "FADE15"), ("cliques", "FADE11"),
                                ("resultados", "FADE149"), ("valor", "FADE73")):
                    a[nome] += _numero(d[f]) or 0
            for a in por_dia.values():
                a["roas"] = a["valor"] / a["gasto"] if a["gasto"] else None
                a.pop("resultados")
            dias = [x for x in dias if x["dia"] not in por_dia] + list(por_dia.values())
        elif campos == CAMP:
            for r in linhas:
                d = dict(zip(CAMP, r))
                if not d.get("FACA06"):
                    continue
                itens.append({"id": f"campanha:{d['FACA06']}", "nivel": "campanha", "nome": d.get("FACA05"),
                              "objetivo": d.get("FACA07"), "inicio": d.get("FACA03"), "campanha": d.get("FACA05"),
                              "metricas": _metricas(d, {"gasto": "FACA13", "impressoes": "FACA10", "alcance": "FACA12",
                                                        "cliques": "FACA14", "cliques_link": "FACA44", "resultados": "FACA156",
                                                        "roas": "FACA22", "valor": "FACA23", "thruplays": "FACA149",
                                                        "lp_views": "FACA43"}) | {"rotulo": d.get("FACA157")}})
        elif campos == ADS:
            for r in linhas:
                d = dict(zip(ADS, r))
                if not d.get("FADE03"):
                    continue
                thumb = _baixa_thumb(http, f"ad:{d['FADE03']}", d.get("FADE147")) if http else None
                itens.append({"id": f"anuncio:{d['FADE03']}", "nivel": "anuncio", "nome": d.get("FADE04"),
                              "campanha": d.get("FADE06"), "thumb": thumb,
                              "metricas": _metricas(d, {"gasto": "FADE13", "impressoes": "FADE15", "alcance": "FADE16",
                                                        "cliques": "FADE11", "cliques_link": "FADE37", "resultados": "FADE149",
                                                        "roas": "FADE72", "valor": "FADE73", "thruplays": "FADE142"})
                              | {"rotulo": d.get("FADE150")}})
    return dias, itens


async def sincronizar(dias: int = 30) -> dict:
    if _rodando.locked():
        return {"status": "ja_rodando"}
    async with _rodando:
        agora = datetime.now()
        de = (agora - timedelta(days=dias)).strftime("%Y-%m-%dT00:00:00-03:00")
        ate = agora.strftime("%Y-%m-%dT23:59:59-03:00")
        _salvar_estado(rodando=True, erro=None)
        try:
            brutos, final = await chamar([("getAnalyticsDataByMetrics", {"brandId": BRAND, "from": de, "to": ate, "metrics": m})
                                          for m in (DIARIO, EVOL, CAMP, ADS)])
            if not brutos:
                raise RuntimeError(f"o Metricool não respondeu: {final[:200]}")
            with httpx.Client(follow_redirects=True) as http:
                linhas_dia, itens = await asyncio.to_thread(converter, brutos, http)
            agora_ts = time.time()
            with db.conexao() as c:
                for d in linhas_dia:
                    c.execute("""insert into ads_dia (dia, gasto, impressoes, alcance, cliques, roas, valor, atualizado_em)
                                 values (:dia, :gasto, :impressoes, :alcance, :cliques, :roas, :valor, :t)
                                 on conflict(dia) do update set gasto=excluded.gasto, impressoes=excluded.impressoes,
                                 alcance=excluded.alcance, cliques=excluded.cliques, roas=excluded.roas, valor=excluded.valor,
                                 atualizado_em=excluded.atualizado_em""", d | {"t": agora_ts})
                if itens:  # o período sincronizado substitui o anterior
                    c.execute("delete from ads_item")
                for i in itens:
                    c.execute("""insert or replace into ads_item (id, nivel, nome, campanha, objetivo, inicio, thumb, metricas, atualizado_em)
                                 values (?,?,?,?,?,?,?,?,?)""",
                              (i["id"], i["nivel"], i.get("nome"), i.get("campanha"), i.get("objetivo"), i.get("inicio"),
                               i.get("thumb"), json.dumps(i["metricas"]), agora_ts))
            det = {"status": "ok", "dias": len(linhas_dia), "campanhas": sum(i["nivel"] == "campanha" for i in itens),
                   "anuncios": sum(i["nivel"] == "anuncio" for i in itens),
                   "com_gasto": sum(1 for d in linhas_dia if d.get("gasto"))}
            _salvar_estado(rodando=False, sincronizado_em=agora_ts, de=de[:10], ate=ate[:10], ultimo=det, erro=None)
            return det
        except Exception as e:
            _salvar_estado(rodando=False, erro=f"{type(e).__name__}: {e}"[:300])
            raise


def painel() -> dict:
    with db.conexao() as c:
        dias = [dict(r) for r in c.execute("select * from ads_dia order by dia").fetchall()]
        itens = [dict(r) | {"metricas": json.loads(r["metricas"] or "{}")} for r in
                 c.execute("select * from ads_item").fetchall()]
    return {"estado": estado() | {"conta": "act_3120164588217844"}, "dias": dias,
            "campanhas": [i for i in itens if i["nivel"] == "campanha"],
            "anuncios": [i for i in itens if i["nivel"] == "anuncio"]}


if __name__ == "__main__":  # uv run python -m jarvis.anuncios
    from . import auth
    auth.preparar()
    db.iniciar()
    print(asyncio.run(sincronizar()))
