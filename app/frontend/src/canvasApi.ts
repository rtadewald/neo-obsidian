import type { Raiz } from './notas'

export type Midia = { links: string[]; imagem: string | null; video?: string | null; copia: boolean }
export type Ideia = { nome: string; previa: string; fontes: string[]; mtime: number; grupo?: string | null; canvas?: string | null; canvases?: string[]; tags?: string[]; categoria?: string | null; material?: boolean; codigo?: string | null } & Partial<Midia>
export type Entrada = { nome: string; url: string; tipo: string; thumb: string; previa: string; mtime: number; grupo?: string | null; tags?: string[]; codigo?: string | null }
export type StatusProd = 'ideia' | 'gravar' | 'edicao' | 'agendado' | 'publicado'
export type Producao = {
  nome: string; raiz: 'priorizar' | 'publicados'; status: StatusProd; scheduled: string | null; ano: string
  formato: string; ideia: string | null; producao?: string | null; origem?: string | null; previa: string; mtime: number; grupo?: string | null; canvas?: string | null; canvases?: string[]; datas?: string[]
  palavras?: number; criado?: number
  winner?: boolean   // tag 🔥 na nota: performou acima da média
  tags?: string[]
  categoria?: string | null   // `categoria:` da copy: a caixa do mapa mental onde ela vive
  codigo?: string | null      // NEO-042: copiar e colar no Claude Code
} & Midia
export type Formato = { emoji: string; nome: string }
/** A produção 🎬 de uma copy: as copies com a mesma chave viram um card só. Normalmente é a ideia; quando uma ideia
 *  junta vários roteiros (ex.: Claude Skills), cada copy diz o seu em `producao:` e a chave vira "ideia › produção". */
export const SEP_PROD = ' › '
export const chaveProd = (p: { ideia: string | null; producao?: string | null }) => (p.ideia && p.producao ? `${p.ideia}${SEP_PROD}${p.producao}` : p.ideia ?? '')
export const ideiaDaChave = (k: string) => k.split(SEP_PROD)[0]
export type EstadoCanvas = {
  ideias: Ideia[]; entradas: Entrada[]; producoes: Producao[]
  pos: Record<string, { x: number; y: number }>; arquivados: string[]; formatos: Formato[]
  ordem?: Record<string, string[]>   // mapa mental: a ordem dos filhos de cada card (arrastada à mão)
  canvas?: InfoCanvas
  produtos?: Produto[]
  visiveis?: string[]   // cards trazidos à mão (⌘↵, Mover para): aparecem mesmo publicados no Inbox
  novas?: string[]      // 💡 ideias que chegaram (radar, link, Claude) e ainda não foram usadas nem vistas: selo NOVO
}
export type Alvo = { raiz: Raiz; nome: string }
/** De onde a nota foi aberta: o modal mostra um botão para voltar para lá. */
export type Voltar = { rotulo: string; fn: () => void }

export const ORDEM_FORMATO = ['📱', '💰', '🏞️', '📝', '📺', '🎥', '🗣️', '🎙️']
export const STATUS: { k: StatusProd; nome: string; marca: string }[] = [
  { k: 'ideia', nome: 'Priorizar', marca: '💡' },
  { k: 'gravar', nome: 'Gravar', marca: '🔴' },   // copy pronta, falta gravar
  { k: 'edicao', nome: 'Em edição', marca: '🧑🏼‍🔧' },
  { k: 'agendado', nome: 'Agendado', marca: '🔹' },
  { k: 'publicado', nome: 'Publicado', marca: '✅' },
]

export const idDe = (a: Alvo) => (a.raiz === 'ideias' ? `i:${a.nome}` : a.raiz === 'entradas' ? `e:${a.nome}` : `p:${a.raiz}/${a.nome}`)

export const porFormato = (a: Producao, b: Producao) => {
  const ia = ORDEM_FORMATO.indexOf(a.formato), ib = ORDEM_FORMATO.indexOf(b.formato)
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.nome.localeCompare(b.nome)
}

