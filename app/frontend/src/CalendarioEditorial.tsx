import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type { Raiz } from './notas'
import { mudarStatus } from './desfazer'
import { avisar } from './porta'

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
/** Tipo da copy pelo emoji do começo do nome (os do Reels juntos, como na Criação). */
const TIPOS: [string, string][] = [['📱', 'Reels'], ['🏞️', 'Carrossel'], ['💰', 'Ads'], ['📺', 'VSL'], ['📚', 'Aula'], ['🎥', 'YouTube'], ['·', 'Outros']]
function tipoDe(nome: string) {
  const e = (nome.match(/^\p{Extended_Pictographic}\uFE0F?/u) ?? [''])[0].replace('\uFE0F', '')
  if (['📱', '📝', '💻'].includes(e)) return '📱'
  if (e === '🏞') return '🏞️'
  if (e === '🧑' || e === '📚') return '📚'
  return TIPOS.some(([k]) => k === e) ? e : '·'
}
const CONCLUIDO = ['publicado', 'ativo', 'inativo']   // checkbox marcado
const nomeMes = (m: number) => MESES[m][0].toUpperCase() + MESES[m].slice(1)
/** Matiz estável a partir do texto, pra cada bloco ("FIA", "VSL"...) ter sempre a mesma cor. */
function matiz(t: string) {
  let h = 0
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 360
}

