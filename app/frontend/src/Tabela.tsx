import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Icone } from './Icone'
import { ORDEM_FORMATO, STATUS, type Alvo, type EstadoCanvas, type Producao, type StatusProd } from './canvasApi'

/** Modal de tabela das pastas (Priorizar, Em edição, Agendado, Publicado): as copies em linhas, com números,
 *  filtros e ordenação. Clicar numa linha abre a copy no modal de nota, que tem "voltar" para cá. */

export type Coluna = 'formato' | 'nome' | 'data' | 'ideia' | 'grupo' | 'palavras' | 'mtime'
/** 'winner': as copies com 🔥 (de qualquer status), com todas as datas em que foram postadas. */
export type Pasta = StatusProd | 'winner'
export type EstadoTabela = {
  pasta: Pasta; busca: string; formatos: string[]; ano: string; mes: string; grupo: string
  ordem: { col: Coluna; asc: boolean }
}
export const tabelaNova = (pasta: Pasta): EstadoTabela => ({
  pasta, busca: '', formatos: [], ano: '', mes: '', grupo: '',
  ordem: { col: pasta === 'edicao' ? 'mtime' : 'data', asc: pasta === 'agendado' },   // winners: mais recentes primeiro
})

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const dia = (p: Producao) => (p.scheduled ?? '').slice(0, 10) || new Date((p.criado ?? p.mtime) * 1000).toISOString().slice(0, 10)
const dataBr = (d: string) => `${d.slice(8, 10)} ${MESES[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`
const relativo = (t: number) => {
  const d = Math.floor((Date.now() / 1000 - t) / 86400)
  return d < 1 ? 'hoje' : d === 1 ? 'ontem' : d < 30 ? `há ${d} dias` : d < 365 ? `há ${Math.floor(d / 30)} m` : `há ${Math.floor(d / 365)} a`
}
const INBOX_NOME = '📥 Inbox'
const semEmoji = (n: string) => n.replace(/^[^\p{L}\p{N}]+/u, '')
const ROTULO_COL: Record<Coluna, string> = { formato: '', nome: 'Copy', data: 'Data', ideia: 'Produção', grupo: 'Canvas', palavras: 'Palavras', mtime: 'Editada' }

