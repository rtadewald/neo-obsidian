"""Instagram: os canais que o Rodrigo monitora e os Reels deles, com métricas relativas ao próprio canal.

- Canais (`dados/ig/canais.json`): cadastrados à mão (@ ou link do perfil).
- Coleta (`atualizar`, botão no app): um agente abre o Chrome logado na conta do radar (perfil "Claude Profile", o mesmo
  do X), e um script na página do Instagram lê, pela API interna do site, o perfil (nome, foto, seguidores) e os Reels
  recentes de cada canal (views, curtidas, comentários, data, legenda, capa, MP4). O JSON chega como download em
  ~/Downloads (a saída do javascript_tool é curta). Só leitura: não curte, não segue, não comenta.
- Depois o backend baixa só capas e fotos (`dados/ig/capas`, `dados/ig/fotos`): os links do Instagram expiram em
  horas. Os MP4 não são baixados: clicar no Reel abre ele no Instagram.
- Métricas: outlier = curtidas ÷ mediana das curtidas do canal (views podem ser pagas; curtidas ocultas ficam de fora); engajamento = (curtidas + comentários)
  ÷ views.
"""
import asyncio
import json
import re
import statistics
import threading
import time
import uuid
from pathlib import Path

import httpx
from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

from .config import CHROME_PERFIL, DADOS, com_perfil

PASTA = DADOS / "ig"
CANAIS = PASTA / "canais.json"
VIDEOS = PASTA / "videos.json"
CAPAS, MP4S, FOTOS = PASTA / "capas", PASTA / "videos", PASTA / "fotos"
DOWNLOADS = Path.home() / "Downloads"
POR_CANAL = 10          # os últimos N Reels de cada canal por coleta (os de antes ficam no videos.json)
MAX_DIAS = 30           # Reels mais antigos que isso não entram (nem os fixados antigos)
LOTE = 5                # perfis por agente: com muitos numa rodada só, o agente desiste depois dos primeiros
_trava = threading.Lock()
estado: dict = {"rodando": False, "etapa": "", "ultima": None, "erro": None}


def _ler(p: Path, padrao):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return padrao


def _gravar(p: Path, d):
    PASTA.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


def handle_de(txt: str) -> str:
    """'@cleoabram', 'https://www.instagram.com/cleoabram/' ou 'cleoabram' → 'cleoabram'."""
    t = txt.strip()
    m = re.search(r"instagram\.com/([A-Za-z0-9._]+)", t)
    h = (m.group(1) if m else t).lstrip("@").strip("/ ").lower()
    if not re.fullmatch(r"[a-z0-9._]{1,30}", h) or h in ("reel", "reels", "p", "explore", "stories"):
        raise ValueError(f"não reconheci o perfil: {txt}")
    return h


# ---------- canais ----------

def canais() -> list[dict]:
    """Os canais com as contagens: reels coletados e a mediana das curtidas (a base do outlier)."""
    vs = _ler(VIDEOS, {})
    out = []
    for c in _ler(CANAIS, []):
        meus = [v for v in vs.values() if v["handle"] == c["handle"]]
        curt = [n for v in meus if (n := _curtidas(v))]
        out.append({**c, "reels": len(meus), "mediana": int(statistics.median(curt)) if curt else 0,
                    "foto": f"/api/ig/arquivo/fotos/{c['handle']}.jpg" if (FOTOS / f"{c['handle']}.jpg").is_file() else None})
    return sorted(out, key=lambda c: -(c.get("seguidores") or 0))


def adicionar(txt: str) -> list[str]:
    """Um ou vários perfis (separados por vírgula, espaço ou linha). Devolve os handles novos."""
    with _trava:
        lista = _ler(CANAIS, [])
        tem = {c["handle"] for c in lista}
        novos = []
        for parte in re.split(r"[\s,;]+", txt.strip()):
            if not parte:
                continue
            h = handle_de(parte)
            if h not in tem:
                lista.append({"handle": h, "nome": "", "seguidores": 0, "adicionado": time.time(), "coletado": None})
                tem.add(h)
                novos.append(h)
        _gravar(CANAIS, lista)
    return novos


