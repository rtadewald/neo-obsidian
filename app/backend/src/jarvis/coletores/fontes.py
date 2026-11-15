"""Coletores sem login (Q31): GitHub Trending, Hugging Face Trending e Hacker News, até TOPO (50) itens cada.

Cada coletor devolve sinais no formato de `db.gravar_sinais`. Nenhum usa LLM: a nota é calculada
dos números da própria fonte e normalizada de 0 a 100 dentro da coleta (o 1º do dia em cada fonte ≈ 100).
"""
import math
import re
import time

import httpx
from bs4 import BeautifulSoup

UA = {"User-Agent": "jarvis-radar/0.1 (uso pessoal)"}
TOPO = 50   # quantos itens cada fonte traz por coleta (os mais em alta)


def _num(texto: str) -> int:
    t = (texto or "").strip().replace(",", "")
    m = re.search(r"[\d.]+", t)
    return int(float(m.group())) if m else 0


def _normaliza(itens: list[dict], chave) -> list[dict]:
    """Nota 0–100 em escala log, relativa ao maior valor da coleta."""
    vals = [max(chave(i), 0) for i in itens]
    topo = math.log1p(max(vals or [1])) or 1
    for i, v in zip(itens, vals):
        i["nota"] = round(100 * math.log1p(v) / topo, 1)
    return itens


def _milhar(n: int) -> str:
    return f"{n:,}".replace(",", ".")


def github(cliente: httpx.Client) -> list[dict]:
    """A página de trending traz 25: completa com a da semana até TOPO (sem repetir)."""
    linhas = []
    for periodo in ("daily", "weekly"):
        html = cliente.get(f"https://github.com/trending?since={periodo}", headers=UA, timeout=20).text
        linhas += BeautifulSoup(html, "html.parser").select("article.Box-row")
    itens, vistos = [], set()
    for row in linhas:
        a = row.select_one("h2 a")
        if not a:
            continue
        repo = str(a.get("href", "")).strip("/")
        if repo in vistos:
            continue
        vistos.add(repo)
        desc = row.select_one("p")
        hoje = row.find(string=re.compile(r"stars? (today|this week)"))
        total = row.select_one('a[href$="/stargazers"]')
        lang = row.select_one('[itemprop="programmingLanguage"]')
        h = _num(str(hoje or ""))
        itens.append({
            "fonte": "github", "externo": repo, "url": f"https://github.com/{repo}",
            "titulo": repo, "resumo": desc.get_text(" ", strip=True) if desc else "",
            "autor": repo.split("/")[0], "imagem": f"https://opengraph.githubassets.com/1/{repo}",
            "metricas": {"estrelas_hoje": h, "estrelas": _num(total.get_text() if total else ""),
                         "linguagem": lang.get_text(strip=True) if lang else None},
            "destaque": f"+{_milhar(h)} ★ " + ("hoje" if "today" in str(hoje) else "na semana"),
        })
    # completa com os repositórios criados nos últimos 7 dias com mais estrelas (API de busca, sem login)
    if len(itens) < TOPO:
        desde = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 7 * 86400))
        try:
            r = cliente.get("https://api.github.com/search/repositories", headers=UA, timeout=20,
                            params={"q": f"created:>{desde}", "sort": "stars", "order": "desc", "per_page": TOPO})
            for g in r.json().get("items", []):
                if g["full_name"] in vistos or len(itens) >= TOPO:
                    continue
                vistos.add(g["full_name"])
                est = g.get("stargazers_count", 0)
                itens.append({
                    "fonte": "github", "externo": g["full_name"], "url": g["html_url"], "titulo": g["full_name"],
                    "resumo": g.get("description") or "", "autor": g["owner"]["login"],
                    "imagem": f"https://opengraph.githubassets.com/1/{g['full_name']}",
                    # repo novo: as estrelas todas são "da semana", na mesma régua dos de trending
                    "metricas": {"estrelas_hoje": est, "estrelas": est, "linguagem": g.get("language")},
                    "destaque": f"{_milhar(est)} ★ · novo", "publicado_em": g.get("created_at"),
                })
        except (httpx.HTTPError, ValueError, KeyError):
            pass   # a busca tem limite por minuto: fica com o trending
    return _normaliza(itens[:TOPO], lambda i: i["metricas"]["estrelas_hoje"])


def huggingface(cliente: httpx.Client) -> list[dict]:
    itens = []
    for tipo, url in (("modelo", f"https://huggingface.co/api/models?sort=trendingScore&limit={TOPO - 15}"),
                      ("space", "https://huggingface.co/api/spaces?sort=trendingScore&limit=15")):
        for m in cliente.get(url, headers=UA, timeout=20).json():
            mid = m["id"]
            base = "https://huggingface.co/" + ("spaces/" if tipo == "space" else "")
            tags = [t for t in m.get("tags", []) if ":" not in t][:6]
            itens.append({
                "fonte": "huggingface", "externo": f"{tipo}:{mid}", "url": base + mid,
                "titulo": mid, "resumo": " · ".join(filter(None, [m.get("pipeline_tag"), *tags])),
                "autor": mid.split("/")[0],
                "metricas": {"trending": m.get("trendingScore", 0), "likes": m.get("likes", 0),
                             "downloads": m.get("downloads"), "tipo": tipo},
                "destaque": f"{_milhar(m.get('likes', 0))} likes",
                "publicado_em": m.get("createdAt"),
            })
    return _normaliza(itens, lambda i: i["metricas"]["trending"])


def hackernews(cliente: httpx.Client) -> list[dict]:
    # a capa só tem ~30: as histórias das últimas 24 h, por relevância (pontos), até TOPO
    desde = int(time.time()) - 86400
    dados = cliente.get(f"https://hn.algolia.com/api/v1/search?tags=story&numericFilters=created_at_i>{desde},points>5"
                        f"&hitsPerPage={TOPO}", headers=UA, timeout=20).json()
    itens = []
    for h in dados.get("hits", []):
        pts, com = h.get("points") or 0, h.get("num_comments") or 0
        itens.append({
            "fonte": "hackernews", "externo": h["objectID"],
            "url": h.get("url") or f"https://news.ycombinator.com/item?id={h['objectID']}",
            "titulo": h.get("title") or "", "resumo": "", "autor": h.get("author"),
            "metricas": {"pontos": pts, "comentarios": com,
                         "discussao": f"https://news.ycombinator.com/item?id={h['objectID']}"},
            "destaque": f"{pts} pts · {com} coment.",
            "publicado_em": h.get("created_at"),
        })
    return _normaliza(itens, lambda i: i["metricas"]["pontos"] + 2 * i["metricas"]["comentarios"])


COLETORES = {"github": github, "huggingface": huggingface, "hackernews": hackernews}
