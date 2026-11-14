import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Background, BackgroundVariant, Handle, MarkerType, MiniMap, PanOnScrollMode, Position, ConnectionMode, ReactFlow, ReactFlowProvider, SelectionMode, useEdgesState, useNodesInitialized, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps, type OnBeforeDelete,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { createPortal } from 'react-dom'
import { Icone } from './Icone'
import { ModalTabela, tabelaNova, type EstadoTabela } from './Tabela'
import { PASTA, type Raiz, type Trecho } from './notas'
import {
  STATUS, carregarCanvas, pedidoSaida, porFormato, post, INBOX, produtosDe,
  type Alvo, type Voltar, type Entrada, type EstadoCanvas, type Ideia, type Producao, type Midia, type StatusProd, type Produto,
  cabecalhoCanvas, carregarTudo, listarCanvases, onde, type ResumoCanvas,
} from './canvasApi'

/** O canvas do Neo-Obsidian: 💡 ideias (um nome, ou já com link/texto/imagem dentro) e as saídas delas,
 *  copies soltas. Pastas voando à direita abrem o mesmo canvas filtrado (em edição, agendado, publicado por ano).
 *  Botão direito cria; arrastar um card em cima de outro agrupa; colar um link cria uma ideia com o material.
 *  Navegação do Neo-Stitch: arrastar no vazio = navegar · scroll, pinça ou ⌘+/⌘− = zoom · ⌘ + arrastar = caixa de
 *  seleção · ⌘ + clique = põe/tira da seleção · duplo clique no vazio = mostra tudo · clique do meio num card = enquadra. */
/** `foco:<id>` é o canvas próprio de um card: ele e tudo o que está ligado a ele. */
type Visao = 'principal' | 'edicao' | 'agendado' | `pub-${string}` | `foco:${string}`
type DadosIdeia = { ideia: Ideia; saidas: Producao[] }
type DadosEntrada = { entrada: Entrada }
type DadosProd = { prod: Producao }
/** A produção: as saídas de uma ideia (📱 💰 🏞️…) num card só; no vault continuam notas separadas. */
type DadosGrupo = { ideia: Ideia; saidas: Producao[]; destaque: StatusProd | null }
type No = Node<DadosIdeia, 'ideia'> | Node<DadosEntrada, 'entrada'> | Node<DadosProd, 'producao'> | Node<DadosGrupo, 'grupo'>
/** O que o canvas principal mostra: tudo o que não saiu, ou só um status. */
type Filtro = 'todos' | 'ideia' | 'edicao' | 'agendado'
const FILTROS: { k: Filtro; nome: string }[] = [{ k: 'todos', nome: 'Todos' }, { k: 'ideia', nome: 'Backlog' }, { k: 'edicao', nome: 'Em edição' }, { k: 'agendado', nome: 'Agendado' }]
type Vistas = { pinados: string[]; historico: string[] }
const MAX_HIST = 5
type MenuCtx = { x: number; y: number; flow: { x: number; y: number }; no?: No; selecao?: No[] }
type Pergunta = { titulo: string; dica?: string; inicial?: string; longo?: boolean; confirmar?: string; ok: (v: string) => void }

const LARG = 270
const ICONE_GRUPO = '🎬'
type TipoVer = 'ideia' | 'producao' | 'vsl'
const TIPOS_VER: { k: TipoVer; nome: string }[] = [{ k: 'ideia', nome: '💡 Ideias' }, { k: 'producao', nome: '🎬 Produções' }, { k: 'vsl', nome: '📺 VSLs' }]
const tipoDoCard = (n: { type?: string; data: unknown }): TipoVer => n.type === 'ideia' || n.type === 'entrada' ? 'ideia'
  : n.type === 'producao' && (n.data as { prod: { formato: string } }).prod.formato === '📺' ? 'vsl' : 'producao'
const VSL = '📺'
const SEM = '-'   // no filtro de produto: os cards sem produto nenhum
/** As tags que dizem o produto de um card (a ideia conta as das copies dela). */
const tagsDoNo = (n: No): string[] => n.type === 'grupo' ? n.data.saidas.flatMap((x) => x.tags ?? [])
  : n.type === 'ideia' ? [...(n.data.ideia.tags ?? []), ...n.data.saidas.flatMap((x) => x.tags ?? [])]
  : n.type === 'producao' ? n.data.prod.tags ?? [] : n.data.entrada.tags ?? []
/** O nome legível de um id de card (i:/g:/e:/p:). */
const nomeDoId = (id: string) => {
  const r = id.slice(2)
  if (id.startsWith('g:')) return `${ICONE_GRUPO} ${r.replace(/^💡\s*/, '')}`
  if (id.startsWith('p:')) return r.slice(r.indexOf('/') + 1)
  return r
}
const NOME_VISAO = (v: Visao) => v === 'principal' ? 'Canvas' : v === 'edicao' ? 'Em edição' : v === 'agendado' ? 'Agendado'
  : v.startsWith('foco:') ? nomeDoId(v.slice(5)) : `Publicado · ${v.slice(4)}`
// cada vista guarda as suas posições (`<vista>|<id>`); o principal usa o id puro
const chavePos = (v: Visao, id: string) => (v === 'principal' ? id : `${v}|${id}`)
const ICONE_ENTRADA: Record<string, string> = { youtube: '▶️', instagram: '📸', link: '🔗', texto: '💭' }
const dataCurta = (d: string | null) => d ? new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') : ''

/* ---------- cards ---------- */

// alças nos quatro lados: qualquer card liga em qualquer outro (o canvas usa conexão solta)
const LADOS = [['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]] as const
const Alcas = () => <>{LADOS.map(([id, pos]) => <Handle key={id} id={id} type="source" position={pos} className={`cartao-alca cartao-alca--${id}`} />)}</>

const ehX = (u: string) => /^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/status\/\d+/.test(u)
const ytId = (u: string) => u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/)?.[1]
const xCache = new Map<string, Promise<{ video?: { url: string; w?: number; h?: number } | null; imagem?: string | null }>>()

/** Post do X no card: toca o vídeo (mudo, em loop) ou mostra a imagem, como no radar. */
function MidiaX({ url }: { url: string }) {
  const [info, setInfo] = useState<{ video?: { url: string; w?: number; h?: number } | null; imagem?: string | null }>()
  useEffect(() => {
    if (!xCache.has(url)) xCache.set(url, fetch(`/api/canvas/x?url=${encodeURIComponent(url)}`).then((r) => r.json()).catch(() => ({})))
    let vivo = true
    xCache.get(url)!.then((d) => { if (vivo) setInfo(d) })
    return () => { vivo = false }
  }, [url])
  if (!info) return <div className="cartao-midia is-carregando" />
  if (info.video?.url) return <video className="cartao-midia nodrag" src={info.video.url} poster={info.imagem ?? undefined} muted autoPlay loop playsInline preload="metadata" />
  if (info.imagem) return <img className="cartao-midia" src={info.imagem} alt="" referrerPolicy="no-referrer" loading="lazy" />
  return null
}

/** Imagem da nota (ou capa do YouTube / post do X do primeiro link) e os links, clicáveis. */
function MidiaCard({ m }: { m: Partial<Midia> }) {
  const links = m.links ?? []
  const x = !m.imagem ? links.find(ehX) : undefined
  const yt = !m.imagem && !x ? links.map(ytId).find(Boolean) : undefined
  return <>
    {m.imagem ? <img className="cartao-midia" src={m.imagem} alt="" referrerPolicy="no-referrer" loading="lazy" />
      : x ? <MidiaX url={x} />
      : yt ? <img className="cartao-midia" src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" loading="lazy" /> : null}
    {links.length > 0 && <div className="cartao-links">{links.slice(0, 3).map((u) => (
      <a key={u} className="nodrag" href={u} target="_blank" rel="noreferrer" title={u}>{u.replace(/^https?:\/\/(www\.)?/, '')}</a>
    ))}</div>}
  </>
}

const CardIdeia = memo(({ id, data, selected }: NodeProps<Node<DadosIdeia, 'ideia'>>) => {
  const { ideia, saidas } = data
  return (
    <div className={`cartao cartao--ideia ${selected ? 'is-sel' : ''}`}>
      <Alcas /><BotaoChat id={id} />
      <header><span className="cartao-tipo">💡</span><b>{ideia.nome.replace(/^💡\s*/, '')}</b><MarcaProduto tags={[ideia.tags, ...saidas.map((x) => x.tags)]} /></header>
      <MidiaCard m={ideia} />
      {ideia.previa && !ideia.links?.length && <p className="cartao-previa">{ideia.previa}</p>}
      {saidas.length === 0 && <footer className="mudo">sem produção ainda · botão direito → gerar</footer>}
    </div>
  )
})

/** Produto (FIA, FID…): uma bolinha da cor dele no canto do card. A mesa passa a lista dos produtos por contexto. */
const ProdutosUI = createContext<Produto[]>([])
function MarcaProduto({ tags }: { tags: (string[] | undefined)[] }) {
  const ps = useContext(ProdutosUI)
  const meus = produtosDe(tags.flatMap((t) => t ?? []), ps)
  if (!meus.length) return null
  return <span className="cartao-produtos" title={meus.map((p) => `${p.icone} ${p.nome}`).join(' · ')}>{meus.map((p) => <i key={p.slug} style={{ background: p.cor }} />)}</span>
}

/** Botão que aparece no hover do card: leva a nota para o chat do Jarvis (a mesa passa a ação por contexto). */
const ChatUI = createContext<((id: string) => void) | null>(null)
function BotaoChat({ id }: { id: string }) {
  const levar = useContext(ChatUI)
  if (!levar) return null
  return <button type="button" className="cartao-chat nodrag" title="Levar para o chat do Jarvis" aria-label="Levar para o chat do Jarvis"
    onClick={(e) => { e.stopPropagation(); levar(id) }}><span className="orb orb--msg" /></button>
}

/** 🔥 winner: só aparece nos cards cuja nota tem a tag 🔥 (marca-se pelo botão direito → Winner). */
const Fogo = () => <span className="cartao-fogo" title="Winner 🔥 (tag na nota)">🔥</span>

/** Card de produção: as notas de uma mesma copy (as saídas de uma ideia, ou uma copy sozinha), um chip por formato.
 *  Só existem dois tipos de card no canvas: 💡 ideia e 🎬 produção. */
function CartaoProducao({ id, titulo, saidas, destaque, selected }: { id: string; titulo: string; saidas: Producao[]; destaque: StatusProd | null; selected?: boolean }) {
  const winner = saidas.some((s) => s.winner)
  const prox = saidas.filter((s) => s.status !== 'publicado' && s.scheduled).map((s) => s.scheduled!).sort()[0]
  const previa = saidas.find((s) => s.previa)?.previa
  const sozinha = saidas.length === 1 ? saidas[0] : null
  return (
    <div className={`cartao cartao--grupo ${selected ? 'is-sel' : ''} ${winner ? 'is-winner' : ''}`}>
      <Alcas /><BotaoChat id={id} />
      <header><span className="cartao-tipo">{ICONE_GRUPO}</span><b>{titulo}</b>{winner && <Fogo />}<MarcaProduto tags={saidas.map((s) => s.tags)} /></header>
      {previa && <p className="cartao-previa">{previa}</p>}
      <div className="cartao-formatos">
        {saidas.map((s) => (
          <button key={s.nome} type="button" data-raiz={s.raiz} data-nome={s.nome} className={`cartao-formato ${destaque && s.status !== destaque ? 'is-apagada' : ''}`} title={`Abrir ${s.nome} · ${STATUS.find((x) => x.k === s.status)?.nome}`}>
            {s.formato || '📄'}<i className={`ponto is-${s.status}`} />
          </button>
        ))}
      </div>
      {prox ? <footer>próxima · {dataCurta(prox)}</footer>
        : sozinha && <footer><i className={`ponto is-${sozinha.status}`} />{STATUS.find((x) => x.k === sozinha.status)?.nome}{sozinha.scheduled ? ` · ${dataCurta(sozinha.scheduled)}` : ''}</footer>}
    </div>
  )
}

const CardGrupo = memo(({ id, data, selected }: NodeProps<Node<DadosGrupo, 'grupo'>>) =>
  <CartaoProducao id={id} titulo={data.ideia.nome.replace(/^💡\s*/, '')} saidas={data.saidas} destaque={data.destaque} selected={selected} />)

const CardEntrada = memo(({ data, selected }: NodeProps<Node<DadosEntrada, 'entrada'>>) => {
  const e = data.entrada
  return (
    <div className={`cartao cartao--entrada ${selected ? 'is-sel' : ''}`}>
      {e.thumb && <img className="cartao-thumb" src={e.thumb} alt="" referrerPolicy="no-referrer" loading="lazy" />}
      <header><span className="cartao-tipo">{ICONE_ENTRADA[e.tipo] ?? '🔗'}</span><b>{e.nome.replace(/^\S+\s/, '')}</b></header>
      {e.previa && !e.thumb && <p className="cartao-previa">{e.previa}</p>}
      {e.url && <footer>{e.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 42)}</footer>}
      <Alcas />
    </div>
  )
})

// copy sem outras saídas: o mesmo card de produção, com uma nota só
const CardProd = memo(({ id, data, selected }: NodeProps<Node<DadosProd, 'producao'>>) => data.prod.formato === VSL
  ? <CartaoVSL id={id} p={data.prod} selected={selected} />
  : <CartaoProducao id={id} titulo={data.prod.nome.replace(/^[^\p{L}\p{N}]+/u, '')} saidas={[data.prod]} destaque={null} selected={selected} />)

/** 📺 VSL: card à parte, um por roteiro (não se junta às produções curtas). */
function CartaoVSL({ id, p, selected }: { id: string; p: Producao; selected?: boolean }) {
  return (
    <div className={`cartao cartao--vsl ${selected ? 'is-sel' : ''} ${p.winner ? 'is-winner' : ''}`}>
      <Alcas /><BotaoChat id={id} />
      <header><span className="cartao-tipo">📺</span><b>{p.nome.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^VSL\s*[-·:]?\s*/i, '')}</b>
        <span className="cartao-selo">VSL</span>{p.winner && <Fogo />}<MarcaProduto tags={[p.tags]} /></header>
      {p.previa && <p className="cartao-previa">{p.previa}</p>}
      <footer><i className={`ponto is-${p.status}`} />{STATUS.find((s) => s.k === p.status)?.nome}{p.scheduled ? ` · ${dataCurta(p.scheduled)}` : ''}
        {p.palavras ? ` · ${Math.round(p.palavras / 150)} min` : ''}</footer>
    </div>
  )
}