def remover(handle: str):
    """Tira o canal e apaga os reels dele (capas e MP4 também)."""
    with _trava:
        _gravar(CANAIS, [c for c in _ler(CANAIS, []) if c["handle"] != handle])
        vs = _ler(VIDEOS, {})
        for code in [k for k, v in vs.items() if v["handle"] == handle]:
            for p in (CAPAS / f"{code}.jpg", MP4S / f"{code}.mp4"):
                p.unlink(missing_ok=True)
            del vs[code]
        _gravar(VIDEOS, vs)
        (FOTOS / f"{handle}.jpg").unlink(missing_ok=True)


# ---------- vídeos e métricas ----------

def _curtidas(v: dict) -> int | None:
    """Curtidas confiáveis do reel, ou None quando o dono escondeu (o Instagram devolve um número fixo e baixo, ex. 3)."""
    c = v.get("curtidas") or 0
    if v.get("ocultas") or (c <= 5 and (v.get("views") or 0) >= 10000):
        return None
    return c


def videos() -> list[dict]:
    """Todos os reels coletados, com outlier (curtidas ÷ mediana das curtidas do canal: views podem vir de tráfego
    pago, curtidas não) e engajamento."""
    vs = list(_ler(VIDEOS, {}).values())
    medianas: dict[str, float] = {}
    for h in {v["handle"] for v in vs}:
        curt = [n for v in vs if v["handle"] == h and (n := _curtidas(v))]
        medianas[h] = statistics.median(curt) if curt else 0
    out = []
    for v in vs:
        m = medianas.get(v["handle"]) or 0
        views = v.get("views") or 0
        c = _curtidas(v)
        out.append({**v, "ocultas": c is None, "outlier": round(c / m, 2) if m and c is not None else None,
                    "engajamento": round((v.get("curtidas", 0) + v.get("comentarios", 0)) / views, 4) if views else None,
                    "capa": f"/api/ig/arquivo/capas/{v['code']}.jpg" if (CAPAS / f"{v['code']}.jpg").is_file() else None,
                    "url": f"https://www.instagram.com/reel/{v['code']}/"})
    return sorted(out, key=lambda v: -(v.get("data") or 0))


def arquivo(tipo: str, nome: str) -> Path | None:
    base = {"capas": CAPAS, "videos": MP4S, "fotos": FOTOS}.get(tipo)
    if not base or "/" in nome or nome.startswith("."):
        return None
    p = base / nome
    return p if p.is_file() else None


# ---------- coleta ----------

