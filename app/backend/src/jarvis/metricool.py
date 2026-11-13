"""Calendário de publicações a partir do Metricool (Q23, Q32).

O app não herda os conectores da conta claude.ai, mas uma sessão do Agent SDK com o login da assinatura herda.
Esta sessão chama só ferramentas de LEITURA do conector Metricool: `can_use_tool` nega qualquer outra (o conector
também agenda e edita posts). Os dados são lidos direto dos resultados das ferramentas, sem o modelo reescrevê-los.
As miniaturas são baixadas para dados/thumbs, porque os links do Instagram expiram em poucos dias.
"""
import asyncio
import hashlib
import json
import subprocess
import time
from datetime import datetime, timedelta, timezone

import httpx
from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, PermissionResultAllow,
                              PermissionResultDeny, ResultMessage, ToolResultBlock, ToolUseBlock, UserMessage)

from . import db
from .config import DADOS

BRAND = "7482213"                 # rodrigotadewald (getBrandSettings)
TZ = "America/Sao_Paulo"
BRT = timezone(timedelta(hours=-3))           # Brasília, sem horário de verão
THUMBS = DADOS / "thumbs"
LEITURA = ("getAnalyticsDataByMetrics", "getScheduledPosts", "getBrandSettings", "getAnalyticsAvailableMetrics")

REELS = ["IGRE02", "IGRE03", "IGRE05", "IGRE06", "IGRE23", "IGRE10", "IGRE07", "IGRE21", "IGRE12", "IGRE11", "IGRE27"]
POSTS = ["IGPO02", "IGPO03", "IGPO05", "IGPO06", "IGPO07", "IGPO28", "IGPO13", "IGPO08", "IGPO27", "IGPO15", "IGPO14", "IGPO29"]
TIKTOK = ["TKPO02", "TKPO03", "TKPO04", "TKPO05", "TKPO07", "TKPO08", "TKPO09", "TKPO10", "TKPO11", "TKPO13"]
YOUTUBE = ["YTVP02", "YTVP17", "YTVP03", "YTVP05", "YTVP06", "YTVP09", "YTVP11", "YTVP12", "YTVP08"]   # canal da Asimov
CONSULTAS = {"IGRE": REELS, "IGPO": POSTS, "TKPO": TIKTOK, "YTVP": YOUTUBE}

_rodando = asyncio.Lock()
DEBUG = bool(__import__("os").environ.get("JARVIS_DEBUG"))


async def _so_leitura(nome, entrada, contexto):
    if nome.endswith(LEITURA):
        return PermissionResultAllow()
    return PermissionResultDeny(message="O Jarvis só lê o Metricool.")


def _numero(v) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _data_metricool(s: str) -> str:
    # "20261108135542" vem em UTC (conferido contra o horário embutido no código do Reel) -> horário de Brasília
    if not (s and s[:14].isdigit()):
        return s
    utc = datetime.strptime(s[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return utc.astimezone(BRT).replace(tzinfo=None).isoformat()


def _baixa_thumb(cli: httpx.Client, chave: str, url: str | None, video: bool = False) -> str | None:
    if not url:
        return None
    THUMBS.mkdir(parents=True, exist_ok=True)
    nome = hashlib.sha1(chave.encode()).hexdigest()[:16] + ".jpg"
    alvo = THUMBS / nome
    if alvo.exists():
        return nome
    try:
        if video:  # agendados: primeiro quadro do vídeo
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "0.8", "-i", url, "-frames:v", "1",
                            "-vf", "scale=480:-2", str(alvo)], timeout=60, check=True)
        else:
            r = cli.get(url, timeout=20)
            r.raise_for_status()
            alvo.write_bytes(r.content)
        return nome
    except Exception:
        return None


