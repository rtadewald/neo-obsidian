import type { Raiz } from './notas'

export type Midia = { links: string[]; imagem: string | null; copia: boolean }
export type Ideia = { nome: string; previa: string; fontes: string[]; mtime: number; grupo?: string | null } & Partial<Midia>
export type Entrada = { nome: string; url: string; tipo: string; thumb: string; previa: string; mtime: number; grupo?: string | null }
export type StatusProd = 'ideia' | 'edicao' | 'agendado' | 'publicado'
export type Producao = {
  nome: string; raiz: 'priorizar' | 'publicados'; status: StatusProd; scheduled: string | null; ano: string
  formato: string; ideia: string | null; previa: string; mtime: number; grupo?: string | null
  palavras?: number; criado?: number
} & Midia
export type Formato = { emoji: string; nome: string }
export type EstadoCanvas = {
  ideias: Ideia[]; entradas: Entrada[]; producoes: Producao[]
  pos: Record<string, { x: number; y: number }>; arquivados: string[]; formatos: Formato[]; caixas: Caixa[]
}
/** Caixa do canvas: demarcação colorida; as notas dentro dela têm `grupo: <nome>`. */
export type Caixa = { id: string; nome: string; cor: string; x: number; y: number; w: number; h: number; arquivada: boolean }
/** Tons pastel das caixas. */
export const CORES_CAIXA = ['#f6e3b4', '#f8d3c5', '#f3c9d9', '#dccff2', '#c9daf5', '#c4e6e0', '#d3ecc4', '#e6e1d8']
export type Alvo = { raiz: Raiz; nome: string }
/** De onde a nota foi aberta: o modal mostra um botão para voltar para lá. */
export type Voltar = { rotulo: string; fn: () => void }

export const ORDEM_FORMATO = ['📱', '💰', '🏞️', '📝', '📺', '🎥', '🗣️', '🎙️']
export const STATUS: { k: StatusProd; nome: string; marca: string }[] = [
  { k: 'ideia', nome: 'Priorizar', marca: '💡' },
  { k: 'edicao', nome: 'Em edição', marca: '🧑🏼‍🔧' },
  { k: 'agendado', nome: 'Agendado', marca: '🔹' },
  { k: 'publicado', nome: 'Publicado', marca: '✅' },
]

export const idDe = (a: Alvo) => (a.raiz === 'ideias' ? `i:${a.nome}` : a.raiz === 'entradas' ? `e:${a.nome}` : `p:${a.raiz}/${a.nome}`)

export const porFormato = (a: Producao, b: Producao) => {
  const ia = ORDEM_FORMATO.indexOf(a.formato), ib = ORDEM_FORMATO.indexOf(b.formato)
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.nome.localeCompare(b.nome)
}

export async function post<T = unknown>(rota: string, corpo: unknown, metodo = 'POST'): Promise<T> {
  const r = await fetch(`/api/canvas/${rota}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || 'Não deu certo.')
  return d as T
}

export const carregarCanvas = () => fetch('/api/canvas').then((r) => r.json() as Promise<EstadoCanvas>)

/** Pedido pronto para o Jarvis escrever uma saída nova a partir das irmãs. */
export const pedidoSaida = (ideia: string, nota: string, formato: string, nomeFormato: string) =>
  `Escreva a versão ${formato} ${nomeFormato} da ideia [[${ideia}]] direto na nota [[${nota}]] (1 Copies/1 Priorizar, ela já existe e está vazia). ` +
  `Leia a 💡 ideia, as entradas dela e as outras saídas já escritas, adapte a copy para o formato (use a minha skill desse formato quando houver) e responda só com um resumo de 2 linhas.`