# Na grade /<canal>/reels/ (página logada): o script lê o canal pelo endereço. Intercepta as respostas que a própria
# página busca (a grade traz views, curtidas, comentários e capa; abrir um reel traz legenda, data e o MP4), abre os
# reels um a um na própria página (clique na grade, history.back para voltar) e baixa um JSON por canal.
SCRIPT = r"""
window.__igcDone = false; window.__igcN = 0;
(async () => {
  const H = location.pathname.split('/')[1], POR = __POR__;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const cap = [];
  const guarda = (t) => { if (t && (t.includes('play_count') || t.includes('video_versions'))) cap.push(t) };
  const of = window.fetch;
  window.fetch = async (...a) => { const r = await of(...a); try { r.clone().text().then(guarda) } catch (e) {} return r };
  const os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) { this.addEventListener('load', () => { try { guarda(this.responseText) } catch (e) {} }); return os.apply(this, a) };
  const achar = (o, out) => { if (o && typeof o === 'object') { if (o.code && ('play_count' in o || o.video_versions)) out.push(o); for (const k in o) achar(o[k], out) } return out };
  const itens = () => { const out = []; for (const t of cap) { try { achar(JSON.parse(t), out) } catch (e) { for (const l of t.split('\n')) { try { achar(JSON.parse(l), out) } catch (e2) {} } } } return out };
  const melhor = (cs) => (cs || []).slice().sort((a, b) => (b.width || b.height || 0) - (a.width || a.height || 0))[0];
  const num = (s) => { const m = (s || '').replace(/ /g, ' ').match(/([\d.,]+)\s*(mil|mi|k|m)?/i); if (!m) return 0;
    let v = m[2] ? m[1].replace(',', '.') : m[1].replace(/[.,]/g, ''); let n = parseFloat(v) || 0;
    const s2 = (m[2] || '').toLowerCase(); if (s2 === 'mil' || s2 === 'k') n *= 1e3; if (s2 === 'mi' || s2 === 'm') n *= 1e6; return Math.round(n) };
  const meta = (t, p) => { const m = t.match(new RegExp('<meta[^>]+(?:property|name)="' + p + '"[^>]+content="([^"]*)"')); if (!m) return '';
    const d = document.createElement('textarea'); d.innerHTML = m[1]; return d.value };
  const saida = { handle: H, perfil: {}, reels: [], erro: null };
  try {
    const prof = await (await of('/' + H + '/')).text();
    const desc = meta(prof, 'og:description'), tit = meta(prof, 'og:title');
    saida.perfil = { seguidores: num(desc), nome: (tit.match(/^(.*?)\s*\(@/) || [])[1] || '', foto: meta(prof, 'og:image') };
    for (let i = 0; i < 30 && !document.querySelector('a[href*="/reel/"]'); i++) await espera(500);
    // rola a grade até ter POR reels (as páginas novas chegam pela interceptação, com as métricas)
    for (let i = 0; i < 8 && document.querySelectorAll('a[href*="/reel/"]').length < POR; i++) { window.scrollBy(0, 2500); await espera(1500) }
    window.scrollTo(0, 0); await espera(800);
    const codes = [...new Set([...document.querySelectorAll('a[href*="/reel/"]')].map((a) => (a.getAttribute('href').match(/\/reel\/([\w-]+)/) || [])[1]).filter(Boolean))].slice(0, POR);
    const grade = {};
    for (const a of document.querySelectorAll('a[href*="/reel/"]')) {
      const c = (a.getAttribute('href').match(/\/reel\/([\w-]+)/) || [])[1]; if (!c || grade[c]) continue;
      const bg = a.querySelector('[style*="background-image"]');
      grade[c] = { views: num(a.innerText), capa: bg ? (bg.style.backgroundImage.match(/url\("?(.*?)"?\)/) || [])[1] : null };
    }
    for (const c of codes) {
      const a = document.querySelector('a[href*="/reel/' + c + '"]');
      let det = null;
      if (a) {
        a.click();
        for (let i = 0; i < 12 && !det; i++) { await espera(400); det = itens().find((x) => x.code === c && x.video_versions) }
        history.back(); await espera(1100);
      }
      const g = itens().find((x) => x.code === c && 'play_count' in x) || {};
      const d = det || {};
      const img = melhor((d.image_versions2 || g.image_versions2 || {}).candidates), vid = melhor(d.video_versions);
      saida.reels.push({ code: c, data: d.taken_at || g.taken_at || null, views: g.play_count || d.play_count || (grade[c] || {}).views || 0,
        curtidas: g.like_count || d.like_count || 0, comentarios: g.comment_count || d.comment_count || 0, duracao: d.video_duration || null,
        legenda: (d.caption && d.caption.text) || '', capa: (img && img.url) || (grade[c] || {}).capa || null, mp4: vid && vid.url,
        fixado: !!((g.clips_tab_pinned_user_ids || d.clips_tab_pinned_user_ids || []).length),
        ocultas: !!(g.like_and_view_counts_disabled || d.like_and_view_counts_disabled) });
      window.__igcN = saida.reels.length;
    }
  } catch (e) { saida.erro = String(e).slice(0, 160) }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(saida)], { type: 'application/json' }));
  a.download = '__PREFIXO__-' + H + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  window.__igcDone = true;
})();
'iniciado'
"""

