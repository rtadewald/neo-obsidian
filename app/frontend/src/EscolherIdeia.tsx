import { useEffect, useMemo, useState } from 'react'
import { carregarTudo, type Ideia } from './canvasApi'

let cache: Ideia[] | null = null

/** Busca de 💡 ideias (de todos os canvas) para plugar um material numa ideia que já existe. Enter escolhe a primeira. */
export function EscolherIdeia({ onEscolher, desligado, placeholder = 'Buscar ideia…' }: {
  onEscolher: (nome: string) => void; desligado?: boolean; placeholder?: string
}) {
  const [ideias, setIdeias] = useState<Ideia[]>(cache ?? [])
  const [q, setQ] = useState('')
  useEffect(() => { carregarTudo().then((t) => { cache = t.ideias; setIdeias(t.ideias) }).catch(() => {}) }, [])
  const lista = useMemo(() => {
    const b = q.trim().toLowerCase()
    return ideias.filter((i) => !b || i.nome.toLowerCase().includes(b)).sort((a, b) => b.mtime - a.mtime).slice(0, 8)
  }, [ideias, q])
  return (
    <div className="escolher-ideia">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Buscar ideia" disabled={desligado}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && lista[0]) { e.preventDefault(); onEscolher(lista[0].nome) } }} />
      <div className="escolher-ideia-lista">
        {lista.map((i) => (
          <button key={i.nome} type="button" role="menuitem" disabled={desligado} onClick={() => onEscolher(i.nome)} title={i.nome}>
            {i.nome.replace(/^💡\s*/, '💡 ')}
          </button>
        ))}
        {!lista.length && <p className="mudo">Nenhuma ideia com esse nome.</p>}
      </div>
    </div>
  )
}
