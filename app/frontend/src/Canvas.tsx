import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Background, BackgroundVariant, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesInitialized, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps, type OnBeforeDelete,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { createPortal } from 'react-dom'
import { Icone } from './Icone'
import { PASTA, type Raiz, type Trecho } from './Ideias'
import {
  STATUS, carregarCanvas, idDe, pedidoSaida, porFormato, post,
  type Alvo, type Entrada, type EstadoCanvas, type Ideia, type Producao, type StatusProd,
} from './canvasApi'

/** O canvas do Neo-Obsidian: 💡 ideias com as saídas dentro, entradas de material bruto ligadas por linhas,
 *  copies soltas. Pastas voando à direita abrem o mesmo canvas filtrado (em edição, agendado, publicado por ano).
 *  Botão direito cria; arrastar um card em cima de outro agrupa; puxar a linha de uma entrada até a ideia liga. */
type Visao = 'principal' | 'edicao' | 'agendado' | `pub-${string}`
type DadosIdeia = { ideia: Ideia; saidas: Producao[]; destaque: StatusProd | null; abrir: (a: Alvo) => void }
type DadosEntrada = { entrada: Entrada }
type DadosProd = { prod: Producao }
type No = Node<DadosIdeia, 'ideia'> | Node<DadosEntrada, 'entrada'> | Node<DadosProd, 'producao'>
type MenuCtx = { x: number; y: number; flow: { x: number; y: number }; no?: No; selecao?: No[] }
type Pergunta = { titulo: string; dica?: string; inicial?: string; longo?: boolean; ok: (v: string) => void }

const LARG = 270
const NOME_VISAO = (v: Visao) => v === 'principal' ? 'Canvas' : v === 'edicao' ? 'Em edição' : v === 'agendado' ? 'Agendado' : `Publicado · ${v.slice(4)}`
const chavePos = (v: Visao, id: string) => (v === 'principal' ? id : `${v}|${id}`)
const ICONE_ENTRADA: Record<string, string> = { youtube: '▶️', instagram: '📸', link: '🔗', texto: '💭' }
const dataCurta = (d: string | null) => d ? new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') : ''

/* ---------- cards ---------- */

const CardIdeia = memo(({ data, selected }: NodeProps<Node<DadosIdeia, 'ideia'>>) => {
  const { ideia, saidas, destaque, abrir } = data
  const prox = saidas.filter((s) => s.status !== 'publicado' && s.scheduled).map((s) => s.scheduled!).sort()[0]
  return (
    <div className={`cartao cartao--ideia ${selected ? 'is-sel' : ''}`}>
      <Handle type="target" position={Position.Left} className="cartao-alca" />
      <header><span className="cartao-tipo">💡</span><b>{ideia.nome.replace(/^💡\s*/, '')}</b></header>
      {ideia.previa && <p className="cartao-previa">{ideia.previa}</p>}
      <div className="cartao-saidas">
        {saidas.length === 0 && <span className="mudo">sem saída ainda · botão direito → gerar</span>}
        {saidas.map((s) => (
          <button key={s.nome} className={`cartao-saida nodrag ${destaque && s.status !== destaque ? 'is-apagada' : ''}`} title={`${s.nome} · ${STATUS.find((x) => x.k === s.status)?.nome}`}
            onClick={(e) => { e.stopPropagation(); abrir({ raiz: s.raiz, nome: s.nome }) }}>
            <span>{s.formato}</span><i className={`ponto is-${s.status}`} />
          </button>
        ))}
      </div>
      {prox && <footer>próxima · {dataCurta(prox)}</footer>}
    </div>
  )
})

const CardEntrada = memo(({ data, selected }: NodeProps<Node<DadosEntrada, 'entrada'>>) => {
  const e = data.entrada
  return (
    <div className={`cartao cartao--entrada ${selected ? 'is-sel' : ''}`}>
      {e.thumb && <img className="cartao-thumb" src={e.thumb} alt="" referrerPolicy="no-referrer" loading="lazy" />}
      <header><span className="cartao-tipo">{ICONE_ENTRADA[e.tipo] ?? '🔗'}</span><b>{e.nome.replace(/^\S+\s/, '')}</b></header>
      {e.previa && !e.thumb && <p className="cartao-previa">{e.previa}</p>}
      {e.url && <footer>{e.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 42)}</footer>}
      <Handle type="source" position={Position.Right} className="cartao-alca" />
    </div>
  )
})

