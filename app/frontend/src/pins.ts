import { useEffect, useState } from 'react'

/** As copies pinadas (📌, `p:raiz/nome`), guardadas em `canvas-pinados` (nome legado); quem pina avisa com o evento
 *  `pinados-mudou`. */
const CHAVE = 'canvas-pinados'
const EVENTO_PINS = 'pinados-mudou'

/** Só copies (`p:`). Os pins de 💡 (`i:`) antigos viram a copy que nasceu dela (em Priorizar). */
const pinavel = (id: string) => id.startsWith('p:')
const daIdeia = (id: string) => (id.startsWith('i:') ? `p:priorizar/${id.slice(2).replace(/^💡\s*/, '')}` : id)

function lerPins(): string[] {
  try { return [...new Set((JSON.parse(localStorage.getItem(CHAVE) || '[]') as string[]).map(daIdeia))].filter(pinavel) } catch { return [] }
}

export function alternarPin(id: string, sim?: boolean) {
  const l = lerPins()
  const pinar = sim ?? !l.includes(id)
  const novos = pinar ? [id, ...l.filter((x) => x !== id)] :   // pinado novo entra no topo
    l.filter((x) => x !== id)
  try { localStorage.setItem(CHAVE, JSON.stringify(novos)) } catch { /* sem storage */ }
  window.dispatchEvent(new Event(EVENTO_PINS))
}

/** Lista atual dos pinados, que acompanha qualquer mudança (canvas, modal, tabela). */
export function usePins(): string[] {
  const [l, setL] = useState(lerPins)
  useEffect(() => {
    const f = () => setL(lerPins())
    window.addEventListener(EVENTO_PINS, f); window.addEventListener('storage', f)
    return () => { window.removeEventListener(EVENTO_PINS, f); window.removeEventListener('storage', f) }
  }, [])
  return l
}
