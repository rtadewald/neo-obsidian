import { EscolherIdeia } from './EscolherIdeia'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { api, type Coleta, type Gosto, type Sinal, type VideoX } from './api'
import { Fonte, Icone } from './Icone'

const TIPOS: [string, string][] = [
  ['', 'Tudo'], ['modelo', 'Modelos'], ['tecnica', 'Técnicas'], ['projeto', 'Projetos'],
  ['ferramenta', 'Ferramentas'], ['hype', 'Em alta'], ['skill', 'Skills'], ['outro', 'Outros'], ['fora', 'Fora do tema'],
]
const NOME_TIPO = Object.fromEntries(TIPOS.filter(([k]) => k)) as Record<string, string>
const FONTES = ['x', 'github', 'huggingface', 'hackernews', 'instagram']
const NOME_FONTE: Record<string, string> = { x: 'X', github: 'GitHub', huggingface: 'Hugging Face', hackernews: 'Hacker News', instagram: 'Instagram' }

function quando(ts?: number) {
  if (!ts) return 'nunca'
  const min = Math.round((Date.now() / 1000 - ts) / 60)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`
}

let ultimoIr = 0

export function Radar({ foco = null, onConversar, onModo, ir, titulo = 'Radar', fontes = FONTES }: {
  titulo?: string; fontes?: string[]   // cada aba do radar mostra só as suas fontes (X sozinho; GitHub, HF e HN em Sites)
  foco?: Sinal | null; onConversar?: (s: Sinal) => void; onModo?: (emFoco: boolean) => void
  ir?: { id?: number; url?: string | null; n: number }   // mostrar este sinal no foco
}) {
  const [sinais, setSinais] = useState<Sinal[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; s: Sinal } | null>(null)   // botão direito num card: criar copy
  const tipo = ''   // o filtro de tipo saiu da tela; a classificação continua nos cards
  const [modo, setModo] = useState<'foco' | 'todos'>('todos')   // todos (padrão) ou foco: um sinal por vez
  const [pos, setPos] = useState(0)
  useEffect(() => { onModo?.(modo === 'foco') }, [modo, onModo])
  useEffect(() => () => onModo?.(false), [onModo])
  const [fonte, setFonte] = useState('')
  const [salvos, setSalvos] = useState(false)
  const [rodando, setRodando] = useState(false)
  const [ultima, setUltima] = useState<Coleta>(null)
  const [proxima, setProxima] = useState<number | undefined>()   // coleta automática uma vez por dia
  const [erro, setErro] = useState('')
  const [gosto, setGosto] = useState<Gosto | null>(null)
  const [reavaliando, setReavaliando] = useState(false)

  // A página do X mostra só o lote da última coleta (o Atualizar traz posts inéditos e o anterior sai da tela);
  // os curtidos de qualquer coleta ficam em Curtidos.
  // X e Instagram: a página mostra só o último lote (cada coleta troca a tela inteira)
  const soX = fontes.length === 1 && (fontes[0] === 'x' || fontes[0] === 'instagram')
  // Ordem congelada: cada sinal ganha um lugar quando chega e não sai dele (o like não troca os cards de lugar).
  // Recomeça ao trocar de filtro e quando uma coleta termina.
  const lugar = useRef(new Map<number, number>())
  const coletando = useRef(false)
  useEffect(() => { lugar.current = new Map() }, [salvos, tipo])
  const congelar = (l: Sinal[]) => {
    const m = lugar.current
    let n = m.size
    for (const s of l.filter((x) => !m.has(x.id)).sort((a, b) => pts(b) - pts(a))) m.set(s.id, n++)
    return l.slice().sort((a, b) => m.get(a.id)! - m.get(b.id)!)
  }

  const carregar = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([api.sinais(salvos ? 'curtido' : undefined, tipo === 'fora' ? 'fora' : undefined, soX ? fontes[0] : undefined, soX && !salvos), api.estado()])
      if (coletando.current && !e.rodando) lugar.current = new Map()   // chegou coleta nova: ordem nova
      coletando.current = e.rodando
      setSinais(congelar(s)); setRodando(e.rodando); setReavaliando(e.reavaliando); setUltima(e.ultima); setProxima(e.proxima); setErro('')
      api.gosto().then(setGosto).catch(() => {})
    } catch (e) { setErro(String(e)) }
  }, [salvos, tipo, soX, fontes])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {  // enquanto a coleta roda, confere a cada 3 s
    if (!rodando && !reavaliando) return
    const t = setInterval(carregar, 3000)
    return () => clearInterval(t)
  }, [rodando, reavaliando, carregar])
  const xPendente = sinais.some(noXPendente)
  useEffect(() => {  // enquanto um like está indo para o X, confere a cada 5 s
    if (!xPendente) return
    const t = setInterval(carregar, 5000)
    return () => clearInterval(t)
  }, [xPendente, carregar])

  const visiveis = useMemo(
    () => sinais.filter((s) => fontes.includes(s.fonte) && (!tipo || s.tipo === tipo) && (!fonte || s.fonte === fonte)),
    [sinais, tipo, fonte, fontes],
  )
  const destaques = salvos || tipo || fonte ? [] : visiveis.slice(0, 3)   // já vem na ordem congelada
  const resto = visiveis.filter((s) => !destaques.includes(s))
  // no foco a ordem é aleatória; a semente fixa a ordem (descartar um sinal não embaralha o resto de novo).
  // Em "Todos" fica o ranking.
  const [semente, setSemente] = useState(() => Math.random())
  const fila = useMemo(() => {
    const l = visiveis.slice()
    if (modo !== 'foco') return l   // a ordem congelada
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

  // F entra e sai do foco; no foco, ← → navegam, R sorteia e ⌘I manda o sinal da tela ao Claude Code
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (modo === 'foco' && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i' && atualRef.current) {
        e.preventDefault(); onConversar?.(atualRef.current); return
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

  // no foco, o like já passa para o próximo (o deslike tira da fila, então a posição fica)
  const votarFoco = (s: Sinal, v: number) => {
    votar(s, v)
    if (v === 1 && s.voto !== 1 && !salvos) setPos((p) => Math.min(p + 1, fila.length - 1))
  }

  async function marcar(s: Sinal, status: 'salvo' | 'descartado' | 'novo') {
    setSinais((l) => (status === 'descartado' || (salvos && status === 'novo') ? l.filter((x) => x.id !== s.id) : l.map((x) => (x.id === s.id ? { ...x, status } : x))))
    await api.status(s.id, status)
  }

  async function votar(s: Sinal, v: number) {
    const voto = s.voto === v ? 0 : v
    const x = REDES[s.fonte] ? { x_quer: voto === 1 ? 1 : s.x_feito ? 0 : null, x_erro: null } : {}
    setSinais((l) => (voto === -1 || (salvos && voto !== 1) ? l.filter((x) => x.id !== s.id) : l.map((y) => (y.id === s.id ? { ...y, ...x, voto } : y))))
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
    <div className="radar" onContextMenu={(e) => {
      // botão direito num card: menu "Nova copy" (com texto selecionado fica o menu do navegador, para copiar)
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-sinal]')
      const s = el && sinais.find((x) => String(x.id) === el.dataset.sinal)
      if (!s || window.getSelection()?.toString()) return
      e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, s })
    }}>
      <div className="radar-cabeca">
        <div className="radar-nome">
          <h1 className="titulo" title={[
            `${visiveis.length} sinais · última coleta ${quando(ultima?.fim)}`,
            proxima ? `Próxima coleta automática às ${new Date(proxima * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} (uma vez por dia, top 50 de cada fonte)` : '',
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
            <Icone n="like" t={15} /> Curtidos
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
          {salvos ? 'Nenhum curtido ainda. Dê like nos cards que você gostou.' : 'Nenhum sinal. Clique em Atualizar para coletar.'}
        </div>
      )}

      {modo === 'foco' ? atual && (
        <div className="foco-radar">
          <div className="foco-radar-modo">{seletorModo}{chipsFonte}</div>
          <div className="foco-radar-card" key={atual.id}>
            <Card s={atual} grande ativo={foco?.id === atual.id} onMarcar={marcar} onVotar={votarFoco} onConversar={onConversar} />
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
      {menu && <MenuAdicionar m={menu} onFechar={() => setMenu(null)} />}
    </div>
  )
}

/** Botão direito num card do radar: criar uma copy (em Priorizar) com o material do card, ou plugar numa copy que já existe. */
function MenuAdicionar({ m, onFechar }: { m: { x: number; y: number; s: Sinal }; onFechar: () => void }) {
  const caixa = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: m.x, y: m.y })
  const [estado, setEstado] = useState<{ ok?: string; erro?: string; indo?: boolean }>({})
  useEffect(() => {
    const r = caixa.current?.getBoundingClientRect()
    if (r) setPos({ x: Math.min(m.x, window.innerWidth - r.width - 8), y: Math.min(m.y, window.innerHeight - r.height - 8) })
  }, [m])
  useEffect(() => {
    const fora = (e: PointerEvent) => { if (!caixa.current?.contains(e.target as HTMLElement)) onFechar() }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('pointerdown', fora, true); window.addEventListener('keydown', esc); window.addEventListener('scroll', onFechar, true)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('keydown', esc); window.removeEventListener('scroll', onFechar, true) }
  }, [onFechar])
  const [plugar, setPlugar] = useState(false)   // escolher uma ideia que já existe em vez de criar outra
  const plugarEm = async (ideia: string) => {
    setEstado({ indo: true })
    try { await criarIdeia(m.s, ideia); setEstado({ ok: `Entrou em ${ideia}` }); window.setTimeout(onFechar, 1300) }
    catch (e) { setEstado({ erro: (e as Error).message }) }
  }
  const adicionar = async () => {
    setEstado({ indo: true })
    try { await criarIdeia(m.s); setEstado({ ok: '📄 Virou copy em Priorizar' }); window.setTimeout(onFechar, 1100) }
    catch (e) { setEstado({ erro: (e as Error).message }) }
  }
  return createPortal(
    <div ref={caixa} className="menu-ctx glass glass--light menu-adicionar" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <p className="menu-titulo">{plugar ? 'Plugar numa copy' : 'Nova copy'}</p>
      {estado.ok ? <p className="menu-aviso">{estado.ok}</p> : estado.erro ? <p className="menu-aviso is-erro">{estado.erro}</p> : plugar ? (
        <EscolherIdeia onEscolher={plugarEm} desligado={estado.indo} />
      ) : (
        <div className="menu-adicionar-lista">
          <button role="menuitem" disabled={estado.indo} onClick={adicionar}><span className="menu-emoji">📄</span>Criar copy em Priorizar</button>
        </div>
      )}
      {!estado.ok && <button type="button" className="menu-plugar" onClick={() => setPlugar((v) => !v)}>
        {plugar ? '← Criar uma copy nova' : 'Plugar numa copy que já existe ›'}</button>}
    </div>, document.body)
}

const LISTA_ATALHOS: [string, [string, string][]][] = [
  ['Em qualquer lugar', [['⌃1 … ⌃8', 'As abas da navbar, na ordem'], ['⌘O', 'Buscar notas'], ['W', 'Esconder a navbar']]],
  ['Radar · Foco', [['← →', 'Anterior e próximo'], ['R', 'Embaralhar de novo'], ['⌘I', 'Mandar o sinal ao Claude'], ['F', 'Entrar e sair do foco'], ['?', 'Esta lista']]],
  ['Ideias', [['⌘B', 'Mostrar e esconder a lista de notas'], ['⌘I', 'Mandar o trecho ao Claude'], ['⌘S', 'Salvar agora'], ['⌘ clique', 'Abrir um [[link]]']]],
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
  const [n, setN] = useState(4)
  useEffect(() => {
    const el = caixa.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setN(Math.max(1, Math.min(4, Math.floor((e.contentRect.width + 16) / 276)))))
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
  onMarcar: (s: Sinal, st: 'salvo' | 'descartado' | 'novo') => void; onVotar: (s: Sinal, v: number) => void; onConversar?: (s: Sinal) => void
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

/** Like espelhado no X: o que se quer lá ainda não foi feito (e não deu erro). */
const REDES: Record<string, string> = { x: 'X', instagram: 'Instagram' }   // o like vai para a rede de origem
const noXPendente = (s: Sinal) => !!REDES[s.fonte] && s.x_quer != null && s.x_feito !== s.x_quer && !s.x_erro
const estadoNoX = (s: Sinal) => { const r = REDES[s.fonte] ?? 'X'
  return s.x_erro ? `Não consegui no ${r} (${s.x_erro}). Clique no like de novo para tentar.`
    : noXPendente(s) ? (s.x_quer ? `O like vai para o ${r} na próxima coleta` : `O like sai do ${r} na próxima coleta`) : s.x_feito === 1 ? `Curtido no ${r} também` : `O like também curte no ${r} (na próxima coleta)` }

/** Card do radar → copy em Priorizar, já com o título, o link, a imagem e o texto do card. */
async function criarIdeia(s: Sinal, ideia?: string) {
  const m = s.metricas as { texto?: string }
  const titulo = REDES[s.fonte] ? `${s.autor ?? REDES[s.fonte]}: ${(m.texto || s.titulo || '').replace(/\s+/g, ' ').slice(0, 60)}` : s.titulo
  const conteudo = [s.url, s.porque && `> ${s.porque}`, m.texto || s.resumo, s.autor && `Fonte: ${s.autor}`].filter(Boolean).join('\n\n')
  const r = await fetch('/api/copies/entrada', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conteudo: conteudo || titulo, pronto: { titulo, url: s.url, thumb: s.imagem }, ...(ideia ? { ideia } : {}) }),
  })
  if (!r.ok) throw new Error(ideia ? 'Não consegui plugar na ideia.' : 'Não consegui criar a ideia.')
}

function Acoes({ s, onVotar, onConversar }: Omit<PropsCard, 'grande' | 'ativo'>) {
  const [criando, setCriando] = useState(false)
  const [feita, setFeita] = useState(false)
  const virarIdeia = async () => {
    if (feita) return
    setCriando(true)
    try { await criarIdeia(s); setFeita(true) } catch (e) { alert((e as Error).message) } finally { setCriando(false) }
  }
  return (
    <span className="acoes">
      <button className={`btn-icone acoes-like ${s.voto === 1 ? 'is-on' : ''}`} aria-label="Curti" aria-pressed={s.voto === 1}
        title={`Curti: mais disso (ensina o radar e fica em Curtidos)${REDES[s.fonte] ? '\n' + estadoNoX(s) : ''}`}
        onClick={() => onVotar(s, 1)}><Icone n="like" t={16} />
        {!!REDES[s.fonte] && (noXPendente(s) || s.x_erro || s.x_feito === 1) &&
          <i className={`acoes-x ${s.x_erro ? 'is-erro' : noXPendente(s) ? 'is-indo' : 'is-ok'}`} />}
      </button>
      <button className="btn-icone" aria-label="Não curti" title="Não curti: tira do feed e ensina o radar"
        onClick={() => onVotar(s, -1)}><Icone n="deslike" t={16} /></button>
      <span className="acoes-sep" />
      <button className={`btn-icone ${feita ? 'is-on' : ''}`} aria-label="Virar ideia" disabled={criando}
        title={feita ? 'Já virou copy em Priorizar' : 'Transformar em copy (em Priorizar)'}
        onClick={virarIdeia}><Icone n="ideia" t={16} /></button>
      {onConversar && <button className="btn-icone acoes-jarvis" aria-label="Mandar ao Claude" title="Mandar este card ao Claude Code (⌘I)" onClick={() => onConversar(s)}>
        <span className="orb orb--msg" /></button>}
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
    <article className={`card glass glass--light card--x ${s.url ? 'is-clicavel' : ''} ${ativo ? 'is-foco' : ''}`} onClick={abrirCard(s)} data-sinal={s.id}>
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

/** Reel do Instagram: @autor, a capa (abre o Reel; a legenda fica no hover) e embaixo views · curtidas · comentários · data. */
function CardInsta({ s, ativo, onMarcar, onVotar, onConversar }: PropsCard) {
  const m = s.metricas as { curtidas?: number; comentarios?: number; views?: number; texto?: string; origem?: string }
  return (
    <article className={`card glass glass--light card--x card--ig ${s.url ? 'is-clicavel' : ''} ${ativo ? 'is-foco' : ''}`} onClick={abrirCard(s)} data-sinal={s.id}>
      <div className="card-topo">
        <Fonte f="instagram" />
        {s.tipo && <span className="tipo">{NOME_TIPO[s.tipo] ?? s.tipo}</span>}
        {m.origem === 'algoritmo' && <span className="tipo" title="Veio da página de Reels (o algoritmo sugeriu), não de um perfil acompanhado">sugerido</span>}
        <Nota s={s} />
      </div>
      <p className="x-autor"><a href={`https://www.instagram.com/${s.autor}/`} target="_blank" rel="noreferrer"><b>@{s.autor}</b></a></p>
      {s.imagem && (
        <a className="x-midia is-video ig-capa" href={s.url ?? undefined} target="_blank" rel="noreferrer" aria-label="Abrir o Reel no Instagram"
          title={m.texto || s.titulo}>
          <img src={s.imagem} alt="" loading="lazy" referrerPolicy="no-referrer" />
          <span className="play" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M7 5.2v9.6l8-4.8Z" /></svg></span>
        </a>
      )}
      {/* sem a legenda no card (fica no hover da capa e vai para a ideia); os números embaixo da capa */}
      <div className="x-numeros">
        {!!m.views && <span title={`${fmt(m.views)} visualizações`}><Icone n="olho" t={14} />{compacto(m.views)}</span>}
        <span title={`${fmt(m.curtidas)} curtidas`}><Icone n="coracao" t={14} />{compacto(m.curtidas)}</span>
        <span title={`${fmt(m.comentarios)} comentários`}><Icone n="chat" t={14} />{compacto(m.comentarios)}</span>
        {s.publicado_em && <span title="Publicado em"><Icone n="calendario" t={14} />{new Date(s.publicado_em).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '')}</span>}
      </div>
      <div className="card-pe"><Acoes s={s} onMarcar={onMarcar} onVotar={onVotar} onConversar={onConversar} /></div>
    </article>
  )
}

function Card(props: PropsCard) {
  if (props.s.fonte === 'x') return <CardX {...props} />
  if (props.s.fonte === 'instagram') return <CardInsta {...props} />
  const { s, grande, ativo, onMarcar, onVotar, onConversar } = props
  return (
    <article className={`card glass ${grande ? 'glass--escuro card--grande' : 'glass--light'} ${s.url ? 'is-clicavel' : ''} ${ativo ? 'is-foco' : ''}`} onClick={abrirCard(s)} data-sinal={s.id}>
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
