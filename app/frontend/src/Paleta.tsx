import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icone } from './Icone'
import { ROTULO, type Raiz } from './notas'

const chave = (r: string, n: string) => `${r}/${n}`

/* ---------- busca rápida de notas (⌘O) ---------- */

type Entrada = { nome: string; raiz: Raiz; mtime: number; previa?: string }
/** Achado dentro do texto (GET /api/notas-busca): o trecho e as posições [início, tamanho] das palavras nele. */
type Achado = { nome: string; raiz: Raiz; mtime: number; trecho: string; marcas: [number, number][] }

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
  // depois dos nomes, a busca entra no texto das notas (no servidor, 150 ms depois de parar de digitar)
  const [achados, setAchados] = useState<Achado[]>([])
  useEffect(() => {
    const termo = q.trim()
    if (termo.length < 2) { setAchados([]); return }
    const c = new AbortController()
    const id = window.setTimeout(() => {
      fetch(`/api/notas-busca?q=${encodeURIComponent(termo)}`, { signal: c.signal }).then((r) => r.json()).then((d) => setAchados(d.itens ?? [])).catch(() => {})
    }, 150)
    return () => { window.clearTimeout(id); c.abort() }
  }, [q])

  const res = useMemo(() => {
    const peso: Record<Raiz, number> = { ideias: 0, entradas: 0, priorizar: 20, skills: 10, publicados: 0 }
    if (!q.trim()) {   // busca vazia: as últimas abertas primeiro, depois todo o resto de 1 Copies (publicados inclusive), das editadas mais recentemente
      const porChave = new Map(idx.map((e) => [chave(e.raiz, e.nome), e]))
      const recentes = lerRecentes().map((k) => porChave.get(k)).filter((e): e is Entrada => !!e)
      const vistas = new Set(recentes.map((e) => chave(e.raiz, e.nome)))
      const resto = [...idx].filter((e) => !vistas.has(chave(e.raiz, e.nome))).sort((a, b) => b.mtime - a.mtime)
      return [...recentes, ...resto].map((e) => ({ e, marcas: [] as number[] }))
    }
    const porNome = idx.map((e) => ({ e, m: casar(q.trim(), e.nome) })).filter((x) => x.m)
      .sort((a, b) => (b.m!.p + peso[b.e.raiz]) - (a.m!.p + peso[a.e.raiz])).map((x) => ({ e: x.e, marcas: x.m!.marcas, p: x.m!.p }))
    // 1º o nome com o trecho ou as palavras; 2º quem tem as palavras dentro do texto; por último o nome que só casa
    // letra a letra (aproximado: "vsljrv"), que costuma ser ruído
    const forte = porNome.filter((x) => x.p >= 500), fraco = porNome.filter((x) => x.p < 500)
    const vistos = new Set(forte.map((x) => chave(x.e.raiz, x.e.nome)))
    const porTexto = achados.filter((a) => !vistos.has(chave(a.raiz, a.nome))).map((a) => ({ e: { nome: a.nome, raiz: a.raiz, mtime: a.mtime } as Entrada, marcas: [] as number[], p: 0 }))
    const noTexto = new Set(porTexto.map((x) => chave(x.e.raiz, x.e.nome)))
    return [...forte, ...porTexto, ...fraco.filter((x) => !noTexto.has(chave(x.e.raiz, x.e.nome)))]
  }, [q, idx, achados])
  const trechoDe = useMemo(() => new Map(achados.map((a) => [chave(a.raiz, a.nome), a])), [achados])

  const abrirEntrada = (e: Entrada) => onAbrir(e.raiz, e.nome)
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
      if (sel < res.length && (e.metaKey || e.ctrlKey) && onImportar) onImportar(it.raiz, it.nome)
      else if (sel < res.length) abrirEntrada(it)
      else if (criar) onCriar(q.trim())
    }
  }

  const realceTrecho = (a: Achado) => {
    const partes: ReactNode[] = []
    let i = 0
    for (const [k, n] of [...a.marcas].sort((x, y) => x[0] - y[0])) {
      if (k < i) continue
      partes.push(a.trecho.slice(i, k), <mark key={k}>{a.trecho.slice(k, k + n)}</mark>)
      i = k + n
    }
    partes.push(a.trecho.slice(i))
    return partes
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
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={tecla} placeholder="Buscar pelo nome e dentro das copies e skills…" />
        </label>
        <div className="paleta-lista" ref={lista} role="listbox">
          {res.map(({ e, marcas }, i) => (
            <button key={chave(e.raiz, e.nome)} role="option" aria-selected={i === sel} className={i === sel ? 'is-sel' : ''}
              onMouseMove={() => setSel(i)} onClick={() => abrirEntrada(e)}>
              <span className="paleta-texto">
                <span className="paleta-nome">{realce(e.nome, marcas)}</span>
                {(() => { const a = trechoDe.get(chave(e.raiz, e.nome)); return a ? <span className="paleta-previa is-achado">{realceTrecho(a)}</span>
                  : e.previa ? <span className="paleta-previa">{e.previa}</span> : null })()}
              </span>
              <span className="paleta-pasta">{ROTULO[e.raiz]}</span>
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
        <footer className="paleta-pe"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>↵</kbd> abrir</span>{onImportar && <span><kbd>⌘↵</kbd> {document.querySelector('.redacao') ? 'abrir em aba nova' : 'trazer pro canvas'}</span>}<span><kbd>esc</kbd> fechar</span></footer>
      </div>
    </div>
  )
}