/** Canvas: onde a nota vive (o `grupo:` dela; sem grupo, o 📥 Inbox). O app diz à API em qual está pelo cabeçalho
 *  X-Canvas. Produto (FIA, FID…) é outra coisa: as tags da nota; no canvas é só filtro e uma corzinha no card. */
export type InfoCanvas = { slug: string; nome: string; icone: string; cor: string; arquivado?: boolean }
export type Produto = { slug: string; nome: string; icone: string; tags: string[]; cor: string }
export type ResumoCanvas = InfoCanvas & { ideias: number; producoes: number; vsls: number; publicadas: number; produtos: Record<string, number> }
export const INBOX = 'inbox'
let canvasAtual = INBOX
export const usarCanvas = (slug: string) => { canvasAtual = slug }
export const cabecalhoCanvas = () => ({ 'X-Canvas': canvasAtual })
/** Slug do canvas aberto. */
export const canvasAberto = () => canvasAtual
/** A nota é do produto se tem uma tag que começa por um dos prefixos dele. */
export const ehDoProduto = (tags: string[] | undefined, p: Produto) => (tags ?? []).some((t) => p.tags.some((x) => t.replace(/^#/, '').startsWith(x)))
export const produtosDe = (tags: string[] | undefined, ps: Produto[]) => ps.filter((p) => ehDoProduto(tags, p))
/** Arrastar para reordenar: tira `de` e põe no lugar de `para` (depois dele se veio de cima, antes se veio de baixo). */
export const moverNaLista = (slugs: string[], de: string, para: string) => {
  if (de === para) return slugs
  const l = slugs.filter((s) => s !== de)
  const i = l.indexOf(para)
  l.splice(slugs.indexOf(de) < slugs.indexOf(para) ? i + 1 : i, 0, de)
  return l
}
export const ordenarCanvases = (slugs: string[]) =>
  fetch('/api/canvases/ordem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slugs }) })
// a última lista lida fica em memória: o modal da nota mostra as propriedades na hora e confere com o servidor por trás
let canvasesCache: ResumoCanvas[] | null = null
export const canvasesEmCache = () => canvasesCache
export const listarCanvases = () => fetch('/api/canvases').then((r) => r.json() as Promise<ResumoCanvas[]>).then((l) => { canvasesCache = l; return l })

export async function post<T = unknown>(rota: string, corpo: unknown, metodo = 'POST'): Promise<T> {
  const r = await fetch(`/api/canvas/${rota}`, { method: metodo, headers: { 'Content-Type': 'application/json', ...cabecalhoCanvas() }, body: JSON.stringify(corpo) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || 'Não deu certo.')
  return d as T
}

/** O estado de todas as notas (canvas interno `todos`), para o que é global: as pastas e as tabelas delas. */
let tudoCache: EstadoCanvas | null = null
export const tudoEmCache = () => tudoCache
export const carregarTudo = () => fetch('/api/canvas', { headers: { 'X-Canvas': 'todos' } }).then((r) => r.json() as Promise<EstadoCanvas>).then((e) => { tudoCache = e; return e })
export const carregarCanvas = () => fetch('/api/canvas', { headers: cabecalhoCanvas() }).then((r) => r.json() as Promise<EstadoCanvas>)

/** Pedido pronto para o Claude Code escrever uma saída nova a partir das irmãs. */
export const pedidoSaida = (ideia: string, nota: string, formato: string, nomeFormato: string) =>
  `Escreva a versão ${formato} ${nomeFormato} de [[${ideia}]] direto na nota [[${nota}]] (1 Copies/1 Priorizar, ela já existe e está vazia). ` +
  `Leia as outras versões já escritas (mesmo ideia:) e as entradas delas, adapte a copy para o formato (use a minha skill desse formato quando houver) e me responda com um resumo de 2 linhas.`

/** Onde o Rodrigo está no app agora: o App e o canvas atualizam e porta.vigiarOnde manda ao backend (o Claude Code
 *  lê em GET /api/onde). */
export const onde: {
  pagina: string; canvas?: { nome: string; icone: string } | null; vista?: string
  nota?: Alvo | null; selecao?: string[]; tipos?: string[]; filtro?: string; produtos?: string[] | null
} = { pagina: '' }
