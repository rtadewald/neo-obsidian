import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icone } from './Icone'
import { Estatisticas, type PostCal } from './Estatisticas'

type Post = {
  id: string; quando: string; estado: 'publicado' | 'agendado'; tipo: string | null; perfil: string
  legenda: string | null; url: string | null; thumb: string | null; redes: string[]; rede: string | null
  metricas: Record<string, number | string | null>
}
/** O mesmo conteúdo publicado em várias redes vira um grupo (um chip, com os selos empilhados). */
type Grupo = { id: string; quando: string; estado: Post['estado']; posts: Post[] }

export const REDES: [string, string, string][] = [['', 'Todas', '∗'], ['instagram', 'Instagram', 'IG'], ['tiktok', 'TikTok', 'TT'], ['youtube', 'YouTube', 'YT']]
const NOME_REDE: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', multi: 'várias redes' }
const SIGLA: Record<string, string> = { instagram: 'IG', tiktok: 'TT', youtube: 'YT', multi: '∗' }
/** O agendado ("multi") vale para todas as redes de destino dele. */
export const daRede = (p: { rede: string | null; redes?: string[] }, r: string) => !r || p.rede === r || (p.rede === 'multi' && (p.redes ?? []).includes(r))

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIA = 86400000
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const num = (v: unknown) => (typeof v === 'number' ? v : 0)
const curto = (n: unknown) => {
  if (typeof n !== 'number') return '—'
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (n >= 1e3) return `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: n >= 1e4 ? 0 : 1 })} mil`
  return n.toLocaleString('pt-BR')
}
const inteiro = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('pt-BR') : '—')
const segunda = (d: Date) => { const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s }
const semanaIso = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DIA + 1) / 7)
}

/** Junta posts de redes diferentes publicados com até 45 min de diferença (o mesmo vídeo no IG e no TikTok). */
function agrupar(posts: Post[]): Grupo[] {
  const ord = [...posts].sort((a, b) => a.quando.localeCompare(b.quando))
  const grupos: Grupo[] = []
  for (const p of ord) {
    const t = new Date(p.quando).getTime()
    const g = grupos.find((g) => g.estado === p.estado && p.estado === 'publicado' && !g.posts.some((x) => x.rede === p.rede)
      && Math.abs(new Date(g.quando).getTime() - t) <= 45 * 60000)
    if (g) g.posts.push(p)
    else grupos.push({ id: p.id, quando: p.quando, estado: p.estado, posts: [p] })
  }
  // Instagram primeiro (capa e legenda do grupo vêm dele)
  for (const g of grupos) g.posts.sort((a, b) => (a.rede === 'instagram' ? -1 : b.rede === 'instagram' ? 1 : 0))
  return grupos
}

