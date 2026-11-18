"""Coletor do Instagram: Reels de terceiros que estão performando bem, pela conta própria do radar (teste.asimov),
logada no perfil "Claude Profile" do Chrome (o mesmo do X), pela extensão Claude in Chrome.

Duas fontes por coleta:
1. os perfis que a conta acompanha (`app/dados/instagram_perfis.json`): a grade de Reels de cada um (link + views);
2. a página /reels/ da conta, onde o algoritmo sugere coisa nova (aprende com os likes espelhados do app).
Para cada Reel inédito, a página dele dá curtidas, comentários, data e legenda (meta og:description). O Haiku do radar
classifica depois; "fora do tema" não aparece na aba.

Só leitura: não curte, não segue, não comenta (o like vem da fila, em x_curtir). O resultado sai como download em
~/Downloads, como no X (o javascript_tool corta a saída e bloqueia query strings).
"""
import asyncio
import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

from ..config import CHROME_PERFIL, com_perfil, DADOS

PERFIS = DADOS / "instagram_perfis.json"
PERFIS_INICIAIS = ["mavgpt", "heysirio", "filatov.design", "marina_uiux", "nick_saraev"]
ALVO = 50          # os primeiros Reels do algoritmo (/reels/) com MIN_CURTIDAS+ (a rolagem segue até juntar ALVO + MARGEM)
# a fonte é o algoritmo: o Rodrigo treina a conta com 👍 no app (o like vai para o Instagram) e o feed melhora.
# Os perfis acompanhados (instagram_perfis.json) só entram se USAR_PERFIS = True.
USAR_PERFIS = False
POR_PERFIL = 3     # no máximo 3 Reels do mesmo autor por coleta (o higgsfield.ai enchia o lote)
MARGEM = 8         # folga para o que o filtro de português tira depois
MIN_CURTIDAS = 1000   # só Reels com 1k+ curtidas entram no radar (perfis e algoritmo)
ROLAGENS = 320       # teto de Reels do algoritmo rolados por coleta (para antes, ao juntar ALVO + MARGEM)
DIAS = 21          # da grade dos perfis, só os recentes (a grade começa pelos fixados, antigos)
DOWNLOADS = Path.home() / "Downloads"


