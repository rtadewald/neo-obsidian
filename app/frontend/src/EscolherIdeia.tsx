import { useEffect, useMemo, useState } from 'react'
import { carregarTudo } from './canvasApi'

type Item = { nome: string; mtime: number }
let cache: Item[] | null = null

/** Busca de copies (de todos os canvas) para plugar um material numa copy que já existe. Enter escolhe a primeira. */
export function EscolherIdeia({ onEscolher, desligado, placeholder = 'Buscar copy…' }: {
  onEscolher: (nome: string) => void; desligado?: boolean; placeholder?: string
}) {
  const [ideias, setIdeias] = useState<Item[]>(cache ?? [])
  const [q, setQ] = useState('')
  useEffect(() => { carregarTudo().then((t) => { cache = t.producoes; setIdeias(t.producoes) }).catch(() => {}) }, [])
  const lista = useMemo(() => {
    const b = q.trim().toLowerCase()
    return ideias.filter((i) => !b || i.nome.toLowerCase().includes(b)).sort((a, b) => b.mtime - a.mtime).slice(0, 8)
  }, [ideias, q])
  return (
    <div className="escolher-ideia">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Buscar copy" disabled={desligado}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && lista[0]) { e.preventDefault(); onEscolher(lista[0].nome) } }} />
      <div className="escolher-ideia-lista">
        {lista.map((i) => (
          <button key={i.nome} type="button" role="menuitem" disabled={desligado} onClick={() => onEscolher(i.nome)} title={i.nome}>
            {i.nome}
          </button>
        ))}
        {!lista.length && <p className="mudo">Nenhuma copy com esse nome.</p>}
      </div>
    </div>
  )
}
