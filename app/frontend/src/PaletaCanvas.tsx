import { useEffect, useMemo, useRef, useState } from 'react'
import { INBOX, listarCanvases, type ResumoCanvas } from './canvasApi'

/** ⌘P: navegar entre os canvas. Os ativos primeiro (na ordem da lista da esquerda), o Inbox, e os arquivados mais abaixo.
 *  Digitar filtra pelo nome; ↑↓ escolhem; ↵ abre. */
const n = (k: number, um: string, varios: string) => `${k} ${k === 1 ? um : varios}`
const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function PaletaCanvas({ atual, onIr, onFechar }: { atual: string | null; onIr: (slug: string) => void; onFechar: () => void }) {
  const [todos, setTodos] = useState<ResumoCanvas[] | null>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const lista = useRef<HTMLDivElement>(null)
  useEffect(() => { listarCanvases().then(setTodos).catch(() => setTodos([])) }, [])

  const { ativos, arquivados } = useMemo(() => {
    const t = sem(q.trim())
    const casa = (c: ResumoCanvas) => !t || t.split(/\s+/).every((p) => sem(c.nome).includes(p))
    const l = (todos ?? []).filter(casa)
    return { ativos: l.filter((c) => !c.arquivado), arquivados: l.filter((c) => c.arquivado) }
  }, [todos, q])
  const ordem = [...ativos, ...arquivados]
  useEffect(() => setSel(0), [q])
  useEffect(() => { lista.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const ir = (c?: ResumoCanvas) => { if (c) { onIr(c.slug); onFechar() } }
  const item = (c: ResumoCanvas, i: number) => (
    <button key={c.slug} role="option" aria-selected={i === sel} className={`${i === sel ? 'is-sel' : ''} ${c.arquivado ? 'is-arquivado' : ''}`}
      onMouseMove={() => setSel(i)} onClick={() => ir(c)}>
      <span className="paleta-canvas-ic">{c.slug === INBOX ? '📥' : c.icone}</span>
      <span className="paleta-nome">{c.nome}</span>
      <span className="paleta-pasta">{c.slug === atual ? 'aberto · ' : ''}{n(c.producoes + c.vsls, 'produção', 'produções')} · {n(c.ideias, 'ideia', 'ideias')}</span>
    </button>
  )

  return (
    <div className="paleta-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="paleta glass glass--light" role="dialog" aria-label="Ir para um canvas"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onFechar() }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(ordem.length - 1, s + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
          else if (e.key === 'Enter') { e.preventDefault(); ir(ordem[sel]) }
        }}>
        <label className="paleta-campo">
          <span className="novo-rapido-emoji">🗂️</span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ir para o canvas…" />
        </label>
        <div className="paleta-lista" ref={lista} role="listbox">
          {ativos.map((c, i) => item(c, i))}
          {arquivados.length > 0 && <p className="paleta-secao">Arquivados</p>}
          {arquivados.map((c, i) => item(c, ativos.length + i))}
          {todos && !ordem.length && <p className="mudo paleta-vazio">Nenhum canvas com esse nome.</p>}
          {!todos && <p className="mudo paleta-vazio">Carregando…</p>}
        </div>
        <footer className="paleta-pe"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>↵</kbd> abrir</span><span><kbd>⌘O</kbd> buscar notas</span><span><kbd>esc</kbd> fechar</span></footer>
      </div>
    </div>
  )
}