export function CalendarioEditorial({ onAbrir, onMudou }: { onAbrir: (raiz: Raiz, nome: string) => void; onMudou?: () => void }) {
  // modo contínuo: as semanas seguem sem quebra de mês (a virada é a "escadinha"); rolar perto das pontas carrega mais
  const [ini, setIni] = useState(() => addDias(segunda(new Date()), -12 * 7))
  const [nSem, setNSem] = useState(40)
  const [titulo, setTitulo] = useState('')
  // altura dos dias: o controle ao lado do Hoje (duplo clique volta ao padrão); fica guardada
  const [altura, setAltura] = useState<number>(() => { try { return Number(localStorage.getItem('cal-altura')) || 140 } catch { return 140 } })
  useEffect(() => { try { localStorage.setItem('cal-altura', String(altura)) } catch { /* sem storage */ } }, [altura])
  const [itens, setItens] = useState<ItemAgenda[]>([])
  const [blocos, setBlocos] = useState<Bloco[]>([])
  const [sobreDia, setSobreDia] = useState<string | null>(null)
  const [editando, setEditando] = useState<Bloco | NovoBloco | null>(null)

  const carregar = useCallback(() => {
    fetch('/api/notas/agenda').then((r) => r.json()).then((d) => setItens(d.itens)).catch(() => {})
    fetch('/api/planejamento').then((r) => r.json()).then((d) => setBlocos(d.itens)).catch(() => {})
  }, [])
  useEffect(() => { carregar() }, [carregar])
  // ao abrir (e no botão Hoje) a semana de hoje fica no topo da grade
  const grade = useRef<HTMLDivElement>(null)
  const [irHoje, setIrHoje] = useState(0)
  const pendente = useRef(true)   // só na abertura e no Hoje: reagendar ou publicar não mexe na rolagem
  const irPara = (k: string) => {
    const g = grade.current, el = g?.querySelector(`.cal-ed-semana[data-ini="${k}"]`) as HTMLElement | null
    if (!g || !el) return false
    const cab = g.querySelector('.cal-ed-nomes')?.getBoundingClientRect().bottom ?? g.getBoundingClientRect().top
    g.scrollTop += el.getBoundingClientRect().top - cab
    return true
  }
  useEffect(() => {
    if (!pendente.current || !itens.length) return
    const id = window.requestAnimationFrame(() => { if (irPara(iso(segunda(new Date())))) pendente.current = false })
    return () => window.cancelAnimationFrame(id)
  }, [irHoje, itens])   // eslint-disable-line react-hooks/exhaustive-deps
  // carregar semanas antes mantém a vista no lugar (compensa a altura que entrou em cima)
  const antes = useRef<number | null>(null)
  useLayoutEffect(() => {
    const g = grade.current
    if (g && antes.current != null) { g.scrollTop += g.scrollHeight - antes.current; antes.current = null }
  }, [ini])
  const rolou = () => {
    const g = grade.current
    if (!g) return
    if (g.scrollTop < 300 && antes.current == null) { antes.current = g.scrollHeight; setIni((d) => addDias(d, -8 * 7)); setNSem((n) => n + 8) }
    else if (g.scrollHeight - g.scrollTop - g.clientHeight < 300) setNSem((n) => n + 8)
    // título: os meses que aparecem na vista (como "Outubro – Novembro 2026")
    const r = g.getBoundingClientRect(), cab = (g.querySelector('.cal-ed-nomes') as HTMLElement | null)?.offsetHeight ?? 0
    const vis = [...g.querySelectorAll<HTMLElement>('.cal-ed-semana')].filter((el) => { const b = el.getBoundingClientRect(); return b.bottom > r.top + cab + 20 && b.top < r.bottom })
    if (!vis.length) return
    const quinta = (el: HTMLElement) => addDias(new Date(el.dataset.ini + 'T12:00'), 3)
    const a = quinta(vis[0]), b = quinta(vis[vis.length - 1])
    setTitulo(a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() ? `${nomeMes(a.getMonth())} ${a.getFullYear()}`
      : `${nomeMes(a.getMonth())}${a.getFullYear() !== b.getFullYear() ? ` ${a.getFullYear()}` : ''} – ${nomeMes(b.getMonth())} ${b.getFullYear()}`)
  }
  useEffect(() => { rolou() })   // eslint-disable-line react-hooks/exhaustive-deps
  // ‹ ›: para o começo do mês anterior/seguinte ao que está no topo
  const pularMes = (dir: -1 | 1) => {
    const g = grade.current
    if (!g) return
    const r = g.getBoundingClientRect(), cab = (g.querySelector('.cal-ed-nomes') as HTMLElement | null)?.offsetHeight ?? 0
    const primeira = [...g.querySelectorAll<HTMLElement>('.cal-ed-semana')].find((el) => el.getBoundingClientRect().bottom > r.top + cab + 20)
    if (!primeira) return
    const q = addDias(new Date(primeira.dataset.ini + 'T12:00'), 3)
    const alvo = segunda(new Date(q.getFullYear(), q.getMonth() + dir, 1))
    if (alvo < ini) { setIni(alvo); setNSem((n) => n + Math.round((ini.getTime() - alvo.getTime()) / (7 * DIA))); window.requestAnimationFrame(() => irPara(iso(alvo))); return }
    if (!irPara(iso(alvo))) { setNSem((n) => n + 8); window.requestAnimationFrame(() => irPara(iso(alvo))) }
  }

  const semanas = useMemo(() => Array.from({ length: nSem }, (_, w) => Array.from({ length: 7 }, (_, d) => addDias(ini, w * 7 + d))), [ini, nSem])

  // ícones acima do calendário: quais tipos aparecem (vazio = todos; fica guardado)
  const [tipos, setTipos] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('cal-tipos') || '[]') } catch { return [] } })
  useEffect(() => { try { localStorage.setItem('cal-tipos', JSON.stringify(tipos)) } catch { /* sem storage */ } }, [tipos])
  const contagem = useMemo(() => { const c: Record<string, number> = {}; for (const it of itens) { const t = tipoDe(it.nome); c[t] = (c[t] ?? 0) + 1 } return c }, [itens])
  const porDia = useMemo(() => {
    const m: Record<string, ItemAgenda[]> = {}
    for (const it of itens) if (it.status !== 'arquivado' && (!tipos.length || tipos.includes(tipoDe(it.nome)))) (m[it.scheduled] ??= []).push(it)   // arquivada não aparece
    return m
  }, [itens, tipos])

  const hoje = iso(new Date())

  async function soltarChave(raiz: Raiz, nome: string, data: string, de?: string) {
    setSobreDia(null)
    await fetch(`/api/notas/${raiz}/${encodeURIComponent(nome)}/agenda`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, de }),   // de: qual das datas da nota foi arrastada (as outras ficam)
    })
    carregar()
    onMudou?.()
  }

  // checkbox do chip: marcar conclui (VSL e ads viram ativo; o resto, publicado; vai para 2 Publicados); desmarcar volta
  // para Priorizar como agendado. O ⌘Z desfaz.
  async function publicar(it: ItemAgenda, sim: boolean) {
    const st = sim ? (['💰', '📺'].includes(tipoDe(it.nome)) ? 'ativo' : 'publicado') : 'agendado'
    setItens((l) => l.map((x) => (x.raiz === it.raiz && x.nome === it.nome ? { ...x, status: st } : x)))
    try { await mudarStatus([{ nome: it.nome, status: it.status }], st); avisar(sim ? (st === 'ativo' ? 'Ativa' : 'Publicada') : 'Voltou para Priorizar') }
    catch (e) { avisar((e as Error).message) }
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
        <h2 className="titulo cal-ed-titulo">{titulo}</h2>
        <div className="acoes-topo">
          <button className="pilula" onClick={() => pularMes(-1)} aria-label="Mês anterior">‹</button>
          <button className="pilula" onClick={() => { pendente.current = true; setIrHoje((v) => v + 1) }}>Hoje</button>
          <button className="pilula" onClick={() => pularMes(1)} aria-label="Próximo mês">›</button>
          <label className="cal-ed-altura" title="Altura dos dias (fica guardada)">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1v10M3.5 3.5 6 1l2.5 2.5M3.5 8.5 6 11l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <input type="range" min={70} max={320} step={10} value={altura} onChange={(e) => setAltura(Number(e.target.value))} onDoubleClick={() => setAltura(140)} aria-label="Altura dos dias" />
          </label>
        </div>
        <div className="cal-ed-tipos" role="group" aria-label="Tipos de copy">
          <button className={`cal-ed-tipo ${!tipos.length ? 'is-on' : ''}`} onClick={() => setTipos([])} title="Mostrar todos">Todos</button>
          {TIPOS.filter(([k]) => contagem[k]).map(([k, rot]) => (
            <button key={k} className={`cal-ed-tipo ${tipos.includes(k) ? 'is-on' : ''}`} title={`${rot} (${contagem[k]}) · clique soma ou tira`}
              onClick={() => setTipos((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]))}>{k === '·' ? rot : k}</button>
          ))}
        </div>
      </div>

      <div ref={grade} className="cal-ed-grade glass glass--light" onScroll={rolou} style={{ '--cal-dia-h': `${altura}px` } as React.CSSProperties}>
        <div className="cal-ed-nomes"><span className="cal-ed-margem" />{DIAS.map((d) => <span key={d}>{d}</span>)}</div>
        {semanas.map((sem, si) => (
          <SemanaEditorial key={iso(sem[0])} primeira={si === 0} semana={sem} porDia={porDia} blocos={blocos} hoje={hoje}
            sobreDia={sobreDia} onSobreDia={setSobreDia} onSoltar={soltarChave} onAbrir={onAbrir} onPublicar={publicar}
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

function SemanaEditorial({ semana, primeira, porDia, blocos, hoje, sobreDia, onSobreDia, onSoltar, onAbrir, onPublicar, onCriarBloco, onClickBloco }: {
  semana: Date[]; primeira: boolean; porDia: Record<string, ItemAgenda[]>; blocos: Bloco[]; hoje: string
  sobreDia: string | null; onSobreDia: (k: string | null) => void
  onSoltar: (raiz: Raiz, nome: string, data: string, de?: string) => void; onAbrir: (raiz: Raiz, nome: string) => void
  onPublicar: (it: ItemAgenda, sim: boolean) => void
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
    <div className="cal-ed-semana" data-ini={chaves[0]}>
      {(() => { const d1 = semana.find((d) => d.getDate() === 1); const m = d1 ?? (primeira ? semana[3] : null)
        return <div className="cal-ed-margem">{m && <b>{MESES[m.getMonth()].slice(0, 3)}{m.getMonth() === 0 || primeira ? ` ${String(m.getFullYear()).slice(2)}` : ''}</b>}</div> })()}
      <div className="cal-ed-corpo">
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
            <div key={k} className={`cal-ed-dia ${k === hoje ? 'is-hoje' : ''} ${k < hoje ? 'is-passado' : ''} ${d.getDate() <= 7 ? 'is-mes-topo' : ''} ${d.getDate() === 1 && j > 0 ? 'is-mes-esq' : ''} ${d.getMonth() % 2 ? 'is-mes-par' : ''} ${sobreDia === k ? 'is-sobre' : ''}`}
              onDragOver={(e) => { e.preventDefault(); onSobreDia(k) }} onDragLeave={() => onSobreDia(null)}
              onDrop={(e) => {
                e.preventDefault()
                const [raiz, nome, de] = e.dataTransfer.getData('text/plain').split('\u0000')
                if (raiz && nome) onSoltar(raiz as Raiz, nome, k, de || undefined)
              }}>
              <span className="cal-ed-num">{d.getDate() === 1 ? `1 ${MESES[d.getMonth()].slice(0, 3)}` : d.getDate()}</span>
              <div className="cal-ed-chips">
                {(porDia[k] ?? []).map((it) => (
                  <div key={`${it.raiz}/${it.nome}`} role="button" tabIndex={0} className={`cal-ed-chip is-${it.status}`} draggable title={it.nome}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', `${it.raiz}\u0000${it.nome}\u0000${it.scheduled}`)}
                    onClick={() => onAbrir(it.raiz, it.nome)} onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(it.raiz, it.nome) }}>
                    <input type="checkbox" className="cal-ed-check" checked={CONCLUIDO.includes(it.status)} title={CONCLUIDO.includes(it.status) ? `${it.status} · desmarcar: volta para Priorizar` : 'Marcar como publicada (VSL e ads: ativa)'}
                      onClick={(e) => e.stopPropagation()} onChange={(e) => onPublicar(it, e.target.checked)} />
                    <span>{it.nome}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
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
