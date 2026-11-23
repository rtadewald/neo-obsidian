import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { NovoFormato } from './NovoFormato'
import { MenuCategorias, PASTEIS, PIN, SEM, arquivadaCat, ehDivisor, ehSeparador, idGrupo, listaCategorias, nomeDivisor, rotuloCat, usePinsMenu, type ModeloCats, type TipoCat } from './Categorias'
import { alternarPin, usePins } from './pins'
import { FIM, ORDEM_FORMATO, STATUS, familia, slotsFormatos, type Alvo, type EstadoCanvas, type Producao, type StatusProd } from './canvasApi'

/** A tabela das copies da Redação: abas (Criação por categoria, Gravar, Em edição, Agendado, Publicados), menu de
 *  categorias à esquerda, filtros, ordenação e o botão direito. Clicar numa linha abre a copy ao lado. */

type Coluna = 'formato' | 'nome' | 'data'
/** 'ideias' é a Criação (as copies por categoria, sem as arquivadas). */
type Pasta = StatusProd | 'ideias'
export type EstadoTabela = {
  pasta: Pasta; busca: string; formatos: string[]; ano: string; mes: string; grupo: string   // busca, formatos, mes e grupo: legado (guardados no localStorage)
  ordem: { col: Coluna; asc: boolean }
  filtros?: Filtros   // botão Filtrar: status, categoria e data; vazio = tudo
  regras?: Regra[]   // ordenação por regras (botão ⇅): valem em sequência e passam por cima da ordem do cabeçalho
}
type Filtros = { status?: string[]; categoria?: string[]; data?: '' | 'com' | 'sem' }
const nFiltros = (f?: Filtros) => (f?.status?.length ?? 0) + (f?.categoria?.length ?? 0) + (f?.data ? 1 : 0)
type CampoOrdem = 'nome' | 'status' | 'categoria' | 'data' | 'mtime' | 'palavras' | 'formato' | 'tags' | 'formatos'
type Regra = { campo: CampoOrdem; asc: boolean }
const CAMPOS: [CampoOrdem, string][] = [['nome', 'Nome'], ['status', 'Status'], ['categoria', 'Coleção'], ['data', 'Data'],
  ['mtime', 'Editada'], ['palavras', 'Palavras'], ['formato', 'Formato'], ['tags', 'Tags']]
const tabelaNova = (pasta: Pasta): EstadoTabela => ({
  pasta, busca: '', formatos: [], ano: '', mes: '', grupo: '',
  ordem: { col: pasta === 'edicao' ? 'mtime' as Coluna : 'data', asc: pasta === 'agendado' },
})

/** A tabela guarda o estado de quando saiu (por pasta): filtros, ordem, categorias abertas e a rolagem. */
const CHAVE = 'tabela-estado'
type Guardado = { t: EstadoTabela; cats: string[]; rolagem: number }
const guardadas: Record<string, Guardado> = (() => { try { return JSON.parse(localStorage.getItem(CHAVE) || '{}') } catch { return {} } })()
let guardarId = 0
const guardar = (pasta: string, g: Partial<Guardado>) => {
  guardadas[pasta] = { ...(guardadas[pasta] ?? { t: tabelaNova(pasta as Pasta), cats: [], rolagem: 0 }), ...g }
  // a rolagem chama isto a cada quadro: o localStorage grava uma vez, depois de parar
  window.clearTimeout(guardarId)
  guardarId = window.setTimeout(() => { try { localStorage.setItem(CHAVE, JSON.stringify(guardadas)) } catch { /* sem storage */ } }, 300)
}
/** Abre a pasta como ela estava quando o Rodrigo saiu (ou nova, na primeira vez). */
export const tabelaSalva = (pasta: Pasta): EstadoTabela => guardadas[pasta]?.t ?? tabelaNova(pasta)

export type Criacao = { cores: Record<string, string>; icones?: Record<string, string>; tipos?: Record<string, string>; projetos?: Record<string, string[]>; categorias: string[]; ordem: Record<string, string[]>; arquivadas?: string[] }
/** Os grupos da Criação, pelo ícone (formato) do nome da copy. */
const GRUPO_FORMATO: Record<string, string> = { '📱': '📱 Reels', '📝': '📱 Reels', '🏞️': '📱 Reels', '🏞': '📱 Reels', '💻': '📱 Reels', '🗣️': '📱 Reels', '🗣': '📱 Reels', '🎥': '🎥 YouTube', '📚': '📚 Aula', '💰': '💰 Ad', '📜': '💰 Ad', '🎣': '💰 Ad', '📺': '📺 VSL' }

const dia = (p: Producao) => (p.scheduled ?? '').slice(0, 10) || new Date((p.criado ?? p.mtime) * 1000).toISOString().slice(0, 10)
/** Só a data agendada (`scheduled`): para ordenar por Data, as sem data vão sempre para o fim. */
const agendada = (p: Producao) => (p.scheduled ?? '').slice(0, 10)
const semEmoji = (n: string) => n.replace(/^[^\p{L}\p{N}]+/u, '')
const ROTULO_COL: Record<Coluna, string> = { formato: '', nome: 'Copy', data: 'Data' }
/** Colunas que dá para mostrar depois da Copy (botão Colunas: escolher e arrastar a ordem; fica no localStorage). */
type ColExtra = 'data' | 'status' | 'categoria' | 'tags' | 'palavras' | 'mtime' | 'formatos'
const COLS_EXTRA: Record<ColExtra, string> = { data: 'Data', status: 'Status', categoria: 'Coleção', tags: 'Tags', palavras: 'Palavras', mtime: 'Editada', formatos: 'Formatos' }
/** Coluna Formatos: os formatos da mesma copy (a família é o nome sem o emoji e sem "VSL - ", "LP - ", "ISCA - "). */
/** As colunas são escolhidas por modo: vendo um status (lista corrida) ou vendo as categorias (grupos); cada um guarda as suas. */
type ModoCols = 'status' | 'categorias'
const COLS_PADRAO: Record<ModoCols, ColExtra[]> = { status: ['data', 'categoria'], categorias: ['data', 'status'] }
const lerCols = (): Record<ModoCols, ColExtra[]> => {
  const ok = (l: unknown): ColExtra[] | null => (Array.isArray(l) ? l.filter((c) => c in COLS_EXTRA) : null)
  try {
    const d = JSON.parse(localStorage.getItem('tabela-colunas-modo') || 'null')
    if (d) return { status: ok(d.status) ?? COLS_PADRAO.status, categorias: ok(d.categorias) ?? COLS_PADRAO.categorias }
    const antigo = ok(JSON.parse(localStorage.getItem('tabela-colunas') || 'null'))   // a escolha de antes (uma só) vira a das duas
    return antigo ? { status: antigo.filter((c) => c !== 'status'), categorias: antigo } : COLS_PADRAO
  } catch { return COLS_PADRAO }
}
const chaveDe = (p: { raiz: string; nome: string }) => `${p.raiz}/${p.nome}`
const idPin = (p: { raiz: string; nome: string }) => `p:${p.raiz}/${p.nome}`
const catDe = (p: Producao) => p.categoria || 'Sem categoria'   // os grupos da Criação são as categorias (categoria: da copy)
const SETA = <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>

/** Muda o lugar de uma categoria ou de um grupo na lista. Um grupo (divisor) leva as categorias dele junto e cai antes ou
 *  depois do bloco inteiro do grupo de destino (nunca no meio de outro grupo). */
export function moverNaLista(lista: string[], de: string, para: string, depois: boolean): string[] {
  const bloco = (l: string[], d: string) => { const i = l.indexOf(d), fim = l.slice(i + 1).findIndex(ehDivisor); return l.slice(i, fim < 0 ? undefined : i + 1 + fim) }
  if (!ehDivisor(de)) {
    const l = lista.filter((c) => c !== de); const i = l.indexOf(para)
    l.splice(i < 0 ? l.length : i + (depois ? 1 : 0), 0, de)
    return l
  }
  const meu = bloco(lista, de)
  if (meu.includes(para)) return lista   // soltou dentro do próprio grupo
  const resto = lista.filter((c) => !meu.includes(c))
  // o grupo de destino: o próprio divisor ou o grupo da categoria onde soltou (sem grupo: o lugar dela)
  const alvo = ehDivisor(para) ? para : [...resto.slice(0, resto.indexOf(para) + 1)].reverse().find(ehDivisor)
  let i: number
  if (!alvo) i = depois ? resto.indexOf(para) + 1 : resto.indexOf(para)
  else { const b = bloco(resto, alvo); i = resto.indexOf(alvo) + (depois || !ehDivisor(para) ? b.length : 0) }
  resto.splice(Math.max(0, i), 0, ...meu)
  return resto
}

