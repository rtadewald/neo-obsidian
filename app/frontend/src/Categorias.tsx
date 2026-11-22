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
export const idGrupo = (div: string) => div.split('|')[0]

/** Dois níveis (22/11/2026): os grupos (divisores) são o principal (só nome e cor) e as categorias abaixo deles, o
 *  secundário. A nota guarda só o nome do secundário; o ícone dele fica em `icones` (criacao.json). */
export type ModeloCats = { categorias: string[]; icones?: Record<string, string>; arquivadas?: string[] }
/** O grupo (divisor) de uma categoria: o divisor mais próximo acima dela na lista. */
export function grupoDe(lista: string[], nome: string): string | null {
  for (let k = lista.indexOf(nome) - 1; k >= 0; k--) if (ehDivisor(lista[k])) return lista[k]
  return null
}
/** O ícone da categoria (secundário). */
export const iconeCat = (m: ModeloCats, nome: string): string => (nome ? m.icones?.[nome] ?? '' : '')
/** Quadro (orgânico) ou funil (pago): o do grupo vale para as categorias dele; sem grupo, o da própria categoria. */
export type TipoCat = 'quadro' | 'funil'
export function tipoCat(lista: string[], tipos: Record<string, string> | undefined, c: string): TipoCat {
  const t = tipos ?? {}
  if (ehDivisor(c)) return t[idGrupo(c)] === 'funil' ? 'funil' : 'quadro'
  const g = grupoDe(lista, c)
  if (g) return t[idGrupo(g)] === 'funil' ? 'funil' : 'quadro'
  return t[c] === 'funil' ? 'funil' : 'quadro'
}
export const rotuloCat = (m: ModeloCats, nome: string) => { const i = iconeCat(m, nome); return i ? `${i} ${nome}` : nome }
/** Arquivada: ela mesma ou o grupo dela. */
export function arquivadaCat(m: ModeloCats, nome: string): boolean {
  const a = m.arquivadas ?? []
  if (a.includes(nome)) return true
  const g = grupoDe(m.categorias, nome)
  return !!g && a.includes(idGrupo(g))
}

// nomes antigos (com o emoji no nome) guardados no navegador: filtro da tabela, pinados, última categoria do ⌘K
const RENOMES: Record<string, string> = { '💰 VSL FIA': 'Ads VSL FIA', '💰 VSL FID': 'Ads VSL FID', '📺 VSL FIA': 'VSL FIA', '📺 VSL FID': 'VSL FID' }
const nomeNovo = (c: string) => RENOMES[c] ?? (c && !c.startsWith('\u0000') && !c.startsWith('—') ? c.replace(/^[^\p{L}\p{N}]+/u, '') : c)
try {
  if (localStorage.getItem('cats-2-niveis') !== 'sim') {
    const pins = JSON.parse(localStorage.getItem('cats-pinados') || '[]') as string[]
    localStorage.setItem('cats-pinados', JSON.stringify(pins.map((k) => (k.startsWith('cat:') ? `cat:${nomeNovo(k.slice(4))}` : k))))
    const est = JSON.parse(localStorage.getItem('tabela-estado') || '{}') as Record<string, { t?: { filtros?: { categoria?: string[] } } }>
    for (const g of Object.values(est)) if (g?.t?.filtros?.categoria) g.t.filtros.categoria = g.t.filtros.categoria.map(nomeNovo)
    localStorage.setItem('tabela-estado', JSON.stringify(est))
    const nc = localStorage.getItem('novo-categoria'); if (nc) localStorage.setItem('novo-categoria', nomeNovo(nc))
    localStorage.setItem('cats-2-niveis', 'sim')
  }
} catch { /* sem storage */ }

export function listaCategorias(producoes: Producao[], ordem: string[]): string[] {
  const nas = [...new Set(producoes.map((p) => p.categoria).filter((c): c is string => !!c))]
  const resto = nas.filter((c) => !ordem.includes(c)).sort((a, b) => semEmoji(a).localeCompare(semEmoji(b)))
  return [...resto, ...ordem.filter((c) => c && c !== SEM)]   // as que só existem nas notas entram soltas no topo (no fim cairiam no último grupo)
}