export function ModalTabela({ est, t, onMudar, onFechar, onAbrir, onCanvas, onApagar, onStatus, onRenomear }: {
  est: EstadoCanvas; t: EstadoTabela; onMudar: (t: EstadoTabela) => void; onFechar: () => void
  onAbrir: (a: Alvo) => void; onCanvas: (pasta: StatusProd, ano: string) => void
  onApagar?: (alvos: Alvo[]) => Promise<void>   // seleção múltipla → lixeira do vault
  onStatus?: (alvos: Alvo[], status: StatusProd) => Promise<void>
  onRenomear?: (alvo: Alvo, novo: string) => Promise<void>
}) {
  // botão direito numa linha: abrir, renomear, mudar status, deletar
  const [menu, setMenu] = useState<{ x: number; y: number; p: Alvo; renomear?: string; apagar?: boolean } | null>(null)
  useEffect(() => {
    if (!menu) return
    const fora = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.tabela-menu')) setMenu(null) }
    window.addEventListener('mousedown', fora)
    return () => window.removeEventListener('mousedown', fora)
  }, [menu])
  const mudar = (m: Partial<EstadoTabela>) => onMudar({ ...t, ...m })
  // seleção múltipla para apagar de uma vez (some ao trocar de aba)
  const [sel, setSel] = useState<Set<string>>(() => new Set())
  const [confirmar, setConfirmar] = useState(false)
  const [apagando, setApagando] = useState(false)
  useEffect(() => { setSel(new Set()); setConfirmar(false) }, [t.pasta])
  const chaveDe = (p: { raiz: string; nome: string }) => `${p.raiz}/${p.nome}`
  const alternar = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onFechar() } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  const daPasta = useMemo(() => est.producoes.filter((p) => (t.pasta === 'winner' ? !!p.winner : p.status === t.pasta)), [est, t.pasta])
  const anos = useMemo(() => [...new Set(daPasta.map((p) => dia(p).slice(0, 4)))].sort().reverse(), [daPasta])
  const grupos = useMemo(() => [...new Set(daPasta.map((p) => p.canvas || INBOX_NOME))].sort(), [daPasta])
  // filtros que valem antes dos chips de formato e das barras de mês (para os números deles não sumirem ao clicar)
  const base = useMemo(() => {
    const q = t.busca.trim().toLowerCase()
    return daPasta.filter((p) => (!t.ano || dia(p).startsWith(t.ano)) && (!t.grupo || (p.canvas || INBOX_NOME) === t.grupo)
      && (!q || p.nome.toLowerCase().includes(q) || (p.ideia ?? '').toLowerCase().includes(q) || p.previa.toLowerCase().includes(q)))
  }, [daPasta, t.busca, t.ano, t.grupo])
  const linhas = useMemo(() => {
    const l = base.filter((p) => (!t.formatos.length || t.formatos.includes(p.formato)) && (!t.mes || dia(p).startsWith(t.mes)))
    const { col, asc } = t.ordem
    // winners: pela última data em que foi postada; sem data vai para o fim
    const v = (p: Producao): string | number => col === 'data' ? (t.pasta === 'winner' ? (p.datas?.[p.datas.length - 1] ?? p.scheduled?.slice(0, 10) ?? '') : dia(p)) : col === 'palavras' ? p.palavras ?? 0 : col === 'mtime' ? p.mtime
      : col === 'formato' ? ORDEM_FORMATO.indexOf(p.formato) : col === 'nome' ? semEmoji(p.nome).toLowerCase() : (col === 'ideia' ? p.ideia : p.canvas || INBOX_NOME)?.toLowerCase() ?? '~'
    return l.sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1) })
  }, [base, t.formatos, t.mes, t.ordem, t.pasta])

  const porFormato = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of base.filter((p) => !t.mes || dia(p).startsWith(t.mes))) c[p.formato || '📄'] = (c[p.formato || '📄'] ?? 0) + 1
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [base, t.mes])
  // barras por mês: do ano escolhido, ou os últimos 12 meses com copy
  const meses = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of base.filter((p) => !t.formatos.length || t.formatos.includes(p.formato))) c[dia(p).slice(0, 7)] = (c[dia(p).slice(0, 7)] ?? 0) + 1
    const ks = t.ano ? Array.from({ length: 12 }, (_, i) => `${t.ano}-${String(i + 1).padStart(2, '0')}`) : Object.keys(c).sort().slice(-12)
    return ks.map((k) => [k, c[k] ?? 0] as const)
  }, [base, t.formatos, t.ano])
  const maxMes = Math.max(1, ...meses.map((m) => m[1]))
  const palavras = linhas.map((p) => p.palavras ?? 0).filter((n) => n > 0)
  const media = palavras.length ? Math.round(palavras.reduce((a, b) => a + b, 0) / palavras.length) : 0
  const hoje = new Date().toISOString().slice(0, 10)
  const em7 = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10)
  const destaque = t.pasta === 'agendado'
    ? { n: linhas.filter((p) => p.scheduled && p.scheduled.slice(0, 10) >= hoje && p.scheduled.slice(0, 10) <= em7).length, r: 'nos próximos 7 dias' }
    : t.pasta === 'publicado' || t.pasta === 'winner' ? { n: linhas.filter((p) => dia(p) >= new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10)).length, r: 'nos últimos 30 dias' }
    : { n: linhas.filter((p) => Date.now() / 1000 - p.mtime > 14 * 86400).length, r: 'paradas há +14 dias' }

  const ordenar = (col: Coluna) => mudar({ ordem: { col, asc: t.ordem.col === col ? !t.ordem.asc : col === 'nome' || col === 'ideia' || col === 'grupo' } })
  const alternarFormato = (f: string) => mudar({ formatos: t.formatos.includes(f) ? t.formatos.filter((x) => x !== f) : [...t.formatos, f] })
  const filtrando = t.busca || t.formatos.length || t.ano || t.mes || t.grupo
  const contagem = (k: StatusProd) => est.producoes.filter((p) => p.status === k).length
  const alvo = document.querySelector('section.pagina')

  const corpo = (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal-nota modal-tabela glass glass--light" role="dialog" aria-label="Tabela de copies">
        <header className="modal-tabs">
          <nav role="tablist">
            {STATUS.map((s) => (
              <button key={s.k} role="tab" aria-selected={s.k === t.pasta} className={`modal-tab ${s.k === t.pasta ? 'is-ativa' : ''}`} onClick={() => onMudar(tabelaNova(s.k))}>
                <i className={`ponto is-${s.k}`} /><span>{s.nome}</span><em className="tabela-n">{contagem(s.k)}</em>
              </button>
            ))}
            <button role="tab" aria-selected={t.pasta === 'winner'} className={`modal-tab ${t.pasta === 'winner' ? 'is-ativa' : ''}`} onClick={() => onMudar(tabelaNova('winner'))}>
              <span className="tabela-fogo">🔥</span><span>Winners</span><em className="tabela-n">{est.producoes.filter((p) => p.winner).length}</em>
            </button>
          </nav>
          {t.pasta !== 'ideia' && t.pasta !== 'winner' && <button className="tabela-canvas" onClick={() => onCanvas(t.pasta as StatusProd, t.ano)} title="Abrir estas copies no canvas"><Icone n="grafo" t={13} /> Ver no canvas</button>}
          <button className="btn-icone" onClick={onFechar} aria-label="Fechar" title="Fechar (esc)"><Icone n="fechar" t={16} /></button>
        </header>

        <section className="tabela-numeros">
          <div className="tabela-num"><b>{linhas.length}</b><span>{filtrando ? `de ${daPasta.length} copies` : 'copies'}</span></div>
          <div className="tabela-num"><b>{destaque.n}</b><span>{destaque.r}</span></div>
          <div className="tabela-num"><b>{media || '—'}</b><span>palavras em média</span></div>
          <div className="tabela-meses" aria-label="Copies por mês">
            {meses.map(([k, n]) => (
              <button key={k} className={`tabela-mes ${t.mes === k ? 'is-on' : ''} ${t.mes && t.mes !== k ? 'is-apagado' : ''}`} onClick={() => mudar({ mes: t.mes === k ? '' : k })}
                title={`${MESES[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}: ${n} ${n === 1 ? 'copy' : 'copies'}`}>
                <i style={{ height: `${Math.max(n ? 8 : 2, (n / maxMes) * 100)}%` }} /><span>{MESES[Number(k.slice(5)) - 1].slice(0, 1)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="tabela-filtros">
          <label className="tabela-busca"><Icone n="busca" t={13} /><input value={t.busca} onChange={(e) => mudar({ busca: e.target.value })} placeholder="Buscar copy, produção ou texto" autoFocus /></label>
          <div className="tabela-chips">
            {porFormato.map(([f, n]) => (
              <button key={f} className={`tabela-chip ${t.formatos.includes(f) ? 'is-on' : ''}`} onClick={() => alternarFormato(f)}>{f}<em>{n}</em></button>
            ))}
          </div>
          {anos.length > 1 && (
            <select className="tabela-select" value={t.ano} onChange={(e) => mudar({ ano: e.target.value, mes: '' })}>
              <option value="">Todos os anos</option>{anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {grupos.length > 0 && (
            <select className="tabela-select" value={t.grupo} onChange={(e) => mudar({ grupo: e.target.value })}>
              <option value="">Todos os canvas</option>{grupos.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          {filtrando ? <button className="tabela-limpar" onClick={() => mudar({ busca: '', formatos: [], ano: '', mes: '', grupo: '' })}>Limpar filtros</button> : null}
        </section>

        <div className="tabela-rolo">
          <table className="tabela">
            <thead>
              <tr>{onApagar && <th className="col-sel" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label="Marcar todas as linhas" checked={linhas.length > 0 && linhas.every((p) => sel.has(chaveDe(p)))}
                  onChange={(e) => setSel(e.target.checked ? new Set(linhas.map(chaveDe)) : new Set())} /></th>}
                {(Object.keys(ROTULO_COL) as Coluna[]).map((c) => (
                <th key={c} className={`col-${c}`} onClick={() => ordenar(c)} aria-sort={t.ordem.col === c ? (t.ordem.asc ? 'ascending' : 'descending') : 'none'}>
                  {ROTULO_COL[c]}{t.ordem.col === c && <span className="tabela-seta">{t.ordem.asc ? '↑' : '↓'}</span>}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {linhas.map((p) => (
                <tr key={`${p.raiz}/${p.nome}`} onClick={() => onAbrir({ raiz: p.raiz, nome: p.nome })} tabIndex={0} className={sel.has(chaveDe(p)) ? 'is-sel' : ''}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 280), p: { raiz: p.raiz, nome: p.nome } }) }}
                  onKeyDown={(e) => e.key === 'Enter' && onAbrir({ raiz: p.raiz, nome: p.nome })}>
                  {onApagar && <td className="col-sel" onClick={(e) => { e.stopPropagation(); alternar(chaveDe(p)) }}>
                    <input type="checkbox" aria-label={`Marcar ${p.nome}`} checked={sel.has(chaveDe(p))} onChange={() => {}} /></td>}
                  <td className="col-formato">{p.formato || '📄'}</td>
                  <td className="col-nome"><b>{semEmoji(p.nome)}</b>{p.previa && <span>{p.previa}</span>}</td>
                  <td className="col-data">{(p.datas?.length ?? 0) > 1 ? <span title={`Postada ${p.datas!.length} vezes`}>{p.datas!.map(dataBr).join(' · ')}</span>
                    : p.scheduled ? dataBr(p.scheduled.slice(0, 10)) : t.pasta === 'winner' ? <span className="mudo" title="Sem data de postagem (scheduled vazio)">sem data</span> : <span className="mudo">{dataBr(dia(p))}</span>}</td>
                  <td className="col-ideia">{p.ideia ? semEmoji(p.ideia) : <span className="mudo">—</span>}</td>
                  <td className="col-grupo">{p.canvas ? <span className="tabela-caixa">{p.canvas}</span> : <span className="mudo">{INBOX_NOME}</span>}</td>
                  <td className="col-palavras">{p.palavras || <span className="mudo">0</span>}</td>
                  <td className="col-mtime">{relativo(p.mtime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!linhas.length && <p className="tabela-vazia">Nenhuma copy com esses filtros.</p>}
        </div>
        {menu && (
          <div className="tabela-menu glass glass--light" style={{ left: menu.x, top: menu.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
            {menu.renomear !== undefined ? (
              <form onSubmit={async (e) => { e.preventDefault(); const n = menu.renomear!.trim(); const a = menu.p; setMenu(null); if (n && n !== a.nome && onRenomear) await onRenomear(a, n) }}>
                <input autoFocus value={menu.renomear} onChange={(e) => setMenu({ ...menu, renomear: e.target.value })} onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null) } }} aria-label="Novo nome" />
              </form>
            ) : menu.apagar ? (<>
              <p className="tabela-menu-t">Mandar para a lixeira do vault?</p>
              <button className="is-perigo" autoFocus onClick={async () => { const a = menu.p; setMenu(null); await onApagar?.([a]) }}>Deletar</button>
              <button onClick={() => setMenu({ ...menu, apagar: false })}>Cancelar</button>
            </>) : (<>
              <button onClick={() => { const a = menu.p; setMenu(null); onAbrir(a) }}>Abrir</button>
              {onRenomear && <button onClick={() => setMenu({ ...menu, renomear: menu.p.nome })}>Renomear</button>}
              {onStatus && <><p className="tabela-menu-t">Mover para</p>
                {STATUS.filter((x) => x.k !== t.pasta).map((x) => (
                  <button key={x.k} onClick={async () => { const a = menu.p; setMenu(null); await onStatus([a], x.k) }}>{x.marca} {x.nome}</button>
                ))}</>}
              {onApagar && <><hr /><button className="is-perigo" onClick={() => setMenu({ ...menu, apagar: true })}>Deletar</button></>}
            </>)}
          </div>
        )}
        {onApagar && sel.size > 0 && (
          <div className="tabela-selecao">
            <b>{sel.size} {sel.size === 1 ? 'nota selecionada' : 'notas selecionadas'}</b>
            <button className="pilula" onClick={() => { setSel(new Set()); setConfirmar(false) }}>Limpar seleção</button>
            {onStatus && <select className="tabela-status" value="" disabled={apagando} aria-label="Mudar o status das selecionadas"
              onChange={async (e) => { const st = e.target.value as StatusProd; if (!st) return; setApagando(true)
                try { await onStatus(daPasta.filter((p) => sel.has(chaveDe(p))).map((p) => ({ raiz: p.raiz, nome: p.nome })), st); setSel(new Set()) } finally { setApagando(false) } }}>
              <option value="">Mudar status…</option>
              {STATUS.filter((x) => x.k !== t.pasta).map((x) => <option key={x.k} value={x.k}>{x.marca} {x.nome}</option>)}
            </select>}
            {confirmar
              ? <><span className="mudo">Vão para a lixeira do vault (.trash), dá para recuperar.</span>
                <button className="pilula is-perigo" disabled={apagando} autoFocus onClick={async () => {
                  setApagando(true)
                  try { await onApagar(daPasta.filter((p) => sel.has(chaveDe(p))).map((p) => ({ raiz: p.raiz, nome: p.nome }))); setSel(new Set()) }
                  finally { setApagando(false); setConfirmar(false) }
                }}>{apagando ? 'Apagando…' : `Deletar ${sel.size}`}</button></>
              : <button className="pilula is-perigo" onClick={() => setConfirmar(true)}>Deletar {sel.size}</button>}
          </div>
        )}
      </div>
    </div>
  )
  return alvo ? createPortal(corpo, alvo) : corpo
}
