import { useEffect, useMemo, useState } from 'react'
import { Icone } from './Icone'

/** Estatísticas do perfil, nos cards do JCO-359 (vidro escuro, curva suave, ponto lima, arco). */
export type PostCal = {
  id: string; quando: string; estado: 'publicado' | 'agendado'; tipo: string | null
  legenda: string | null; thumb: string | null; metricas: Record<string, number | string | null>
  rede: string | null; redes?: string[]
}

const DIA = 86400000
const num = (v: unknown) => (typeof v === 'number' ? v : 0)
export const curto = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`
    : n >= 1e3 ? `${Math.round(n / 1e3).toLocaleString('pt-BR')}k` : String(Math.round(n))
const mediana = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0 }
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** Manchete: a primeira linha com corpo (CTA curto como "Segue o link:" não serve), cortada em ~90 caracteres. */
const manchete = (t: string | null) => {
  const linhas = (t ?? '').split('\n').map((l) => l.replace(/[#@]\S+/g, '').trim()).filter((l) => l.length >= 28 && !/:$/.test(l))
  const l = linhas[0] ?? (t ?? '').trim()
  return l.length > 90 ? l.slice(0, 88).replace(/\s+\S*$/, '') + '…' : l
}

/** Curva suave (Catmull-Rom → Bézier), como no app.js do design system. */
function suave(p: [number, number][]) {
  let d = `M${p[0][0]} ${p[0][1]}`
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, y0] = p[Math.max(i - 1, 0)], [x1, y1] = p[i], [x2, y2] = p[i + 1], [x3, y3] = p[Math.min(i + 2, p.length - 1)]
    d += ` C${x1 + (x2 - x0) / 6} ${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6} ${y2 - (y3 - y1) / 6} ${x2} ${y2}`
  }
  return d
}

export function Linha({ id, valores, rotulos, destaque, w, h, onPonto }: {
  id: string; valores: number[]; rotulos: string[]; destaque: number; w: number; h: number; onPonto?: (i: number) => void
}) {
  if (valores.length < 2) return <svg width={w} height={h} />
  const max = Math.max(...valores, 1), min = Math.min(...valores, 0)
  const px = (i: number) => 8 + (i * (w - 16)) / (valores.length - 1)
  const py = (v: number) => h - 26 - ((v - min) / (max - min || 1)) * (h - 40)
  const pts = valores.map((v, i) => [px(i), py(v)] as [number, number])
  const base = h - 6
  return (
    <svg className="ds-linha" viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="rgba(255,255,255,.34)" /><stop offset={Math.max(0, destaque / (valores.length - 1) - 0.12)} stopColor="rgba(255,255,255,.46)" />
          <stop offset={destaque / (valores.length - 1)} stopColor="#e2f05c" /><stop offset="1" stopColor="rgba(255,255,255,.4)" />
        </linearGradient>
        <filter id={`${id}-gl`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.6" /></filter>
      </defs>
      {/* colunas de pontos: quantos, proporcional ao valor (o "pé" de cada ponto do DS) */}
      {pts.map(([x], i) => Array.from({ length: 1 + Math.round((valores[i] - min) / (max - min || 1) * 3) }, (_, k) => (
        <circle key={`${i}-${k}`} cx={x} cy={base - k * 9} r={2} fill="#fff" opacity={k === 0 ? 0.5 : 0.26} />
      )))}
      <path d={suave(pts)} fill="none" stroke={`url(#${id}-g)`} strokeWidth="2" strokeLinecap="round" />
      {pts.map(([x, y], i) => (
        <g key={i} className={onPonto ? 'ds-ponto is-clicavel' : 'ds-ponto'} onClick={() => onPonto?.(i)}>
          {i === destaque && <circle cx={x} cy={y} r={8} fill="#e2f05c" opacity={0.55} filter={`url(#${id}-gl)`} />}
          <circle cx={x} cy={y} r={i === destaque ? 4.6 : 3} fill={i === destaque ? '#e6f25f' : '#ece9e5'} opacity={i === destaque ? 1 : 0.65} />
          <circle cx={x} cy={y} r={12} fill="transparent"><title>{rotulos[i]}</title></circle>
        </g>
      ))}
    </svg>
  )
}

