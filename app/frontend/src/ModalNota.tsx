import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from '@codemirror/view'
import { Editor } from './Editor'
import { Icone } from './Icone'
import { PASTA, obsidian, type Raiz, type Trecho } from './Ideias'
import { STATUS, carregarCanvas, pedidoSaida, porFormato, post, type Alvo, type EstadoCanvas, type Producao } from './canvasApi'

/** Modal estilo Notion: uma ideia e as saídas dela, uma por tab. Abre do canvas, do calendário e do ⌘P. */
type Nota = { nome: string; raiz: Raiz; caminho: string; texto: string; mtime: number }
type Estado = 'salvo' | 'editando' | 'salvando' | 'conflito' | 'erro'
const urlNota = (a: Alvo) => `/api/notas/${a.raiz}/${encodeURIComponent(a.nome)}`
const ROTULO: Record<Estado, string> = { salvo: 'Salvo', editando: 'Editando…', salvando: 'Salvando…', conflito: 'Mudou no Obsidian', erro: 'Erro ao salvar' }

async function acao(a: Alvo, corpo: Record<string, string>) {
  const r = await fetch(`${urlNota(a)}/acao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || 'Não deu certo.')
  return d as Alvo
}

export function ModalNota({ alvo, onFechar, onTrecho, onPedido, onMudou, versao }: {
  alvo: Alvo; onFechar: () => void
  onTrecho?: (t: Trecho, pedido?: string) => void
  onPedido?: (texto: string) => void          // manda um pedido pronto para o chat
  onMudou?: () => void                        // algo mudou no vault (o canvas recarrega)
  versao?: number                             // o chat terminou de responder
}) {
  const [est, setEst] = useState<EstadoCanvas | null>(null)
  const [ativa, setAtiva] = useState<Alvo>(alvo)
  const [mais, setMais] = useState(false)
  const [posMais, setPosMais] = useState({ left: 0, top: 0 })
  useEffect(() => {
    if (!mais) return
    const fora = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.menu-ctx, .is-mais')) setMais(false) }
    window.addEventListener('mousedown', fora)
    return () => window.removeEventListener('mousedown', fora)
  }, [mais])
  const [aviso, setAviso] = useState<string | null>(null)
  const avisar = (m: string) => { setAviso(m); window.setTimeout(() => setAviso((a) => (a === m ? null : a)), 2600) }

  const recarregar = useCallback(() => carregarCanvas().then(setEst).catch(() => {}), [])
  useEffect(() => { recarregar() }, [recarregar, versao])
  useEffect(() => setAtiva(alvo), [alvo])

  // o grupo: a ideia da nota ativa e todas as saídas dela
  const grupo = useMemo(() => {
    if (!est) return null
    const prod = est.producoes.find((p) => p.raiz === ativa.raiz && p.nome === ativa.nome)
    const nomeIdeia = ativa.raiz === 'ideias' ? ativa.nome : prod?.ideia ?? null
    const ideia = nomeIdeia ? est.ideias.find((i) => i.nome === nomeIdeia) ?? null : null
    const saidas = ideia ? est.producoes.filter((p) => p.ideia === ideia.nome).sort(porFormato) : prod ? [prod] : []
    const entradas = ideia ? est.entradas.filter((e) => ideia.fontes.includes(e.nome)) : []
    const usadaEm = ativa.raiz === 'entradas' ? est.ideias.filter((i) => i.fontes.includes(ativa.nome)) : []
    return { ideia, saidas, entradas, usadaEm, prod }
  }, [est, ativa])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.menu-ctx')) { e.preventDefault(); onFechar() } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  async function novaSaida(formato: string, nomeFormato: string) {
    setMais(false)
    if (!grupo) return
    try {
      let ideia = grupo.ideia?.nome
      if (!ideia && grupo.prod) {   // card solto: vira ideia primeiro, com o nome da copy
        const base = grupo.prod.nome.replace(/^[^\p{L}\p{N}]+/u, '').trim() || grupo.prod.nome
        ideia = (await post<Alvo>('agrupar', { titulo: base, producoes: [{ raiz: grupo.prod.raiz, nome: grupo.prod.nome }] })).nome
      }
      if (!ideia) return
      const d = await post<Alvo>('saida', { ideia, formato })
      await recarregar()
      onMudou?.()
      setAtiva(d)
      onPedido?.(pedidoSaida(ideia, d.nome, formato, nomeFormato))
      avisar('O Jarvis está escrevendo essa versão')
    } catch (e) { avisar((e as Error).message) }
  }

  const tabs: { alvo: Alvo; rotulo: string; prod?: Producao }[] = grupo
    ? [
        ...(grupo.ideia ? [{ alvo: { raiz: 'ideias' as Raiz, nome: grupo.ideia.nome }, rotulo: '💡 Ideia' }] : []),
        ...grupo.saidas.map((p) => ({ alvo: { raiz: p.raiz as Raiz, nome: p.nome }, rotulo: p.nome, prod: p })),
        ...(ativa.raiz === 'entradas' ? [{ alvo: ativa, rotulo: ativa.nome }] : []),
      ]
    : [{ alvo: ativa, rotulo: ativa.nome }]

  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal-nota glass glass--light" role="dialog" aria-label={ativa.nome}>
        <header className="modal-tabs">
          <nav role="tablist">
            {tabs.map((t) => (
              <button key={`${t.alvo.raiz}/${t.alvo.nome}`} role="tab" aria-selected={t.alvo.nome === ativa.nome && t.alvo.raiz === ativa.raiz}
                className={`modal-tab ${t.alvo.nome === ativa.nome && t.alvo.raiz === ativa.raiz ? 'is-ativa' : ''}`} onClick={() => setAtiva(t.alvo)} title={t.alvo.nome}>
                {t.prod && <i className={`ponto is-${t.prod.status}`} />}
                <span>{t.prod ? rotuloSaida(t.prod, grupo?.ideia?.nome) : t.rotulo}</span>
              </button>
            ))}
            {ativa.raiz !== 'entradas' && est && (
              <span className="modal-mais">
                <button className="modal-tab is-mais" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPosMais({ left: r.left, top: r.bottom + 4 }); setMais((v) => !v) }} title="Nova saída desta ideia"><Icone n="mais" t={14} /> Saída</button>
                {mais && createPortal(
                  <div className="menu-ctx glass glass--light" role="menu" style={posMais}>
                    <p className="menu-ctx-t"><span className="orb orb--msg" />Nova saída (o Jarvis escreve)</p>
                    {est.formatos.map((f) => <button key={f.emoji} role="menuitem" onClick={() => novaSaida(f.emoji, f.nome)}><span className="menu-emoji">{f.emoji}</span>{f.nome}</button>)}
                  </div>, document.body)}
              </span>
            )}
          </nav>
          <button className="btn-icone" onClick={onFechar} aria-label="Fechar" title="Fechar (esc)"><Icone n="fechar" t={16} /></button>
        </header>

        {grupo?.ideia && ativa.raiz === 'ideias' && grupo.entradas.length > 0 && (
          <div className="modal-entradas">
            <span className="mudo">Entradas</span>
            {grupo.entradas.map((e) => (
              <button key={e.nome} className="modal-entrada" onClick={() => setAtiva({ raiz: 'entradas', nome: e.nome })} title={e.url || e.nome}>
                {e.thumb && <img src={e.thumb} alt="" referrerPolicy="no-referrer" />}<span>{e.nome}</span>
              </button>
            ))}
          </div>
        )}
        {ativa.raiz === 'entradas' && grupo && grupo.usadaEm.length > 0 && (
          <div className="modal-entradas">
            <span className="mudo">Usada em</span>
            {grupo.usadaEm.map((i) => <button key={i.nome} className="modal-entrada" onClick={() => setAtiva({ raiz: 'ideias', nome: i.nome })}><span>{i.nome}</span></button>)}
          </div>
        )}

        <PainelNota key={`${ativa.raiz}/${ativa.nome}`} alvo={ativa} prod={grupo?.prod ?? undefined} ideia={grupo?.ideia?.nome}
          versao={versao} onTrecho={onTrecho} avisar={avisar}
          onMudou={(novo) => { if (novo) setAtiva(novo); recarregar(); onMudou?.() }} />
        {aviso && createPortal(<div className="ideias-aviso" role="status">{aviso}</div>, document.body)}
      </div>
    </div>
  )
}

/** Na tab, a saída aparece pelo formato e pelo que sobra do nome além do nome da ideia ("💰 LP"). */
function rotuloSaida(p: Producao, ideia?: string) {
  const base = (ideia ?? '').replace(/^💡\s*/, '').toLowerCase()
  const resto = p.nome.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  const sobra = base && resto.toLowerCase().startsWith(base) ? resto.slice(base.length).replace(/^[\s\-–·+]+/, '') : resto
  return `${p.formato} ${sobra || ({ '📱': 'Reels', '💰': 'Ad', '🏞️': 'Carrossel', '📝': 'Feed', '📺': 'VSL', '🎥': 'YouTube', '🗣️': 'Stories', '🎙️': 'Live' } as Record<string, string>)[p.formato] || ''}`.trim()
}

function PainelNota({ alvo, prod, ideia, versao, onTrecho, onMudou, avisar }: {
  alvo: Alvo; prod?: Producao; ideia?: string; versao?: number
  onTrecho?: (t: Trecho, pedido?: string) => void; onMudou: (novo?: Alvo) => void; avisar: (m: string) => void
}) {
  const [nota, setNota] = useState<Nota | null>(null)
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState<Estado>('salvo')
  const [titulo, setTitulo] = useState<string | null>(null)
  const view = useRef<EditorView | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const ref = useRef({ nota, texto, estado })
  ref.current = { nota, texto, estado }

  const abrir = useCallback(async () => {
    const r = await fetch(urlNota(alvo))
    if (!r.ok) { setNota(null); return }
    const n: Nota = await r.json()
    setNota(n); setTexto(n.texto); setEstado('salvo')
  }, [alvo])
  useEffect(() => { abrir() }, [abrir])

  const salvar = useCallback(async () => {
    const { nota: n, texto: t, estado: e } = ref.current
    window.clearTimeout(timer.current)
    if (!n || e === 'salvo' || e === 'conflito') return
    setEstado('salvando')
    const r = await fetch(urlNota(n), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: t, mtime: n.mtime }) })
    if (r.status === 409) { setEstado('conflito'); return }
    if (!r.ok) { setEstado('erro'); return }
    const { mtime } = await r.json()
    setNota((x) => (x ? { ...x, mtime, texto: t } : x))
    setEstado(ref.current.texto === t ? 'salvo' : 'editando')
  }, [])
  useEffect(() => () => { if (ref.current.estado === 'editando') salvar() }, [salvar])

  // o Jarvis pode ter escrito nesta nota
  useEffect(() => {
    const n = ref.current.nota
    if (!versao || !n || ref.current.estado !== 'salvo') return
    fetch(urlNota(n)).then((r) => (r.ok ? r.json() : null)).then((d: Nota | null) => {
      if (d && ref.current.estado === 'salvo' && d.mtime !== ref.current.nota?.mtime) { setNota(d); setTexto(d.texto) }
    }).catch(() => {})
  }, [versao])

  function mudar(v: string) {
    setTexto(v)
    setEstado((e) => (e === 'conflito' ? e : 'editando'))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(salvar, 1000)
  }

  async function executar(f: () => Promise<Alvo | void>, msg?: string) {
    await salvar()
    try {
      const d = await f()
      if (msg) avisar(msg)
      onMudou(d && d.nome ? { raiz: d.raiz, nome: d.nome } : undefined)
      if (!d || !d.nome) abrir()
    } catch (e) { avisar((e as Error).message) }
  }

  const mudarStatus = (s: string) => {
    if (!prod || s === prod.status) return
    if (s === 'publicado') return executar(() => acao(alvo, { acao: 'mover', destino: 'publicados' }), 'Publicada')
    if (prod.raiz === 'publicados') return executar(async () => {
      const d = await acao(alvo, { acao: 'mover', destino: 'priorizar' })
      return s === 'ideia' ? d : acao(d, { acao: 'status', destino: s })
    }, 'Voltou para Priorizar')
    return executar(() => acao(alvo, { acao: 'status', destino: s }))
  }

  const mudarData = (data: string) => data && executar(async () => {
    const r = await fetch(`${urlNota(alvo)}/agenda`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) })
    if (!r.ok) throw new Error('Não consegui mudar a data.')
  }, 'Data mudou')

  async function confirmarTitulo() {
    const v = titulo?.trim()
    setTitulo(null)
    if (v && v !== alvo.nome) await executar(() => acao(alvo, { acao: 'renomear', novo: v }))
  }

  const caminho = nota?.caminho ?? `${PASTA[alvo.raiz]}/${alvo.nome}.md`
  const tags = useMemo(() => {
    const fm = /^---\n([\s\S]*?)\n---/.exec(texto)?.[1] ?? ''
    const m = /^tags:[ \t]*(.*)$/m.exec(fm)
    if (!m) return []
    if (m[1].trim()) return m[1].replace(/[[\]]/g, '').split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    return fm.slice(m.index + m[0].length).split('\n').slice(1).map((l) => /^\s+-\s*(.*)$/.exec(l)?.[1]).filter((x): x is string => x !== undefined)
      .map((t) => t.replace(/^["']|["']$/g, '')).filter(Boolean)
  }, [texto])

  if (!nota) return <div className="modal-corpo"><p className="mudo">Carregando…</p></div>

  return (
    <>
      <div className="modal-topo">
        <div className="modal-titulo">
          <p className="ideias-caminho">{caminho.split('/').slice(0, -1).join(' / ')}</p>
          {titulo !== null ? (
            <form onSubmit={(e) => { e.preventDefault(); confirmarTitulo() }}>
              <input className="ideias-titulo-campo" autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} onBlur={confirmarTitulo}
                onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTitulo(null) } }} aria-label="Nome da nota" />
            </form>
          ) : <h1 className="is-editavel" title="Clique para renomear" onClick={() => setTitulo(alvo.nome)}>{alvo.nome}</h1>}
        </div>
        <span className={`ideias-estado is-${estado}`}>
          {estado === 'conflito' ? <button onClick={abrir}>{ROTULO[estado]} · recarregar</button> : ROTULO[estado]}
        </span>
        <a className="btn-icone" href={obsidian(alvo.raiz, alvo.nome)} title="Abrir no Obsidian"><Icone n="seta" t={14} /></a>
      </div>

      <div className="modal-props">
        {prod && (
          <label className="modal-prop"><span>Status</span>
            <select value={prod.status} onChange={(e) => mudarStatus(e.target.value)}>
              {STATUS.map((s) => <option key={s.k} value={s.k}>{s.marca} {s.nome}</option>)}
            </select>
          </label>
        )}
        {prod && (
          <label className="modal-prop"><span>Scheduled</span>
            <input type="date" value={prod.scheduled ?? ''} onChange={(e) => mudarData(e.target.value)} />
          </label>
        )}
        {prod && <span className="modal-prop"><span>Publicado</span><b>{prod.status === 'publicado' ? 'sim' : 'não'}</b></span>}
        <span className="modal-prop modal-tags"><span>Tags</span>{tags.length ? tags.map((t) => <i key={t}>{t}</i>) : <em className="mudo">nenhuma (edite no topo da nota)</em>}</span>
        {prod && ideia && (
          <button className="modal-desligar" onClick={() => executar(() => post('ligar', { producao: { raiz: prod.raiz, nome: prod.nome }, ideia: null }), 'Saiu da ideia')}
            title="Tira esta copy da ideia (a nota continua igual)">Desligar da ideia</button>
        )}
        {onTrecho && (
          <button className="modal-desligar" onClick={async () => { await salvar(); onTrecho({ texto: '', linhaIni: 1, linhaFim: texto.split('\n').length, raiz: alvo.raiz, nome: alvo.nome, caminho }) }}
            title="Manda esta nota para o chat (⌘I manda só o trecho selecionado)"><span className="orb orb--msg" /> Perguntar ao Jarvis</button>
        )}
      </div>

      <div className="modal-corpo">
        <Editor chave={`${alvo.raiz}/${alvo.nome}`} valor={texto} onMudar={mudar} onSalvar={salvar} viewRef={view}
          onJarvis={(s) => { salvar().then(() => onTrecho?.({ ...s, raiz: alvo.raiz, nome: alvo.nome, caminho })) }} />
      </div>
    </>
  )
}
