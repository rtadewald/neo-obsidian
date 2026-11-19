"""SQLite do app: sinais do radar, conversas e mensagens."""
import json
import sqlite3
import time
from contextlib import contextmanager

from .config import DADOS, DB

ESQUEMA = """
create table if not exists sinais (
  id integer primary key,
  fonte text not null,              -- github | huggingface | hackernews | x | instagram
  externo text not null,            -- id na fonte (dedup)
  url text, titulo text not null, resumo text, autor text, imagem text,
  metricas text default '{}',       -- json com os números crus da fonte
  nota real default 0,              -- potencial, 0 a 100
  destaque text,                    -- rótulo curto do número (ex.: "+1.240 ★ hoje")
  tipo text,                        -- modelo | tecnica | projeto | hype | ferramenta | skill | outro
  porque text,                      -- uma linha: por que importa
  status text default 'novo',       -- novo | salvo | descartado
  publicado_em text, coletado_em real,
  unique (fonte, externo)
);
create table if not exists conversas (
  id text primary key,              -- "radar" ou "ideia-<n>"
  sessao text,                      -- session_id do Claude Code, para retomar
  titulo text, atualizado_em real
);
create table if not exists mensagens (
  id integer primary key, conversa text not null, papel text not null, texto text not null, criado_em real
);
create table if not exists coletas (
  id integer primary key, inicio real, fim real, status text, detalhes text
);
create table if not exists ads_dia (    -- Meta Ads, por dia (Metricool: metaAds evolution)
  dia text primary key, gasto real, impressoes real, alcance real, cliques real, roas real, valor real, atualizado_em real
);
create table if not exists ads_item (   -- campanhas e anúncios do período sincronizado
  id text primary key,                -- "campanha:<id>" ou "anuncio:<id>"
  nivel text, nome text, campanha text, objetivo text, inicio text, thumb text,
  metricas text default '{}', atualizado_em real
);
create table if not exists posts (     -- calendário: o que foi publicado e o que está agendado (Metricool)
  id text primary key,               -- url do post publicado, ou "agendado:<id do Metricool>"
  quando text not null,              -- ISO local (America/Sao_Paulo)
  estado text not null,              -- publicado | agendado
  tipo text,                         -- Reel | Carrossel | Imagem | Vídeo
  perfil text, legenda text, url text, thumb text,
  metricas text default '{}',
  redes text,                        -- agendados: redes de destino
  atualizado_em real
);
"""


@contextmanager
def conexao():
    DADOS.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def iniciar():
    with conexao() as c:
        c.executescript(ESQUEMA)
        colunas = [r[1] for r in c.execute("pragma table_info(posts)")]
        if "rede" not in colunas:  # migração: rede de cada post (instagram | tiktok | youtube | multi)
            c.execute("alter table posts add column rede text")
            c.execute("update posts set rede = case when estado='agendado' then 'multi' else 'instagram' end")
        cols_s = [r[1] for r in c.execute("pragma table_info(sinais)")]
        if "voto" not in cols_s:  # like (1) / deslike (-1) do Rodrigo, que ensina o ranking
            c.execute("alter table sinais add column voto integer default 0")
            c.execute("alter table sinais add column votado_em real")
        if "lote" not in cols_s:  # X: a coleta em que o post apareceu pela 1ª vez (a página mostra só o último lote)
            c.execute("alter table sinais add column lote real")
        if "x_quer" not in cols_s:  # like espelhado no X: o que se quer lá (1/0) e o que já está feito
            c.execute("alter table sinais add column x_quer integer")
            c.execute("alter table sinais add column x_feito integer")
            c.execute("alter table sinais add column x_erro text")
        if "interesse" not in cols_s:  # 0 a 100: o quanto o Haiku acha que combina com o gosto dele
            c.execute("alter table sinais add column interesse real")