const TIPOS_NO = { ideia: CardIdeia, entrada: CardEntrada, producao: CardProd, grupo: CardGrupo }

/* ---------- montagem dos nós de cada visão ---------- */

/** De que lado sai e entra a seta, pela posição relativa dos dois cards. */
function lados(a: { x: number; y: number }, b: { x: number; y: number }): [string, string] {
  const dx = b.x - a.x, dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy) * 1.3) return dx >= 0 ? ['r', 'l'] : ['l', 'r']
  return dy >= 0 ? ['b', 't'] : ['t', 'b']
}

/** Tudo o que está ligado a um card (ideia ↔ produção, entrada → ideia), andando pelas ligações. */
function ligados(est: EstadoCanvas, raiz: string): Set<string> {
  const viz = new Map<string, Set<string>>()
  const liga = (a: string, b: string) => { viz.set(a, (viz.get(a) ?? new Set()).add(b)); viz.set(b, (viz.get(b) ?? new Set()).add(a)) }
  const ideias = new Set(est.ideias.map((i) => i.nome))
  for (const p of est.producoes) if (p.ideia) { liga(`g:${p.ideia}`, `p:${p.raiz}/${p.nome}`); if (ideias.has(p.ideia)) liga(`i:${p.ideia}`, `g:${p.ideia}`) }
  for (const i of est.ideias) for (const f of i.fontes) liga(`e:${f}`, `i:${i.nome}`)
  const vistos = new Set([raiz]), fila = [raiz]
  while (fila.length) for (const v of viz.get(fila.shift()!) ?? []) if (!vistos.has(v)) { vistos.add(v); fila.push(v) }
  return vistos
}

/** Id do card que mostra esta nota no canvas aberto (sem filtro), ou null se ela está oculta lá
 *  (arquivada, de outro canvas, ou publicada no Inbox). */
export function cardNoCanvas(est: EstadoCanvas, a: Alvo): string | null {
  const ids = new Set(montar(est, 'principal', 'todos').nos.map((n) => n.id))
  const prod = est.producoes.find((p) => p.raiz === a.raiz && p.nome === a.nome)
  const candidatos = a.raiz === 'ideias' ? [`i:${a.nome}`, `g:${a.nome}`] : a.raiz === 'entradas' ? [`e:${a.nome}`]
    : [`p:${a.raiz}/${a.nome}`, ...(prod?.ideia ? [`g:${prod.ideia}`] : [])]
  return candidatos.find((c) => ids.has(c)) ?? null
}

function montar(est: EstadoCanvas, v: Visao, filtro: Filtro): { nos: No[]; arestas: Edge[]; novos: Record<string, { x: number; y: number }> } {
  const arq = new Set(est.arquivados)
  const nomesIdeias = new Set(est.ideias.map((i) => i.nome))
  const saidasDe = new Map<string, Producao[]>()
  // 📺 VSL nunca entra no card de produção (que é para Reels, carrosséis, ads…): ela tem card próprio
  for (const p of est.producoes) if (p.ideia && p.formato !== VSL) saidasDe.set(p.ideia, [...(saidasDe.get(p.ideia) ?? []), p])
  // grupo sem nota 💡: só a chave `ideia:` nas copies. Vale a partir de 2 saídas (1 sozinha fica solta)
  for (const [k, ps] of saidasDe) if (!nomesIdeias.has(k) && ps.length < 2) saidasDe.delete(k)
  const grupos = [...est.ideias, ...[...saidasDe.keys()].filter((k) => !nomesIdeias.has(k)).map((k): Ideia => ({ nome: k, previa: '', fontes: [], mtime: Math.max(...saidasDe.get(k)!.map((p) => p.mtime)) }))]
  const foco = v.startsWith('foco:') ? ligados(est, v.slice(5)) : null
  // publicada: num canvas temático fica (é o lugar dela); no Inbox conta como arquivada (vai para a pasta Publicado)
  const noInbox = (est.canvas?.slug ?? INBOX) === INBOX
  const pubArquivada = (p: Producao) => p.status === 'publicado' && noInbox
  const casa = (p: Producao) => v === 'principal' ? (filtro === 'todos' ? !pubArquivada(p) : p.status === filtro) : v.startsWith('pub-') ? p.status === 'publicado' && p.ano === v.slice(4) : p.status === v
  const destaque: StatusProd | null = foco ? null : v === 'principal' ? (filtro === 'todos' ? null : filtro) : v.startsWith('pub-') ? 'publicado' : (v as StatusProd)
  const forcados = new Set(est.visiveis ?? [])
  // trazido à mão para este canvas (⌘↵ na busca, Mover para) aparece mesmo publicado
  const entra = (id: string, regra: boolean) => (!foco && v === 'principal' && forcados.has(id)) || (foco ? foco.has(id) : regra)

  const itens: { id: string; no: Omit<No, 'position'>; ordem: number }[] = []
  const add = (id: string, no: Omit<No, 'position' | 'id'>, ordem: number) => itens.push({ id, no: { ...no, id: '' } as Omit<No, 'position'>, ordem })
  for (const i of grupos) {
    const s = (saidasDe.get(i.nome) ?? []).sort(porFormato)
    const vivo = s.some(casa)
    if (nomesIdeias.has(i.nome) && entra(`i:${i.nome}`, v === 'principal' ? (s.length === 0 && filtro === 'todos') || vivo : vivo)) add(`i:${i.nome}`, { type: 'ideia', data: { ideia: i, saidas: s } }, -i.mtime)
    if (s.length && entra(`g:${i.nome}`, vivo)) add(`g:${i.nome}`, { type: 'grupo', data: { ideia: i, saidas: s, destaque } }, -i.mtime + 0.5)
  }
  for (const e of est.entradas) if (entra(`e:${e.nome}`, v === 'principal' && filtro === 'todos')) add(`e:${e.nome}`, { type: 'entrada', data: { entrada: e } }, -e.mtime)
  for (const p of est.producoes) {
    if (p.ideia && saidasDe.has(p.ideia)) continue   // está dentro do card da produção
    const id = `p:${p.raiz}/${p.nome}`
    if (entra(id, casa(p))) add(id, { type: 'producao', data: { prod: p } }, -(p.scheduled ? Date.parse(p.scheduled) / 1000 : p.mtime))
  }
  if (foco) { const r = itens.find((x) => x.id === v.slice(5)); if (r) r.ordem = -Infinity }   // o card do canvas próprio vem primeiro

  const visiveis = foco ? itens : itens.filter((x) => !arq.has(x.id))
  const pos = (id: string) => est.pos[chavePos(v, id)]
  const fundo = Math.max(0, ...visiveis.map((x) => pos(x.id)).filter(Boolean).map((p) => p!.y + 240))
  const novos: Record<string, { x: number; y: number }> = {}
  // a produção sem lugar nasce à direita da ideia dela
  const vis = new Set(visiveis.map((x) => x.id))
  const ideiaDe = (id: string) => (id.startsWith('g:') && vis.has(`i:${id.slice(2)}`) ? `i:${id.slice(2)}` : null)
  const PASSO_X = LARG + 34
  const filho = new Map<string, string>()
  for (const x of visiveis) { const i = ideiaDe(x.id); if (i && !pos(x.id)) filho.set(i, x.id) }
  const aoLado = (base: { x: number; y: number }, k: string) => { novos[chavePos(v, k)] = { x: base.x + PASSO_X + 50, y: base.y } }
  const sem = visiveis.filter((x) => !pos(x.id) && !(ideiaDe(x.id) && filho.get(ideiaDe(x.id)!) === x.id)).sort((a, b) => a.ordem - b.ordem)
  const larguraMax = Math.max(6, Math.round(Math.sqrt(visiveis.filter((x) => !pos(x.id)).length * 1.8))) * PASSO_X   // mais larga que alta, como a tela
  let cx = 0, cy = fundo
  for (const x of sem) {
    const k = filho.get(x.id)
    const w = k ? PASSO_X * 2 + 50 : PASSO_X
    if (cx > 0 && cx + w > larguraMax) { cx = 0; cy += 230 }
    novos[chavePos(v, x.id)] = { x: cx, y: cy }
    if (k) aoLado({ x: cx, y: cy }, k)
    cx += w
  }
  for (const [i, k] of filho) { const p = pos(i); if (p) aoLado(p, k) }   // ideia já posicionada: a produção nova ao lado
  const nos = visiveis.map((x) => ({ ...x.no, id: x.id, position: pos(x.id) ?? novos[chavePos(v, x.id)] }) as No)
  const onde = new Map(nos.map((n) => [n.id, n.position]))
  const seta = (de: string, para: string, classe: string, cor: string, extra: Partial<Edge> = {}): Edge => {
    const [sh, th] = lados(onde.get(de)!, onde.get(para)!)
    return { id: `${de}→${para}`, source: de, target: para, sourceHandle: sh, targetHandle: th, className: classe, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: cor }, ...extra }
  }
  const arestas: Edge[] = []
  for (const n of nos) if (n.type === 'grupo' && onde.has(`i:${n.data.ideia.nome}`)) arestas.push(seta(`i:${n.data.ideia.nome}`, n.id, 'aresta-saida', '#8f8a83', { deletable: false }))
  // VSL da mesma ideia: linha da ideia (ou da produção, se não houver nota 💡) até o card da VSL
  for (const n of nos) if (n.type === 'producao' && n.data.prod.formato === VSL && n.data.prod.ideia) {
    const de = [`i:${n.data.prod.ideia}`, `g:${n.data.prod.ideia}`].find((k) => onde.has(k))
    if (de) arestas.push(seta(de, n.id, 'aresta-saida', '#8f8a83', { deletable: false }))
  }
  for (const i of est.ideias) for (const f of i.fontes) if (onde.has(`e:${f}`) && onde.has(`i:${i.nome}`)) arestas.push(seta(`e:${f}`, `i:${i.nome}`, 'aresta-fonte', '#8fa52a'))
  return { nos, arestas, novos }
}

