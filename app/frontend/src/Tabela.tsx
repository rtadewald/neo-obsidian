import { Fragment, useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icone } from './Icone'
import { alternarPin, idDoCard, pinavel, usePins } from './pins'
import { chaveProd, ORDEM_FORMATO, STATUS, type Alvo, type EstadoCanvas, type Producao, type StatusProd, porFormato as ordemFormato } from './canvasApi'

/** Modal de tabela das pastas (Priorizar, Em edição, Agendado, Publicado): as copies em linhas, com números,
 *  filtros e ordenação. Clicar numa linha abre a copy no modal de nota, que tem "voltar" para cá. */

export type Coluna = 'formato' | 'nome' | 'data' | 'tags' | 'grupo' | 'palavras' | 'mtime'
/** 'winner': as copies com 🔥 (de qualquer status), com todas as datas em que foram postadas. */
export type Pasta = StatusProd | 'winner' | 'ideias' | 'pinados'   // ideias: as 💡 do canvas aberto; pinados: os cards pinados de todos os canvas
export type EstadoTabela = {
  pasta: Pasta; busca: string; formatos: string[]; ano: string; mes: string; grupo: string
  ordem: { col: Coluna; asc: boolean }
}
export const tabelaNova = (pasta: Pasta): EstadoTabela => ({
  pasta, busca: '', formatos: [], ano: '', mes: '', grupo: '',
  ordem: { col: pasta === 'edicao' ? 'mtime' : 'data', asc: pasta === 'agendado' },   // winners: mais recentes primeiro
})

/** A tabela guarda o estado de quando saiu (por pasta): filtros, busca, ordem, grupos abertos e a rolagem. */
const CHAVE = 'tabela-estado'
type Guardado = { t: EstadoTabela; cats: string[]; ideias: string[]; rolagem: number }
const guardadas: Record<string, Guardado> = (() => { try { return JSON.parse(localStorage.getItem(CHAVE) || '{}') } catch { return {} } })()
const guardar = (pasta: string, g: Partial<Guardado>) => {
  guardadas[pasta] = { ...(guardadas[pasta] ?? { t: tabelaNova(pasta as Pasta), cats: [], ideias: [], rolagem: 0 }), ...g }
  try { localStorage.setItem(CHAVE, JSON.stringify(guardadas)) } catch { /* sem storage */ }
}
/** Abre a pasta como ela estava quando o Rodrigo saiu (ou nova, na primeira vez). */
export const tabelaSalva = (pasta: Pasta): EstadoTabela => guardadas[pasta]?.t ?? tabelaNova(pasta)

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const dia = (p: Producao) => (p.scheduled ?? '').slice(0, 10) || new Date((p.criado ?? p.mtime) * 1000).toISOString().slice(0, 10)
const dataBr = (d: string) => `${d.slice(8, 10)} ${MESES[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`
const relativo = (t: number) => {
  const d = Math.floor((Date.now() / 1000 - t) / 86400)
  return d < 1 ? 'hoje' : d === 1 ? 'ontem' : d < 30 ? `há ${d} dias` : d < 365 ? `há ${Math.floor(d / 30)} m` : `há ${Math.floor(d / 365)} a`
}
const INBOX_NOME = '📥 Inbox'
const semEmoji = (n: string) => n.replace(/^[^\p{L}\p{N}]+/u, '')
const ROTULO_COL: Record<Coluna, string> = { formato: '', nome: 'Copy', data: 'Data', tags: 'Tags', grupo: 'Canvas', palavras: 'Palavras', mtime: 'Editada' }