export function Arco({ valor, w = 260, h = 108 }: { valor: number; w?: number; h?: number }) {
  // semicírculo de -168° a -12°; o trecho até o valor fica lima, o resto branco
  const C: [number, number] = [w / 2, h + 34], R = 120
  const A0 = -168, A1 = -12, K = A0 + (A1 - A0) * Math.min(1, Math.max(0, valor))
  const at = (a: number) => [C[0] + R * Math.cos((a * Math.PI) / 180), C[1] + R * Math.sin((a * Math.PI) / 180)]
  const arc = (a0: number, a1: number) => { const [x0, y0] = at(a0), [x1, y1] = at(a1); return `M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1}` }
  const [kx, ky] = at(K)
  return (
    <svg className="ds-arco" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <defs>
        <linearGradient id="arc-y" x1="0" x2="1" y1="1" y2="0"><stop offset="0" stopColor="rgba(180,200,70,.6)" /><stop offset=".45" stopColor="#b9cc48" /><stop offset="1" stopColor="#e3f05c" /></linearGradient>
        <filter id="arc-gl" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      {[-150, -138, -126, -110, -96, -70, -58, -44, -30, -20].map((a, i) => {
        const r = R + (i % 2 ? 10 : -12), [x, y] = [C[0] + r * Math.cos((a * Math.PI) / 180), C[1] + r * Math.sin((a * Math.PI) / 180)]
        return <circle key={a} cx={x} cy={y} r={i % 3 ? 1.3 : 2} fill="#fff" opacity={i % 3 ? 0.22 : 0.34} />
      })}
      <path d={arc(K, A1)} fill="none" stroke="rgba(255,255,255,.42)" strokeWidth="2.2" strokeLinecap="round" />
      <path d={arc(A0, K)} fill="none" stroke="url(#arc-y)" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx={kx} cy={ky} r={12} fill="#fff" opacity={0.32} filter="url(#arc-gl)" />
      <circle cx={kx} cy={ky} r={5.4} fill="#f0f58a" stroke="#fff" strokeWidth="1.4" />
    </svg>
  )
}

export function Delta({ v }: { v: number | null }) {
  if (v === null || !isFinite(v)) return null
  return <span className={`ds-delta ${v < 0 ? 'is-neg' : ''}`}><span className="tri" />{v > 0 ? '+' : ''}{Math.round(v * 100)}%</span>
}

