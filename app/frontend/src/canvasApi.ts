import type { Raiz } from './notas'

type Midia = { links: string[]; imagem: string | null; video?: string | null; copia: boolean }
export type StatusProd = 'ideia' | 'gravar' | 'edicao' | 'agendado' | 'publicado' | 'ativo' | 'inativo' | 'arquivado'
/** Os de conclusão (moram em 2 Publicados): saem da lista padrão da Criação. */
export const FIM: StatusProd[] = ['publicado', 'ativo', 'inativo', 'arquivado']
export type Producao = {
  nome: string; raiz: 'priorizar' | 'publicados'; status: StatusProd; scheduled: string | null; ano: string
  formato: string; origem?: string | null; previa: string; mtime: number; datas?: string[]
  palavras?: number; criado?: number
  winner?: boolean   // tag 🔥 na nota: performou acima da média
  tags?: string[]
  categoria?: string | null   // `categoria:` da copy: o grupo dela na Criação e no menu de categorias
  nova?: boolean              // criada (⌘K, radar) ou com ideia plugada e ainda não aberta: "new" e 💡 na categoria
} & Midia
export type Formato = { emoji: string; nome: string }
/** GET /api/copies: todas as copies do vault e os formatos. */
export type EstadoCanvas = { producoes: Producao[]; formatos: Formato[] }
export type Alvo = { raiz: Raiz; nome: string }

export const ORDEM_FORMATO = ['📱', '💰', '🏞️', '📝', '📺', '🎥', '🗣️', '🎙️']
export const STATUS: { k: StatusProd; nome: string; marca: string }[] = [
  { k: 'ideia', nome: 'Ideia', marca: '💡' },
  { k: 'gravar', nome: 'Gravar', marca: '🔴' },   // copy pronta, falta gravar
  { k: 'edicao', nome: 'Em edição', marca: '🧑🏼‍🔧' },
  { k: 'agendado', nome: 'Agendado', marca: '🔹' },
  { k: 'publicado', nome: 'Publicado', marca: '✅' },   // orgânico
  { k: 'ativo', nome: 'Ativo', marca: '🟢' },           // VSL e ads no ar
  { k: 'inativo', nome: 'Inativo', marca: '⏸️' },      // VSL e ads parados
  { k: 'arquivado', nome: 'Arquivado', marca: '🗄️' },  // fora das listas (só no filtro dele e em Arquivados)
]

export async function post<T = unknown>(rota: string, corpo: unknown, metodo = 'POST'): Promise<T> {
  const r = await fetch(`/api/copies/${rota}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || 'Não deu certo.')
  return d as T
}

/** Todas as copies (GET /api/copies), para a Redação. Pedidos ao mesmo tempo viram um só, e um pedido feito enquanto
 *  outro está no ar sai de novo quando ele volta (a resposta que já estava a caminho pode ser de antes da mudança). */
let tudoCache: EstadoCanvas | null = null
let noAr: Promise<EstadoCanvas> | null = null
let deNovo: Promise<EstadoCanvas> | null = null
export const tudoEmCache = () => tudoCache
/** Copies que o app acabou de criar e abriu sozinho: essa primeira abertura não conta como "vista" (o new fica). */
export const recemCriadas = new Set<string>()
const buscar = () => fetch('/api/copies', { cache: 'no-store' }).then((r) => r.json() as Promise<EstadoCanvas>).then((e) => { tudoCache = e; return e })
export function carregarTudo(): Promise<EstadoCanvas> {
  if (!noAr) { noAr = buscar().finally(() => { noAr = null }); return noAr }
  deNovo ??= noAr.catch(() => null).then(() => { deNovo = null; return carregarTudo() })
  return deNovo
}

/** Onde o Rodrigo está no app agora (a página e a nota aberta): porta.vigiarOnde manda ao backend (GET /api/onde). */
export const onde: { pagina: string; nota?: Alvo | null } = { pagina: '' }