export function ModalTabela({ est, t, onMudar, onFechar, onAbrir, onCanvas, onApagar, onStatus, onRenomear, onTags, canvasNome, pinados = [], icones = {}, embutido, aberta, extra, onData }: {
  embutido?: boolean   // na página Redação: sem véu, sem fechar, ocupa o lugar dela
  aberta?: Alvo | null   // a nota aberta ao lado (linha destacada)
  extra?: React.ReactNode   // botões a mais no topo (o calendário da Redação)
  onData?: (alvo: Alvo, data: string) => Promise<void>   // Redação: a data da copy editada na célula
  icones?: Record<string, string>   // nome do canvas → emoji dele (o indicativo do canvas nas linhas)
  canvasNome?: string   // o canvas aberto: a aba Ideias mostra só as dele
  pinados?: string[]    // ids dos cards pinados (i:/g:/e:/p:), de todos os canvas
  est: EstadoCanvas; t: EstadoTabela; onMudar: (t: EstadoTabela) => void; onFechar: () => void
  onAbrir: (a: Alvo, opts?: { nova?: boolean }) => void; onCanvas: (pasta: StatusProd, ano: string) => void
  onApagar?: (alvos: Alvo[]) => Promise<void>   // seleção múltipla → lixeira do vault
  onStatus?: (alvos: Alvo[], status: StatusProd) => Promise<void>
  onRenomear?: (alvo: Alvo, novo: string) => Promise<void>
  onTags?: (alvo: Alvo, tags: string[]) => Promise<void>   // coluna Tags: clicar edita ali mesmo
}) {
  // as tags do vault, das mais usadas para as menos (é a ordem das sugestões ao clicar na célula)
  const todasTags = useMemo(() => {
    const c = new Map<string, number>()
    for (const t of [...est.producoes, ...est.ideias].flatMap((p) => p.tags ?? []).filter((t) => t.trim())) c.set(t, (c.get(t) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
  }, [est])
  // botão direito numa linha: abrir, renomear, mudar status, deletar
  const [menu, setMenu] = useState<{ x: number; y: number; p: Alvo; renomear?: string; apagar?: boolean } | null>(null)
  const pins = usePins()
  // o menu cabe na tela: se passar da borda de baixo (ou da direita), sobe (ou vai para a esquerda)
  const refMenu = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = refMenu.current
    if (!el || !menu) return
    const r = el.getBoundingClientRect()
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)), x = Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8))
    if (y !== menu.y || x !== menu.x) setMenu({ ...menu, x, y })
  })
  useEffect(() => {
    if (!menu) return
    const fora = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.tabela-menu')) setMenu(null) }
    window.addEventListener('mousedown', fora)
    return () => window.removeEventListener('mousedown', fora)
  }, [menu])
  const mudar = (m: Partial<EstadoTabela>) => onMudar({ ...t, ...m })
  // seleção múltipla para apagar de uma vez (some ao trocar de aba)
  const [sel, setSel] = useState<Set<string>>(() => new Set())
  const [confirmar, setConfirmar] = useState(false)
  const [apagando, setApagando] = useState(false)
  useEffect(() => { setSel(new Set()); setConfirmar(false) }, [t.pasta])
  const chaveDe = (p: { raiz: string; nome: string }) => `${p.raiz}/${p.nome}`
  const alternar = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  useEffect(() => {
    if (embutido) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onFechar() } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar, embutido])

  // as 💡 ideias do canvas aberto viram linhas como as das copies (formato 💡, "produção" = quantas versões têm)
  const linhaIdeia = useCallback((i: EstadoCanvas['ideias'][number]): Producao => {
    const n = est.producoes.filter((p) => p.ideia === i.nome).length
    return { nome: i.nome, raiz: 'ideias' as Producao['raiz'], status: 'ideia', scheduled: null, ano: '', formato: '💡', ideia: n ? `${n} ${n === 1 ? 'versão' : 'versões'}` : null,
      previa: i.previa, mtime: i.mtime, criado: i.mtime, canvas: i.canvas, categoria: i.categoria || 'Sem categoria', canvases: i.canvases, tags: i.tags, links: i.links ?? [], imagem: i.imagem ?? null, copia: i.copia ?? null } as Producao & { categoria: string }
  }, [est])
  // Criação: as copies do canvas aberto (cada uma numa categoria; as versões da mesma `ideia:` juntas num card 🎬)
  const ideiasDoCanvas = useMemo(() => est.producoes
    .filter((p) => { const cs = p.canvases ?? (p.canvas ? [p.canvas] : []); return embutido ? cs.length > 0 : !canvasNome || cs.includes(canvasNome) }), [est, canvasNome, embutido])   // na Redação: as de todos os canvas
  // os pinados viram linhas: a 💡 ideia, cada copy de uma produção 🎬 e as copies soltas (entradas ficam de fora)
  const linhasPinadas = useMemo(() => {
    const vistos = new Set<string>(), out: Producao[] = []
    const add = (p: Producao) => { const k = `${p.raiz}/${p.nome}`; if (!vistos.has(k)) { vistos.add(k); out.push(p) } }
    for (const id of pinados) {
      const r = id.slice(2)
      if (id.startsWith('i:')) est.ideias.filter((i) => i.nome === r).map(linhaIdeia).forEach(add)
      else if (id.startsWith('g:')) est.producoes.filter((p) => chaveProd(p) === r).forEach(add)
      else if (id.startsWith('p:')) est.producoes.filter((p) => `${p.raiz}/${p.nome}` === r).forEach(add)
    }
    return out
  }, [est, pinados, linhaIdeia])
  const daPasta = useMemo(() => (t.pasta === 'ideias' ? ideiasDoCanvas : t.pasta === 'pinados' ? linhasPinadas
    : est.producoes.filter((p) => (t.pasta === 'winner' ? !!p.winner : p.status === t.pasta))), [est, t.pasta, ideiasDoCanvas, linhasPinadas])
  const anos = useMemo(() => [...new Set(daPasta.map((p) => dia(p).slice(0, 4)))].sort().reverse(), [daPasta])
  const grupos = useMemo(() => [...new Set(daPasta.map((p) => p.canvas || INBOX_NOME))].sort(), [daPasta])
  // filtros que valem antes dos chips de formato e das barras de mês (para os números deles não sumirem ao clicar)
  const base = useMemo(() => {
    const q = t.busca.trim().toLowerCase()
    return daPasta.filter((p) => (!t.ano || dia(p).startsWith(t.ano)) && (!t.grupo || (p.canvas || INBOX_NOME) === t.grupo)
      && (!q || p.nome.toLowerCase().includes(q) || (p.ideia ?? '').toLowerCase().includes(q) || p.previa.toLowerCase().includes(q)))
  }, [daPasta, t.busca, t.ano, t.grupo])
  const linhas = useMemo(() => {
    const l = base.filter((p) => (!t.formatos.length || t.formatos.includes(p.formato)) && (!t.mes || dia(p).startsWith(t.mes)))
    const { col, asc } = t.ordem
    // winners: pela última data em que foi postada; sem data vai para o fim
    const v = (p: Producao): string | number => col === 'data' ? (t.pasta === 'winner' ? (p.datas?.[p.datas.length - 1] ?? p.scheduled?.slice(0, 10) ?? '') : dia(p)) : col === 'palavras' ? p.palavras ?? 0 : col === 'mtime' ? p.mtime
      : col === 'formato' ? ORDEM_FORMATO.indexOf(p.formato) : col === 'nome' ? semEmoji(p.nome).toLowerCase() : (col === 'tags' ? (p.tags ?? []).join(' ') || null : p.canvas || INBOX_NOME)?.toLowerCase() ?? '~'
    return l.sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1) })
  }, [base, t.formatos, t.mes, t.ordem, t.pasta])

  // aba Criação: categoria › ideia › copy, em grupos que abrem e fecham (tudo começa fechado)
  const [catAbertas, setCatAbertas] = useState<Set<string>>(() => new Set(guardadas[t.pasta]?.cats ?? []))
  const [ideiasAbertas, setIdeiasAbertas] = useState<Set<string>>(() => new Set(guardadas[t.pasta]?.ideias ?? []))
  useEffect(() => { guardar(t.pasta, { t }) }, [t])
  const pastaAntes = useRef(t.pasta)
  useEffect(() => { if (pastaAntes.current === t.pasta) guardar(t.pasta, { cats: [...catAbertas], ideias: [...ideiasAbertas] }) }, [catAbertas, ideiasAbertas, t.pasta])
  // a rolagem: volta para onde estava (ao abrir e ao trocar de aba) e guarda enquanto rola
  const rolo = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { const r = rolo.current; if (r) r.scrollTop = guardadas[t.pasta]?.rolagem ?? 0 }, [t.pasta])
  // trocar de aba dentro da tabela: os grupos abertos são os daquela pasta
  useEffect(() => {
    if (pastaAntes.current === t.pasta) return
    pastaAntes.current = t.pasta
    setCatAbertas(new Set(guardadas[t.pasta]?.cats ?? [])); setIdeiasAbertas(new Set(guardadas[t.pasta]?.ideias ?? []))
  }, [t.pasta])
  const trocar = (set: (f: (s: Set<string>) => Set<string>) => void, k: string) => set((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  // a categoria de uma copy: a dela, ou a de uma irmã da mesma `ideia:`
  const catDe = useCallback((p: Producao) => p.categoria || est.producoes.find((x) => p.ideia && x.ideia === p.ideia && x.categoria)?.categoria || 'Sem categoria', [est])
  type Item = { chave: string; nome: string; copias: Producao[] }   // card 🎬 (2+ versões) ou copy solta (1)
  const categorias = useMemo(() => {
    if (t.pasta !== 'ideias') return [] as [string, Item[]][]
    const m = new Map<string, Map<string, Producao[]>>()
    for (const p of linhas) {
      const c = catDe(p), k = p.ideia ? `g:${p.ideia}` : `p:${p.raiz}/${p.nome}`
      const g = m.get(c) ?? new Map<string, Producao[]>(); g.set(k, [...(g.get(k) ?? []), p]); m.set(c, g)
    }
    const itens = (g: Map<string, Producao[]>): Item[] => [...g.entries()].flatMap(([k, ps]) => ps.length > 1
      ? [{ chave: k, nome: k.slice(2).replace(/^💡\s*/, ''), copias: ps.sort((a, b) => ORDEM_FORMATO.indexOf(a.formato) - ORDEM_FORMATO.indexOf(b.formato) || b.mtime - a.mtime) }]
      : ps.map((p) => ({ chave: `p:${p.raiz}/${p.nome}`, nome: p.nome, copias: [p] })))
    return [...m.entries()].map(([c, g]) => [c, itens(g)] as [string, Item[]])
      .sort((a, b) => (a[0] === 'Sem categoria' ? 1 : b[0] === 'Sem categoria' ? -1 : b[1].length - a[1].length || a[0].localeCompare(b[0])))
  }, [linhas, t.pasta, catDe])
  const chipCanvas = (nome?: string | null) => nome
    ? <span className="tabela-caixa" title={`No canvas ${nome}`}>{icones[nome] ? <span className="tabela-caixa-ic">{icones[nome]}</span> : null}{nome}</span>
    : <span className="mudo">{INBOX_NOME}</span>

  const porFormato = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of base.filter((p) => !t.mes || dia(p).startsWith(t.mes))) c[p.formato || '📄'] = (c[p.formato || '📄'] ?? 0) + 1
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [base, t.mes])
  const ordenar = (col: Coluna) => mudar({ ordem: { col, asc: t.ordem.col === col ? !t.ordem.asc : col === 'nome' || col === 'tags' || col === 'grupo' } })
  const alternarFormato = (f: string) => mudar({ formatos: t.formatos.includes(f) ? t.formatos.filter((x) => x !== f) : [...t.formatos, f] })
  const filtrando = t.busca || t.formatos.length || t.ano || t.mes || t.grupo
  const contagem = (k: StatusProd) => est.producoes.filter((p) => p.status === k).length
  const alvo = document.querySelector('section.pagina')
  type Galho = { nivel: number; n?: number; aberta?: boolean; alternar?: () => void }
  /** A linha do card 🎬: as versões da mesma `ideia:` (clicar abre e fecha; as versões vêm embaixo). */
  // card 🎬: clicar abre a primeira versão (pela ordem dos formatos); as outras ficam nas abas do modal
  const linhaProducao = (i: { chave: string; nome: string; copias: Producao[] }) => { const p1 = [...i.copias].sort(ordemFormato)[0]; return (
    <tr key={i.chave} className="tabela-grupo tabela-nivel-1 is-prod" onClick={(e) => onAbrir({ raiz: p1.raiz, nome: p1.nome }, { nova: e.metaKey || e.ctrlKey })} title={`Abrir ${p1.nome} (as outras versões ficam nas abas)`}>
      {onApagar && <td className="col-sel" />}
      <td className="col-formato" />
      <td className="col-nome"><div className="tabela-galho">
        <i className={`ponto is-${p1.status}`} title={STATUS.find((x) => x.k === p1.status)?.nome} />
        <div><b><span className="tabela-ic">🎬</span>{semEmoji(i.nome)}<em className="tabela-n">{i.copias.length}</em></b></div></div></td>
      <td className="col-versoes">{[...i.copias].sort(ordemFormato).map((c) => <span key={c.nome} title={c.nome}><i className={`ponto is-${c.status}`} />{c.formato || '📄'}</span>)}</td>
      {embutido && <td className="col-status"><Status p={p1} /></td>}
      <td className="col-data"><span className="mudo">{dataBr(dia(i.copias[0]))}</span></td>
      <td className="col-tags" />
      <td className="col-grupo">{chipCanvas(i.copias[0].canvas)}</td>
      <td className="col-palavras">{i.copias.reduce((n, c) => n + (c.palavras ?? 0), 0) || <span className="mudo">0</span>}</td>
      <td className="col-mtime">{relativo(Math.max(...i.copias.map((c) => c.mtime)))}</td>
    </tr>
  ) }
  const linha = (p: Producao, g?: Galho) => (
                <tr key={`${p.raiz}/${p.nome}`} onClick={(e) => onAbrir({ raiz: p.raiz, nome: p.nome }, { nova: e.metaKey || e.ctrlKey })} tabIndex={0} className={`${sel.has(chaveDe(p)) ? 'is-sel' : ''} ${g?.nivel ? `tabela-nivel-${g.nivel}` : ''} ${aberta && aberta.raiz === p.raiz && aberta.nome === p.nome ? 'is-aberta' : ''}`}
                  draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', `${p.raiz}\u0000${p.nome}`); e.dataTransfer.effectAllowed = 'move' }}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 280), p: { raiz: p.raiz, nome: p.nome } }) }}
                  onKeyDown={(e) => e.key === 'Enter' && onAbrir({ raiz: p.raiz, nome: p.nome })}>
                  {onApagar && <td className="col-sel" onClick={(e) => { e.stopPropagation(); alternar(chaveDe(p)) }}>
                    <input type="checkbox" aria-label={`Marcar ${p.nome}`} checked={sel.has(chaveDe(p))} onChange={() => {}} /></td>}
                  <td className="col-formato">{!g?.nivel && (p.formato || '📄')}</td>
                  <td className="col-nome">{g?.nivel ? <div className="tabela-galho">
                    {g.nivel === 1 && g.n ? (g.n ? <button className={`tabela-seta-grupo ${g.aberta ? 'is-aberta' : ''}`} aria-label={g.aberta ? 'Fechar as copies' : `Mostrar ${g.n} copies`} onClick={(e) => { e.stopPropagation(); g.alternar?.() }}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button> : <span className="tabela-seta-grupo is-vazia" />)
                      : <i className={`ponto is-${p.status}`} title={STATUS.find((x) => x.k === p.status)?.nome} />}
                    <div><b><span className="tabela-ic">{p.formato || '📄'}</span>{semEmoji(p.nome)}{g.nivel === 1 && g.n ? <em className="tabela-n">{g.n}</em> : null}</b>{p.previa && <span>{p.previa}</span>}</div></div>
                    : <><b>{semEmoji(p.nome)}</b>{p.previa && <span>{p.previa}</span>}</>}</td>
                  {t.pasta === 'ideias' && <td className="col-versoes" />}
                  {embutido && <td className="col-status" onClick={(e) => e.stopPropagation()}>
                    {onStatus ? <select className={`tabela-status-sel is-${p.status}`} value={p.status} onChange={(e) => onStatus([{ raiz: p.raiz, nome: p.nome }], e.target.value as StatusProd)}>
                      {STATUS.map((x) => <option key={x.k} value={x.k}>{x.nome}</option>)}</select> : <Status p={p} />}</td>}
                  {embutido && onData ? <td className="col-data" onClick={(e) => e.stopPropagation()}>
                    <input type="date" className="tabela-data-in" value={(p.scheduled ?? '').slice(0, 10)} title="Mudar a data (scheduled)"
                      onChange={(e) => { if (/^2\d{3}-/.test(e.target.value)) onData({ raiz: p.raiz, nome: p.nome }, e.target.value) }} /></td>
                  : <td className="col-data">{(p.datas?.length ?? 0) > 1 ? <span title={`Postada ${p.datas!.length} vezes`}>{p.datas!.map(dataBr).join(' · ')}</span>
                    : p.scheduled ? dataBr(p.scheduled.slice(0, 10)) : t.pasta === 'winner' ? <span className="mudo" title="Sem data de postagem (scheduled vazio)">sem data</span> : <span className="mudo">{dataBr(dia(p))}</span>}</td>}
                  <td className="col-tags" onClick={onTags ? (e) => e.stopPropagation() : undefined}>
                    <CelulaTags tags={p.tags ?? []} sugestoes={todasTags} onMudar={onTags && ((l) => onTags({ raiz: p.raiz, nome: p.nome }, l))} /></td>
                  <td className="col-grupo">{chipCanvas(p.canvas)}</td>
                  <td className="col-palavras">{p.palavras || <span className="mudo">0</span>}</td>
                  <td className="col-mtime">{relativo(p.mtime)}</td>
                </tr>
  )

  const corpo = (
    <div className={embutido ? 'tabela-embutida-fundo' : 'modal-fundo'} onMouseDown={(e) => !embutido && e.target === e.currentTarget && onFechar()}>
      <div className={`modal-nota modal-tabela glass glass--light ${embutido ? 'tabela-embutida' : ''}`} role={embutido ? undefined : 'dialog'} aria-label="Tabela de copies">
        <header className="modal-tabs">
          <nav role="tablist">
            {canvasNome && <button role="tab" aria-selected={t.pasta === 'ideias'} className={`modal-tab ${t.pasta === 'ideias' ? 'is-ativa' : ''}`} onClick={() => onMudar(tabelaSalva('ideias'))}
              title={`Criação: as copies de ${canvasNome} por categoria`}>
              <span className="tabela-fogo">💡</span><span>Criação</span><em className="tabela-n">{ideiasDoCanvas.length}</em>
            </button>}
            {canvasNome && <span className="modal-tab-sep" aria-hidden="true" />}
            {STATUS.map((s) => (
              <button key={s.k} role="tab" aria-selected={s.k === t.pasta} className={`modal-tab ${s.k === t.pasta ? 'is-ativa' : ''}`} onClick={() => onMudar(tabelaSalva(s.k))}>
                <i className={`ponto is-${s.k}`} /><span>{s.nome}</span><em className="tabela-n">{contagem(s.k)}</em>
              </button>
            ))}
            <button role="tab" aria-selected={t.pasta === 'winner'} className={`modal-tab ${t.pasta === 'winner' ? 'is-ativa' : ''}`} onClick={() => onMudar(tabelaSalva('winner'))}>
              <span className="tabela-fogo">🔥</span><span>Winners</span><em className="tabela-n">{est.producoes.filter((p) => p.winner).length}</em>
            </button>
            <button role="tab" aria-selected={t.pasta === 'pinados'} className={`modal-tab ${t.pasta === 'pinados' ? 'is-ativa' : ''}`} onClick={() => onMudar(tabelaSalva('pinados'))} title="Os cards pinados, de todos os canvas">
              <span className="tabela-fogo">📌</span><span>Pinados</span><em className="tabela-n">{linhasPinadas.length}</em>
            </button>
          </nav>
          {extra}
          {!embutido && t.pasta !== 'ideia' && t.pasta !== 'winner' && t.pasta !== 'ideias' && t.pasta !== 'pinados' && <button className="tabela-canvas" onClick={() => onCanvas(t.pasta as StatusProd, t.ano)} title="Abrir estas copies no canvas"><Icone n="grafo" t={13} /> Ver no canvas</button>}
          {!embutido && <button className="btn-icone" onClick={onFechar} aria-label="Fechar" title="Fechar (esc)"><Icone n="fechar" t={16} /></button>}
        </header>

        <section className="tabela-filtros">
          <label className="tabela-busca"><Icone n="busca" t={13} /><input value={t.busca} onChange={(e) => mudar({ busca: e.target.value })} placeholder="Buscar copy, produção ou texto" autoFocus /></label>
          <FiltroFormatos lista={porFormato} on={t.formatos} nomes={Object.fromEntries((est.formatos ?? []).map((f) => [f.emoji, f.nome]))}
            onAlternar={alternarFormato} onLimpar={() => mudar({ formatos: [] })} />
          {anos.length > 1 && (
            <select className="tabela-select" value={t.ano} onChange={(e) => mudar({ ano: e.target.value, mes: '' })}>
              <option value="">Todos os anos</option>{anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {grupos.length > 0 && (
            <select className="tabela-select" value={t.grupo} onChange={(e) => mudar({ grupo: e.target.value })}>
              <option value="">Todos os canvas</option>{grupos.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          {t.pasta === 'ideias' && categorias.length > 0 && (() => {
            // tudo aberto = nenhuma categoria fechada e toda ideia com copies aberta; o botão alterna entre os dois
            const tudoAberto = categorias.every(([c]) => catAbertas.has(c))
            return <button className="tabela-select tabela-tudo" onClick={() => {
              if (tudoAberto) { setCatAbertas(new Set()); setIdeiasAbertas(new Set()) }
              else setCatAbertas(new Set(categorias.map(([c]) => c)))
            }} title={tudoAberto ? 'Fechar todas as categorias' : 'Abrir todas as categorias'}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {tudoAberto ? <path d="M3 2.5l3 3 3-3M3 9.5l3-3 3 3" /> : <path d="M3 5l3-3 3 3M3 7l3 3 3-3" />}</svg>
              {tudoAberto ? 'Recolher tudo' : 'Expandir tudo'}</button>
          })()}
          {filtrando ? <button className="tabela-limpar" onClick={() => mudar({ busca: '', formatos: [], ano: '', mes: '', grupo: '' })}>Limpar filtros</button> : null}
        </section>

        <div className="tabela-rolo" ref={rolo} onScroll={(e) => guardar(t.pasta, { rolagem: e.currentTarget.scrollTop })}>
          <table className="tabela">
            <thead>
              <tr>{onApagar && <th className="col-sel" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label="Marcar todas as linhas" checked={linhas.length > 0 && linhas.every((p) => sel.has(chaveDe(p)))}
                  onChange={(e) => setSel(e.target.checked ? new Set(linhas.map(chaveDe)) : new Set())} /></th>}
                {(Object.keys(ROTULO_COL) as Coluna[]).map((c) => (
                <Fragment key={c}><th className={`col-${c}`} onClick={() => ordenar(c)} aria-sort={t.ordem.col === c ? (t.ordem.asc ? 'ascending' : 'descending') : 'none'}>
                  {ROTULO_COL[c]}{t.ordem.col === c && <span className="tabela-seta">{t.ordem.asc ? '↑' : '↓'}</span>}
                </th>{c === 'nome' && t.pasta === 'ideias' && <th className="col-versoes">Versões</th>}{c === 'nome' && embutido && <th className="col-status">Status</th>}</Fragment>
              ))}</tr>
            </thead>
            <tbody>
              {t.pasta !== 'ideias' ? linhas.map((p) => linha(p)) : categorias.map(([cat, ideias]) => {
                const aberta = catAbertas.has(cat) || !!t.busca.trim()
                const todas = ideias.flatMap((i) => i.copias)
                const canvases = [...new Set(todas.map((i) => i.canvas).filter(Boolean))] as string[]
                return [
                  <tr key={`cat:${cat}`} className="tabela-grupo is-cat" onClick={() => trocar(setCatAbertas, cat)}>
                    {onApagar && <td className="col-sel" />}
                    <td className="col-formato"><span className={`tabela-seta-grupo ${aberta ? 'is-aberta' : ''}`}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span></td>
                    <td className="col-nome"><b>{cat}</b><span>{todas.length} {todas.length === 1 ? 'copy' : 'copies'}{todas.length !== ideias.length ? ` · ${ideias.filter((i) => i.copias.length > 1).length} produções 🎬` : ''}</span></td>
                    {t.pasta === 'ideias' && <td className="col-versoes" />}{embutido && <td className="col-status" />}<td className="col-data" /><td className="col-tags" />
                    <td className="col-grupo"><div className="tabela-caixas">{canvases.map((c) => <span key={c}>{chipCanvas(c)}</span>)}</div></td>
                    <td className="col-palavras" /><td className="col-mtime" />
                  </tr>,
                  ...(aberta ? ideias.flatMap((i) => {
                    if (i.copias.length === 1) return [linha(i.copias[0], { nivel: 1 })]
                    return [linhaProducao(i)]
                  }) : []),
                ]
              })}
            </tbody>
          </table>
          {!linhas.length && <p className="tabela-vazia">Nenhuma copy com esses filtros.</p>}
        </div>
        {menu && createPortal(   // no body: dentro do modal (glass) o position: fixed contava a partir do modal, não da tela
          <div className="tabela-menu glass glass--light" ref={refMenu} style={{ left: menu.x, top: menu.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
            {menu.renomear !== undefined ? (
              <form onSubmit={async (e) => { e.preventDefault(); const n = menu.renomear!.trim(); const a = menu.p; setMenu(null); if (n && n !== a.nome && onRenomear) await onRenomear(a, n) }}>
                <input autoFocus value={menu.renomear} onChange={(e) => setMenu({ ...menu, renomear: e.target.value })} onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null) } }} aria-label="Novo nome" />
              </form>
            ) : menu.apagar ? (<>
              <p className="tabela-menu-t">Mandar para a lixeira do vault?</p>
              <button className="is-perigo" autoFocus onClick={async () => { const a = menu.p; setMenu(null); await onApagar?.([a]) }}>Deletar</button>
              <button onClick={() => setMenu({ ...menu, apagar: false })}>Cancelar</button>
            </>) : (<>
              <button onClick={() => { const a = menu.p; setMenu(null); onAbrir(a) }}>Abrir</button>
              {(() => { const id = idDoCard(est, menu.p), sim = pins.includes(id); if (!pinavel(id)) return null
                return <button onClick={() => { setMenu(null); alternarPin(id, !sim) }}>{sim ? 'Despinar' : 'Pinar na barra'}</button> })()}
              {onRenomear && <button onClick={() => setMenu({ ...menu, renomear: menu.p.nome })}>Renomear</button>}
              {onTags && (() => {
                // linha marcada junto com outras: as tags valem para todas as marcadas
                const alvos = sel.has(chaveDe(menu.p)) && sel.size > 1 ? daPasta.filter((p) => sel.has(chaveDe(p))) : daPasta.filter((p) => chaveDe(p) === chaveDe(menu.p))
                return alvos.length > 0 && <MenuTags alvos={alvos} sugestoes={todasTags} onTags={onTags} />
              })()}
              {onStatus && t.pasta !== 'ideias' && <><p className="tabela-menu-t">Mover para</p>
                {STATUS.filter((x) => x.k !== t.pasta).map((x) => (
                  <button key={x.k} onClick={async () => { const a = menu.p; setMenu(null); await onStatus([a], x.k) }}>{x.marca} {x.nome}</button>
                ))}</>}
              {onApagar && <><hr /><button className="is-perigo" onClick={() => setMenu({ ...menu, apagar: true })}>Deletar</button></>}
            </>)}
          </div>, document.body
        )}
        {onApagar && sel.size > 0 && (
          <div className="tabela-selecao">
            <b>{sel.size} {sel.size === 1 ? 'nota selecionada' : 'notas selecionadas'}</b>
            <button className="pilula" onClick={() => { setSel(new Set()); setConfirmar(false) }}>Limpar seleção</button>
            {onStatus && t.pasta !== 'ideias' && <select className="tabela-status" value="" disabled={apagando} aria-label="Mudar o status das selecionadas"
              onChange={async (e) => { const st = e.target.value as StatusProd; if (!st) return; setApagando(true)
                try { await onStatus(daPasta.filter((p) => sel.has(chaveDe(p))).map((p) => ({ raiz: p.raiz, nome: p.nome })), st); setSel(new Set()) } finally { setApagando(false) } }}>
              <option value="">Mudar status…</option>
              {STATUS.filter((x) => x.k !== t.pasta).map((x) => <option key={x.k} value={x.k}>{x.marca} {x.nome}</option>)}
            </select>}
            {confirmar
              ? <><span className="mudo">Vão para a lixeira do vault (.trash), dá para recuperar.</span>
                <button className="pilula is-perigo" disabled={apagando} autoFocus onClick={async () => {
                  setApagando(true)
                  try { await onApagar(daPasta.filter((p) => sel.has(chaveDe(p))).map((p) => ({ raiz: p.raiz, nome: p.nome }))); setSel(new Set()) }
                  finally { setApagando(false); setConfirmar(false) }
                }}>{apagando ? 'Apagando…' : `Deletar ${sel.size}`}</button></>
              : <button className="pilula is-perigo" onClick={() => setConfirmar(true)}>Deletar {sel.size}</button>}
          </div>
        )}
      </div>
    </div>
  )
  return alvo && !embutido ? createPortal(corpo, alvo) : corpo
}

/** Célula da coluna Tags: mostra as tags; com clique vira um campo (Enter ou vírgula põe, × ou ⌫ no vazio tira, Esc fecha). */
function CelulaTags({ tags, sugestoes, onMudar }: { tags: string[]; sugestoes: string[]; onMudar?: (l: string[]) => Promise<void> }) {
  const [editando, setEditando] = useState(false)
  const [l, setL] = useState(tags)
  const [txt, setTxt] = useState('')
  const caixa = useRef<HTMLDivElement>(null)
  // o que foi gravado aparece na hora; a lista que vem do vault só toma o lugar quando já traz a mudança
  const escrito = useRef<string[] | null>(null)
  useEffect(() => {
    if (editando) return
    if (escrito.current && escrito.current.join('\n') !== tags.join('\n')) return
    escrito.current = null; setL(tags)
  }, [tags, editando])
  const limpa = (x: string) => x.trim().replace(/^#/, '')
  const gravar = (nova: string[]) => {
    setL(nova)
    if (onMudar && nova.join('\n') !== tags.join('\n')) {
      escrito.current = nova
      onMudar(nova).catch(() => { escrito.current = null; setL(tags) })
    }
  }
  const fechar = () => {
    const t = limpa(txt)
    setTxt(''); setEditando(false)
    gravar(t && !l.includes(t) ? [...l, t] : l)
  }
  useEffect(() => {
    if (!editando) return
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) fechar() }
    window.addEventListener('mousedown', fora)
    return () => window.removeEventListener('mousedown', fora)
  })
  if (!editando) return (
    <div className={`tabela-tags ${onMudar ? 'is-editavel' : ''}`} onClick={() => onMudar && setEditando(true)} title={onMudar ? 'Editar as tags' : undefined}>
      {l.length ? l.map((x) => <span key={x} className="tabela-tag">{x}</span>) : <span className="mudo">{onMudar ? '+ tag' : '—'}</span>}
    </div>
  )
  const opcoes = sugestoes.filter((x) => !l.includes(x) && x.toLowerCase().includes(limpa(txt).toLowerCase())).slice(0, 12)
  return (
    <div className="tabela-tags is-editando" ref={caixa}>
      {l.map((x) => <span key={x} className="tabela-tag">{x}<button aria-label={`Tirar ${x}`} onClick={() => gravar(l.filter((y) => y !== x))}>×</button></span>)}
      <input autoFocus value={txt} placeholder="tag…" aria-label="Nova tag" onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          const t = limpa(txt)
          if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && t) { e.preventDefault(); setTxt(''); if (!l.includes(t)) gravar([...l, t]) }
          else if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); fechar() }
          else if (e.key === 'Backspace' && !txt && l.length) gravar(l.slice(0, -1))
        }} />
      {opcoes.length > 0 && <div className="tabela-tags-menu glass glass--light">{opcoes.map((x) => (
        <button key={x} onMouseDown={(e) => { e.preventDefault(); setTxt(''); gravar([...l, x]) }}>{x}</button>
      ))}</div>}
    </div>
  )
}

