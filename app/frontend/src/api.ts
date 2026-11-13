export type Sinal = {
  id: number
  fonte: 'github' | 'huggingface' | 'hackernews' | 'x' | 'instagram'
  url: string | null
  titulo: string
  resumo: string | null
  autor: string | null
  imagem: string | null
  metricas: Record<string, unknown>
  nota: number
  destaque: string | null
  tipo: string | null
  porque: string | null
  status: 'novo' | 'salvo' | 'descartado'
  coletado_em: number
  publicado_em: string | null
  voto?: number
  interesse?: number | null
  afinidade?: number
  motivos?: string[]
  pontuacao?: number
}

export type Gosto = { likes: number; deslikes: number; gosta: string[]; evita: string[] }
export type VideoX = { url: string; w?: number; h?: number; dur?: number; gif?: boolean } | null

export type Coleta = { inicio: number; fim: number; status: string; detalhes: Record<string, unknown> } | null

export type Msg = { papel: 'usuario' | 'jarvis'; texto: string; ferramentas?: string[]; erro?: string }

const j = async <T,>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

export const api = {
  sinais: (status?: string, tipo?: string) =>
    fetch(`/api/sinais?${new URLSearchParams({ ...(status ? { status } : {}), ...(tipo ? { tipo } : {}) })}`).then(j<Sinal[]>),
  status: (id: number, status: string) =>
    fetch(`/api/sinais/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }).then(j),
  atualizar: () => fetch('/api/radar/atualizar', { method: 'POST' }).then(j<{ status: string }>),
  estado: () => fetch('/api/radar/estado').then(j<{ rodando: boolean; reavaliando: boolean; ultima: Coleta }>),
  votar: (id: number, voto: number) =>
    fetch(`/api/sinais/${id}/voto`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voto }) }).then(j),
  gosto: () => fetch('/api/radar/gosto').then(j<Gosto>),
  reavaliar: () => fetch('/api/radar/reavaliar', { method: 'POST' }).then(j<{ status: string }>),
  video: (id: number) => fetch(`/api/sinais/${id}/video`).then(j<{ video: VideoX }>),
  historico: (conversa: string) => fetch(`/api/chat/${conversa}`).then(j<{ papel: Msg['papel']; texto: string }[]>),
  metricool: () => fetch('/api/metricool/estado').then(j<{ conectado: boolean; motivo: string }>),
}

export type EventoChat =
  | { t: 'texto'; v: string }
  | { t: 'ferramenta'; nome: string; alvo: string }
  | { t: 'fim'; sessao: string; custo: number | null }
  | { t: 'erro'; v: string }

/** POST /api/chat e lê o SSE linha a linha. */
export async function conversar(corpo: { conversa: string; texto: string; sinal?: number | null }, cb: (e: EventoChat) => void) {
  const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  if (!r.ok || !r.body) throw new Error(`${r.status}`)
  const leitor = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const bloco = buf.slice(0, i)
      buf = buf.slice(i + 2)
      if (bloco.startsWith('data: ')) cb(JSON.parse(bloco.slice(6)))
    }
  }
}
