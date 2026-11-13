import { useCallback, useEffect, useMemo, useState } from 'react'
import { Arco, Delta, Linha, curto } from './Estatisticas'
import { Icone } from './Icone'

/** Desempenho dos anúncios no Meta Ads, lido do Metricool (últimos 30 dias). */
type M = {
  gasto?: number | null; impressoes?: number | null; alcance?: number | null; cliques?: number | null; cliques_link?: number | null
  resultados?: number | null; roas?: number | null; valor?: number | null; thruplays?: number | null; lp_views?: number | null
  ctr?: number | null; cpc?: number | null; cpm?: number | null; custo_resultado?: number | null; rotulo?: string | null
}
type Item = { id: string; nivel: string; nome: string | null; campanha: string | null; objetivo: string | null; thumb: string | null; metricas: M }
type Dia = { dia: string; gasto: number | null; impressoes: number | null; cliques: number | null; valor: number | null; roas: number | null }
type Painel = {
  estado: { conta: string; sincronizado_em?: number; de?: string; ate?: string; erro?: string | null; rodando?: boolean; ultimo?: Record<string, number> }
  dias: Dia[]; campanhas: Item[]; anuncios: Item[]; sincronizando: boolean
}

const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0)
const brl = (v: number | null | undefined, casas = 2) =>
  v == null || !isFinite(v) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas })
const pct = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`)
const OBJ: Record<string, string> = {
  OUTCOME_SALES: 'Vendas', OUTCOME_LEADS: 'Leads', OUTCOME_TRAFFIC: 'Tráfego', OUTCOME_ENGAGEMENT: 'Engajamento',
  OUTCOME_AWARENESS: 'Reconhecimento', OUTCOME_APP_PROMOTION: 'App', CONVERSIONS: 'Conversões', LINK_CLICKS: 'Cliques', VIDEO_VIEWS: 'Vídeo',
}
const ROTULO: Record<string, string> = { purchase: 'compras', lead: 'leads', link_click: 'cliques', landing_page_view: 'visitas na página', video_view: 'views', complete_registration: 'cadastros' }
const rotulo = (r?: string | null) => (r ? ROTULO[r.replace(/^.*\./, '').toLowerCase()] ?? r.replace(/_/g, ' ').toLowerCase() : 'resultados')

function quando(ts?: number) {
  if (!ts) return 'nunca'
  const min = Math.round((Date.now() / 1000 - ts) / 60)
  return min < 60 ? `há ${Math.max(min, 1)} min` : min < 1440 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} d`
}

