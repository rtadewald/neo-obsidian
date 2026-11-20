import { useEffect, useState } from 'react'
import type { Producao } from './canvasApi'

/** As categorias das copies (o `categoria:` do frontmatter): a ordem arrastada (dados/criacao.json) primeiro, depois as
 *  que só existem nas notas, em ordem alfabética. As criadas no menu (ainda sem copy) vivem na lista do criacao.json. */
const semEmoji = (n: string) => n.replace(/^[^\p{L}\p{N}]+/u, '')
export const SEM = 'Sem categoria'
/** Divisores do menu: entradas da lista do criacao.json que começam com — (não são categorias de verdade). */
/** A categoria especial 📌 Pinados no topo do menu (valor no filtro; não existe no vault). */
export const PIN = '\u0000pin'
export const ehDivisor = (c: string) => c.startsWith('—')

export function listaCategorias(producoes: Producao[], ordem: string[]): string[] {
  const nas = [...new Set(producoes.map((p) => p.categoria).filter((c): c is string => !!c))]
  const resto = nas.filter((c) => !ordem.includes(c)).sort((a, b) => semEmoji(a).localeCompare(semEmoji(b)))
  return [...ordem.filter((c) => c && c !== SEM), ...resto]
}

/** Ícones da frente das categorias (os mesmos dos formatos do vault). */
export const ICONES_CAT = ['📱', '💰', '📺', '📚', '🎥', '🏞️']
const separar = (nome: string) => { const t = semEmoji(nome); return { icone: nome.slice(0, nome.length - t.length).trim(), texto: t } }

