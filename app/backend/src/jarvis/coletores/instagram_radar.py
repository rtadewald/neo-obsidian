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

from ..config import CHROME_PERFIL, DADOS

PERFIS = DADOS / "instagram_perfis.json"
PERFIS_INICIAIS = ["mavgpt", "heysirio", "filatov.design", "marina_uiux", "nick_saraev"]
ALVO = 50          # Reels inéditos por coleta
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
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const lista = JSON.parse(localStorage.getItem('__jig') || '[]');
  const rolavel = [...document.querySelectorAll('main *')].find((e) => e.scrollHeight > e.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
  for (let i = 0; i < 45 && rolavel; i++) {
    const code = (location.pathname.match(/\/reels?\/([\w-]+)/) || [])[1];
    if (code && !lista.some((x) => x.code === code)) lista.push({ code, views: 0, capa: null, perfil: null, origem: 'algoritmo' });
    window.__jigN = lista.length;
    rolavel.scrollBy(0, rolavel.clientHeight);
    await espera(1600);
  }
  const num = (s) => { const m = (s || '').match(/([\d.,]+)\s*([KkMm])?/); if (!m) return 0;
    let n = parseFloat(m[2] ? m[1].replace(',', '.') : m[1].replace(/[.,]/g, '')) || 0;
    if (/k/i.test(m[2] || '')) n *= 1e3; if (/m/i.test(m[2] || '')) n *= 1e6; return Math.round(n); };
  const meta = (t, p) => { const m = t.match(new RegExp('<meta[^>]+(?:property|name)="' + p + '"[^>]+content="([^"]*)"')); if (!m) return '';
    const d = document.createElement('textarea'); d.innerHTML = m[1]; return d.value; };
  const novos = lista.filter((x) => !conhecidos.has(x.code));
  const saida = [];
  for (let i = 0; i < novos.length; i += 4) {
    await Promise.all(novos.slice(i, i + 4).map(async (x) => {
      try {
        const t = await (await fetch('/p/' + x.code + '/')).text();
        const og = meta(t, 'og:description');
        // "183 likes, 155 comments - nick_saraev no November 15, 2026: "legenda…""
        const m = og.match(/^([\d.,]+\s*[KkMm]?)\s+likes?,\s*([\d.,]+\s*[KkMm]?)\s+comments?\s+-\s+([\w.]+)\s+\S+\s+([A-Z][a-z]+ \d{1,2}, \d{4})\s*:\s*"?([\s\S]*?)"?\s*$/);
        if (!m) return;
        saida.push({ ...x, curtidas: num(m[1]), comentarios: num(m[2]), autor: m[3], data: m[4], legenda: m[5],
                     capa: x.capa || meta(t, 'og:image') || null });
      } catch (e) { /* um Reel que não abriu não derruba a coleta */ }
    }));
    window.__jigN = saida.length;
  }
  localStorage.removeItem('__jig');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(saida)], { type: 'application/json' }));
  a.download = '__ARQ__';
  document.body.appendChild(a); a.click(); a.remove();
  window.__jigCount = saida.length;
  window.__jigDone = true;
})();
'iniciado'
"""

LE = "window.__jigDone ? 'PRONTO ' + window.__jigCount : 'PENDENTE ' + (window.__jigN || 0)"

PROMPT = """Você coleta Reels do Instagram para o Rodrigo, pela conta do radar. Só leitura: não curta, não siga, não
comente, não clique em nada além do que os scripts fazem.
0. Chame select_browser com deviceId "__PERFIL__" (o perfil "Claude Profile" do Chrome). Se não der, responda só "SEM_PERFIL".
1. Chame tabs_context_mcp com createIfEmpty: true e use a aba que ela devolver (não crie outra).
2. Navegue para https://www.instagram.com/ e espere 3 s (computer, action wait). Se a página pedir login, feche a aba
   e responda só "SEM_LOGIN". Depois rode com javascript_tool: `localStorage.removeItem('__jig'); 'ok'`
3. Para cada perfil abaixo, na ordem: navegue para https://www.instagram.com/<perfil>/reels/, espere 3 s e rode este
   script com javascript_tool, exatamente como está:
```js
__GRADE__
```
   Perfis: __PERFIS__
4. Navegue para https://www.instagram.com/reels/, espere 3 s e rode UMA vez com javascript_tool, exatamente como está:
```js
__EXTRAI__
```
5. Espere 10 s (computer, action wait) e rode com javascript_tool: `__LE__`
   Enquanto a resposta começar com "PENDENTE", repita o passo 5 (no máximo 18 vezes).
6. Feche a aba (tabs_close_mcp) e responda só "OK" se a última leitura começou com "PRONTO"; senão, "FALHOU: <motivo>".
"""


def _quando(data: str) -> datetime | None:
    try:
        return datetime.strptime(data, "%B %d, %Y").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


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
    return sorted(itens, key=lambda i: (i["metricas"]["origem"] != "perfil", -i["nota"]))[:ALVO]


async def coletar(conhecidos: list[str] | None = None) -> list[dict]:
    """`conhecidos`: códigos de Reels já coletados (não são lidos de novo)."""
    opts = ClaudeAgentOptions(
        model="sonnet", tools=[], setting_sources=[], max_turns=60, extra_args={"chrome": None},
        env={"ENABLE_TOOL_SEARCH": "false", "ENABLE_CLAUDEAI_MCP_SERVERS": "false"},
        allowed_tools=["mcp__claude-in-chrome__select_browser", "mcp__claude-in-chrome__tabs_context_mcp",
                       "mcp__claude-in-chrome__navigate", "mcp__claude-in-chrome__javascript_tool",
                       "mcp__claude-in-chrome__tabs_close_mcp", "mcp__claude-in-chrome__computer"],
        permission_mode="dontAsk",
    )
    arq = f"jarvis-ig-{uuid.uuid4().hex[:10]}.json"
    script = EXTRAI.replace("__ARQ__", arq).replace("__CONHECIDOS__", json.dumps(sorted(set(conhecidos or []))))
    prompt = (PROMPT.replace("__PERFIL__", CHROME_PERFIL).replace("__GRADE__", GRADE).replace("__EXTRAI__", script)
              .replace("__LE__", LE).replace("__PERFIS__", ", ".join(perfis())))
    final = ""
    async for m in query(prompt=prompt, options=opts):
        if isinstance(m, ResultMessage):
            final = m.result or ""
    if "SEM_LOGIN" in final:
        raise RuntimeError("o Instagram pediu login no Chrome (perfil Claude Profile)")
    if "SEM_PERFIL" in final:
        raise RuntimeError("não achei o perfil Claude Profile do Chrome (a extensão está aberta nele?)")
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
