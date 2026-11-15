import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import { EditorView } from '@codemirror/view'

/** Sumário da nota, no jeito do Obsidian: os títulos (# a ######) em árvore, com setinha para recolher os filhos.
 *  Clicar leva o editor até o título; o título em que a leitura está fica marcado. */

type Titulo = { nivel: number; texto: string; linha: number }
type No = Titulo & { filhos: No[] }

function titulos(texto: string): Titulo[] {
  const out: Titulo[] = []
  const linhas = texto.split('\n')
  let i = 0
  if (linhas[0]?.trim() === '---') {   // pula o frontmatter
    i = 1
    while (i < linhas.length && linhas[i].trim() !== '---') i++
    i++
  }
  let cerca: string | null = null
  for (; i < linhas.length; i++) {
    const l = linhas[i]
    const c = /^\s*(`{3,}|~{3,})/.exec(l)
    if (c) { if (!cerca) cerca = c[1][0]; else if (c[1][0] === cerca) cerca = null; continue }
    if (cerca) continue
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l)
    if (m) out.push({ nivel: m[1].length, texto: m[2].replace(/\*\*|__|==|`/g, '').replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2'), linha: i + 1 })
  }
  return out
}

function arvore(ts: Titulo[]): No[] {
  const raiz: No[] = []
  const pilha: No[] = []
  for (const t of ts) {
    const no: No = { ...t, filhos: [] }
    while (pilha.length && pilha[pilha.length - 1].nivel >= t.nivel) pilha.pop()
    ;(pilha.length ? pilha[pilha.length - 1].filhos : raiz).push(no)
    pilha.push(no)
  }
  return raiz
}

export function Sumario({ texto, view }: { texto: string; view: MutableRefObject<EditorView | null> }) {
  const lista = useMemo(() => titulos(texto), [texto])
  const nos = useMemo(() => arvore(lista), [lista])
  const [fechados, setFechados] = useState<Set<number>>(new Set())
  const [atual, setAtual] = useState<number | null>(null)
  // largura do sumário: arrastar a borda da esquerda; fica guardada (duplo clique volta ao padrão)
  const [larg, setLarg] = useState<number>(() => { try { return Number(localStorage.getItem('sumario-largura')) || 240 } catch { return 240 } })
  const arrastar = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const x0 = e.clientX, w0 = larg
    let ult = w0
    const mover = (ev: PointerEvent) => { ult = Math.round(Math.min(560, Math.max(170, w0 - (ev.clientX - x0)))); setLarg(ult) }
    const soltar = () => {
      window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar)
      document.body.classList.remove('redimensionando')
      try { localStorage.setItem('sumario-largura', String(ult)) } catch { /* sem storage */ }
    }
    document.body.classList.add('redimensionando')
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar)
  }
  const padrao = () => { setLarg(240); try { localStorage.removeItem('sumario-largura') } catch { /* sem storage */ } }

  // marca o título da parte que está no topo do editor
  useEffect(() => {
    const v = view.current
    if (!v || !lista.length) return
    const ver = () => {
      const topo = v.lineBlockAtHeight(v.scrollDOM.getBoundingClientRect().top + 40 - v.documentTop)
      const n = v.state.doc.lineAt(topo.from).number
      let a: number | null = null
      for (const t of lista) { if (t.linha <= n) a = t.linha; else break }
      setAtual(a)
    }
    ver()
    v.scrollDOM.addEventListener('scroll', ver, { passive: true })
    return () => v.scrollDOM.removeEventListener('scroll', ver)
  }, [view, lista])

  if (!lista.length) return null

  const ir = (linha: number) => {
    const v = view.current
    if (!v || linha > v.state.doc.lines) return
    const pos = v.state.doc.line(linha).from
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 12 }) })
    v.focus()
  }
  const alternar = (linha: number) => setFechados((f) => { const n = new Set(f); if (n.has(linha)) n.delete(linha); else n.add(linha); return n })
  const comFilhos = lista.filter((_, i) => lista[i + 1] && lista[i + 1].nivel > lista[i].nivel).map((t) => t.linha)
  const tudoFechado = comFilhos.length > 0 && comFilhos.every((l) => fechados.has(l))

  const desenhar = (ns: No[]) => ns.map((n) => (
    <li key={n.linha}>
      <div className={`sumario-item ${atual === n.linha ? 'is-atual' : ''}`}>
        {n.filhos.length
          ? <button className={`sumario-seta ${fechados.has(n.linha) ? 'is-fechado' : ''}`} onClick={() => alternar(n.linha)} aria-label={fechados.has(n.linha) ? 'Abrir' : 'Recolher'}>
              <svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
            </button>
          : <span className="sumario-seta" />}
        <button className="sumario-link" onClick={() => ir(n.linha)} title={n.texto}>{n.texto}</button>
      </div>
      {n.filhos.length > 0 && !fechados.has(n.linha) && <ul>{desenhar(n.filhos)}</ul>}
    </li>
  ))

  return (
    <nav className="sumario" aria-label="Sumário da nota" style={{ width: larg }}>
      <div className="sumario-alca" onPointerDown={arrastar} onDoubleClick={padrao} title="Arraste para mudar a largura (duplo clique volta ao padrão)" />
      <div className="sumario-topo">
        <span className="mudo">Sumário</span>
        {comFilhos.length > 0 && (
          <button className="btn-icone sumario-tudo" onClick={() => setFechados(tudoFechado ? new Set() : new Set(comFilhos))}
            title={tudoFechado ? 'Abrir tudo' : 'Recolher tudo'}>
            <svg viewBox="0 0 16 16" width="14" height="14">{tudoFechado
              ? <><path d="M5 3.5 8 1 11 3.5" /><path d="M5 12.5 8 15 11 12.5" /></>
              : <><path d="M5 1.5 8 4.5 11 1.5" /><path d="M5 14.5 8 11.5 11 14.5" /></>}</svg>
          </button>
        )}
      </div>
      <ul className="sumario-lista">{desenhar(nos)}</ul>
    </nav>
  )
}