def _gravar(registros: list[dict]):
    with db.conexao() as c:
        for p in registros:
            c.execute("""insert into posts (id, quando, estado, tipo, perfil, legenda, url, thumb, metricas, redes, atualizado_em, rede)
                         values (?,?,?,?,?,?,?,?,?,?,?,?)
                         on conflict(id) do update set quando=excluded.quando, estado=excluded.estado, tipo=excluded.tipo,
                         legenda=excluded.legenda, url=excluded.url, thumb=coalesce(excluded.thumb, posts.thumb),
                         metricas=excluded.metricas, redes=excluded.redes, atualizado_em=excluded.atualizado_em, rede=excluded.rede,
                         perfil=excluded.perfil""",
                      (p["id"], p["quando"], p["estado"], p.get("tipo"), p.get("perfil", "@rodrigotadewald"), p.get("legenda"), p.get("url"),
                       p.get("thumb"), json.dumps(p.get("metricas", {})), json.dumps(p.get("redes", [])), time.time(), p.get("rede")))


def _converter(resultados: list[tuple[list[str] | None, dict]], cli: httpx.Client) -> list[dict]:
    out = []
    for metricas, dado in resultados:
        if metricas == REELS:
            for r in dado.get("rows", []):
                d = dict(zip(REELS, r))
                out.append({"id": d["IGRE06"], "rede": "instagram", "quando": _data_metricool(d["IGRE02"]), "estado": "publicado", "tipo": "Reel",
                            "legenda": d["IGRE03"], "url": d["IGRE06"], "thumb": _baixa_thumb(cli, d["IGRE06"], d["IGRE05"]),
                            "metricas": {"views": _numero(d["IGRE23"]), "curtidas": _numero(d["IGRE10"]),
                                         "comentarios": _numero(d["IGRE07"]), "compartilhamentos": _numero(d["IGRE21"]),
                                         "salvos": _numero(d["IGRE12"]), "alcance": _numero(d["IGRE11"]),
                                         "retencao": _numero(d["IGRE27"])}})
        elif metricas == POSTS:
            for r in dado.get("rows", []):
                d = dict(zip(POSTS, r))
                tipo = {"CAROUSEL_ALBUM": "Carrossel", "IMAGE": "Imagem", "VIDEO": "Vídeo"}.get(str(d["IGPO07"]).upper(), d["IGPO07"])
                out.append({"id": d["IGPO06"], "rede": "instagram", "quando": _data_metricool(d["IGPO02"]), "estado": "publicado", "tipo": tipo,
                            "legenda": d["IGPO03"], "url": d["IGPO06"], "thumb": _baixa_thumb(cli, d["IGPO06"], d["IGPO05"]),
                            "metricas": {"views": _numero(d["IGPO28"]), "curtidas": _numero(d["IGPO13"]),
                                         "comentarios": _numero(d["IGPO08"]), "compartilhamentos": _numero(d["IGPO27"]),
                                         "salvos": _numero(d["IGPO15"]), "alcance": _numero(d["IGPO14"]),
                                         "seguidores": _numero(d["IGPO29"])}})
        elif metricas == TIKTOK:
            for r in dado.get("rows", []):
                d = dict(zip(TIKTOK, r))
                url = (d["TKPO03"] or "").split("?")[0]
                if not url:
                    continue
                out.append({"id": url, "rede": "tiktok", "quando": _data_metricool(d["TKPO02"]), "estado": "publicado", "tipo": "Vídeo",
                            "legenda": d["TKPO05"], "url": url, "thumb": _baixa_thumb(cli, url, d["TKPO04"]),
                            "metricas": {"views": _numero(d["TKPO07"]), "curtidas": _numero(d["TKPO08"]),
                                         "comentarios": _numero(d["TKPO09"]), "compartilhamentos": _numero(d["TKPO10"]),
                                         "alcance": _numero(d["TKPO11"]),
                                         "completos": (_numero(d["TKPO13"]) or 0) * 100 if d["TKPO13"] else None}})
        elif metricas == YOUTUBE:
            for r in dado.get("rows", []):
                d = dict(zip(YOUTUBE, r))
                titulo = d["YTVP17"] or ""
                if titulo.upper().startswith("ANUNCIO"):  # uploads de anúncio no canal da Asimov não são conteúdo
                    continue
                out.append({"id": d["YTVP05"], "rede": "youtube", "quando": _data_metricool(d["YTVP02"]), "estado": "publicado",
                            "tipo": "YouTube", "legenda": titulo, "url": d["YTVP05"], "perfil": "Asimov Academy",
                            "thumb": _baixa_thumb(cli, d["YTVP05"], d["YTVP03"]),
                            "metricas": {"views": _numero(d["YTVP06"]), "curtidas": _numero(d["YTVP09"]),
                                         "comentarios": _numero(d["YTVP11"]), "compartilhamentos": _numero(d["YTVP12"]),
                                         "duracao_media": _numero(d["YTVP08"])}})
        else:  # agendados
            for p in dado.get("data", []):
                ig = p.get("instagramData") or {}
                midia = (p.get("media") or [None])[0]
                video = bool(midia and midia.lower().endswith((".mp4", ".mov")))
                out.append({"id": f"agendado:{p['id']}", "rede": "multi", "quando": p["publicationDate"]["dateTime"], "estado": "agendado",
                            "tipo": {"REEL": "Reel", "CAROUSEL": "Carrossel", "POST": "Imagem"}.get(ig.get("type", ""), ig.get("type")),
                            "legenda": p.get("text", ""), "url": None,
                            "thumb": _baixa_thumb(cli, f"agendado:{p['id']}:{midia}", midia, video=video),
                            "redes": [x["network"] for x in p.get("providers", [])],
                            "metricas": {"titulo": (p.get("youtubeData") or {}).get("title") or (p.get("facebookData") or {}).get("title")}})
    return out


