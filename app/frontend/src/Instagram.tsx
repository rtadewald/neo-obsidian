import { useCallback, useEffect, useMemo, useState } from 'react'

/** Instagram: os canais que o Rodrigo monitora e os Reels deles, com métricas relativas ao próprio canal.
 *  Canais: cadastro à mão (@ ou link). Vídeos: grade 9:16 com outlier (views ÷ mediana do canal), views e engajamento,
 *  filtros de canal, data, outlier e ordem. A coleta roda no backend (o agente abre o Instagram no Chrome logado). */

type Canal = { handle: string; nome: string; seguidores: number; foto: string | null; reels: number; mediana: number; coletado: number | null; erro?: string | null }
type Video = {
  code: string; handle: string; data: number | null; views: number; curtidas: number; comentarios: number; duracao: number | null
  legenda: string; fixado?: boolean; outlier: number | null; engajamento: number | null; capa: string | null; video: string | null; url: string
}
type Estado = { rodando: boolean; etapa: string; ultima: number | null; erro: string | null }

const compacto = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)
const relativo = (t: number | null) => {
  if (!t) return ''
  const d = Math.floor((Date.now() / 1000 - t) / 86400)
  return d < 1 ? 'Hoje' : d === 1 ? '1d atrás' : d < 30 ? `${d}d atrás` : d < 365 ? `${Math.floor(d / 30)}m atrás` : `${Math.floor(d / 365)}a atrás`
}
const titulo = (l: string) => (l.split('\n').find((x) => x.trim()) ?? '').trim() || '(sem legenda)'

const DATAS = [['', 'Qualquer data'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['365', 'Último ano']] as const
const OUTLIERS = [['', 'Qualquer outlier'], ['1', '1x ou mais'], ['2', '2x ou mais'], ['3', '3x ou mais'], ['5', '5x ou mais']] as const
const ORDENS = [['outlier', 'Outlier'], ['views', 'Views'], ['data', 'Mais recentes'], ['engajamento', 'Engajamento']] as const

const SEM_CACHE: RequestInit = { cache: 'no-store' }   // as listas mudam a cada coleta

function guardado<T>(k: string, padrao: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : padrao } catch { return padrao } }
function guardar(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sem storage */ } }