# espera até 25 s dentro da própria leitura (menos voltas do agente)
LE = ("await (async () => { for (let i = 0; i < 25 && !window.__igcDone; i++) await new Promise((r) => setTimeout(r, 1000)); "
      "return window.__igcDone ? 'PRONTO' : 'PENDENTE ' + (window.__igcN || 0) })()")

PROMPT = """Você coleta dados públicos de perfis do Instagram para o Rodrigo, pela conta do radar. Só leitura: não curta,
não siga, não comente, não clique em nada (o script faz o que precisa).
0. Chame select_browser com deviceId "__PERFIL__" (o perfil "Claude Profile" do Chrome). Se não der, responda só "SEM_PERFIL".
1. Chame tabs_context_mcp com createIfEmpty: true e use a aba que ela devolver (não crie outra).
2. Navegue para https://www.instagram.com/ e espere 3 s (computer, action wait). Se a página pedir login, feche a aba e
   responda só "SEM_LOGIN".
3. Para cada perfil da lista, na ordem: navegue para https://www.instagram.com/<perfil>/reels/, espere 3 s e rode UMA vez
   com javascript_tool, exatamente como está:
```js
__SCRIPT__
```
   Depois rode com javascript_tool `__LE__` e repita enquanto a resposta começar com "PENDENTE" (no máximo 12 vezes).
   Perfis: __HANDLES__
4. Feche a aba (tabs_close_mcp) e responda só "OK" (ou "FALHOU: <motivo>" se nada funcionou).
"""


async def _coletar(handles: list[str]) -> list[dict]:
    opts = ClaudeAgentOptions(
        model="sonnet", tools=[], setting_sources=[], max_turns=40 + 30 * len(handles), extra_args={"chrome": None},
        env={"ENABLE_TOOL_SEARCH": "false", "ENABLE_CLAUDEAI_MCP_SERVERS": "false"},
        allowed_tools=["mcp__claude-in-chrome__select_browser", "mcp__claude-in-chrome__tabs_context_mcp",
                       "mcp__claude-in-chrome__navigate", "mcp__claude-in-chrome__javascript_tool",
                       "mcp__claude-in-chrome__tabs_close_mcp", "mcp__claude-in-chrome__computer"],
        permission_mode="dontAsk",
    )
    prefixo = f"neo-igc-{uuid.uuid4().hex[:8]}"
    script = SCRIPT.replace("__POR__", str(POR_CANAL)).replace("__PREFIXO__", prefixo)
    prompt = (PROMPT.replace("__PERFIL__", CHROME_PERFIL).replace("__SCRIPT__", script).replace("__LE__", LE)
              .replace("__HANDLES__", ", ".join(handles)))

    async def _uma() -> str:
        final = ""
        async for m in query(prompt=prompt, options=opts):
            if isinstance(m, ResultMessage):
                final = m.result or ""
        return final

    final = await com_perfil(_uma)
    if "SEM_LOGIN" in final:
        raise RuntimeError("o Instagram pediu login no Chrome (perfil Claude Profile)")
    if "SEM_PERFIL" in final:
        raise RuntimeError("não achei o perfil Claude Profile do Chrome")
    await asyncio.sleep(2)
    dados = []
    for h in handles:
        alvo = DOWNLOADS / f"{prefixo}-{h}.json"
        if alvo.is_file():
            try:
                dados.append(json.loads(alvo.read_text()))
            except ValueError:
                dados.append({"handle": h, "erro": "JSON da coleta ilegível"})
            alvo.unlink()
        else:
            dados.append({"handle": h, "erro": "o canal não foi coletado nesta rodada"})
    if all(d.get("erro") for d in dados):
        raise RuntimeError(f"nenhum canal coletado. Agente: {final[:160]}")
    return dados


async def _baixar(cli: httpx.AsyncClient, url: str | None, destino: Path) -> bool:
    if not url or destino.is_file():
        return destino.is_file()
    try:
        r = await cli.get(url, timeout=60)
        if r.status_code != 200 or not r.content:
            return False
        destino.parent.mkdir(parents=True, exist_ok=True)
        tmp = destino.with_suffix(destino.suffix + ".tmp")
        tmp.write_bytes(r.content)
        tmp.replace(destino)
        return True
    except httpx.HTTPError:
        return False