const CardProd = memo(({ data, selected }: NodeProps<Node<DadosProd, 'producao'>>) => {
  const p = data.prod
  return (
    <div className={`cartao cartao--prod ${selected ? 'is-sel' : ''}`}>
      <header><span className="cartao-tipo">{p.formato}</span><b>{p.nome.replace(/^[^\p{L}\p{N}]+/u, '')}</b></header>
      {p.previa && <p className="cartao-previa">{p.previa}</p>}
      <footer><i className={`ponto is-${p.status}`} />{STATUS.find((s) => s.k === p.status)?.nome}{p.scheduled ? ` · ${dataCurta(p.scheduled)}` : ''}</footer>
    </div>
  )
})

const TIPOS_NO = { ideia: CardIdeia, entrada: CardEntrada, producao: CardProd }

/* ---------- montagem dos nós de cada visão ---------- */

function montar(est: EstadoCanvas, v: Visao, abrir: (a: Alvo) => void): { nos: No[]; arestas: Edge[]; novos: Record<string, { x: number; y: number }> } {
  const arq = new Set(est.arquivados)
  const nomesIdeias = new Set(est.ideias.map((i) => i.nome))
  const saidasDe = new Map<string, Producao[]>()
  for (const p of est.producoes) if (p.ideia && nomesIdeias.has(p.ideia)) saidasDe.set(p.ideia, [...(saidasDe.get(p.ideia) ?? []), p])
  const soltas = est.producoes.filter((p) => !p.ideia || !nomesIdeias.has(p.ideia))
  const casa = (p: Producao) => v === 'principal' ? p.status !== 'publicado' : v.startsWith('pub-') ? p.status === 'publicado' && p.ano === v.slice(4) : p.status === v
  const destaque: StatusProd | null = v === 'principal' ? null : v.startsWith('pub-') ? 'publicado' : (v as StatusProd)

  const itens: { id: string; no: Omit<No, 'position'>; ordem: number }[] = []
  for (const i of est.ideias) {
    const s = (saidasDe.get(i.nome) ?? []).sort(porFormato)
    const entra = v === 'principal' ? s.length === 0 || s.some(casa) : s.some(casa)
    if (entra) itens.push({ id: `i:${i.nome}`, no: { id: '', type: 'ideia', data: { ideia: i, saidas: s, destaque, abrir } } as Omit<No, 'position'>, ordem: -i.mtime })
  }
  if (v === 'principal') for (const e of est.entradas) itens.push({ id: `e:${e.nome}`, no: { id: '', type: 'entrada', data: { entrada: e } } as Omit<No, 'position'>, ordem: -e.mtime })
  for (const p of soltas) if (casa(p)) itens.push({ id: `p:${p.raiz}/${p.nome}`, no: { id: '', type: 'producao', data: { prod: p } } as Omit<No, 'position'>, ordem: -(p.scheduled ? Date.parse(p.scheduled) / 1000 : p.mtime) })

  const visiveis = itens.filter((x) => !arq.has(x.id))
  const pos = (id: string) => est.pos[chavePos(v, id)]
  const fundo = Math.max(0, ...visiveis.map((x) => pos(x.id)).filter(Boolean).map((p) => p!.y + 240))
  const novos: Record<string, { x: number; y: number }> = {}
  const sem = visiveis.filter((x) => !pos(x.id)).sort((a, b) => a.ordem - b.ordem)
  const cols = Math.max(6, Math.round(Math.sqrt(sem.length * 1.8)))   // grade mais larga que alta, como a tela
  sem.forEach((x, k) => { novos[chavePos(v, x.id)] = { x: (k % cols) * (LARG + 34), y: fundo + Math.floor(k / cols) * 230 } })
  const nos = visiveis.map((x) => ({ ...x.no, id: x.id, position: pos(x.id) ?? novos[chavePos(v, x.id)] }) as No)
  const ids = new Set(nos.map((n) => n.id))
  const arestas: Edge[] = []
  for (const i of est.ideias) for (const f of i.fontes) {
    if (ids.has(`e:${f}`) && ids.has(`i:${i.nome}`)) arestas.push({ id: `${f}→${i.nome}`, source: `e:${f}`, target: `i:${i.nome}`, className: 'aresta-fonte' })
  }
  return { nos, arestas, novos }
}