/** Criar ou renomear uma categoria ali mesmo no menu: escolher o ícone e escrever o nome (Enter grava, Esc desiste). */
export function EditorCategoria({ inicial = '', onOk, onCancelar }: { inicial?: string; onOk: (nome: string) => void; onCancelar: () => void }) {
  const s = separar(inicial)
  const [icone, setIcone] = useState(s.icone || '📱')
  const [texto, setTexto] = useState(s.texto)
  const gravar = () => { const t = texto.trim(); if (t) onOk(`${icone} ${t}`); else onCancelar() }
  return (
    <div className="cats-editor" onClick={(e) => e.stopPropagation()}>
      <div className="cats-editor-icones" role="radiogroup" aria-label="Ícone">
        {ICONES_CAT.map((i) => <button key={i} type="button" role="radio" aria-checked={i === icone} className={i === icone ? 'is-on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => setIcone(i)}>{i}</button>)}
      </div>
      <label className="cats-editor-campo"><span>{icone}</span>
        <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nome da categoria" onBlur={gravar}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); gravar() } else if (e.key === 'Escape') { e.preventDefault(); onCancelar() } }} />
      </label>
    </div>
  )
}

/** Menu de categorias à esquerda da tabela: clicar filtra (⌘ soma mais de uma), soltar uma copy muda a categoria dela,
 *  arrastar uma categoria sobre outra muda a ordem, botão direito dá cor, renomeia ou apaga, e "+ Nova categoria". */
export function MenuCategorias({ status, lista, renomear, onRenomear, arquivadas, contagem, nPins, sel, cores, onSel, onSoltar, onOrdem, onCriar, onMenu, onDivisor, onTirar }: {
  /** Status acima das categorias: clicar filtra (⌘ soma), soltar uma copy muda o status dela. */
  status?: { lista: { k: string; rotulo: string; n: number }[]; sel: string[]; onSel: (l: string[]) => void; onSoltar: (copia: string, k: string) => void }
  lista: string[]
  renomear: string | null   // a categoria sendo renomeada ali mesmo (botão direito → Renomear)
  onRenomear: (de: string, para: string | null) => void   // para null = desistiu
  arquivadas: string[]   // ficam numa seção recolhida no fim (botão direito desarquiva)
  contagem: Record<string, number>   // copies da aba em cada categoria ('' = sem categoria)
  nPins: number   // pinadas da aba
  total: number
  sel: string[]
  cores: Record<string, string>
  onSel: (l: string[]) => void
  onSoltar: (copia: string, cat: string) => void   // copia = JSON do arraste da tabela
  onOrdem: (de: string, para: string) => void
  onCriar: (nome: string) => void
  onMenu: (cat: string, x: number, y: number) => void
  onDivisor: () => void   // põe um divisor no fim da lista
  onTirar: (divisor: string) => void
}) {
  const [sobre, setSobre] = useState<string | null>(null)
  const [verArq, setVerArq] = useState(false)
  const [criando, setCriando] = useState(false)
  // largura do menu: arrastar a borda direita (fica guardada); duplo clique volta ao padrão
  const [larg, setLarg] = useState<number>(() => { try { return Number(localStorage.getItem('cats-largura')) || 210 } catch { return 210 } })
  useEffect(() => { try { localStorage.setItem('cats-largura', String(larg)) } catch { /* sem storage */ } }, [larg])
  const redimensionar = (e: React.PointerEvent) => {
    e.preventDefault()
    const x0 = e.clientX, w0 = larg
    const mover = (ev: PointerEvent) => setLarg(Math.round(Math.min(420, Math.max(140, w0 + ev.clientX - x0))))
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); document.body.classList.remove('arrastando') }
    document.body.classList.add('arrastando')
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar)
  }
  const clicar = (c: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) onSel(sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c])
    else onSel(sel.length === 1 && sel[0] === c ? [] : [c])
  }
  const item = (c: string, rotulo: string) => c && c === renomear ? <EditorCategoria key={c} inicial={c} onOk={(n) => onRenomear(c, n)} onCancelar={() => onRenomear(c, null)} /> : (
    <button key={c || '-'} className={`cats-item ${sel.includes(c) ? 'is-on' : ''} ${sobre === c ? 'is-sobre' : ''}`}
      onClick={(e) => clicar(c, e)}
      draggable={!!c && c !== PIN} onDragStart={(e) => { e.dataTransfer.setData('neo/categoria', c); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('neo/copia') || (c && c !== PIN && e.dataTransfer.types.includes('neo/categoria'))) { e.preventDefault(); setSobre(c) } }}
      onDragLeave={() => setSobre(null)}
      onDrop={(e) => { e.preventDefault(); setSobre(null); const d = e.dataTransfer.getData('neo/copia'); const k = e.dataTransfer.getData('neo/categoria')
        if (d) onSoltar(d, c || SEM); else if (k && c && c !== PIN) onOrdem(k, c) }}
      onContextMenu={(e) => { if (!c || c === PIN) return; e.preventDefault(); onMenu(c, e.clientX, e.clientY) }}
      title={c === PIN ? 'Só as pinadas (📌) · solte uma copy aqui para pinar' : c ? 'Clique filtra (⌘ soma) · solte uma copy aqui para mudar a categoria · botão direito: cor, renomear' : undefined}>
      {c && c !== PIN && <i className="cats-cor" style={cores[c] ? { background: cores[c] } : undefined} />}
      <span>{rotulo}</span><em>{c === PIN ? nPins : contagem[c] ?? 0}</em>
    </button>
  )
  return (
    <aside className="cats" aria-label="Categorias" style={{ width: larg }}>
      <i className="cats-alca" onPointerDown={redimensionar} onDoubleClick={() => setLarg(210)} title="Arraste para mudar a largura (duplo clique volta ao padrão)" />
      {status && <>
        <p className="cats-t">Status</p>
        <button className={`cats-item ${status.sel.length ? '' : 'is-on'}`} onClick={() => status.onSel([])} title="Sem filtro de status (as publicadas ficam no fim, em Mostrar publicados)">
          <span>Todos</span><em>{status.lista.filter((x) => x.k !== 'publicado').reduce((a, x) => a + x.n, 0)}</em></button>
        {status.lista.map((x) => (
          <button key={x.k} className={`cats-item ${status.sel.includes(x.k) ? 'is-on' : ''} ${sobre === `st:${x.k}` ? 'is-sobre' : ''}`}
            title="Clique filtra (⌘ soma) · solte uma copy aqui para mudar o status"
            onClick={(e) => { const l = status.sel; status.onSel(e.metaKey || e.ctrlKey ? (l.includes(x.k) ? l.filter((y) => y !== x.k) : [...l, x.k]) : l.length === 1 && l[0] === x.k ? [] : [x.k]) }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('neo/copia')) { e.preventDefault(); setSobre(`st:${x.k}`) } }}
            onDragLeave={() => setSobre(null)}
            onDrop={(e) => { e.preventDefault(); setSobre(null); const d = e.dataTransfer.getData('neo/copia'); if (d) status.onSoltar(d, x.k) }}>
            <span>{x.rotulo}</span><em>{x.n}</em>
          </button>
        ))}
        <div className="cats-div is-fixo"><hr /></div>
      </>}
      <p className="cats-t">Categorias</p>
      {item(PIN, '📌 Pinados')}
      {lista.map((c) => ehDivisor(c) ? (
        <div key={c} className={`cats-div ${sobre === c ? 'is-sobre' : ''}`} draggable title="Arraste para mudar o lugar · botão direito tira"
          onDragStart={(e) => { e.dataTransfer.setData('neo/categoria', c); e.dataTransfer.effectAllowed = 'move' }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('neo/categoria')) { e.preventDefault(); setSobre(c) } }}
          onDragLeave={() => setSobre(null)}
          onDrop={(e) => { e.preventDefault(); setSobre(null); const k = e.dataTransfer.getData('neo/categoria'); if (k) onOrdem(k, c) }}
          onContextMenu={(e) => { e.preventDefault(); if (window.confirm('Tirar este divisor?')) onTirar(c) }}><hr /></div>
      ) : item(c, c))}
      {(contagem[''] ?? 0) > 0 && item('', SEM)}
      {arquivadas.length > 0 && <>
        <button className="cats-arq" onClick={() => setVerArq((v) => !v)} aria-expanded={verArq}>{verArq ? '▾' : '▸'} Arquivadas <em>{arquivadas.length}</em></button>
        {verArq && <div className="cats-arq-lista">{arquivadas.map((c) => item(c, c))}</div>}
      </>}
      <div className="cats-acoes">
        {criando ? <EditorCategoria onOk={(n) => { setCriando(false); onCriar(n) }} onCancelar={() => setCriando(false)} />
          : <button className="cats-nova" onClick={() => setCriando(true)}>+ Nova categoria</button>}
        <button className="cats-nova" onClick={onDivisor} title="Um traço para separar grupos de categorias (arrastável)">+ Divisor</button>
      </div>
    </aside>
  )
}