async def chamar(chamadas: list[tuple[str, dict]], max_turns: int = 8) -> tuple[list[tuple[dict, dict]], str]:
    """Abre uma sessão do SDK com o conector do Metricool e faz as chamadas de leitura pedidas.
    Devolve [(entrada, resultado JSON)] lidos direto dos ToolResults, e a resposta final do modelo."""
    linhas = "\n".join(f"{i + 1}. {n} com exatamente: {json.dumps(a)}" for i, (n, a) in enumerate(chamadas))
    prompt = (f"Chame as ferramentas do Metricool abaixo, uma vez cada, com estes parâmetros, e responda só \"OK\".\n"
              f"Não chame nenhuma outra ferramenta e não resuma os resultados.\n{linhas}")
    opts = ClaudeAgentOptions(model="haiku", tools=[], setting_sources=[], max_turns=max_turns, can_use_tool=_so_leitura,
                              env={"ENABLE_TOOL_SEARCH": "false"})
    pedidos: dict[str, dict] = {}
    resultados: list[tuple[dict, dict]] = []
    final = ""
    async with ClaudeSDKClient(opts) as cli:
        # os conectores da conta conectam alguns segundos depois de a sessão abrir: espera o Metricool
        for _ in range(40):
            st = await cli.get_mcp_status()
            if any("Metricool" in s.get("name", "") and s.get("status") == "connected" for s in st.get("mcpServers", [])):
                break
            await asyncio.sleep(0.5)
        else:
            raise RuntimeError("o conector do Metricool não conectou (confira em claude.ai > Conectores)")
        await cli.query(prompt)
        async for m in cli.receive_response():
            if isinstance(m, AssistantMessage):
                for b in m.content:
                    if isinstance(b, ToolUseBlock) and DEBUG:
                        print("  ->", b.name, json.dumps(b.input)[:160])
                    if isinstance(b, ToolUseBlock) and b.name.endswith(LEITURA):
                        pedidos[b.id] = b.input
            elif isinstance(m, UserMessage) and isinstance(m.content, list):
                for b in m.content:
                    if isinstance(b, ToolResultBlock) and b.tool_use_id in pedidos:
                        texto = b.content if isinstance(b.content, str) else "".join(
                            x.get("text", "") for x in (b.content or []) if isinstance(x, dict))
                        if DEBUG:
                            print("  <-", len(texto), repr(texto[:160]))
                        try:
                            resultados.append((pedidos[b.tool_use_id], json.loads(texto)))
                        except json.JSONDecodeError:
                            pass
            elif isinstance(m, ResultMessage):
                final = m.result or ""
    return resultados, final