export function ModalTabela({ est, t, onMudar, onAbrir, onApagar, onStatus, onRenomear, onTags, onNova, criacao, onCriacao, onCategoria, onRenomearCategoria, compacto, semColunas, semCategorias, aberta, extra, onData }: {
  compacto?: boolean   // modo copy (nota aberta ao lado): classe tabela-compacta
  semCategorias?: boolean   // ⌘[ esconde o menu de categorias
  semColunas?: boolean   // ⌘] esconde Status e Data (modo copy)
  aberta?: Alvo | null   // a nota aberta ao lado (linha destacada)
  extra?: React.ReactNode   // botões a mais no topo (o calendário)
  onData: (alvo: Alvo, data: string) => Promise<void>   // a data da copy editada na célula
  onNova?: (alvo: Alvo, sim: boolean) => Promise<void>   // botão direito → Marcar como new / Tirar o new
  criacao: Criacao   // cor e ordem das categorias e das copies na Criação (dados/criacao.json)
  onCriacao: (m: Partial<Criacao>) => void
  onRenomearCategoria: (de: string, para: string) => Promise<void>
  onCategoria: (alvo: Alvo, categoria: string) => Promise<void>   // arrastar uma copy para outra categoria
  est: EstadoCanvas; t: EstadoTabela; onMudar: (t: EstadoTabela) => void
  onAbrir: (a: Alvo, opts?: { nova?: boolean }) => void
  onApagar: (alvos: Alvo[]) => Promise<void>   // seleção múltipla → lixeira do vault
  onStatus: (alvos: Alvo[], status: StatusProd) => Promise<void>
  onRenomear: (alvo: Alvo, novo: string) => Promise<void>
  onTags: (alvo: Alvo, tags: string[]) => Promise<void>
}) {
  // as tags do vault, das mais usadas para as menos (é a ordem das sugestões no botão direito)
  const todasTags = useMemo(() => {
    const c = new Map<string, number>()
    for (const t of est.producoes.flatMap((p) => p.tags ?? []).filter((t) => t.trim())) c.set(t, (c.get(t) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
  }, [est])
  // botão direito numa linha: priorizar, renomear, arquivar, tags, status, deletar
  const [menu, setMenu] = useState<{ x: number; y: number; p: Alvo; renomear?: string; apagar?: boolean } | null>(null)
  const pins = usePins()
  const pinsSet = useMemo(() => new Set(pins), [pins])
  // filtro de categoria: a categoria da copy ou, com 📌 Pinados escolhido, ser pinada
  const naCat = (cats: string[], p: Producao) => !cats.length || cats.includes(p.categoria ?? '') || (cats.includes(PIN) && pinsSet.has(idPin(p)))
  // o menu cabe na tela: se passar da borda de baixo (ou da direita), sobe (ou vai para a esquerda)
  const refMenu = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = refMenu.current
    if (!el || !menu) return
    const r = el.getBoundingClientRect()
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)), x = Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8))
    if (y !== menu.y || x !== menu.x) setMenu({ ...menu, x, y })
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const fora = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.tabela-menu')) setMenu(null) }
    window.addEventListener('mousedown', fora)
    return () => window.removeEventListener('mousedown', fora)
  }, [menu])
  const mudar = (m: Partial<EstadoTabela>) => onMudar({ ...t, ...m })
  // seleção múltipla (some ao trocar de aba)
  const [sel, setSel] = useState<Set<string>>(() => new Set())
  const selRef = useRef(sel); selRef.current = sel
  const [confirmar, setConfirmar] = useState(false)
  const [apagando, setApagando] = useState(false)
  const [pastaSel, setPastaSel] = useState(t.pasta)
  if (pastaSel !== t.pasta) { setPastaSel(t.pasta); setSel(new Set()); setConfirmar(false) }
  // ⇧+clique: seleciona da última linha clicada (a âncora) até esta, na ordem em que aparecem na tabela
  const ancora = useRef<string | null>(null)
  const selecionarAte = (k: string) => {
    const ordem = [...(rolo.current?.querySelectorAll<HTMLElement>('tr[data-chave]') ?? [])].map((tr) => tr.dataset.chave!)
    const a = ancora.current ? ordem.indexOf(ancora.current) : -1, b = ordem.indexOf(k)
    if (b < 0) return
    const [i, j] = a < 0 ? [b, b] : [Math.min(a, b), Math.max(a, b)]
    setSel(new Set(ordem.slice(i, j + 1)))
  }
  // seleção por caixa arrastável (como no Finder): arrastar a partir de qualquer ponto da linha que não seja o nome da copy
  // (o nome continua arrastando a copy para o calendário ou para outra posição). ⌘/⇧ somam à seleção que já existe.
  const [laco, setLaco] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const inicioArraste = useRef<EventTarget | null>(null)
  const engolirClique = useRef(false)
  const comecarLaco = (e: React.PointerEvent<HTMLDivElement>) => {
    inicioArraste.current = e.target
    const alvo = e.target as HTMLElement
    // a calha à esquerda do ponto de status (o recuo da célula Copy, o ícone): arrastar dali faz a seleção por caixa
    const calha = alvo.matches('td.col-nome, td.col-formato')
    if (e.button !== 0 || alvo.closest('input, select, button, a, th, .tabela-alca, .tabela-grupo') || (!calha && alvo.closest('.col-nome'))) return
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
      // clique sem arrastar em qualquer ponto da linha (calha incluída) abre a copy; num vazio, limpa a seleção.
      // Arrastar a partir da calha continua sendo a seleção por caixa (e o clique que vem depois não abre)
      if (!ligado && alvo.closest('tr[data-chave]')) return
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

  // Criação: as copies de Reels, Aula, Ad e VSL (pelo ícone do nome), menos as arquivadas (botão direito → Arquivar)
  // uma tela só: o status é um filtro do menu da esquerda (Status, acima das Categorias). Sem status escolhido, as
  // as de conclusão (publicado, ativo, inativo, arquivado) ficam de fora; as três primeiras aparecem no fim ("publicados"),
  // a arquivada só no filtro dela e em Arquivados
  const baseCriacao = useMemo(() => est.producoes.filter((p) => !!GRUPO_FORMATO[p.formato]), [est])
  const stSel = (t.filtros?.status ?? []).filter((x) => x !== 'pin')   // 'pin' era o antigo "📌 Priorizar" do menu
  // com um status escolhido, a lista é corrida (uma copy embaixo da outra, sem grupos de categoria), com a coluna
  // Categoria no lugar de Status e ordenada por data e categoria (as pinadas em cima)
  const porStatus = stSel.length > 0
  const noStatus = (p: Producao, l: string[]) => l.includes(p.status)
  // padrão (sem status escolhido): as em andamento e as ativas
  const daCriacao = useMemo(() => baseCriacao.filter((p) => (stSel.length ? noStatus(p, stSel) : !FIM.includes(p.status) || p.status === 'ativo')), [baseCriacao, stSel.join('|'), pinsSet])   // eslint-disable-line react-hooks/exhaustive-deps
  const daPasta = daCriacao
  // contagem de cada status (com a categoria escolhida no menu)
  // status e categoria são excludentes: escolher um tira o outro (contagem do status: lista inteira)
  const contagemStatus = useMemo(() => { const c: Record<string, number> = {}; for (const p of baseCriacao) c[p.status] = (c[p.status] ?? 0) + 1; return c }, [baseCriacao])
  const anos = useMemo(() => [...new Set(daPasta.map((p) => dia(p).slice(0, 4)))].sort().reverse(), [daPasta])
  const arquivadas = useMemo(() => criacao.arquivadas ?? [], [criacao.arquivadas])
  const todasCategorias = useMemo(() => listaCategorias(est.producoes, criacao.categorias), [est.producoes, criacao.categorias])
  // as famílias de copy (mesmo nome em formatos diferentes), para a coluna Formatos
  const familias = useMemo(() => { const m = new Map<string, Producao[]>(); for (const p of est.producoes) { const k = familia(p.nome); if (k) m.set(k, [...(m.get(k) ?? []), p]) } return m }, [est.producoes])
  // dois níveis: grupo (principal) › categoria (secundário); o ícone da categoria herda o do grupo; grupo arquivado leva os filhos
  const modeloCats: ModeloCats = useMemo(() => ({ categorias: todasCategorias, icones: criacao.icones, arquivadas }), [todasCategorias, criacao.icones, arquivadas])
  const rotulo = (c: string) => rotuloCat(modeloCats, c)
  const listaMenu = useMemo(() => todasCategorias.filter((c) => (ehDivisor(c) ? !arquivadas.includes(idGrupo(c)) : !arquivadaCat(modeloCats, c))), [todasCategorias, arquivadas, modeloCats])
  // publicadas com ícone de formato (as que ficariam na Criação), com a mesma categoria escolhida; mais recentes primeiro
  // os publicados aparecem por padrão; o botão esconde (fica guardado)
  // publicados e inativos ficam recolhidos no fim por padrão; o botão mostra (fica guardado)
  const [verPub, setVerPub] = useState(() => { try { return localStorage.getItem('tabela-ver-pub-2') === 'sim' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('tabela-ver-pub-2', verPub ? 'sim' : 'nao') } catch { /* sem storage */ } }, [verPub])
  // a ordem da tabela (cabeçalho, ⇅, data com status escolhido): vale também para os publicados do fim
  const ordenarLista = (l: Producao[]) => {
    if (t.regras?.length) {   // regras do ⇅: a primeira decide; empate vai para a seguinte. Vazio vai sempre para o fim
      const val = (p: Producao, c: CampoOrdem): string | number | null => c === 'status' ? STATUS.findIndex((x) => x.k === p.status)
        : c === 'categoria' ? (p.categoria ? semEmoji(p.categoria).toLowerCase() : null) : c === 'data' ? (agendada(p) || null)
        : c === 'mtime' ? p.mtime : c === 'palavras' ? p.palavras ?? 0 : c === 'formato' ? ORDEM_FORMATO.indexOf(p.formato)
        : c === 'tags' ? ((p.tags ?? []).join(' ').toLowerCase() || null) : c === 'formatos' ? (familias.get(familia(p.nome))?.length ?? 0) : semEmoji(p.nome).toLowerCase()
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
    if (porStatus) {   // por data (sem data no fim) e depois categoria
      const cat = (p: Producao) => (p.categoria ? semEmoji(p.categoria).toLowerCase() : '\uffff')
      return l.sort((a, b) => { const x = agendada(a) || '9999', y = agendada(b) || '9999'; return x < y ? -1 : x > y ? 1 : cat(a).localeCompare(cat(b)) })
    }
    const { col, asc } = t.ordem
    const v = (p: Producao): string | number => col === 'data' ? dia(p) : col === 'formato' ? ORDEM_FORMATO.indexOf(p.formato)
      : col === 'nome' ? semEmoji(p.nome).toLowerCase() : p.mtime   // 'mtime': ordem antiga guardada (Em edição)
    return l.sort((a, b) => {
      if (col === 'data') { const x = agendada(a), y = agendada(b); if (!x !== !y) return x ? -1 : 1 }   // sem data no fim, nos dois sentidos
      const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1)
    })
  }
  const publicadasCriacao = useMemo(() => {
    const cats = t.filtros?.categoria ?? []
    const l = est.producoes.filter((p) => (p.status === 'publicado' || p.status === 'inativo') && !!GRUPO_FORMATO[p.formato] && naCat(cats, p))   // ativos ficam em cima, arquivados não aparecem
    return ordenarLista(l)
  }, [est.producoes, t.filtros?.categoria, t.ordem, t.regras, pinsSet])   // eslint-disable-line react-hooks/exhaustive-deps
  // colunas que existem de fato (colSpan maior cria colunas fantasmas que comiam a sobra da largura)
  useEffect(() => { if (t.pasta !== 'ideias') onMudar({ ...tabelaSalva('ideias'), filtros: { ...tabelaSalva('ideias').filtros, status: [t.pasta] } }) }, [t.pasta])   // eslint-disable-line react-hooks/exhaustive-deps
  // categoria numa coluna
  const umaCat = t.pasta === 'ideias' && (t.filtros?.categoria?.length ?? 0) === 1
  // contagem das categorias: as copies não publicadas de cada uma (o que aparece ao escolher a categoria)
  const contagemCat = useMemo(() => { const c: Record<string, number> = {}; for (const p of baseCriacao) if (!FIM.includes(p.status) || p.status === 'ativo') c[p.categoria ?? ''] = (c[p.categoria ?? ''] ?? 0) + 1; return c }, [baseCriacao])
  const linhas = useMemo(() => {
    const f = t.filtros
    const l = daPasta.filter((p) => (!t.ano || dia(p).startsWith(t.ano))
      && (!stSel.length || noStatus(p, stSel))
      && naCat(f?.categoria ?? [], p)
      && !(t.pasta === 'ideias' && !!p.categoria && arquivadaCat(modeloCats, p.categoria) && !f?.categoria?.includes(p.categoria))
      && (!f?.data || (f.data === 'com') === !!p.scheduled))
    return ordenarLista(l)
  }, [daPasta, t.ano, t.filtros, t.ordem, t.regras, t.pasta, pinsSet, arquivadas, porStatus])   // eslint-disable-line react-hooks/exhaustive-deps

  // aba Criação: categoria › copy, em grupos que abrem e fecham (tudo começa fechado)
  const [catAbertas, setCatAbertas] = useState<Set<string>>(() => new Set(guardadas[t.pasta]?.cats ?? []))
  useEffect(() => { guardar(t.pasta, { t }) }, [t])
  const pastaAntes = useRef(t.pasta)
  useEffect(() => { if (pastaAntes.current === t.pasta) guardar(t.pasta, { cats: [...catAbertas] }) }, [catAbertas, t.pasta])
  // a rolagem: volta para onde estava (ao abrir e ao trocar de aba) e guarda enquanto rola
  const rolo = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { const r = rolo.current; if (r) r.scrollTop = guardadas[t.pasta]?.rolagem ?? 0 }, [t.pasta])
  // trocar de aba dentro da tabela: as categorias abertas são as daquela pasta
  useEffect(() => {
    if (pastaAntes.current === t.pasta) return
    pastaAntes.current = t.pasta
    setCatAbertas(new Set(guardadas[t.pasta]?.cats ?? []))
  }, [t.pasta])
  const trocarCat = (k: string) => setCatAbertas((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  // colunas escolhidas (botão Colunas), uma escolha para cada modo: vendo um status ou vendo as categorias
  const modoCols: ModoCols = porStatus ? 'status' : 'categorias'
  const [colsModo, setColsModo] = useState<Record<ModoCols, ColExtra[]>>(lerCols)
  useEffect(() => { try { localStorage.setItem('tabela-colunas-modo', JSON.stringify(colsModo)) } catch { /* sem storage */ } }, [colsModo])
  const cols = colsModo[modoCols]
  const setCols = (l: ColExtra[]) => setColsModo((m) => ({ ...m, [modoCols]: l }))
  const efetivas: ColExtra[] = semColunas ? [] : cols
  const [colSobre, setColSobre] = useState<{ c: ColExtra; depois: boolean } | null>(null)
  const [novoFmt, setNovoFmt] = useState<{ p: Producao; f: string; rot: string; x: number; y: number } | null>(null)   // criar um formato que falta   // linha que marca onde a coluna arrastada cai
  // larguras das colunas: arrastar a borda direita do cabeçalho de qualquer coluna (o vazio da direita fica com a sobra)
  const [larg, setLarg] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem('tabela-larguras') || '{}') } catch { return {} } })
  useEffect(() => { try { localStorage.setItem('tabela-larguras', JSON.stringify(larg)) } catch { /* sem storage */ } }, [larg])
  const LARG_PADRAO: Record<string, number> = { nome: 380, status: 150, data: 120, categoria: 170, tags: 160, palavras: 90, mtime: 110, formatos: 230 }
  const largDe = (c: string) => larg[c] ?? LARG_PADRAO[c] ?? 120
  // como numa planilha: a alça na borda direita muda só aquela coluna e empurra as da direita (a Data fica com a sobra;
  // passou da largura do painel, a tabela rola para o lado)
  const redimensionar = (c: string) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    const x0 = e.clientX, w0 = largDe(c)
    const mover = (ev: PointerEvent) => setLarg((l) => ({ ...l, [c]: Math.max(60, Math.min(c === 'nome' ? 1400 : 600, Math.round(w0 + ev.clientX - x0))) }))
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); document.body.classList.remove('arrastando') }
    document.body.classList.add('arrastando')
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar)
  }
  // 📌 as pinadas da aba ficam sempre no topo (da lista ou da categoria delas), sem filtro nem ordenação
  const pinadas = useMemo(() => {
    const por = new Map(daPasta.map((p) => [idPin(p), p]))
    const cats = t.filtros?.categoria ?? []   // a categoria escolhida no menu vale também para as pinadas (os outros filtros não)
    return pins.map((id) => por.get(id)).filter((p): p is Producao => !!p && naCat(cats, p))
  }, [daPasta, pins, t.filtros?.categoria])   // eslint-disable-line react-hooks/exhaustive-deps
  const pinSet = useMemo(() => new Set(pinadas.map(idPin)), [pinadas])
  // 🔥 Winners (botão na barra de cima): as winners da seleção (qualquer status, menos arquivado) sobem para o topo, numa
  // caixa vermelha; saem dos ativos, das pinadas e do resto
  const [verWinners, setVerWinners] = useState(() => { try { return localStorage.getItem('tabela-winners') === 'sim' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('tabela-winners', verWinners ? 'sim' : 'nao') } catch { /* sem storage */ } }, [verWinners])
  const winners = useMemo(() => (verWinners ? ordenarLista(baseCriacao.filter((p) => p.winner && p.status !== 'arquivado'
    && naCat(t.filtros?.categoria ?? [], p) && (!stSel.length || noStatus(p, stSel)))) : []), [verWinners, baseCriacao, t.filtros?.categoria, stSel.join('|'), t.ordem, t.regras])   // eslint-disable-line react-hooks/exhaustive-deps
  const winSet = useMemo(() => new Set(winners.map(chaveDe)), [winners])
  const semWin = (p: Producao) => !winSet.has(chaveDe(p))
  // copy aberta (⌘O, clique, aba): se ela está na tabela com os filtros de agora, abre o grupo dela e rola até a linha
  useEffect(() => {
    if (!aberta) return
    const p = linhas.find((x) => x.raiz === aberta.raiz && x.nome === aberta.nome) ?? pinadas.find((x) => x.raiz === aberta.raiz && x.nome === aberta.nome)
    if (!p) return
    if (t.pasta === 'ideias' && !umaCat) setCatAbertas((s) => (s.has(catDe(p)) ? s : new Set(s).add(catDe(p))))
    const id = window.setTimeout(() => rolo.current?.querySelector<HTMLElement>(`tr[data-chave="${CSS.escape(chaveDe(p))}"]`)?.scrollIntoView({ block: 'nearest' }), 60)
    return () => window.clearTimeout(id)
  }, [aberta?.raiz, aberta?.nome])   // eslint-disable-line react-hooks/exhaustive-deps
  // ⌘A (modo esc, fora do editor e dos campos): seleciona todas as copies visíveis na tabela, não o texto da página; Esc limpa
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('textarea, input, select, [contenteditable="true"], .cm-editor') || document.querySelector('.modal-fundo, .paleta-fundo, .tabela-menu')) return
      if (e.key === 'Escape' && selRef.current.size) { e.preventDefault(); e.stopPropagation(); setSel(new Set()); return }   // Esc limpa a seleção
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.code !== 'KeyA') return
      const chaves = [...(rolo.current?.querySelectorAll<HTMLElement>('tr[data-chave]') ?? [])].map((tr) => tr.dataset.chave!)
      if (!chaves.length) return
      e.preventDefault(); e.stopPropagation()
      window.getSelection()?.removeAllRanges()
      setSel(new Set(chaves))
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])
  // ⌘D ou ⌘⌫ (modo esc, fora do editor): manda para a lixeira as selecionadas (confirma na barra de baixo) ou a copy aberta (pergunta antes)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || (e.code !== 'KeyD' && e.key !== 'Backspace')) return
      if ((e.target as HTMLElement | null)?.closest?.('textarea, input, select, [contenteditable="true"], .cm-editor') || document.querySelector('.modal-fundo, .paleta-fundo')) return
      e.preventDefault(); e.stopPropagation()
      if (sel.size) { setConfirmar(true); return }
      if (aberta && window.confirm(`Mandar "${aberta.nome}" para a lixeira do vault? (dá para recuperar em .trash)`)) onApagar([aberta])
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [onApagar, sel, aberta])
  // arrastar na Criação: categoria sobre categoria muda a ordem; copy sobre copy muda a posição (ou a categoria)
  const [sobre, setSobre] = useState<string | null>(null)
  const [menuCor, setMenuCor] = useState<{ x: number; y: number; cat: string } | null>(null)
  const [pinsMenu, alternarPinMenu] = usePinsMenu()
  // 🗄️ Arquivados (botão no fim do menu): janela com as categorias arquivadas e as copies delas, e as copies arquivadas soltas
  const [verArquivados, setVerArquivados] = useState(false)
  useEffect(() => {
    if (!verArquivados) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setVerArquivados(false) } }
    window.addEventListener('keydown', esc, true); return () => window.removeEventListener('keydown', esc, true)
  }, [verArquivados])
  // o menu da categoria (botão direito no menu da esquerda) também fecha com clique fora ou Esc
  useEffect(() => {
    if (!menuCor) return
    const fora = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.tabela-menu')) setMenuCor(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenuCor(null) } }
    window.addEventListener('pointerdown', fora, true); window.addEventListener('keydown', esc, true)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('keydown', esc, true) }
  }, [menuCor])
  const [renCat, setRenCat] = useState<string | null>(null)   // categoria sendo renomeada no menu
  const categorias = useMemo(() => {
    if (t.pasta !== 'ideias' || porStatus) return [] as [string, Producao[]][]
    const m = new Map<string, Producao[]>()
    for (const p of linhas) { const c = catDe(p); const l = m.get(c); if (l) l.push(p); else m.set(c, [p]) }
    const ordemCats = criacao.categorias
    const idxCat = (c: string) => { const i = ordemCats.indexOf(c); return i < 0 ? Infinity : i }
    // dentro da categoria, a ordem arrastada à mão vem primeiro; o resto segue a ordem da tabela
    for (const [c, l] of m) {
      const o = t.regras?.length ? [] : criacao.ordem?.[c] ?? []   // com regras de ordenação, elas mandam
      if (!o.length) continue
      const pos = new Map(o.map((x, i) => [x, i]))
      const idx = (p: Producao) => pos.get(chaveDe(p)) ?? Infinity
      m.set(c, l.map((p, k) => ({ p, k })).sort((a, b) => idx(a.p) - idx(b.p) || a.k - b.k).map((x) => x.p))
    }
    return [...m.entries()]
      .sort((a, b) => idxCat(a[0]) - idxCat(b[0]) || (a[0] === 'Sem categoria' ? 1 : b[0] === 'Sem categoria' ? -1 : semEmoji(a[0]).localeCompare(semEmoji(b[0]))))
  }, [linhas, t.pasta, t.regras, criacao])
  // uma categoria só com pinadas (o filtro escondeu as outras) também aparece
  const categoriasComPins = useMemo(() => {
    const tem = new Set(categorias.map(([c]) => c))
    const extra = [...new Set(pinadas.map(catDe))].filter((c) => !tem.has(c) && t.pasta === 'ideias')
    return [...categorias, ...extra.map((c) => [c, []] as [string, Producao[]])]
  }, [categorias, pinadas, t.pasta])
  const soltarCategoria = (de: string, para: string) => {
    if (de === para) return
    // a lista inteira (com divisores e categorias sem copy na tela), não só os grupos visíveis da tabela
    const atual = todasCategorias.filter((c) => c !== de)
    const i = atual.indexOf(para)
    atual.splice(i < 0 ? atual.length : i, 0, de)
    onCriacao({ categorias: atual })
  }
  const soltarCopia = async (id: string, catOrigem: string, catAlvo: string, antesDe: string | null) => {
    const lista = (categorias.find(([c]) => c === catAlvo)?.[1] ?? []).map(chaveDe).filter((x) => x !== id)
    const i = antesDe ? lista.indexOf(antesDe) : -1
    lista.splice(i < 0 ? lista.length : i, 0, id)
    const mud: Partial<Criacao> = { ordem: { [catAlvo]: lista } }
    if (catOrigem !== catAlvo) {
      mud.ordem![catOrigem] = (categorias.find(([c]) => c === catOrigem)?.[1] ?? []).map(chaveDe).filter((x) => x !== id)
      const [raiz, ...resto] = id.split('/')
      await onCategoria({ raiz: raiz as Alvo['raiz'], nome: resto.join('/') }, catAlvo)
    }
    onCriacao(mud)
  }
  // Status e Categoria não são colunas da ordem do cabeçalho: o clique vira uma regra só (clicar de novo inverte)
  // por status a data já vem ↑: lá o 1º clique na Data inverte (primeira = false)
  const ordenarPor = (campo: CampoOrdem, primeira = true) => mudar({ regras: [{ campo, asc: t.regras?.length === 1 && t.regras[0].campo === campo ? !t.regras[0].asc : primeira }] })
  const setaDe = (campo: CampoOrdem) => t.regras?.[0]?.campo === campo ? <span className="tabela-seta">{t.regras[0].asc ? '↑' : '↓'}</span> : null
  const ordenar = (col: Coluna) => mudar({ regras: [], ordem: { col, asc: t.ordem.col === col ? !t.ordem.asc : col === 'nome' } })
  const filtrando = nFiltros(t.filtros) || t.ano
  // duplo clique no nome renomeia ali mesmo (o emoji do começo fica; Enter ou sair do campo grava, Esc desiste)
  const [renomeando, setRenomeando] = useState<string | null>(null)
  const nomeOuCampo = (p: Producao) => {
    const resto = semEmoji(p.nome), prefixo = p.nome.slice(0, p.nome.length - resto.length)
    if (renomeando !== chaveDe(p)) return resto
    const gravar = (v: string) => { setRenomeando(null); const n = (prefixo + v.trim()).trim(); if (v.trim() && n !== p.nome) onRenomear({ raiz: p.raiz, nome: p.nome }, n) }
    return <input className="tabela-renomear" autoFocus defaultValue={resto} onFocus={(e) => e.target.select()} onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => gravar(e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } else if (e.key === 'Escape') { e.preventDefault(); setRenomeando(null) } }} />
  }
  // nas células de Status e Data só o seletor/campo segura o clique; o resto da célula abre a copy, como a linha toda
  const soControle = (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest('select, input, button')) e.stopPropagation() }
  const pinTag = <span className="tabela-pin" title="Priorizada (botão direito → Despriorizar)">📌</span>
  const nCols = 3 + efetivas.length   // ícone + Copy + as escolhidas + o vazio do fim
  const dataBr = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '')
  // as categorias no select, agrupadas pelo grupo (principal), com o ícone
  const opcoesCat = useMemo(() => {
    const out: React.ReactNode[] = []; let grupo: { rot: string; itens: string[] } | null = null; const soltas: string[] = []
    const fecha = () => { if (grupo?.itens.length) out.push(<optgroup key={grupo.rot} label={grupo.rot}>{grupo.itens.map((x) => <option key={x} value={x}>{rotulo(x)}</option>)}</optgroup>) }
    for (const c of listaMenu) {
      if (ehSeparador(c)) continue
      if (ehDivisor(c)) { fecha(); grupo = { rot: nomeDivisor(c), itens: [] } }
      else (grupo ? grupo.itens : soltas).push(c)
    }
    fecha()
    return [...soltas.map((x) => <option key={x} value={x}>{rotulo(x)}</option>), ...out]
  }, [listaMenu, criacao.icones])   // eslint-disable-line react-hooks/exhaustive-deps
  const celula = (p: Producao, c: ColExtra) => {
    const a = { raiz: p.raiz, nome: p.nome }
    if (c === 'data') return <td key={c} className="col-data" onClick={soControle}>
      <input type="date" className={`tabela-data-in ${p.scheduled ? '' : 'is-vazia'}`} value={(p.scheduled ?? '').slice(0, 10)} title="Mudar a data (scheduled)"
        onChange={(e) => { if (/^2\d{3}-/.test(e.target.value)) onData(a, e.target.value) }} /></td>
    if (c === 'status') return <td key={c} className="col-status" onClick={soControle}>
      <select className={`tabela-status-sel is-${p.status}`} value={p.status} onChange={(e) => onStatus([a], e.target.value as StatusProd)}>
        {STATUS.map((x) => <option key={x.k} value={x.k}>{x.marca} {x.nome}</option>)}</select></td>
    if (c === 'categoria') return <td key={c} className="col-categoria" onClick={soControle}>
      <select className={`tabela-status-sel tabela-cat-sel ${p.categoria ? '' : 'is-vazia'}`} value={p.categoria ?? ''} title="Mudar a coleção"
        onChange={(e) => onCategoria(a, e.target.value)}>
        <option value="">— Sem coleção</option>
        {opcoesCat}
        {p.categoria && !todasCategorias.includes(p.categoria) && <option value={p.categoria}>{p.categoria}</option>}
      </select></td>
    if (c === 'formatos') {   // os que a copy tem (ligados, clicar abre a nota), um traço e os que não tem (apagados)
      const slots = slotsFormatos(p, familias.get(familia(p.nome)) ?? [p])
      const tem = slots.filter((x) => x.nota), nao = slots.filter((x) => !x.nota)
      return <td key={c} className="col-formatos" onClick={(e) => e.stopPropagation()}>
        {tem.map(({ f, rot, nota: n }) => <button key={f} className="fmt-on" title={`${rot}: ${n!.nome}`} onClick={() => onAbrir({ raiz: n!.raiz, nome: n!.nome })}>{f}</button>)}
        {tem.length > 0 && nao.length > 0 && <i className="fmt-sep" aria-hidden="true" />}
        {nao.map(({ f, rot }) => <button key={f} className="fmt-off" title={`${rot}: não tem · clique para criar`} onClick={(e) => setNovoFmt({ p, f, rot, x: e.clientX, y: e.clientY })}>{f}</button>)}
      </td>
    }
    if (c === 'tags') return <td key={c} className="col-tags" title={(p.tags ?? []).join(' ')}>{(p.tags ?? []).join(' ')}</td>
    if (c === 'palavras') return <td key={c} className="col-palavras">{p.palavras ?? ''}</td>
    return <td key={c} className="col-mtime">{dataBr(p.mtime)}</td>
  }
  const novoTag = <em className="tabela-novo" title="Nova: ainda não foi aberta">new</em>
  const linha = (p: Producao, nivel = 0, pin = false, comoGalho = false) => {
    const k = chaveDe(p), cor = nivel ? criacao.cores[catDe(p)] : undefined
    const galho = nivel > 0 || comoGalho   // comoGalho: as linhas sem categoria (publicadas do fim, filtro de status) com a bolinha e o ícone junto do nome
    return (
      <tr key={k} data-chave={k} tabIndex={0}
        className={`${pin ? 'is-pinada' : ''} ${winSet.has(k) ? 'is-winner' : p.status === 'ativo' && !pin ? 'is-ativo' : ''} ${sel.has(k) ? 'is-sel' : ''} ${nivel ? `tabela-nivel-${nivel}` : ''} ${aberta && aberta.raiz === p.raiz && aberta.nome === p.nome ? 'is-aberta' : ''} ${cor ? 'com-cor' : ''} ${sobre === `p:${k}` ? 'is-sobre' : ''}`}
        style={cor ? { '--cor-cat': cor } as React.CSSProperties : undefined}
        onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }}
        onClick={(e) => { if (engolirClique.current) return; if (e.shiftKey) { selecionarAte(k); return } ancora.current = k; if (!(e.metaKey || e.ctrlKey) && sel.size) setSel(new Set()); onAbrir({ raiz: p.raiz, nome: p.nome }, { nova: e.metaKey || e.ctrlKey }) }}
        onKeyDown={(e) => e.key === 'Enter' && onAbrir({ raiz: p.raiz, nome: p.nome })}
        draggable onDragStart={(e) => { const ini = inicioArraste.current as HTMLElement | null; if (!ini?.closest?.('.col-nome') || ini.matches?.('td.col-nome, td.col-formato') || ini.closest?.('input')) { e.preventDefault(); return } e.dataTransfer.setData('text/plain', `${p.raiz}\u0000${p.nome}`); e.dataTransfer.setData('neo/copia', JSON.stringify({ id: k, cat: catDe(p) })); e.dataTransfer.effectAllowed = 'move' }}
        onDragOver={nivel ? (e) => { if (e.dataTransfer.types.includes('neo/copia')) { e.preventDefault(); setSobre(`p:${k}`) } } : undefined}
        onDragLeave={nivel ? () => setSobre(null) : undefined}
        onDrop={nivel ? (e) => { const d = e.dataTransfer.getData('neo/copia'); setSobre(null); if (!d) return; e.preventDefault(); const x = JSON.parse(d); soltarCopia(x.id, x.cat, catDe(p), k) } : undefined}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 280), p: { raiz: p.raiz, nome: p.nome } }) }}>
        <td className="col-formato">{!galho && (p.formato || '📄')}</td>
        <td className="col-nome" onDoubleClick={(e) => { e.stopPropagation(); setRenomeando(k) }}>{galho ? <div className="tabela-galho">
          {!porStatus && <i className={`ponto is-${p.status}`} title={STATUS.find((x) => x.k === p.status)?.nome} />}
          <div><b>{pin && pinTag}<span className="tabela-ic">{p.formato || '📄'}</span>{nomeOuCampo(p)}{p.nova && novoTag}</b></div></div>
          : <b>{nomeOuCampo(p)}{pin && pinTag}{p.nova && novoTag}</b>}</td>
        {efetivas.map((c) => celula(p, c))}
        <td className="col-fim" />
      </tr>
    )
  }
  const sepPin = (k: string) => <tr key={k} className="tabela-sep-pin" aria-hidden="true"><td colSpan={nCols} /></tr>

  return (
    <div className="tabela-embutida-fundo">
      <div className={`modal-nota modal-tabela glass glass--light tabela-embutida ${compacto ? 'tabela-compacta' : ''} ${semColunas ? 'tabela-sem-colunas' : ''}`} aria-label="Tabela de copies">
        {extra && <header className="modal-tabs">{extra}</header>}   {/* sem as abas de status, a faixa de cima só existe com os botões (calendário) */}

        <div className="tabela-corpo">
        {!semCategorias && <MenuCategorias onArquivados={() => setVerArquivados(true)} nArquivados={arquivadas.filter((c) => todasCategorias.includes(c) || todasCategorias.some((d) => ehDivisor(d) && idGrupo(d) === c)).length + est.producoes.filter((p) => p.status === 'arquivado').length} status={{
            lista: STATUS.filter((x) => x.k !== 'referencia').map((x) => ({ k: x.k, rotulo: `${x.marca} ${x.nome}`, n: contagemStatus[x.k] ?? 0 })), sel: stSel,   // Referência fica fora do menu
            onSel: (l) => mudar({ filtros: { ...t.filtros, status: l, ...(l.length ? { categoria: [] } : {}) } }),   // status tira a coleção
            onSoltar: (d, k) => { const x = JSON.parse(d) as { id: string }; const ids = sel.has(x.id) ? [...sel] : [x.id]
              onStatus(ids.map((id) => { const [raiz, ...resto] = id.split('/'); return { raiz: raiz as Alvo['raiz'], nome: resto.join('/') } }), k as StatusProd) } }}
          renomear={renCat} onRenomear={(de, para, icone) => { setRenCat(null); if (!para) return
            ;(async () => { if (para !== de) await onRenomearCategoria(de, para); if (icone && icone !== criacao.icones?.[para]) onCriacao({ icones: { [para]: icone } }) })() }}
          lista={listaMenu} icones={criacao.icones ?? {}} arquivadas={arquivadas.filter((c) => todasCategorias.includes(c))} contagem={contagemCat} nPins={daPasta.filter((p) => pinsSet.has(idPin(p))).length} total={daPasta.length} sel={t.filtros?.categoria ?? []}
          cores={criacao.cores} onCor={(chave, cor) => onCriacao({ cores: { [chave]: cor } })} onSel={(l) => mudar({ filtros: { ...t.filtros, categoria: l, ...(l.length ? { status: [] } : {}) } })}   // excludentes: categoria tira o status
          onSoltar={(d, cat) => { const x = JSON.parse(d) as { id: string }; const ids = sel.has(x.id) ? [...sel] : [x.id]
            if (cat === PIN) { for (const id of ids) alternarPin(`p:${id}`, true); return }
            for (const id of ids) { const [raiz, ...resto] = id.split('/'); onCategoria({ raiz: raiz as Alvo['raiz'], nome: resto.join('/') }, cat === SEM ? '' : cat) } }}
          onOrdem={(de, para, depois) => onCriacao({ categorias: moverNaLista(todasCategorias, de, para, !!depois) })}
          onRenomearDivisor={(de, para, icone) => onCriacao({ categorias: todasCategorias.map((c) => (c === de ? para : c)), ...(icone ? { icones: { [idGrupo(de)]: icone } } : {}) })}
          onArquivarGrupo={(d) => onCriacao({ arquivadas: [...arquivadas, idGrupo(d)] })}
          onCriar={(n, icone, tipo: TipoCat) => {   // nasce solta (no topo da lista), na seção onde foi criada
            if (!todasCategorias.includes(n)) onCriacao({ categorias: [n, ...todasCategorias], ...(icone ? { icones: { [n]: icone } } : {}), ...(tipo === 'funil' ? { tipos: { [n]: 'funil' } } : {}) })
            mudar({ filtros: { ...t.filtros, categoria: [n], status: [] } }) }}
          onDivisor={(n, ic, tipo: TipoCat) => { const id = `—${Date.now().toString(36)}`; onCriacao({ categorias: [...todasCategorias, `${id}|${n.trim()}`], ...(tipo === 'funil' ? { tipos: { [id]: 'funil' } } : {}), ...(ic ? { icones: { [id]: ic } } : {}) }) }}
          onTirar={(d) => onCriacao({ categorias: todasCategorias.filter((c) => c !== d) })}
          onSeparador={(depoisDe) => { const l = [...todasCategorias], novo = `·sep:${Date.now().toString(36)}`; const i = depoisDe ? l.indexOf(depoisDe) : -1; l.splice(i < 0 ? l.length : i + 1, 0, novo); onCriacao({ categorias: l }) }}
          novas={[...new Set(baseCriacao.filter((p) => p.nova && p.categoria).map((p) => p.categoria as string))]}
          onMenu={(cat, x, y) => setMenuCor({ x: Math.min(x, window.innerWidth - 230), y: Math.min(y, window.innerHeight - 220), cat })} />}
        <div className="tabela-coluna">
        <section className="tabela-filtros">
          <FiltroRedacao f={t.filtros ?? {}} onMudar={(filtros) => mudar({ filtros })} />
          <Ordenacao regras={t.regras ?? []} onMudar={(regras) => mudar({ regras })} />
          {!semColunas && <EscolherColunas cols={cols} onMudar={setCols} modo={modoCols} />}
          <button className={`tabela-canvas tabela-winners ${verWinners ? 'is-on' : ''}`} onClick={() => setVerWinners((v) => !v)} aria-pressed={verWinners}
            title={verWinners ? 'Esconder o destaque das winners' : 'Mostrar as winners (🔥) desta seleção no topo, numa caixa vermelha'}>🔥 Winners</button>
          {anos.length > 1 && (
            <select className="tabela-select" value={t.ano} onChange={(e) => mudar({ ano: e.target.value, mes: '' })}>
              <option value="">Todos os anos</option>{anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {t.pasta === 'ideias' && !porStatus && categorias.length > 0 && !umaCat && (() => {
            const tudoAberto = categorias.every(([c]) => catAbertas.has(c))
            return <button className="tabela-select tabela-tudo" onClick={() => setCatAbertas(tudoAberto ? new Set() : new Set(categorias.map(([c]) => c)))}
              title={tudoAberto ? 'Fechar todas as coleções' : 'Abrir todas as coleções'}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {tudoAberto ? <path d="M3 2.5l3 3 3-3M3 9.5l3-3 3 3" /> : <path d="M3 5l3-3 3 3M3 7l3 3 3-3" />}</svg>
              {tudoAberto ? 'Recolher tudo' : 'Expandir tudo'}</button>
          })()}
          {filtrando ? <button className="tabela-limpar" onClick={() => mudar({ ano: '', mes: '', filtros: {} })}>Limpar filtros</button> : null}
        </section>

        <div className="tabela-rolo" ref={rolo} onPointerDown={comecarLaco} onScroll={(e) => guardar(t.pasta, { rolagem: e.currentTarget.scrollTop })}>
          {laco && <div className="tabela-laco" style={{ left: laco.x, top: laco.y, width: laco.w, height: laco.h }} />}
          <table className={`tabela ${umaCat ? 'sem-grupo' : ''}`} style={!semColunas ? { width: 34 + largDe('nome') + efetivas.reduce((n, c) => n + largDe(c), 0), minWidth: '100%' } : undefined}>
            <thead>
              <tr>
                <th className="col-formato" />
                <th className="col-nome" style={{ width: largDe('nome') }} onClick={() => ordenarPor('nome')}   // regra: vale com status escolhido e passa por cima da ordem arrastada à mão
                  aria-sort={t.regras?.[0]?.campo === 'nome' ? (t.regras[0].asc ? 'ascending' : 'descending') : 'none'}>
                  {ROTULO_COL.nome}{setaDe('nome')}
                  <i className="tabela-alca" onPointerDown={redimensionar('nome')} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); setLarg(({ nome: _, ...l }) => l) }} title="Arraste para mudar a largura (duplo clique volta ao padrão)" /></th>
                {efetivas.map((c) => (
                  <th key={c} className={`col-${c} ${colSobre?.c === c ? (colSobre.depois ? 'is-col-depois' : 'is-col-antes') : ''}`} style={{ width: largDe(c) }}
                    draggable onDragStart={(e) => { if (document.body.classList.contains('arrastando')) { e.preventDefault(); return } e.dataTransfer.setData('neo/col-tabela', c); e.dataTransfer.effectAllowed = 'move' }}   // arrastar o cabeçalho muda a ordem da coluna
                    onDragOver={(e) => { if (!e.dataTransfer.types.includes('neo/col-tabela')) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const d = e.clientX > r.left + r.width / 2; setColSobre((x) => (x?.c === c && x.depois === d ? x : { c, depois: d })) }}
                    onDragLeave={() => setColSobre(null)}
                    onDrop={(e) => { e.preventDefault(); const de = e.dataTransfer.getData('neo/col-tabela') as ColExtra; const d = colSobre?.depois ?? false; setColSobre(null)
                      if (!de || de === c) return; const l = cols.filter((x) => x !== de); l.splice(l.indexOf(c) + (d ? 1 : 0), 0, de); setCols(l) }}
                    onDragEnd={() => setColSobre(null)}
                    onClick={() => (c === 'data' ? (porStatus ? ordenarPor('data', false) : ordenar('data')) : ordenarPor(c))}>
                    {COLS_EXTRA[c]}{c === 'data' ? (t.regras?.length ? setaDe('data') : ((porStatus || t.ordem.col === 'data') && <span className="tabela-seta">{porStatus || t.ordem.asc ? '↑' : '↓'}</span>)) : setaDe(c)}
                    <i className="tabela-alca" onPointerDown={redimensionar(c)} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); setLarg(({ [c]: _, ...l }) => l) }} title="Arraste para mudar a largura (duplo clique volta ao padrão)" /></th>
                ))}
                <th className="col-fim" /></tr>
            </thead>
            <tbody>
              {/* pinadas: no topo da própria categoria (ou da lista), destacadas, com um traço separando das demais */}
              {/* ordem: ativos (os principais), depois as pinadas, depois o resto */}
              {/* 🔥 winners (com o botão ligado): no topo de tudo, numa caixa vermelha */}
              {winners.map((p) => linha(p, 0, false, true))}
              {(t.pasta !== 'ideias' || porStatus) && linhas.filter((p) => p.status === 'ativo' && !pinSet.has(idPin(p)) && semWin(p)).map((p) => linha(p, 0, false, porStatus))}
              {(t.pasta !== 'ideias' || porStatus) && pinadas.filter(semWin).length > 0 && [...pinadas.filter(semWin).map((p) => linha(p, 0, true, porStatus)), sepPin('pin:sep')]}
              {t.pasta !== 'ideias' || porStatus ? linhas.filter((p) => !pinSet.has(idPin(p)) && p.status !== 'ativo' && semWin(p)).map((p) => linha(p, 0, false, porStatus)) : categoriasComPins.map(([cat, todasCat]) => {
                const ativos = todasCat.filter((p) => p.status === 'ativo' && !pinSet.has(idPin(p)) && semWin(p))
                const soltas = todasCat.filter((p) => !pinSet.has(idPin(p)) && p.status !== 'ativo' && semWin(p))
                const pinCat = pinadas.filter((p) => catDe(p) === cat && semWin(p))
                if (!ativos.length && !soltas.length && !pinCat.length) return null
                const filhas = [...ativos.map((p) => linha(p, 1)), ...pinCat.map((p) => linha(p, 1, true)), ...(pinCat.length && soltas.length ? [sepPin(`pin:sep:${cat}`)] : []), ...soltas.map((p) => linha(p, 1))]
                // uma categoria escolhida no menu: o cabeçalho dela seria redundante, vão direto as copies
                if (umaCat) return filhas
                // o filtro de status (menu da esquerda) não força abrir: as categorias seguem abrindo e fechando no clique
                const aberto = catAbertas.has(cat) || nFiltros({ ...t.filtros, status: [] }) > 0
                const n = ativos.length + pinCat.length + soltas.length
                return [
                  <tr key={`cat:${cat}`} className={`tabela-grupo is-cat ${criacao.cores[cat] ? 'com-cor' : ''} ${sobre === `c:${cat}` ? 'is-sobre' : ''}`} onClick={() => trocarCat(cat)}
                    style={criacao.cores[cat] ? { '--cor-cat': criacao.cores[cat] } as React.CSSProperties : undefined}
                    draggable={cat !== 'Sem categoria'} onDragStart={(e) => { e.dataTransfer.setData('neo/categoria', cat); e.dataTransfer.effectAllowed = 'move' }}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes('neo/categoria') || e.dataTransfer.types.includes('neo/copia')) { e.preventDefault(); setSobre(`c:${cat}`) } }}
                    onDragLeave={() => setSobre(null)}
                    onDrop={(e) => { setSobre(null); const c = e.dataTransfer.getData('neo/categoria'); const d = e.dataTransfer.getData('neo/copia'); e.preventDefault()
                      if (c) soltarCategoria(c, cat); else if (d) { const x = JSON.parse(d); soltarCopia(x.id, x.cat, cat, null) } }}
                    onContextMenu={(e) => { if (cat === 'Sem categoria') return; e.preventDefault(); setMenuCor({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 160), cat }) }}>
                    <td className="col-formato"><span className={`tabela-seta-grupo ${aberto ? 'is-aberta' : ''}`}>{SETA}</span></td>
                    <td className="col-nome"><b>{cat === 'Sem categoria' ? 'Sem coleção' : rotulo(cat)}</b><span>{n} {n === 1 ? 'copy' : 'copies'}</span></td>
                    {efetivas.map((c) => <td key={c} className={`col-${c}`} />)}<td className="col-fim" />
                  </tr>,
                  ...(aberto ? filhas : []),
                ]
              })}
              {/* Criação: no fim, as publicadas (que já passaram por aqui), atrás de um botão e de um traço */}
              {t.pasta === 'ideias' && !stSel.length && publicadasCriacao.length > 0 && [
                <tr key="pub:botao" className="tabela-pub-botao"><td colSpan={nCols}>
                  <button onClick={() => setVerPub((v) => !v)}>{verPub ? 'Esconder publicados' : `Mostrar publicados (${publicadasCriacao.length})`}</button></td></tr>,
                ...(verPub ? [<tr key="pub:sep" className="tabela-pub-sep" aria-hidden="true"><td colSpan={nCols} /></tr>,
                  ...publicadasCriacao.filter(semWin).map((p) => linha(p, 0, false, true))] : []),
              ]}
            </tbody>
          </table>
          {!linhas.length && !pinadas.length && <p className="tabela-vazia">Nenhuma copy com esses filtros.</p>}
        </div>
        </div>
        </div>
        {novoFmt && createPortal(<NovoFormato origem={novoFmt.p} f={novoFmt.f} rotulo={novoFmt.rot} x={novoFmt.x} y={novoFmt.y}
          colecoes={listaMenu.filter((c) => !ehDivisor(c) && !ehSeparador(c)).map((c) => ({ v: c, r: rotulo(c) }))}
          onFechar={() => setNovoFmt(null)} onCriado={(a) => { setNovoFmt(null); onAbrir(a) }} />, document.body)}
        {verArquivados && createPortal((() => {
          // grupos arquivados (com as categorias deles) e categorias arquivadas soltas
          const grupos = todasCategorias.filter((d) => ehDivisor(d) && arquivadas.includes(idGrupo(d)))
          const filhosDe = (d: string) => { const i = todasCategorias.indexOf(d), fim = todasCategorias.slice(i + 1).findIndex(ehDivisor); return todasCategorias.slice(i + 1, fim < 0 ? undefined : i + 1 + fim) }
          const dosGrupos = grupos.flatMap(filhosDe)
          const cats = arquivadas.filter((c) => todasCategorias.includes(c) && !dosGrupos.includes(c))
          const soltas = est.producoes.filter((p) => p.status === 'arquivado' && !cats.includes(p.categoria ?? '') && !dosGrupos.includes(p.categoria ?? ''))
          const item = (p: Producao) => (
            <li key={chaveDe(p)}>
              <button className="arq-copy" onClick={() => { setVerArquivados(false); onAbrir({ raiz: p.raiz, nome: p.nome }) }} title="Abrir a copy">
                <span className="tabela-ic">{p.formato || '📄'}</span><b>{semEmoji(p.nome)}</b>
                <em>{STATUS.find((x) => x.k === p.status)?.marca} {STATUS.find((x) => x.k === p.status)?.nome}{p.scheduled ? ` · ${p.scheduled.slice(0, 10).split('-').reverse().join('/')}` : ''}</em>
              </button>
              {p.status === 'arquivado' && <button className="arq-desarq" onClick={() => onStatus([{ raiz: p.raiz, nome: p.nome }], 'ideia')} title="Volta para Priorizar, como ideia">📤 Desarquivar</button>}
            </li>)
          return (
            <div className="arq-fundo" onPointerDown={() => setVerArquivados(false)}>
              <div className="arq-modal glass glass--light" role="dialog" aria-label="Arquivados" onPointerDown={(e) => e.stopPropagation()}>
                <header><b>🗄️ Arquivados</b><button className="btn-icone" onClick={() => setVerArquivados(false)} aria-label="Fechar">×</button></header>
                <div className="arq-corpo">
                  {!grupos.length && !cats.length && !soltas.length && <p className="arq-vazio">Nada arquivado.</p>}
                  {grupos.map((d) => {
                    const fs = filhosDe(d), dela = est.producoes.filter((p) => fs.includes(p.categoria ?? '')).sort((a, b) => dia(b).localeCompare(dia(a)))
                    return (
                      <section key={d}>
                        <h3><span>{nomeDivisor(d)}</span><em>grupo · {fs.length} {fs.length === 1 ? 'coleção' : 'coleções'} · {dela.length} {dela.length === 1 ? 'copy' : 'copies'}</em>
                          <button className="arq-desarq" onClick={() => onCriacao({ arquivadas: arquivadas.filter((x) => x !== idGrupo(d)) })} title="O grupo e as coleções dele voltam para o menu">📤 Desarquivar</button></h3>
                        {fs.length ? <p className="arq-vazio">{fs.map(rotulo).join(' · ')}</p> : null}
                        {dela.length ? <ul>{dela.map(item)}</ul> : null}
                      </section>)
                  })}
                  {cats.map((c) => {
                    const dela = est.producoes.filter((p) => p.categoria === c).sort((a, b) => dia(b).localeCompare(dia(a)))
                    return (
                      <section key={c}>
                        <h3><span>{rotulo(c)}</span><em>{dela.length} {dela.length === 1 ? 'copy' : 'copies'}</em>
                          <button className="arq-desarq" onClick={() => onCriacao({ arquivadas: arquivadas.filter((x) => x !== c) })} title="A coleção volta para o menu">📤 Desarquivar</button></h3>
                        {dela.length ? <ul>{dela.map(item)}</ul> : <p className="arq-vazio">Sem copies.</p>}
                      </section>)
                  })}
                  {soltas.length > 0 && <section><h3><span>Copies arquivadas</span><em>{soltas.length}</em></h3><ul>{soltas.sort((a, b) => dia(b).localeCompare(dia(a))).map(item)}</ul></section>}
                </div>
              </div>
            </div>)
        })(), document.body)}
        {menuCor && createPortal(
          <div className="tabela-menu tabela-cores glass glass--light" style={{ left: menuCor.x, top: menuCor.y }} role="menu" onMouseLeave={() => setMenuCor(null)}>
            <button onClick={() => { alternarPinMenu(`cat:${menuCor.cat}`); setMenuCor(null) }}>📌 {pinsMenu.includes(`cat:${menuCor.cat}`) ? 'Despinar' : 'Pinar'}</button>
            <button onClick={() => { setRenCat(menuCor.cat); setMenuCor(null) }}>✏️ Renomear</button>
            {(() => { const c = menuCor.cat, sim = arquivadas.includes(c)
              return <button onClick={() => { setMenuCor(null); onCriacao({ arquivadas: sim ? arquivadas.filter((x) => x !== c) : [...arquivadas, c] })
                if (!sim && t.filtros?.categoria?.includes(c)) mudar({ filtros: { ...t.filtros, categoria: t.filtros.categoria.filter((x) => x !== c) } }) }}>
                {sim ? '📤 Desarquivar' : '🗄️ Arquivar'}</button> })()}
            <hr />
            <button className="is-perigo" onClick={async () => {   // com copies: elas vão para Sem categoria (pede confirmação)
              const c = menuCor.cat; setMenuCor(null)
              const delas = est.producoes.filter((p) => p.categoria === c)
              if (delas.length && !window.confirm(`Deletar a coleção "${c}"? ${delas.length} ${delas.length === 1 ? 'copy fica' : 'copies ficam'} sem coleção.`)) return
              if (delas.length) await fetch('/api/copies/categoria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nomes: delas.map((p) => p.nome), categoria: '' }) })
              onCriacao({ categorias: todasCategorias.filter((x) => x !== c), arquivadas: arquivadas.filter((x) => x !== c), icones: { [c]: '' } })
              if (t.filtros?.categoria?.includes(c)) mudar({ filtros: { ...t.filtros, categoria: t.filtros.categoria.filter((x) => x !== c) } })
            }}>Deletar</button>
            <hr />
            <p className="tabela-menu-t">Cor</p>
            <div className="tabela-cores-grade">
              {PASTEIS.map((c) => <button key={c} className={criacao.cores[menuCor.cat] === c ? 'is-on' : ''} style={{ background: c }} title={c}
                onClick={() => { onCriacao({ cores: { [menuCor.cat]: c } }); setMenuCor(null) }} />)}
              <button className={`tabela-sem-cor ${criacao.cores[menuCor.cat] ? '' : 'is-on'}`} title="Sem cor" aria-label="Sem cor"
                onClick={() => { onCriacao({ cores: { [menuCor.cat]: '' } }); setMenuCor(null) }} />
            </div>
          </div>, document.body)}
        {menu && createPortal(   // no body: dentro do card (glass) o position: fixed contava a partir do card, não da tela
          <div className="tabela-menu glass glass--light" ref={refMenu} style={{ left: menu.x, top: menu.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
            {menu.renomear !== undefined ? (
              <form onSubmit={async (e) => { e.preventDefault(); const n = menu.renomear!.trim(); const a = menu.p; setMenu(null); if (n && n !== a.nome) await onRenomear(a, n) }}>
                <input autoFocus value={menu.renomear} onChange={(e) => setMenu({ ...menu, renomear: e.target.value })} onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null) } }} aria-label="Novo nome" />
              </form>
            ) : menu.apagar ? (<>
              <p className="tabela-menu-t">Mandar para a lixeira do vault?</p>
              <button className="is-perigo" autoFocus onClick={async () => { const a = menu.p; setMenu(null); await onApagar([a]) }}>Deletar</button>
              <button onClick={() => setMenu({ ...menu, apagar: false })}>Cancelar</button>
            </>) : (<>
              {(() => { const id = idPin(menu.p), sim = pins.includes(id)
                return <button onClick={() => { setMenu(null); alternarPin(id, !sim) }}>📌 {sim ? 'Despriorizar' : 'Priorizar'}</button> })()}
              {onNova && (() => { const p = menu.p, nova = !!est.producoes.find((x) => x.raiz === p.raiz && x.nome === p.nome)?.nova
                return <button onClick={async () => { setMenu(null); await onNova({ raiz: p.raiz, nome: p.nome }, !nova) }}>💡 {nova ? 'Tirar o new' : 'Marcar como new'}</button> })()}
              <button onClick={() => setMenu({ ...menu, renomear: menu.p.nome })}>✏️ Renomear</button>
              <hr />
              {(() => {
                // linha marcada junto com outras: as tags e o status valem para todas as marcadas
                const k = chaveDe(menu.p)
                const alvos = sel.has(k) && sel.size > 1 ? daPasta.filter((p) => sel.has(chaveDe(p))) : est.producoes.filter((p) => chaveDe(p) === k)
                const atual = alvos.length === 1 ? alvos[0].status : null
                return alvos.length > 0 && <>
                  <p className="tabela-menu-t">Mudar status{alvos.length > 1 ? ` (${alvos.length})` : ''}</p>
                  {STATUS.filter((x) => x.k !== atual).map((x) => (
                    <button key={x.k} onClick={async () => { setMenu(null); await onStatus(alvos.map((p) => ({ raiz: p.raiz, nome: p.nome })), x.k); if (alvos.length > 1) setSel(new Set()) }}>{x.marca} {x.nome}</button>
                  ))}
                  <hr />
                  <MenuTags alvos={alvos} sugestoes={todasTags} onTags={onTags} /></>
              })()}
              {(() => { const p0 = est.producoes.find((x) => x.raiz === menu.p.raiz && x.nome === menu.p.nome); return p0 && <>
                <hr />
                <button onClick={async () => { const a = menu.p; setMenu(null); await onStatus([a], p0.status === 'arquivado' ? 'ideia' : 'arquivado') }}>{p0.status === 'arquivado' ? '📤 Desarquivar' : '🗄️ Arquivar'}</button>
                {p0.categoria && (   // apaga o `categoria:` da nota (vai para Sem categoria)
                  <button onClick={async () => { const a = menu.p; setMenu(null); await onCategoria(a, '') }} title={`Tirar de ${p0.categoria}`}>🚫 Tirar da coleção</button>)}
              </> })()}
              <hr /><button className="is-perigo" onClick={() => setMenu({ ...menu, apagar: true })}>Deletar</button>
            </>)}
          </div>, document.body
        )}
        {sel.size > 0 && (
          <div className="tabela-selecao">
            <b>{sel.size} {sel.size === 1 ? 'nota selecionada' : 'notas selecionadas'}</b>
            <button className="pilula" onClick={() => { setSel(new Set()); setConfirmar(false) }}>Limpar seleção</button>
            {<select className="tabela-status" value="" disabled={apagando} aria-label="Mudar o status das selecionadas"
              onChange={async (e) => { const st = e.target.value as StatusProd; if (!st) return; setApagando(true)
                try { await onStatus(daPasta.filter((p) => sel.has(chaveDe(p))).map((p) => ({ raiz: p.raiz, nome: p.nome })), st); setSel(new Set()) } finally { setApagando(false) } }}>
              <option value="">Mudar status…</option>
              {STATUS.map((x) => <option key={x.k} value={x.k}>{x.marca} {x.nome}</option>)}
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
        {n ? `Filtro (${n})` : 'Filtrar'}</button>
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
/** Botão Colunas: marcar quais aparecem depois da Copy e arrastar para mudar a ordem (uma linha marca onde cai). */
function EscolherColunas({ cols, onMudar, modo }: { cols: ColExtra[]; onMudar: (c: ColExtra[]) => void; modo: ModoCols }) {
  const [aberto, setAberto] = useState(false)
  const [linha, setLinha] = useState<{ c: ColExtra; depois: boolean } | null>(null)
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAberto(false) } }
    window.addEventListener('pointerdown', fora, true); window.addEventListener('keydown', esc, true)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('keydown', esc, true) }
  }, [aberto])
  // as marcadas na ordem delas, depois as desmarcadas
  const todas = [...cols, ...(Object.keys(COLS_EXTRA) as ColExtra[]).filter((c) => !cols.includes(c))]
  const mover = (de: ColExtra, para: ColExtra, depois: boolean) => {
    if (de === para) return
    const l = todas.filter((c) => c !== de); const i = l.indexOf(para); l.splice(i + (depois ? 1 : 0), 0, de)
    onMudar(l.filter((c) => cols.includes(c)))
  }
  return (
    <div className="tabela-fmt" ref={caixa}>
      <button className="tabela-canvas" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} title="Escolher as colunas e a ordem delas">Colunas</button>
      {aberto && (
        <div className="tabela-fmt-menu tabela-cols-menu glass glass--light" role="menu" aria-label="Colunas">
          <p className="mudo tabela-ordem-dica">{modo === 'status' ? 'Colunas de quando você vê um status.' : 'Colunas de quando você vê as coleções.'} Marque e arraste para mudar a ordem; a largura muda pela borda do cabeçalho.</p>
          <div className="tabela-fmt-item tabela-cols-item is-fixa"><input type="checkbox" checked disabled /><span>Copy</span></div>
          {todas.map((c) => (
            <label key={c} draggable={cols.includes(c)} className={`tabela-fmt-item tabela-cols-item ${linha?.c === c ? (linha.depois ? 'is-linha-depois' : 'is-linha-antes') : ''}`}
              onDragStart={(e) => { e.dataTransfer.setData('neo/coluna', c); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => { if (!e.dataTransfer.types.includes('neo/coluna') || !cols.includes(c)) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const d = e.clientY > r.top + r.height / 2; setLinha((l) => (l?.c === c && l.depois === d ? l : { c, depois: d })) }}
              onDragLeave={() => setLinha(null)}
              onDrop={(e) => { e.preventDefault(); const de = e.dataTransfer.getData('neo/coluna') as ColExtra; const d = linha?.depois ?? false; setLinha(null); if (de) mover(de, c, d) }}
              onDragEnd={() => setLinha(null)}>
              <input type="checkbox" checked={cols.includes(c)} onChange={() => onMudar(cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c])} />
              <span>{COLS_EXTRA[c]}</span>{cols.includes(c) && <i className="tabela-cols-alca" aria-hidden="true">⋮⋮</i>}
            </label>
          ))}
          <hr /><button className="tabela-fmt-item" onClick={() => onMudar(COLS_PADRAO[modo])}>Voltar ao padrão ({COLS_PADRAO[modo].map((c) => COLS_EXTRA[c]).join(', ')})</button>
        </div>
      )}
    </div>
  )
}

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
        title="Regras de ordenação">{rotulo}</button>
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
