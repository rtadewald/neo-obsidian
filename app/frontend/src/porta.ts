import { carregarTudo, onde, tudoEmCache, type Alvo } from './canvasApi'

/** A porta para o Claude Code (ver backend/porta.py): códigos das notas, pedidos na fila, eventos e "onde estou". */

export const EVENTO_PEDIR = 'pedir-claude'
export const EVENTO_AVISO = 'aviso-app'

/** Trecho/nota/sinal que vai junto com o pedido. */
export type Anexo = { codigo: string; rotulo: string; linhas?: [number, number]; texto?: string }
export type PedidoAberto = { anexos: Anexo[]; texto?: string }

export const avisar = (msg: string) => window.dispatchEvent(new CustomEvent(EVENTO_AVISO, { detail: msg }))

/** Abre a caixa de pedido ao Claude com estes anexos (e um texto pronto, se houver). */
export const pedirAoClaude = (p: PedidoAberto) => window.dispatchEvent(new CustomEvent(EVENTO_PEDIR, { detail: p }))

/** Código (NEO-042) de uma nota pelo nome, do cache de todas as notas. */
export function codigoDe(nome: string): string | null {
  const t = tudoEmCache()
  if (!t) return null
  const n = [...t.producoes, ...t.ideias, ...t.entradas].find((x) => x.nome === nome) as { codigo?: string | null } | undefined
  return n?.codigo ?? null
}
export async function codigoDeAsync(nome: string): Promise<string | null> {
  return codigoDe(nome) ?? (await carregarTudo().catch(() => null), codigoDe(nome))
}

export const codigoSinal = (id: number) => `RAD-${id}`

export async function copiar(texto: string, aviso = `${texto} copiado`) {
  try { await navigator.clipboard.writeText(texto); avisar(aviso) } catch { avisar('Não consegui copiar') }
}

/** Anexo de uma nota inteira ou de um trecho dela. */
export async function anexoDaNota(a: Alvo, trecho?: { linhaIni: number; linhaFim: number; texto: string }): Promise<Anexo> {
  const codigo = (await codigoDeAsync(a.nome)) ?? a.nome
  const tem = trecho && trecho.texto.trim()
  return { codigo, rotulo: a.nome, ...(tem ? { linhas: [trecho.linhaIni, trecho.linhaFim] as [number, number], texto: trecho.texto } : {}) }
}

/** O pedido em texto puro, para colar no Claude Code quando ele não está ouvindo. */
export function pedidoEmTexto(texto: string, anexos: Anexo[]) {
  const l = anexos.map((a) => `${a.codigo}${a.linhas ? ` (linhas ${a.linhas[0]}–${a.linhas[1]})` : ''} · ${a.rotulo}`)
  return [...l, texto.trim()].filter(Boolean).join('\n')
}

/** Manda "onde estou" ao backend quando muda (o Claude lê em GET /api/onde). */
export function vigiarOnde() {
  let antes = ''
  const id = window.setInterval(() => {
    const t = tudoEmCache()
    const cod = (n: string) => (t ? codigoDe(n) : null)
    const sel = (onde.selecao ?? []).map((s) => { const nome = s.replace(/^[a-z]+:(?:[a-z]+\/)?/, ''); const c = cod(nome); return c ? `${c} · ${nome}` : s })
    const corpo = { ...onde, selecao: sel, nota: onde.nota ? { ...onde.nota, codigo: cod(onde.nota.nome) } : null }
    const j = JSON.stringify(corpo)
    if (j === antes) return
    antes = j
    fetch('/api/onde', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: j }).catch(() => { antes = '' })
  }, 1000)
  return () => window.clearInterval(id)
}

export type EventoPorta =
  | { t: 'mudou' }
  | { t: 'porta'; ouvindo: boolean }
  | { t: 'tela'; acao: string; pagina?: string; canvas?: string | null; raiz?: string; nome?: string }

/** Assina /api/eventos (reconecta sozinho). */
export function assinarEventos(cb: (ev: EventoPorta) => void) {
  const es = new EventSource('/api/eventos')
  es.onmessage = (m) => { try { cb(JSON.parse(m.data)) } catch { /* evento ruim */ } }
  return () => es.close()
}
