import { Fragment, useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icone } from './Icone'
import { MenuCategorias, PIN, SEM, listaCategorias } from './Categorias'
import { alternarPin, usePins } from './pins'
import { chaveProd, ORDEM_FORMATO, STATUS, type Alvo, type EstadoCanvas, type Producao, type StatusProd } from './canvasApi'

/** Modal de tabela das pastas (Priorizar, Em edição, Agendado, Publicado): as copies em linhas, com números,
 *  filtros e ordenação. Clicar numa linha abre a copy no modal de nota, que tem "voltar" para cá. */

export type Coluna = 'formato' | 'nome' | 'data' | 'tags' | 'palavras' | 'mtime'
/** 'winner': as copies com 🔥 (de qualquer status), com todas as datas em que foram postadas. */
export type Pasta = StatusProd | 'winner' | 'ideias' | 'pinados' | 'skills'   // ideias: a Criação (as copies por categoria, sem as arquivadas); skills: as skills do vault
export type EstadoTabela = {
  pasta: Pasta; busca: string; formatos: string[]; ano: string; mes: string; grupo: string
  ordem: { col: Coluna; asc: boolean }
  filtros?: Filtros   // botão Filtrar (Redação): status, categoria e data; vazio = tudo
  regras?: Regra[]   // ordenação por regras (botão ⇅): valem em sequência e passam por cima da ordem do cabeçalho
}
export type Filtros = { status?: string[]; categoria?: string[]; data?: '' | 'com' | 'sem' }
const nFiltros = (f?: Filtros) => (f?.status?.length ?? 0) + (f?.categoria?.length ?? 0) + (f?.data ? 1 : 0)
export type CampoOrdem = 'nome' | 'status' | 'categoria' | 'data' | 'mtime' | 'palavras' | 'formato' | 'tags'
export type Regra = { campo: CampoOrdem; asc: boolean }
const CAMPOS: [CampoOrdem, string][] = [['nome', 'Nome'], ['status', 'Status'], ['categoria', 'Categoria'], ['data', 'Data'],
  ['mtime', 'Editada'], ['palavras', 'Palavras'], ['formato', 'Formato'], ['tags', 'Tags']]
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

export type Criacao = { cores: Record<string, string>; categorias: string[]; ordem: Record<string, string[]>; arquivadas?: string[] }
/** Os grupos da Criação, pelo ícone (formato) do nome da copy. */
export const GRUPO_FORMATO: Record<string, string> = { '📱': '📱 Reels', '📝': '📱 Reels', '🏞️': '📱 Reels', '🏞': '📱 Reels', '💻': '📱 Reels', '📚': '📚 Aula', '💰': '💰 Ad', '📺': '📺 VSL' }
/** Cores pastel das categorias (botão direito na categoria). */
const PASTEIS = ['#fde2e4', '#fde8cf', '#fff3c4', '#e4f2cf', '#d4efe6', '#d6e8f7', '#e3dcf6', '#f3dcef', '#ece6dc']

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const dia = (p: Producao) => (p.scheduled ?? '').slice(0, 10) || new Date((p.criado ?? p.mtime) * 1000).toISOString().slice(0, 10)
const dataBr = (d: string) => `${d.slice(8, 10)} ${MESES[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`
const relativo = (t: number) => {
  const d = Math.floor((Date.now() / 1000 - t) / 86400)
  return d < 1 ? 'hoje' : d === 1 ? 'ontem' : d < 30 ? `há ${d} dias` : d < 365 ? `há ${Math.floor(d / 30)} m` : `há ${Math.floor(d / 365)} a`
}
export const semEmoji = (n: string) => n.replace(/^[^\p{L}\p{N}]+/u, '')
const ROTULO_COL: Record<Coluna, string> = { formato: '', nome: 'Copy', data: 'Data', tags: 'Tags', palavras: 'Palavras', mtime: 'Editada' }