export function Instagram() {
  const [vista, setVista] = useState<'canais' | 'videos'>(() => guardado('ig-vista', 'videos'))
  useEffect(() => guardar('ig-vista', vista), [vista])
  const [canais, setCanais] = useState<Canal[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [estado, setEstado] = useState<Estado>({ rodando: false, etapa: '', ultima: null, erro: null })
  const [aberto, setAberto] = useState<Video | null>(null)

  const recarregar = useCallback(() => {
    fetch('/api/ig/canais', SEM_CACHE).then((r) => r.json()).then(setCanais).catch(() => {})
    fetch('/api/ig/videos', SEM_CACHE).then((r) => r.json()).then(setVideos).catch(() => {})
  }, [])
  useEffect(() => { recarregar() }, [recarregar])
  // enquanto coleta, acompanha o estado; quando termina, recarrega
  useEffect(() => {
    let vivo = true, antes = false
    const ler = () => fetch('/api/ig/estado', SEM_CACHE).then((r) => r.json()).then((e: Estado) => {
      if (!vivo) return
      setEstado(e)
      if (antes && !e.rodando) recarregar()
      antes = e.rodando
    }).catch(() => {})
    ler()
    const id = window.setInterval(ler, 3000)
    return () => { vivo = false; window.clearInterval(id) }
  }, [recarregar])
  const atualizar = (so?: string[]) => fetch('/api/ig/atualizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ so: so ?? null }) })
    .then(() => setEstado((e) => ({ ...e, rodando: true, etapa: 'começando', erro: null })))

  return (
    <div className="igc">
      <header className="igc-topo">
        <div>
          <h1>{vista === 'canais' ? 'Canais' : 'Vídeos'}</h1>
          <p>{vista === 'canais' ? 'Os criadores que você acompanha no Instagram' : 'O que está performando nos canais que você acompanha, em relação a cada canal'}</p>
        </div>
        <nav className="igc-abas" role="tablist">
          <button role="tab" aria-selected={vista === 'videos'} className={vista === 'videos' ? 'is-on' : ''} onClick={() => setVista('videos')}>Vídeos <em>{videos.length}</em></button>
          <button role="tab" aria-selected={vista === 'canais'} className={vista === 'canais' ? 'is-on' : ''} onClick={() => setVista('canais')}>Canais <em>{canais.length}</em></button>
        </nav>
        <button className="igc-atualizar" disabled={estado.rodando || !canais.length} onClick={() => atualizar()}
          title="Coleta os Reels de todos os canais pelo Chrome logado (alguns minutos)">
          {estado.rodando ? <><i className="igc-giro" />{estado.etapa || 'coletando'}…</> : 'Atualizar'}</button>
      </header>
      {estado.erro && !estado.rodando && <p className="igc-erro">A última coleta falhou: {estado.erro}</p>}
      {vista === 'canais'
        ? <Canais canais={canais} onMudou={recarregar} onColetar={(h) => atualizar([h])} rodando={estado.rodando}
            onVer={(h) => { guardar('ig-filtro-canal', h); setVista('videos') }} />
        : <Videos videos={videos} canais={canais} onAbrir={setAberto} />}
      {aberto && <Player v={aberto} canal={canais.find((c) => c.handle === aberto.handle)} onFechar={() => setAberto(null)} />}
    </div>
  )
}

function Canais({ canais, onMudou, onColetar, onVer, rodando }: { canais: Canal[]; onMudou: () => void; onColetar: (h: string) => void; onVer: (h: string) => void; rodando: boolean }) {
  const [txt, setTxt] = useState('')
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const adicionar = async () => {
    if (!txt.trim()) return
    const r = await fetch('/api/ig/canais', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perfis: txt }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setErro(d.detail || 'Não consegui adicionar.'); return }
    setErro(null); setTxt(''); onMudou()
    if (d.novos?.length && !rodando) onColetar(d.novos[0])
  }
  const lista = canais.filter((c) => !busca.trim() || `${c.handle} ${c.nome}`.toLowerCase().includes(busca.toLowerCase()))
  return (
    <section className="igc-canais">
      <div className="igc-barra">
        <label className="igc-busca"><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nos canais" /></label>
        <form className="igc-novo" onSubmit={(e) => { e.preventDefault(); adicionar() }}>
          <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="@perfil ou link (vários: separe por espaço)" />
          <button type="submit" disabled={!txt.trim()}>＋ Adicionar canal</button>
        </form>
      </div>
      {erro && <p className="igc-erro">{erro}</p>}
      <p className="igc-conta">{canais.length ? `${canais.length} ${canais.length === 1 ? 'canal' : 'canais'} · ${canais.reduce((n, c) => n + c.reels, 0)} reels coletados` : 'Nenhum canal ainda. Adicione o primeiro acima.'}</p>
      <div className="igc-grade-canais">
        {lista.map((c) => (
          <article key={c.handle} className="igc-canal" onClick={() => onVer(c.handle)} title={`Ver os vídeos de @${c.handle}`}>
            <div className="igc-avatar">{c.foto ? <img src={c.foto} alt="" /> : <span>{c.handle[0].toUpperCase()}</span>}<i className="igc-ig" /></div>
            <div className="igc-canal-txt">
              <b>{c.handle}</b>
              <span>{c.seguidores ? `${compacto(c.seguidores)} seguidores` : c.coletado ? '—' : 'ainda não coletado'}</span>
              {c.reels > 0 && <em>{c.reels} reels · mediana {compacto(c.mediana)} views</em>}
              {c.erro && <em className="igc-erro-mini" title={c.erro}>falhou na última coleta</em>}
            </div>
            <a className="igc-canal-link" href={`https://www.instagram.com/${c.handle}/`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Abrir no Instagram">↗</a>
            <button className="igc-canal-x" title="Parar de acompanhar (apaga os reels baixados dele)" onClick={(e) => {
              e.stopPropagation()
              if (window.confirm(`Parar de acompanhar @${c.handle}? Os reels baixados dele são apagados.`)) fetch(`/api/ig/canais/${c.handle}`, { method: 'DELETE' }).then(onMudou)
            }}>×</button>
          </article>
        ))}
      </div>
    </section>
  )
}

function Videos({ videos, canais, onAbrir }: { videos: Video[]; canais: Canal[]; onAbrir: (v: Video) => void }) {
  const [busca, setBusca] = useState('')
  const [canal, setCanal] = useState<string>(() => guardado('ig-filtro-canal', ''))
  const [dias, setDias] = useState<string>(() => guardado('ig-filtro-dias', '30'))
  const [minOut, setMinOut] = useState<string>(() => guardado('ig-filtro-outlier', ''))
  const [ordem, setOrdem] = useState<string>(() => guardado('ig-filtro-ordem', 'outlier'))
  useEffect(() => { guardar('ig-filtro-canal', canal); guardar('ig-filtro-dias', dias); guardar('ig-filtro-outlier', minOut); guardar('ig-filtro-ordem', ordem) }, [canal, dias, minOut, ordem])
  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase()
    const desde = dias ? Date.now() / 1000 - Number(dias) * 86400 : 0
    const l = videos.filter((v) => (!canal || v.handle === canal) && (!desde || (v.data ?? 0) >= desde) && (!minOut || (v.outlier ?? 0) >= Number(minOut))
      && (!b || v.legenda.toLowerCase().includes(b) || v.handle.includes(b)))
    const chave = (v: Video) => ordem === 'views' ? v.views : ordem === 'data' ? (v.data ?? 0) : ordem === 'engajamento' ? (v.engajamento ?? 0) : (v.outlier ?? 0)
    return l.sort((a, b2) => chave(b2) - chave(a))
  }, [videos, busca, canal, dias, minOut, ordem])
  const limpar = () => { setBusca(''); setCanal(''); setDias(''); setMinOut(''); setOrdem('outlier') }
  return (
    <section className="igc-videos">
      <div className="igc-barra">
        <label className="igc-busca"><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por assunto ou canal" /></label>
      </div>
      <div className="igc-filtros">
        <select value={canal} onChange={(e) => setCanal(e.target.value)} className={canal ? 'is-on' : ''}>
          <option value="">Todos os canais</option>{canais.map((c) => <option key={c.handle} value={c.handle}>@{c.handle}</option>)}
        </select>
        <select value={dias} onChange={(e) => setDias(e.target.value)} className={dias ? 'is-on' : ''}>{DATAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select>
        <select value={minOut} onChange={(e) => setMinOut(e.target.value)} className={minOut ? 'is-on' : ''}>{OUTLIERS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select>
        <select value={ordem} onChange={(e) => setOrdem(e.target.value)}>{ORDENS.map(([v, r]) => <option key={v} value={v}>Ordenar: {r}</option>)}</select>
        {(busca || canal || dias || minOut || ordem !== 'outlier') && <button className="igc-limpar" onClick={limpar}>Limpar</button>}
        <span className="igc-conta">{lista.length} de {videos.length} vídeos</span>
      </div>
      {!videos.length && <p className="igc-vazio">Nenhum vídeo ainda. Cadastre canais na aba Canais e clique em Atualizar.</p>}
      <div className="igc-grade">
        {lista.map((v) => (
          <article key={v.code} className="igc-video" onClick={() => onAbrir(v)}>
            <div className="igc-capa">{v.capa ? <img src={v.capa} alt="" loading="lazy" /> : <span className="igc-sem-capa" />}<i className="igc-ig" />
              {v.duracao ? <span className="igc-dur">{Math.floor(v.duracao / 60)}:{String(Math.round(v.duracao % 60)).padStart(2, '0')}</span> : null}</div>
            <b className="igc-titulo" title={v.legenda}>{titulo(v.legenda)}</b>
            <div className="igc-meta"><span>@{v.handle}</span><span>{relativo(v.data)}</span></div>
            <Metricas v={v} />
          </article>
        ))}
      </div>
    </section>
  )
}

function Metricas({ v }: { v: Video }) {
  const alto = (v.outlier ?? 0) >= 1
  return (
    <div className="igc-metricas">
      <span className={`igc-pill ${alto ? 'is-alto' : 'is-baixo'}`} title="Outlier: views ÷ mediana das views do canal">{alto ? '↗' : '↘'} {v.outlier != null ? `${v.outlier.toFixed(1).replace('.', ',')}x` : '—'}</span>
      <span className="igc-pill is-views" title={`${v.views.toLocaleString('pt-BR')} views`}>👁 {compacto(v.views)}</span>
      <span className="igc-pill is-eng" title="Engajamento: (curtidas + comentários) ÷ views">✳ {v.engajamento != null ? `${(v.engajamento * 100).toFixed(1).replace('.', ',')}%` : '—'}</span>
    </div>
  )
}

function Player({ v, canal, onFechar }: { v: Video; canal?: Canal; onFechar: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onFechar() } }
    window.addEventListener('keydown', esc, true); return () => window.removeEventListener('keydown', esc, true)
  }, [onFechar])
  return (
    <div className="igc-player-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="igc-player glass glass--light" role="dialog" aria-label="Reel">
        <div className="igc-player-video">
          {v.video ? <video src={v.video} poster={v.capa ?? undefined} controls autoPlay playsInline loop />
            : v.capa ? <img src={v.capa} alt="" /> : null}
        </div>
        <div className="igc-player-info">
          <header><b>@{v.handle}</b><span>{relativo(v.data)}</span><button onClick={onFechar} aria-label="Fechar">×</button></header>
          <Metricas v={v} />
          <dl>
            <div><dt>Views</dt><dd>{v.views.toLocaleString('pt-BR')}</dd></div>
            <div><dt>Curtidas</dt><dd>{v.curtidas.toLocaleString('pt-BR')}</dd></div>
            <div><dt>Comentários</dt><dd>{v.comentarios.toLocaleString('pt-BR')}</dd></div>
            {canal && <div><dt>Mediana do canal</dt><dd>{canal.mediana.toLocaleString('pt-BR')}</dd></div>}
          </dl>
          <p className="igc-legenda">{v.legenda || '(sem legenda)'}</p>
          <a className="igc-link" href={v.url} target="_blank" rel="noreferrer">Abrir no Instagram ↗</a>
          {!v.video && <p className="mudo">O MP4 ainda não foi baixado.</p>}
        </div>
      </div>
    </div>
  )
}