async def _salvar(dados: list[dict]) -> None:
    """Grava as métricas de um lote (canais.json e videos.json acumulam) e baixa as fotos e capas dele."""
    agora = time.time()
    with _trava:
        lista = _ler(CANAIS, [])
        vs = _ler(VIDEOS, {})
        por_h = {c["handle"]: c for c in lista}
        novos: dict[str, str] = {}   # code -> capa (só as deste lote)
        fotos: dict[str, str] = {}
        for d in dados:
            c = por_h.get(d["handle"])
            if not c:
                continue
            if d.get("erro"):
                c["erro"] = d["erro"]
                continue
            p = d.get("perfil") or {}
            c.update(nome=p.get("nome") or c.get("nome", ""), seguidores=p.get("seguidores") or c.get("seguidores", 0),
                     coletado=agora, erro=None)
            if p.get("foto"):
                fotos[d["handle"]] = p["foto"]
            for r in d.get("reels", []):
                if r.get("data") and r["data"] < agora - MAX_DIAS * 86400:
                    continue
                antigo = vs.get(r["code"], {})
                vs[r["code"]] = {**antigo, "code": r["code"], "handle": d["handle"], "data": r.get("data"),
                                 "views": r.get("views") or antigo.get("views", 0), "curtidas": r.get("curtidas", 0),
                                 "comentarios": r.get("comentarios", 0), "duracao": r.get("duracao"),
                                 "legenda": r.get("legenda", ""), "fixado": r.get("fixado", False), "ocultas": r.get("ocultas", False),
                                 "coletado": agora}
                if r.get("capa"):
                    novos[r["code"]] = r["capa"]
        _gravar(CANAIS, lista)
        _gravar(VIDEOS, vs)
    # downloads (fora da trava): fotos e capas, 4 de cada vez (os MP4 não: o Reel abre no Instagram)
    sem = asyncio.Semaphore(4)
    async with httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as cli:
        async def um(url, destino):
            async with sem:
                await _baixar(cli, url, destino)
        await asyncio.gather(*[um(u, FOTOS / f"{h}.jpg") for h, u in fotos.items()],
                             *[um(u, CAPAS / f"{k}.jpg") for k, u in novos.items()])


async def atualizar(so: list[str] | None = None) -> dict:
    """Coleta os canais (todos, ou só `so`) em lotes; cada lote já grava as métricas e baixa capas e fotos
    (parar no meio não perde o que foi coletado)."""
    if estado["rodando"]:
        return {"status": "já rodando"}
    estado.update(rodando=True, etapa="abrindo o Instagram no Chrome", erro=None)
    try:
        lista = _ler(CANAIS, [])
        handles = [c["handle"] for c in lista if not so or c["handle"] in so]
        if not handles:
            return {"status": "sem canais"}
        dados = []
        for i in range(0, len(handles), LOTE):
            lote = handles[i:i + LOTE]
            estado["etapa"] = f"coletando {i + 1}–{i + len(lote)} de {len(handles)}" if len(handles) > LOTE else "abrindo o Instagram no Chrome"
            try:
                d = await _coletar(lote)
            except RuntimeError as e:
                if "pediu login" in str(e) or "não achei o perfil" in str(e) or "permissão" in str(e):   # sem como seguir: para tudo
                    raise
                d = [{"handle": h, "erro": str(e)[:160]} for h in lote]   # um lote ruim não derruba os outros
            await _salvar(d)
            dados += d
        if all(d.get("erro") for d in dados):
            raise RuntimeError("nenhum canal coletado")
        estado["ultima"] = time.time()
        return {"status": "ok", "canais": len(dados), "reels": sum(len(d.get("reels", [])) for d in dados)}
    except Exception as e:  # noqa: BLE001
        estado["erro"] = f"{type(e).__name__}: {e}"[:300]
        raise
    finally:
        estado.update(rodando=False, etapa="")