/* ---------- canvas ---------- */

type Props = {
  onAbrir: (a: Alvo, voltar?: Voltar) => void
  mostrar?: { alvo: Alvo; n: number }   // "Mostrar no canvas" do modal: enquadra e seleciona o card
  onTrecho?: (t: Trecho, pedido?: string) => void
  onPedido?: (texto: string) => void
  versao?: number
  canvas?: string   // slug do canvas (o layout vem pelo cabeçalho X-Canvas, ver canvasApi)
  onTrocarCanvas?: (slug: string | null) => void   // null = página inicial (lista dos canvas)
  onCaminho?: (c: Passo[]) => void   // breadcrumb do topo: o canvas e a vista aberta nele
}
/** Um nível do breadcrumb; sem `ir` é o nível atual. */
export type Passo = { rotulo: string; ir?: () => void }

export function Canvas(p: Props) {
  return <ReactFlowProvider><Mesa {...p} /></ReactFlowProvider>
}

function Mesa({ onAbrir, onTrecho, onPedido, versao, mostrar, canvas = INBOX, onTrocarCanvas, onCaminho }: Props) {
  const [trocar, setTrocar] = useState(false)   // seletor de canvas no nome da barra
  const [todosCanvas, setTodosCanvas] = useState<ResumoCanvas[]>([])
  const chaveLocal = (k: string) => `${k}#${canvas}`   // cada canvas guarda a sua vista, pinados etc.
  const [est, setEst] = useState<EstadoCanvas | null>(null)
  const [visao, setVisao] = useState<Visao>('principal')
  const [filtro, setFiltro] = useState<Filtro>(() => { try { return (localStorage.getItem('canvas-filtro') as Filtro) || 'todos' } catch { return 'todos' } })
  useEffect(() => { try { localStorage.setItem('canvas-filtro', filtro) } catch { /* sem storage */ } }, [filtro])
  // chips liga/desliga, independentes: todos começam ligados e cada clique esconde ou mostra aquele tipo
  const [tiposVer, setTiposVer] = useState<TipoVer[]>(() => {
    try { const v = JSON.parse(localStorage.getItem('canvas-tipos') || 'null'); return Array.isArray(v) ? v : TIPOS_VER.map((t) => t.k) } catch { return TIPOS_VER.map((t) => t.k) }
  })
  useEffect(() => { try { localStorage.setItem('canvas-tipos', JSON.stringify(tiposVer)) } catch { /* sem storage */ } }, [tiposVer])
  const alternarTipo = (k: TipoVer) => setTiposVer((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]))
  // filtro de produto: os escondidos (vazio = todos aparecem). SEM = cards sem produto nenhum
  const [prodFora, setProdFora] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem('canvas-produtos-fora') || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } })
  useEffect(() => { try { localStorage.setItem('canvas-produtos-fora', JSON.stringify(prodFora)) } catch { /* sem storage */ } }, [prodFora])
  const alternarProduto = (k: string) => setProdFora((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]))
  // canvas próprio de um card: pinados ficam na barra da esquerda; abaixo, as últimas aberturas
  const [vistas, setVistas] = useState<Vistas>(() => { try { return { pinados: [], historico: [], ...JSON.parse(localStorage.getItem(chaveLocal('canvas-vistas')) || '{}') } } catch { return { pinados: [], historico: [] } } })
  useEffect(() => { try { localStorage.setItem(chaveLocal('canvas-vistas'), JSON.stringify(vistas)) } catch { /* sem storage */ } }, [vistas])
  const abrirVista = useCallback((id: string) => {
    setVisao(`foco:${id}`)
    setVistas((v) => v.pinados.includes(id) ? v : { ...v, historico: [id, ...v.historico.filter((x) => x !== id)].slice(0, MAX_HIST) })
  }, [])
  const pinar = useCallback((id: string, sim: boolean) => setVistas((v) => sim
    ? { pinados: [...v.pinados.filter((x) => x !== id), id], historico: v.historico.filter((x) => x !== id) }
    : { pinados: v.pinados.filter((x) => x !== id), historico: [id, ...v.historico.filter((x) => x !== id)].slice(0, MAX_HIST) }), [])
  const [nos, setNos, mudarNos] = useNodesState<No>([])
  // breadcrumb: NEO-OBSIDIAN › canvas › vista (pasta ou card aberto em canvas próprio); clicar no canvas volta ao principal
  useEffect(() => {
    if (!onCaminho) return
    const raiz: Passo = { rotulo: est?.canvas ? `${est.canvas.icone} ${est.canvas.nome}` : 'Canvas', ir: visao === 'principal' ? undefined : () => setVisao('principal') }
    onCaminho(visao === 'principal' ? [raiz] : [raiz, { rotulo: NOME_VISAO(visao) }])
  }, [onCaminho, visao, est?.canvas?.nome, est?.canvas?.icone])  // eslint-disable-line react-hooks/exhaustive-deps
  const [arestas, setArestas, mudarArestas] = useEdgesState<Edge>([])
  // linhas: dá para esconder todas; as do card selecionado aparecem sempre, em destaque
  const [linhas, setLinhas] = useState(() => { try { return localStorage.getItem('canvas-linhas') !== 'nao' } catch { return true } })
  useEffect(() => { try { localStorage.setItem('canvas-linhas', linhas ? 'sim' : 'nao') } catch { /* sem storage */ } }, [linhas])
  // a seleção só muda quando muda quem está selecionado: arrastar (que troca `nos` a cada quadro) não recalcula as linhas
  const chaveSel = nos.filter((n) => n.selected).map((n) => n.id).join('|')
  const selecionados = useMemo(() => new Set(chaveSel ? chaveSel.split('|') : []), [chaveSel])
  // conta ao chat onde o Rodrigo está (canvas, vista, filtros, seleção): o Jarvis recebe isso em toda mensagem
  useEffect(() => {
    onde.canvas = est?.canvas ? { nome: est.canvas.nome, icone: est.canvas.icone } : null
    onde.vista = visao
    onde.selecao = [...selecionados].map(nomeDoId)
    onde.tipos = tiposVer
    onde.filtro = filtro
    onde.produtos = prodFora.length ? (est?.produtos ?? []).filter((p) => !prodFora.includes(p.slug)).map((p) => p.nome).concat(prodFora.includes(SEM) ? [] : ['sem produto']) : null
  }, [est, visao, selecionados, tiposVer, filtro, prodFora])
  const arestasVis = useMemo(() => arestas.map((e) => {
    const foco = selecionados.has(e.source) || selecionados.has(e.target)
    if (foco) return { ...e, hidden: false, zIndex: 1000, className: `${e.className ?? ''} is-foco`, animated: true,
      markerEnd: typeof e.markerEnd === 'object' ? { ...e.markerEnd, color: '#1d1d1f' } : e.markerEnd }
    return linhas ? e : { ...e, hidden: true }
  }), [arestas, selecionados, linhas])
  const [menu, setMenu] = useState<MenuCtx | null>(null)
  const [moverAberto, setMoverAberto] = useState(false)   // submenu "Mover para ›" do botão direito (abre ao lado, no hover)
  const [moverLado, setMoverLado] = useState<'dir' | 'esq'>('dir')
  const [produtoAberto, setProdutoAberto] = useState(false)   // submenu "Produto ›"
  useEffect(() => { setProdutoAberto(false); if (menu) listarCanvases().then(setTodosCanvas).catch(() => {}) }, [menu])
  useEffect(() => setMoverAberto(false), [menu])
  const [pergunta, setPergunta] = useState<Pergunta | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // modal de tabela das pastas; ao abrir uma copy dali ele some e o "voltar" do modal da nota o traz de volta como estava
  const [tabela, setTabela] = useState<EstadoTabela | null>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const rf = useReactFlow<No, Edge>()
  const visaoAntes = useRef<Visao | null>(null)
  const enquadrar = useRef(false)
  const iniciados = useNodesInitialized()

  const avisar = useCallback((m: string, ms = 2600) => { setAviso(m); window.setTimeout(() => setAviso((a) => (a === m ? null : a)), ms) }, [])
  // Posições já movidas aqui mas ainda gravando no servidor: uma recarga que chega antes da gravação traria a posição
  // velha e o card pularia de volta por um instante. Elas passam por cima do que vem do servidor até a gravação acabar.
  const posPendentes = useRef<Record<string, { x: number; y: number }>>({})
  const recarregar = useCallback(() => carregarCanvas().then((e) => setEst({ ...e, pos: { ...e.pos, ...posPendentes.current } }))
    .catch(() => avisar('Não consegui ler o canvas.')), [avisar])
  const recarregarRef = useRef(recarregar)
  recarregarRef.current = recarregar
  useEffect(() => { recarregar() }, [recarregar, versao])
  // Mostrar no canvas: volta ao principal sem filtro, espera o card ter tamanho, enquadra e seleciona
  const mostrarFeito = useRef(0)
  useEffect(() => {
    if (!mostrar || !est || mostrarFeito.current === mostrar.n) return
    mostrarFeito.current = mostrar.n
    const id = cardNoCanvas(est, mostrar.alvo)
    if (!id) { avisar('Essa nota está oculta neste canvas (arquivada, de outro canvas ou publicada no Inbox).'); return }
    if (visao !== 'principal') setVisao('principal')
    if (filtro !== 'todos') setFiltro('todos')
    const ir = (k = 0) => {
      const n = rf.getInternalNode(id)
      if (!n && k < 40) { window.setTimeout(() => ir(k + 1), 60); return }   // card ainda não montado nesta visão
      if (!n?.measured?.width && k < 8) { window.setTimeout(() => ir(k + 1), 60); return }   // espera o tamanho um pouco, mas não trava sem ele
      setNos((ns) => ns.map((x) => (x.selected !== (x.id === id) ? { ...x, selected: x.id === id } : x)))
      enquadrarTudo(450, [id])
    }
    window.setTimeout(() => ir(), visao !== 'principal' ? 250 : 0)
  }, [mostrar, est])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!est) return
    const m = montar(est, visao, filtro)
    const prods = est.produtos ?? []
    const passaProduto = (x: No) => {
      if (!prodFora.length) return true
      const meus = produtosDe(tagsDoNo(x), prods)
      return meus.length ? meus.some((p) => !prodFora.includes(p.slug)) : !prodFora.includes(SEM)
    }
    const n = m.nos.filter((x) => tiposVer.includes(tipoDoCard(x)) && passaProduto(x))
    const ids = new Set(n.map((x) => x.id))
    const a = m.arestas.filter((e) => ids.has(e.source) && ids.has(e.target)), novos = m.novos
    // remontar não pode tirar do lugar o card que está sendo arrastado nem desfazer a seleção
    const atuais = new Map((rf.getNodes() as No[]).map((x) => [x.id, x]))
    setNos(n.map((x) => {
      const v = atuais.get(x.id)
      if (!v) return x
      if (v.dragging) return { ...x, position: v.position, dragging: true, selected: v.selected } as No
      return v.selected ? ({ ...x, selected: true } as No) : x
    }))
    setArestas(a)
    if (Object.keys(novos).length) post('posicoes', novos, 'PUT').then(() => setEst((e) => e && { ...e, pos: { ...e.pos, ...novos } })).catch(() => {})
    if (visaoAntes.current !== visao) { visaoAntes.current = visao; enquadrar.current = true }
  }, [est, visao, filtro, setNos, setArestas, rf, tiposVer, prodFora])

  // cada visão abre onde você parou nela; na primeira vez, enquadra tudo (depois que os cards têm tamanho)
  useEffect(() => {
    if (!iniciados || !enquadrar.current) return
    enquadrar.current = false
    try {
      const vp = JSON.parse(localStorage.getItem(chaveLocal(`canvas-vp-${visao}`)) || 'null')
      if (vp) { rf.setViewport(vp); return }
    } catch { /* sem storage */ }
    // espera os cards desta visão terem tamanho (o "iniciados" ainda pode ser o da visão anterior)
    const tentarEnquadrar = (n = 0) => {
      const ns = rf.getNodes()
      if (n < 20 && (!ns.length || ns.some((x) => !x.measured?.width))) { window.setTimeout(() => tentarEnquadrar(n + 1), 50); return }
      enquadrarTudo(0)
    }
    window.setTimeout(() => tentarEnquadrar(), 30)
  }, [iniciados, nos, visao, rf])  // eslint-disable-line react-hooks/exhaustive-deps
  // enquadra pela área livre da página (o canvas vai por baixo da navbar e do chat)
  const enquadrarTudo = (dur = 350, ids?: string[]) => {
    const lista = ids ? rf.getNodes().filter((n) => ids.includes(n.id)) : rf.getNodes()
    const r = caixa.current?.getBoundingClientRect()
    if (!lista.length || !r) return
    const b = { ...rf.getNodesBounds(lista) }
    const f = 48
    const z = Math.min(ids ? 1.2 : 1, Math.max(0.05, Math.min((r.width - 2 * f) / b.width, (r.height - 2 * f) / b.height)))
    rf.setViewport({ x: r.left + (r.width - b.width * z) / 2 - b.x * z, y: r.top + (r.height - b.height * z) / 2 - b.y * z, zoom: z }, { duration: dur })
  }
  const lembrarVista = useCallback(() => { try { localStorage.setItem(chaveLocal(`canvas-vp-${visao}`), JSON.stringify(rf.getViewport())) } catch { /* sem storage */ } }, [visao, rf])

  // as pastas (Em edição, Agendado, Publicado) são globais: contam e listam as notas de todos os canvas
  const [estTudo, setEstTudo] = useState<EstadoCanvas | null>(null)
  useEffect(() => { carregarTudo().then(setEstTudo).catch(() => {}) }, [canvas, est])
  const global = estTudo ?? est
  const contagem = useMemo(() => {
    const c: Record<'ideia' | 'edicao' | 'agendado' | 'publicado', number> = { ideia: 0, edicao: 0, agendado: 0, publicado: 0 }
    const porAno: Record<string, number> = {}
    for (const p of global?.producoes ?? []) {
      c[p.status]++
      if (p.status === 'publicado') porAno[p.ano] = (porAno[p.ano] ?? 0) + 1
    }
    return { ...c, anos: Object.entries(porAno).sort((a, b) => b[0].localeCompare(a[0])) }
  }, [global])

  const guardarPos = useCallback((lista: No[]) => {
    const d: Record<string, { x: number; y: number }> = {}
    for (const n of lista) d[chavePos(visao, n.id)] = n.position
    Object.assign(posPendentes.current, d)
    post('posicoes', d, 'PUT').catch(() => {}).finally(() => {
      for (const [k, v] of Object.entries(d)) if (posPendentes.current[k] === v) delete posPendentes.current[k]
    })
    setEst((e) => e && { ...e, pos: { ...e.pos, ...d } })
  }, [visao])

  // ⌘Z / ⌘⇧Z: desfaz e refaz movimentos de cards
  type Mov = { visao: Visao; antes: Record<string, { x: number; y: number }>; depois: Record<string, { x: number; y: number }> }
  const empilhar = (m: Mov) => { pilhaDesfazer.current = [...pilhaDesfazer.current.slice(-49), m]; pilhaRefazer.current = []; return m }
  const pilhaDesfazer = useRef<Mov[]>([])
  const pilhaRefazer = useRef<Mov[]>([])
  const inicioArraste = useRef<Record<string, { x: number; y: number }>>({})
  const comecouArraste = (lista: No[]) => { inicioArraste.current = Object.fromEntries(lista.map((n) => [n.id, { ...n.position }])) }
  const registrar = (lista: No[]) => {
    const antes: Mov['antes'] = {}, depois: Mov['depois'] = {}
    for (const n of lista) {
      const a = inicioArraste.current[n.id]
      if (a && (a.x !== n.position.x || a.y !== n.position.y)) { antes[n.id] = a; depois[n.id] = { ...n.position } }
    }
    if (!Object.keys(antes).length) return undefined
    return empilhar({ visao, antes, depois })
  }
  const aplicarPos = useCallback((v: Visao, pos: Mov['antes']) => {
    const d: Record<string, { x: number; y: number }> = {}
    for (const [id, p] of Object.entries(pos)) d[chavePos(v, id)] = p
    post('posicoes', d, 'PUT').catch(() => {})
    setEst((e) => e && { ...e, pos: { ...e.pos, ...d } })
    if (v === visao) setNos((ns) => ns.map((n) => (pos[n.id] ? { ...n, position: pos[n.id] } : n)))
  }, [visao, setNos])
  const desfazer = useCallback((refazer: boolean) => {
    const de = refazer ? pilhaRefazer : pilhaDesfazer, para = refazer ? pilhaDesfazer : pilhaRefazer
    const m = de.current.at(-1)
    if (!m) { avisar(refazer ? 'Nada para refazer' : 'Nada para desfazer'); return }
    de.current = de.current.slice(0, -1)
    para.current = [...para.current, m]
    const pos = refazer ? m.depois : m.antes
    aplicarPos(m.visao, pos)
    avisar(refazer ? 'Refeito' : 'Desfeito', 1200)
  }, [aplicarPos, avisar])

  const perguntar = (p: Pergunta) => setPergunta(p)

  const tentar = async (f: () => Promise<unknown>, ok?: string) => {
    try { await f(); if (ok) avisar(ok); await recarregar() } catch (e) { avisar((e as Error).message) }
  }
  const tentarRef = useRef(tentar)
  tentarRef.current = tentar
  // cards que entram em "Mover para ›" e "Produto ›" (ideia, produção e copy solta)
  const ehCard = (n: No): n is Node<DadosIdeia, 'ideia'> | Node<DadosProd, 'producao'> | Node<DadosGrupo, 'grupo'> => n.type === 'ideia' || n.type === 'grupo' || n.type === 'producao'
  const notasDoCard = (n: Node<DadosIdeia, 'ideia'> | Node<DadosProd, 'producao'> | Node<DadosGrupo, 'grupo'>) =>
    n.type === 'grupo' ? n.data.saidas : n.type === 'ideia' ? [n.data.ideia, ...n.data.saidas] : [n.data.prod]
  // submenus do botão direito, iguais para um card e para a seleção: abrem ao lado no hover
  const abreAoLado = (e: React.MouseEvent<HTMLElement>, abrir: (v: boolean) => void) => {
    const r = e.currentTarget.getBoundingClientRect(); setMoverLado(r.right + 250 > window.innerWidth ? 'esq' : 'dir'); abrir(true)
  }
  /** Mover para ›: leva os cards (com a ideia e as copies deles) para outro canvas. Um nome de nota por card basta. */
  const subMover = (cards: ReturnType<typeof notasDoCard>[]) => {
    if (!cards.length || !todosCanvas.length) return null
    const n = cards.length
    const mover = (c: ResumoCanvas) => { setMenu(null); setMoverAberto(false)
      tentar(async () => { await post('mover', { notas: cards.map((ns) => ns[0].nome), canvas: c.slug === INBOX ? null : c.nome }) },
        `${n > 1 ? `${n} cards movidos` : 'Movido'} para ${c.icone} ${c.nome}`) }
    return (
      <div className="menu-sub-caixa" onMouseEnter={(e) => abreAoLado(e, setMoverAberto)} onMouseLeave={() => setMoverAberto(false)}>
        <button role="menuitem" className={`menu-sub ${moverAberto ? 'is-aberto' : ''}`} onClick={() => setMoverAberto((v) => !v)}>
          <Icone n="pasta" t={15} />Mover para<span className="menu-seta">›</span></button>
        {moverAberto && <div className={`menu-caixas menu-lateral is-${moverLado} glass glass--light`} role="menu">
          {todosCanvas.map((c) => (
            <button key={c.slug} role="menuitem" disabled={c.slug === canvas} onClick={() => mover(c)}>
              <i className="tabela-cor" style={{ background: c.cor }} />{c.icone} {c.nome}{c.slug === canvas ? ' · aqui' : ''}</button>
          ))}
        </div>}
      </div>
    )
  }
  /** Produto ›: de quais produtos os cards são (as tags da nota). Na seleção, "–" quando só parte é. */
  const subProduto = (cards: ReturnType<typeof notasDoCard>[]) => {
    const prods = est?.produtos ?? []
    const copias = cards.map((ns) => ns.filter((x): x is Producao => 'raiz' in x)).map((ns, i) => (ns.length ? ns : cards[i]))
    if (!cards.length || !prods.length) return null
    const notasTodas = copias.flat()
    const n = cards.length
    const marcar = (p: Produto, sim: boolean) => tentar(async () => {
      await post('produto', { notas: notasTodas.map((x) => x.nome), produto: p.slug, sim })
    }, `${n > 1 ? `${n} cards: ` : ''}${sim ? `agora são de ${p.nome}` : `saíram de ${p.nome}`}`)
    return (
      <div className="menu-sub-caixa" onMouseEnter={(e) => abreAoLado(e, setProdutoAberto)} onMouseLeave={() => setProdutoAberto(false)}>
        <button role="menuitem" className={`menu-sub ${produtoAberto ? 'is-aberto' : ''}`} onClick={() => setProdutoAberto((v) => !v)}>
          <Icone n="grafo" t={15} />Produto<span className="menu-seta">›</span></button>
        {produtoAberto && <div className={`menu-caixas menu-lateral is-${moverLado} glass glass--light`} role="menu">
          {prods.map((p) => {
            const dentro = copias.filter((ns) => ns.some((x) => produtosDe(x.tags, [p]).length)).length
            const on = dentro === n, parte = dentro > 0 && !on
            return <button key={p.slug} role="menuitemcheckbox" aria-checked={on ? true : parte ? 'mixed' : false} className="menu-check" onClick={() => marcar(p, !on)}
              title={on ? `Tirar de ${p.nome} (tira as tags ${p.tags.join(', ')})` : `Marcar como ${p.nome} (tag ${p.tags[0]})`}>
              <i className={`menu-caixinha ${on || parte ? 'is-on' : ''}`} style={on || parte ? { background: p.cor, borderColor: p.cor } : undefined}>{on ? '✓' : parte ? '–' : ''}</i>{p.icone} {p.nome}
              {parte && <em className="menu-parte">{dentro}/{n}</em>}</button>
          })}
        </div>}
      </div>
    )
  }
  const alvoDe = (n: No): Alvo => {
    if (n.type === 'ideia') return { raiz: 'ideias', nome: n.data.ideia.nome }
    if (n.type === 'entrada') return { raiz: 'entradas', nome: n.data.entrada.nome }
    if (n.type === 'producao') return { raiz: n.data.prod.raiz, nome: n.data.prod.nome }
    // a produção abre sempre no 📱 Reels quando houver; entre várias, a que interessa nesta visão
    const { saidas, destaque } = n.data
    const reels = saidas.filter((x) => x.formato === '📱')
    const lista = reels.length ? reels : saidas
    const s = lista.find((x) => (destaque ? x.status === destaque : x.status !== 'publicado')) ?? lista[0]
    return { raiz: s.raiz, nome: s.nome }
  }
  const alvoDeRef = useRef(alvoDe)
  alvoDeRef.current = alvoDe
  const existe = useCallback((id: string) => {
    if (!est) return false
    const r = id.slice(2)
    if (id.startsWith('i:')) return est.ideias.some((i) => i.nome === r)
    if (id.startsWith('g:')) return est.producoes.some((p) => p.ideia === r)
    if (id.startsWith('e:')) return est.entradas.some((e) => e.nome === r)
    return est.producoes.some((p) => `${p.raiz}/${p.nome}` === r)
  }, [est])
  const lixeira = async (a: Alvo) => {
    const r = await fetch(`/api/notas/${a.raiz}/${encodeURIComponent(a.nome)}/acao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'lixeira' }) })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Não consegui deletar.')
  }
  const deletar = (n: No) => {
    const notas: Alvo[] = n.type === 'grupo' ? n.data.saidas.map((s) => ({ raiz: s.raiz, nome: s.nome })) : [alvoDe(n)]
    perguntar({
      titulo: notas.length > 1 ? `Deletar as ${notas.length} saídas de ${nomeDoId(n.id)}?` : `Deletar ${notas[0].nome}?`,
      dica: `${notas.length > 1 ? notas.map((x) => x.nome).join(' · ') + '. ' : ''}Vai para a lixeira do vault (.trash): dá para recuperar pelo Obsidian.`,
      confirmar: 'Deletar',
      ok: () => tentar(async () => { for (const a of notas) await lixeira(a); if (visao === `foco:${n.id}`) setVisao('principal') }, notas.length > 1 ? 'Saídas na lixeira' : 'Na lixeira do vault'),
    })
  }

  // arrastar em cima de outro card: liga ou agrupa
  const soltou = useCallback((_: unknown, no: No, lista: No[]) => {
    registrar(lista)
    guardarPos(lista)
    if (lista.length !== 1) return
    // só liga/agrupa quando o meio do card solto cai dentro do outro (encostar a borda não conta)
    const w = no.measured?.width ?? LARG, h = no.measured?.height ?? 120
    const meio = { x: no.position.x + w / 2, y: no.position.y + h / 2 }
    const alvo = rf.getIntersectingNodes(no).find((x) => x.id !== no.id && meio.x > x.position.x && meio.x < x.position.x + (x.measured?.width ?? LARG)
      && meio.y > x.position.y && meio.y < x.position.y + (x.measured?.height ?? 120)) as No | undefined
    if (!alvo) return
    const tentar = (f: () => Promise<unknown>, ok?: string) => tentarRef.current(f, ok)
    if (no.type === 'producao' && (alvo.type === 'ideia' || alvo.type === 'grupo')) {
      tentar(() => post('ligar', { producao: { raiz: no.data.prod.raiz, nome: no.data.prod.nome }, ideia: alvo.data.ideia.nome }), `Entrou em ${alvo.data.ideia.nome}`)
    } else if (no.type === 'producao' && alvo.type === 'producao') {
      const base = alvo.data.prod.nome.replace(/^[^\p{L}\p{N}]+/u, '')
      perguntar({ titulo: 'Agrupar numa produção 🎬', dica: 'Nome da produção', inicial: base, ok: (t) => tentar(
        () => post('agrupar', { titulo: t, pos: alvo.position, producoes: [no, alvo].map((x) => ({ raiz: (x as Node<DadosProd>).data.prod.raiz, nome: (x as Node<DadosProd>).data.prod.nome })) }),
        'Produção criada') })
    } else if (no.type === 'entrada' && (alvo.type === 'ideia' || alvo.type === 'grupo')) {
      const p = { x: alvo.position.x - LARG - 60, y: alvo.position.y }
      rf.updateNode(no.id, { position: p })
      guardarPos([{ ...no, position: p }])
      tentar(() => post('fonte', { ideia: alvo.data.ideia.nome, entrada: no.data.entrada.nome }), 'Entrada ligada à ideia')
    }
  }, [guardarPos, rf])  // eslint-disable-line react-hooks/exhaustive-deps

  const conectou = useCallback((c: Connection) => {
    const a = rf.getNode(c.source) as No | undefined, b = rf.getNode(c.target) as No | undefined
    if (!a || !b || a.id === b.id) return
    const de = (t: No['type']) => [a, b].find((x) => x.type === t) as No | undefined
    const outro = (x: No) => (x.id === a.id ? b : a)
    const ref = (x: No) => ({ raiz: (x as Node<DadosProd>).data.prod.raiz, nome: (x as Node<DadosProd>).data.prod.nome })
    const ide = de('ideia') ?? de('grupo'), ent = de('entrada')
    if (ide && ent) return tentar(() => post('fonte', { ideia: (ide as Node<DadosIdeia>).data.ideia.nome, entrada: (ent as Node<DadosEntrada>).data.entrada.nome }), 'Entrada ligada à ideia')
    if (ide && de('ideia') && de('grupo')) return avisar('Essa produção já é dessa ideia.')
    if (ide && outro(ide).type === 'producao') return tentar(() => post('ligar', { producao: ref(outro(ide)), ideia: (ide as Node<DadosIdeia>).data.ideia.nome }), 'Nota ligada à ideia')
    if (a.type === 'producao' && b.type === 'producao') {
      // duas notas: se uma já tem ideia, a outra entra nela; senão, nasce uma ideia nova para as duas
      const ja = [a, b].find((x) => (x as Node<DadosProd>).data.prod.ideia) as Node<DadosProd> | undefined
      if (ja) return tentar(() => post('ligar', { producao: ref(outro(ja as No)), ideia: ja.data.prod.ideia }), `Entrou em ${ja.data.prod.ideia}`)
      return perguntar({ titulo: 'Agrupar numa produção 🎬', dica: 'Nome da produção', inicial: b.data.prod.nome.replace(/^[^\p{L}\p{N}]+/u, ''), ok: (t) => tentar(
        () => post('agrupar', { titulo: t, pos: { x: a.position.x - LARG - 80, y: a.position.y }, producoes: [ref(a), ref(b)] }), 'Produção criada') })
    }
    if (ent && outro(ent).type === 'producao') return avisar('Ligue a entrada a uma 💡 ideia; a nota liga na ideia.')
    avisar('Essa ligação não tem sentido aqui.')
  }, [avisar, rf])  // eslint-disable-line react-hooks/exhaustive-deps

  // Delete só apaga linhas (desliga a fonte); cards não se apagam pelo canvas
  const antesDeApagar: OnBeforeDelete<No, Edge> = async ({ edges }) => {
    for (const e of edges) {
      if (e.source.startsWith('e:')) await post('fonte', { ideia: e.target.slice(2), entrada: e.source.slice(2), sim: false }).catch(() => {})
      else if (e.target.startsWith('p:')) {
        const [raiz, ...resto] = e.target.slice(2).split('/')
        await post('ligar', { producao: { raiz, nome: resto.join('/') }, ideia: null }).catch(() => {})
      }
    }
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
    await tentar(() => post('entrada', { conteudo, pos, ideia }), ideia ? 'Adicionado à ideia' : 'Ideia criada')
  }
  // 💡 ideia: um nome curto vira a nota; link ou texto maior vira a ideia já com o material dentro
  const novaIdeia = (t: string, pos: { x: number; y: number }) =>
    /https?:\/\//.test(t) || t.includes('\n') || t.length > 90 ? novaEntrada(t, pos) : tentar(() => post('ideia', { titulo: t, pos }), 'Ideia criada')
  const pedirIdeia = (pos: { x: number; y: number }) => perguntar({ titulo: 'Nova ideia', dica: 'Um nome, ou cole um link (YouTube, Instagram, X, matéria) ou um texto', longo: true, ok: (t) => novaIdeia(t, pos) })

  async function novaSaida(ideia: string, formato: string, nome: string) {
    try {
      const d = await post<Alvo>('saida', { ideia, formato })
      await recarregar()
      onAbrir(d)
      onPedido?.(pedidoSaida(ideia, d.nome, formato, nome))
    } catch (e) { avisar((e as Error).message) }
  }

  // colar um link ou texto no canvas cria uma 💡 ideia com o material dentro
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

  // ⌘+ / ⌘− dão zoom no canvas (em vez do zoom da página) · ⌘A seleciona todos os cards · Esc limpa a seleção
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('textarea, input, select, .cm-editor') || document.querySelector('.modal-fundo, .paleta-fundo')) return
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && (k === '=' || k === '+')) { e.preventDefault(); rf.zoomIn({ duration: 160 }) }
      else if ((e.metaKey || e.ctrlKey) && (k === '-' || k === '_')) { e.preventDefault(); rf.zoomOut({ duration: 160 }) }
      else if ((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'y')) { e.preventDefault(); desfazer(k === 'y' || e.shiftKey) }
      else if ((e.metaKey || e.ctrlKey) && k === 'a') { e.preventDefault(); setNos((ns) => ns.map((n) => (n.hidden || n.selected ? n : { ...n, selected: true }))) }
      else if (k === 'escape') setNos((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [rf, setNos, desfazer])

  // ⌘ segurado liga a camada de seleção: arrastar = caixa (mesmo começando num card), clicar = põe/tira o card
  const [selecionando, setSelecionando] = useState(false)
  const [caixaSel, setCaixaSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const caixaAtiva = useRef(false)
  useEffect(() => {
    const desce = (e: KeyboardEvent) => { if ((e.key === 'Meta' || e.key === 'Control') && !(e.target instanceof Element && e.target.closest('textarea, input, .cm-editor'))) setSelecionando(true) }
    const sobe = (e: KeyboardEvent) => { if (e.key === 'Meta' || e.key === 'Control') setSelecionando(false) }
    const sai = () => setSelecionando(false)
    // o macOS às vezes engole o keyup do ⌘ (⌘Tab): o mouse sem ⌘ desliga a camada
    const confere = (e: PointerEvent) => { if (!e.metaKey && !e.ctrlKey && !caixaAtiva.current) setSelecionando(false) }
    window.addEventListener('keydown', desce); window.addEventListener('keyup', sobe)
    window.addEventListener('blur', sai); window.addEventListener('pointermove', confere)
    return () => {
      window.removeEventListener('keydown', desce); window.removeEventListener('keyup', sobe)
      window.removeEventListener('blur', sai); window.removeEventListener('pointermove', confere)
    }
  }, [])
  const capaSelecao = (e: React.PointerEvent<HTMLDivElement>) => {
    const alvo = e.currentTarget
    alvo.setPointerCapture(e.pointerId)
    caixaAtiva.current = true
    const somar = e.shiftKey
    const inicio = { x: e.clientX, y: e.clientY }
    setCaixaSel({ x: inicio.x, y: inicio.y, w: 0, h: 0 })
    const mover = (ev: PointerEvent) => setCaixaSel({ x: Math.min(inicio.x, ev.clientX), y: Math.min(inicio.y, ev.clientY), w: Math.abs(ev.clientX - inicio.x), h: Math.abs(ev.clientY - inicio.y) })
    const soltar = (ev: PointerEvent) => {
      alvo.removeEventListener('pointermove', mover); alvo.removeEventListener('pointerup', soltar)
      caixaAtiva.current = false
      setCaixaSel(null)
      if (Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y) < 4) {
        const id = document.elementsFromPoint(ev.clientX, ev.clientY).map((el) => el.closest('.react-flow__node')).find(Boolean)?.getAttribute('data-id')
        if (id) setNos((ns) => ns.map((n) => (n.id === id ? { ...n, selected: !n.selected } : n)))
        return
      }
      const a = rf.screenToFlowPosition({ x: Math.min(inicio.x, ev.clientX), y: Math.min(inicio.y, ev.clientY) })
      const b = rf.screenToFlowPosition({ x: Math.max(inicio.x, ev.clientX), y: Math.max(inicio.y, ev.clientY) })
      const dentro = new Set(rf.getIntersectingNodes({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }, true).map((n) => n.id))
      setNos((ns) => ns.map((n) => ({ ...n, selected: dentro.has(n.id) || (somar && !!n.selected) })))
    }
    alvo.addEventListener('pointermove', mover); alvo.addEventListener('pointerup', soltar)
  }
  // ⌘ + scroll dentro da camada de seleção: zoom em volta do cursor
  // na capa de seleção (⌘ apertado) vale o mesmo do canvas: pinça (chega com ctrlKey) e ⌘ + roda dão zoom, dois dedos movem
  const zoomNaCapa = (e: React.WheelEvent) => {
    const { x, y, zoom } = rf.getViewport()
    if (!e.ctrlKey && !e.metaKey) { rf.setViewport({ x: x - e.deltaX, y: y - e.deltaY, zoom }); return }
    // pinça manda deltas pequenos; a roda do mouse com ⌘, deltas grandes
    const z = Math.min(2.5, Math.max(0.05, zoom * Math.pow(2, -e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))))
    rf.setViewport({ x: e.clientX - ((e.clientX - x) * z) / zoom, y: e.clientY - ((e.clientY - y) * z) / zoom, zoom: z })
  }

  // o minimapa fica à esquerda do chat (o canvas passa por baixo dele). O chat aberto e a barrinha do chat fechado
  // são elementos diferentes: a medida acompanha a troca (MutationObserver) e o tamanho de quem estiver lá.
  const fundo = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const corpo = document.querySelector('.corpo')
    const ro = new ResizeObserver(() => medir())
    let visto: Element | null = null
    const medir = () => {
      const chat = document.querySelector('.corpo > .chat')
      if (chat !== visto) { if (visto) ro.unobserve(visto); if (chat) ro.observe(chat); visto = chat }
      const borda = fundo.current?.getBoundingClientRect().right ?? window.innerWidth
      const livre = chat ? borda - chat.getBoundingClientRect().left : 0
      fundo.current?.style.setProperty('--livre-dir', `${Math.max(0, livre)}px`)
    }
    medir()
    const mo = new MutationObserver(medir)
    if (corpo) mo.observe(corpo, { childList: true, attributes: true, attributeFilter: ['class', 'style'] })   // só o .corpo: nada de dentro do canvas
    window.addEventListener('resize', medir)
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', medir) }
  }, [])
  const meio = useRef<{ x: number; y: number } | null>(null)
  const ultimoMeio = useRef(0)

  const abrirMenu = (e: React.MouseEvent | MouseEvent, extra: Partial<MenuCtx> = {}) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), ...extra })
  }

  const formatos = est?.formatos ?? []
  const marcarWinner = useCallback((alvos: Alvo[], sim: boolean) => {
    tentarRef.current(async () => { await post('winner', { notas: alvos, sim }); await recarregarRef.current() }, sim ? 'Winner 🔥' : 'Tirou o 🔥')
  }, [])
  const levarAoChat = useCallback((id: string) => {
    const n = rf.getNode(id) as No | undefined
    if (!n || !onTrecho) return
    const a = alvoDeRef.current(n)
    onTrecho({ texto: '', linhaIni: 1, linhaFim: 999, raiz: a.raiz, nome: a.nome, caminho: `${PASTA[a.raiz as Raiz]}/${a.nome}.md` })
  }, [rf, onTrecho])

  return (
    <ProdutosUI.Provider value={est?.produtos ?? []}><ChatUI.Provider value={onTrecho ? levarAoChat : null}>
    <div className="canvas" ref={caixa}>
      <div className="canvas-fundo" ref={fundo}
        onDoubleClick={(e) => { if (!(e.target as Element).closest('.react-flow__node, .react-flow__controls, .react-flow__minimap')) enquadrarTudo() }}
        // fase de captura: o pan/zoom do React Flow trata o mousedown no canvas e não deixa ele subir até aqui
        onMouseDownCapture={(e) => { if (e.button === 1) meio.current = { x: e.clientX, y: e.clientY } }}
        onAuxClickCapture={(e) => {
          if (e.button !== 1 || !meio.current || Math.hypot(e.clientX - meio.current.x, e.clientY - meio.current.y) > 5) return
          // botão do meio: num card enquadra o card; dois cliques fora de tudo mostram o canvas todo
          const id = (e.target as Element).closest('.react-flow__node')?.getAttribute('data-id')
          if (id) { e.preventDefault(); enquadrarTudo(350, [id]); return }
          const agora = Date.now()
          if (agora - ultimoMeio.current < 450) { e.preventDefault(); enquadrarTudo(); ultimoMeio.current = 0 } else ultimoMeio.current = agora
        }}>
        <ReactFlow<No, Edge>
          nodes={nos} edges={arestasVis} onNodesChange={mudarNos} onEdgesChange={mudarArestas} nodeTypes={TIPOS_NO}
          onNodeDragStart={(_, __, ns) => comecouArraste(ns)} onSelectionDragStart={(_, ns) => comecouArraste(ns as No[])}
          onNodeDragStop={soltou} onSelectionDragStop={(_, ns) => { registrar(ns as No[]); guardarPos(ns as No[]) }} onConnect={conectou} connectionMode={ConnectionMode.Loose} onMove={(_, v) => fundo.current?.style.setProperty('--z', String(v.zoom))} onMoveEnd={lembrarVista} onInit={(i) => fundo.current?.style.setProperty('--z', String(i.getZoom()))} onBeforeDelete={antesDeApagar}
          onNodeClick={(e, n) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || (e.target as HTMLElement).closest('a, video')) return
            // chip de formato no card de produção: abre aquela saída direto
            const chip = (e.target as HTMLElement).closest<HTMLElement>('.cartao-formato[data-nome]')
            onAbrir(chip ? { raiz: chip.dataset.raiz as Alvo['raiz'], nome: chip.dataset.nome! } : alvoDe(n))
          }}
          onPaneContextMenu={(e) => abrirMenu(e)}
          onNodeContextMenu={(e, n) => { const sel = rf.getNodes().filter((x) => x.selected); abrirMenu(e, sel.length > 1 && sel.some((x) => x.id === n.id) ? { selecao: sel } : { no: n }) }}
          onSelectionContextMenu={(e, sel) => abrirMenu(e, { selecao: sel })}
          deleteKeyCode={['Backspace', 'Delete']} selectionKeyCode={null} multiSelectionKeyCode={['Meta', 'Control']}
          minZoom={0.05} maxZoom={2.5} panOnScroll panOnScrollMode={PanOnScrollMode.Free} panOnScrollSpeed={1} zoomOnPinch zoomOnDoubleClick={false}
          panOnDrag={[0, 1]} panActivationKeyCode={null} selectionOnDrag={false} selectionMode={SelectionMode.Partial} connectionRadius={36}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="rgba(23,24,27,.2)" />
          <MiniMap pannable zoomable position="bottom-right" className="canvas-mapa" nodeStrokeWidth={0}
            nodeColor={(n) => (n.type === 'ideia' ? '#d4e34a' : n.type === 'grupo' ? '#1d1d1f' : n.type === 'entrada' ? '#c9c3bf' : '#ffffff')} maskColor="rgba(236,233,230,.7)" />
        </ReactFlow>
        {(selecionando || caixaSel) && !menu && (
          <div className="capa-selecao" onPointerDown={capaSelecao} onWheel={zoomNaCapa}>
            {caixaSel && <div className="caixa-selecao" style={{ left: caixaSel.x, top: caixaSel.y, width: caixaSel.w, height: caixaSel.h }} />}
          </div>
        )}
      </div>


      {(() => {
        const pins = vistas.pinados.filter(existe), hist = vistas.historico.filter(existe)
        if (!pins.length && !hist.length) return null
        const item = (id: string, pinado: boolean) => (
          <div key={id} className={`trilho-item ${visao === `foco:${id}` ? 'is-on' : ''}`}>
            <button className="trilho-abrir" onClick={() => abrirVista(id)} title={nomeDoId(id)}>
              {(() => { const [ic, ...resto] = nomeDoId(id).split(' '); return <><span className="trilho-ic">{ic}</span><span className="trilho-nome">{resto.join(' ')}</span></> })()}
            </button>
            <button className="trilho-pin" onClick={() => pinar(id, !pinado)} title={pinado ? 'Despinar (volta ao histórico)' : 'Pinar'}><Icone n={pinado ? 'fechar' : 'pin'} t={11} /></button>
          </div>
        )
        return (
          <nav className="canvas-trilho" aria-label="Canvas pinados e últimos abertos">
            {pins.length > 0 && <><span className="trilho-secao" title="Pinados"><Icone n="pin" t={13} /></span>{pins.map((id) => item(id, true))}</>}
            {pins.length > 0 && hist.length > 0 && <span className="trilho-sep" />}
            {hist.length > 0 && <><span className="trilho-secao" title="Últimos abertos"><Icone n="atualizar" t={13} /></span>{hist.map((id) => item(id, false))}</>}
          </nav>
        )
      })()}

      <aside className="canvas-pastas" aria-label="Pastas">
        <Pasta nome="Em edição" n={contagem.edicao} ativa={visao === 'edicao'} cor="edicao" onClick={() => setTabela(tabelaNova('edicao'))} />
        <Pasta nome="Agendado" n={contagem.agendado} ativa={visao === 'agendado'} cor="agendado" onClick={() => setTabela(tabelaNova('agendado'))} />
        <Pasta nome="Publicado" n={contagem.publicado} ativa={visao.startsWith('pub-')} cor="publicado" onClick={() => setTabela(tabelaNova('publicado'))} />
        {/* a barra do canvas (nome, tipos, produtos, filtro, zoom) fica no rodapé, ao lado das pastas */}
        <div className="canvas-barra">
          {visao !== 'principal' && <button className="pilula glass glass--light" onClick={() => setVisao('principal')}><Icone n="seta" t={12} /> Canvas</button>}
          {visao === 'principal' && est?.canvas && onTrocarCanvas ? (
            // o nome do canvas é um seletor: troca de canvas sem voltar à página de controle
            <span className="canvas-trocar">
              <button type="button" className={`canvas-nome is-botao ${trocar ? 'is-aberto' : ''}`} onClick={() => { setTrocar((v) => !v); if (!trocar) listarCanvases().then(setTodosCanvas).catch(() => {}) }}
                title="Trocar de canvas">{est.canvas.icone} {est.canvas.nome}<span className="canvas-trocar-seta">▾</span><em>{nos.length} cards</em></button>
              {trocar && (
                <div className="canvas-trocar-lista glass glass--light" role="menu">
                  {todosCanvas.map((c) => (
                    <button key={c.slug} role="menuitem" className={c.slug === canvas ? 'is-on' : ''} onClick={() => { setTrocar(false); if (c.slug !== canvas) onTrocarCanvas(c.slug) }}>
                      <span className="canvas-trocar-icone">{c.icone}</span>{c.nome}<em>{c.producoes + c.vsls}</em></button>
                  ))}
                  <hr />
                  <button role="menuitem" onClick={() => { setTrocar(false); onTrocarCanvas(null) }}><span className="canvas-trocar-icone">▦</span>Todos os canvas</button>
                </div>
              )}
            </span>
          ) : <span className="canvas-nome">{visao === 'principal' && est?.canvas ? `${est.canvas.icone} ${est.canvas.nome}` : NOME_VISAO(visao)}<em>{nos.length} cards</em></span>}
          {visao.startsWith('foco:') && (() => { const id = visao.slice(5), sim = vistas.pinados.includes(id)
            return <button className={`btn-icone canvas-pin ${sim ? 'is-on' : ''}`} onClick={() => pinar(id, !sim)} title={sim ? 'Despinar (volta ao histórico)' : 'Pinar na barra da esquerda'}><Icone n="pin" t={14} /></button> })()}
          <div className="canvas-tipos" role="group" aria-label="Tipos de card">
            {TIPOS_VER.map((t) => <button key={t.k} className={`canvas-tipo ${tiposVer.includes(t.k) ? 'is-on' : ''}`} aria-pressed={tiposVer.includes(t.k)}
              title={tiposVer.includes(t.k) ? `Esconder ${t.nome.slice(3)}` : `Mostrar ${t.nome.slice(3)}`} onClick={() => alternarTipo(t.k)}>{t.nome}</button>)}
          </div>
          {(est?.produtos?.length ?? 0) > 0 && <div className="canvas-tipos canvas-produtos" role="group" aria-label="Produtos">
            {est!.produtos!.map((p) => { const on = !prodFora.includes(p.slug)
              return <button key={p.slug} className={`canvas-tipo ${on ? 'is-on' : ''}`} aria-pressed={on} title={on ? `Esconder ${p.nome}` : `Mostrar ${p.nome}`} onClick={() => alternarProduto(p.slug)}>
                <i className="canvas-produto-cor" style={{ background: p.cor }} />{p.nome}</button> })}
            <button className={`canvas-tipo ${!prodFora.includes(SEM) ? 'is-on' : ''}`} aria-pressed={!prodFora.includes(SEM)} title="Cards sem produto" onClick={() => alternarProduto(SEM)}>Sem</button>
          </div>}
          {visao === 'principal' && <>
            <select className="canvas-filtro" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} title="O que o canvas mostra">
              {FILTROS.map((f) => <option key={f.k} value={f.k}>{f.nome}{f.k !== 'todos' ? ` (${contagem[f.k]})` : ''}</option>)}
            </select>
            </>}
          {/* zoom, mostrar tudo e linhas: ficam na barra de cima (antes eram os controles flutuantes do canto) */}
          <span className="canvas-sep" />
          <div className="canvas-zoom" role="group" aria-label="Zoom e linhas">
            <button className="btn-icone" title="Aproximar (⌘+)" onClick={() => rf.zoomIn({ duration: 160 })}><Icone n="mais" t={14} /></button>
            <button className="btn-icone" title="Afastar (⌘−)" onClick={() => rf.zoomOut({ duration: 160 })}><svg className="i" width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" /></svg></button>
            <button className="btn-icone" title="Mostrar tudo (duplo clique no vazio)" onClick={() => enquadrarTudo()}><Icone n="expandir" t={13} /></button>
            <button className={`btn-icone ${linhas ? 'is-on' : 'is-desligado'}`} title={linhas ? 'Esconder as linhas (as do card selecionado continuam)' : 'Mostrar as linhas'}
              onClick={() => setLinhas((l) => !l)}><Icone n="grafo" t={13} /></button>
          </div>
        </div>
      </aside>
      {tabela && est && (
        <ModalTabela est={global!} t={tabela} onMudar={setTabela} onFechar={() => setTabela(null)}
          onAbrir={(a) => { const t = tabela; setTabela(null); onAbrir(a, { rotulo: STATUS.find((s) => s.k === t.pasta)?.nome ?? 'Tabela', fn: () => setTabela(t) }) }}
          onStatus={async (alvos, st) => {
            await tentarRef.current(() => post('status', { notas: alvos.map((a) => a.nome), status: st }), alvos.length === 1 ? 'Status mudou' : `${alvos.length} notas mudaram de status`)
            await recarregar()
          }}
          onRenomear={async (a, novo) => {
            const r = await fetch(`/api/notas/${a.raiz}/${encodeURIComponent(a.nome)}/acao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'renomear', novo }) })
            if (!r.ok) { const d = await r.json().catch(() => ({})); avisar(d.detail || 'Não deu para renomear.') } else { avisar('Renomeada'); await recarregar() }
          }}
          onApagar={async (alvos) => { for (const a of alvos) await lixeira(a); await recarregar(); avisar(alvos.length === 1 ? 'Na lixeira do vault' : `${alvos.length} notas na lixeira do vault`) }}
          onCanvas={(pasta, ano) => { setTabela(null); setVisao(pasta === 'publicado' ? `pub-${ano || contagem.anos[0]?.[0] || new Date().getFullYear()}` : pasta as Visao) }} />
      )}

      {menu && (
        <MenuCanvas m={menu} onFechar={() => setMenu(null)}>
          {menu.selecao ? (() => {
            const prods = menu.selecao!.filter((n): n is Node<DadosProd, 'producao'> => n.type === 'producao')
            return <>
              <p className="menu-ctx-t">{menu.selecao!.length} cards</p>
              <Op icone="pasta" desligado={prods.length < 1} onClick={() => perguntar({ titulo: 'Agrupar numa produção 🎬', dica: 'Nome da produção', inicial: prods[0]?.data.prod.nome.replace(/^[^\p{L}\p{N}]+/u, ''),
                ok: (t) => tentar(() => post('agrupar', { titulo: t, pos: prods[0].position, producoes: prods.map((x) => ({ raiz: x.data.prod.raiz, nome: x.data.prod.nome })) }), 'Produção criada') })}>
                Agrupar copies em produção{prods.length ? ` (${prods.length})` : ''}</Op>
              {subMover(menu.selecao!.filter(ehCard).map(notasDoCard))}
              {subProduto(menu.selecao!.filter(ehCard).map(notasDoCard))}
              <Op icone="olho" onClick={() => tentar(async () => { for (const n of menu.selecao!) await post('arquivar', { id: n.id }) }, 'Escondidos do canvas')}>Arquivar (esconder)</Op>
            </>
          })() : menu.no ? (() => {
            const n = menu.no!
            const alvo = alvoDe(n)
            return <>
              <Op icone="nota" onClick={() => onAbrir(alvo)}>Abrir</Op>
              {visao !== `foco:${n.id}` && <Op icone="grafo" onClick={() => abrirVista(n.id)}>Abrir em canvas próprio</Op>}
              <Op icone="pin" onClick={() => pinar(n.id, !vistas.pinados.includes(n.id))}>{vistas.pinados.includes(n.id) ? 'Despinar' : 'Pinar na barra'}</Op>
              {ehCard(n) && subMover([notasDoCard(n)])}
              {ehCard(n) && subProduto([notasDoCard(n)])}
              {(n.type === 'ideia' || n.type === 'grupo') && <>
                <hr /><p className="menu-ctx-t"><span className="orb orb--msg" />{n.type === 'grupo' ? 'Nova saída nesta produção' : 'Gerar saída'}</p>
                <div className="menu-formatos">{formatos.map((f) => <button key={f.emoji} title={f.nome} onClick={() => { setMenu(null); novaSaida(n.data.ideia.nome, f.emoji, f.nome) }}><span>{f.emoji}</span>{f.nome}</button>)}</div>
                {n.type === 'ideia' && <Op icone="link" onClick={() => perguntar({ titulo: `Adicionar a ${n.data.ideia.nome}`, dica: 'Link ou texto: entra no fim da nota da ideia', longo: true, ok: (t) => novaEntrada(t, n.position, n.data.ideia.nome) })}>Adicionar link ou texto</Op>}
              </>}
              {(n.type === 'grupo' || n.type === 'producao') && (() => {
                const notas = n.type === 'grupo' ? n.data.saidas : [n.data.prod]
                const on = notas.some((x) => x.winner)
                return <Op emoji="🔥" onClick={() => marcarWinner(notas.map((x) => ({ raiz: x.raiz, nome: x.nome })), !on)}>{on ? 'Tirar o 🔥 winner' : 'Marcar como winner 🔥'}</Op>
              })()}
              <hr />
              {onTrecho && <Op icone="chat" onClick={() => onTrecho({ texto: '', linhaIni: 1, linhaFim: 999, raiz: alvo.raiz, nome: alvo.nome, caminho: `${PASTA[alvo.raiz as Raiz]}/${alvo.nome}.md` })}>Perguntar ao Jarvis</Op>}
              {n.type !== 'grupo' && <Op icone="editar" onClick={() => perguntar({ titulo: 'Renomear', inicial: alvo.nome, ok: (t) => tentar(async () => {
                const r = await fetch(`/api/notas/${alvo.raiz}/${encodeURIComponent(alvo.nome)}/acao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'renomear', novo: t }) })
                if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Não consegui renomear.')
              }) })}>Renomear</Op>}
              {n.type === 'grupo' && <Op icone="pasta" onClick={() => tentar(async () => {
                for (const s of n.data.saidas) await post('ligar', { producao: { raiz: s.raiz, nome: s.nome }, ideia: null })
              }, `${n.data.saidas.length} saídas soltas no canvas`)}>Desagrupar</Op>}
              {n.type === 'producao' && n.data.prod.ideia && <Op icone="pasta" onClick={() => tentar(() => post('ligar', { producao: { raiz: n.data.prod.raiz, nome: n.data.prod.nome }, ideia: null }), 'Saiu do grupo')}>Tirar do grupo</Op>}
              <Op icone="olho" onClick={() => tentar(() => post('arquivar', { id: n.id }), 'Escondido do canvas (a nota continua no vault)')}>Arquivar (esconder)</Op>
              <Op icone="lixeira" perigo onClick={() => deletar(n)}>{n.type === 'grupo' ? `Deletar produção (${n.data.saidas.length})` : 'Deletar'}</Op>
            </>
          })() : <>
            <Op emoji="💡" onClick={() => pedirIdeia(livre(menu.flow))}>Nova ideia</Op>
            <Op emoji="📄" onClick={() => perguntar({ titulo: 'Nova copy solta (em Priorizar)', inicial: '📱 ', ok: (t) => tentar(async () => {
              const r = await fetch('/api/notas/priorizar', { method: 'POST', headers: { 'Content-Type': 'application/json', ...cabecalhoCanvas() }, body: JSON.stringify({ titulo: t }) })
              if (!r.ok) throw new Error(r.status === 409 ? 'Já existe uma nota com esse nome.' : 'Não consegui criar.')
              const d = await r.json()
              await post('posicoes', { [`p:priorizar/${d.nome}`]: menu.flow }, 'PUT')
            }, 'Copy criada') })}>Nova copy solta</Op>
            <hr />
            <Op icone="seta" onClick={() => navigator.clipboard.readText().then((t) => { if (t.trim()) novaEntrada(t.trim(), menu.flow) }).catch(() => avisar('Sem permissão para ler a área de transferência: use ⌘V.'))}>Colar como ideia <kbd>⌘V</kbd></Op>
            <Op icone="atualizar" onClick={() => enquadrarTudo()}>Ver tudo <kbd>2× clique</kbd></Op>
          </>}
        </MenuCanvas>
      )}

      {pergunta && <Perguntar p={pergunta} onFechar={() => setPergunta(null)} />}
      {aviso && createPortal(<div className="ideias-aviso" role="status">{aviso}</div>, document.body)}
    </div>
    </ChatUI.Provider></ProdutosUI.Provider>
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

function Op({ icone, emoji, children, onClick, desligado, perigo }: { icone?: string; emoji?: string; children: ReactNode; onClick: () => void; desligado?: boolean; perigo?: boolean }) {
  return <button role="menuitem" data-fecha onClick={onClick} disabled={desligado} className={perigo ? 'is-perigo' : undefined}>{emoji ? <span className="menu-emoji">{emoji}</span> : <Icone n={icone ?? 'nota'} t={15} />}{children}</button>
}

function MenuCanvas({ m, onFechar, children }: { m: MenuCtx; onFechar: () => void; children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: m.x, y: m.y })
  useEffect(() => {
    const r = caixa.current?.getBoundingClientRect()
    if (r) setPos({ x: Math.min(m.x, window.innerWidth - r.width - 8), y: Math.min(m.y, window.innerHeight - r.height - 8) })
    const fora = (e: PointerEvent) => { if (e.button !== 2 && !caixa.current?.contains(e.target as HTMLElement)) onFechar() }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    // captura: o React Flow para a propagação do clique no fundo, então escutar na subida não pegava
    const roda = (e: WheelEvent) => { if (!caixa.current?.contains(e.target as HTMLElement)) onFechar() }
    window.addEventListener('pointerdown', fora, true); window.addEventListener('wheel', roda, true); window.addEventListener('keydown', esc); window.addEventListener('blur', onFechar)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('wheel', roda, true); window.removeEventListener('keydown', esc); window.removeEventListener('blur', onFechar) }
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
      <form className="paleta glass glass--light perguntar" onSubmit={(e) => { e.preventDefault(); if (p.confirmar) { onFechar(); p.ok('sim') } else ok() }}>
        <p className="perguntar-t">{p.titulo}</p>
        {p.confirmar ? <>
          {p.dica && <p className="perguntar-dica">{p.dica}</p>}
          <div className="perguntar-botoes">
            <button type="button" className="pilula" onClick={onFechar}>Cancelar</button>
            <button type="submit" className="pilula is-perigo" autoFocus onKeyDown={(e) => e.key === 'Escape' && onFechar()}>{p.confirmar}</button>
          </div>
        </> : p.longo
          ? <textarea autoFocus rows={4} value={v} onChange={(e) => setV(e.target.value)} placeholder={p.dica}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || !e.shiftKey)) { e.preventDefault(); ok() } if (e.key === 'Escape') onFechar() }} />
          : <input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={p.dica} onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
              onKeyDown={(e) => e.key === 'Escape' && onFechar()} />}
        {!p.confirmar && <footer className="paleta-pe"><span><kbd>↵</kbd> confirmar</span><span><kbd>esc</kbd> cancelar</span></footer>}
      </form>
    </div>, document.body)
}
