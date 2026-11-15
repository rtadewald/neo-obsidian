"""Coletor do X (Q27): lê o feed "Para você" no perfil "Claude Profile" do Chrome (já logado), pela extensão Claude in Chrome.
Cada coleta traz só posts inéditos (pula os ids já vistos), e a página do X mostra só o último lote.

Só leitura: abre uma aba nova no grupo do Jarvis, rola o feed com um script que extrai os posts do DOM e fecha a aba.
Não curte, não reposta, não segue, não clica em nada. O resultado vem direto do retorno do javascript_tool,
sem o modelo reescrever os posts.
"""
import asyncio
import json
import math
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..config import CHROME_PERFIL
from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, ResultMessage, ToolResultBlock, ToolUseBlock, UserMessage, query

ALVO = 50
DOWNLOADS = Path.home() / "Downloads"
DEBUG = bool(__import__('os').environ.get('JARVIS_DEBUG'))

# Dispara a rolagem em segundo plano (o javascript_tool não espera Promises) e guarda os posts em window.__jx.
EXTRAI = r"""
window.__jxDone = false; window.__jx = '[]';
(async () => {
  const num = (s) => {
    if (!s) return 0;
    const m = s.replace(/ /g, ' ').match(/([\d.,]+)\s*(mil|mi|k|m|b)?/i);
    if (!m) return 0;
    let v = m[1];
    const suf = (m[2] || '').toLowerCase();
    if (suf) v = v.replace(',', '.'); else v = v.replace(/[.,]/g, '');
    let n = parseFloat(v) || 0;
    if (suf === 'k' || suf === 'mil') n *= 1e3;
    if (suf === 'm' || suf === 'mi') n *= 1e6;
    if (suf === 'b') n *= 1e9;
    return Math.round(n);
  };
  // a extensão bloqueia retornos com query string: imagens viram caminho + extensão, e o texto perde "?a=b"
  const semQuery = (src) => { if (!src) return null; try { const u = new URL(src, location.href); const f = u.searchParams.get('format'); return /^https?:/.test(u.protocol) ? u.origin + u.pathname + (f ? '.' + f : '') : null; } catch { return null; } };
  const lab = (a, id) => { const b = a.querySelector(`[data-testid="${id}"]`); return num(b && (b.getAttribute('aria-label') || b.textContent)); };
  // já vistos em coletas anteriores (últimos 9 dígitos do id): pula, para trazer só posts inéditos
  const conhecidos = new Set(__CONHECIDOS__);
  const vistos = new Map();
  for (let volta = 0; volta < 48 && vistos.size < __ALVO__ + 6; volta++) {
    window.__jxN = vistos.size;
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      const t = a.querySelector('time');
      const link = t && t.closest('a');
      if (!link) continue;
      const url = location.origin + new URL(link.href).pathname;
      if (vistos.has(url)) continue;
      const sid = (url.match(/status\/(\d+)/) || [])[1] || '';
      if (conhecidos.has(sid.slice(-9))) continue;
      const nome = a.querySelector('[data-testid="User-Name"]');
      const handle = (nome && [...nome.querySelectorAll('span')].map(s => s.textContent).find(s => s.startsWith('@'))) || '';
      const views = a.querySelector('a[href$="/analytics"]');
      const promo = [...a.querySelectorAll('span')].some(s => /^(Ad|Anúncio|Promovido|Promoted)$/.test(s.textContent.trim()));
      // mídia do próprio post (não a do post citado): foto, vídeo/GIF (poster) ou a imagem da prévia de link
      const vid = a.querySelector('[data-testid="videoComponent"] video, [data-testid="videoPlayer"] video, video');
      const foto = a.querySelector('[data-testid="tweetPhoto"] img:not([alt=""])') || a.querySelector('[data-testid="tweetPhoto"] img');
      const card = a.querySelector('[data-testid^="card.layout"] img');
      const fotos = a.querySelectorAll('[data-testid="tweetPhoto"]').length;
      const srcImg = vid ? (vid.getAttribute('poster') || (a.querySelector('[data-testid="videoPlayer"] img') || {}).src)
                         : foto ? foto.getAttribute('src') : card ? card.getAttribute('src') : null;
      vistos.set(url, {
        url, handle, autor: nome ? nome.innerText.split('\n')[0] : '',
        texto: ((a.querySelector('[data-testid="tweetText"]') || {}).innerText || '').replace(/\S*[=&]\S*/g, '').replace(/\s+/g, ' ').trim(),
        quando: t.getAttribute('datetime'),
        respostas: lab(a, 'reply'), reposts: lab(a, 'retweet'), curtidas: lab(a, 'like'), salvos: lab(a, 'bookmark'),
        views: num(views && views.getAttribute('aria-label')),
        imagem: semQuery(srcImg),
        midia: vid ? 'video' : foto ? (fotos > 1 ? 'fotos' : 'foto') : card ? 'link' : null,
        promo,
      });
    }
    window.scrollBy(0, Math.round(innerHeight * 0.9));
    await new Promise(r => setTimeout(r, 1300));
  }
  const lista = [...vistos.values()].filter(p => !p.promo).slice(0, __ALVO__);
  // a saída do javascript_tool é cortada em ~1 mil caracteres: o JSON vai para um arquivo em Downloads
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(lista)], { type: 'application/json' }));
  a.download = '__ARQ__';
  document.body.appendChild(a); a.click(); a.remove();
  window.__jxCount = lista.length;
  window.__jxDone = true;
})();
'iniciado'
"""

