import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { EditorView } from '@codemirror/view'
import { CalendarioEditorial } from './CalendarioEditorial'
import { Editor, envolver, selecao, titulo as virarTitulo, type Selecao } from './Editor'
import { Icone } from './Icone'
import { Markdown } from './Markdown'

/** Mesa de ideias: as copies e as skills, abertas como no Obsidian.
 *  Lista à esquerda por status (working, ideia, em edição, agendado, publicado; botão direito para mudar),
 *  nota à direita já em edição.
 *  Salva sozinho (1 s depois de parar de digitar) e com ⌘S. ⌘P abre a busca rápida em todas as pastas. */
export type Raiz = 'priorizar' | 'publicados' | 'skills' | 'ideias' | 'entradas'
type Aba = 'copies' | 'skills' | 'calendario'
type Status = 'ideia' | 'edicao' | 'agendado' | 'publicado' | ''
type Categoria = 'todos' | 'working' | 'ideia' | 'edicao' | 'agendado' | 'publicado'
type Item = { nome: string; raiz: Raiz; mtime: number; tamanho: number; previa: string; fixada: boolean; status: Status }
type Nota = { nome: string; raiz: Raiz; caminho: string; texto: string; mtime: number }
type Estado = 'salvo' | 'editando' | 'salvando' | 'conflito' | 'erro'
type Menu = { x: number; y: number; item: Item }
/** Trecho de nota mandado para o chat do Jarvis (⌘I ou botão direito no editor). */
export type Trecho = Selecao & { raiz: Raiz; nome: string; caminho: string }

export const PASTA: Record<Raiz, string> = { priorizar: '1 Copies/1 Priorizar', publicados: '1 Copies/2 Publicados', skills: '3 Skills', ideias: '1 Copies/0 Ideias', entradas: '1 Copies/0 Ideias/Entradas' }
const ROTULO: Record<Raiz, string> = { priorizar: 'Priorizar', publicados: 'Publicados', skills: 'Skills', ideias: 'Ideias', entradas: 'Entradas' }
/** Como o Rodrigo marca no Obsidian: pin = working, 🧑🏼‍🔧 = em edição, 🔹 = agendado, pasta 2 Publicados = publicado. */
const CATEGORIAS: { k: Categoria; nome: string; marca: string }[] = [
  { k: 'todos', nome: 'Todos', marca: '📄' },
  { k: 'working', nome: 'Working', marca: '📌' },
  { k: 'ideia', nome: 'Ideias', marca: '💡' },
  { k: 'edicao', nome: 'Em edição', marca: '🧑🏼‍🔧' },
  { k: 'agendado', nome: 'Agendados', marca: '🔹' },
  { k: 'publicado', nome: 'Publicados', marca: '✅' },
]
const ROTULO_STATUS: Record<string, string> = { ideia: 'Ideia', edicao: 'Em edição', agendado: 'Agendado', publicado: 'Publicado' }
/** Tipo de conteúdo, pelo emoji no início do nome (convenção do vault). */
type Tipo = '' | 'reels' | 'vsl' | 'ads' | 'youtube' | 'estatico' | 'live' | 'aulas'
const TIPOS: { k: Tipo; nome: string; marcas: string[] }[] = [
  { k: '', nome: 'Todos os tipos', marcas: [] },
  { k: 'reels', nome: 'Reels', marcas: ['📱'] },
  { k: 'vsl', nome: 'VSLs', marcas: ['📺'] },
  { k: 'ads', nome: 'Ads', marcas: ['💰'] },
  { k: 'youtube', nome: 'YouTube', marcas: ['🎥'] },
  { k: 'estatico', nome: 'Estático / Carrossel', marcas: ['🏞️'] },
  { k: 'live', nome: 'Lives', marcas: ['🎙️'] },
  { k: 'aulas', nome: 'Aulas', marcas: ['🧑🏼‍🏫', '💻', '📚'] },
]
const tipoDoNome = (t: Tipo, nome: string) => TIPOS.find((x) => x.k === t)?.marcas.some((m) => nome.includes(m)) ?? false
const chave = (r: Raiz, n: string) => `${r}/${n}`
const url = (raiz: Raiz, nome: string) => `/api/notas/${raiz}/${encodeURIComponent(nome)}`
const caminhoVault = (r: Raiz, n: string) => (r === 'skills' ? `${PASTA[r]}/${n}/SKILL` : `${PASTA[r]}/${n}`)
export const obsidian = (r: Raiz, n: string) => `obsidian://open?vault=${encodeURIComponent('Obsidian Notes')}&file=${encodeURIComponent(caminhoVault(r, n))}`