/** Status e categorias pinados no menu (`st:<status>` e `cat:<nome>`, no localStorage): com o pai recolhido (a seção
 *  Status ou Categorias, ou o grupo), os pinados continuam à vista. O menu de botão direito da Tabela também pina. */
const CHAVE_PINS = 'cats-pinados'
const lerPins = (): string[] => { try { return JSON.parse(localStorage.getItem(CHAVE_PINS) || '[]') } catch { return [] } }
export function usePinsMenu() {
  const [pins, setPins] = useState<string[]>(lerPins)
  useEffect(() => { const f = () => setPins(lerPins()); window.addEventListener('cats-pins', f); return () => window.removeEventListener('cats-pins', f) }, [])
  const alternar = (k: string) => {
    const l = lerPins(), n = l.includes(k) ? l.filter((x) => x !== k) : [...l, k]
    try { localStorage.setItem(CHAVE_PINS, JSON.stringify(n)) } catch { /* sem storage */ }
    window.dispatchEvent(new Event('cats-pins'))
  }
  return [pins, alternar] as const
}

/** Ícones prontos para grupos e categorias (os mesmos dos formatos do vault, e alguns a mais). */
export const ICONES_CAT = ['📱', '💰', '📺', '📚', '🎥', '🏞️', '📝', '🎙️', '🤖', '🧩', '⚡', '🔥']

/** Criar ou renomear ali mesmo: a categoria (secundário) tem ícone + nome; o grupo (principal, `semIcone`) só nome.
 *  Enter grava, Esc desiste. */
export function EditorCategoria({ inicial = '', icone: icone0 = '', semIcone, placeholder = 'Nome da categoria', onOk, onCancelar }: {
  inicial?: string; icone?: string; semIcone?: boolean; placeholder?: string
  onOk: (nome: string, icone: string | null) => void; onCancelar: () => void
}) {
  const [icone, setIcone] = useState<string>(icone0 || '📱')
  const [texto, setTexto] = useState(inicial)
  const gravar = () => { const t = texto.trim(); if (t) onOk(t, semIcone ? null : icone); else onCancelar() }
  return (
    <div className="cats-editor" onClick={(e) => e.stopPropagation()}>
      {!semIcone && <div className="cats-editor-icones" role="radiogroup" aria-label="Ícone">
        {ICONES_CAT.map((i) => <button key={i} type="button" role="radio" aria-checked={i === icone} className={i === icone ? 'is-on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => setIcone(i)}>{i}</button>)}
      </div>}
      <label className="cats-editor-campo">{!semIcone && <span>{icone}</span>}
        <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} onBlur={gravar}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); gravar() } else if (e.key === 'Escape') { e.preventDefault(); onCancelar() } }} />
      </label>
    </div>
  )
}

/** Menu de categorias à esquerda da tabela: clicar filtra (⌘ soma mais de uma), soltar uma copy muda a categoria dela,
 *  arrastar uma categoria sobre outra muda a ordem, botão direito dá cor, renomeia ou apaga, e "+ Nova categoria". */