export function ModalTabela({ est, t, onMudar, onFechar, onAbrir, onApagar, onStatus, onRenomear, onTags, onArquivar, criacao, onCriacao, onCategoria, onRenomearCategoria, embutido, compacto, semColunas, semCategorias, aberta, extra, onData }: {
  embutido?: boolean   // na página Redação: sem véu, sem fechar, ocupa o lugar dela
  compacto?: boolean   // modo copy (nota aberta ao lado): classe tabela-compacta
  semCategorias?: boolean   // ⌘[ esconde o menu de categorias
  semColunas?: boolean   // ⌘] esconde Status e Data (modo copy)
  aberta?: Alvo | null   // a nota aberta ao lado (linha destacada)
  extra?: React.ReactNode   // botões a mais no topo (o calendário da Redação)
  onData?: (alvo: Alvo, data: string) => Promise<void>   // Redação: a data da copy editada na célula
  onArquivar?: (alvo: Alvo, sim: boolean) => Promise<void>   // botão direito → Arquivar: sai da Criação (`arquivado: true` na nota)
  criacao?: Criacao   // cor e ordem das categorias e das copies na Criação (dados/criacao.json)
  onCriacao?: (m: Partial<Criacao>) => void
  onRenomearCategoria?: (de: string, para: string) => Promise<void>
  onCategoria?: (alvo: Alvo, categoria: string) => Promise<void>   // arrastar uma copy para outra categoria
  est: EstadoCanvas; t: EstadoTabela; onMudar: (t: EstadoTabela) => void; onFechar: () => void
  onAbrir: (a: Alvo, opts?: { nova?: boolean }) => void
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
  const pinsSet = useMemo(() => new Set(pins), [pins])
  // filtro de categoria: a categoria da copy ou, com 📌 Pinados escolhido, ser pinada
  const naCat = (cats: string[], p: Producao) => !cats.length || cats.includes(p.categoria ?? '') || (cats.includes(PIN) && pinsSet.has(`p:${p.raiz}/${p.nome}`))
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
  // ⇧+clique: seleciona da última linha clicada (a âncora) até esta, na ordem em que aparecem na tabela
  const ancora = useRef<string | null>(null)
  const selecionarAte = (k: string) => {
    const ordem = [...(rolo.current?.querySelectorAll<HTMLElement>('tr[data-chave]') ?? [])].map((tr) => tr.dataset.chave!)
    const a = ancora.current ? ordem.indexOf(ancora.current) : -1, b = ordem.indexOf(k)
    if (b < 0) return
    const [i, j] = a < 0 ? [b, b] : [Math.min(a, b), Math.max(a, b)]
    setSel(new Set(ordem.slice(i, j + 1)))
  }
  // caixas de seleção só fora da Redação; nela a seleção é arrastando o mouse
  const comCaixa = !!onApagar && !embutido
  // seleção por caixa arrastável (como no Finder): arrastar a partir de qualquer ponto da linha que não seja o nome da copy
  // (o nome continua arrastando a copy para o calendário ou para outra posição). ⌘/⇧ somam à seleção que já existe.
  const [laco, setLaco] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const inicioArraste = useRef<EventTarget | null>(null)
  const engolirClique = useRef(false)
  const comecarLaco = (e: React.PointerEvent<HTMLDivElement>) => {
    inicioArraste.current = e.target
    const alvo = e.target as HTMLElement
    // a calha à esquerda do ponto de status (o recuo da célula Copy, o ícone) é área de seleção, não de abrir a copy
    const calha = alvo.matches('td.col-nome, td.col-formato, td.col-sel')
    if (e.button !== 0 || !onApagar || alvo.closest('input, select, button, a, th, .tabela-alca, .tabela-grupo') || (!calha && alvo.closest('.col-nome'))) return
    const rolo = e.currentTarget, r0 = rolo.getBoundingClientRect()
    const x0 = e.clientX - r0.left + rolo.scrollLeft, y0 = e.clientY - r0.top + rolo.scrollTop
    const base = e.metaKey || e.ctrlKey || e.shiftKey ? new Set(sel) : new Set<string>()
    let ligado = false
    const mover = (ev: PointerEvent) => {
      const r = rolo.getBoundingClientRect()
      const x1 = ev.clientX - r.left + rolo.scrollLeft, y1 = ev.clientY - r.top + rolo.scrollTop
      if (!ligado && Math.hypot(x1 - x0, y1 - y0) < 5) return
      ligado = true
      const caixa = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
      setLaco(caixa)
      const topo = r.top - rolo.scrollTop
      const n = new Set(base)
      rolo.querySelectorAll<HTMLElement>('tr[data-chave]').forEach((tr) => {
        const b = tr.getBoundingClientRect(), y = b.top - topo
        if (y < caixa.y + caixa.h && y + b.height > caixa.y) n.add(tr.dataset.chave!)
      })
      setSel(n)
    }
    const soltar = () => {
      window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', soltar); window.removeEventListener('dragstart', arrastou); window.removeEventListener('blur', soltar)
      document.body.classList.remove('lacando'); setLaco(null)
      // clique sem arrastar na calha ou num vazio limpa a seleção. O clique que vem logo depois não abre a copy
      // (num outro canto da linha, o clique segue abrindo a copy, como antes)
      if (!ligado && !calha && alvo.closest('tr[data-chave]')) return
      if (!ligado) setSel(new Set())
      engolirClique.current = true
      window.setTimeout(() => { engolirClique.current = false }, 0)
    }
    // o arraste nativo (linha para o calendário) engole o pointerup: sem isto a caixa ficava presa na tela
    const arrastou = (ev: DragEvent) => { if (!ev.defaultPrevented) soltar() }
    document.body.classList.add('lacando')
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', soltar); window.addEventListener('dragstart', arrastou); window.addEventListener('blur', soltar)
  }
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
      previa: i.previa, mtime: i.mtime, criado: i.mtime, categoria: i.categoria || 'Sem categoria', tags: i.tags, links: i.links ?? [], imagem: i.imagem ?? null, copia: i.copia ?? null } as Producao & { categoria: string }
  }, [est])
  // Criação: as copies de Reels, Aula, Ad e VSL (pelo ícone do nome), menos as arquivadas (botão direito → Arquivar)
  // as publicadas ficam de fora por padrão (como arquivadas): estão na aba Publicados
  const ideiasDoCanvas = useMemo(() => est.producoes.filter((p) => !p.arquivado && p.status !== 'publicado' && !!GRUPO_FORMATO[p.formato]), [est])
  // os pinados viram linhas: a 💡 ideia, cada copy de uma produção 🎬 e as copies soltas (entradas ficam de fora)
  const linhasPinadas = useMemo(() => {
    const vistos = new Set<string>(), out: Producao[] = []
    const add = (p: Producao) => { const k = `${p.raiz}/${p.nome}`; if (!vistos.has(k)) { vistos.add(k); out.push(p) } }
    for (const id of pins) {
      const r = id.slice(2)
      if (id.startsWith('i:')) est.ideias.filter((i) => i.nome === r).map(linhaIdeia).forEach(add)
      else if (id.startsWith('g:')) est.producoes.filter((p) => chaveProd(p) === r).forEach(add)
      else if (id.startsWith('p:')) est.producoes.filter((p) => `${p.raiz}/${p.nome}` === r).forEach(add)
    }
    return out
  }, [est, pins, linhaIdeia])
  const daPasta = useMemo(() => (t.pasta === 'ideias' ? ideiasDoCanvas : t.pasta === 'pinados' ? linhasPinadas
    : est.producoes.filter((p) => (t.pasta === 'winner' ? !!p.winner : p.status === t.pasta))), [est, t.pasta, ideiasDoCanvas, linhasPinadas])
  const anos = useMemo(() => [...new Set(daPasta.map((p) => dia(p).slice(0, 4)))].sort().reverse(), [daPasta])
  // filtros que valem antes dos chips de formato e das barras de mês (para os números deles não sumirem ao clicar)
  // as categorias que existem nas copies (para o seletor da coluna Categoria)
  const arquivadas = useMemo(() => criacao?.arquivadas ?? [], [criacao?.arquivadas])
  const todasCategorias = useMemo(() => listaCategorias(est.producoes, criacao?.categorias ?? []), [est.producoes, criacao?.categorias])
  // publicadas com ícone de formato (as que ficariam na Criação), com a mesma categoria escolhida; mais recentes primeiro
  const [verPub, setVerPub] = useState(false)
  const publicadasCriacao = useMemo(() => {
    const cats = t.filtros?.categoria ?? []
    return est.producoes.filter((p) => p.status === 'publicado' && !p.arquivado && !!GRUPO_FORMATO[p.formato] && naCat(cats, p))
      .sort((a, b) => dia(b).localeCompare(dia(a)))
  }, [est.producoes, t.filtros?.categoria, pinsSet])
  // colunas que existem de fato (colSpan maior cria colunas fantasmas que comiam a sobra da largura)
  const nCols = (comCaixa ? 1 : 0) + (embutido ? (semColunas ? 2 : 4) : Object.keys(ROTULO_COL).length)
  const umaCat = !!embutido && t.pasta === 'ideias' && (t.filtros?.categoria?.length ?? 0) === 1
  const contagemCat = useMemo(() => { const c: Record<string, number> = {}; for (const p of daPasta) c[p.categoria ?? ''] = (c[p.categoria ?? ''] ?? 0) + 1; return c }, [daPasta])
  const base = useMemo(() => {
    const q = embutido ? '' : t.busca.trim().toLowerCase()   // na Redação a busca saiu (o ⌘O busca); vale o Filtrar
    const f = embutido ? t.filtros : undefined
    return daPasta.filter((p) => (!t.ano || dia(p).startsWith(t.ano))
      && (!f?.status?.length || f.status.includes(p.status))
      && naCat(f?.categoria ?? [], p)
      && !(t.pasta === 'ideias' && embutido && arquivadas.includes(p.categoria ?? '') && !f?.categoria?.includes(p.categoria ?? ''))
      && (!f?.data || (f.data === 'com') === !!p.scheduled)
      && (!q || p.nome.toLowerCase().includes(q) || (p.ideia ?? '').toLowerCase().includes(q) || p.previa.toLowerCase().includes(q)))
  }, [daPasta, t.busca, t.ano, t.grupo, t.filtros, embutido, pinsSet, arquivadas])
  const linhas = useMemo(() => {
    const l = base.filter((p) => (embutido || !t.formatos.length || t.formatos.includes(p.formato)) && (!t.mes || dia(p).startsWith(t.mes)))
    const { col, asc } = t.ordem
    if (t.regras?.length) {   // regras do ⇅: a primeira decide; empate vai para a seguinte. Vazio vai sempre para o fim
      const val = (p: Producao, c: CampoOrdem): string | number | null => c === 'status' ? STATUS.findIndex((x) => x.k === p.status)
        : c === 'categoria' ? (p.categoria ? semEmoji(p.categoria).toLowerCase() : null) : c === 'data' ? (dia(p) || null)
        : c === 'mtime' ? p.mtime : c === 'palavras' ? p.palavras ?? 0 : c === 'formato' ? ORDEM_FORMATO.indexOf(p.formato)
        : c === 'tags' ? ((p.tags ?? []).join(' ').toLowerCase() || null) : semEmoji(p.nome).toLowerCase()
      const regras = t.regras
      return l.sort((a, b) => {
        for (const r of regras) {
          const x = val(a, r.campo), y = val(b, r.campo)
          if (x === y) continue
          if (x === null) return 1
          if (y === null) return -1
          return (x < y ? -1 : 1) * (r.asc ? 1 : -1)
        }
        return 0
      })
    }
    // winners: pela última data em que foi postada; sem data vai para o fim
    const v = (p: Producao): string | number => col === 'data' ? (t.pasta === 'winner' ? (p.datas?.[p.datas.length - 1] ?? p.scheduled?.slice(0, 10) ?? '') : dia(p)) : col === 'palavras' ? p.palavras ?? 0 : col === 'mtime' ? p.mtime
      : col === 'formato' ? ORDEM_FORMATO.indexOf(p.formato) : col === 'nome' ? semEmoji(p.nome).toLowerCase() : ((p.tags ?? []).join(' ') || null)?.toLowerCase() ?? '~'
    return l.sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1) })
  }, [base, t.formatos, t.mes, t.ordem, t.regras, t.pasta, embutido])

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
  // larguras das colunas (Redação): arrastar a borda direita do cabeçalho; a coluna Copy fica com o resto
  const [larg, setLarg] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem('tabela-larguras') || '{}') } catch { return {} } })
  useEffect(() => { try { localStorage.setItem('tabela-larguras', JSON.stringify(larg)) } catch { /* sem storage */ } }, [larg])
  const LARG_PADRAO: Record<string, number> = { nome: 380, status: 150, categoria: 170, data: 150 }
  const largDe = (c: string) => larg[c] ?? LARG_PADRAO[c] ?? 120
  // como numa planilha: a alça na borda direita muda só aquela coluna e empurra as da direita (a Data fica com a sobra;
  // passou da largura do painel, a tabela rola para o lado)
  const redimensionar = (c: string) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    const x0 = e.clientX, w0 = largDe(c)
    const mover = (ev: PointerEvent) => setLarg((l) => ({ ...l, [c]: Math.max(70, Math.min(c === 'nome' ? 1200 : 480, Math.round(w0 + ev.clientX - x0))) }))
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); document.body.classList.remove('arrastando') }
    document.body.classList.add('arrastando')
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar)
  }
  const catDe = (p: Producao) => p.categoria || 'Sem categoria'   // os grupos da Criação são as categorias (categoria: da copy)
  // copy aberta (⌘O, clique, aba): se ela está na tabela com os filtros de agora, abre o grupo dela e rola até a linha
  useEffect(() => {
    if (!aberta || !embutido) return
    const p = linhas.find((x) => x.raiz === aberta.raiz && x.nome === aberta.nome) ?? pinadas.find((x) => x.raiz === aberta.raiz && x.nome === aberta.nome)
    if (!p) return
    if (t.pasta === 'ideias' && !umaCat) setCatAbertas((s) => (s.has(catDe(p)) ? s : new Set(s).add(catDe(p))))
    const id = window.setTimeout(() => rolo.current?.querySelector<HTMLElement>(`tr[data-chave="${CSS.escape(chaveDe(p))}"]`)?.scrollIntoView({ block: 'nearest' }), 60)
    return () => window.clearTimeout(id)
  }, [aberta?.raiz, aberta?.nome])   // eslint-disable-line react-hooks/exhaustive-deps
  // ⌘D (modo esc): manda para a lixeira as selecionadas (confirma na barra de baixo) ou a copy aberta (pergunta antes)
  useEffect(() => {
    if (!embutido || !onApagar) return
    const tecla = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.code !== 'KeyD') return
      if ((e.target as HTMLElement | null)?.closest?.('textarea, input, select, [contenteditable="true"], .cm-editor') || document.querySelector('.modal-fundo, .paleta-fundo')) return
      e.preventDefault(); e.stopPropagation()
      if (sel.size) { setConfirmar(true); return }
      if (aberta && window.confirm(`Mandar "${aberta.nome}" para a lixeira do vault? (dá para recuperar em .trash)`)) onApagar([aberta])
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [embutido, onApagar, sel, aberta])
  // arrastar na Criação: categoria sobre categoria muda a ordem; copy sobre copy muda a posição (ou a categoria)
  const [sobre, setSobre] = useState<string | null>(null)
  const [menuCor, setMenuCor] = useState<{ x: number; y: number; cat: string } | null>(null)
  const [renCat, setRenCat] = useState<string | null>(null)   // categoria sendo renomeada no menu
  const soltarCategoria = (de: string, para: string) => {
    if (de === para || !onCriacao) return
    const atual = categorias.map(([c]) => c).filter((c) => c !== de)
    const i = atual.indexOf(para)
    atual.splice(i < 0 ? atual.length : i, 0, de)
    onCriacao({ categorias: atual })
  }
  const soltarCopia = async (id: string, catOrigem: string, catAlvo: string, antesDe: string | null) => {
    if (!onCriacao) return
    const lista = (categorias.find(([c]) => c === catAlvo)?.[1] ?? []).map((it) => it.chave.slice(2)).filter((x) => x !== id)
    const i = antesDe ? lista.indexOf(antesDe) : -1
    lista.splice(i < 0 ? lista.length : i, 0, id)
    const mud: Partial<Criacao> = { ordem: { [catAlvo]: lista } }
    if (catOrigem !== catAlvo) {
      mud.ordem![catOrigem] = (categorias.find(([c]) => c === catOrigem)?.[1] ?? []).map((it) => it.chave.slice(2)).filter((x) => x !== id)
      const [raiz, ...resto] = id.split('/')
      await onCategoria?.({ raiz: raiz as Alvo['raiz'], nome: resto.join('/') }, catAlvo)
    }
    onCriacao(mud)
  }
  // aba Skills: as skills do vault (abrem numa aba da Redação, como as copies)
  const [skills, setSkills] = useState<{ nome: string; descricao: string; categoria: string; mtime: number }[] | null>(null)
  useEffect(() => { fetch('/api/skills', { cache: 'no-store' }).then((r) => r.json()).then(setSkills).catch(() => {}) }, [])
  type Item = { chave: string; nome: string; copias: Producao[] }   // uma nota por linha
  const categorias = useMemo(() => {
    if (t.pasta !== 'ideias') return [] as [string, Item[]][]
    const m = new Map<string, Item[]>()   // cada nota é uma linha (o agrupamento de versões saiu)
    for (const p of linhas) m.set(catDe(p), [...(m.get(catDe(p)) ?? []), { chave: `p:${p.raiz}/${p.nome}`, nome: p.nome, copias: [p] }])
    const ordemCats = criacao?.categorias ?? []
    const idxCat = (c: string) => { const i = ordemCats.indexOf(c); return i < 0 ? Infinity : i }
    // dentro da categoria, a ordem arrastada à mão vem primeiro; o resto segue a ordem da tabela
    for (const [c, l] of m) {
      const o = t.regras?.length ? [] : criacao?.ordem?.[c] ?? []   // com regras de ordenação, elas mandam
      if (!o.length) continue
      const idx = (it: Item) => { const i = o.indexOf(it.chave.slice(2)); return i < 0 ? Infinity : i }
      m.set(c, l.map((it, k) => ({ it, k })).sort((a, b) => idx(a.it) - idx(b.it) || a.k - b.k).map((x) => x.it))
    }
    return [...m.entries()]
      .sort((a, b) => idxCat(a[0]) - idxCat(b[0]) || (a[0] === 'Sem categoria' ? 1 : b[0] === 'Sem categoria' ? -1 : semEmoji(a[0]).localeCompare(semEmoji(b[0]))))
  }, [linhas, t.pasta, t.regras, criacao])

  // 📌 Priorizar é o pin: as pinadas da aba ficam sempre no topo, numa seção própria, sem filtro nem ordenação
  const idPin = (p: { raiz: string; nome: string }) => `p:${p.raiz}/${p.nome}`
  const pinadas = useMemo(() => {
    if (t.pasta === 'skills') return [] as Producao[]
    const por = new Map(daPasta.map((p) => [idPin(p), p]))
    // a categoria escolhida no menu vale também para as pinadas (os outros filtros não)
    const cats = embutido ? t.filtros?.categoria ?? [] : []
    return pins.map((id) => por.get(id)).filter((p): p is Producao => !!p && naCat(cats, p))
  }, [daPasta, pins, t.pasta, t.filtros?.categoria, embutido])
  const pinSet = useMemo(() => new Set(pinadas.map(idPin)), [pinadas])
  // uma categoria só com pinadas (o filtro escondeu as outras) também aparece
  const categoriasComPins = useMemo(() => {
    const tem = new Set(categorias.map(([c]) => c))
    const extra = [...new Set(pinadas.map(catDe))].filter((c) => !tem.has(c) && t.pasta === 'ideias')
    return [...categorias, ...extra.map((c) => [c, []] as [string, typeof categorias[number][1]])]
  }, [categorias, pinadas, t.pasta])
  const porFormato = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of base.filter((p) => !t.mes || dia(p).startsWith(t.mes))) c[p.formato || '📄'] = (c[p.formato || '📄'] ?? 0) + 1
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [base, t.mes])
  // Status e Categoria não são colunas da ordem do cabeçalho: o clique vira uma regra só (clicar de novo inverte)
  const ordenarPor = (campo: CampoOrdem) => mudar({ regras: [{ campo, asc: t.regras?.length === 1 && t.regras[0].campo === campo ? !t.regras[0].asc : true }] })
  const setaDe = (campo: CampoOrdem) => t.regras?.[0]?.campo === campo ? <span className="tabela-seta">{t.regras[0].asc ? '↑' : '↓'}</span> : null
  const ordenar = (col: Coluna) => mudar({ regras: [], ordem: { col, asc: t.ordem.col === col ? !t.ordem.asc : col === 'nome' || col === 'tags' } })
  const alternarFormato = (f: string) => mudar({ formatos: t.formatos.includes(f) ? t.formatos.filter((x) => x !== f) : [...t.formatos, f] })
  const filtrando = (!embutido && t.busca) || (embutido && nFiltros(t.filtros)) || (!embutido && t.formatos.length) || t.ano || t.mes
  const contagem = (k: StatusProd) => est.producoes.filter((p) => p.status === k).length
  const alvo = document.querySelector('section.pagina')
  type Galho = { nivel: number; n?: number; aberta?: boolean; alternar?: () => void }
  // duplo clique no nome renomeia ali mesmo (o emoji do começo fica; Enter ou sair do campo grava, Esc desiste)
  const [renomeando, setRenomeando] = useState<string | null>(null)
  const nomeOuCampo = (p: Producao) => {
    const resto = semEmoji(p.nome), prefixo = p.nome.slice(0, p.nome.length - resto.length)
    if (renomeando !== chaveDe(p)) return resto
    const gravar = (v: string) => { setRenomeando(null); const n = (prefixo + v.trim()).trim(); if (v.trim() && n !== p.nome) onRenomear?.({ raiz: p.raiz, nome: p.nome }, n) }
    return <input className="tabela-renomear" autoFocus defaultValue={resto} onFocus={(e) => e.target.select()} onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => gravar(e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } else if (e.key === 'Escape') { e.preventDefault(); setRenomeando(null) } }} />
  }
  // nas células de Status e Data só o seletor/campo segura o clique; o resto da célula abre a copy, como a linha toda
  const soControle = (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest('select, input, button')) e.stopPropagation() }
  const linha = (p: Producao, g?: Galho, pin = false) => (
                <tr key={`${p.raiz}/${p.nome}`} data-chave={chaveDe(p)} onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }} onClick={(e) => { if (engolirClique.current) return; if (e.shiftKey && onApagar) { selecionarAte(chaveDe(p)); return } ancora.current = chaveDe(p); if (!(e.metaKey || e.ctrlKey) && sel.size) setSel(new Set()); onAbrir({ raiz: p.raiz, nome: p.nome }, { nova: e.metaKey || e.ctrlKey }) }} tabIndex={0} className={`${pin ? 'is-pinada' : ''} ${sel.has(chaveDe(p)) ? 'is-sel' : ''} ${g?.nivel ? `tabela-nivel-${g.nivel}` : ''} ${aberta && aberta.raiz === p.raiz && aberta.nome === p.nome ? 'is-aberta' : ''} ${g?.nivel && criacao?.cores[catDe(p)] ? 'com-cor' : ''} ${sobre === `p:${p.raiz}/${p.nome}` ? 'is-sobre' : ''}`}
                  draggable onDragStart={(e) => { const ini = inicioArraste.current as HTMLElement | null; if ((onApagar && (!ini?.closest?.('.col-nome') || ini.matches?.('td.col-nome, td.col-formato, td.col-sel'))) || ini?.closest?.('input')) { e.preventDefault(); return } e.dataTransfer.setData('text/plain', `${p.raiz}\u0000${p.nome}`); e.dataTransfer.setData('neo/copia', JSON.stringify({ id: `${p.raiz}/${p.nome}`, cat: catDe(p) })); e.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={g?.nivel ? (e) => { if (e.dataTransfer.types.includes('neo/copia')) { e.preventDefault(); setSobre(`p:${p.raiz}/${p.nome}`) } } : undefined}
                  onDragLeave={g?.nivel ? () => setSobre(null) : undefined}
                  onDrop={g?.nivel ? (e) => { const d = e.dataTransfer.getData('neo/copia'); setSobre(null); if (!d) return; e.preventDefault(); const x = JSON.parse(d); soltarCopia(x.id, x.cat, catDe(p), `${p.raiz}/${p.nome}`) } : undefined}
                  style={g?.nivel && criacao?.cores[catDe(p)] ? { '--cor-cat': criacao.cores[catDe(p)] } as React.CSSProperties : undefined}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 280), p: { raiz: p.raiz, nome: p.nome } }) }}
                  onKeyDown={(e) => e.key === 'Enter' && onAbrir({ raiz: p.raiz, nome: p.nome })}>
                  {comCaixa && <td className="col-sel" onClick={(e) => { e.stopPropagation(); alternar(chaveDe(p)) }}>
                    <input type="checkbox" aria-label={`Marcar ${p.nome}`} checked={sel.has(chaveDe(p))} onChange={() => {}} /></td>}
                  <td className="col-formato">{!g?.nivel && (p.formato || '📄')}</td>
                  <td className="col-nome" onDoubleClick={onRenomear ? (e) => { e.stopPropagation(); setRenomeando(chaveDe(p)) } : undefined}>{g?.nivel ? <div className="tabela-galho">
                    {g.nivel === 1 && g.n ? (g.n ? <button className={`tabela-seta-grupo ${g.aberta ? 'is-aberta' : ''}`} aria-label={g.aberta ? 'Fechar as copies' : `Mostrar ${g.n} copies`} onClick={(e) => { e.stopPropagation(); g.alternar?.() }}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button> : <span className="tabela-seta-grupo is-vazia" />)
                      : <i className={`ponto is-${p.status}`} title={STATUS.find((x) => x.k === p.status)?.nome} />}
                    <div><b>{pin && <span className="tabela-pin" title="Priorizada (botão direito → Tirar de Priorizar)">📌</span>}<span className="tabela-ic">{p.formato || '📄'}</span>{nomeOuCampo(p)}{g.nivel === 1 && g.n ? <em className="tabela-n">{g.n}</em> : null}</b>{!embutido && p.previa && <span>{p.previa}</span>}</div></div>
                    : <><b>{nomeOuCampo(p)}{pin && <span className="tabela-pin" title="Priorizada (botão direito → Tirar de Priorizar)">📌</span>}</b>{!embutido && p.previa && <span>{p.previa}</span>}</>}</td>

                  {embutido && <td className="col-status" onClick={soControle}>
                    {onStatus ? <select className={`tabela-status-sel is-${p.status}`} value={p.status} onChange={(e) => onStatus([{ raiz: p.raiz, nome: p.nome }], e.target.value as StatusProd)}>
                      {STATUS.map((x) => <option key={x.k} value={x.k}>{x.marca} {x.nome}</option>)}</select> : <Status p={p} />}</td>}
                  {embutido && onData ? <td className="col-data" onClick={soControle}>
                    <input type="date" className={`tabela-data-in ${p.scheduled ? '' : 'is-vazia'}`} value={(p.scheduled ?? '').slice(0, 10)} title="Mudar a data (scheduled)"
                      onChange={(e) => { if (/^2\d{3}-/.test(e.target.value)) onData({ raiz: p.raiz, nome: p.nome }, e.target.value) }} /></td>
                  : <td className="col-data">{(p.datas?.length ?? 0) > 1 ? <span title={`Postada ${p.datas!.length} vezes`}>{p.datas!.map(dataBr).join(' · ')}</span>
                    : p.scheduled ? dataBr(p.scheduled.slice(0, 10)) : t.pasta === 'winner' ? <span className="mudo" title="Sem data de postagem (scheduled vazio)">sem data</span> : <span className="mudo">{dataBr(dia(p))}</span>}</td>}
                  <td className="col-tags" onClick={onTags ? (e) => e.stopPropagation() : undefined}>
                    <CelulaTags tags={p.tags ?? []} sugestoes={todasTags} onMudar={onTags && ((l) => onTags({ raiz: p.raiz, nome: p.nome }, l))} /></td>
                  <td className="col-palavras">{p.palavras || <span className="mudo">0</span>}</td>
                  <td className="col-mtime">{relativo(p.mtime)}</td>
                </tr>
  )

  const corpo = (
    <div className={embutido ? 'tabela-embutida-fundo' : 'modal-fundo'} onMouseDown={(e) => !embutido && e.target === e.currentTarget && onFechar()}>
      <div className={`modal-nota modal-tabela glass glass--light ${embutido ? 'tabela-embutida' : ''} ${compacto ? 'tabela-compacta' : ''} ${semColunas ? 'tabela-sem-colunas' : ''}`} role={embutido ? undefined : 'dialog'} aria-label="Tabela de copies">
        <header className="modal-tabs">
          <nav role="tablist">
            {/* Criação · Gravar | Em edição · Agendado · Publicados (Skills é página da navbar; o Calendário fica na navbar, à direita) */}
            {(() => {
              const aba = (k: Pasta, rotulo: string, n: number | null, ic: React.ReactNode, titulo?: string) => (
                <button key={k} role="tab" aria-selected={t.pasta === k} className={`modal-tab ${t.pasta === k ? 'is-ativa' : ''}`} onClick={() => onMudar(tabelaSalva(k))} title={titulo ?? rotulo} aria-label={rotulo}>
                  {ic}<span>{rotulo}</span>{n !== null && <em className="tabela-n">{n}</em>}</button>)
              const sep = (k: string) => <span key={k} className="modal-tab-sep" aria-hidden="true" />
              const ponto = (k: StatusProd) => <span className="tabela-fogo">{STATUS.find((x) => x.k === k)?.marca}</span>
              return [
                aba('ideias', 'Criação', ideiasDoCanvas.length, <span className="tabela-fogo">💡</span>, 'As copies por categoria (as arquivadas ficam de fora)'),
                aba('gravar', 'Gravar', contagem('gravar'), ponto('gravar')),
                sep('s1'),
                aba('edicao', 'Em edição', contagem('edicao'), ponto('edicao')),
                aba('agendado', 'Agendado', contagem('agendado'), ponto('agendado')),
                aba('publicado', 'Publicados', contagem('publicado'), ponto('publicado')),
              ]
            })()}
          </nav>
          {extra}
          {!embutido && <button className="btn-icone" onClick={onFechar} aria-label="Fechar" title="Fechar (esc)"><Icone n="fechar" t={16} /></button>}
        </header>

        <div className="tabela-corpo">
        {embutido && !semCategorias && t.pasta !== 'skills' && <MenuCategorias renomear={renCat} onRenomear={(de, para) => { setRenCat(null); if (para && para !== de) onRenomearCategoria?.(de, para) }} lista={todasCategorias.filter((c) => !arquivadas.includes(c))} arquivadas={arquivadas.filter((c) => todasCategorias.includes(c))} contagem={contagemCat} nPins={daPasta.filter((p) => pinsSet.has(`p:${p.raiz}/${p.nome}`)).length} total={daPasta.length} sel={t.filtros?.categoria ?? []}
          cores={criacao?.cores ?? {}} onSel={(l) => mudar({ filtros: { ...t.filtros, categoria: l } })}
          onSoltar={(d, cat) => { const x = JSON.parse(d) as { id: string }; const ids = sel.has(x.id) ? [...sel] : [x.id]
            if (cat === PIN) { for (const id of ids) alternarPin(`p:${id}`, true); return }
            for (const id of ids) { const [raiz, ...resto] = id.split('/'); onCategoria?.({ raiz: raiz as Alvo['raiz'], nome: resto.join('/') }, cat === SEM ? '' : cat) } }}
          onOrdem={(de, para) => { const l = todasCategorias.filter((c) => c !== de); const i = l.indexOf(para); l.splice(i < 0 ? l.length : i, 0, de); onCriacao?.({ categorias: l }) }}
          onCriar={(n) => { if (!todasCategorias.includes(n)) onCriacao?.({ categorias: [...todasCategorias, n] }); mudar({ filtros: { ...t.filtros, categoria: [n] } }) }}
          onDivisor={() => onCriacao?.({ categorias: [...todasCategorias, `—${Date.now().toString(36)}`] })}
          onTirar={(d) => onCriacao?.({ categorias: todasCategorias.filter((c) => c !== d) })}
          onMenu={(cat, x, y) => setMenuCor({ x: Math.min(x, window.innerWidth - 230), y: Math.min(y, window.innerHeight - 220), cat })} />}
        <div className="tabela-coluna">
        <section className="tabela-filtros">
          {embutido && <button className="tabela-canvas tabela-nova" onClick={() => window.dispatchEvent(new Event('nova-copy'))} title="Copy nova: nasce como Ideia e aparece na Criação (⌘I)">+ Nova copy <kbd>⌘I</kbd></button>}
          {embutido && <FiltroRedacao f={t.filtros ?? {}} onMudar={(filtros) => mudar({ filtros })} />}
          {!embutido && <label className="tabela-busca"><Icone n="busca" t={13} /><input value={t.busca} onChange={(e) => mudar({ busca: e.target.value })} placeholder="Buscar copy, produção ou texto" autoFocus /></label>}
          {!embutido && <FiltroFormatos lista={porFormato} on={t.formatos} nomes={Object.fromEntries((est.formatos ?? []).map((f) => [f.emoji, f.nome]))}
            onAlternar={alternarFormato} onLimpar={() => mudar({ formatos: [] })} />}
          <Ordenacao regras={t.regras ?? []} onMudar={(regras) => mudar({ regras })} />
          {anos.length > 1 && (
            <select className="tabela-select" value={t.ano} onChange={(e) => mudar({ ano: e.target.value, mes: '' })}>
              <option value="">Todos os anos</option>{anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {t.pasta === 'ideias' && categorias.length > 0 && !umaCat && (() => {
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
          {filtrando ? <button className="tabela-limpar" onClick={() => mudar({ busca: '', formatos: [], ano: '', mes: '' })}>Limpar filtros</button> : null}
        </section>

        <div className="tabela-rolo" ref={rolo} onPointerDown={comecarLaco} onScroll={(e) => guardar(t.pasta, { rolagem: e.currentTarget.scrollTop })}>
          {laco && <div className="tabela-laco" style={{ left: laco.x, top: laco.y, width: laco.w, height: laco.h }} />}
          <table className={`tabela ${umaCat ? 'sem-grupo' : ''}`} style={embutido && !semColunas ? { minWidth: (comCaixa ? 36 : 0) + 34 + largDe('nome') + largDe('status') + largDe('data') } : undefined}>
            <thead>
              <tr>{comCaixa && <th className="col-sel" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label="Marcar todas as linhas" checked={linhas.length > 0 && linhas.every((p) => sel.has(chaveDe(p)))}
                  onChange={(e) => setSel(e.target.checked ? new Set(linhas.map(chaveDe)) : new Set())} /></th>}
                {(Object.keys(ROTULO_COL) as Coluna[]).map((c) => (
                <Fragment key={c}><th className={`col-${c}`} style={embutido && c === 'nome' ? { width: largDe(c) } : undefined} onClick={() => ordenar(c)} aria-sort={t.ordem.col === c ? (t.ordem.asc ? 'ascending' : 'descending') : 'none'}>
                  {embutido && c === 'nome' && <i className="tabela-alca" onPointerDown={redimensionar(c)} onClick={(e) => e.stopPropagation()} />}{ROTULO_COL[c]}{!t.regras?.length && t.ordem.col === c && <span className="tabela-seta">{t.ordem.asc ? '↑' : '↓'}</span>}
                </th>{c === 'nome' && embutido && <th className="col-status" style={{ width: largDe('status') }} onClick={() => ordenarPor('status')}><i className="tabela-alca" onPointerDown={redimensionar('status')} onClick={(e) => e.stopPropagation()} />Status{setaDe('status')}</th>}</Fragment>
              ))}</tr>
            </thead>
            <tbody>
              {t.pasta === 'skills' ? (skills ?? []).filter((k) => !t.busca.trim() || `${k.nome} ${k.descricao}`.toLowerCase().includes(t.busca.trim().toLowerCase())).map((k) => (
                <tr key={k.nome} onClick={(e) => onAbrir({ raiz: 'skills', nome: k.nome } as Alvo, { nova: e.metaKey || e.ctrlKey })}
                  className={aberta && aberta.raiz === 'skills' && aberta.nome === k.nome ? 'is-aberta' : ''}>
                  {comCaixa && <td className="col-sel" />}
                  <td className="col-formato">🧰</td>
                  <td className="col-nome"><b>{k.nome}</b>{k.descricao && <span>{k.descricao}</span>}</td>
                  {embutido && <td className="col-status" />}
                  <td className="col-data"><span className="mudo">{relativo(k.mtime)}</span></td>
                  <td className="col-tags" /><td className="col-palavras" /><td className="col-mtime" />
                </tr>
              ))
              : [
                // pinadas: no topo da própria categoria (ou da lista), destacadas, com um traço separando das demais
                ...(t.pasta !== 'ideias' && pinadas.length ? [...pinadas.map((p) => linha(p, undefined, true)),
                  <tr key="pin:sep" className="tabela-sep-pin" aria-hidden="true"><td colSpan={nCols} /></tr>] : []),
                ...(t.pasta !== 'ideias' ? linhas.filter((p) => !pinSet.has(idPin(p))).map((p) => linha(p)) : categoriasComPins.map(([cat, ideiasTodas]) => {
                const ideias = ideiasTodas.filter((i) => !pinSet.has(idPin(i.copias[0])))
                const pinCat = pinadas.filter((p) => catDe(p) === cat)
                if (!ideias.length && !pinCat.length) return null
                const aberta = catAbertas.has(cat) || (!embutido && !!t.busca.trim()) || nFiltros(t.filtros) > 0
                const todas = [...pinCat, ...ideias.flatMap((i) => i.copias)]
                // uma categoria escolhida no menu: o cabeçalho dela seria redundante, vão direto as copies
                if (umaCat) return [...pinCat.map((p) => linha(p, { nivel: 1 }, true)),
                  ...(pinCat.length && ideias.length ? [<tr key={`pin:sep:${cat}`} className="tabela-sep-pin" aria-hidden="true"><td colSpan={nCols} /></tr>] : []),
                  ...ideias.map((i) => linha(i.copias[0], { nivel: 1 }))]
                return [
                  <tr key={`cat:${cat}`} className={`tabela-grupo is-cat ${criacao?.cores[cat] ? 'com-cor' : ''} ${sobre === `c:${cat}` ? 'is-sobre' : ''}`} onClick={() => trocar(setCatAbertas, cat)}
                    style={criacao?.cores[cat] ? { '--cor-cat': criacao.cores[cat] } as React.CSSProperties : undefined}
                    draggable={cat !== 'Sem categoria'} onDragStart={(e) => { e.dataTransfer.setData('neo/categoria', cat); e.dataTransfer.effectAllowed = 'move' }}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes('neo/categoria') || e.dataTransfer.types.includes('neo/copia')) { e.preventDefault(); setSobre(`c:${cat}`) } }}
                    onDragLeave={() => setSobre(null)}
                    onDrop={(e) => { setSobre(null); const c = e.dataTransfer.getData('neo/categoria'); const d = e.dataTransfer.getData('neo/copia'); e.preventDefault()
                      if (c) soltarCategoria(c, cat); else if (d) { const x = JSON.parse(d); soltarCopia(x.id, x.cat, cat, null) } }}
                    onContextMenu={(e) => { if (!onCriacao || cat === 'Sem categoria') return; e.preventDefault(); setMenuCor({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 160), cat }) }}>
                    {comCaixa && <td className="col-sel" />}
                    <td className="col-formato"><span className={`tabela-seta-grupo ${aberta ? 'is-aberta' : ''}`}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span></td>
                    <td className="col-nome"><b>{cat}</b><span>{todas.length} {todas.length === 1 ? 'copy' : 'copies'}</span></td>
                    {embutido && <td className="col-status" />}<td className="col-data" /><td className="col-tags" />
                    <td className="col-palavras" /><td className="col-mtime" />
                  </tr>,
                  ...(aberta ? [...pinCat.map((p) => linha(p, { nivel: 1 }, true)),
                    ...(pinCat.length && ideias.length ? [<tr key={`pin:sep:${cat}`} className="tabela-sep-pin" aria-hidden="true"><td colSpan={nCols} /></tr>] : []),
                    ...ideias.map((i) => linha(i.copias[0], { nivel: 1 }))] : []),
                ]
              })),
                // Criação: no fim, as publicadas (que já passaram por aqui), atrás de um botão e de um traço
                ...(t.pasta === 'ideias' && embutido && publicadasCriacao.length ? [
                  <tr key="pub:botao" className="tabela-pub-botao"><td colSpan={nCols}>
                    <button onClick={() => setVerPub((v) => !v)}>{verPub ? 'Esconder publicados' : `Mostrar publicados (${publicadasCriacao.length})`}</button></td></tr>,
                  ...(verPub ? [<tr key="pub:sep" className="tabela-pub-sep" aria-hidden="true"><td colSpan={nCols}><span>✅ Publicados</span></td></tr>,
                    ...publicadasCriacao.map((p) => linha(p))] : []),
                ] : []),
              ]}
            </tbody>
          </table>
          {!linhas.length && !pinadas.length && <p className="tabela-vazia">Nenhuma copy com esses filtros.</p>}
        </div>
        </div>
        </div>
        {menuCor && createPortal(
          <div className="tabela-menu tabela-cores glass glass--light" style={{ left: menuCor.x, top: menuCor.y }} role="menu" onMouseLeave={() => setMenuCor(null)}>
            {onRenomearCategoria && <button onClick={() => { setRenCat(menuCor.cat); setMenuCor(null) }}>✏️ Renomear</button>}
            {(() => { const c = menuCor.cat, sim = arquivadas.includes(c)
              return <button onClick={() => { setMenuCor(null); onCriacao?.({ arquivadas: sim ? arquivadas.filter((x) => x !== c) : [...arquivadas, c] })
                if (!sim && t.filtros?.categoria?.includes(c)) mudar({ filtros: { ...t.filtros, categoria: t.filtros.categoria.filter((x) => x !== c) } }) }}>
                {sim ? '📤 Desarquivar' : '🗄️ Arquivar'}</button> })()}
            {!est.producoes.some((p) => p.categoria === menuCor.cat) && <button className="is-perigo" onClick={() => { const c = menuCor.cat; setMenuCor(null); onCriacao?.({ categorias: todasCategorias.filter((x) => x !== c) }) }}>Apagar (vazia)</button>}
            <hr />
            <p className="tabela-menu-t">Cor</p>
            <div className="tabela-cores-grade">
              {PASTEIS.map((c) => <button key={c} className={criacao?.cores[menuCor.cat] === c ? 'is-on' : ''} style={{ background: c }} title={c}
                onClick={() => { onCriacao?.({ cores: { [menuCor.cat]: c } }); setMenuCor(null) }} />)}
              <button className={`tabela-sem-cor ${criacao?.cores[menuCor.cat] ? '' : 'is-on'}`} title="Sem cor" aria-label="Sem cor"
                onClick={() => { onCriacao?.({ cores: { [menuCor.cat]: '' } }); setMenuCor(null) }} />
            </div>
          </div>, document.body)}
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
              {(() => { const id = idPin(menu.p), sim = pins.includes(id)
                return <button onClick={() => { setMenu(null); alternarPin(id, !sim) }}>📌 {sim ? 'Tirar de Priorizar' : 'Priorizar'}</button> })()}
              {onRenomear && <button onClick={() => setMenu({ ...menu, renomear: menu.p.nome })}>✏️ Renomear</button>}
              {onArquivar && (() => { const p0 = est.producoes.find((x) => x.raiz === menu.p.raiz && x.nome === menu.p.nome); return p0 && (
                <button onClick={async () => { const a = menu.p; setMenu(null); await onArquivar(a, !p0.arquivado) }}>{p0.arquivado ? '📤 Desarquivar' : '🗄️ Arquivar'}</button>) })()}
              <hr />
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
  const [sug, setSug] = useState(false)   // as sugestões só aparecem depois de clicar no campo (ou digitar)
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
      <input className="menu-tags-campo" value={txt} placeholder="Atribuir tag…" aria-label="Atribuir tag" onClick={() => setSug(true)} onChange={(e) => { setTxt(e.target.value); setSug(true) }}
        onKeyDown={(e) => { e.stopPropagation(); if ((e.key === 'Enter' || e.key === ',') && limpa(txt)) { e.preventDefault(); por(txt) } }} />
    </div>
    {sug && opcoes.length > 0 && <div className="menu-tags-sug">{opcoes.map((x) => <button key={x} className="tabela-tag" onClick={() => por(x)}>{x}</button>)}</div>}
  </>
}


/** Os tipos de conteúdo (formatos) num dropdown só: o botão mostra os escolhidos; o menu tem uma caixinha por formato. */
/** Botão Filtrar (Redação): um clique liga/desliga cada opção; dentro de um grupo vale qualquer uma, entre grupos todas. */
function FiltroRedacao({ f, onMudar }: { f: Filtros; onMudar: (f: Filtros) => void }) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAberto(false) } }
    window.addEventListener('pointerdown', fora, true); window.addEventListener('keydown', esc, true)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('keydown', esc, true) }
  }, [aberto])
  const n = nFiltros(f)
  const alt = (k: 'status' | 'categoria', v: string) => { const l = f[k] ?? []; onMudar({ ...f, [k]: l.includes(v) ? l.filter((x) => x !== v) : [...l, v] }) }
  const chip = (on: boolean, rotulo: string, fn: () => void, key: string) => <button key={key} className={`tabela-chip ${on ? 'is-on' : ''}`} onClick={fn}>{rotulo}</button>
  return (
    <div className="tabela-fmt" ref={caixa}>
      <button className={`tabela-canvas ${n ? 'is-on' : ''}`} onClick={() => setAberto((v) => !v)} aria-expanded={aberto} title="Filtrar as copies">
        <Icone n="busca" t={12} /> {n ? `Filtro (${n})` : 'Filtrar'}</button>
      {aberto && (
        <div className="tabela-fmt-menu tabela-filtro-menu glass glass--light" role="dialog" aria-label="Filtrar">
          <p className="tabela-filtro-t">Status</p>
          <div className="tabela-chips">{STATUS.map((x) => chip(!!f.status?.includes(x.k), `${x.marca} ${x.nome}`, () => alt('status', x.k), x.k))}</div>
          <p className="tabela-filtro-t">Data</p>
          <div className="tabela-chips">{([['com', '📅 Com data'], ['sem', 'Sem data']] as const).map(([k, r]) => chip(f.data === k, r, () => onMudar({ ...f, data: f.data === k ? '' : k }), k))}</div>
          {n > 0 && <><hr /><button className="tabela-fmt-item" onClick={() => onMudar({})}>Limpar filtros</button></>}
        </div>
      )}
    </div>
  )
}

