import type { Raiz } from './notas'

export type Midia = { links: string[]; imagem: string | null; copia: boolean }
export type Ideia = { nome: string; previa: string; fontes: string[]; mtime: number; grupo?: string | null; canvas?: string | null; tags?: string[] } & Partial<Midia>
export type Entrada = { nome: string; url: string; tipo: string; thumb: string; previa: string; mtime: number; grupo?: string | null; tags?: string[] }
export type StatusProd = 'ideia' | 'edicao' | 'agendado' | 'publicado'
export type Producao = {
  nome: string; raiz: 'priorizar' | 'publicados'; status: StatusProd; scheduled: string | null; ano: string
  formato: string; ideia: string | null; previa: string; mtime: number; grupo?: string | null; canvas?: string | null
  palavras?: number; criado?: number
  winner?: boolean   // tag 🔥 na nota: performou acima da média
  tags?: string[]
} & Midia
export type Formato = { emoji: string; nome: string }
export type EstadoCanvas = {
  ideias: Ideia[]; entradas: Entrada[]; producoes: Producao[]
  pos: Record<string, { x: number; y: number }>; arquivados: string[]; formatos: Formato[]
  canvas?: InfoCanvas
  produtos?: Produto[]
  visiveis?: string[]   // cards trazidos à mão (⌘↵, Mover para): aparecem mesmo publicados no Inbox
}
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

/** Canvas: onde a nota vive (o `grupo:` dela; sem grupo, o 📥 Inbox). O app diz à API em qual está pelo cabeçalho
 *  X-Canvas. Produto (FIA, FID…) é outra coisa: as tags da nota; no canvas é só filtro e uma corzinha no card. */
export type InfoCanvas = { slug: string; nome: string; icone: string; cor: string }
export type Produto = { slug: string; nome: string; icone: string; tags: string[]; cor: string }
export type ResumoCanvas = InfoCanvas & { ideias: number; producoes: number; vsls: number; publicadas: number; produtos: Record<string, number> }
export const INBOX = 'inbox'
let canvasAtual = INBOX
export const usarCanvas = (slug: string) => { canvasAtual = slug }
export const cabecalhoCanvas = () => ({ 'X-Canvas': canvasAtual })
/** A nota é do produto se tem uma tag que começa por um dos prefixos dele. */
export const ehDoProduto = (tags: string[] | undefined, p: Produto) => (tags ?? []).some((t) => p.tags.some((x) => t.replace(/^#/, '').startsWith(x)))
export const produtosDe = (tags: string[] | undefined, ps: Produto[]) => ps.filter((p) => ehDoProduto(tags, p))
export const listarCanvases = () => fetch('/api/canvases').then((r) => r.json() as Promise<ResumoCanvas[]>)

export async function post<T = unknown>(rota: string, corpo: unknown, metodo = 'POST'): Promise<T> {
  const r = await fetch(`/api/canvas/${rota}`, { method: metodo, headers: { 'Content-Type': 'application/json', ...cabecalhoCanvas() }, body: JSON.stringify(corpo) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || 'Não deu certo.')
  return d as T
}

/** O estado de todas as notas (canvas interno `todos`), para o que é global: as pastas e as tabelas delas. */
export const carregarTudo = () => fetch('/api/canvas', { headers: { 'X-Canvas': 'todos' } }).then((r) => r.json() as Promise<EstadoCanvas>)
export const carregarCanvas = () => fetch('/api/canvas', { headers: cabecalhoCanvas() }).then((r) => r.json() as Promise<EstadoCanvas>)

/** Pedido pronto para o Jarvis escrever uma saída nova a partir das irmãs. */
export const pedidoSaida = (ideia: string, nota: string, formato: string, nomeFormato: string) =>
  `Escreva a versão ${formato} ${nomeFormato} da ideia [[${ideia}]] direto na nota [[${nota}]] (1 Copies/1 Priorizar, ela já existe e está vazia). ` +
  `Leia a 💡 ideia, as entradas dela e as outras saídas já escritas, adapte a copy para o formato (use a minha skill desse formato quando houver) e responda só com um resumo de 2 linhas.`

/** Onde o Rodrigo está no app agora: o App e o canvas atualizam, o chat manda junto com cada mensagem (o Jarvis
 *  recebe no contexto e ajuda direto dali). */
export const onde: {
  pagina: string; canvas?: { nome: string; icone: string } | null; vista?: string
  nota?: Alvo | null; selecao?: string[]; tipos?: string[]; filtro?: string; produtos?: string[] | null
} = { pagina: '' }
export function descreverOnde() {
  const l = [`- Tela: ${onde.pagina || '?'}`]
  if (onde.pagina === 'Canvas') {
    l.push(onde.canvas ? `- Canvas: ${onde.canvas.icone} ${onde.canvas.nome}` : '- Canvas: página inicial (lista dos canvas)')
    if (onde.canvas) {
      if (onde.vista && onde.vista !== 'principal') l.push(`- Vista: ${onde.vista}`)
      if (onde.produtos) l.push(`- Filtro de produto: ${onde.produtos.join(', ') || 'nenhum'}`)
      if (onde.filtro && onde.filtro !== 'todos') l.push(`- Filtro de status: ${onde.filtro}`)
      if (onde.tipos && onde.tipos.length < 3) l.push(`- Tipos de card visíveis: ${onde.tipos.join(', ') || 'nenhum'}`)
      if (onde.selecao?.length) l.push(`- Cards selecionados (${onde.selecao.length}): ${onde.selecao.slice(0, 12).join(' · ')}`)
    }
  }
  if (onde.nota) l.push(`- Nota aberta no modal: [[${onde.nota.nome}]] (${onde.nota.raiz})`)
  return l.join('\n')
}
