import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icone } from './Icone'
import { ROTULO, type Raiz } from './notas'

const chave = (r: string, n: string) => `${r}/${n}`

/* ---------- busca rápida (⌘P) ---------- */

/** raiz 'grupo': 💡 ideia que existe só como grupo de copies; abre na versão principal (`abrir`). */
type Entrada = { nome: string; raiz: Raiz | 'grupo'; mtime: number; abrir?: { raiz: Raiz; nome: string }; versoes?: number }

/** Últimas notas abertas (a mais recente primeiro), guardadas no navegador: com a busca vazia, a ⌘P/⌘O começa por elas. */
const RECENTES = 'notas-recentes'
const lerRecentes = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENTES) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
export function lembrarAberta(raiz: Raiz, nome: string) {
  try { const k = chave(raiz, nome); localStorage.setItem(RECENTES, JSON.stringify([k, ...lerRecentes().filter((x) => x !== k)].slice(0, 60))) } catch { /* sem storage */ }
}

/** Pontua como o quick switcher do Obsidian: trecho contínuo vale mais, letras em sequência valem menos. */
const sem = (s: string) => [...s].map((c) => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0) || c).join('')

function casar(q: string, nome: string): { p: number; marcas: number[] } | null {
  const a = sem(nome)   // mesmo comprimento que o nome (um caractere por caractere), para o realce bater
  const b = sem(q)
  const i = a.indexOf(b)
  if (i >= 0) return { p: 1000 - i - a.length * 0.1 + (i === 0 || a[i - 1] === ' ' ? 200 : 0), marcas: [...Array(b.length)].map((_, k) => i + k) }
  // cada palavra da busca aparece em algum lugar do nome
  const palavras = b.split(/\s+/).filter(Boolean)
  const marcas: number[] = []
  let p = 700 - a.length * 0.1
  for (const w of palavras) {
    const k = a.indexOf(w)
    if (k < 0) { p = -1; break }
    for (let x = 0; x < w.length; x++) marcas.push(k + x)
    p -= k * 0.5
  }
  if (p >= 0) return { p, marcas }
  // letras em sequência (como "vsljrv")
  const seq: number[] = []
  const c = b.replace(/\s+/g, '')
  let j = 0
  for (let k = 0; k < a.length && j < c.length; k++) if (a[k] === c[j]) { seq.push(k); j++ }
  if (j < c.length) return null
  return { p: 400 - (seq[seq.length - 1] - seq[0]) - a.length * 0.1, marcas: seq }
}

export function Paleta({ onFechar, onAbrir, onCriar, onImportar }: { onFechar: () => void; onAbrir: (r: Raiz, n: string) => void; onCriar: (t: string) => void
  onImportar?: (r: Raiz, n: string) => void   // ⌘↵: traz a nota para o canvas aberto
}) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState<Entrada[]>([])
  const [sel, setSel] = useState(0)
  const lista = useRef<HTMLDivElement>(null)

  useEffect(() => { fetch('/api/notas-indice').then((r) => r.json()).then((d) => setIdx(d.itens)).catch(() => {}) }, [])

  const res = useMemo(() => {
    const peso: Record<Raiz | 'grupo', number> = { ideias: 25, grupo: 25, priorizar: 20, skills: 10, entradas: 5, publicados: 0 }
    if (!q.trim()) {   // busca vazia: as últimas abertas primeiro, depois as editadas mais recentemente
      const porChave = new Map(idx.map((e) => [chave(e.raiz, e.nome), e]))
      const recentes = lerRecentes().map((k) => porChave.get(k)).filter((e): e is Entrada => !!e)
      const vistas = new Set(recentes.map((e) => chave(e.raiz, e.nome)))
      const resto = [...idx].filter((e) => e.raiz !== 'publicados' && !vistas.has(chave(e.raiz, e.nome))).sort((a, b) => b.mtime - a.mtime)
      return [...recentes, ...resto].slice(0, 30).map((e) => ({ e, marcas: [] as number[] }))
    }
    return idx.map((e) => ({ e, m: casar(q.trim(), e.nome) })).filter((x) => x.m)
      .sort((a, b) => (b.m!.p + peso[b.e.raiz]) - (a.m!.p + peso[a.e.raiz])).slice(0, 40).map((x) => ({ e: x.e, marcas: x.m!.marcas }))
  }, [q, idx])

  const abrirEntrada = (e: Entrada) => (e.abrir ? onAbrir(e.abrir.raiz, e.abrir.nome) : onAbrir(e.raiz as Raiz, e.nome))
  const criar = q.trim() && !res.some((r) => r.e.nome.toLowerCase() === q.trim().toLowerCase())
  const total = res.length + (criar ? 1 : 0)
  useEffect(() => setSel(0), [q])
  useEffect(() => { lista.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  function tecla(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onFechar() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % Math.max(total, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + total) % Math.max(total, 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const it = res[sel]?.e
      if (sel < res.length && (e.metaKey || e.ctrlKey) && onImportar) onImportar(it.abrir?.raiz ?? (it.raiz as Raiz), it.abrir?.nome ?? it.nome)
      else if (sel < res.length) abrirEntrada(it)
      else if (criar) onCriar(q.trim())
    }
  }

  const realce = (nome: string, marcas: number[]) => {
    if (!marcas.length) return nome
    const s = new Set(marcas)
    return [...nome].map((c, i) => (s.has(i) ? <b key={i}>{c}</b> : c))
  }

  return (
    <div className="paleta-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="paleta glass glass--light" role="dialog" aria-label="Buscar notas">
        <label className="paleta-campo">
          <Icone n="busca" t={17} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={tecla} placeholder="Buscar ideia, copy ou skill…" />
        </label>
        <div className="paleta-lista" ref={lista} role="listbox">
          {res.map(({ e, marcas }, i) => (
            <button key={chave(e.raiz, e.nome)} role="option" aria-selected={i === sel} className={i === sel ? 'is-sel' : ''}
              onMouseMove={() => setSel(i)} onClick={() => abrirEntrada(e)}>
              <span className="paleta-nome">{realce(e.nome, marcas)}</span>
              <span className="paleta-pasta">{e.raiz === 'grupo' ? `Ideia · ${e.versoes} versões` : ROTULO[e.raiz]}</span>
            </button>
          ))}
          {criar && (
            <button className={sel === res.length ? 'is-sel' : ''} onMouseMove={() => setSel(res.length)} onClick={() => onCriar(q.trim())}>
              <span className="paleta-nome"><Icone n="mais" t={14} /> Criar ideia “{q.trim()}”</span>
              <span className="paleta-pasta">Ideias</span>
            </button>
          )}
          {!total && <p className="mudo paleta-vazio">Carregando…</p>}
        </div>
        <footer className="paleta-pe"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>↵</kbd> abrir</span>{onImportar && <span><kbd>⌘↵</kbd> trazer pro canvas</span>}<span><kbd>esc</kbd> fechar</span></footer>
      </div>
    </div>
  )
}
