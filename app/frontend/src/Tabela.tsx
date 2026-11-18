import { useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icone } from './Icone'
import { alternarPin, idDoCard, pinavel, usePins } from './pins'
import { chaveProd, ORDEM_FORMATO, STATUS, type Alvo, type EstadoCanvas, type Producao, type StatusProd } from './canvasApi'

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

export function ModalTabela({ est, t, onMudar, onFechar, onAbrir, onCanvas, onApagar, onStatus, onRenomear, onTags, canvasNome, pinados = [], icones = {} }: {
  icones?: Record<string, string>   // nome do canvas → emoji dele (o indicativo do canvas nas linhas)
  canvasNome?: string   // o canvas aberto: a aba Ideias mostra só as dele
  pinados?: string[]    // ids dos cards pinados (i:/g:/e:/p:), de todos os canvas
  est: EstadoCanvas; t: EstadoTabela; onMudar: (t: EstadoTabela) => void; onFechar: () => void
  onAbrir: (a: Alvo) => void; onCanvas: (pasta: StatusProd, ano: string) => void
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
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onFechar() } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  // as 💡 ideias do canvas aberto viram linhas como as das copies (formato 💡, "produção" = quantas versões têm)
  const linhaIdeia = useCallback((i: EstadoCanvas['ideias'][number]): Producao => {
    const n = est.producoes.filter((p) => p.ideia === i.nome).length
    return { nome: i.nome, raiz: 'ideias' as Producao['raiz'], status: 'ideia', scheduled: null, ano: '', formato: '💡', ideia: n ? `${n} ${n === 1 ? 'versão' : 'versões'}` : null,
      previa: i.previa, mtime: i.mtime, criado: i.mtime, canvas: i.canvas, categoria: i.categoria || 'Sem categoria', canvases: i.canvases, tags: i.tags, links: i.links ?? [], imagem: i.imagem ?? null, copia: i.copia ?? null } as Producao & { categoria: string }
  }, [est])
  const ideiasDoCanvas = useMemo(() => est.ideias
    .filter((i) => !canvasNome || (i.canvases ?? (i.canvas ? [i.canvas] : [])).includes(canvasNome))
    .map(linhaIdeia), [est, canvasNome, linhaIdeia])
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
  const [catAbertas, setCatAbertas] = useState<Set<string>>(() => new Set())
  const [ideiasAbertas, setIdeiasAbertas] = useState<Set<string>>(() => new Set())
  const trocar = (set: (f: (s: Set<string>) => Set<string>) => void, k: string) => set((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const copiasDe = useCallback((ideia: string) => est.producoes.filter((p) => p.ideia === ideia).sort((a, b) => ORDEM_FORMATO.indexOf(a.formato) - ORDEM_FORMATO.indexOf(b.formato) || b.mtime - a.mtime), [est])
  const categorias = useMemo(() => {
    if (t.pasta !== 'ideias') return []
    const m = new Map<string, Producao[]>()
    for (const p of linhas) { const c = (p as Producao & { categoria?: string }).categoria || 'Sem categoria'; m.set(c, [...(m.get(c) ?? []), p]) }
    return [...m.entries()].sort((a, b) => (a[0] === 'Sem categoria' ? 1 : b[0] === 'Sem categoria' ? -1 : b[1].length - a[1].length || a[0].localeCompare(b[0])))
  }, [linhas, t.pasta])
  const chipCanvas = (nome?: string | null) => nome
    ? <span className="tabela-caixa" title={`No canvas ${nome}`}>{icones[nome] ? <span className="tabela-caixa-ic">{icones[nome]}</span> : null}{nome}</span>
    : <span className="mudo">{INBOX_NOME}</span>

  const porFormato = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of base.filter((p) => !t.mes || dia(p).startsWith(t.mes))) c[p.formato || '📄'] = (c[p.formato || '📄'] ?? 0) + 1
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [base, t.mes])
  // barras por mês: do ano escolhido, ou os últimos 12 meses com copy
  const meses = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of base.filter((p) => !t.formatos.length || t.formatos.includes(p.formato))) c[dia(p).slice(0, 7)] = (c[dia(p).slice(0, 7)] ?? 0) + 1
    const ks = t.ano ? Array.from({ length: 12 }, (_, i) => `${t.ano}-${String(i + 1).padStart(2, '0')}`) : Object.keys(c).sort().slice(-12)
    return ks.map((k) => [k, c[k] ?? 0] as const)
  }, [base, t.formatos, t.ano])
  const maxMes = Math.max(1, ...meses.map((m) => m[1]))
  const palavras = linhas.map((p) => p.palavras ?? 0).filter((n) => n > 0)
  const media = palavras.length ? Math.round(palavras.reduce((a, b) => a + b, 0) / palavras.length) : 0
  const hoje = new Date().toISOString().slice(0, 10)
  const em7 = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10)
  const destaque = t.pasta === 'agendado'
    ? { n: linhas.filter((p) => p.scheduled && p.scheduled.slice(0, 10) >= hoje && p.scheduled.slice(0, 10) <= em7).length, r: 'nos próximos 7 dias' }
    : t.pasta === 'publicado' || t.pasta === 'winner' ? { n: linhas.filter((p) => dia(p) >= new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10)).length, r: 'nos últimos 30 dias' }
    : { n: linhas.filter((p) => Date.now() / 1000 - p.mtime > 14 * 86400).length, r: 'paradas há +14 dias' }

  const ordenar = (col: Coluna) => mudar({ ordem: { col, asc: t.ordem.col === col ? !t.ordem.asc : col === 'nome' || col === 'tags' || col === 'grupo' } })
  const alternarFormato = (f: string) => mudar({ formatos: t.formatos.includes(f) ? t.formatos.filter((x) => x !== f) : [...t.formatos, f] })
  const filtrando = t.busca || t.formatos.length || t.ano || t.mes || t.grupo
  const contagem = (k: StatusProd) => est.producoes.filter((p) => p.status === k).length
  const alvo = document.querySelector('section.pagina')
  type Galho = { nivel: number; n?: number; aberta?: boolean; alternar?: () => void }
  const linha = (p: Producao, g?: Galho) => (
                <tr key={`${p.raiz}/${p.nome}`} onClick={() => onAbrir({ raiz: p.raiz, nome: p.nome })} tabIndex={0} className={`${sel.has(chaveDe(p)) ? 'is-sel' : ''} ${g?.nivel ? `tabela-nivel-${g.nivel}` : ''}`}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 280), p: { raiz: p.raiz, nome: p.nome } }) }}
                  onKeyDown={(e) => e.key === 'Enter' && onAbrir({ raiz: p.raiz, nome: p.nome })}>
                  {onApagar && <td className="col-sel" onClick={(e) => { e.stopPropagation(); alternar(chaveDe(p)) }}>
                    <input type="checkbox" aria-label={`Marcar ${p.nome}`} checked={sel.has(chaveDe(p))} onChange={() => {}} /></td>}
                  <td className="col-formato">{p.formato || '📄'}</td>
                  <td className="col-nome">{g?.nivel ? <div className="tabela-galho">
                    {g.nivel === 1 ? (g.n ? <button className={`tabela-seta-grupo ${g.aberta ? 'is-aberta' : ''}`} aria-label={g.aberta ? 'Fechar as copies' : `Mostrar ${g.n} copies`} onClick={(e) => { e.stopPropagation(); g.alternar?.() }}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button> : <span className="tabela-seta-grupo is-vazia" />)
                      : <i className={`ponto is-${p.status}`} title={STATUS.find((x) => x.k === p.status)?.nome} />}
                    <div><b>{semEmoji(p.nome)}{g.nivel === 1 && g.n ? <em className="tabela-n">{g.n}</em> : null}</b>{p.previa && <span>{p.previa}</span>}</div></div>
                    : <><b>{semEmoji(p.nome)}</b>{p.previa && <span>{p.previa}</span>}</>}</td>
                  <td className="col-data">{(p.datas?.length ?? 0) > 1 ? <span title={`Postada ${p.datas!.length} vezes`}>{p.datas!.map(dataBr).join(' · ')}</span>
                    : p.scheduled ? dataBr(p.scheduled.slice(0, 10)) : t.pasta === 'winner' ? <span className="mudo" title="Sem data de postagem (scheduled vazio)">sem data</span> : <span className="mudo">{dataBr(dia(p))}</span>}</td>
                  <td className="col-tags" onClick={onTags ? (e) => e.stopPropagation() : undefined}>
                    <CelulaTags tags={p.tags ?? []} sugestoes={todasTags} onMudar={onTags && ((l) => onTags({ raiz: p.raiz, nome: p.nome }, l))} /></td>
                  <td className="col-grupo">{chipCanvas(p.canvas)}</td>
                  <td className="col-palavras">{p.palavras || <span className="mudo">0</span>}</td>
                  <td className="col-mtime">{relativo(p.mtime)}</td>
                </tr>
  )

  const corpo = (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal-nota modal-tabela glass glass--light" role="dialog" aria-label="Tabela de copies">
        <header className="modal-tabs">
          <nav role="tablist">
            {canvasNome && <button role="tab" aria-selected={t.pasta === 'ideias'} className={`modal-tab ${t.pasta === 'ideias' ? 'is-ativa' : ''}`} onClick={() => onMudar(tabelaNova('ideias'))}
              title={`Criação: as categorias e 💡 ideias de ${canvasNome}, com as copies de cada uma`}>
              <span className="tabela-fogo">💡</span><span>Criação</span><em className="tabela-n">{ideiasDoCanvas.length}</em>
            </button>}
            {canvasNome && <span className="modal-tab-sep" aria-hidden="true" />}
            {STATUS.map((s) => (
              <button key={s.k} role="tab" aria-selected={s.k === t.pasta} className={`modal-tab ${s.k === t.pasta ? 'is-ativa' : ''}`} onClick={() => onMudar(tabelaNova(s.k))}>
                <i className={`ponto is-${s.k}`} /><span>{s.nome}</span><em className="tabela-n">{contagem(s.k)}</em>
              </button>
            ))}
            <button role="tab" aria-selected={t.pasta === 'winner'} className={`modal-tab ${t.pasta === 'winner' ? 'is-ativa' : ''}`} onClick={() => onMudar(tabelaNova('winner'))}>
              <span className="tabela-fogo">🔥</span><span>Winners</span><em className="tabela-n">{est.producoes.filter((p) => p.winner).length}</em>
            </button>
            <button role="tab" aria-selected={t.pasta === 'pinados'} className={`modal-tab ${t.pasta === 'pinados' ? 'is-ativa' : ''}`} onClick={() => onMudar(tabelaNova('pinados'))} title="Os cards pinados, de todos os canvas">
              <span className="tabela-fogo">📌</span><span>Pinados</span><em className="tabela-n">{linhasPinadas.length}</em>
            </button>
          </nav>
          {t.pasta !== 'ideia' && t.pasta !== 'winner' && t.pasta !== 'ideias' && t.pasta !== 'pinados' && <button className="tabela-canvas" onClick={() => onCanvas(t.pasta as StatusProd, t.ano)} title="Abrir estas copies no canvas"><Icone n="grafo" t={13} /> Ver no canvas</button>}
          <button className="btn-icone" onClick={onFechar} aria-label="Fechar" title="Fechar (esc)"><Icone n="fechar" t={16} /></button>
        </header>

        <section className="tabela-numeros">
          <div className="tabela-num"><b>{linhas.length}</b><span>{filtrando ? `de ${daPasta.length} copies` : 'copies'}</span></div>
          <div className="tabela-num"><b>{destaque.n}</b><span>{destaque.r}</span></div>
          <div className="tabela-num"><b>{media || '—'}</b><span>palavras em média</span></div>
          <div className="tabela-meses" aria-label="Copies por mês">
            {meses.map(([k, n]) => (
              <button key={k} className={`tabela-mes ${t.mes === k ? 'is-on' : ''} ${t.mes && t.mes !== k ? 'is-apagado' : ''}`} onClick={() => mudar({ mes: t.mes === k ? '' : k })}
                title={`${MESES[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}: ${n} ${n === 1 ? 'copy' : 'copies'}`}>
                <i style={{ height: `${Math.max(n ? 8 : 2, (n / maxMes) * 100)}%` }} /><span>{MESES[Number(k.slice(5)) - 1].slice(0, 1)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="tabela-filtros">
          <label className="tabela-busca"><Icone n="busca" t={13} /><input value={t.busca} onChange={(e) => mudar({ busca: e.target.value })} placeholder="Buscar copy, produção ou texto" autoFocus /></label>
          <div className="tabela-chips">
            {porFormato.map(([f, n]) => (
              <button key={f} className={`tabela-chip ${t.formatos.includes(f) ? 'is-on' : ''}`} onClick={() => alternarFormato(f)}>{f}<em>{n}</em></button>
            ))}
          </div>
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
            const tudoAberto = categorias.every(([c, is]) => catAbertas.has(c) && is.every((i) => !copiasDe(i.nome).length || ideiasAbertas.has(i.nome)))
            return <button className="tabela-select tabela-tudo" onClick={() => {
              if (tudoAberto) { setCatAbertas(new Set()); setIdeiasAbertas(new Set()) }
              else { setCatAbertas(new Set(categorias.map(([c]) => c))); setIdeiasAbertas(new Set(categorias.flatMap(([, is]) => is.map((i) => i.nome)))) }
            }} title={tudoAberto ? 'Fechar todas as categorias' : 'Abrir todas as categorias e as copies de cada ideia'}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {tudoAberto ? <path d="M3 2.5l3 3 3-3M3 9.5l3-3 3 3" /> : <path d="M3 5l3-3 3 3M3 7l3 3 3-3" />}</svg>
              {tudoAberto ? 'Recolher tudo' : 'Expandir tudo'}</button>
          })()}
          {filtrando ? <button className="tabela-limpar" onClick={() => mudar({ busca: '', formatos: [], ano: '', mes: '', grupo: '' })}>Limpar filtros</button> : null}
        </section>

        <div className="tabela-rolo">
          <table className="tabela">
            <thead>
              <tr>{onApagar && <th className="col-sel" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label="Marcar todas as linhas" checked={linhas.length > 0 && linhas.every((p) => sel.has(chaveDe(p)))}
                  onChange={(e) => setSel(e.target.checked ? new Set(linhas.map(chaveDe)) : new Set())} /></th>}
                {(Object.keys(ROTULO_COL) as Coluna[]).map((c) => (
                <th key={c} className={`col-${c}`} onClick={() => ordenar(c)} aria-sort={t.ordem.col === c ? (t.ordem.asc ? 'ascending' : 'descending') : 'none'}>
                  {ROTULO_COL[c]}{t.ordem.col === c && <span className="tabela-seta">{t.ordem.asc ? '↑' : '↓'}</span>}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {t.pasta !== 'ideias' ? linhas.map((p) => linha(p)) : categorias.map(([cat, ideias]) => {
                const aberta = catAbertas.has(cat) || !!t.busca.trim()
                const canvases = [...new Set(ideias.map((i) => i.canvas).filter(Boolean))] as string[]
                return [
                  <tr key={`cat:${cat}`} className="tabela-grupo is-cat" onClick={() => trocar(setCatAbertas, cat)}>
                    {onApagar && <td className="col-sel" />}
                    <td className="col-formato"><span className={`tabela-seta-grupo ${aberta ? 'is-aberta' : ''}`}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span></td>
                    <td className="col-nome"><b>{cat}</b><span>{ideias.length} {ideias.length === 1 ? 'ideia' : 'ideias'} · {ideias.reduce((n, i) => n + copiasDe(i.nome).length, 0)} copies</span></td>
                    <td /><td />
                    <td className="col-grupo"><div className="tabela-caixas">{canvases.map((c) => <span key={c}>{chipCanvas(c)}</span>)}</div></td>
                    <td /><td />
                  </tr>,
                  ...(aberta ? ideias.flatMap((i) => {
                    const cs = copiasDe(i.nome), abre = ideiasAbertas.has(i.nome)
                    return [linha(i, { nivel: 1, n: cs.length, aberta: abre, alternar: () => trocar(setIdeiasAbertas, i.nome) }),
                      ...(abre ? cs.map((c) => linha(c, { nivel: 2 })) : [])]
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
  return alvo ? createPortal(corpo, alvo) : corpo
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
