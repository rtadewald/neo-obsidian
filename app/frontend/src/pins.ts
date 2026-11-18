import { useEffect, useState } from 'react'
import { chaveProd, type Alvo, type EstadoCanvas } from './canvasApi'

/** Pinados globais (ids de card: `i:`, `g:`, `e:`, `p:raiz/nome`), guardados em `canvas-pinados`. O canvas é o dono da
 *  lista; o modal da nota e as tabelas pinam por aqui e avisam o canvas com o evento `pinados-mudou`. */
const CHAVE = 'canvas-pinados'
export const EVENTO_PINS = 'pinados-mudou'

/** Só 💡 ideias (`i:`) e categorias (`c:`) vão para a barra: o pinado abre num canvas próprio, com os filhos. */
export const pinavel = (id: string) => id.startsWith('i:') || id.startsWith('c:')

export function lerPins(): string[] {
  try { return (JSON.parse(localStorage.getItem(CHAVE) || '[]') as string[]).filter(pinavel) } catch { return [] }
}

export function alternarPin(id: string, sim?: boolean) {
  const l = lerPins()
  const pinar = sim ?? !l.includes(id)
  const novos = pinar ? [id, ...l.filter((x) => x !== id)] :   // pinado novo entra no topo
    l.filter((x) => x !== id)
  try { localStorage.setItem(CHAVE, JSON.stringify(novos)) } catch { /* sem storage */ }
  window.dispatchEvent(new Event(EVENTO_PINS))
}

/** O card onde a nota aparece no canvas: a 💡 ideia, a entrada, o card da produção (copies da mesma ideia) ou a copy solta. */
export function idDoCard(est: EstadoCanvas, a: Alvo): string {
  if (a.raiz === 'ideias') return `i:${a.nome}`
  if (a.raiz === 'entradas') return `e:${a.nome}`
  const p = est.producoes.find((x) => x.raiz === a.raiz && x.nome === a.nome)
  if (p?.ideia && p.formato !== '📺') {
    const irmas = est.producoes.filter((x) => chaveProd(x) === chaveProd(p) && x.formato !== '📺').length
    if (est.ideias.some((i) => i.nome === p.ideia) || irmas >= 2) return `g:${chaveProd(p)}`
  }
  return `p:${a.raiz}/${a.nome}`
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