async def sincronizar(dias_atras: int = 60, dias_frente: int = 45, com_perfil: bool = True) -> dict:
    if _rodando.locked():
        return {"status": "ja_rodando"}
    async with _rodando:
        agora = datetime.now()
        de = (agora - timedelta(days=dias_atras)).strftime("%Y-%m-%dT00:00:00-03:00")
        ate = agora.strftime("%Y-%m-%dT%H:%M:%S-03:00")
        futuro = (agora + timedelta(days=dias_frente)).strftime("%Y-%m-%dT23:59:59-03:00")
        chamadas = [("getAnalyticsDataByMetrics", {"brandId": BRAND, "from": de, "to": ate, "metrics": m})
                    for m in (REELS, POSTS, TIKTOK, YOUTUBE)]
        chamadas.append(("getScheduledPosts", {"brandId": BRAND, "fromDate": ate, "toDate": futuro, "timezone": TZ}))
        brutos, final = await chamar(chamadas)
        resultados = [(CONSULTAS.get(((e.get("metrics") or [""])[0])[:4]) if "metrics" in e else None, r) for e, r in brutos]
        if not resultados:
            raise RuntimeError(f"o Metricool não respondeu: {final[:200]}")
        with httpx.Client(follow_redirects=True) as http:
            registros = await asyncio.to_thread(_converter, resultados, http)
        _gravar(registros)
        det = {"status": "ok", "posts": len(registros), "chamadas": len(resultados)}
        if com_perfil:  # o Metricool atrasa o Instagram: completa com o próprio perfil, pelo Chrome
            try:
                det["perfil"] = await _do_perfil()
            except Exception as e:
                det["perfil_erro"] = f"{type(e).__name__}: {e}"[:200]
        return det


async def _do_perfil() -> dict:
    from .coletores import instagram
    with db.conexao() as c:
        ig = {r["id"]: r for r in c.execute("select id, metricas, thumb from posts where rede='instagram'").fetchall()}
    # "conhecido" = já tem legenda e miniatura; os outros têm a página do Reel lida de novo
    conhecidos = [u.rstrip("/").split("/")[-1] for u, r in ig.items() if r["thumb"]]
    itens = await instagram.coletar(conhecidos)
    novos, atualizados = [], 0
    with httpx.Client(follow_redirects=True) as http:
        for i in itens:
            fresco = {k: i[k] for k in ("views", "curtidas", "comentarios") if i.get(k) is not None}
            if i["url"] in ig:  # já veio do Metricool: só os números, que na grade são mais recentes
                m = json.loads(ig[i["url"]]["metricas"] or "{}")
                m.update({k: max(v, m.get(k) or 0) for k, v in fresco.items()})
                thumb = None if ig[i["url"]]["thumb"] else await asyncio.to_thread(_baixa_thumb, http, i["url"], i.get("capa"))
                with db.conexao() as c:
                    c.execute("update posts set metricas=?, thumb=coalesce(thumb, ?), atualizado_em=?, legenda=coalesce(legenda, ?) where id=?",
                              (json.dumps(m), thumb, time.time(), i.get("legenda"), i["url"]))
                atualizados += 1
            else:
                novos.append({"id": i["url"], "rede": "instagram", "quando": i["quando"], "estado": "publicado", "tipo": "Reel",
                              "legenda": i.get("legenda"), "url": i["url"],
                              "thumb": await asyncio.to_thread(_baixa_thumb, http, i["url"], i.get("capa")),
                              "metricas": fresco | {"fonte": "perfil"}})
    if novos:
        _gravar(novos)
    return {"novos": len(novos), "atualizados": atualizados}


def listar(de: str, ate: str) -> list[dict]:
    with db.conexao() as c:
        linhas = c.execute("select * from posts where quando >= ? and quando < ? order by quando", (de, ate)).fetchall()
    return [dict(l) | {"metricas": json.loads(l["metricas"] or "{}"), "redes": json.loads(l["redes"] or "[]")} for l in linhas]


if __name__ == "__main__":  # uv run python -m jarvis.metricool
    from . import auth
    auth.preparar()
    db.iniciar()
    print(asyncio.run(sincronizar()))