LE = "window.__jxDone ? 'PRONTO ' + window.__jxCount : 'PENDENTE ' + (window.__jxN || 0)"

PROMPT = """Você coleta o feed do X para o Rodrigo. Só leitura: não clique em nada, não curta, não reposte, não siga.
0. Chame select_browser com deviceId "__PERFIL__" (o perfil "Claude Profile" do Chrome). Se não der, responda só "SEM_PERFIL".
1. Chame tabs_context_mcp com createIfEmpty: true e use a aba que ela devolver (não crie outra). Navegue nela para
   https://x.com/home (feed "Para você").
2. Espere 3 s (computer, action wait). Se a página pedir login, feche a aba e responda só "SEM_LOGIN".
3. Rode este script UMA vez com javascript_tool, exatamente como está (ele começa a rolar o feed sozinho):
```js
__EXTRAI__
```
4. Espere 10 s (computer, action wait) e rode com javascript_tool: `__LE__`
   Enquanto a resposta começar com "PENDENTE", repita o passo 4 (no máximo 10 vezes).
5. Feche a aba (tabs_close_mcp) e responda só "OK" se a última leitura começou com "PRONTO"; senão, "FALHOU: <motivo>".
"""


def _horas(iso: str | None) -> float:
    if not iso:
        return 24.0
    try:
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return max((datetime.now(timezone.utc) - t).total_seconds() / 3600, 0.25)
    except ValueError:
        return 24.0


def _texto_resultado(b: ToolResultBlock) -> str:
    c = b.content
    if isinstance(c, str):
        return c
    return "".join(x.get("text", "") for x in (c or []) if isinstance(x, dict))