def gravar_sinais(itens: list[dict], lote: float | None = None) -> int:
    """Insere ou atualiza os números de sinais já vistos. Não mexe em status, tipo nem porque.
    `lote` (X): marca só os posts inéditos com a coleta de agora; os já vistos não voltam para a página."""
    novos = 0
    with conexao() as c:
        for s in itens:
            cur = c.execute("select id, metricas from sinais where fonte=? and externo=?", (s["fonte"], s["externo"]))
            antigo = cur.fetchone()
            if antigo:
                velho = json.loads(antigo["metricas"] or "{}")
                if "video" in velho:  # o MP4 do X já buscado não se perde a cada coleta
                    s = s | {"metricas": s.get("metricas", {}) | {"video": velho["video"]}}
                c.execute("update sinais set metricas=?, nota=?, destaque=?, imagem=coalesce(?, imagem), coletado_em=? "
                          "where fonte=? and externo=?",
                          (json.dumps(s.get("metricas", {})), s.get("nota", 0), s.get("destaque"), s.get("imagem"),
                           time.time(), s["fonte"], s["externo"]))
            else:
                novos += 1
                c.execute("""insert into sinais (fonte, externo, url, titulo, resumo, autor, imagem, metricas, nota,
                             destaque, publicado_em, coletado_em, lote) values (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                          (s["fonte"], s["externo"], s.get("url"), s["titulo"], s.get("resumo"), s.get("autor"),
                           s.get("imagem"), json.dumps(s.get("metricas", {})), s.get("nota", 0), s.get("destaque"),
                           s.get("publicado_em"), time.time(), lote))
    return novos


def externos_recentes(fonte: str, n: int) -> list[str]:
    with conexao() as c:
        return [l[0] for l in c.execute("select externo from sinais where fonte=? order by coletado_em desc limit ?", (fonte, n))]


def listar_sinais(status: str | None = None, fonte: str | None = None, tipo: str | None = None, limite: int = 120,
                  ultimo_lote: bool = False):
    sql, args = "select * from sinais where 1=1", []
    if ultimo_lote and fonte:  # X: só os posts que chegaram na última coleta
        with conexao() as c:
            lote = c.execute("select max(lote) from sinais where fonte=?", (fonte,)).fetchone()[0]
        if lote is not None:
            sql += " and lote=?"; args.append(lote)
    if status == "curtido":  # os que levaram like, de qualquer coleta e sem limite: ficam para sempre
        sql += " and voto > 0"
        limite = 100000
    elif status:
        sql += " and status=?"; args.append(status)
    else:
        sql += " and status!='descartado'"
    if tipo != "fora":  # fora do tema só aparece quando pedido
        sql += " and coalesce(tipo, '') != 'fora'"
    if fonte:
        sql += " and fonte=?"; args.append(fonte)
    if tipo:
        sql += " and tipo=?"; args.append(tipo)
    sql += " and coalesce(voto, 0) >= 0"  # deslike some do feed (e ensina o ranking)
    sql += " order by date(coletado_em, 'unixepoch') desc, nota desc limit ?"
    args.append(limite * 3)
    with conexao() as c:
        linhas = c.execute(sql, args).fetchall()
    from . import preferencias
    itens = [dict(l) | {"metricas": json.loads(l["metricas"] or "{}")} for l in linhas]
    perfil = preferencias.perfil()
    for s in itens:
        s["afinidade"], s["motivos"] = preferencias.afinidade(s, perfil)
        s["pontuacao"] = preferencias.pontuar(s)
    dia = lambda s: time.strftime("%Y-%m-%d", time.localtime(s["coletado_em"] or 0))
    itens.sort(key=lambda s: (dia(s), s["pontuacao"]), reverse=True)
    return itens[:limite]


def votar(id_: int, voto: int):
    with conexao() as c:
        c.execute("update sinais set voto=?, votado_em=? where id=?", (voto, time.time(), id_))


def querer_no_x(id_: int, curtido: bool) -> bool:
    """Marca o like que o post do X deve ter lá. Devolve True se há algo a fazer."""
    with conexao() as c:
        l = c.execute("select fonte, x_feito from sinais where id=?", (id_,)).fetchone()
        if not l or l["fonte"] not in ("x", "instagram"):   # o like vai para a rede de origem
            return False
        if not curtido and not l["x_feito"]:   # nunca foi curtido lá: nada a desfazer
            c.execute("update sinais set x_quer=null, x_erro=null where id=?", (id_,))
            return False
        c.execute("update sinais set x_quer=?, x_erro=null where id=?", (int(curtido), id_))
        return True


def pendentes_x(limite: int = 15) -> list[dict]:
    with conexao() as c:
        return [dict(l) for l in c.execute(
            "select id, fonte, url, x_quer from sinais where fonte in ('x','instagram') and x_quer is not null and x_erro is null "
            "and coalesce(x_feito, -1) != x_quer order by votado_em limit ?", (limite,)).fetchall()]


def x_feito(id_: int, feito: int | None, erro: str | None = None):
    with conexao() as c:
        if erro:
            c.execute("update sinais set x_erro=? where id=?", (erro, id_))
        else:
            c.execute("update sinais set x_feito=?, x_erro=null where id=?", (feito, id_))


def votados() -> list[dict]:
    with conexao() as c:
        return [dict(l) for l in c.execute(
            "select id, fonte, autor, tipo, titulo, resumo, porque, voto from sinais where coalesce(voto,0) != 0 "
            "order by votado_em desc limit 400").fetchall()]


def sem_classificacao(limite: int = 60):
    with conexao() as c:
        return [dict(l) for l in c.execute(
            "select id, fonte, titulo, resumo, autor, destaque from sinais where tipo is null order by nota desc limit ?",
            (limite,)).fetchall()]


def classificar(id_: int, tipo: str, porque: str, interesse: float | None = None):
    with conexao() as c:
        c.execute("update sinais set tipo=?, porque=?, interesse=coalesce(?, interesse) where id=?", (tipo, porque, interesse, id_))


def mudar_status(id_: int, status: str):
    with conexao() as c:
        c.execute("update sinais set status=? where id=?", (status, id_))


def sinal(id_: int):
    with conexao() as c:
        l = c.execute("select * from sinais where id=?", (id_,)).fetchone()
    return dict(l) if l else None


def registrar_coleta(inicio: float, status: str, detalhes: dict):
    with conexao() as c:
        c.execute("insert into coletas (inicio, fim, status, detalhes) values (?,?,?,?)",
                  (inicio, time.time(), status, json.dumps(detalhes, ensure_ascii=False)))


def ultima_coleta():
    with conexao() as c:
        l = c.execute("select * from coletas order by id desc limit 1").fetchone()
    return dict(l) | {"detalhes": json.loads(l["detalhes"] or "{}")} if l else None