export function Estatisticas({ onAbrir, rede }: { onAbrir: (p: PostCal) => void; rede: string }) {
  const [todos, setPosts] = useState<PostCal[]>([])
  const posts = useMemo(() => todos.filter((p) => !rede || p.rede === rede || (p.rede === 'multi' && (p.redes ?? []).includes(rede))), [todos, rede])
  useEffect(() => {
    const hoje = new Date()
    const de = new Date(hoje.getTime() - 62 * DIA), ate = new Date(hoje.getTime() + 46 * DIA)
    fetch(`/api/calendario?de=${iso(de)}&ate=${iso(ate)}`).then((r) => r.json()).then((r) => setPosts(r.posts)).catch(() => {})
  }, [])

  const e = useMemo(() => {
    const agora = Date.now()
    const pub = posts.filter((p) => p.estado === 'publicado').sort((a, b) => a.quando.localeCompare(b.quando))
    const t = (p: PostCal) => new Date(p.quando).getTime()
    // Viralizando: o melhor dos últimos 30 dias contra a mediana do período
    const ult30 = pub.filter((p) => agora - t(p) <= 30 * DIA)
    const viral = ult30.reduce<PostCal | null>((m, p) => (!m || num(p.metricas.views) > num(m.metricas.views) ? p : m), null)
    const med = mediana(ult30.filter((p) => p !== viral).map((p) => num(p.metricas.views)))
    const serie = ult30.slice(-10)
    // Views da semana: soma por semana (8 semanas), a última em destaque
    const semanas = Array.from({ length: 8 }, (_, i) => {
      const fim = agora - (7 - i) * 7 * DIA, ini = fim - 7 * DIA
      return pub.filter((p) => t(p) > ini && t(p) <= fim).reduce((s, p) => s + num(p.metricas.views), 0)
    })
    const sem = semanas[7], ant = semanas[6]
    // Engajamento: (curtidas + comentários + compartilhamentos + salvos) / alcance, 30 dias contra os 30 anteriores
    const eng = (l: PostCal[]) => {
      const alc = l.reduce((s, p) => s + num(p.metricas.alcance), 0)
      const int = l.reduce((s, p) => s + num(p.metricas.curtidas) + num(p.metricas.comentarios) + num(p.metricas.compartilhamentos) + num(p.metricas.salvos), 0)
      return alc ? int / alc : 0
    }
    const eng30 = eng(ult30), engAnt = eng(pub.filter((p) => agora - t(p) > 30 * DIA && agora - t(p) <= 60 * DIA))
    // Agendados: próximos 7 dias
    const ag = posts.filter((p) => p.estado === 'agendado' && t(p) >= agora).sort((a, b) => a.quando.localeCompare(b.quando))
    const prox7 = Array.from({ length: 7 }, (_, i) => { const d = iso(new Date(agora + i * DIA)); return ag.some((p) => p.quando.startsWith(d)) })
    return { viral, med, mult: viral && med ? num(viral.metricas.views) / med : null, serie, semanas, sem, ant, eng30, engAnt, ag, prox7, n30: ult30.length }
  }, [posts])

  if (!todos.length) return null
  if (!posts.some((p) => p.estado === 'publicado')) return <div className="ds-vazio glass glass--light">Sem posts publicados desta rede no período. Se acabou de reconectar no Metricool, a sincronização pode levar algumas horas.</div>
  const iViral = e.viral ? e.serie.findIndex((p) => p.id === e.viral!.id) : -1
  const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const diaSem = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

  return (
    <div className="ds-stats">
      {e.viral && (
        <article className="ds-card ds-vir glass glass--escuro" onClick={() => onAbrir(e.viral!)} role="button" tabIndex={0}>
          <header className="ds-topo">
            <h3>Viralizando</h3>{e.mult && <><span className="ds-dot" /><span className="ds-mult">{e.mult.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x</span></>}
            <span className="ds-seta"><Icone n="seta" t={14} /></span>
          </header>
          <p className="ds-head">{manchete(e.viral.legenda) || 'Post sem legenda'}</p>
          <p className="ds-sub">{curto(num(e.viral.metricas.views))} views · {dia(e.viral.quando)} · a mediana dos outros {e.n30 - 1} posts dos últimos 30 dias é {curto(e.med)}</p>
          <Linha id="vir" w={420} h={92} valores={e.serie.map((p) => num(p.metricas.views))} destaque={Math.max(iViral, 0)}
            rotulos={e.serie.map((p) => `${dia(p.quando)} · ${curto(num(p.metricas.views))} views`)}
            onPonto={(i) => onAbrir(e.serie[i])} />
        </article>
      )}

      <article className="ds-card glass glass--escuro">
        <header className="ds-topo"><h3>Views da semana</h3><span className="ds-seta"><Icone n="seta" t={14} /></span></header>
        <div className="ds-kpi"><span className="ds-num">{curto(e.sem)}</span><Delta v={e.ant ? (e.sem - e.ant) / e.ant : null} /></div>
        <Linha id="views" w={300} h={76} valores={e.semanas} destaque={7}
          rotulos={e.semanas.map((v, i) => `${i === 7 ? 'últimos 7 dias' : `há ${7 - i} sem.`} · ${curto(v)}`)} />
      </article>

      <article className="ds-card glass glass--escuro ds-eng">
        <header className="ds-topo"><h3>Engajamento</h3><span className="ds-seta"><Icone n="seta" t={14} /></span></header>
        <div className="ds-kpi"><span className="ds-num">{(e.eng30 * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span><Delta v={e.engAnt ? (e.eng30 - e.engAnt) / e.engAnt : null} /></div>
        <p className="ds-legenda">interações ÷ alcance, 30 dias</p>
        <Arco valor={e.eng30 / 0.12} />
      </article>

      <article className="ds-card glass glass--escuro ds-ag">
        <header className="ds-topo"><h3>Agendados</h3><span className="ds-seta"><Icone n="seta" t={14} /></span></header>
        <div className="ds-kpi"><span className="ds-num">{e.ag.length}</span>
          {e.ag[0] && <span className="ds-legenda">próximo: {dia(e.ag[0].quando)} às {e.ag[0].quando.slice(11, 16)}</span>}</div>
        <div className="ds-semana" aria-label="Próximos 7 dias">
          {e.prox7.map((tem, i) => {
            const d = new Date(Date.now() + i * DIA)
            return <span key={i} className={`ds-bola ${tem ? 'is-on' : ''}`} title={`${diaSem[d.getDay()]} ${dia(d.toISOString())}${tem ? ' · tem post' : ''}`}><i /><small>{diaSem[d.getDay()][0]}</small></span>
          })}
        </div>
      </article>
    </div>
  )
}
