import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type { Raiz } from './notas'

/** Calendário editorial: as notas de `1 Copies` pela propriedade `scheduled`
 *  (arraste para outro dia reagenda) e blocos de planejamento tracejados (arraste vazio numa
 *  semana cria um; não mexem em nenhuma nota, só um desenho no calendário). */
type ItemAgenda = { nome: string; raiz: Raiz; scheduled: string; status: string }
type Bloco = { id: string; inicio: string; fim: string; texto: string; cor: string | null }
type NovoBloco = { inicio: string; fim: string }

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIA = 86400000
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const segunda = (d: Date) => { const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s }
const addDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const diffDias = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / DIA)
/** Matiz estável a partir do texto, pra cada bloco ("FIA", "VSL"...) ter sempre a mesma cor. */
function matiz(t: string) {
  let h = 0
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 360
}

export function CalendarioEditorial({ onAbrir, onMudou }: { onAbrir: (raiz: Raiz, nome: string) => void; onMudou?: () => void }) {
  const [mes, setMes] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [itens, setItens] = useState<ItemAgenda[]>([])
  const [blocos, setBlocos] = useState<Bloco[]>([])
  const [sobreDia, setSobreDia] = useState<string | null>(null)
  const [editando, setEditando] = useState<Bloco | NovoBloco | null>(null)

  const carregar = useCallback(() => {
    fetch('/api/notas/agenda').then((r) => r.json()).then((d) => setItens(d.itens)).catch(() => {})
    fetch('/api/planejamento').then((r) => r.json()).then((d) => setBlocos(d.itens)).catch(() => {})
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const semanas = useMemo(() => {
    const ini = segunda(mes)
    const fimMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0)
    const n = Math.round((segunda(fimMes).getTime() - ini.getTime()) / (7 * DIA)) + 1
    return Array.from({ length: n }, (_, w) => Array.from({ length: 7 }, (_, d) => addDias(ini, w * 7 + d)))
  }, [mes])

  const porDia = useMemo(() => {
    const m: Record<string, ItemAgenda[]> = {}
    for (const it of itens) (m[it.scheduled] ??= []).push(it)
    return m
  }, [itens])

  const hoje = iso(new Date())

  async function soltarChave(raiz: Raiz, nome: string, data: string, de?: string) {
    setSobreDia(null)
    await fetch(`/api/notas/${raiz}/${encodeURIComponent(nome)}/agenda`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, de }),   // de: qual das datas da nota foi arrastada (as outras ficam)
    })
    carregar()
    onMudou?.()
  }

  async function salvarBloco(texto: string) {
    if (!editando) return
    const t = texto.trim()
    if (!t) { setEditando(null); return }
    if ('id' in editando) {
      await fetch(`/api/planejamento/${editando.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: t }) })
    } else {
      await fetch('/api/planejamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inicio: editando.inicio, fim: editando.fim, texto: t }) })
    }
    setEditando(null)
    carregar()
  }

  async function apagarBloco(id: string) {
    await fetch(`/api/planejamento/${id}`, { method: 'DELETE' })
    setEditando(null)
    carregar()
  }

  return (
    <div className="cal-ed">
      <div className="cal-ed-topo">
        <h2 className="titulo cal-ed-titulo">{MESES[mes.getMonth()][0].toUpperCase() + MESES[mes.getMonth()].slice(1)} {mes.getFullYear()}</h2>
        <p className="mudo">Arraste uma nota pra outro dia pra reagendar. Arraste um trecho vazio da semana pra marcar o que vai rolar nela.</p>
        <div className="acoes-topo">
          <button className="pilula" onClick={() => setMes((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} aria-label="Mês anterior">‹</button>
          <button className="pilula" onClick={() => { const d = new Date(); setMes(new Date(d.getFullYear(), d.getMonth(), 1)) }}>Hoje</button>
          <button className="pilula" onClick={() => setMes((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} aria-label="Próximo mês">›</button>
        </div>
      </div>

      <div className="cal-ed-grade glass glass--light">
        <div className="cal-ed-nomes">{DIAS.map((d) => <span key={d}>{d}</span>)}</div>
        {semanas.map((sem, si) => (
          <SemanaEditorial key={si} semana={sem} porDia={porDia} blocos={blocos} hoje={hoje} mesAtual={mes.getMonth()}
            sobreDia={sobreDia} onSobreDia={setSobreDia} onSoltar={soltarChave} onAbrir={onAbrir}
            onCriarBloco={(inicio, fim) => setEditando({ inicio, fim })} onClickBloco={(b) => setEditando(b)} />
        ))}
      </div>

      {editando && (
        <EditorBloco alvo={editando} onSalvar={salvarBloco} onFechar={() => setEditando(null)}
          onApagar={'id' in editando ? () => apagarBloco(editando.id) : undefined} />
      )}
    </div>
  )
}

function SemanaEditorial({ semana, porDia, blocos, hoje, mesAtual, sobreDia, onSobreDia, onSoltar, onAbrir, onCriarBloco, onClickBloco }: {
  semana: Date[]; porDia: Record<string, ItemAgenda[]>; blocos: Bloco[]; hoje: string; mesAtual: number
  sobreDia: string | null; onSobreDia: (k: string | null) => void
  onSoltar: (raiz: Raiz, nome: string, data: string, de?: string) => void; onAbrir: (raiz: Raiz, nome: string) => void
  onCriarBloco: (inicio: string, fim: string) => void; onClickBloco: (b: Bloco) => void
}) {
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const chaves = semana.map(iso)

  const faixas = useMemo(() => blocos.map((b) => {
    if (b.fim < chaves[0] || b.inicio > chaves[6]) return null
    const d0 = diffDias(chaves[0], b.inicio), d1 = diffDias(chaves[0], b.fim)
    return { b, col1: Math.max(0, d0), col2: Math.min(6, d1), esq: d0 < 0, dir: d1 > 6 }
  }).filter((x): x is NonNullable<typeof x> => !!x), [blocos, chaves])

  function iniciarSel(e: ReactMouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const idx = (x: number) => Math.max(0, Math.min(6, Math.floor((x - rect.left) / rect.width * 7)))
    const ini = idx(e.clientX)
    setSel({ a: ini, b: ini })
    const mover = (ev: MouseEvent) => setSel({ a: ini, b: idx(ev.clientX) })
    const soltar = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', mover); window.removeEventListener('mouseup', soltar)
      const fim = idx(ev.clientX)
      setSel(null)
      onCriarBloco(chaves[Math.min(ini, fim)], chaves[Math.max(ini, fim)])
    }
    window.addEventListener('mousemove', mover)
    window.addEventListener('mouseup', soltar)
  }

  return (
    <div className="cal-ed-semana">
      <div className="cal-ed-lane" onMouseDown={iniciarSel}>
        {faixas.map(({ b, col1, col2, esq, dir }) => (
          <button key={b.id} className={`cal-ed-bloco ${esq ? 'is-esq' : ''} ${dir ? 'is-dir' : ''}`}
            style={{ gridColumn: `${col1 + 1} / ${col2 + 2}`, '--matiz': matiz(b.texto) } as CSSProperties}
            onClick={(e) => { e.stopPropagation(); onClickBloco(b) }} title="Clique para editar">{b.texto}</button>
        ))}
        {sel && <div className="cal-ed-sel" style={{ gridColumn: `${Math.min(sel.a, sel.b) + 1} / ${Math.max(sel.a, sel.b) + 2}` }} />}
      </div>
      <div className="cal-ed-dias">
        {semana.map((d, j) => {
          const k = chaves[j]
          return (
            <div key={k} className={`cal-ed-dia ${k === hoje ? 'is-hoje' : ''} ${d.getMonth() !== mesAtual ? 'is-fora' : ''} ${sobreDia === k ? 'is-sobre' : ''}`}
              onDragOver={(e) => { e.preventDefault(); onSobreDia(k) }} onDragLeave={() => onSobreDia(null)}
              onDrop={(e) => {
                e.preventDefault()
                const [raiz, nome, de] = e.dataTransfer.getData('text/plain').split('\u0000')
                if (raiz && nome) onSoltar(raiz as Raiz, nome, k, de || undefined)
              }}>
              <span className="cal-ed-num">{d.getDate() === 1 ? `1 ${MESES[d.getMonth()].slice(0, 3)}` : d.getDate()}</span>
              <div className="cal-ed-chips">
                {(porDia[k] ?? []).map((it) => (
                  <button key={`${it.raiz}/${it.nome}`} className={`cal-ed-chip is-${it.status}`} draggable title={it.nome}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', `${it.raiz}\u0000${it.nome}\u0000${it.scheduled}`)}
                    onClick={() => onAbrir(it.raiz, it.nome)}>{it.nome}</button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EditorBloco({ alvo, onSalvar, onApagar, onFechar }: {
  alvo: Bloco | NovoBloco; onSalvar: (t: string) => void; onApagar?: () => void; onFechar: () => void
}) {
  const [t, setT] = useState('texto' in alvo ? alvo.texto : '')
  return (
    <div className="cal-veu" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <form className="cal-ed-editor glass glass--light" onSubmit={(e) => { e.preventDefault(); onSalvar(t) }}>
        <p className="mudo">{alvo.inicio === alvo.fim ? alvo.inicio : `${alvo.inicio} → ${alvo.fim}`}</p>
        <input autoFocus value={t} onChange={(e) => setT(e.target.value)} placeholder="Ex.: Carrosséis, FIA, VSL…" />
        <div className="cal-ed-editor-acoes">
          {onApagar && <button type="button" className="is-perigo" onClick={onApagar}>Apagar</button>}
          <span className="ideias-barra-esp" />
          <button type="button" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="pilula is-on">Salvar</button>
        </div>
      </form>
    </div>
  )
}