/** Tags no botão direito da tabela: as da nota (ou das notas marcadas) com ×, e um campo com as sugestões do vault. */
function MenuTags({ alvos, sugestoes, onTags }: { alvos: Producao[]; sugestoes: string[]; onTags: (a: Alvo, tags: string[]) => Promise<void> }) {
  const [txt, setTxt] = useState('')
  const [extra, setExtra] = useState<string[]>([])     // o que já foi posto aqui, até o recarregar chegar
  const [fora, setFora] = useState<string[]>([])       // o que já foi tirado aqui
  const tem = (p: Producao) => [...(p.tags ?? []).filter((x) => !fora.includes(x)), ...extra.filter((x) => !(p.tags ?? []).includes(x))]
  const atuais = [...new Set(alvos.flatMap(tem))]
  const limpa = (x: string) => x.trim().replace(/^#/, '')
  const por = (t: string) => {
    t = limpa(t); if (!t) return
    setTxt(''); setExtra((l) => [...l, t]); setFora((l) => l.filter((x) => x !== t))
    for (const p of alvos) if (!tem(p).includes(t)) onTags({ raiz: p.raiz, nome: p.nome }, [...tem(p), t]).catch(() => {})
  }
  const tirar = (t: string) => {
    setFora((l) => [...l, t]); setExtra((l) => l.filter((x) => x !== t))
    for (const p of alvos) if (tem(p).includes(t)) onTags({ raiz: p.raiz, nome: p.nome }, tem(p).filter((x) => x !== t)).catch(() => {})
  }
  const q = limpa(txt).toLowerCase()
  const opcoes = sugestoes.filter((x) => !atuais.includes(x) && x.toLowerCase().includes(q)).slice(0, 6)
  return <>
    <p className="tabela-menu-t">Tags{alvos.length > 1 ? ` (${alvos.length} notas)` : ''}</p>
    <div className="menu-tags">
      {atuais.map((x) => <span key={x} className="tabela-tag">{x}<button aria-label={`Tirar ${x}`} onClick={() => tirar(x)}>×</button></span>)}
      <input className="menu-tags-campo" value={txt} placeholder="Atribuir tag…" aria-label="Atribuir tag" onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if ((e.key === 'Enter' || e.key === ',') && limpa(txt)) { e.preventDefault(); por(txt) } }} />
    </div>
    {opcoes.length > 0 && <div className="menu-tags-sug">{opcoes.map((x) => <button key={x} className="tabela-tag" onClick={() => por(x)}>{x}</button>)}</div>}
  </>
}


