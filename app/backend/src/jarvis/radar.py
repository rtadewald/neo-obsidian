"""Uma coleta do radar: roda os coletores, grava os sinais e classifica os novos com um modelo barato."""
import asyncio
import json
import time
import traceback

import httpx
from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

from . import db, preferencias
from .coletores import x as coletor_x
from .coletores import x_curtir
from .coletores import instagram_radar as coletor_ig
from .coletores.fontes import COLETORES
from .config import MODELO_RADAR

TIPOS = ["modelo", "tecnica", "projeto", "ferramenta", "hype", "skill", "outro", "fora"]

PROMPT = """Você é o radar de conteúdo do Rodrigo Tadewald (Asimov Academy: Python, IA, agentes, automação, design com IA).
Ele faz Reels e carrosséis no Instagram ensinando a resolver problemas com IA, de forma prática.

Para cada item abaixo, devolva:
- tipo: um de {tipos}
  (modelo = modelo de IA novo ou atualizado; tecnica = jeito novo de fazer algo; projeto = repositório/app interessante;
   ferramenta = produto ou serviço; hype = assunto de tecnologia/IA em alta; skill = skill/prompt/agente reaproveitável;
   outro = tecnologia, mas sem encaixe acima; fora = sem relação com IA, programação, tecnologia, criadores ou negócios
   digitais — esporte, política, celebridades, mercado financeiro genérico etc.)
- porque: SÓ para itens que não são do X (fonte diferente de "x"): UMA frase curta em PT-BR (até 110 caracteres)
  dizendo o que é e por que pode virar conteúdo para ele. Concreto, sem adjetivos vazios. Para "fora", só "Fora do tema".
  Para itens do X, não devolva porque (o próprio post já diz o que é).
- interesse: 0 a 100, o quanto o item combina com o gosto dele, a julgar pelos votos abaixo
  (generalize pelo assunto e pelo ângulo, não só por palavras iguais). Sem votos, julgue pelo público dele.

O gosto do Rodrigo até aqui:
{gosto}

Itens (JSON):
{itens}"""

ESQUEMA = {
    "type": "object",
    "properties": {"itens": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "integer"}, "tipo": {"type": "string", "enum": TIPOS},
                       "porque": {"type": "string"}, "interesse": {"type": "integer"}},
        "required": ["id", "tipo", "interesse"]}}},
    "required": ["itens"],
}

_rodando = asyncio.Lock()


async def classificar_pendentes(pend: list[dict] | None = None) -> int:
    pend = db.sem_classificacao(60) if pend is None else pend
    if not pend:
        return 0
    itens = [{"id": p["id"], "fonte": p["fonte"], "titulo": p["titulo"], "resumo": (p["resumo"] or "")[:240],
              "numeros": p["destaque"]} for p in pend]
    opts = ClaudeAgentOptions(model=MODELO_RADAR, tools=[], setting_sources=[], max_turns=3,
                              output_format={"type": "json_schema", "schema": ESQUEMA})
    feitos = 0
    async for m in query(prompt=PROMPT.format(tipos=", ".join(TIPOS), gosto=preferencias.exemplos(),
                                               itens=json.dumps(itens, ensure_ascii=False)),
                         options=opts):
        if isinstance(m, ResultMessage) and m.structured_output:
            for it in m.structured_output.get("itens", []):
                db.classificar(int(it["id"]), it["tipo"], (it.get("porque") or "").strip(),
                              max(0, min(100, int(it.get("interesse", 50)))))
                feitos += 1
    return feitos


async def reavaliar(limite: int = 120) -> dict:
    """Depois de votar: refaz tipo, porque e interesse dos sinais recentes com o gosto atualizado."""
    with db.conexao() as c:
        ids = [r["id"] for r in c.execute(
            "select id from sinais where status != 'descartado' and coalesce(voto,0) = 0 "
            "order by coletado_em desc, nota desc limit ?", (limite,)).fetchall()]
    feitos = 0
    for i in range(0, len(ids), 60):
        with db.conexao() as c:
            q = ",".join("?" * len(ids[i:i + 60]))
            lote = [dict(r) for r in c.execute(
                f"select id, fonte, titulo, resumo, autor, destaque from sinais where id in ({q})", ids[i:i + 60]).fetchall()]
        feitos += await classificar_pendentes(lote)
    return {"reavaliados": feitos}


async def coletar(com_x: bool = True) -> dict:
    if _rodando.locked():
        return {"status": "ja_rodando"}
    async with _rodando:
        inicio, det = time.time(), {}
        with httpx.Client(follow_redirects=True) as cli:
            for nome, fn in COLETORES.items():
                try:
                    itens = await asyncio.to_thread(fn, cli)
                    det[nome] = {"itens": len(itens), "novos": db.gravar_sinais(itens)}
                except Exception as e:  # uma fonte fora do ar não derruba as outras
                    det[nome] = {"erro": f"{type(e).__name__}: {e}"[:200]}
        if com_x:  # abre uma aba no Chrome do Rodrigo e leva ~1,5 min
            if db.pendentes_x():   # antes de rolar o feed: os likes da fila vão ao X (o algoritmo já aprende)
                try:
                    det["x_likes"] = await asyncio.to_thread(x_curtir.espelhar)
                except Exception as e:
                    det["x_likes"] = {"erro": f"{type(e).__name__}: {e}"[:200]}
            try:
                # só posts inéditos: o script pula os já vistos e o lote novo substitui o anterior na página do X
                itens = await coletor_x.coletar(db.externos_recentes("x", 250))
                det["x"] = {"itens": len(itens), "novos": db.gravar_sinais(itens, lote=time.time())}
            except Exception as e:
                det["x"] = {"erro": f"{type(e).__name__}: {e}"[:200]}
            try:   # Instagram: a conta do radar no mesmo perfil do Chrome (perfis seguidos + Reels do algoritmo)
                itens = await coletor_ig.coletar(db.externos_recentes("instagram", 600))
                det["instagram"] = {"itens": len(itens), "novos": db.gravar_sinais(itens, lote=time.time())}
            except Exception as e:
                det["instagram"] = {"erro": f"{type(e).__name__}: {e}"[:200]}
        try:
            det["classificados"] = 0
            for _ in range(4):  # lotes de 60
                n = await classificar_pendentes()
                det["classificados"] += n
                if n == 0:
                    break
        except Exception as e:
            det["classificacao_erro"] = f"{type(e).__name__}: {e}"[:300]
            traceback.print_exc()
        status = "ok" if not any("erro" in str(v) for v in det.values()) else "parcial"
        db.registrar_coleta(inicio, status, det)
        return {"status": status, **det}


if __name__ == "__main__":  # uv run python -m jarvis.radar  (para agendar no launchd)
    from . import auth
    auth.preparar()
    db.iniciar()
    print(json.dumps(asyncio.run(coletar()), ensure_ascii=False, indent=1))