function quando(ts: number) {
  const d = (Date.now() / 1000 - ts) / 86400
  if (d < 1 / 24) return 'agora'
  if (d < 1) return `${Math.round(d * 24)} h`
  if (d < 30) return `${Math.round(d)} d`
  return new Date(ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
}

async function acao(r: Raiz, nome: string, corpo: Record<string, string>) {
  const res = await fetch(`${url(r, nome)}/acao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.detail || 'Não deu certo.')
  return d
}

export function Ideias({ abrir, busca, onTrecho, versao }: {
  abrir?: { raiz: Raiz; nome: string | null; n: number }; busca?: number
  onTrecho?: (t: Trecho, pedido?: string) => void   // manda o trecho para o chat (com um pedido pronto, nas ações rápidas)
  versao?: number                                     // o chat terminou de responder: a nota aberta pode ter mudado
}) {
  const [aba, setAba] = useState<Aba>(abrir?.raiz === 'skills' ? 'skills' : 'copies')
  const [listas, setListas] = useState<Record<Raiz, Item[]>>({ priorizar: [], publicados: [], skills: [], ideias: [], entradas: [] })
  const [cat, setCat] = useState<Categoria>(() => { try { return (localStorage.getItem('ideias-cat') as Categoria) || 'working' } catch { return 'working' } })
  const [tipo, setTipo] = useState<Tipo>(() => { try { return (localStorage.getItem('ideias-tipo') as Tipo) || '' } catch { return '' } })
  const [nota, setNota] = useState<Nota | null>(null)
  const [texto, setTexto] = useState('')
  const [modo, setModo] = useState<'ler' | 'editar'>('editar')
  const [estado, setEstado] = useState<Estado>('salvo')
  const [criando, setCriando] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [renomeando, setRenomeando] = useState<{ k: string; v: string } | null>(null)
  const [paleta, setPaleta] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [lado, setLado] = useState(() => { try { return localStorage.getItem('ideias-lado') !== 'fechado' } catch { return true } })
  const [titulo, setTitulo] = useState<string | null>(null)   // renomeando pelo título da nota aberta
  const [menuEd, setMenuEd] = useState<{ x: number; y: number; sel: boolean } | null>(null)
  const view = useRef<EditorView | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const ref = useRef({ nota, texto, estado })
  ref.current = { nota, texto, estado }

  const avisar = (m: string) => { setAviso(m); window.setTimeout(() => setAviso((a) => (a === m ? null : a)), 2600) }

  const carregarLista = useCallback(async (r: Raiz) => {
    const d = await fetch(`/api/notas/${r}`).then((x) => x.json())
    setListas((l) => ({ ...l, [r]: d.itens }))
    return d.itens as Item[]
  }, [])
  const recarregarTudo = useCallback(() => Promise.all((['priorizar', 'publicados', 'skills'] as Raiz[]).map(carregarLista)), [carregarLista])

  useEffect(() => { recarregarTudo() }, [recarregarTudo])

  const salvar = useCallback(async () => {
    const { nota: n, texto: t, estado: e } = ref.current
    window.clearTimeout(timer.current)
    if (!n || e === 'salvo' || e === 'conflito') return
    setEstado('salvando')
    const r = await fetch(url(n.raiz, n.nome), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: t, mtime: n.mtime }) })
    if (r.status === 409) { setEstado('conflito'); return }
    if (!r.ok) { setEstado('erro'); return }
    const { mtime } = await r.json()
    setNota((x) => (x && x.nome === n.nome ? { ...x, mtime, texto: t } : x))
    setEstado(ref.current.texto === t ? 'salvo' : 'editando')
  }, [])

  const abrirNota = useCallback(async (r: Raiz, nome: string, emModo?: 'ler' | 'editar') => {
    if (ref.current.estado === 'editando') await salvar()
    const res = await fetch(url(r, nome))
    if (!res.ok) return
    const n: Nota = await res.json()
    setAba(r === 'skills' ? 'skills' : 'copies')
    setNota(n); setTexto(n.texto); setEstado('salvo'); setModo(emModo ?? 'editar')
  }, [salvar])

  // aberto de fora (orbe de skills): vai direto para a nota
  useEffect(() => {
    if (!abrir) return
    setAba(abrir.raiz === 'skills' ? 'skills' : 'copies')
    if (abrir.nome) abrirNota(abrir.raiz, abrir.nome)
  }, [abrir, abrirNota])

  useEffect(() => { if (busca) setPaleta(true) }, [busca])

  useEffect(() => { try { localStorage.setItem('ideias-cat', cat) } catch { /* sem storage */ } }, [cat])
  useEffect(() => { try { localStorage.setItem('ideias-tipo', tipo) } catch { /* sem storage */ } }, [tipo])
  useEffect(() => { try { localStorage.setItem('ideias-lado', lado ? 'aberto' : 'fechado') } catch { /* sem storage */ } }, [lado])
  useEffect(() => {  // ⌘B abre e fecha a lista de notas
    const f = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); e.stopPropagation(); setLado((v) => !v) }
    }
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [])
  useEffect(() => setTitulo(null), [nota?.raiz, nota?.nome])

  // primeira nota quando nada está aberto
  useEffect(() => {
    if (nota || abrir?.nome) return
    const c = [...listas.priorizar, ...listas.publicados]
    const primeira = c.find((i) => i.fixada) ?? c.find((i) => i.status === 'edicao') ?? listas.priorizar[0]
    if (primeira) abrirNota(primeira.raiz, primeira.nome)
  }, [listas.priorizar, listas.publicados, nota, abrir, abrirNota])

  useEffect(() => () => { if (ref.current.estado === 'editando') salvar() }, [salvar])

  // o Jarvis pode ter editado a nota aberta: recarrega se não há nada por salvar aqui
  useEffect(() => {
    const n = ref.current.nota
    if (!versao || !n || ref.current.estado !== 'salvo') return
    fetch(url(n.raiz, n.nome)).then((r) => (r.ok ? r.json() : null)).then((d: Nota | null) => {
      const agora = ref.current
      if (!d || !agora.nota || agora.nota.nome !== d.nome || agora.estado !== 'salvo' || d.mtime === agora.nota.mtime) return
      setNota(d); setTexto(d.texto); avisar('O Jarvis editou a nota')
    }).catch(() => {})
  }, [versao])

  async function mandar(sel: Selecao, pedido?: string) {
    const n = ref.current.nota
    if (!n || !onTrecho) return
    await salvar()   // o Jarvis lê o arquivo do disco
    onTrecho({ ...sel, raiz: n.raiz, nome: n.nome, caminho: n.caminho }, pedido)
  }

  function mudar(v: string) {
    setTexto(v)
    setEstado((e) => (e === 'conflito' ? e : 'editando'))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(salvar, 1000)
  }

  async function recarregar() {
    if (nota) { await abrirNota(nota.raiz, nota.nome, modo); carregarLista(nota.raiz) }
  }

  async function criar(titulo: string) {
    const nome = titulo.trim()
    setCriando(null)
    if (!nome || nome === '📱') return
    const r = await fetch('/api/notas/priorizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: nome }) })
    if (!r.ok) { avisar(r.status === 409 ? 'Já existe uma nota com esse nome.' : 'Não consegui criar a nota.'); return }
    const d = await r.json()
    await carregarLista('priorizar')
    abrirNota('priorizar', d.nome, 'editar')
  }

  // --- ações do botão direito ---
  async function executar(item: Pick<Item, 'raiz' | 'nome'>, a: string, extra: Record<string, string> = {}) {
    setMenu(null)
    const aberta = nota && nota.raiz === item.raiz && nota.nome === item.nome
    if (aberta && ref.current.estado === 'editando') await salvar()
    try {
      const d = await acao(item.raiz, item.nome, { acao: a, ...extra })
      if (a === 'mover' || a === 'renomear' || a === 'status') {
        if (aberta) setNota((n) => (n ? { ...n, raiz: d.raiz, nome: d.nome, mtime: d.mtime, caminho: `${PASTA[d.raiz as Raiz]}/${d.nome}.md` } : n))
        if (a === 'mover') avisar(extra.destino === 'publicados' ? `Publicada: foi para ${PASTA.publicados}` : `Voltou para ${ROTULO[extra.destino as Raiz]}`)
        if (a === 'status') avisar(`Agora é ${ROTULO_STATUS[extra.destino].toLowerCase()}`)
      }
      if (a === 'fixar' || a === 'desafixar') avisar(a === 'fixar' ? 'Fixada em Working (aparece no Obsidian também)' : 'Saiu de Working')
      if (a === 'lixeira') {
        if (aberta) setNota(null)
        avisar('Foi para a lixeira do vault (.trash)')
      }
      await recarregarTudo()
    } catch (e) { avisar((e as Error).message) }
  }

  async function confirmarRenome() {
    if (!renomeando) return
    const r = renomeando
    setRenomeando(null)
    const item = [...listas.priorizar, ...listas.publicados].find((i) => chave(i.raiz, i.nome) === r.k)
    if (item && r.v.trim() && r.v.trim() !== item.nome) await executar(item, 'renomear', { novo: r.v.trim() })
  }

  async function confirmarTitulo() {
    if (titulo === null || !nota) return
    const v = titulo.trim()
    setTitulo(null)
    if (v && v !== nota.nome) await executar(nota, 'renomear', { novo: v })
  }

  const todos = useMemo(() => new Set([...listas.priorizar, ...listas.publicados, ...listas.skills].map((i) => i.nome)), [listas])
  const existe = (n: string) => todos.has(n)
  const irPara = (n: string) => {
    const i = [...listas.priorizar, ...listas.skills, ...listas.publicados].find((x) => x.nome === n)
    if (i) abrirNota(i.raiz, i.nome)
  }

  const porCat = useMemo(() => {
    const c = [...listas.priorizar, ...listas.publicados]
    const r = {} as Record<Categoria, Item[]>
    for (const { k } of CATEGORIAS) r[k] = k === 'todos' ? c : k === 'working' ? c.filter((i) => i.fixada) : c.filter((i) => i.status === k)
    return r
  }, [listas])

  const porTipo = useMemo(() => {
    const base = porCat[cat] ?? []
    const r = {} as Record<Tipo, number>
    for (const t of TIPOS) r[t.k] = t.k === '' ? base.length : base.filter((i) => tipoDoNome(t.k, i.nome)).length
    return r
  }, [porCat, cat])

  const grupos: [string, Item[]][] = useMemo(() => {
    if (aba === 'skills') {
      const s = listas.skills
      return [['Fixadas', s.filter((i) => i.fixada)], ['', s.filter((i) => !i.fixada)]]
    }
    const base = porCat[cat] ?? []
    return [['', tipo ? base.filter((i) => tipoDoNome(tipo, i.nome)) : base]]
  }, [aba, listas, cat, tipo, porCat])

  const rotulo: Record<Estado, string> = { salvo: 'Salvo', editando: 'Editando…', salvando: 'Salvando…', conflito: 'Mudou no Obsidian', erro: 'Erro ao salvar' }

  return (
    <div className="ideias">
      <div className="ideias-barra">
        <button className="ideias-btn-lado glass glass--light" onClick={() => setLado((v) => !v)} aria-pressed={!lado}
          title={lado ? 'Esconder a lista de notas (⌘B)' : 'Mostrar a lista de notas (⌘B)'}>
          <Icone n="painel" t={17} />
        </button>
        <div className="abas glass glass--light" role="tablist" aria-label="Notas">
          <button role="tab" aria-selected={aba === 'copies'} className={`aba ${aba === 'copies' ? 'is-ativa' : ''}`} onClick={() => setAba('copies')}>Copies</button>
          <button role="tab" aria-selected={aba === 'skills'} className={`aba ${aba === 'skills' ? 'is-ativa' : ''}`} onClick={() => setAba('skills')}>Skills</button>
          <button role="tab" aria-selected={aba === 'calendario'} className={`aba ${aba === 'calendario' ? 'is-ativa' : ''}`} onClick={() => setAba('calendario')}>Calendário</button>
        </div>
        {aba === 'copies' && (
          <label className="seletor glass glass--light ideias-seletor" title="Status das copies">
            <select value={cat} onChange={(e) => setCat(e.target.value as Categoria)} aria-label="Status das copies">
              {CATEGORIAS.map((c) => <option key={c.k} value={c.k}>{c.marca} {c.nome} · {porCat[c.k].length}</option>)}
            </select>
            <svg className="seletor-seta" viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" /></svg>
          </label>
        )}
        {aba === 'copies' && (
          <label className={`seletor glass glass--light ideias-seletor ${tipo ? 'is-on' : ''}`} title="Filtrar por tipo de conteúdo">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} aria-label="Tipo de conteúdo">
              {TIPOS.map((t) => <option key={t.k} value={t.k}>{t.marcas[0] ? `${t.marcas.join('')} ` : ''}{t.nome} · {porTipo[t.k] ?? 0}</option>)}
            </select>
            <svg className="seletor-seta" viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" /></svg>
          </label>
        )}
        <span className="ideias-barra-esp" />
        <button className="pilula glass glass--light ideias-busca" onClick={() => setPaleta(true)} title="Buscar notas">
          <Icone n="busca" t={15} /> Buscar <kbd>⌘P</kbd>
        </button>
        {aba === 'copies' && (
          <button className="ideias-btn-lado ideias-btn-nova-copy" onClick={() => { setLado(true); setCriando('📱 ') }} title="Nova copy em Priorizar" aria-label="Nova copy">
            <Icone n="mais" t={17} />
          </button>
        )}
      </div>

      {aba === 'calendario' ? (
        <CalendarioEditorial onAbrir={(r, n) => { setAba(r === 'skills' ? 'skills' : 'copies'); abrirNota(r, n) }} />
      ) : (
      <div className={`ideias-mesa ${lado ? '' : 'is-sem-lado'}`}>
      <aside className="ideias-lado glass glass--light" hidden={!lado}>
        {aba === 'copies' && criando !== null && (
          <form className="ideias-nova" onSubmit={(e) => { e.preventDefault(); criar(criando) }}>
            <input autoFocus value={criando} onChange={(e) => setCriando(e.target.value)} onBlur={() => criar(criando)}
              onKeyDown={(e) => e.key === 'Escape' && setCriando(null)} placeholder="📱 Título da copy" />
          </form>
        )}
        <nav className="ideias-lista" aria-label="Notas">
          {grupos.map(([titulo, itens]) => itens.length > 0 && (
            <div key={titulo || 'todas'} className="ideias-grupo">
              {titulo && <p className="ideias-grupo-t">{titulo === 'Fixadas' && <Icone n="pin" t={11} />}{titulo}<span>{itens.length}</span></p>}
              {itens.map((i) => {
                const k = chave(i.raiz, i.nome)
                if (renomeando?.k === k) return (
                  <form key={k} className="ideias-nova" onSubmit={(e) => { e.preventDefault(); confirmarRenome() }}>
                    <input autoFocus value={renomeando.v} onChange={(e) => setRenomeando({ k, v: e.target.value })} onBlur={confirmarRenome}
                      onFocus={(e) => e.target.select()} onKeyDown={(e) => e.key === 'Escape' && setRenomeando(null)} />
                  </form>
                )
                return (
                  <button key={k} className={`ideias-item ${nota && chave(nota.raiz, nota.nome) === k ? 'is-ativa' : ''} ${menu && chave(menu.item.raiz, menu.item.nome) === k ? 'is-menu' : ''}`}
                    onClick={() => abrirNota(i.raiz, i.nome)}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item: i }) }}>
                    <span className="ideias-item-nome">{aba === 'copies' && cat !== 'working' && i.fixada && <span className="ideias-item-pin" title="Working"><Icone n="pin" t={11} /></span>}{i.nome}</span>
                    <span className="ideias-item-previa">{i.previa || 'vazia'}</span>
                    {i.raiz !== 'skills' && <span className="ideias-item-data">{aba === 'copies' && cat === 'working' && i.status !== 'ideia' ? `${ROTULO_STATUS[i.status]?.toLowerCase()} · ` : ''}{quando(i.mtime)}</span>}
                  </button>
                )
              })}
            </div>
          ))}
          {grupos.every(([, l]) => !l.length) && <p className="mudo ideias-vazio">{aba === 'copies' && cat === 'working' ? 'Nada fixado. Botão direito numa nota → Fixar em Working.' : 'Nada aqui ainda.'}</p>}
        </nav>
      </aside>

      <article className="ideias-folha glass glass--light">
        {nota ? (
          <>
            <header className="ideias-topo">
              <div className="ideias-titulo">
                <p className="ideias-caminho">{nota.caminho.split('/').slice(0, -1).join(' / ')}</p>
                {titulo !== null ? (
                  <form onSubmit={(e) => { e.preventDefault(); confirmarTitulo() }}>
                    <input className="ideias-titulo-campo" autoFocus value={titulo} aria-label="Nome da nota"
                      onChange={(e) => setTitulo(e.target.value)} onBlur={confirmarTitulo} onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setTitulo(null) } }} />
                  </form>
                ) : nota.raiz === 'skills' ? <h1>{nota.nome}</h1> : (
                  <h1 className="is-editavel" title="Clique para renomear" tabIndex={0} onClick={() => setTitulo(nota.nome)}
                    onKeyDown={(e) => e.key === 'Enter' && setTitulo(nota.nome)}>{nota.nome}</h1>
                )}
              </div>
              <span className={`ideias-estado is-${estado}`}>
                {estado === 'conflito' ? <button onClick={recarregar}>{rotulo[estado]} · recarregar</button> : rotulo[estado]}
              </span>
              <div className="ideias-modo" role="group" aria-label="Modo">
                <button className={modo === 'editar' ? 'is-on' : ''} onClick={() => setModo('editar')} title="Editar (⌘S salva)"><Icone n="editar" t={16} /></button>
                <button className={modo === 'ler' ? 'is-on' : ''} onClick={() => { salvar(); setModo('ler') }} title="Leitura"><Icone n="ler" t={16} /></button>
              </div>
            </header>
            <div className={`ideias-conteudo ${modo === 'editar' ? 'is-editando' : ''}`} onDoubleClick={() => modo === 'ler' && setModo('editar')}>
              {modo === 'editar'
                ? <Editor chave={`${nota.raiz}/${nota.nome}`} valor={texto} onMudar={mudar} onSalvar={salvar} onLink={irPara} viewRef={view}
                    onJarvis={(s) => mandar(s)} onMenu={(x, y) => { const v = view.current; setMenuEd({ x, y, sel: !!v && !v.state.selection.main.empty }) }} />
                : <Markdown md={texto} existe={existe} onLink={irPara} />}
            </div>
          </>
        ) : <div className="ideias-topo"><p className="mudo">Escolha uma nota ou aperte ⌘P.</p></div>}
      </article>
      </div>
      )}

      {menu && <MenuNota menu={menu} onFechar={() => setMenu(null)}
        onAcao={(a, extra) => executar(menu.item, a, extra)}
        onRenomear={() => { setRenomeando({ k: chave(menu.item.raiz, menu.item.nome), v: menu.item.nome }); setMenu(null) }}
        onCopiar={() => { navigator.clipboard.writeText(`[[${menu.item.nome}]]`); setMenu(null); avisar('Link copiado') }} />}

      {menuEd && view.current && <MenuEditor m={menuEd} view={view.current} onFechar={() => setMenuEd(null)}
        onJarvis={(pedido) => { const v = view.current; setMenuEd(null); if (v) mandar(selecao(v), pedido) }} />}

      {paleta && <Paleta onFechar={() => setPaleta(false)}
        onAbrir={(r, n) => { setPaleta(false); abrirNota(r, n) }}
        onCriar={(t) => { setPaleta(false); criar(t) }} />}

      {aviso && <div className="ideias-aviso" role="status">{aviso}</div>}
    </div>
  )
}

/* ---------- menu do botão direito ---------- */

function MenuNota({ menu, onFechar, onAcao, onRenomear, onCopiar }: {
  menu: Menu; onFechar: () => void; onAcao: (a: string, extra?: Record<string, string>) => void; onRenomear: () => void; onCopiar: () => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })
  const { item } = menu
  const copy = item.raiz !== 'skills'

  useEffect(() => {
    const r = caixa.current?.getBoundingClientRect()
    if (r) setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) })
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) onFechar() }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('mousedown', fora)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', onFechar)
    return () => { window.removeEventListener('mousedown', fora); window.removeEventListener('keydown', esc); window.removeEventListener('blur', onFechar) }
  }, [menu, onFechar])

  const Op = ({ icone, children, onClick, perigo }: { icone: string; children: ReactNode; onClick: () => void; perigo?: boolean }) => (
    <button role="menuitem" className={perigo ? 'is-perigo' : ''} onClick={onClick}><Icone n={icone} t={15} />{children}</button>
  )

  return (
    <div ref={caixa} className="menu-ctx glass glass--light" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <Op icone="pin" onClick={() => onAcao(item.fixada ? 'desafixar' : 'fixar')}>{item.fixada ? 'Tirar de Working' : 'Fixar em Working'}</Op>
      {copy && <>
        <hr />
        {item.raiz === 'priorizar' && <>
          {item.status !== 'ideia' && <Op icone="nota" onClick={() => onAcao('status', { destino: 'ideia' })}>💡 Voltar a ser ideia</Op>}
          {item.status !== 'edicao' && <Op icone="editar" onClick={() => onAcao('status', { destino: 'edicao' })}>🧑🏼‍🔧 Em edição</Op>}
          {item.status !== 'agendado' && <Op icone="calendario" onClick={() => onAcao('status', { destino: 'agendado' })}>🔹 Agendado</Op>}
          <Op icone="publicar" onClick={() => onAcao('mover', { destino: 'publicados' })}>Publicar</Op>
        </>}
        {item.raiz === 'publicados' && <Op icone="pasta" onClick={() => onAcao('mover', { destino: 'priorizar' })}>Voltar para Priorizar</Op>}
        <hr />
        <Op icone="nota" onClick={onRenomear}>Renomear</Op>
      </>}
      <Op icone="link" onClick={onCopiar}>Copiar [[link]]</Op>
      <Op icone="seta" onClick={() => { window.open(obsidian(item.raiz, item.nome)); onFechar() }}>Abrir no Obsidian</Op>
      {copy && <>
        <hr />
        <Op icone="lixeira" perigo onClick={() => { if (confirm(`Mandar "${item.nome}" para a lixeira do vault?`)) onAcao('lixeira'); else onFechar() }}>Mover para a lixeira</Op>
      </>}
    </div>
  )
}

/* ---------- botão direito dentro do editor ---------- */

function MenuEditor({ m, view, onFechar, onJarvis }: {
  m: { x: number; y: number; sel: boolean }; view: EditorView; onFechar: () => void; onJarvis: (pedido?: string) => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: m.x, y: m.y })
  useEffect(() => {
    const r = caixa.current?.getBoundingClientRect()
    if (r) setPos({ x: Math.min(m.x, window.innerWidth - r.width - 8), y: Math.min(m.y, window.innerHeight - r.height - 8) })
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) onFechar() }
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('mousedown', fora); window.addEventListener('keydown', esc); window.addEventListener('blur', onFechar)
    return () => { window.removeEventListener('mousedown', fora); window.removeEventListener('keydown', esc); window.removeEventListener('blur', onFechar) }
  }, [m, onFechar])

  const faz = (f: () => void) => () => { f(); onFechar() }
  const sel = () => { const { from, to } = view.state.selection.main; return view.state.doc.sliceString(from, to) }
  const Op = ({ icone, children, onClick, atalho }: { icone?: string; children: ReactNode; onClick: () => void; atalho?: string }) => (
    <button role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {icone ? <Icone n={icone} t={15} /> : <span className="menu-ctx-sem" />}{children}{atalho && <kbd>{atalho}</kbd>}
    </button>
  )

  return (
    <div ref={caixa} className="menu-ctx glass glass--light" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <p className="menu-ctx-t"><span className="orb orb--msg" />Jarvis</p>
      <Op icone="chat" onClick={() => onJarvis()} atalho="⌘I">{m.sel ? 'Perguntar sobre o trecho' : 'Perguntar sobre esta linha'}</Op>
      {m.sel && <>
        <Op icone="editar" onClick={() => onJarvis('Melhore este trecho mantendo o meu tom e aplique na nota.')}>Melhorar o trecho</Op>
        <Op icone="ler" onClick={() => onJarvis('Deixe este trecho mais curto e direto, sem perder a ideia, e aplique na nota.')}>Encurtar</Op>
        <Op icone="raio" onClick={() => onJarvis('Crie 5 hooks para um Reel a partir deste trecho, usando a skill viral-hooks. Não mexa na nota.')}>Criar hooks com isso</Op>
      </>}
      {m.sel && <>
        <hr />
        <Op onClick={faz(() => envolver(view, '**'))}><b>Negrito</b></Op>
        <Op onClick={faz(() => envolver(view, '*'))}><i>Itálico</i></Op>
        <Op onClick={faz(() => envolver(view, '=='))}><mark>Destacar</mark></Op>
        <Op onClick={faz(() => envolver(view, '~~'))}><s>Riscar</s></Op>
      </>}
      {!m.sel && <>
        <hr />
        <Op onClick={faz(() => virarTitulo(view, 2))}>Virar título</Op>
        <Op onClick={faz(() => virarTitulo(view, 3))}>Virar subtítulo</Op>
        <Op onClick={faz(() => virarTitulo(view, 0))}>Texto normal</Op>
      </>}
      <hr />
      {m.sel && <Op onClick={faz(() => { navigator.clipboard.writeText(sel()); view.dispatch(view.state.replaceSelection('')) })} atalho="⌘X">Recortar</Op>}
      {m.sel && <Op onClick={faz(() => navigator.clipboard.writeText(sel()))} atalho="⌘C">Copiar</Op>}
      <Op onClick={faz(() => { navigator.clipboard.readText().then((t) => { view.dispatch(view.state.replaceSelection(t)); view.focus() }).catch(() => {}) })} atalho="⌘V">Colar</Op>
    </div>
  )
}

/* ---------- busca rápida (⌘P) ---------- */

type Entrada = { nome: string; raiz: Raiz; mtime: number }

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

export function Paleta({ onFechar, onAbrir, onCriar }: { onFechar: () => void; onAbrir: (r: Raiz, n: string) => void; onCriar: (t: string) => void }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState<Entrada[]>([])
  const [sel, setSel] = useState(0)
  const lista = useRef<HTMLDivElement>(null)

  useEffect(() => { fetch('/api/notas-indice').then((r) => r.json()).then((d) => setIdx(d.itens)).catch(() => {}) }, [])

  const res = useMemo(() => {
    const peso: Record<Raiz, number> = { ideias: 25, priorizar: 20, skills: 10, entradas: 5, publicados: 0 }
    if (!q.trim()) return [...idx].filter((e) => e.raiz !== 'publicados').sort((a, b) => b.mtime - a.mtime).slice(0, 30).map((e) => ({ e, marcas: [] as number[] }))
    return idx.map((e) => ({ e, m: casar(q.trim(), e.nome) })).filter((x) => x.m)
      .sort((a, b) => (b.m!.p + peso[b.e.raiz]) - (a.m!.p + peso[a.e.raiz])).slice(0, 40).map((x) => ({ e: x.e, marcas: x.m!.marcas }))
  }, [q, idx])

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
      if (sel < res.length) onAbrir(res[sel].e.raiz, res[sel].e.nome)
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
              onMouseMove={() => setSel(i)} onClick={() => onAbrir(e.raiz, e.nome)}>
              <span className="paleta-nome">{realce(e.nome, marcas)}</span>
              <span className="paleta-pasta">{ROTULO[e.raiz]}</span>
            </button>
          ))}
          {criar && (
            <button className={sel === res.length ? 'is-sel' : ''} onMouseMove={() => setSel(res.length)} onClick={() => onCriar(q.trim())}>
              <span className="paleta-nome"><Icone n="mais" t={14} /> Criar copy “{q.trim()}”</span>
              <span className="paleta-pasta">Priorizar</span>
            </button>
          )}
          {!total && <p className="mudo paleta-vazio">Carregando…</p>}
        </div>
        <footer className="paleta-pe"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>↵</kbd> abrir</span><span><kbd>esc</kbd> fechar</span></footer>
      </div>
    </div>
  )
}