/** Os tipos de conteúdo (formatos) num dropdown só: o botão mostra os escolhidos; o menu tem uma caixinha por formato. */
function FiltroFormatos({ lista, on, nomes, onAlternar, onLimpar }: {
  lista: [string, number][]; on: string[]; nomes: Record<string, string>; onAlternar: (f: string) => void; onLimpar: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAberto(false) } }
    window.addEventListener('pointerdown', fora, true); window.addEventListener('keydown', esc, true)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('keydown', esc, true) }
  }, [aberto])
  const rotulo = on.length === 0 ? 'Todos os formatos' : on.length <= 3 ? `Formatos: ${on.join(' ')}` : `${on.length} formatos`
  return (
    <div className="tabela-fmt" ref={caixa}>
      <button className={`tabela-select tabela-fmt-botao ${on.length ? 'is-on' : ''}`} onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>{rotulo}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg></button>
      {aberto && (
        <div className="tabela-fmt-menu glass glass--light" role="menu">
          {lista.map(([f, n]) => (
            <button key={f} role="menuitemcheckbox" aria-checked={on.includes(f)} className="tabela-fmt-item" onClick={() => onAlternar(f)}>
              <i className={`menu-caixinha ${on.includes(f) ? 'is-on' : ''}`}>{on.includes(f) ? '✓' : ''}</i>
              <span className="tabela-fmt-ic">{f}</span><span>{nomes[f] ?? (f === '📄' ? 'Sem formato' : f)}</span><em>{n}</em>
            </button>
          ))}
          {on.length > 0 && <><hr /><button className="tabela-fmt-item" onClick={onLimpar}>Limpar</button></>}
        </div>
      )}
    </div>
  )
}


/** Coluna Status (na Redação): o ponto e o nome do status da copy. */
function Status({ p }: { p: Producao }) {
  return <span className="tabela-status"><i className={`ponto is-${p.status}`} />{STATUS.find((x) => x.k === p.status)?.nome}</span>
}