/** Botão ⇅: regras de ordenação em sequência (campo + direção), como no Notion. */
function Ordenacao({ regras, onMudar }: { regras: Regra[]; onMudar: (r: Regra[]) => void }) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAberto(false) } }
    window.addEventListener('pointerdown', fora, true); window.addEventListener('keydown', esc, true)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('keydown', esc, true) }
  }, [aberto])
  // um clique por campo: sem regra → ↑ crescente → ↓ decrescente → sai. A ordem dos cliques é a ordem das regras
  const clicar = (c: CampoOrdem) => {
    const i = regras.findIndex((r) => r.campo === c)
    if (i < 0) onMudar([...regras, { campo: c, asc: true }])
    else if (regras[i].asc) onMudar(regras.map((r, k) => (k === i ? { ...r, asc: false } : r)))
    else onMudar(regras.filter((_, k) => k !== i))
  }
  const rotulo = regras.length ? regras.map((r) => `${CAMPOS.find(([c]) => c === r.campo)?.[1]} ${r.asc ? '↑' : '↓'}`).join(', ') : 'Ordenar'
  return (
    <div className="tabela-fmt" ref={caixa}>
      <button className={`tabela-canvas ${regras.length ? 'is-on' : ''}`} onClick={() => setAberto((v) => !v)} aria-expanded={aberto}
        title="Regras de ordenação">⇅ {rotulo}</button>
      {aberto && (
        <div className="tabela-fmt-menu tabela-ordem-menu glass glass--light" role="menu" aria-label="Regras de ordenação">
          <p className="mudo tabela-ordem-dica">Clique: ↑, de novo ↓, de novo tira. A ordem dos cliques é a prioridade.</p>
          {CAMPOS.map(([c, nome]) => {
            const i = regras.findIndex((r) => r.campo === c), r = regras[i]
            return (
              <button key={c} role="menuitem" className={`tabela-fmt-item tabela-ordem-item ${r ? 'is-on' : ''}`} onClick={() => clicar(c)}>
                <i className="tabela-ordem-n">{r ? i + 1 : ''}</i><span>{nome}</span><em>{r ? (r.asc ? '↑ crescente' : '↓ decrescente') : ''}</em>
              </button>
            )
          })}
          {regras.length > 0 && <><hr /><button className="tabela-fmt-item" onClick={() => onMudar([])}>Limpar (volta à ordem do cabeçalho)</button></>}
        </div>
      )}
    </div>
  )
}

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

