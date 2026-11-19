import { onde } from './canvasApi'

/** A porta para o Claude Code (ver backend/porta.py): eventos e "onde estou". */

export const EVENTO_AVISO = 'aviso-app'

export const avisar = (msg: string) => window.dispatchEvent(new CustomEvent(EVENTO_AVISO, { detail: msg }))

export async function copiar(texto: string, aviso = `${texto} copiado`) {
  try { await navigator.clipboard.writeText(texto); avisar(aviso) } catch { avisar('Não consegui copiar') }
}

/** Manda "onde estou" ao backend quando muda (o Claude lê em GET /api/onde). */
export function vigiarOnde() {
  let antes = ''
  const id = window.setInterval(() => {
    const j = JSON.stringify(onde)
    if (j === antes) return
    antes = j
    fetch('/api/onde', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: j }).catch(() => { antes = '' })
  }, 1000)
  return () => window.clearInterval(id)
}

export type EventoPorta =
  | { t: 'mudou' }
  | { t: 'ping' }
  | { t: 'tela'; acao: string; pagina?: string; canvas?: string | null; raiz?: string; nome?: string }

/** Assina /api/eventos (reconecta sozinho). */
export function assinarEventos(cb: (ev: EventoPorta) => void) {
  const es = new EventSource('/api/eventos')
  es.onmessage = (m) => { try { cb(JSON.parse(m.data)) } catch { /* evento ruim */ } }
  return () => es.close()
}
