import type { Raiz } from './notas'

export type Midia = { links: string[]; imagem: string | null; video?: string | null; copia: boolean }
export type Ideia = { nome: string; previa: string; fontes: string[]; mtime: number; tags?: string[]; categoria?: string | null; material?: boolean } & Partial<Midia>
export type Entrada = { nome: string; url: string; tipo: string; thumb: string; previa: string; mtime: number; tags?: string[] }
export type StatusProd = 'ideia' | 'gravar' | 'edicao' | 'agendado' | 'publicado'
export type Producao = {
  nome: string; raiz: 'priorizar' | 'publicados'; status: StatusProd; scheduled: string | null; ano: string
  formato: string; ideia: string | null; producao?: string | null; origem?: string | null; previa: string; mtime: number; datas?: string[]
  palavras?: number; criado?: number
  winner?: boolean   // tag 🔥 na nota: performou acima da média
  tags?: string[]
  categoria?: string | null   // `categoria:` da copy: a caixa do mapa mental onde ela vive
  arquivado?: boolean         // `arquivado: true`: fora da Criação (botão direito → Arquivar)
} & Midia
export type Formato = { emoji: string; nome: string }
/** A produção 🎬 de uma copy: as copies com a mesma chave viram um card só. Normalmente é a ideia; quando uma ideia
 *  junta vários roteiros (ex.: Claude Skills), cada copy diz o seu em `producao:` e a chave vira "ideia › produção". */
export const SEP_PROD = ' › '
export const chaveProd = (p: { ideia: string | null; producao?: string | null }) => (p.ideia && p.producao ? `${p.ideia}${SEP_PROD}${p.producao}` : p.ideia ?? '')
export const ideiaDaChave = (k: string) => k.split(SEP_PROD)[0]
export type EstadoCanvas = {
  ideias: Ideia[]; entradas: Entrada[]; producoes: Producao[]
  formatos: Formato[]
  novas?: string[]      // 💡 ideias que chegaram (radar, link, Claude) e ainda não foram usadas nem vistas: selo NOVO
}
export type Alvo = { raiz: Raiz; nome: string }
/** De onde a nota foi aberta: o modal mostra um botão para voltar para lá. */
export type Voltar = { rotulo: string; fn: () => void }

export const ORDEM_FORMATO = ['📱', '💰', '🏞️', '📝', '📺', '🎥', '🗣️', '🎙️']
export const STATUS: { k: StatusProd; nome: string; marca: string }[] = [
  { k: 'ideia', nome: 'Ideia', marca: '💡' },
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

export async function post<T = unknown>(rota: string, corpo: unknown, metodo = 'POST'): Promise<T> {
  const r = await fetch(`/api/copies/${rota}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || 'Não deu certo.')
  return d as T
}

/** Todas as copies (GET /api/copies), para a Redação. */
let tudoCache: EstadoCanvas | null = null
export const tudoEmCache = () => tudoCache
export const carregarTudo = () => fetch('/api/copies', { cache: 'no-store' }).then((r) => r.json() as Promise<EstadoCanvas>).then((e) => { tudoCache = e; return e })

/** Pedido pronto para o Claude Code escrever uma saída nova a partir das irmãs. */
export const pedidoSaida = (ideia: string, nota: string, formato: string, nomeFormato: string) =>
  `Escreva a versão ${formato} ${nomeFormato} de [[${ideia}]] direto na nota [[${nota}]] (1 Copies/1 Priorizar, ela já existe e está vazia). ` +
  `Leia as outras versões já escritas (mesmo ideia:) e as entradas delas, adapte a copy para o formato (use a minha skill desse formato quando houver) e me responda com um resumo de 2 linhas.`

/** Onde o Rodrigo está no app agora (a página e a nota aberta): porta.vigiarOnde manda ao backend (GET /api/onde). */
export const onde: { pagina: string; nota?: Alvo | null } = { pagina: '' }