export function MenuCategorias({ novas = [], status, onArquivados, nArquivados, lista, icones = {}, tipos = {}, onTipo, renomear, onRenomear, arquivadas, contagem, nPins, sel, cores, onSel, onSoltar, onOrdem, onCriar, onMenu, onDivisor, onRenomearDivisor, onArquivarGrupo, onTirar, onCor }: {
  /** Status acima das categorias: clicar filtra (⌘ soma), soltar uma copy muda o status dela. */
  status?: { lista: { k: string; rotulo: string; n: number }[]; sel: string[]; onSel: (l: string[]) => void; onSoltar: (copia: string, k: string) => void }
  novas?: string[]   // categorias com copy nova (ainda não aberta): 💡 piscando e à vista como as pinadas
  onArquivados?: () => void   // botão 🗄️ Arquivados no fim: abre a janela com as categorias e copies arquivadas
  nArquivados?: number
  lista: string[]
  icones?: Record<string, string>   // ícone de cada categoria
  tipos?: Record<string, string>   // 'funil' (pago) para grupos (—id) e categorias soltas; o resto é quadro (orgânico)
  onTipo?: (chave: string, tipo: TipoCat) => void   // soltar no título da outra seção ou botão direito: vira quadro/funil
  renomear: string | null   // a categoria sendo renomeada ali mesmo (botão direito → Renomear)
  onRenomear: (de: string, para: string | null, icone?: string | null) => void   // para null = desistiu; icone null = herda do grupo
  arquivadas: string[]   // ficam numa seção recolhida no fim (botão direito desarquiva)
  contagem: Record<string, number>   // copies da aba em cada categoria ('' = sem categoria)
  nPins: number   // pinadas da aba
  total: number
  sel: string[]
  cores: Record<string, string>
  onSel: (l: string[]) => void
  onSoltar: (copia: string, cat: string) => void   // copia = JSON do arraste da tabela
  onOrdem: (de: string, para: string, depois?: boolean) => void   // depois: logo abaixo de `para` (soltar num grupo)
  onCriar: (nome: string, icone: string | null, tipo: TipoCat) => void
  onMenu: (cat: string, x: number, y: number) => void
  onDivisor: (nome: string, icone: string | null, tipo: TipoCat) => void   // põe um grupo (divisor) com esse nome no fim da lista
  onRenomearDivisor?: (de: string, para: string, icone: string | null) => void
  onArquivarGrupo?: (divisor: string) => void   // o grupo e as categorias dele saem do menu (voltam por Arquivados)
  onCor?: (chave: string, cor: string) => void   // cor de um grupo (a chave é o id do divisor; '' tira)
  onTirar: (divisor: string) => void
}) {
  const [sobre, setSobre] = useState<string | null>(null)
  const modelo: ModeloCats = { categorias: lista, icones }
  const [pinsMarcados, alternarPin] = usePinsMenu()
  const pins = [...pinsMarcados, ...novas.map((c) => `cat:${c}`)]   // as categorias com copy nova ficam à vista como as pinadas
  // alfinete: aparece com o cursor sobre o item; pinado, fica sempre (clicar pina ou despina)
  const alfinete = (k: string) => (
    <i role="button" tabIndex={-1} className={`cats-pin ${pinsMarcados.includes(k) ? 'is-on' : ''}`} title={pinsMarcados.includes(k) ? 'Despinar' : 'Pinar: fica à vista com o grupo recolhido'}
      onClick={(e) => { e.stopPropagation(); alternarPin(k) }}><Icone n="pin" t={12} /></i>)
  // arrastar uma categoria (ou um grupo): uma linha horizontal marca onde ela vai ficar (antes ou depois do item)
  const [linha, setLinha] = useState<{ c: string; depois: boolean } | null>(null)
  const metade = (e: React.DragEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return e.clientY > r.top + r.height / 2 }
  useEffect(() => { const fim = () => setLinha(null); window.addEventListener('dragend', fim); window.addEventListener('drop', fim); return () => { window.removeEventListener('dragend', fim); window.removeEventListener('drop', fim) } }, [])
  const classeLinha = (c: string) => (linha?.c === c ? (linha.depois ? 'is-linha-depois' : 'is-linha-antes') : '')
  const [criando, setCriando] = useState<TipoCat | null>(null)   // a seção onde a categoria nova vai nascer
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
  // grupo editado ali mesmo (ícone + nome; Enter grava, Esc desiste); '+' é o grupo novo
  const [editGrupo, setEditGrupo] = useState<string | null>(null)
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
  // dentro de um grupo a categoria fica sem ícone e recuada (o ícone é do grupo); solta, mostra o dela
  const item = (c: string, rotulo: string, filho = false) => c && c === renomear ? <EditorCategoria key={c} inicial={c} icone={icones[c]}
      onOk={(n, ic) => onRenomear(c, n, ic)} onCancelar={() => onRenomear(c, null)} /> : (
    <button key={c || '-'} className={`cats-item ${filho ? 'is-filho' : ''} ${novas.includes(c) ? 'is-nova' : ''} ${sel.includes(c) ? 'is-on' : ''} ${sobre === c ? 'is-sobre' : ''} ${classeLinha(c)}`}
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
      <span>{rotulo}</span>{c && c !== PIN && alfinete(`cat:${c}`)}{novas.includes(c) && <i className="cats-novo" title="Tem copy nova, ainda não aberta">💡</i>}<em>{c === PIN ? nPins : contagem[c] ?? 0}</em>
    </button>
  )
  return (
    <aside className="cats" aria-label="Categorias" style={{ width: larg }}
      onContextMenu={(e) => { if ((e.target as HTMLElement).closest('.cats-item, .cats-grupo, input')) return; e.preventDefault()
        setMenuGrupo({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 150), c: '' }) }}>
      <i className="cats-alca" onPointerDown={redimensionar} onDoubleClick={() => setLarg(210)} title="Arraste para mudar a largura (duplo clique volta ao padrão)" />
      {status && <>
        <p className="cats-t">{tituloSecao('status', 'Status')}</p>
        {(() => {
          // os de conclusão ficam discretos, lado a lado, embaixo dos outros: Publicado e Inativo em texto; Arquivado só o ícone
          const DISCRETOS = ['publicado', 'inativo', 'arquivado']   // Ativo fica entre os itens (é o que está no ar)
          const clique = (k: string) => (e: React.MouseEvent) => { const l = status.sel; status.onSel(e.metaKey || e.ctrlKey ? (l.includes(k) ? l.filter((y) => y !== k) : [...l, k]) : l.length === 1 && l[0] === k ? [] : [k]) }
          const soltar = (k: string) => ({
            onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('neo/copia')) { e.preventDefault(); setSobre(`st:${k}`) } },
            onDragLeave: () => setSobre(null),
            onDrop: (e: React.DragEvent) => { e.preventDefault(); setSobre(null); const d = e.dataTransfer.getData('neo/copia'); if (d) status.onSoltar(d, k) },
          })
          const visiveis = status.lista.filter((x) => !secoes.includes('status') || pins.includes(`st:${x.k}`))
          const discretos = visiveis.filter((x) => DISCRETOS.includes(x.k))
          return <>
            {visiveis.filter((x) => !DISCRETOS.includes(x.k)).map((x) => (
              <button key={x.k} className={`cats-item ${x.k === 'ideia' ? 'is-especial' : ''} ${status.sel.includes(x.k) ? 'is-on' : ''} ${sobre === `st:${x.k}` ? 'is-sobre' : ''}`}
                title="Clique mostra só este status, de todas as categorias (⌘ soma; clicar de novo tira) · solte uma copy aqui para mudar o status"
                onClick={clique(x.k)} {...soltar(x.k)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenuGrupo({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 80), c: `st:${x.k}` }) }}>
                <span>{x.rotulo}</span>{alfinete(`st:${x.k}`)}<em>{x.n}</em>
              </button>
            ))}
            {discretos.length > 0 && <div className="cats-discretos">
              {discretos.map((x) => (
                <button key={x.k} className={`${x.k === 'arquivado' ? 'is-icone' : ''} ${status.sel.includes(x.k) ? 'is-on' : ''} ${sobre === `st:${x.k}` ? 'is-sobre' : ''}`}
                  title={`${x.rotulo.replace(/^\S+\s/, '')} (${x.n}) · clique mostra só este status (⌘ soma) · solte uma copy aqui para mudar o status`}
                  aria-label={x.k === 'arquivado' ? `Arquivado (${x.n})` : undefined} onClick={clique(x.k)} {...soltar(x.k)}>
                  {x.k === 'arquivado' ? <Icone n="arquivo" t={12} /> : x.rotulo.replace(/^\S+\s/, '')}
                </button>
              ))}
            </div>}
          </>
        })()}
      </>}
      {(['quadro', 'funil'] as TipoCat[]).map((tipo, k) => {
        // Quadros (orgânico) e Funis (pago): cada seção mostra os grupos e categorias do seu tipo, na ordem da lista
        const chave = tipo === 'funil' ? 'cats' : 'quadros'
        const daSecao = lista.filter((c) => tipoCat(lista, tipos, c) === tipo)
        const aberta = !secoes.includes(chave)
        return (
          <div key={tipo} className="cats-secao">
            <div className={`cats-t ${k === 0 ? 'cats-t-segunda' : 'cats-t-terceira'} cats-t-acoes ${sobre === `sec:${tipo}` ? 'is-sobre' : ''}`}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('neo/categoria')) { e.preventDefault(); setSobre(`sec:${tipo}`) } }}
              onDragLeave={() => setSobre(null)}
              onDrop={(e) => { e.preventDefault(); setSobre(null); const c = e.dataTransfer.getData('neo/categoria'); if (c) onTipo?.(c, tipo) }}
              title={`Solte aqui uma categoria ou grupo para virar ${tipo === 'funil' ? 'funil' : 'quadro'}`}>
              {tituloSecao(chave, tipo === 'funil' ? 'Funis' : 'Quadros')}
              {/* ações discretas, só com o cursor sobre o título (o botão direito no vazio do menu tem as mesmas) */}
              <span className="cats-t-botoes">
                <button type="button" onClick={() => setCriando(tipo)} title={`Nova categoria (${tipo})`} aria-label="Nova categoria"><Icone n="mais" t={13} /></button>
                <button type="button" onClick={() => setEditGrupo(`+${tipo}`)} title={`Novo grupo (${tipo === 'funil' ? 'funis' : 'quadros'})`} aria-label="Novo grupo"><Icone n="grupo" t={13} /></button>
                {k === 1 && onArquivados && <button type="button" onClick={onArquivados} title={`Arquivados (${nArquivados ?? 0})`} aria-label="Arquivados"><Icone n="arquivo" t={13} /></button>}
              </span>
            </div>
            {!aberta && daSecao.filter((c) => !ehDivisor(c) && pins.includes(`cat:${c}`)).map((c) => item(c, rotuloCat(modelo, c)))}
            {aberta && <>
            {(() => {
              // cada divisor abre um grupo (as categorias abaixo, até o próximo divisor). Padrão de barra lateral: setinha à
              // esquerda (aparece no hover; fechado, fica e mostra quantas categorias estão escondidas), a linha toda recolhe
              let fechado = false
              return daSecao.map((c, i) => {
                if (!ehDivisor(c)) { const filho = !!grupoDe(daSecao, c); return fechado && !pins.includes(`cat:${c}`) ? null : item(c, filho ? c : rotuloCat(modelo, c), filho) }
                const id = c.split('|')[0], nome = nomeDivisor(c)
                fechado = fechados.includes(id)
                const fim = daSecao.slice(i + 1).findIndex(ehDivisor)
                const n = (fim < 0 ? daSecao.slice(i + 1) : daSecao.slice(i + 1, i + 1 + fim)).filter((x) => !pins.includes(`cat:${x}`)).length
                const alternar = () => setFechados((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))
                return (
                  <div key={c} className={`cats-div cats-grupo ${classeLinha(c)} ${fechado ? 'is-fechado' : ''} ${cores[id] ? 'com-cor' : ''}`} draggable
                    style={cores[id] ? { '--cor-grupo': cores[id] } as React.CSSProperties : undefined}
                    role="button" tabIndex={0} aria-expanded={!fechado}
                    title={`${fechado ? 'Mostrar' : 'Esconder'} as categorias de ${nome || 'este grupo'} · botão direito: renomear, mover, arquivar · arraste muda o lugar (para a outra seção, troca o tipo)`}
                    onClick={() => { if (editGrupo !== c) alternar() }}
                    onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && editGrupo !== c) { e.preventDefault(); alternar() } }}
                    onDragStart={(e) => { e.dataTransfer.setData('neo/categoria', c); e.dataTransfer.effectAllowed = 'move' }}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes('neo/categoria')) { e.preventDefault(); const d = metade(e); setLinha((l) => (l?.c === c && l.depois === d ? l : { c, depois: d })) } }}
                    onDrop={(e) => { e.preventDefault(); const depois = linha?.c === c && linha.depois; setLinha(null); const k2 = e.dataTransfer.getData('neo/categoria'); if (k2 && k2 !== c) onOrdem(k2, c, !!depois) }}
                    onContextMenu={(e) => { e.preventDefault(); setMenuGrupo({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 260), c }) }}>
                    {/* o pai alinhado como os outros itens: bolinha (com a cor do grupo), ícone, nome; a setinha fica à direita */}
                    <i className="cats-cor" style={cores[id] ? { background: cores[id] } : undefined} />
                    {editGrupo === c ? <EditorCategoria inicial={nome} icone={icones[id]} placeholder="Nome do grupo"
                        onOk={(v, ic) => { setEditGrupo(null); onRenomearDivisor?.(c, comNome(c, v), ic) }} onCancelar={() => setEditGrupo(null)} />
                      : <span className="cats-grupo-nome">{icones[id] && <b className="cats-grupo-ic">{icones[id]}</b>}{nome || 'Grupo'}</span>}
                    {fechado && <em className="cats-grupo-n">{n}</em>}
                    <svg className="cats-grupo-seta" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3.5 3-3.5 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>)
              })
            })()}
            {tipo === 'quadro' && (contagem[''] ?? 0) > 0 && item('', SEM)}
            {(criando === tipo || editGrupo === `+${tipo}`) && <div className="cats-acoes">
              {criando === tipo && <EditorCategoria onOk={(n, ic) => { setCriando(null); onCriar(n, ic, tipo) }} onCancelar={() => setCriando(null)} />}
              {editGrupo === `+${tipo}` && <EditorCategoria placeholder="Nome do grupo" onOk={(n, ic) => { setEditGrupo(null); onDivisor(n, ic, tipo) }} onCancelar={() => setEditGrupo(null)} />}
            </div>}
            </>}
          </div>)
      })}
      {menuGrupo && createPortal(
        <div className="tabela-menu glass glass--light" style={{ left: menuGrupo.x, top: menuGrupo.y }} role="menu">
          {menuGrupo.c.startsWith('st:') ? (
            <button onClick={() => { const k = menuGrupo.c; setMenuGrupo(null); alternarPin(k) }}>📌 {pinsMarcados.includes(menuGrupo.c) ? 'Despinar' : 'Pinar'}</button>
          ) : menuGrupo.c ? <>
            <button onClick={() => { const c = menuGrupo.c; setMenuGrupo(null); setEditGrupo(c) }}>✏️ Renomear</button>
            {onTipo && (() => { const t = tipoCat(lista, tipos, menuGrupo.c), outro: TipoCat = t === 'funil' ? 'quadro' : 'funil'
              return <button onClick={() => { const c = menuGrupo.c; setMenuGrupo(null); onTipo(c, outro) }}>{outro === 'funil' ? '💸 Mover para Funis' : '🎬 Mover para Quadros'}</button> })()}
            {onArquivarGrupo && <button onClick={() => { const c = menuGrupo.c; setMenuGrupo(null); onArquivarGrupo(c) }} title="O grupo e as categorias dele saem do menu (voltam por Arquivados, no fim)">🗄️ Arquivar</button>}
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
            <button onClick={() => { setMenuGrupo(null); setCriando('quadro') }}>＋ Nova categoria (quadro)</button>
            <button onClick={() => { setMenuGrupo(null); setCriando('funil') }}>＋ Nova categoria (funil)</button>
            <button onClick={() => { setMenuGrupo(null); setEditGrupo('+quadro') }}>☰ Novo grupo (quadros)</button>
            <button onClick={() => { setMenuGrupo(null); setEditGrupo('+funil') }}>☰ Novo grupo (funis)</button>
            {onArquivados && <button onClick={() => { setMenuGrupo(null); onArquivados() }}>🗄️ Arquivados ({nArquivados ?? arquivadas.length})</button>}
          </>}
        </div>, document.body)}
    </aside>
  )
}