export function Desempenho() {
  const [p, setP] = useState<Painel | null>(null)
  const [ordem, setOrdem] = useState<keyof M>('gasto')
  const [erro, setErro] = useState('')

  const carregar = useCallback(() => fetch('/api/ads').then((r) => r.json()).then((d) => { setP(d); setErro('') }).catch((e) => setErro(String(e))), [])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    if (!p?.sincronizando) return
    const t = setInterval(carregar, 3000)
    return () => clearInterval(t)
  }, [p?.sincronizando, carregar])

  async function sincronizar() {
    setP((x) => (x ? { ...x, sincronizando: true } : x))
    await fetch('/api/ads/sincronizar', { method: 'POST' })
    carregar()
  }

  const k = useMemo(() => {
    if (!p) return null
    const dias = [...p.dias].sort((a, b) => a.dia.localeCompare(b.dia)).slice(-30)
    const camp = p.campanhas
    const soma = (f: keyof M) => camp.reduce((s, c) => s + n(c.metricas[f]), 0)
    const gasto = camp.length ? soma('gasto') : dias.reduce((s, d) => s + n(d.gasto), 0)
    const imp = camp.length ? soma('impressoes') : dias.reduce((s, d) => s + n(d.impressoes), 0)
    const cliques = camp.length ? soma('cliques_link') || soma('cliques') : dias.reduce((s, d) => s + n(d.cliques), 0)
    const res = soma('resultados'), valor = camp.length ? soma('valor') : dias.reduce((s, d) => s + n(d.valor), 0)
    const meio = Math.floor(dias.length / 2)
    const g1 = dias.slice(0, meio).reduce((s, d) => s + n(d.gasto), 0), g2 = dias.slice(meio).reduce((s, d) => s + n(d.gasto), 0)
    const rotulos = new Set(camp.map((c) => c.metricas.rotulo).filter(Boolean))
    return {
      dias, gasto, imp, cliques, res, valor, ctr: imp ? (cliques / imp) * 100 : null, cpc: cliques ? gasto / cliques : null,
      cpm: imp ? (gasto / imp) * 1000 : null, cpr: res ? gasto / res : null, roas: gasto && valor ? valor / gasto : null,
      tend: g1 ? (g2 - g1) / g1 : null, rotulo: rotulos.size === 1 ? rotulo([...rotulos][0]) : 'resultados',
    }
  }, [p])

  const temDados = !!k && (k.gasto > 0 || k.imp > 0 || (p?.anuncios.length ?? 0) > 0)
  const est = p?.estado
  const campanhas = useMemo(() => [...(p?.campanhas ?? [])].sort((a, b) => n(b.metricas[ordem]) - n(a.metricas[ordem])), [p, ordem])
  const anuncios = useMemo(() => {
    const l = [...(p?.anuncios ?? [])].filter((a) => n(a.metricas.gasto) > 0)
    // melhores primeiro: menor custo por resultado; sem resultado, pelo CTR
    return l.sort((a, b) => (a.metricas.custo_resultado ?? Infinity) - (b.metricas.custo_resultado ?? Infinity) || n(b.metricas.ctr) - n(a.metricas.ctr))
  }, [p])
  const iMaxGasto = k ? k.dias.reduce((m, d, i, l) => (n(d.gasto) > n(l[m].gasto) ? i : m), 0) : 0

  return (
    <div className="desempenho">
      <div className="radar-cabeca">
        <div>
          <h1 className="titulo">Desempenho</h1>
          <p className="sub">
            Meta Ads · conta {est?.conta ?? '…'} · {est?.de ? `${new Date(est.de + 'T12:00').toLocaleDateString('pt-BR')} a ${new Date(est.ate + 'T12:00').toLocaleDateString('pt-BR')}` : 'últimos 30 dias'}
            {' '}· sincronizado {quando(est?.sincronizado_em)}
            {est?.erro && <span className="aviso"> · falhou: {est.erro}</span>}
          </p>
        </div>
        <div className="acoes-topo">
          <button className="pilula pilula--escura" onClick={sincronizar} disabled={p?.sincronizando}>
            <span className={p?.sincronizando ? 'gira' : ''}><Icone n="atualizar" t={15} /></span>
            {p?.sincronizando ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        </div>
      </div>

      {erro && <div className="vazio glass glass--light">Não consegui falar com o backend: {erro}</div>}

      {p && !temDados && (
        <div className="vazio glass glass--light ads-vazio">
          <p className="embreve-tag">Sem números ainda</p>
          {est?.sincronizado_em ? (
            <p>A conta <b>{est.conta}</b> está ligada ao Metricool, mas ele ainda não devolveu gasto, impressões nem campanhas
              ({est.ultimo ? `${est.ultimo.dias ?? 0} dias, ${est.ultimo.campanhas ?? 0} campanhas, ${est.ultimo.anuncios ?? 0} anúncios` : 'nada'}).
              Logo depois de conectar, o Metricool leva algumas horas para importar o histórico. Se continuar vazio amanhã,
              confira se é a conta de anúncios certa (Metricool → Conexões → Meta Ads).</p>
          ) : <p>Clique em <b>Sincronizar</b> para buscar investimento, campanhas e anúncios dos últimos 30 dias no Metricool. Leva cerca de 1 minuto.</p>}
        </div>
      )}

      {k && temDados && (
        <>
          <div className="ds-stats ads-kpis">
            <article className="ds-card glass glass--escuro ds-vir">
              <header className="ds-topo"><h3>Investido</h3><span className="ds-dot" /><span className="ds-mult">30 dias</span></header>
              <div className="ds-kpi"><span className="ds-num">{brl(k.gasto, 0)}</span><Delta v={k.tend} /></div>
              <p className="ds-sub">{k.dias.length ? `média de ${brl(k.gasto / k.dias.length, 0)} por dia · segunda quinzena contra a primeira` : ''}</p>
              <Linha id="gasto" w={420} h={86} valores={k.dias.map((d) => n(d.gasto))} destaque={iMaxGasto}
                rotulos={k.dias.map((d) => `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)} · ${brl(d.gasto, 0)}`)} />
            </article>
            <article className="ds-card glass glass--escuro">
              <header className="ds-topo"><h3>Resultados</h3></header>
              <div className="ds-kpi"><span className="ds-num">{curto(k.res)}</span><span className="ds-legenda">{k.rotulo}</span></div>
              <p className="ds-legenda ads-big">{brl(k.cpr)} <small>por resultado</small></p>
              {k.roas != null && <p className="ds-legenda ads-big">{k.roas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x <small>ROAS · {brl(k.valor, 0)} em conversões</small></p>}
            </article>
            <article className="ds-card glass glass--escuro ds-eng">
              <header className="ds-topo"><h3>CTR do link</h3></header>
              <div className="ds-kpi"><span className="ds-num">{pct(k.ctr)}</span></div>
              <p className="ds-legenda">{curto(k.cliques)} cliques em {curto(k.imp)} impressões</p>
              <Arco valor={n(k.ctr) / 3} />
            </article>
            <article className="ds-card glass glass--escuro">
              <header className="ds-topo"><h3>Custos</h3></header>
              <dl className="ads-custos">
                <div><dt>CPM</dt><dd>{brl(k.cpm)}</dd></div>
                <div><dt>CPC</dt><dd>{brl(k.cpc)}</dd></div>
                <div><dt>Impressões</dt><dd>{curto(k.imp)}</dd></div>
              </dl>
            </article>
          </div>

          {campanhas.length > 0 && (
            <section className="ads-bloco glass glass--light">
              <header className="ads-bloco-topo">
                <h2>Campanhas <small>{campanhas.length}</small></h2>
                <div className="ads-ordem" role="group" aria-label="Ordenar">
                  {([['gasto', 'Gasto'], ['resultados', 'Resultados'], ['ctr', 'CTR'], ['roas', 'ROAS']] as [keyof M, string][]).map(([c, r]) => (
                    <button key={c} className={`aba ${ordem === c ? 'is-ativa' : ''}`} onClick={() => setOrdem(c)}>{r}</button>
                  ))}
                </div>
              </header>
              <div className="ads-tabela-rolo">
                <table className="ads-tabela">
                  <thead><tr><th>Campanha</th><th>Objetivo</th><th>Gasto</th><th>Resultados</th><th>Custo/res.</th><th>CTR</th><th>CPM</th><th>ROAS</th></tr></thead>
                  <tbody>
                    {campanhas.map((c) => {
                      const m = c.metricas, share = k.gasto ? n(m.gasto) / k.gasto : 0
                      return (
                        <tr key={c.id}>
                          <td className="ads-nome"><span>{c.nome}</span><i className="ads-barra" style={{ width: `${Math.max(2, share * 100)}%` }} /></td>
                          <td>{OBJ[c.objetivo ?? ''] ?? c.objetivo ?? '—'}</td>
                          <td>{brl(m.gasto, 0)}</td>
                          <td>{m.resultados ? `${curto(m.resultados)} ${rotulo(m.rotulo)}` : '—'}</td>
                          <td>{brl(m.custo_resultado)}</td>
                          <td>{pct(m.ctr)}</td>
                          <td>{brl(m.cpm)}</td>
                          <td>{m.roas ? `${m.roas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x` : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {anuncios.length > 0 && (
            <section className="ads-bloco">
              <h2 className="ads-h2">Anúncios <small>do mais barato por resultado ao mais caro</small></h2>
              <div className="ads-grade">
                {anuncios.map((a, i) => {
                  const m = a.metricas
                  return (
                    <article key={a.id} className="ads-card glass glass--light">
                      <div className="ads-thumb">
                        {a.thumb ? <img src={`/api/thumbs/${a.thumb}`} alt="" loading="lazy" /> : <span className="mudo">sem prévia</span>}
                        {i < 3 && <span className="ads-rank">{i + 1}º</span>}
                      </div>
                      <div className="ads-info">
                        <p className="ads-card-nome" title={a.nome ?? ''}>{a.nome}</p>
                        <p className="ads-card-camp">{a.campanha}</p>
                        <dl className="ads-num">
                          <div><dt>Gasto</dt><dd>{brl(m.gasto, 0)}</dd></div>
                          <div><dt>{rotulo(m.rotulo)}</dt><dd>{m.resultados ? curto(m.resultados) : '—'}</dd></div>
                          <div><dt>Custo/res.</dt><dd>{brl(m.custo_resultado)}</dd></div>
                          <div><dt>CTR</dt><dd>{pct(m.ctr)}</dd></div>
                        </dl>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