def perfis() -> list[str]:
    try:
        return json.loads(PERFIS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        DADOS.mkdir(parents=True, exist_ok=True)
        PERFIS.write_text(json.dumps(PERFIS_INICIAIS, ensure_ascii=False, indent=1), encoding="utf-8")
        return list(PERFIS_INICIAIS)


# Na grade /<perfil>/reels/: guarda código, views e capa de cada Reel em localStorage (a coleta junta tudo no fim).
GRADE = r"""
(() => {
  const num = (s) => { const m = (s || '').replace(/ /g, ' ').match(/([\d.,]+)\s*(mil|mi|k|m)?/i); if (!m) return 0;
    let v = m[2] ? m[1].replace(',', '.') : m[1].replace(/[.,]/g, ''); let n = parseFloat(v) || 0;
    const s2 = (m[2] || '').toLowerCase(); if (s2 === 'mil' || s2 === 'k') n *= 1e3; if (s2 === 'mi' || s2 === 'm') n *= 1e6; return Math.round(n); };
  const perfil = location.pathname.split('/')[1];
  const ja = JSON.parse(localStorage.getItem('__jig') || '[]');
  let n = 0;
  for (const a of document.querySelectorAll('a[href*="/reel/"]')) {
    const code = (a.getAttribute('href').match(/\/reel\/([\w-]+)/) || [])[1];
    if (!code || ja.some((x) => x.code === code)) continue;
    const bg = a.querySelector('[style*="background-image"]');
    const capa = bg ? (bg.style.backgroundImage.match(/url\("?(.*?)"?\)/) || [])[1] : null;
    ja.push({ code, views: num(a.innerText), capa, perfil, origem: 'perfil' }); n++;
  }
  localStorage.setItem('__jig', JSON.stringify(ja));
  return 'GRADE ' + perfil + ' ' + n;
})()
"""

# Na /reels/: rola o feed do algoritmo juntando os códigos (o endereço muda a cada Reel), soma com a grade dos perfis,
# lê a página de cada Reel inédito (og:description: curtidas, comentários, data, legenda) e baixa o JSON.
EXTRAI = r"""
window.__jigDone = false;
(async () => {
  const conhecidos = new Set(__CONHECIDOS__);
  const META = __META__, MIN = __MIN__;   // para quando juntar META Reels com MIN+ curtidas
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const lista = JSON.parse(localStorage.getItem('__jig') || '[]');
  const num = (s) => { const m = (s || '').match(/([\d.,]+)\s*([KkMm])?/); if (!m) return 0;
    let n = parseFloat(m[2] ? m[1].replace(',', '.') : m[1].replace(/[.,]/g, '')) || 0;
    if (/k/i.test(m[2] || '')) n *= 1e3; if (/m/i.test(m[2] || '')) n *= 1e6; return Math.round(n); };
  const meta = (t, p) => { const m = t.match(new RegExp('<meta[^>]+(?:property|name)="' + p + '"[^>]+content="([^"]*)"')); if (!m) return '';
    const d = document.createElement('textarea'); d.innerHTML = m[1]; return d.value; };
  const saida = [], lidos = new Set();
  const bons = () => { const c = {}; return saida.filter((x) => x.curtidas >= MIN && (c[x.autor] = (c[x.autor] || 0) + 1) <= __POR__).length; };
  // lê a página de cada Reel (og:description: "183 likes, 155 comments - nick_saraev no November 15, 2026: "legenda…"")
  const avaliar = async (xs) => {
    await Promise.all(xs.map(async (x) => {
      lidos.add(x.code);
      try {
        const t = await (await fetch('/p/' + x.code + '/')).text();
        const og = meta(t, 'og:description');
        const m = og.match(/^([\d.,]+\s*[KkMm]?)\s+likes?,\s*([\d.,]+\s*[KkMm]?)\s+comments?\s+-\s+([\w.]+)\s+\S+\s+([A-Z][a-z]+ \d{1,2}, \d{4})\s*:\s*"?([\s\S]*?)"?\s*$/);
        if (!m) return;
        saida.push({ ...x, curtidas: num(m[1]), comentarios: num(m[2]), autor: m[3], data: m[4], legenda: m[5],
                     capa: x.capa || meta(t, 'og:image') || null });
      } catch (e) { /* um Reel que não abriu não derruba a coleta */ }
    }));
    window.__jigN = bons();
  };
  const pendentes = () => lista.filter((x) => !conhecidos.has(x.code) && !lidos.has(x.code));
  // 1) os Reels da grade dos perfis acompanhados
  for (let p = pendentes(); p.length; p = pendentes()) await avaliar(p.slice(0, 4));
  // 2) o feed do algoritmo: rola e avalia de 4 em 4 até juntar META bons (ou acabar as rolagens)
  const rolavel = [...document.querySelectorAll('main *')].find((e) => e.scrollHeight > e.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
  for (let i = 0; i < __ROLAGENS__ && rolavel && bons() < META; i++) {
    const code = (location.pathname.match(/\/reels?\/([\w-]+)/) || [])[1];
    if (code && !lista.some((x) => x.code === code)) lista.push({ code, views: 0, capa: null, perfil: null, origem: 'algoritmo' });
    const p = pendentes();
    if (p.length >= 4) await avaliar(p);
    rolavel.scrollBy(0, rolavel.clientHeight);
    await espera(1500);
  }
  await avaliar(pendentes());
  localStorage.removeItem('__jig');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(saida)], { type: 'application/json' }));
  a.download = '__ARQ__';
  document.body.appendChild(a); a.click(); a.remove();
  window.__jigCount = bons();
  window.__jigDone = true;
})();
'iniciado'
"""

LE = "window.__jigDone ? 'PRONTO ' + window.__jigCount : 'PENDENTE ' + (window.__jigN || 0)"

PASSO_PERFIS = """3. Para cada perfil abaixo, na ordem: navegue para https://www.instagram.com/<perfil>/reels/, espere 3 s e rode este
   script com javascript_tool, exatamente como está:
```js
__GRADE__
```
   Perfis: __PERFIS__
"""

PROMPT = """Você coleta Reels do Instagram para o Rodrigo, pela conta do radar. Só leitura: não curta, não siga, não
comente, não clique em nada além do que os scripts fazem.
0. Chame select_browser com deviceId "__PERFIL__" (o perfil "Claude Profile" do Chrome). Se não der, responda só "SEM_PERFIL".
1. Chame tabs_context_mcp com createIfEmpty: true e use a aba que ela devolver (não crie outra).
2. Navegue para https://www.instagram.com/ e espere 3 s (computer, action wait). Se a página pedir login, feche a aba
   e responda só "SEM_LOGIN". Depois rode com javascript_tool: `localStorage.removeItem('__jig'); 'ok'`
__PASSO_PERFIS__4. Navegue para https://www.instagram.com/reels/, espere 3 s e rode UMA vez com javascript_tool, exatamente como está:
```js
__EXTRAI__
```
5. Espere 10 s (computer, action wait) e rode com javascript_tool: `__LE__`
   Enquanto a resposta começar com "PENDENTE", repita o passo 5 (no máximo 70 vezes: a rolagem pode levar uns 10 minutos).
6. Feche a aba (tabs_close_mcp) e responda só "OK" se a última leitura começou com "PRONTO"; senão, "FALHOU: <motivo>".
"""


def _quando(data: str) -> datetime | None:
    try:
        return datetime.strptime(data, "%B %d, %Y").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# conteúdo brasileiro fica de fora do radar (o Rodrigo quer referência gringa): legenda em português é descartada
_PT = set("você vocês não está isso aqui então também porque muito mais pra para com uma umas uns como quando onde "
          "fazer faz tem têm ser sobre seu sua nosso nossa agora hoje link comenta comente salva salve segue siga "
          "aprender aprenda programação ferramenta ferramentas grátis vídeo vídeos inteligência artificial".split())
_EN = set("you your the this that with for and are is was what how when here now just free learn tool tools "
          "comment save follow video videos build code design using".split())


def _brasileiro(texto: str) -> bool:
    import re
    t = texto.lower()
    pal = re.findall(r"[a-zà-ú]+", t)
    pt = sum(p in _PT for p in pal) + 2 * len(re.findall(r"ção|ções|ões|ã[oe]?\b", t))
    en = sum(p in _EN for p in pal)
    return pt >= 3 and pt > en * 1.5


def _para_sinais(reels: list[dict]) -> list[dict]:
    agora, itens = datetime.now(timezone.utc), []
    for r in reels:
        q = _quando(r.get("data", ""))
        dias = (agora - q).total_seconds() / 86400 if q else 30
        if r.get("origem") == "perfil" and dias > DIAS:   # a grade começa pelos fixados, antigos
            continue
        eng = r["curtidas"] + 3 * r["comentarios"] + r.get("views", 0) / 40
        vel = eng / max(dias * 24, 6) ** 0.6
        texto = " ".join((r.get("legenda") or "").split()).rstrip('".').strip()
        if _brasileiro(texto) or r["curtidas"] < MIN_CURTIDAS:
            continue
        views = r.get("views") or 0
        itens.append({
            "fonte": "instagram", "externo": r["code"], "url": f"https://www.instagram.com/reel/{r['code']}/",
            "titulo": (texto[:140] + "…") if len(texto) > 140 else (texto or "(Reel sem legenda)"),
            "resumo": texto if len(texto) > 140 else "", "autor": r.get("autor") or r.get("perfil"),
            "imagem": r.get("capa"),
            "metricas": {"curtidas": r["curtidas"], "comentarios": r["comentarios"], "views": views, "texto": texto,
                         "midia": "video", "origem": r.get("origem"), "vel": round(vel, 1)},
            "destaque": " · ".join(x for x in [f"{views:,} views".replace(",", ".") if views else "",
                                               f"{r['curtidas']:,} curtidas".replace(",", ".")] if x),
            "publicado_em": q.isoformat() if q else None, "_vel": vel,
        })
    topo = math.log1p(max([i["_vel"] for i in itens] or [1])) or 1
    for i in itens:
        i["nota"] = round(100 * math.log1p(i.pop("_vel")) / topo, 1)
    # os perfis acompanhados primeiro (é o que importa); o algoritmo completa até ALVO (o Haiku tira o fora do tema)
    # no máximo POR_PERFIL do mesmo autor (os de nota maior); os perfis acompanhados primeiro, o algoritmo completa
    por_autor: dict[str, int] = {}
    escolhidos = []
    for i in sorted(itens, key=lambda i: -i["nota"]):
        a = (i["autor"] or "").lower()
        por_autor[a] = por_autor.get(a, 0) + 1
        if por_autor[a] <= POR_PERFIL:
            escolhidos.append(i)
    return sorted(escolhidos, key=lambda i: (i["metricas"]["origem"] != "perfil", -i["nota"]))[:ALVO]


async def coletar(conhecidos: list[str] | None = None) -> list[dict]:
    """`conhecidos`: códigos de Reels já coletados (não são lidos de novo)."""
    opts = ClaudeAgentOptions(
        model="sonnet", tools=[], setting_sources=[], max_turns=200, extra_args={"chrome": None},
        env={"ENABLE_TOOL_SEARCH": "false", "ENABLE_CLAUDEAI_MCP_SERVERS": "false"},
        allowed_tools=["mcp__claude-in-chrome__select_browser", "mcp__claude-in-chrome__tabs_context_mcp",
                       "mcp__claude-in-chrome__navigate", "mcp__claude-in-chrome__javascript_tool",
                       "mcp__claude-in-chrome__tabs_close_mcp", "mcp__claude-in-chrome__computer"],
        permission_mode="dontAsk",
    )
    arq = f"jarvis-ig-{uuid.uuid4().hex[:10]}.json"
    script = EXTRAI.replace("__ARQ__", arq).replace("__ROLAGENS__", str(ROLAGENS)).replace("__META__", str(ALVO + MARGEM)).replace("__MIN__", str(MIN_CURTIDAS)).replace("__POR__", str(POR_PERFIL)).replace("__CONHECIDOS__", json.dumps(sorted(set(conhecidos or []))))
    passo_perfis = (PASSO_PERFIS.replace("__GRADE__", GRADE).replace("__PERFIS__", ", ".join(perfis()))) if USAR_PERFIS else ""
    prompt = (PROMPT.replace("__PERFIL__", CHROME_PERFIL).replace("__GRADE__", GRADE).replace("__EXTRAI__", script)
              .replace("__LE__", LE).replace("__PASSO_PERFIS__", passo_perfis))
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
        raise RuntimeError("não achei o perfil Claude Profile do Chrome (tentei abrir o perfil, mas a extensão não conectou)")
    alvo = DOWNLOADS / arq
    for _ in range(30):
        if alvo.exists() and alvo.stat().st_size > 0:
            break
        await asyncio.sleep(0.5)
    else:
        raise RuntimeError(f"o arquivo da coleta não apareceu em Downloads. Agente: {final[:160]}")
    reels = json.loads(alvo.read_text())
    alvo.unlink()
    return _para_sinais(reels)


if __name__ == "__main__":  # teste: uv run python -m jarvis.coletores.instagram_radar
    from .. import auth
    auth.preparar()
    r = asyncio.run(coletar())
    print(len(r))
    for i in r[:10]:
        print(i["nota"], i["autor"], i["destaque"], "|", i["titulo"][:80])