def _para_sinais(posts: list[dict]) -> list[dict]:
    itens = []
    for p in posts:
        m = re.search(r"/status/(\d+)", p["url"])
        if not m:
            continue
        eng = p["curtidas"] + 2 * p["reposts"] + p["respostas"] + p["salvos"]
        vel = eng / _horas(p.get("quando")) ** 0.6       # engajamento por hora, com o tempo pesando menos que linear
        texto = " ".join(p["texto"].split())
        itens.append({
            "fonte": "x", "externo": m.group(1), "url": p["url"],
            "titulo": (texto[:140] + "…") if len(texto) > 140 else (texto or "(post sem texto)"),
            "resumo": texto if len(texto) > 140 else "",
            "autor": p.get("handle") or p.get("autor"), "imagem": p.get("imagem"),
            "metricas": {k: p[k] for k in ("curtidas", "reposts", "respostas", "salvos", "views")}
                        | {"vel": round(vel, 1), "midia": p.get("midia"), "texto": texto},
            "destaque": f"{p['curtidas']:,} curtidas · {p['views']:,} views".replace(",", "."),
            "publicado_em": p.get("quando"), "_vel": vel,
        })
    topo = math.log1p(max([i["_vel"] for i in itens] or [1])) or 1
    for i in itens:
        i["nota"] = round(100 * math.log1p(i.pop("_vel")) / topo, 1)
    return itens


async def coletar(conhecidos: list[str] | None = None) -> list[dict]:
    """`conhecidos`: ids de posts já coletados; o script pula esses e rola até juntar ALVO posts inéditos."""
    opts = ClaudeAgentOptions(
        model="sonnet", tools=[], setting_sources=[], max_turns=30, extra_args={"chrome": None},
        # sem busca de ferramentas (as do Chrome ficariam adiadas e invisíveis com tools=[]) e sem os conectores da conta
        env={"ENABLE_TOOL_SEARCH": "false", "ENABLE_CLAUDEAI_MCP_SERVERS": "false"},
        allowed_tools=["mcp__claude-in-chrome__select_browser", "mcp__claude-in-chrome__tabs_context_mcp", "mcp__claude-in-chrome__tabs_create_mcp",
                       "mcp__claude-in-chrome__navigate", "mcp__claude-in-chrome__javascript_tool",
                       "mcp__claude-in-chrome__tabs_close_mcp", "mcp__claude-in-chrome__computer"],
        permission_mode="dontAsk",
    )
    arq = f"jarvis-x-{uuid.uuid4().hex[:10]}.json"
    ids = sorted({c[-9:] for c in conhecidos or [] if c.isdigit()})
    script = EXTRAI.replace("__ALVO__", str(ALVO)).replace("__ARQ__", arq).replace("__CONHECIDOS__", json.dumps(ids))
    prompt = PROMPT.replace("__EXTRAI__", script).replace("__LE__", LE).replace("__PERFIL__", CHROME_PERFIL)
    final = ""
    async for m in query(prompt=prompt, options=opts):
        if isinstance(m, AssistantMessage) and DEBUG:
            for b in m.content:
                if isinstance(b, ToolUseBlock):
                    print("  ·", b.name.split("__")[-1], str(b.input)[:90])
        elif isinstance(m, UserMessage) and DEBUG and isinstance(m.content, list):
            for b in m.content:
                if isinstance(b, ToolResultBlock):
                    print("  ←", _texto_resultado(b)[:70].replace("\n", " "))
        elif isinstance(m, ResultMessage):
            final = m.result or ""
    if "SEM_LOGIN" in final:
        raise RuntimeError("o X pediu login no Chrome")
    if "SEM_PERFIL" in final:
        raise RuntimeError("não achei o perfil Claude Profile do Chrome (a extensão está aberta nele?)")
    alvo = DOWNLOADS / arq
    for _ in range(30):  # o download pode levar um instante para aparecer
        if alvo.exists() and alvo.stat().st_size > 0:
            break
        await asyncio.sleep(0.5)
    else:
        raise RuntimeError(f"o arquivo da coleta não apareceu em Downloads. Agente: {final[:160]}")
    posts = json.loads(alvo.read_text())
    alvo.unlink()
    return _para_sinais(posts)


if __name__ == "__main__":  # teste: uv run python -m jarvis.coletores.x
    import asyncio
    from .. import auth
    auth.preparar()
    r = asyncio.run(coletar())
    print(len(r))
    for i in sorted(r, key=lambda i: -i["nota"])[:8]:
        print(i["nota"], i["autor"], i["destaque"], "|", i["titulo"][:80])
