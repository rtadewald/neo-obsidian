import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Calendario } from './Calendario'
import { CalendarioEditorial } from './CalendarioEditorial'
import { Canvas, aquecerCanvases, type Passo } from './Canvas'
import { Canvases, preCarregarCanvases } from './Canvases'
import { INBOX, cabecalhoCanvas, carregarTudo, listarCanvases, onde, usarCanvas } from './canvasApi'
import { ModalNota } from './ModalNota'
import type { Alvo, Voltar } from './canvasApi'
import { Pedido } from './Pedido'
import { EVENTO_AVISO, anexoDaNota, assinarEventos, codigoSinal, pedirAoClaude, vigiarOnde } from './porta'
import { EmBreve } from './EmBreve'
import { Icone } from './Icone'
import { Radar } from './Radar'
import { Instagram } from './Instagram'
import { EVENTO_REDACAO, Redacao } from './Redacao'
import { Skills } from './Skills'
import { NovoRapido, type TipoNovo } from './NovoRapido'
import { PaletaCanvas } from './PaletaCanvas'
import { Paleta } from './Paleta'
import type { Raiz, Trecho } from './notas'

// navbar do topo, em três grupos: criar (canvas, planejamento) | radares | agendamento (Metricool).
// ⌘O busca notas e abre no modal; ⌘P navega entre os canvas.
const GRUPOS = [['Canvas', 'Redação', 'Calendário', 'Skills'], ['X', 'Sites', 'Instagram'], ['Agendamento']] as const
const NAV = GRUPOS.flat()
const ICONE: Record<(typeof NAV)[number], string> = {
  Canvas: 'grafo', Redação: 'editar', Calendário: 'calendario', Skills: 'skills', X: 'xlogo', Instagram: 'instagram', Sites: 'globo', Agendamento: 'publicar',
}
export default function App() {
  // canvas isolados: null = página de controle (lista dos canvas); clicar em NEO-OBSIDIAN volta para ela
  const [canvasSlug, setCanvasSlug] = useState<string | null>(() => { try { return localStorage.getItem('canvas-atual') || INBOX } catch { return INBOX } })
  useEffect(() => { try { if (canvasSlug) localStorage.setItem('canvas-atual', canvasSlug) } catch { /* sem storage */ } }, [canvasSlug])
  if (canvasSlug) usarCanvas(canvasSlug)   // antes de qualquer chamada do canvas nesta renderização
  useEffect(() => { preCarregarCanvases() }, [canvasSlug])
  // o canvas guardado pode ter saído da lista (apagado ou renomeado): volta para o Inbox
  useEffect(() => {
    listarCanvases().then((l) => { if (canvasSlug && l.length && !l.some((c) => c.slug === canvasSlug)) setCanvasSlug(INBOX) }).catch(() => {})
  }, [canvasSlug])
  const [pagina, setPagina] = useState<string>(() => { try { const p = localStorage.getItem('pagina'); return p && (NAV as readonly string[]).includes(p) ? p : 'Canvas' } catch { return 'Canvas' } })
  onde.pagina = pagina   // vai ao backend (GET /api/onde): o Claude Code sabe onde o Rodrigo está
  if (!canvasSlug) onde.canvas = null
  useEffect(() => { try { localStorage.setItem('pagina', pagina) } catch { /* sem storage */ } }, [pagina])
  // modal de nota (ideia + saídas em tabs): canvas, calendário e ⌘P abrem aqui
  const [modal, setModal] = useState<Alvo | null>(null)
  if (!modal) onde.nota = null   // com a nota aberta, o ModalNota informa a aba ativa (vai para GET /api/onde)
  const [voltar, setVoltar] = useState<Voltar | null>(null)
  const [mostrar, setMostrar] = useState<{ alvo: Alvo; n: number; quieto?: boolean; esperar?: boolean; ate?: number }>()   // Mostrar no canvas, pedido pelo modal   // de onde a nota foi aberta (a tabela das pastas)
  const [paleta, setPaleta] = useState(false)
  const [paletaCanvas, setPaletaCanvas] = useState(false)
  const [novo, setNovo] = useState<TipoNovo | null>(null)   // ⌘⇧I nova ideia · ⌘⇧N nova produção
  const [avisoApp, setAvisoApp] = useState<string | null>(null)
  // abrir uma nota pela ⌘P/⌘O: se ela vive num canvas ativo (não arquivado), muda para ele antes de abrir; senão fica onde está
  // ir até o card de uma nota: o canvas dela (o aberto, se ela também vive nele; senão o primeiro ativo), enquadrado e
  // selecionado. Devolve false quando a nota não vive em nenhum canvas ativo (aí fica onde está e avisa).
  const avisarApp = (msg: string) => { setAvisoApp(msg); window.setTimeout(() => setAvisoApp((a) => (a === msg ? null : a)), 3200) }
  const irParaCard = async (alvo: Alvo): Promise<boolean> => {
    try {
      const [tudo, lista] = await Promise.all([carregarTudo(), listarCanvases()])
      const nota = [...tudo.ideias, ...tudo.producoes, ...tudo.entradas].find((x) => x.nome === alvo.nome) as { canvases?: string[]; canvas?: string | null; grupo?: string | null } | undefined
      const ativos = lista.filter((k) => !k.arquivado && k.slug !== INBOX)
      const nomes = nota?.canvases ?? (nota?.canvas ? [nota.canvas] : [])
      const c = ativos.find((k) => k.slug === canvasSlug && nomes.includes(k.nome)) ?? ativos.find((k) => nomes.includes(k.nome))
      if (!c) {
        avisarApp(nota?.grupo ? `Fora dos canvas: o canvas "${nota.grupo}" não existe mais. Use Canvas › no card para pôr num canvas.` : 'Esta nota não está em nenhum canvas. Use Canvas › no card para pôr num.')
        return false
      }
      if (c.slug !== canvasSlug) { usarCanvas(c.slug); setCanvasSlug(c.slug) }
      setPagina('Canvas')
      setMostrar((m) => ({ alvo, n: (m?.n ?? 0) + 1, quieto: true }))
      return true
    } catch { return false }
  }
  // ⌘P/⌘O: abre a nota e, por trás, leva até o card dela
  const abrirNoCanvasDela = async (raiz: Raiz, nome: string) => {
    setModal({ raiz, nome })
    irParaCard({ raiz, nome })
  }
  // na Redação a busca abre a copy numa aba de lá (Enter: a da frente; ⌘↵: uma nova)
  const abrirNaRedacao = (alvo: Alvo, nova: boolean) => window.dispatchEvent(new CustomEvent(EVENTO_REDACAO, { detail: { alvo, nova } }))
  const [caminhoCanvas, setCaminhoCanvas] = useState<Passo[]>([])   // o que o canvas aberto conta ao breadcrumb
  const [mudou, setMudou] = useState(0)   // algo mudou no vault pelo modal: o canvas recarrega
  const [ouvindo, setOuvindo] = useState(false)   // o Claude Code está ouvindo a fila (bolinha verde)
  const [versao, setVersao] = useState(0)
  // todos os canvas ficam carregados: na abertura e, depois, logo após cada mudança no vault
  useEffect(() => { const t = window.setTimeout(aquecerCanvases, 400); return () => window.clearTimeout(t) }, [mudou, versao])
  // ⌘I no editor, "Mandar ao Claude" nos cards e pedidos prontos: abrem a caixa de pedido ao Claude Code
  const mandarTrecho = useCallback((t: Trecho, p?: string) => {
    anexoDaNota({ raiz: t.raiz, nome: t.nome } as Alvo, t).then((a) => pedirAoClaude({ anexos: [a], texto: p }))
  }, [])
  const mandarPedido = useCallback((p: string) => pedirAoClaude({ anexos: [], texto: p }), [])
  const sinalAoClaude = useCallback((s: { id: number; titulo?: string | null; texto?: string | null }) =>
    pedirAoClaude({ anexos: [{ codigo: codigoSinal(s.id), rotulo: (s.titulo || s.texto || 'sinal do radar').slice(0, 80) }] }), [])
  const abrirModal = useCallback((a: Alvo, v?: Voltar) => { setModal(a); setVoltar(v ?? null) }, [])
  // eventos do backend: nota mudou no vault (o Claude editou daqui), o Claude mexendo na tela e se ele está ouvindo
  const tela = useRef<(ev: { acao: string; pagina?: string; canvas?: string | null; raiz?: string; nome?: string }) => void>(() => {})
  tela.current = (ev) => {
    if (ev.acao === 'pagina' && ev.pagina && (NAV as readonly string[]).includes(ev.pagina)) setPagina(ev.pagina)
    else if (ev.acao === 'abrir_canvas') { setModal(null); setCanvasSlug(ev.canvas ?? null); setPagina('Canvas') }
    else if (ev.acao === 'mostrar' && ev.raiz && ev.nome) {
      const alvo = { raiz: ev.raiz, nome: ev.nome } as Alvo
      setModal(null); setVoltar(null)
      if (ev.canvas) { usarCanvas(ev.canvas); setCanvasSlug(ev.canvas); setPagina('Canvas'); setMostrar((m) => ({ alvo, n: (m?.n ?? 0) + 1 })) }
      else irParaCard(alvo)
    }
    else if (ev.acao === 'abrir_nota' && ev.raiz && ev.nome) setModal({ raiz: ev.raiz, nome: ev.nome } as Alvo)
    else if (ev.acao === 'fechar_nota') { setModal(null); setVoltar(null) }
    else if (ev.acao === 'foco') window.dispatchEvent(new Event('modo-foco'))
  }
  useEffect(() => assinarEventos((ev) => {
    if (ev.t === 'mudou') setVersao((v) => v + 1)
    else if (ev.t === 'porta') setOuvindo(ev.ouvindo)
    else if (ev.t === 'tela') tela.current(ev)
  }), [])
  useEffect(() => vigiarOnde(), [])
  useEffect(() => {
    const f = (e: Event) => avisarApp((e as CustomEvent<string>).detail)
    window.addEventListener(EVENTO_AVISO, f); return () => window.removeEventListener(EVENTO_AVISO, f)
  }, [])

  // modo foco (só no canvas): navbar, breadcrumb, minimapa, pastas e barra de baixo saem para as bordas.
  // F liga (fora de campos e do Excalidraw), Esc desliga; o botão da barra do canvas manda o evento 'modo-foco'.
  // modo de trabalho (W): só as duas barras saem (navegação de cima e barra de baixo); pastas e pinados ficam
  const [focoTela, setFocoTela] = useState(false)
  const [trabalho, setTrabalho] = useState(false)
  useEffect(() => { if (pagina !== 'Canvas' || !canvasSlug) { setFocoTela(false); setTrabalho(false) } }, [pagina, canvasSlug])
  useEffect(() => {
    const alternar = () => { setTrabalho(false); setFocoTela((f) => !f) }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc fecha primeiro o que estiver por cima (nota, busca, menu) e não mexe no modo desenho: F/W só saem com nada aberto
        if (e.defaultPrevented || document.querySelector('.modal-fundo, .paleta-fundo, .menu-ctx, .canvas.is-desenhando')) return
        setFocoTela(false); setTrabalho(false); return
      }
      const k = e.key.toLowerCase()
      if ((k !== 'f' && k !== 'w') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('textarea, input, select, [contenteditable="true"], .cm-editor, .excalidraw') || document.querySelector('.modal-fundo, .paleta-fundo, .canvas.is-desenhando')) return
      if (!document.querySelector('.canvas')) return
      e.preventDefault()
      if (k === 'f') alternar()
      else { setFocoTela(false); setTrabalho((w) => !w) }
    }
    window.addEventListener('keydown', tecla); window.addEventListener('modo-foco', alternar)
    return () => { window.removeEventListener('keydown', tecla); window.removeEventListener('modo-foco', alternar) }
  }, [])


  // ⌘O: busca rápida de notas, que abre a nota no modal; ⌘P: ir para um canvas
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {   // ⌘O: busca de notas
        e.preventDefault()
        setPaletaCanvas(false); setPaleta(true)
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {   // ⌘P: ir para um canvas (arquivados mais abaixo)
        e.preventDefault()
        setPaleta(false); setPaletaCanvas(true)
      }
      // nova ideia / nova criação (no canvas aberto; fora dele, com seletor de canvas). ⌥N pela tecla física (e.code):
      // no Mac o ⌥N vira o til. ⌘⇧I/⌘⇧N também valem onde o navegador deixa (o Chrome reserva o ⌘⇧N para a janela anônima).
      // ⌘I nova copy (com uma nota aberta o ⌘I manda o trecho ao Claude Code), ⌥N nova criação
      const cmdI = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === 'i' || e.code === 'KeyI')
      const opcao = e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyN'
      const comando = (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && ['i', 'n'].includes(e.key.toLowerCase())
      if (cmdI || opcao || comando) {
        const t = e.target as HTMLElement | null
        if (document.querySelector('.modal-fundo .modal-nota, .paleta-fundo')) return
        if ((opcao || cmdI) && t?.closest?.('textarea, input, select, [contenteditable="true"], .cm-editor')) return   // dentro de um campo, a tecla é do campo
        e.preventDefault(); e.stopPropagation()
        setNovo(cmdI || (comando && e.key.toLowerCase() === 'i') ? 'ideia' : 'producao')
        return
      }
      // ⌃1…⌃8 (ou ⌥1…, ou ⌘1… onde o navegador deixa: no Chrome o ⌘1–8 troca de aba do navegador antes da página)
      // trocam de aba, na ordem da navbar. Com uma nota aberta no modal, os números navegam entre as versões dela (ModalNota)
      const n = /^Digit[1-9]$/.test(e.code) ? Number(e.code.slice(5)) : 0
      if ((e.metaKey || e.ctrlKey || e.altKey) && !e.shiftKey && n >= 1 && n <= NAV.length && !document.querySelector('.modal-fundo .modal-nota')) {
        e.preventDefault()
        setPagina(NAV[n - 1])
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])

  return (
    <div className={`app ${focoTela ? 'modo-foco' : ''} ${trabalho ? 'modo-trabalho' : ''} ${modal ? 'com-nota' : ''}`}>
      <div className="lateral-area">
      {/* breadcrumb: NEO-OBSIDIAN (todos os canvas) › canvas › vista; nas outras páginas, só o nome dela */}
      <nav className="migalhas" aria-label="Onde você está">
        <button type="button" className="neo-marca" title="Todos os canvas" onClick={() => { setCanvasSlug(null); setPagina('Canvas') }}><i />NEO-OBSIDIAN</button>
        {(pagina !== 'Canvas' ? [{ rotulo: pagina } as Passo] : canvasSlug ? caminhoCanvas : [{ rotulo: 'Todos os canvas' } as Passo]).map((p, i, l) => (
          <Fragment key={i}>
            <span className="migalhas-sep" aria-hidden="true">›</span>
            {p.ir ? <button type="button" className="migalhas-item" onClick={p.ir}>{p.rotulo}</button>
              : <span className="migalhas-item is-atual" aria-current={i === l.length - 1 ? 'page' : undefined}>{p.rotulo}</span>}
          </Fragment>
        ))}
      </nav>
      <nav className="lateral glass glass--light" aria-label="Páginas">
        {GRUPOS.map((g, k) => (
          <Fragment key={k}>
            {k > 0 && <span className="lateral-sep" aria-hidden="true" />}
            {g.map((p) => (
              <button key={p} className={`lateral-btn ${p === pagina ? 'is-ativa' : ''}`} onClick={() => setPagina(p)} aria-current={p === pagina}
                data-dica={`⌃${NAV.indexOf(p) + 1}`}>
                <Icone n={ICONE[p]} t={14} /><span>{p}</span>
              </button>
            ))}
          </Fragment>
        ))}
      </nav>
      <span />
      </div>

      <main className="corpo sem-chat">
        <section className="pagina">
          {pagina === 'Canvas' ? (canvasSlug
              ? <Canvas key={canvasSlug} canvas={canvasSlug} onCaminho={setCaminhoCanvas} onTrocarCanvas={setCanvasSlug} mostrar={mostrar} onAbrir={abrirModal} onTrecho={mandarTrecho} onPedido={mandarPedido} versao={versao + mudou} />
              : <Canvases onAbrir={setCanvasSlug} />)
            : pagina === 'Redação' ? <Redacao versao={versao + mudou} onTrecho={mandarTrecho} />
            : pagina === 'Calendário' ? <CalendarioEditorial onAbrir={(raiz, nome) => abrirModal({ raiz, nome })} />
            : pagina === 'Skills' ? <Skills versao={versao} onTrecho={mandarTrecho} onAbrirNota={(alvo) => abrirModal(alvo)} />
            : pagina === 'X' ? <Radar key="x" titulo="X" fontes={['x']} onConversar={sinalAoClaude} />
            : pagina === 'Instagram' ? <Instagram />
            : pagina === 'Sites' ? <Radar key="sites" titulo="Sites" fontes={['github', 'huggingface', 'hackernews']} onConversar={sinalAoClaude} />
            : pagina === 'Agendamento' ? <Calendario />
            : <EmBreve pagina={pagina} />}
          {modal && <ModalNota alvo={modal} onFechar={() => { setModal(null); setVoltar(null) }}
        voltar={voltar ? { rotulo: voltar.rotulo, fn: () => { setModal(null); setVoltar(null); voltar.fn() } } : undefined} onTrecho={mandarTrecho} onPedido={mandarPedido}
        onMudou={() => setMudou((n) => n + 1)} versao={versao}
        onMostrar={(a) => { irParaCard(a).then((ok) => { if (ok) { setModal(null); setVoltar(null) } }) }} />}
        </section>
        <Pedido ouvindo={ouvindo} />
      </main>

      {novo && <NovoRapido tipo={novo} canvasAtual={canvasSlug} comSeletor={pagina !== 'Canvas' || !canvasSlug} onFechar={() => setNovo(null)}
        onCriado={(c, msg, nota) => {   // vai para o canvas escolhido, abre a nota nova e, por trás, enquadra o card dela
          setNovo(null)
          const alvo = { raiz: nota.raiz, nome: nota.nome } as Alvo
          if (canvasSlug !== c) { usarCanvas(c); setCanvasSlug(c) }
          setPagina('Canvas'); setMudou((n) => n + 1)
          setModal(alvo); setVoltar(null)
          setMostrar((m) => ({ alvo, n: (m?.n ?? 0) + 1, quieto: true, esperar: true, ate: Date.now() + 8000 }))
          setAvisoApp(msg); window.setTimeout(() => setAvisoApp((a) => (a === msg ? null : a)), 2600)
        }} />}
      {avisoApp && <div className="ideias-aviso" role="status">{avisoApp}</div>}
      {paletaCanvas && <PaletaCanvas atual={canvasSlug} onFechar={() => setPaletaCanvas(false)}
        onIr={(slug) => { setModal(null); usarCanvas(slug); setCanvasSlug(slug); setPagina('Canvas') }} />}
      {paleta && <Paleta onFechar={() => setPaleta(false)}
        onAbrir={(raiz, nome) => { setPaleta(false); if (pagina === 'Redação') abrirNaRedacao({ raiz, nome } as Alvo, false); else abrirNoCanvasDela(raiz, nome) }}
        onImportar={pagina === 'Redação' ? (raiz, nome) => { setPaleta(false); abrirNaRedacao({ raiz, nome } as Alvo, true) } : canvasSlug ? (raiz, nome) => {   // ⌘↵: traz a nota para o canvas aberto, enquadra e seleciona o card
          setPaleta(false)
          fetch('/api/canvas/importar', { method: 'POST', headers: { 'Content-Type': 'application/json', ...cabecalhoCanvas() }, body: JSON.stringify({ nome }) })
            .then((r) => r.json()).then((d) => {
              if (!d.card) return
              setPagina('Canvas'); setMudou((n) => n + 1)
              setMostrar((m) => ({ alvo: { raiz: d.raiz ?? raiz, nome: d.nome ?? nome }, n: (m?.n ?? 0) + 1 }))
            }).catch(() => {})
        } : undefined}
        onCriar={(t) => { setPaleta(false); fetch('/api/canvas/ideia', { method: 'POST', headers: { 'Content-Type': 'application/json', ...cabecalhoCanvas() }, body: JSON.stringify({ titulo: t }) })
          .then((r) => r.json()).then((d) => { if (d.nome) { setModal({ raiz: 'ideias', nome: d.nome }); setMudou((n) => n + 1) } }).catch(() => {}) }} />}

    </div>
  )
}
