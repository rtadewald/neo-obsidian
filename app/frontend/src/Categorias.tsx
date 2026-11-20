import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icone } from './Icone'
import type { Producao } from './canvasApi'

/** As categorias das copies (o `categoria:` do frontmatter): a ordem arrastada (dados/criacao.json) primeiro, depois as
 *  que só existem nas notas, em ordem alfabética. As criadas no menu (ainda sem copy) vivem na lista do criacao.json. */
const semEmoji = (n: string) => n.replace(/^[^\p{L}\p{N}]+/u, '')
export const SEM = 'Sem categoria'
/** Divisores do menu: entradas da lista do criacao.json que começam com — (não são categorias de verdade). */
/** A categoria especial 📌 Pinados no topo do menu (valor no filtro; não existe no vault). */
export const PIN = '\u0000pin'
/** Cores pastel das categorias e dos grupos (botão direito). */
export const PASTEIS = ['#fde2e4', '#fde8cf', '#fff3c4', '#e4f2cf', '#d4efe6', '#d6e8f7', '#e3dcf6', '#f3dcef', '#ece6dc']
export const ehDivisor = (c: string) => c.startsWith('—')
/** Os divisores são agrupadores: `—<id>|<nome>`; as categorias abaixo de um divisor (até o próximo) são o grupo dele. */
export const nomeDivisor = (c: string) => c.split('|').slice(1).join('|')
const comNome = (c: string, nome: string) => `${c.split('|')[0]}|${nome.trim()}`

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
export function MenuCategorias({ status, onArquivados, nArquivados, lista, renomear, onRenomear, arquivadas, contagem, nPins, sel, cores, onSel, onSoltar, onOrdem, onCriar, onMenu, onDivisor, onRenomearDivisor, onTirar, onCor }: {
  /** Status acima das categorias: clicar filtra (⌘ soma), soltar uma copy muda o status dela. */
  status?: { lista: { k: string; rotulo: string; n: number }[]; sel: string[]; onSel: (l: string[]) => void; onSoltar: (copia: string, k: string) => void }
  onArquivados?: () => void   // botão 🗄️ Arquivados no fim: abre a janela com as categorias e copies arquivadas
  nArquivados?: number
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
  onOrdem: (de: string, para: string, depois?: boolean) => void   // depois: logo abaixo de `para` (soltar num grupo)
  onCriar: (nome: string) => void
  onMenu: (cat: string, x: number, y: number) => void
  onDivisor: (nome: string) => void   // põe um grupo (divisor) com esse nome no fim da lista
  onRenomearDivisor?: (de: string, para: string) => void
  onCor?: (chave: string, cor: string) => void   // cor de um grupo (a chave é o id do divisor; '' tira)
  onTirar: (divisor: string) => void
}) {
  const [sobre, setSobre] = useState<string | null>(null)
  // arrastar uma categoria (ou um grupo): uma linha horizontal marca onde ela vai ficar (antes ou depois do item)
  const [linha, setLinha] = useState<{ c: string; depois: boolean } | null>(null)
  const metade = (e: React.DragEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return e.clientY > r.top + r.height / 2 }
  useEffect(() => { const fim = () => setLinha(null); window.addEventListener('dragend', fim); window.addEventListener('drop', fim); return () => { window.removeEventListener('dragend', fim); window.removeEventListener('drop', fim) } }, [])
  const classeLinha = (c: string) => (linha?.c === c ? (linha.depois ? 'is-linha-depois' : 'is-linha-antes') : '')
  const [criando, setCriando] = useState(false)
  // botão direito num grupo: menu com Renomear e Deletar (fecha com clique fora ou Esc)
  const [menuGrupo, setMenuGrupo] = useState<{ x: number; y: number; c: string } | null>(null)
  useEffect(() => {
    if (!menuGrupo) return
    const fora = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.tabela-menu')) setMenuGrupo(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenuGrupo(null) } }
    window.addEventListener('pointerdown', fora, true); window.addEventListener('keydown', esc, true)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('keydown', esc, true) }
  }, [menuGrupo])
  // Status e Categorias recolhem pelo título (setinha logo depois do texto; fica guardado)
  const [secoes, setSecoes] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('cats-secoes-fechadas') || '[]') } catch { return [] } })
  useEffect(() => { try { localStorage.setItem('cats-secoes-fechadas', JSON.stringify(secoes)) } catch { /* sem storage */ } }, [secoes])
  const tituloSecao = (k: string, rotulo: string) => {
    const aberta = !secoes.includes(k)
    return <button type="button" className={`cats-t-btn ${aberta ? 'is-aberta' : ''}`} aria-expanded={aberta} title={aberta ? 'Recolher' : 'Expandir'}
      onClick={() => setSecoes((f) => (aberta ? [...f, k] : f.filter((x) => x !== k)))}>{rotulo}
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
  }
  // grupos recolhidos (a chave é o id do divisor; fica guardado)
  const [fechados, setFechados] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('cats-grupos-fechados') || '[]') } catch { return [] } })
  useEffect(() => { try { localStorage.setItem('cats-grupos-fechados', JSON.stringify(fechados)) } catch { /* sem storage */ } }, [fechados])
  // nome do grupo editado ali mesmo (Enter ou sair grava, Esc desiste); '+' é o grupo novo
  const [editGrupo, setEditGrupo] = useState<string | null>(null)
  const campoGrupo = (inicial: string, ok: (n: string) => void) => (
    <input className="cats-grupo-campo" autoFocus defaultValue={inicial} placeholder="Nome do grupo" onClick={(e) => e.stopPropagation()}
      onBlur={(e) => { setEditGrupo(null); if (e.currentTarget.value.trim()) ok(e.currentTarget.value) }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = ''; e.currentTarget.blur() } }} />)
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
    <button key={c || '-'} className={`cats-item ${sel.includes(c) ? 'is-on' : ''} ${sobre === c ? 'is-sobre' : ''} ${classeLinha(c)}`}
      onClick={(e) => clicar(c, e)}
      draggable={!!c && c !== PIN} onDragStart={(e) => { e.dataTransfer.setData('neo/categoria', c); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('neo/copia')) { e.preventDefault(); setSobre(c) }   // copy: muda a categoria (o item acende)
        else if (c && c !== PIN && e.dataTransfer.types.includes('neo/categoria')) { e.preventDefault(); const d = metade(e); setLinha((l) => (l?.c === c && l.depois === d ? l : { c, depois: d })) }
      }}
      onDragLeave={() => setSobre(null)}
      onDrop={(e) => { e.preventDefault(); setSobre(null); const depois = linha?.c === c && linha.depois; setLinha(null)
        const d = e.dataTransfer.getData('neo/copia'); const k = e.dataTransfer.getData('neo/categoria')
        if (d) onSoltar(d, c || SEM); else if (k && c && c !== PIN && k !== c) onOrdem(k, c, !!depois) }}
      onContextMenu={(e) => { if (!c || c === PIN) return; e.preventDefault(); onMenu(c, e.clientX, e.clientY) }}
      title={c === PIN ? 'Só as pinadas (📌) · solte uma copy aqui para pinar' : c ? 'Clique filtra (⌘ soma) · solte uma copy aqui para mudar a categoria · botão direito: cor, renomear' : undefined}>
      {c && c !== PIN && <i className="cats-cor" style={cores[c] ? { background: cores[c] } : undefined} />}
      <span>{rotulo}</span><em>{c === PIN ? nPins : contagem[c] ?? 0}</em>
    </button>
  )
  return (
    <aside className="cats" aria-label="Categorias" style={{ width: larg }}
      onContextMenu={(e) => { if ((e.target as HTMLElement).closest('.cats-item, .cats-grupo, input')) return; e.preventDefault()
        setMenuGrupo({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 150), c: '' }) }}>
      <i className="cats-alca" onPointerDown={redimensionar} onDoubleClick={() => setLarg(210)} title="Arraste para mudar a largura (duplo clique volta ao padrão)" />
      {status && <>
        <p className="cats-t">{tituloSecao('status', 'Status')}</p>
        {!secoes.includes('status') && status.lista.map((x) => (
          <button key={x.k} className={`cats-item ${status.sel.includes(x.k) ? 'is-on' : ''} ${sobre === `st:${x.k}` ? 'is-sobre' : ''}`}
            title="Clique mostra só este status, de todas as categorias (⌘ soma; clicar de novo tira) · solte uma copy aqui para mudar o status"
            onClick={(e) => { const l = status.sel; status.onSel(e.metaKey || e.ctrlKey ? (l.includes(x.k) ? l.filter((y) => y !== x.k) : [...l, x.k]) : l.length === 1 && l[0] === x.k ? [] : [x.k]) }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('neo/copia')) { e.preventDefault(); setSobre(`st:${x.k}`) } }}
            onDragLeave={() => setSobre(null)}
            onDrop={(e) => { e.preventDefault(); setSobre(null); const d = e.dataTransfer.getData('neo/copia'); if (d) status.onSoltar(d, x.k) }}>
            <span>{x.rotulo}</span><em>{x.n}</em>
          </button>
        ))}
      </>}
      <div className="cats-t cats-t-segunda cats-t-acoes">
        {tituloSecao('cats', 'Categorias')}
        {/* ações discretas, só com o cursor sobre o título (o botão direito no vazio do menu tem as mesmas) */}
        <span className="cats-t-botoes">
          <button type="button" onClick={() => setCriando(true)} title="Nova categoria" aria-label="Nova categoria"><Icone n="mais" t={13} /></button>
          <button type="button" onClick={() => setEditGrupo('+')} title="Novo grupo" aria-label="Novo grupo"><Icone n="grupo" t={13} /></button>
          {onArquivados && <button type="button" onClick={onArquivados} title={`Arquivados (${nArquivados ?? arquivadas.length})`} aria-label="Arquivados"><Icone n="arquivo" t={13} /></button>}
        </span>
      </div>
      {!secoes.includes('cats') && <>
      {(() => {
        // cada divisor abre um grupo (as categorias abaixo, até o próximo divisor). Padrão de barra lateral: setinha à
        // esquerda (aparece no hover; fechado, fica e mostra quantas categorias estão escondidas), a linha toda recolhe
        let fechado = false
        return lista.map((c, i) => {
          if (!ehDivisor(c)) return fechado ? null : item(c, c)
          const id = c.split('|')[0], nome = nomeDivisor(c)
          fechado = fechados.includes(id)
          const fim = lista.slice(i + 1).findIndex(ehDivisor)
          const n = (fim < 0 ? lista.slice(i + 1) : lista.slice(i + 1, i + 1 + fim)).length
          const alternar = () => setFechados((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))
          return (
            <div key={c} className={`cats-div cats-grupo ${classeLinha(c)} ${fechado ? 'is-fechado' : ''} ${cores[id] ? 'com-cor' : ''}`} draggable
              style={cores[id] ? { '--cor-grupo': cores[id] } as React.CSSProperties : undefined}
              role="button" tabIndex={0} aria-expanded={!fechado}
              title={`${fechado ? 'Mostrar' : 'Esconder'} as categorias de ${nome || 'este grupo'} · botão direito: renomear ou deletar · arraste muda o lugar`}
              onClick={() => { if (editGrupo !== c) alternar() }}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && editGrupo !== c) { e.preventDefault(); alternar() } }}
              onDragStart={(e) => { e.dataTransfer.setData('neo/categoria', c); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('neo/categoria')) { e.preventDefault(); const d = metade(e); setLinha((l) => (l?.c === c && l.depois === d ? l : { c, depois: d })) } }}
              onDrop={(e) => { e.preventDefault(); const depois = linha?.c === c && linha.depois; setLinha(null); const k = e.dataTransfer.getData('neo/categoria'); if (k && k !== c) onOrdem(k, c, !!depois) }}
              onContextMenu={(e) => { e.preventDefault(); setMenuGrupo({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 230), c }) }}>
              <svg className="cats-grupo-seta" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3.5 3-3.5 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {editGrupo === c ? campoGrupo(nome, (v) => onRenomearDivisor?.(c, comNome(c, v))) : <span className="cats-grupo-nome">{nome || 'Grupo'}</span>}
              {fechado && <em className="cats-grupo-n">{n}</em>}
              <hr /></div>)
        })
      })()}
      {(contagem[''] ?? 0) > 0 && item('', SEM)}
      {(criando || editGrupo === '+') && <div className="cats-acoes">
        {criando && <EditorCategoria onOk={(n) => { setCriando(false); onCriar(n) }} onCancelar={() => setCriando(false)} />}
        {editGrupo === '+' && campoGrupo('', onDivisor)}
      </div>}
      </>}
      {menuGrupo && createPortal(
        <div className="tabela-menu glass glass--light" style={{ left: menuGrupo.x, top: menuGrupo.y }} role="menu">
          {menuGrupo.c ? <>
            <button onClick={() => { const c = menuGrupo.c; setMenuGrupo(null); setEditGrupo(c) }}>✏️ Renomear</button>
            <button className="is-perigo" onClick={() => { const c = menuGrupo.c; setMenuGrupo(null); onTirar(c) }} title="As categorias do grupo ficam no menu">Deletar</button>
            {onCor && (() => { const id = menuGrupo.c.split('|')[0]; return <>
              <hr />
              <p className="tabela-menu-t">Cor</p>
              <div className="tabela-cores-grade">
                {PASTEIS.map((cor) => <button key={cor} className={cores[id] === cor ? 'is-on' : ''} style={{ background: cor }} title={cor}
                  onClick={() => { onCor(id, cor); setMenuGrupo(null) }} />)}
                <button className={`tabela-sem-cor ${cores[id] ? '' : 'is-on'}`} title="Sem cor" aria-label="Sem cor" onClick={() => { onCor(id, ''); setMenuGrupo(null) }} />
              </div></> })()}
          </> : <>   {/* botão direito no vazio do menu: as mesmas ações do título Categorias */}
            <button onClick={() => { setMenuGrupo(null); setCriando(true) }}>＋ Nova categoria</button>
            <button onClick={() => { setMenuGrupo(null); setEditGrupo('+') }}>☰ Novo grupo</button>
            {onArquivados && <button onClick={() => { setMenuGrupo(null); onArquivados() }}>🗄️ Arquivados ({nArquivados ?? arquivadas.length})</button>}
          </>}
        </div>, document.body)}
    </aside>
  )
}