/* ---------- canvas ---------- */

type Props = {
  onAbrir: (a: Alvo) => void
  onTrecho?: (t: Trecho, pedido?: string) => void
  onPedido?: (texto: string) => void
  versao?: number
}

export function Canvas(p: Props) {
  return <ReactFlowProvider><Mesa {...p} /></ReactFlowProvider>
}

function Mesa({ onAbrir, onTrecho, onPedido, versao }: Props) {
  const [est, setEst] = useState<EstadoCanvas | null>(null)
  const [visao, setVisao] = useState<Visao>('principal')
  const [nos, setNos, mudarNos] = useNodesState<No>([])
  const [arestas, setArestas, mudarArestas] = useEdgesState<Edge>([])
  const [menu, setMenu] = useState<MenuCtx | null>(null)
  const [pergunta, setPergunta] = useState<Pergunta | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [anos, setAnos] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  const rf = useReactFlow<No, Edge>()
  const visaoAntes = useRef<Visao | null>(null)
  const enquadrar = useRef(false)
  const iniciados = useNodesInitialized()

  const avisar = useCallback((m: string, ms = 2600) => { setAviso(m); window.setTimeout(() => setAviso((a) => (a === m ? null : a)), ms) }, [])
  const recarregar = useCallback(() => carregarCanvas().then(setEst).catch(() => avisar('Não consegui ler o canvas.')), [avisar])
  useEffect(() => { recarregar() }, [recarregar, versao])

  useEffect(() => {
    if (!est) return
    const { nos: n, arestas: a, novos } = montar(est, visao, onAbrir)
    setNos(n); setArestas(a)
    if (Object.keys(novos).length) post('posicoes', novos, 'PUT').then(() => setEst((e) => e && { ...e, pos: { ...e.pos, ...novos } })).catch(() => {})
    if (visaoAntes.current !== visao) { visaoAntes.current = visao; enquadrar.current = true }
  }, [est, visao, onAbrir, setNos, setArestas])

  // cada visão abre onde você parou nela; na primeira vez, enquadra tudo (depois que os cards têm tamanho)
  useEffect(() => {
    if (!iniciados || !enquadrar.current) return
    enquadrar.current = false
    try {
      const vp = JSON.parse(localStorage.getItem(`canvas-vp-${visao}`) || 'null')
      if (vp) { rf.setViewport(vp); return }
    } catch { /* sem storage */ }
    rf.fitView({ padding: 0.12, maxZoom: 1 })
  }, [iniciados, nos, visao, rf])
  const lembrarVista = useCallback(() => { try { localStorage.setItem(`canvas-vp-${visao}`, JSON.stringify(rf.getViewport())) } catch { /* sem storage */ } }, [visao, rf])

  const contagem = useMemo(() => {
    const c = { edicao: 0, agendado: 0, publicado: 0 } as Record<string, number>
    const porAno: Record<string, number> = {}
    for (const p of est?.producoes ?? []) {
      if (p.status in c) c[p.status]++
      if (p.status === 'publicado') porAno[p.ano] = (porAno[p.ano] ?? 0) + 1
    }
    return { ...c, anos: Object.entries(porAno).sort((a, b) => b[0].localeCompare(a[0])) }
  }, [est])

  const guardarPos = useCallback((lista: No[]) => {
    const d: Record<string, { x: number; y: number }> = {}
    for (const n of lista) d[chavePos(visao, n.id)] = n.position
    post('posicoes', d, 'PUT').catch(() => {})
    setEst((e) => e && { ...e, pos: { ...e.pos, ...d } })
  }, [visao])

  const perguntar = (p: Pergunta) => setPergunta(p)
  const tentar = async (f: () => Promise<unknown>, ok?: string) => {
    try { await f(); if (ok) avisar(ok); await recarregar() } catch (e) { avisar((e as Error).message) }
  }
  const alvoDe = (n: No): Alvo => n.type === 'ideia' ? { raiz: 'ideias', nome: n.data.ideia.nome } : n.type === 'entrada' ? { raiz: 'entradas', nome: n.data.entrada.nome } : { raiz: n.data.prod.raiz, nome: n.data.prod.nome }

  // arrastar em cima de outro card: liga ou agrupa
  const soltou = useCallback((_: unknown, no: No, lista: No[]) => {
    guardarPos(lista)
    if (lista.length !== 1) return
    const alvo = rf.getIntersectingNodes(no).find((x) => x.id !== no.id) as No | undefined
    if (!alvo) return
    if (no.type === 'producao' && alvo.type === 'ideia') {
      tentar(() => post('ligar', { producao: { raiz: no.data.prod.raiz, nome: no.data.prod.nome }, ideia: alvo.data.ideia.nome }), `Entrou em ${alvo.data.ideia.nome}`)
    } else if (no.type === 'producao' && alvo.type === 'producao') {
      const base = alvo.data.prod.nome.replace(/^[^\p{L}\p{N}]+/u, '')
      perguntar({ titulo: 'Agrupar numa ideia nova', dica: 'Nome da 💡 ideia', inicial: base, ok: (t) => tentar(
        () => post('agrupar', { titulo: t, pos: alvo.position, producoes: [no, alvo].map((x) => ({ raiz: (x as Node<DadosProd>).data.prod.raiz, nome: (x as Node<DadosProd>).data.prod.nome })) }),
        'Ideia criada') })
    } else if (no.type === 'entrada' && alvo.type === 'ideia') {
      const p = { x: alvo.position.x - LARG - 60, y: alvo.position.y }
      rf.updateNode(no.id, { position: p })
      guardarPos([{ ...no, position: p }])
      tentar(() => post('fonte', { ideia: alvo.data.ideia.nome, entrada: no.data.entrada.nome }), 'Entrada ligada à ideia')
    }
  }, [guardarPos, rf])  // eslint-disable-line react-hooks/exhaustive-deps

  const conectou = useCallback((c: Connection) => {
    const [ent, ide] = c.source.startsWith('e:') ? [c.source, c.target] : [c.target, c.source]
    if (!ent.startsWith('e:') || !ide.startsWith('i:')) { avisar('Ligue uma entrada a uma 💡 ideia.'); return }
    tentar(() => post('fonte', { ideia: ide.slice(2), entrada: ent.slice(2) }), 'Entrada ligada à ideia')
  }, [avisar])  // eslint-disable-line react-hooks/exhaustive-deps

  // Delete só apaga linhas (desliga a fonte); cards não se apagam pelo canvas
  const antesDeApagar: OnBeforeDelete<No, Edge> = async ({ edges }) => {
    for (const e of edges) await post('fonte', { ideia: e.target.slice(2), entrada: e.source.slice(2), sim: false }).catch(() => {})
    if (edges.length) { avisar(edges.length > 1 ? 'Ligações desfeitas' : 'Ligação desfeita'); recarregar() }
    return { nodes: [], edges }
  }

  // o espaço livre mais perto de um ponto, para o card novo não nascer em cima de outro
  const livre = (p: { x: number; y: number }) => {
    for (let anel = 0; anel < 12; anel++) {
      for (let k = 0; k < Math.max(1, anel * 8); k++) {
        const a = (k / Math.max(1, anel * 8)) * Math.PI * 2
        const c = { x: p.x + Math.cos(a) * anel * 160, y: p.y + Math.sin(a) * anel * 120 }
        if (!rf.getIntersectingNodes({ ...c, width: LARG + 20, height: 200 }, true).length) return c
      }
    }
    return p
  }
  const noMeio = () => {
    const r = caixa.current?.getBoundingClientRect()
    return livre(r ? rf.screenToFlowPosition({ x: r.left + r.width / 2 - LARG / 2, y: r.top + r.height / 2 - 80 }) : { x: 0, y: 0 })
  }

  async function novaEntrada(conteudo: string, pos: { x: number; y: number }, ideia?: string) {
    avisar('Lendo o material…', 20000)
    await tentar(() => post('entrada', { conteudo, pos, ideia }), 'Entrada criada')
  }

  async function novaSaida(ideia: string, formato: string, nome: string) {
    try {
      const d = await post<Alvo>('saida', { ideia, formato })
      await recarregar()
      onAbrir(d)
      onPedido?.(pedidoSaida(ideia, d.nome, formato, nome))
    } catch (e) { avisar((e as Error).message) }
  }

  // colar um link ou texto no canvas cria uma entrada
  useEffect(() => {
    const colar = (e: ClipboardEvent) => {
      const alvo = e.target as HTMLElement
      if (alvo.closest('input, textarea, [contenteditable="true"], .modal-fundo, .chat') || document.querySelector('.modal-fundo, .paleta-fundo')) return
      const t = e.clipboardData?.getData('text/plain')?.trim()
      if (!t || visao !== 'principal') return
      e.preventDefault()
      novaEntrada(t, noMeio())
    }
    window.addEventListener('paste', colar)
    return () => window.removeEventListener('paste', colar)
  })  // eslint-disable-line react-hooks/exhaustive-deps

  const abrirMenu = (e: React.MouseEvent | MouseEvent, extra: Partial<MenuCtx> = {}) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), ...extra })
  }

  const formatos = est?.formatos ?? []

  return (
    <div className="canvas glass glass--light" ref={caixa}>
      <ReactFlow<No, Edge>
        nodes={nos} edges={arestas} onNodesChange={mudarNos} onEdgesChange={mudarArestas} nodeTypes={TIPOS_NO}
        onNodeDragStop={soltou} onConnect={conectou} onMoveEnd={lembrarVista} onBeforeDelete={antesDeApagar}
        onNodeDoubleClick={(_, n) => onAbrir(alvoDe(n))}
        onPaneContextMenu={(e) => abrirMenu(e)}
        onNodeContextMenu={(e, n) => { const sel = rf.getNodes().filter((x) => x.selected); abrirMenu(e, sel.length > 1 && sel.some((x) => x.id === n.id) ? { selecao: sel } : { no: n }) }}
        onSelectionContextMenu={(e, sel) => abrirMenu(e, { selecao: sel })}
        selectionOnDrag panOnDrag={[1, 2]} panOnScroll zoomOnPinch minZoom={0.08} maxZoom={1.6}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgba(23,24,27,.18)" />
        <MiniMap pannable zoomable position="bottom-left" className="canvas-mapa" nodeColor={(n) => (n.type === 'ideia' ? '#e2f05c' : n.type === 'entrada' ? '#c9c3bf' : '#ffffff')} maskColor="rgba(232,228,226,.55)" />
      </ReactFlow>

      <div className="canvas-barra">
        {visao !== 'principal' && <button className="pilula glass glass--light" onClick={() => setVisao('principal')}><Icone n="seta" t={12} /> Canvas</button>}
        <span className="canvas-nome">{NOME_VISAO(visao)}<em>{nos.length} cards</em></span>
        {visao === 'principal' && <>
          <button className="pilula glass glass--light" onClick={() => perguntar({ titulo: 'Nova ideia', dica: 'Nome da 💡 ideia', ok: (t) => tentar(() => post('ideia', { titulo: t, pos: noMeio() }), 'Ideia criada') })}>💡 Ideia</button>
          <button className="pilula glass glass--light" onClick={() => perguntar({ titulo: 'Nova entrada', dica: 'Cole um link (YouTube, Instagram, matéria) ou escreva a ideia bruta', longo: true, ok: (t) => novaEntrada(t, noMeio()) })}>🔗 Entrada</button>
        </>}
      </div>

      <aside className="canvas-pastas" aria-label="Pastas">
        <Pasta nome="Em edição" n={contagem.edicao} ativa={visao === 'edicao'} cor="edicao" onClick={() => setVisao(visao === 'edicao' ? 'principal' : 'edicao')} />
        <Pasta nome="Agendado" n={contagem.agendado} ativa={visao === 'agendado'} cor="agendado" onClick={() => setVisao(visao === 'agendado' ? 'principal' : 'agendado')} />
        <Pasta nome="Publicado" n={contagem.publicado} ativa={visao.startsWith('pub-')} cor="publicado" onClick={() => setAnos((v) => !v)}>
          {anos && (
            <div className="pasta-anos">
              {contagem.anos.map(([a, n]) => (
                <button key={a} className={visao === `pub-${a}` ? 'is-ativa' : ''} onClick={(e) => { e.stopPropagation(); setVisao(`pub-${a}`); setAnos(false) }}>{a}<em>{n}</em></button>
              ))}
            </div>
          )}
        </Pasta>
      </aside>

      {menu && (
        <MenuCanvas m={menu} onFechar={() => setMenu(null)}>
          {menu.selecao ? (() => {
            const prods = menu.selecao!.filter((n): n is Node<DadosProd, 'producao'> => n.type === 'producao')
            return <>
              <p className="menu-ctx-t">{menu.selecao!.length} cards</p>
              <Op icone="pasta" desligado={prods.length < 1} onClick={() => perguntar({ titulo: 'Agrupar numa ideia nova', dica: 'Nome da 💡 ideia', inicial: prods[0]?.data.prod.nome.replace(/^[^\p{L}\p{N}]+/u, ''),
                ok: (t) => tentar(() => post('agrupar', { titulo: t, pos: prods[0].position, producoes: prods.map((x) => ({ raiz: x.data.prod.raiz, nome: x.data.prod.nome })) }), 'Ideia criada') })}>
                Agrupar copies em ideia{prods.length ? ` (${prods.length})` : ''}</Op>
              <Op icone="olho" onClick={() => tentar(async () => { for (const n of menu.selecao!) await post('arquivar', { id: n.id }) }, 'Escondidos do canvas')}>Arquivar (esconder)</Op>
            </>
          })() : menu.no ? (() => {
            const n = menu.no!
            const alvo = alvoDe(n)
            return <>
              <Op icone="nota" onClick={() => onAbrir(alvo)}>Abrir</Op>
              {n.type === 'ideia' && <>
                <hr /><p className="menu-ctx-t"><span className="orb orb--msg" />Gerar saída</p>
                <div className="menu-formatos">{formatos.map((f) => <button key={f.emoji} title={f.nome} onClick={() => { setMenu(null); novaSaida(n.data.ideia.nome, f.emoji, f.nome) }}><span>{f.emoji}</span>{f.nome}</button>)}</div>
                <Op icone="link" onClick={() => perguntar({ titulo: `Entrada para ${n.data.ideia.nome}`, dica: 'Link ou texto', longo: true, ok: (t) => novaEntrada(t, { x: n.position.x - LARG - 60, y: n.position.y + 40 }, n.data.ideia.nome) })}>Adicionar entrada</Op>
              </>}
              <hr />
              {onTrecho && <Op icone="chat" onClick={() => onTrecho({ texto: '', linhaIni: 1, linhaFim: 999, raiz: alvo.raiz, nome: alvo.nome, caminho: `${PASTA[alvo.raiz as Raiz]}/${alvo.nome}.md` })}>Perguntar ao Jarvis</Op>}
              <Op icone="editar" onClick={() => perguntar({ titulo: 'Renomear', inicial: alvo.nome, ok: (t) => tentar(async () => {
                const r = await fetch(`/api/notas/${alvo.raiz}/${encodeURIComponent(alvo.nome)}/acao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'renomear', novo: t }) })
                if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Não consegui renomear.')
              }) })}>Renomear</Op>
              <Op icone="olho" onClick={() => tentar(() => post('arquivar', { id: idDe(alvo) }), 'Escondido do canvas (a nota continua no vault)')}>Arquivar (esconder)</Op>
            </>
          })() : <>
            <Op icone="mais" onClick={() => perguntar({ titulo: 'Nova ideia', dica: 'Nome da 💡 ideia', ok: (t) => tentar(() => post('ideia', { titulo: t, pos: livre(menu.flow) }), 'Ideia criada') })}>💡 Nova ideia</Op>
            <Op icone="link" onClick={() => perguntar({ titulo: 'Nova entrada', dica: 'Cole um link (YouTube, Instagram, matéria) ou escreva a ideia bruta', longo: true, ok: (t) => novaEntrada(t, livre(menu.flow)) })}>🔗 Nova entrada</Op>
            <Op icone="nota" onClick={() => perguntar({ titulo: 'Nova copy solta (em Priorizar)', inicial: '📱 ', ok: (t) => tentar(async () => {
              const r = await fetch('/api/notas/priorizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: t }) })
              if (!r.ok) throw new Error(r.status === 409 ? 'Já existe uma nota com esse nome.' : 'Não consegui criar.')
              const d = await r.json()
              await post('posicoes', { [`p:priorizar/${d.nome}`]: menu.flow }, 'PUT')
            }, 'Copy criada') })}>📄 Nova copy solta</Op>
            <hr />
            <Op icone="seta" onClick={() => navigator.clipboard.readText().then((t) => t.trim() && novaEntrada(t.trim(), menu.flow)).catch(() => avisar('Sem permissão para ler a área de transferência: use ⌘V.'))}>Colar como entrada <kbd>⌘V</kbd></Op>
            <Op icone="atualizar" onClick={() => rf.fitView({ padding: 0.15, maxZoom: 1, duration: 250 })}>Ver tudo</Op>
          </>}
        </MenuCanvas>
      )}

      {pergunta && <Perguntar p={pergunta} onFechar={() => setPergunta(null)} />}
      {aviso && createPortal(<div className="ideias-aviso" role="status">{aviso}</div>, document.body)}
    </div>
  )
}

function Pasta({ nome, n, ativa, cor, onClick, children }: { nome: string; n: number; ativa: boolean; cor: string; onClick: () => void; children?: ReactNode }) {
  return (
    <div className={`pasta is-${cor} ${ativa ? 'is-ativa' : ''}`}>
      <button className="pasta-corpo" onClick={onClick} title={`Abrir o canvas só com ${nome.toLowerCase()}`}>
        <span className="pasta-aba" />
        <span className="pasta-folhas"><i /><i /><i /></span>
        <span className="pasta-frente"><b>{nome}</b><em>{n}</em></span>
      </button>
      {children}
    </div>
  )
}

function Op({ icone, children, onClick, desligado }: { icone: string; children: ReactNode; onClick: () => void; desligado?: boolean }) {
  return <button role="menuitem" data-fecha onClick={onClick} disabled={desligado}><Icone n={icone} t={15} />{children}</button>
}

function MenuCanvas({ m, onFechar, children }: { m: MenuCtx; onFechar: () => void; children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: m.x, y: m.y })
  useEffect(() => {
    const r = caixa.current?.getBoundingClientRect()
    if (r) setPos({ x: Math.min(m.x, window.innerWidth - r.width - 8), y: Math.min(m.y, window.innerHeight - r.height - 8) })
    const fora = (e: MouseEvent) => { if (e.button !== 2 && !caixa.current?.contains(e.target as HTMLElement)) onFechar() }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('mousedown', fora); window.addEventListener('keydown', esc); window.addEventListener('blur', onFechar)
    return () => { window.removeEventListener('mousedown', fora); window.removeEventListener('keydown', esc); window.removeEventListener('blur', onFechar) }
  }, [m, onFechar])
  return createPortal(
    <div ref={caixa} className="menu-ctx glass glass--light" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => { if ((e.target as HTMLElement).closest('[data-fecha]')) onFechar() }}>
      {children}
    </div>, document.body)
}

function Perguntar({ p, onFechar }: { p: Pergunta; onFechar: () => void }) {
  const [v, setV] = useState(p.inicial ?? '')
  const ok = () => { const t = v.trim(); onFechar(); if (t) p.ok(t) }
  return createPortal(
    <div className="paleta-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <form className="paleta glass glass--light perguntar" onSubmit={(e) => { e.preventDefault(); ok() }}>
        <p className="perguntar-t">{p.titulo}</p>
        {p.longo
          ? <textarea autoFocus rows={4} value={v} onChange={(e) => setV(e.target.value)} placeholder={p.dica}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || !e.shiftKey)) { e.preventDefault(); ok() } if (e.key === 'Escape') onFechar() }} />
          : <input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={p.dica} onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
              onKeyDown={(e) => e.key === 'Escape' && onFechar()} />}
        <footer className="paleta-pe"><span><kbd>↵</kbd> confirmar</span><span><kbd>esc</kbd> cancelar</span></footer>
      </form>
    </div>, document.body)
}
