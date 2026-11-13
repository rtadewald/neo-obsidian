"""MP4 dos vídeos do X, para tocarem no card.

O feed lido pelo Chrome só tem a capa (o player do X usa blob/HLS). O FxTwitter (api.fxtwitter.com, público,
sem login) devolve os MP4 de cada post. Escolhemos a variante de ~1 Mbps e guardamos em metricas.video.
"""
import json

import httpx

from . import db

API = "https://api.fxtwitter.com/status/{}"


def _melhor(media: dict) -> dict | None:
    for v in media.get("videos") or (media.get("all") or []):
        if v.get("type") not in ("video", "gif"):
            continue
        mp4 = [f for f in v.get("formats") or v.get("variants") or [] if f.get("container") == "mp4" or
               str(f.get("content_type", "")).endswith("mp4")]
        mp4.sort(key=lambda f: f.get("bitrate") or 0)
        alvo = next((f for f in mp4 if (f.get("bitrate") or 0) >= 800_000), mp4[-1] if mp4 else None)
        url = (alvo or {}).get("url") or v.get("url")
        if url:
            return {"url": url, "w": v.get("width"), "h": v.get("height"), "dur": v.get("duration"),
                    "gif": v.get("type") == "gif"}
    return None


def video(id_sinal: int) -> dict | None:
    s = db.sinal(id_sinal)
    if not s or s["fonte"] != "x" or not s["url"]:
        return None
    m = json.loads(s["metricas"] or "{}")
    if "video" in m:  # já buscado (pode ser None: post sem vídeo)
        return m["video"]
    tweet = s["url"].rstrip("/").split("/")[-1]
    try:
        r = httpx.get(API.format(tweet), timeout=12, headers={"User-Agent": "jarvis-conteudo/0.1"})
        r.raise_for_status()
        info = _melhor((r.json().get("tweet") or {}).get("media") or {})
    except Exception:
        return None  # não guarda: tenta de novo na próxima vez
    m["video"] = info
    with db.conexao() as c:
        c.execute("update sinais set metricas=? where id=?", (json.dumps(m), id_sinal))
    return info
