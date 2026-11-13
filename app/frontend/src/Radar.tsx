import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { api, type Coleta, type Gosto, type Sinal, type VideoX } from './api'
import { Fonte, Icone } from './Icone'

const TIPOS: [string, string][] = [
  ['', 'Tudo'], ['modelo', 'Modelos'], ['tecnica', 'Técnicas'], ['projeto', 'Projetos'],
  ['ferramenta', 'Ferramentas'], ['hype', 'Em alta'], ['skill', 'Skills'], ['outro', 'Outros'], ['fora', 'Fora do tema'],
]
const NOME_TIPO = Object.fromEntries(TIPOS.filter(([k]) => k)) as Record<string, string>
const FONTES = ['x', 'github', 'huggingface', 'hackernews']
const NOME_FONTE: Record<string, string> = { x: 'X', github: 'GitHub', huggingface: 'Hugging Face', hackernews: 'Hacker News' }

function quando(ts?: number) {
  if (!ts) return 'nunca'
  const min = Math.round((Date.now() / 1000 - ts) / 60)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`
}

let ultimoIr = 0

export function Radar({ foco, onConversar, onModo, ir, titulo = 'Radar', fontes = FONTES }: {
  titulo?: string; fontes?: string[]   // cada aba do radar mostra só as suas fontes (X sozinho; GitHub, HF e HN em Sites)
  foco: Sinal | null; onConversar: (s: Sinal) => void; onModo?: (emFoco: boolean) => void
  ir?: { id?: number; url?: string | null; n: number }   // pedido do chat: mostrar este sinal no foco
}) {
  const [sinais, setSinais] = useState<Sinal[]>([])
  const tipo = ''   // o filtro de tipo saiu da tela; a classificação continua nos cards
  const [modo, setModo] = useState<'foco' | 'todos'>('todos')   // todos (padrão) ou foco: um sinal por vez
  const [pos, setPos] = useState(0)
  useEffect(() => { onModo?.(modo === 'foco') }, [modo, onModo])
  useEffect(() => () => onModo?.(false), [onModo])
  const [fonte, setFonte] = useState('')
  const [salvos, setSalvos] = useState(false)
  const [rodando, setRodando] = useState(false)
  const [ultima, setUltima] = useState<Coleta>(null)
  const [erro, setErro] = useState('')
  const [gosto, setGosto] = useState<Gosto | null>(null)
  const [reavaliando, setReavaliando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([api.sinais(salvos ? 'salvo' : undefined, tipo === 'fora' ? 'fora' : undefined), api.estado()])
      setSinais(s); setRodando(e.rodando); setReavaliando(e.reavaliando); setUltima(e.ultima); setErro('')
      api.gosto().then(setGosto).catch(() => {})
    } catch (e) { setErro(String(e)) }
  }, [salvos, tipo])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {  // enquanto a coleta roda, confere a cada 3 s
    if (!rodando && !reavaliando) return
    const t = setInterval(carregar, 3000)
    return () => clearInterval(t)
  }, [rodando, reavaliando, carregar])

  const visiveis = useMemo(
    () => sinais.filter((s) => fontes.includes(s.fonte) && (!tipo || s.tipo === tipo) && (!fonte || s.fonte === fonte)),
    [sinais, tipo, fonte, fontes],
  )
  const destaques = salvos || tipo || fonte ? [] : visiveis.slice().sort((a, b) => pts(b) - pts(a)).slice(0, 3)
  const resto = visiveis.filter((s) => !destaques.includes(s))
  // no foco a ordem é aleatória; a semente fixa a ordem (descartar um sinal não embaralha o resto de novo).
  // Em "Todos" fica o ranking.
  const [semente, setSemente] = useState(() => Math.random())
  const fila = useMemo(() => {
    const l = visiveis.slice()
    if (modo !== 'foco') return l.sort((a, b) => pts(b) - pts(a))
    const h = (id: number) => { const x = Math.sin(id * 12.9898 + semente * 78.233) * 43758.5453; return x - Math.floor(x) }
    return l.sort((a, b) => h(a.id) - h(b.id))
  }, [visiveis, modo, semente])
  const atual = fila[Math.min(pos, Math.max(0, fila.length - 1))]
  useEffect(() => setPos(0), [fonte, salvos])

  // vindo do chat: entra no foco sem filtros e para no card pedido (espera os sinais carregarem)
  const [alvo, setAlvo] = useState<{ id?: number; url?: string | null } | null>(null)
  useEffect(() => {
    if (!ir?.n || ir.n <= ultimoIr) return   // cada pedido vale uma vez (não repete ao voltar para a aba)
    ultimoIr = ir.n
    setModo('foco'); setFonte(''); setSalvos(false); setAlvo(ir)
  }, [ir])
  useEffect(() => {
    if (!alvo || !sinais.length || modo !== 'foco' || fonte || salvos) return
    const k = fila.findIndex((s) => (alvo.id != null && s.id === alvo.id) || (!!alvo.url && s.url === alvo.url))
    if (k >= 0) setPos(k)
    setAlvo(null)
  }, [alvo, fila, sinais.length, modo, fonte, salvos])
  useEffect(() => { if (pos > 0 && pos >= fila.length) setPos(Math.max(0, fila.length - 1)) }, [fila.length, pos])

  // R: embaralha a fila de novo e mostra o primeiro da nova ordem (um sinal sorteado)
  const sortear = useCallback(() => { setSemente(Math.random()); setPos(0) }, [])
  const [atalhos, setAtalhos] = useState(false)

  // entrar no foco limpa os filtros (eles somem da tela)
  const irPara = useCallback((m: 'foco' | 'todos') => { if (m === 'foco') setSalvos(false); setModo(m) }, [])

  const atualRef = useRef(atual)
  atualRef.current = atual

  // F entra e sai do foco; no foco, ← → navegam, R sorteia e ⌘I manda o sinal da tela para o chat
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (modo === 'foco' && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i' && atualRef.current) {
        e.preventDefault(); onConversar(atualRef.current); return
      }
      const alvo = e.target
      if (e.metaKey || e.ctrlKey || e.altKey || (alvo instanceof Element && alvo.closest('input, textarea, select, [contenteditable="true"]'))) return
      if (e.key === '?') { e.preventDefault(); setAtalhos((v) => !v); return }
      if (e.key.toLowerCase() === 'f' && !e.shiftKey) { e.preventDefault(); irPara(modo === 'foco' ? 'todos' : 'foco'); return }
      if (modo !== 'foco') return
      if (e.key === 'ArrowRight') { e.preventDefault(); setPos((p) => Math.min(p + 1, fila.length - 1)) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setPos((p) => Math.max(p - 1, 0)) }
      else if (e.key.toLowerCase() === 'r' && !e.shiftKey) { e.preventDefault(); sortear() }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [modo, fila.length, sortear, irPara, onConversar])

  // no foco, salvar e descartar já passam para o próximo (descartar tira da fila, então a posição fica)
  const marcarFoco = (s: Sinal, st: 'salvo' | 'descartado' | 'novo') => {
    marcar(s, st)
    if (st === 'salvo' && !salvos) setPos((p) => Math.min(p + 1, fila.length - 1))
  }

  async function marcar(s: Sinal, status: 'salvo' | 'descartado' | 'novo') {
    setSinais((l) => (status === 'descartado' || (salvos && status === 'novo') ? l.filter((x) => x.id !== s.id) : l.map((x) => (x.id === s.id ? { ...x, status } : x))))
    await api.status(s.id, status)
  }

  async function votar(s: Sinal, v: number) {
    const voto = s.voto === v ? 0 : v
    setSinais((l) => (voto === -1 ? l.filter((x) => x.id !== s.id) : l.map((x) => (x.id === s.id ? { ...x, voto, pontuacao: voto > 0 ? 100 : x.pontuacao } : x))))
    await api.votar(s.id, voto)
    api.gosto().then(setGosto).catch(() => {})
  }

  async function reavaliar() {
    setReavaliando(true)
    await api.reavaliar()
  }

  async function atualizar() {
    setRodando(true)
    await api.atualizar()
  }

  const det = (ultima?.detalhes ?? {}) as Record<string, { erro?: string } | string>
  const falhas = Object.entries(det).filter(([, v]) => typeof v === 'object' && v?.erro).map(([k]) => k)
  const semClassif = typeof det.classificacao_erro === 'string' && sinais.some((s) => !s.tipo)

  const chipsFonte = fontes.length > 1 && (
    <div className="chips" role="group" aria-label="Fonte">
      {fontes.map((f) => (
        <button key={f} className={`chip-fonte ${fonte === f ? 'is-on' : ''} ${fonte && fonte !== f ? 'is-apagado' : ''}`}
          onClick={() => setFonte(fonte === f ? '' : f)} title={NOME_FONTE[f]} aria-label={NOME_FONTE[f]} aria-pressed={fonte === f}>
          <Fonte f={f} so />
        </button>
      ))}
    </div>
  )

  const seletorModo = (
    <div className="abas glass glass--light modo-radar" role="tablist" aria-label="Modo">
      <button role="tab" aria-selected={modo === 'foco'} className={`aba ${modo === 'foco' ? 'is-ativa' : ''}`} onClick={() => irPara('foco')} title="Um sinal por vez (F)">Foco</button>
      <button role="tab" aria-selected={modo === 'todos'} className={`aba ${modo === 'todos' ? 'is-ativa' : ''}`} onClick={() => irPara('todos')} title="Todos os sinais em grade (F)">Todos</button>
    </div>
  )

  return (
    <div className="radar">
      <div className="radar-cabeca">
        <div className="radar-nome">
          <h1 className="titulo" title={[
            `${visiveis.length} sinais · última coleta ${quando(ultima?.fim)}`,
            gosto && gosto.likes + gosto.deslikes > 0 ? `Aprendendo com ${gosto.likes} likes e ${gosto.deslikes} deslikes` : '',
            gosto?.gosta.length ? `Curte: ${gosto.gosta.join(', ')}` : '', gosto?.evita.length ? `Evita: ${gosto.evita.join(', ')}` : '',
          ].filter(Boolean).join('\n')}>{titulo}</h1>
          {(falhas.length > 0 || semClassif) && (
            <span className="radar-alerta" title={[falhas.length ? `A última coleta falhou em: ${falhas.join(', ')}` : '', semClassif ? 'Sinais sem classificação (login do Claude Code)' : ''].filter(Boolean).join('\n')}>
              {falhas.length ? `falhou: ${falhas.join(', ')}` : 'sem classificação'}
            </span>
          )}
        </div>
        <div className="acoes-topo">
          {modo === 'todos' && seletorModo}
          {modo === 'todos' && <>
          {chipsFonte}
          {gosto && gosto.likes + gosto.deslikes >= 3 && (
            <button className="pilula" onClick={reavaliar} disabled={reavaliando} title="Refaz a nota de interesse dos sinais recentes com o seu gosto atual (Haiku)">
              <span className={reavaliando ? 'gira' : ''}><Icone n="raio" t={15} /></span>{reavaliando ? 'Reavaliando…' : 'Reavaliar'}
            </button>
          )}
          <button className={`pilula ${salvos ? 'is-on' : ''}`} onClick={() => setSalvos((v) => !v)}>
            <Icone n="salvar" t={15} /> Salvos
          </button>
          <button className="pilula pilula--escura" onClick={atualizar} disabled={rodando}>
            <span className={rodando ? 'gira' : ''}><Icone n="atualizar" t={15} /></span>
            {rodando ? 'Coletando…' : 'Atualizar'}
          </button>
          </>}
        </div>
      </div>

      {erro && <div className="vazio glass glass--light">Não consegui falar com o backend: {erro}</div>}
      {!erro && visiveis.length === 0 && (
        <div className="vazio glass glass--light">
          {salvos ? 'Nada salvo ainda. Use o marcador nos cards.' : 'Nenhum sinal. Clique em Atualizar para coletar.'}
        </div>
      )}

      {modo === 'foco' ? atual && (
        <div className="foco-radar">
          <div className="foco-radar-modo">{seletorModo}{chipsFonte}</div>
          <div className="foco-radar-card" key={atual.id}>
            <Card s={atual} grande ativo={foco?.id === atual.id} onMarcar={marcarFoco} onVotar={votar} onConversar={onConversar} />
          </div>
          <div className="foco-radar-nav">
            <button className="btn-icone foco-radar-seta" onClick={() => setPos((p) => Math.max(p - 1, 0))} disabled={pos === 0} aria-label="Anterior (←)" title="Anterior (←)">
              <svg width="18" height="18" viewBox="0 0 20 20"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
            </button>
            <span className="foco-radar-conta"><b>{Math.min(pos, fila.length - 1) + 1}</b> de {fila.length}</span>
            <button className="btn-icone foco-radar-seta" onClick={() => setPos((p) => Math.min(p + 1, fila.length - 1))} disabled={pos >= fila.length - 1} aria-label="Próximo (→)" title="Próximo (→)">
              <svg width="18" height="18" viewBox="0 0 20 20"><path d="M7.5 4.5 13 10l-5.5 5.5" /></svg>
            </button>
            <button className="btn-icone foco-radar-seta foco-radar-sorteio" onClick={sortear} aria-label="Embaralhar (R)" title="Embaralhar de novo (R)">
              <svg width="18" height="18" viewBox="0 0 20 20"><path d="M3 6h3.2c1.7 0 2.7.8 3.6 2.2l1.4 2.4c.9 1.5 2 2.4 3.7 2.4H17M3 14h3.2c1.2 0 2-.4 2.7-1.2M11.1 7.2c.7-.8 1.5-1.2 2.8-1.2H17M14.8 3.8 17 6l-2.2 2.2M14.8 10.8 17 13l-2.2 2.2" /></svg>
            </button>
            <button className="btn-icone foco-radar-seta" onClick={() => setAtalhos(true)} aria-label="Atalhos (?)" title="Atalhos (?)">
              <svg width="19" height="19" viewBox="0 0 20 20"><rect x="2.6" y="5" width="14.8" height="10" rx="2.2" /><path d="M5.6 8.2h.01M8.4 8.2h.01M11.2 8.2h.01M14 8.2h.01M6.6 11.8h6.8" /></svg>
            </button>
          </div>
        </div>
      ) : (
        <Mosaico itens={[...destaques, ...resto]} render={(s) => (
          <Card key={s.id} s={s} grande={destaques.includes(s)} ativo={foco?.id === s.id} onMarcar={marcar} onVotar={votar} onConversar={onConversar} />
        )} />
      )}
      {atalhos && <Atalhos onFechar={() => setAtalhos(false)} />}
    </div>
  )
}

const LISTA_ATALHOS: [string, [string, string][]][] = [
  ['Em qualquer lugar', [['⌘1 … ⌘4', 'Radar, Ideias, Desempenho, Calendário'], ['⌘P', 'Buscar notas'], ['Esc', 'Sair do campo do chat']]],
  ['Radar · Foco', [['← →', 'Anterior e próximo'], ['R', 'Embaralhar de novo'], ['⌘I', 'Levar o sinal ao Jarvis'], ['F', 'Entrar e sair do foco'], ['?', 'Esta lista']]],
  ['Ideias', [['⌘B', 'Mostrar e esconder a lista de notas'], ['⌘I', 'Mandar o trecho ao Jarvis'], ['⌘S', 'Salvar agora'], ['⌘ clique', 'Abrir um [[link]]']]],
]

function Atalhos({ onFechar }: { onFechar: () => void }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onFechar() } }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onFechar])
  return (
    <div className="paleta-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="atalhos glass glass--light" role="dialog" aria-label="Atalhos">
        <header><b>Atalhos</b><button className="btn-icone" onClick={onFechar} aria-label="Fechar"><Icone n="fechar" t={14} /></button></header>
        {LISTA_ATALHOS.map(([grupo, itens]) => (
          <section key={grupo}>
            <p className="atalhos-grupo">{grupo}</p>
            {itens.map(([k, o]) => <div key={k + o} className="atalhos-linha"><kbd>{k}</kbd><span>{o}</span></div>)}
          </section>
        ))}
      </div>
    </div>
  )
}

/** Masonry: colunas independentes, cada card vai para a coluna mais baixa (altura estimada), na ordem do ranking.
 *  Assim os destaques ficam no topo de cada coluna e nunca sobra buraco embaixo de um card mais curto. */
function Mosaico({ itens, render }: { itens: Sinal[]; render: (s: Sinal) => React.ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null)
  const [n, setN] = useState(3)
  useEffect(() => {
    const el = caixa.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setN(Math.max(1, Math.min(3, Math.floor((e.contentRect.width + 16) / 276)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const colunas = useMemo(() => {
    const cols: Sinal[][] = Array.from({ length: n }, () => [])
    const alt = Array(n).fill(0)
    for (const s of itens) {
      const m = s.metricas as { midia?: string | null }
      const video = m.midia === 'video' || /video_thumb|tweet_video/.test(s.imagem ?? '')
      const est = 190 + (video ? 420 : s.imagem ? 210 : 0) + Math.min(400, (s.resumo?.length ?? 0) * 0.35)
      const k = alt.indexOf(Math.min(...alt))
      cols[k].push(s); alt[k] += est + 16
    }
    return cols
  }, [itens, n])
  return (
    <div ref={caixa} className="mosaico">
      {colunas.map((c, i) => <div key={i} className="mosaico-col">{c.map(render)}</div>)}
    </div>
  )
}

type PropsCard = {
  s: Sinal; grande?: boolean; ativo?: boolean
  onMarcar: (s: Sinal, st: 'salvo' | 'descartado' | 'novo') => void; onVotar: (s: Sinal, v: number) => void; onConversar: (s: Sinal) => void
}

const pts = (s: Sinal) => s.pontuacao ?? s.nota

/** Pontuação com a explicação: potencial da fonte, interesse pelo seu gosto e o que pesou dos seus votos. */
function Nota({ s }: { s: Sinal }) {
  const partes = [`Potencial na fonte: ${Math.round(s.nota)}`]
  if (s.interesse != null) partes.push(`Interesse pelo seu gosto: ${Math.round(s.interesse)}`)
  if (s.afinidade) partes.push(`Afinidade com seus votos: ${s.afinidade > 0 ? '+' : ''}${Math.round(s.afinidade * 20)}`)
  if (s.motivos?.length) partes.push(`Pesou: ${s.motivos.join(', ')}`)
  if (s.voto && s.voto > 0) partes.push('Você curtiu')
  const sobe = (s.afinidade ?? 0) > 0.15, desce = (s.afinidade ?? 0) < -0.15
  return (
    <span className={`nota ${s.voto && s.voto > 0 ? 'is-curtido' : ''}`} title={partes.join('\n')}>
      {sobe && <i className="nota-seta">▲</i>}{desce && <i className="nota-seta is-desce">▼</i>}{Math.round(pts(s))}
    </span>
  )
}

/** 63.238 → "63 mil", 11.873.061 → "11,9 mi" */
const compacto = (n: unknown) => {
  if (typeof n !== 'number') return '0'
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (n >= 1e4) return `${Math.round(n / 1e3).toLocaleString('pt-BR')} mil`
  return n.toLocaleString('pt-BR')
}
const fmt = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('pt-BR') : '0')
const dataPost = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '') : ''

function Acoes({ s, onMarcar, onVotar, onConversar }: Omit<PropsCard, 'grande' | 'ativo'>) {
  return (
    <span className="acoes">
      <button className={`btn-icone ${s.voto === 1 ? 'is-on' : ''}`} aria-label="Curti" title="Curti: mais disso" aria-pressed={s.voto === 1}
        onClick={() => onVotar(s, 1)}><Icone n="like" t={16} /></button>
      <button className="btn-icone" aria-label="Não curti" title="Não curti: menos disso (some do feed)"
        onClick={() => onVotar(s, -1)}><Icone n="deslike" t={16} /></button>
      <span className="acoes-sep" />
      <button className={`btn-icone ${s.status === 'salvo' ? 'is-on' : ''}`} aria-label="Salvar" title="Salvar"
        onClick={() => onMarcar(s, s.status === 'salvo' ? 'novo' : 'salvo')}><Icone n="salvar" t={16} /></button>
      <button className="btn-icone" aria-label="Descartar" title="Descartar (sem ensinar nada)" onClick={() => onMarcar(s, 'descartado')}><Icone n="fechar" t={16} /></button>
      <button className="btn-icone" aria-label="Conversar sobre" title="Levar para o chat" onClick={() => onConversar(s)}><Icone n="chat" t={16} /></button>
    </span>
  )
}

/** Clique em qualquer parte do card abre a fonte em outra aba (menos nos botões, links, vídeo e quando há texto selecionado). */
function abrirCard(s: Sinal) {
  return (e: MouseEvent) => {
    if (!s.url) return
    if ((e.target as HTMLElement).closest('button, a, video, input, textarea, select')) return
    if (window.getSelection()?.toString()) return
    window.open(s.url, '_blank', 'noopener,noreferrer')
  }
}

/** Post do X: @autor · likes · data, link, o texto inteiro e a mídia embaixo (vídeo com play), como no Telegram. */
function CardX({ s, ativo, onMarcar, onVotar, onConversar }: PropsCard) {
  const m = s.metricas as { curtidas?: number; views?: number; midia?: string | null; texto?: string }
  const texto = m.texto || [s.titulo, s.resumo].filter(Boolean).join(' ').replace(/…\s*/, ' ')
  const video = m.midia === 'video' || /video_thumb|tweet_video/.test(s.imagem ?? '')
  return (
    <article className={`card glass glass--light card--x ${s.url ? 'is-clicavel' : ''} ${ativo ? 'is-foco' : ''}`} onClick={abrirCard(s)}>
      <div className="card-topo">
        <Fonte f="x" />
        {s.tipo && <span className="tipo">{NOME_TIPO[s.tipo] ?? s.tipo}</span>}
        <Nota s={s} />
      </div>
      <p className="x-autor"><b>{s.autor}</b></p>
      <div className="x-numeros">
        <span title={`${fmt(m.curtidas)} curtidas`}><Icone n="coracao" t={14} />{compacto(m.curtidas)}</span>
        {!!m.views && <span title={`${fmt(m.views)} visualizações`}><Icone n="olho" t={14} />{compacto(m.views)}</span>}
        {s.publicado_em && <span title="Publicado em"><Icone n="calendario" t={14} />{dataPost(s.publicado_em)}</span>}
      </div>
      {s.url && <a className="x-link" href={s.url} target="_blank" rel="noreferrer">{s.url.replace('https://', '')}</a>}
      <p className="x-texto">{texto}</p>
      {video && <VideoNoCard s={s} />}
      {s.imagem && !video && (
        <a className={`x-midia ${video ? 'is-video' : ''}`} href={s.url ?? undefined} target="_blank" rel="noreferrer" aria-label={video ? 'Abrir vídeo no X' : 'Abrir imagem no X'}>
          <img src={s.imagem} alt="" loading="lazy" referrerPolicy="no-referrer" />
          {video && <span className="play" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M7 5.2v9.6l8-4.8Z" /></svg></span>}
          {m.midia === 'link' && <span className="x-midia-tag">prévia do link</span>}
        </a>
      )}
      <div className="card-pe"><Acoes s={s} onMarcar={onMarcar} onVotar={onVotar} onConversar={onConversar} /></div>
    </article>
  )
}

function Card(props: PropsCard) {
  if (props.s.fonte === 'x') return <CardX {...props} />
  const { s, grande, ativo, onMarcar, onVotar, onConversar } = props
  return (
    <article className={`card glass ${grande ? 'glass--escuro card--grande' : 'glass--light'} ${s.url ? 'is-clicavel' : ''} ${ativo ? 'is-foco' : ''}`} onClick={abrirCard(s)}>
      <div className="card-topo">
        <Fonte f={s.fonte} />
        {s.tipo && <span className="tipo">{NOME_TIPO[s.tipo] ?? s.tipo}</span>}
        <Nota s={s} />
      </div>
      <h3 className="card-titulo">{s.titulo}</h3>
      {s.porque ? <p className="porque">{s.porque}</p> : null}
      {s.resumo ? <p className="resumo">{s.resumo}</p> : null}
      <div className="card-pe">
        {s.destaque && <span className="destaque"><span className="ponto" />{s.destaque}</span>}
        <Acoes s={s} onMarcar={onMarcar} onVotar={onVotar} onConversar={onConversar} />
      </div>
    </article>
  )
}

/** Vídeo do X tocando no card: busca o MP4 quando o card chega perto da tela, toca mudo e em loop
 *  enquanto está visível e pausa quando sai. Clique liga o som; o ↗ abre no X. */
function VideoNoCard({ s }: { s: Sinal }) {
  const caixa = useRef<HTMLDivElement>(null)
  const vid = useRef<HTMLVideoElement>(null)
  const [info, setInfo] = useState<VideoX | undefined>((s.metricas as { video?: VideoX }).video)
  const [perto, setPerto] = useState(false)
  const [mudo, setMudo] = useState(true)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {  // perto da tela (300 px antes): busca o MP4
    const el = caixa.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setPerto(true); io.disconnect() } }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {  // metade visível: toca; fora: pausa
    const v = vid.current
    if (!v) return
    const io = new IntersectionObserver(([e]) => {
      if (e.intersectionRatio >= 0.5) v.play().catch(() => {})
      else v.pause()
    }, { threshold: [0, 0.5, 1] })
    io.observe(v)
    return () => io.disconnect()
  }, [info, falhou])

  useEffect(() => {
    if (perto && info === undefined) api.video(s.id).then((r) => setInfo(r.video)).catch(() => setInfo(null))
  }, [perto, info, s.id])

  const proporcao = info?.w && info?.h ? Math.max(9 / 16, Math.min(16 / 9, info.w / info.h)) : 16 / 10
  return (
    <div ref={caixa} className="x-midia is-video x-video" style={{ aspectRatio: String(proporcao) }}>
      {info?.url && !falhou ? (
        <>
          <video ref={vid} src={info.url} poster={s.imagem ?? undefined} muted={mudo} autoPlay loop playsInline preload="metadata"
            onError={() => setFalhou(true)} onClick={() => setMudo((m) => !m)} />
          <button className="x-som" onClick={() => setMudo((m) => !m)} aria-label={mudo ? 'Ligar som' : 'Desligar som'}>
            <Icone n={mudo ? 'mudo' : 'som'} t={15} />
          </button>
        </>
      ) : (
        <a href={s.url ?? undefined} target="_blank" rel="noreferrer" aria-label="Abrir vídeo no X">
          {s.imagem && <img src={s.imagem} alt="" loading="lazy" referrerPolicy="no-referrer" />}
          <span className="play" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M7 5.2v9.6l8-4.8Z" /></svg></span>
        </a>
      )}
    </div>
  )
}
