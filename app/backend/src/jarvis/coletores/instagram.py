"""Reels recentes do @rodrigotadewald lidos do próprio perfil, pelo Chrome do Rodrigo (Claude in Chrome).

Serve para o que o Metricool ainda não trouxe (ele atrasa o Instagram) e para números mais frescos.
Só leitura: abre /rodrigotadewald/reels/, lê a grade (views, curtidas, comentários, capa), busca a legenda dos Reels
que o banco ainda não tem e fecha a aba. A data sai do próprio código do Reel (o ID da mídia guarda o horário do upload).
Mesmo esquema do coletor do X: o JSON chega como download em ~/Downloads, porque a saída do javascript_tool é curta.
"""
import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

PERFIL = "rodrigotadewald"
DOWNLOADS = Path.home() / "Downloads"
BRT = timezone(timedelta(hours=-3))
ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

EXTRAI = r"""
window.__igDone = false;
(async () => {
  const num = (s) => { const m = (s || '').replace(/,/g, '').match(/([\d.]+)\s*([KkMm]|mil|mi)?/); if (!m) return null;
    let n = parseFloat(m[1]); const u = (m[2] || '').toLowerCase(); if (u === 'k' || u === 'mil') n *= 1e3; if (u === 'm' || u === 'mi') n *= 1e6; return Math.round(n); };
  for (let i = 0; i < 20 && document.querySelectorAll('a[href*="/reel/"]').length < 12; i++) await new Promise(r => setTimeout(r, 500));
  const conhecidos = new Set(__CONHECIDOS__);
  const itens = [];
  for (const a of [...document.querySelectorAll('a[href*="/reel/"]')].slice(0, 12)) {
    const cod = (new URL(a.href).pathname.match(/\/reel\/([\w-]+)/) || [])[1];
    if (!cod) continue;
    const textos = [...a.querySelectorAll('span')].map(s => s.textContent.trim()).filter(Boolean);
    const unicos = textos.filter((t, i) => textos.indexOf(t) === i && /^[\d.,]+\s*([KkMm]|mil|mi)?$/.test(t));
    const img = a.querySelector('img');
    const item = { cod, curtidas: num(unicos[0]), comentarios: num(unicos[1]), views: num(unicos[unicos.length - 1]),
      capa: img ? img.currentSrc || img.src : null, fixado: !!a.querySelector('svg[aria-label]') && /fixad|pinned/i.test(a.innerHTML) };
    if (!conhecidos.has(cod)) {  // legenda só dos que o banco ainda não tem
      try {
        const h = await fetch('/reel/' + cod + '/').then(r => r.text());
        const m = h.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/);
        if (m) item.legenda = new DOMParser().parseFromString(m[1], 'text/html').documentElement.textContent;
        const og = h.match(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/);
        if (og) item.capa = new DOMParser().parseFromString(og[1], 'text/html').documentElement.textContent;
      } catch (e) {}
    }
    itens.push(item);
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(itens)], { type: 'application/json' }));
  a.download = '__ARQ__'; document.body.appendChild(a); a.click(); a.remove();
  window.__igN = itens.length; window.__igDone = true;
})();
'iniciado'
"""
LE = "window.__igDone ? 'PRONTO ' + window.__igN : 'PENDENTE'"

PROMPT = """Você lê o perfil do Instagram do Rodrigo. Só leitura: não clique em nada, não curta, não comente, não siga.
1. Chame tabs_context_mcp com createIfEmpty: true e use a aba que ela devolver (não crie outra). Navegue nela para
   https://www.instagram.com/__PERFIL__/reels/
2. Espere 3 s (computer, action wait). Se a página pedir login, feche a aba e responda só "SEM_LOGIN".
3. Rode este script UMA vez com javascript_tool, exatamente como está:
```js
__EXTRAI__
```
4. Espere 5 s (computer, action wait) e rode com javascript_tool: `__LE__`
   Enquanto a resposta começar com "PENDENTE", repita o passo 4 (no máximo 8 vezes).
5. Feche a aba (tabs_close_mcp) e responda só "OK" se a última leitura começou com "PRONTO"; senão, "FALHOU: <motivo>".
"""


def quando(codigo: str) -> str:
    """Horário (Brasília) embutido no código do Reel: ID da mídia >> 23 = ms desde a época do Instagram."""
    n = 0
    for ch in codigo:
        n = n * 64 + ALFABETO.index(ch)
    ms = (n >> 23) + 1314220021721
    return datetime.fromtimestamp(ms / 1000, BRT).replace(tzinfo=None, microsecond=0).isoformat()


async def coletar(conhecidos: list[str]) -> list[dict]:
    arq = f"jarvis-ig-{uuid.uuid4().hex[:10]}.json"
    script = EXTRAI.replace("__CONHECIDOS__", json.dumps(conhecidos)).replace("__ARQ__", arq)
    prompt = PROMPT.replace("__PERFIL__", PERFIL).replace("__EXTRAI__", script).replace("__LE__", LE)
    opts = ClaudeAgentOptions(
        model="sonnet", tools=[], setting_sources=[], max_turns=24, extra_args={"chrome": None},
        env={"ENABLE_TOOL_SEARCH": "false", "ENABLE_CLAUDEAI_MCP_SERVERS": "false"},
        allowed_tools=["mcp__claude-in-chrome__tabs_context_mcp", "mcp__claude-in-chrome__navigate",
                       "mcp__claude-in-chrome__javascript_tool", "mcp__claude-in-chrome__tabs_close_mcp",
                       "mcp__claude-in-chrome__computer"],
        permission_mode="dontAsk",
    )
    final = ""
    async for m in query(prompt=prompt, options=opts):
        if isinstance(m, ResultMessage):
            final = m.result or ""
    if "SEM_LOGIN" in final:
        raise RuntimeError("o Instagram pediu login no Chrome")
    alvo = DOWNLOADS / arq
    for _ in range(30):
        if alvo.exists() and alvo.stat().st_size > 0:
            break
        await asyncio.sleep(0.5)
    else:
        raise RuntimeError(f"o arquivo da coleta não apareceu em Downloads. Agente: {final[:160]}")
    itens = json.loads(alvo.read_text())
    alvo.unlink()
    for i in itens:
        i["url"] = f"https://www.instagram.com/reel/{i['cod']}/"
        i["quando"] = quando(i["cod"])
    return itens