export function Calendario() {
  const hoje = useMemo(() => new Date(), [])
  // de 9 semanas atrás até 8 semanas à frente, numa rolagem só
  const semanas = useMemo(() => {
    const ini = segunda(new Date(hoje.getTime() - 63 * DIA))
    return Array.from({ length: 18 }, (_, w) => Array.from({ length: 7 }, (_, d) => new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + w * 7 + d)))
  }, [hoje])
  const [posts, setPosts] = useState<Post[]>([])
  const [sinc, setSinc] = useState(false)
  const [aberto, setAberto] = useState<Grupo | null>(null)
  const [rede, setRede] = useState('')
  const [visivel, setVisivel] = useState('')
  const rolo = useRef<HTMLDivElement>(null)

  const carregar = useCallback(async () => {
    const ate = new Date(semanas[semanas.length - 1][6].getTime() + DIA)
    const r = await fetch(`/api/calendario?de=${iso(semanas[0][0])}&ate=${iso(ate)}`).then((x) => x.json())
    setPosts(r.posts)
    setSinc(r.sincronizando)
  }, [semanas])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    if (!sinc) return
    const t = setInterval(carregar, 4000)
    return () => clearInterval(t)
  }, [sinc, carregar])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(null)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])

  const irHoje = useCallback((suave = true) => {
    const el = rolo.current?.querySelector<HTMLElement>('.cal-dia.is-hoje')
    if (el && rolo.current) rolo.current.scrollTo({ top: el.offsetTop - rolo.current.clientHeight / 2 + 40, behavior: suave ? 'smooth' : 'auto' })
  }, [])
  useLayoutEffect(() => { irHoje(false) }, [irHoje])

  // rótulo "Outubro – Novembro 2026" do trecho visível
  const aoRolar = useCallback(() => {
    const r = rolo.current
    if (!r) return
    const linhas = [...r.querySelectorAll<HTMLElement>('.cal-semana')]
    const vis = linhas.filter((l) => l.offsetTop + l.offsetHeight > r.scrollTop && l.offsetTop < r.scrollTop + r.clientHeight)
    if (!vis.length) return
    const a = semanas[+vis[0].dataset.i!][0], b = semanas[+vis[vis.length - 1].dataset.i!][6]
    const nome = (d: Date) => MESES[d.getMonth()][0].toUpperCase() + MESES[d.getMonth()].slice(1)
    setVisivel(a.getMonth() === b.getMonth() ? `${nome(a)} ${a.getFullYear()}` : `${nome(a)} – ${nome(b)} ${b.getFullYear()}`)
  }, [semanas])
  useEffect(() => { aoRolar() }, [aoRolar, posts])

  const filtrados = useMemo(() => posts.filter((p) => daRede(p, rede)), [posts, rede])
  const porDia = useMemo(() => {
    const m: Record<string, Grupo[]> = {}
    for (const g of agrupar(filtrados)) (m[g.quando.slice(0, 10)] ??= []).push(g)
    return m
  }, [filtrados])
  const ult30 = filtrados.filter((p) => p.estado === 'publicado' && hoje.getTime() - new Date(p.quando).getTime() <= 30 * DIA)
  const agendados = filtrados.filter((p) => p.estado === 'agendado' && new Date(p.quando) >= hoje)

  async function sincronizar() {
    setSinc(true)
    await fetch('/api/calendario/sincronizar', { method: 'POST' })
  }

  return (
    <div className="cal">
      <div className="radar-cabeca">
        <div>
          <h1 className="titulo">Calendário</h1>
          <p className="sub">{ult30.length} publicações e {curto(ult30.reduce((s, p) => s + num(p.metricas.views), 0))} views nos últimos 30 dias · {agendados.length} agendado{agendados.length === 1 ? '' : 's'} · pelo Metricool</p>
        </div>
        <div className="acoes-topo">
          <div className="chips" role="group" aria-label="Rede">
            {REDES.map(([k, nome, sigla]) => (
              <button key={k} className={`chip-rede ${rede === k ? 'is-on' : ''}`} onClick={() => setRede(k)} title={nome} aria-pressed={rede === k}>
                <b className={`rede--${k || 'todas'}`}>{sigla}</b>
              </button>
            ))}
          </div>
          <button className="pilula" onClick={() => irHoje()}>Hoje</button>
          <button className="pilula pilula--escura" onClick={sincronizar} disabled={sinc}>
            <span className={sinc ? 'gira' : ''}><Icone n="atualizar" t={15} /></span>{sinc ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        </div>
      </div>

      <Estatisticas rede={rede} onAbrir={(p: PostCal) => setAberto(agrupar(filtrados).find((g) => g.posts.some((x) => x.id === p.id)) ?? null)} />

      <div className="cal-cont glass glass--light">
        <p className="cal-visivel">{visivel}</p>
        <div className="cal-topo">
          <span />
          <span className="cal-sem-rot">sem</span>
          {DIAS.map((d) => <span key={d} className="cal-dia-nome">{d}</span>)}
        </div>
        <div className="cal-rolo" ref={rolo} onScroll={aoRolar}>
          {semanas.map((sem, i) => {
            const comeco = sem.find((d) => d.getDate() === 1)
            return (
              <div key={i} className="cal-semana" data-i={i}>
                <span className="cal-mes-rot">{comeco ? MESES[comeco.getMonth()].slice(0, 3) : i === 0 ? MESES[sem[0].getMonth()].slice(0, 3) : ''}</span>
                <span className={`cal-sem ${sem.some((d) => iso(d) === iso(hoje)) ? 'is-atual' : ''}`}>{semanaIso(sem[0])}</span>
                {sem.map((d, j) => {
                  const k = iso(d)
                  const semAnterior = new Date(d.getTime() - 7 * DIA).getMonth() !== d.getMonth()
                  const borda = `${semAnterior ? 'b-topo' : ''} ${d.getDate() === 1 && j > 0 ? 'b-esq' : ''}`
                  return (
                    <div key={k} className={`cal-dia ${k === iso(hoje) ? 'is-hoje' : ''} ${d > hoje ? 'is-futuro' : ''} ${borda}`}>
                      <span className="cal-num">{d.getDate() === 1 ? `1 ${MESES[d.getMonth()].slice(0, 3)}` : d.getDate()}</span>
                      {(porDia[k] ?? []).map((g) => <Chip key={g.id} g={g} aberto={aberto?.id === g.id} onClick={() => setAberto(aberto?.id === g.id ? null : g)} />)}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {aberto && <Detalhe g={aberto} onFechar={() => setAberto(null)} />}
    </div>
  )
}

function Selos({ g }: { g: Grupo }) {
  const redes = g.posts[0].rede === 'multi' ? g.posts[0].redes.filter((r) => SIGLA[r]) : g.posts.map((p) => p.rede ?? '')
  return <span className="cal-selos">{redes.map((r) => <b key={r} className={`rede--${r}`} title={NOME_REDE[r] ?? r}>{SIGLA[r] ?? '·'}</b>)}</span>
}

function Chip({ g, aberto, onClick }: { g: Grupo; aberto: boolean; onClick: () => void }) {
  const capa = g.posts.find((p) => p.thumb)?.thumb
  const views = g.posts.reduce((s, p) => s + num(p.metricas.views), 0)
  return (
    <button className={`cal-post is-${g.estado} ${aberto ? 'is-aberto' : ''}`} onClick={onClick} title={(g.posts[0].legenda ?? '').slice(0, 120)}>
      <span className="cal-capa-chip">
        <span className="cal-thumb">{capa ? <img src={`/api/thumbs/${capa}`} alt="" loading="lazy" /> : null}</span>
        <Selos g={g} />
      </span>
      <span className="cal-num-post">{g.estado === 'agendado' ? g.quando.slice(11, 16) : curto(views)}</span>
    </button>
  )
}

function Detalhe({ g, onFechar }: { g: Grupo; onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false)
  const p = g.posts[0]
  const capa = g.posts.find((x) => x.thumb)?.thumb
  const legenda = g.posts.find((x) => x.legenda)?.legenda ?? ''
  const data = new Date(g.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const copiar = async () => { await navigator.clipboard.writeText(legenda); setCopiado(true); setTimeout(() => setCopiado(false), 1500) }
  const total = (k: string) => g.posts.reduce((s, x) => s + num(x.metricas[k]), 0)
  return (
    <div className="cal-veu" onClick={onFechar}>
      <article className="cal-detalhe glass glass--escuro" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Detalhes do post">
        <button className="btn-icone cal-fechar" onClick={onFechar} aria-label="Fechar"><Icone n="fechar" t={16} /></button>
        <div className="cal-capa">{capa ? <img src={`/api/thumbs/${capa}`} alt="" /> : <span>sem prévia</span>}</div>
        <p className="cal-perfil">{p.perfil} <Selos g={g} /></p>
        <p className="cal-meta">{p.tipo ?? 'Post'} · {data}{g.estado === 'agendado' ? ` · agendado (${p.redes.map((r) => NOME_REDE[r] ?? r).join(', ')})` : ''}</p>
        {typeof p.metricas.titulo === 'string' && p.metricas.titulo && <p className="cal-titulo-post">{p.metricas.titulo}</p>}
        <p className="cal-legenda">{legenda}</p>
        {g.estado === 'publicado' ? (
          <>
            {g.posts.length > 1 && (
              <div className="cal-numeros cal-total">
                <span title="Views somadas"><Icone n="play" t={16} />{inteiro(total('views'))}</span>
                <span title="Curtidas somadas"><Icone n="coracao" t={16} />{inteiro(total('curtidas'))}</span>
                <span className="cal-total-rot">somando {g.posts.map((x) => NOME_REDE[x.rede ?? ''] ?? x.rede).join(' e ')}</span>
              </div>
            )}
            {g.posts.map((x) => <Numeros key={x.id} p={x} varias={g.posts.length > 1} />)}
          </>
        ) : <p className="cal-agendado">Ainda não publicado: os números aparecem depois da publicação.</p>}
        <div className="cal-acoes">
          <button className="cal-link" onClick={copiar}>{copiado ? 'Legenda copiada' : 'Copiar legenda'}</button>
          {g.posts.filter((x) => x.url).map((x) => (
            <a key={x.id} className="cal-link" href={x.url!} target="_blank" rel="noreferrer">Abrir no {NOME_REDE[x.rede ?? ''] ?? 'post'} <Icone n="seta" t={12} /></a>
          ))}
        </div>
      </article>
    </div>
  )
}

function Numeros({ p, varias }: { p: Post; varias: boolean }) {
  const m = p.metricas
  return (
    <div className="cal-rede-bloco">
      {varias && <p className="cal-rede-nome"><b className={`rede--${p.rede}`}>{SIGLA[p.rede ?? ''] ?? '·'}</b>{NOME_REDE[p.rede ?? ''] ?? p.rede}</p>}
      <div className="cal-numeros">
        <span title="Views"><Icone n="play" t={16} />{inteiro(m.views)}</span>
        <span title="Curtidas"><Icone n="coracao" t={16} />{inteiro(m.curtidas)}</span>
        <span title="Comentários"><Icone n="chat" t={16} />{inteiro(m.comentarios)}</span>
        <span title="Compartilhamentos"><Icone n="enviar" t={16} />{inteiro(m.compartilhamentos)}</span>
        {p.rede === 'instagram' && <span title="Salvos"><Icone n="salvar" t={16} />{inteiro(m.salvos)}</span>}
        {/* o TikTok devolve alcance 0: só mostra quando a rede informa de verdade */}
        {num(m.alcance) > 0 && <span title="Alcance"><Icone n="usuario" t={16} />{inteiro(m.alcance)}</span>}
        {typeof m.retencao === 'number' && <span title="Retenção média">{Math.round(m.retencao)}% retenção</span>}
        {typeof m.duracao_media === 'number' && <span title="Duração média assistida">{Math.round(m.duracao_media)} s em média</span>}
        {typeof m.seguidores === 'number' && <span title="Novos seguidores">+{inteiro(m.seguidores)} seguidores</span>}
      </div>
      {m.fonte === 'perfil' && <p className="cal-agendado">Lido do seu perfil: o Metricool ainda não trouxe este post; alcance, compartilhamentos e salvos chegam quando ele sincronizar.</p>}
    </div>
  )
}
