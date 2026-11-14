"""Like do radar espelhado no X: 👍 no app curte o post no X de verdade (e tirar o like descurte),
para o próprio algoritmo do X aprender o gosto do Rodrigo e o feed "Para você" trazer mais disso na próxima coleta.

Usa a mesma sessão do coletor (Claude in Chrome, no Chrome dele já logado). Os likes entram numa fila no SQLite
(`x_quer`), e um trabalhador em segundo plano junta o que chegou em poucos segundos e resolve tudo numa sessão só:
abre cada post, clica no coração só se o estado for diferente do pedido e confere. Não reposta, não segue, não responde.
"""
import asyncio
import re
import threading
import time

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

from .. import db

# Idempotente: só clica se o post não estiver no estado pedido. Rodar de novo depois do clique confere ("JA").
CLICA = r"""
(() => {
  const id = '__ID__', quer = __QUER__;
  const arts = [...document.querySelectorAll('article[data-testid="tweet"]')];
  const a = arts.find(x => [...x.querySelectorAll('a[href*="/status/"]')].some(l => l.querySelector('time') && l.pathname.split('/')[3] === id))
    || arts.find(x => x.getAttribute('tabindex') === '-1');
  if (!a) return 'NAO_ACHEI';
  const like = a.querySelector('[data-testid="like"]'), unlike = a.querySelector('[data-testid="unlike"]');
  if (quer) { if (unlike) return 'JA'; if (like) { like.click(); return 'CLICOU'; } }
  else { if (like) return 'JA'; if (unlike) { unlike.click(); return 'CLICOU'; } }
  return 'SEM_BOTAO';
})()
"""

PROMPT = """Você espelha no X os likes que o Rodrigo deu no app dele. Faça só o que está abaixo: não reposte,
não siga, não responda, não clique em nada além do que o script clica.
1. Chame tabs_context_mcp com createIfEmpty: true e use a aba que ela devolver (não crie outra).
2. Para cada post da lista, na ordem:
   a. Navegue até a URL e espere 3 s (computer, action wait). Se a página pedir login, pare e responda só "SEM_LOGIN".
   b. Rode o script do post com javascript_tool, exatamente como está.
   c. Se a resposta for "CLICOU", espere 2 s e rode o mesmo script de novo: deve responder "JA".
   d. Anote o resultado: OK se terminou em "JA"; senão, a última resposta (NAO_ACHEI, SEM_BOTAO, CLICOU).
3. Feche a aba (tabs_close_mcp) e responda só com uma linha por post, no formato `<n>: <resultado>`.

__POSTS__"""


def _bloco(i: int, p: dict) -> str:
    m = re.search(r"/status/(\d+)", p["url"] or "")
    script = CLICA.replace("__ID__", m.group(1) if m else "").replace("__QUER__", "true" if p["x_quer"] else "false")
    acao = "curtir" if p["x_quer"] else "descurtir"
    return f"Post {i} ({acao}): {p['url']}\n```js{script}```"


async def _rodar(posts: list[dict]) -> dict[int, str]:
    opts = ClaudeAgentOptions(
        model="sonnet", tools=[], setting_sources=[], max_turns=12 + 6 * len(posts), extra_args={"chrome": None},
        env={"ENABLE_TOOL_SEARCH": "false", "ENABLE_CLAUDEAI_MCP_SERVERS": "false"},
        allowed_tools=["mcp__claude-in-chrome__tabs_context_mcp", "mcp__claude-in-chrome__navigate",
                       "mcp__claude-in-chrome__javascript_tool", "mcp__claude-in-chrome__tabs_close_mcp",
                       "mcp__claude-in-chrome__computer"],
        permission_mode="dontAsk",
    )
    prompt = PROMPT.replace("__POSTS__", "\n\n".join(_bloco(i + 1, p) for i, p in enumerate(posts)))
    final = ""
    async for m in query(prompt=prompt, options=opts):
        if isinstance(m, ResultMessage):
            final = m.result or ""
    if "SEM_LOGIN" in final:
        return {p["id"]: "o X pediu login no Chrome" for p in posts}
    res = {}
    for i, p in enumerate(posts):
        r = re.search(rf"^\s*{i + 1}\s*:\s*(\S+)", final, re.M)
        res[p["id"]] = "OK" if r and r.group(1).upper().startswith("OK") else (r.group(1) if r else "sem resposta")
    return res


_trava = threading.Lock()
_rodando = False


def _trabalhar():
    global _rodando
    try:
        time.sleep(4)   # junta os likes dados em sequência numa sessão só
        for _ in range(6):
            posts = db.pendentes_x()
            if not posts:
                break
            try:
                res = asyncio.run(_rodar(posts))
            except Exception as e:  # sem Chrome, sem extensão, sessão caiu: fica o erro em cada post
                res = {p["id"]: f"{type(e).__name__}: {e}"[:200] for p in posts}
            for p in posts:
                r = res.get(p["id"], "sem resposta")
                if r == "OK":
                    db.x_feito(p["id"], p["x_quer"])
                else:
                    db.x_feito(p["id"], None, r)
    finally:
        with _trava:
            _rodando = False
    if db.pendentes_x():  # chegou like enquanto fechava
        agendar()


def agendar():
    """Acorda o trabalhador (uma thread por vez)."""
    global _rodando
    with _trava:
        if _rodando:
            return
        _rodando = True
    threading.Thread(target=_trabalhar, daemon=True, name="x-curtir").start()


if __name__ == "__main__":  # teste: uv run python -m jarvis.coletores.x_curtir
    from .. import auth
    auth.preparar()
    print(db.pendentes_x())
    _trabalhar()
