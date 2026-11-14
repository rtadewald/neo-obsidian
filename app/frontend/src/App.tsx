import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Calendario } from './Calendario'
import { CalendarioEditorial } from './CalendarioEditorial'
import { Canvas, type Passo } from './Canvas'
import { Canvases, preCarregarCanvases } from './Canvases'
import { cabecalhoCanvas, listarCanvases, onde, usarCanvas } from './canvasApi'
import { ModalNota } from './ModalNota'
import type { Alvo, Voltar } from './canvasApi'
import { Chat } from './Chat'
import { EmBreve } from './EmBreve'
import { Icone } from './Icone'
import { Radar } from './Radar'
import { Paleta } from './Paleta'
import type { Trecho } from './notas'
import type { Sinal } from './api'

// navbar do topo, em três grupos: criar (canvas, planejamento) | radares | agendamento (Metricool).
// ⌘P busca notas e abre no modal.
const GRUPOS = [['Canvas', 'Calendário'], ['X', 'Sites', 'Instagram'], ['Agendamento']] as const
const NAV = GRUPOS.flat()
const ICONE: Record<(typeof NAV)[number], string> = {
  Canvas: 'grafo', Calendário: 'calendario', X: 'xlogo', Instagram: 'instagram', Sites: 'globo', Agendamento: 'publicar',
}
/** Aba do radar de onde veio um sinal, pela fonte ou pelo link. */
const abaDoSinal = (a: { fonte?: string; url?: string | null }) =>
  a.fonte === 'x' || /^https?:\/\/(www\.)?(x|twitter)\.com\//.test(a.url ?? '') ? 'X' : 'Sites'

export default function App() {
  // canvas isolados: null = página de controle (lista dos canvas); clicar em NEO-OBSIDIAN volta para ela
  const [canvasSlug, setCanvasSlug] = useState<string | null>(() => { try { return localStorage.getItem('canvas-atual') || 'fia' } catch { return 'geral' } })
  useEffect(() => { try { if (canvasSlug) localStorage.setItem('canvas-atual', canvasSlug) } catch { /* sem storage */ } }, [canvasSlug])
  if (canvasSlug) usarCanvas(canvasSlug)   // antes de qualquer chamada do canvas nesta renderização
  useEffect(() => { preCarregarCanvases() }, [canvasSlug])
  // o canvas guardado pode ter saído da lista (o Geral ficou oculto): abre o primeiro que existe
  useEffect(() => {
    listarCanvases().then((l) => { if (canvasSlug && l.length && !l.some((c) => c.slug === canvasSlug)) setCanvasSlug(l[0].slug) }).catch(() => {})
  }, [canvasSlug])
  const [pagina, setPagina] = useState<string>(() => { try { const p = localStorage.getItem('pagina'); return p && (NAV as readonly string[]).includes(p) ? p : 'Canvas' } catch { return 'Canvas' } })
  onde.pagina = pagina   // o chat manda isso ao Jarvis (ver canvasApi.onde)
  if (!canvasSlug) onde.canvas = null
  useEffect(() => { try { localStorage.setItem('pagina', pagina) } catch { /* sem storage */ } }, [pagina])
  // modal de nota (ideia + saídas em tabs): canvas, calendário e ⌘P abrem aqui
  const [modal, setModal] = useState<Alvo | null>(null)
  onde.nota = modal   // o chat manda isso ao Jarvis (ver canvasApi.onde)
  const [voltar, setVoltar] = useState<Voltar | null>(null)
  const [mostrar, setMostrar] = useState<{ alvo: Alvo; n: number }>()   // Mostrar no canvas, pedido pelo modal   // de onde a nota foi aberta (a tabela das pastas)
  const [paleta, setPaleta] = useState(false)
  const [caminhoCanvas, setCaminhoCanvas] = useState<Passo[]>([])   // o que o canvas aberto conta ao breadcrumb
  const [mudou, setMudou] = useState(0)   // algo mudou no vault pelo modal: o canvas recarrega
  // sinal em conversa no chat: sobrevive a recarregar a página
  const [foco, setFoco] = useState<Sinal | null>(() => { try { return JSON.parse(localStorage.getItem('foco-sinal') || 'null') } catch { return null } })
  useEffect(() => { try { if (foco) localStorage.setItem('foco-sinal', JSON.stringify(foco)); else localStorage.removeItem('foco-sinal') } catch { /* sem storage */ } }, [foco])
  // clicar no sinal do chat (o anexado ou um do histórico) volta para o card dele no Radar, no modo foco
  const [irSinal, setIrSinal] = useState<{ id?: number; url?: string | null; n: number }>()
  const abrirSinal = useCallback((a: { id?: number; url?: string | null; fonte?: string }) => { setPagina(abaDoSinal(a)); setIrSinal((x) => ({ ...a, n: (x?.n ?? 0) + 1 })) }, [])
  // trecho de nota mandado do editor para o chat (⌘I), pedido pronto das ações rápidas e aviso de que a nota pode ter mudado
  const [trecho, setTrecho] = useState<Trecho | null>(null)
  const [pedido, setPedido] = useState<{ texto: string; n: number }>({ texto: '', n: 0 })
  const [versao, setVersao] = useState(0)
  const mandarTrecho = useCallback((t: Trecho, p?: string) => {
    setTrecho(t); setChat(true)
    if (p) setPedido((x) => ({ texto: p, n: x.n + 1 }))
  }, [])
  const mandarPedido = useCallback((p: string) => { setChat(true); setPedido((x) => ({ texto: p, n: x.n + 1 })) }, [])
  const abrirModal = useCallback((a: Alvo, v?: Voltar) => { setModal(a); setVoltar(v ?? null) }, [])
  const [chat, setChat] = useState(() => { try { return localStorage.getItem('chat') !== 'fechado' } catch { return true } })
  useEffect(() => { try { localStorage.setItem('chat', chat ? 'aberto' : 'fechado') } catch { /* sem storage */ } }, [chat])
  useEffect(() => { if (foco) setChat(true) }, [foco])
  // largura do chat: arrastando a borda esquerda dele (duplo clique volta ao padrão)
  const [chatW, setChatW] = useState<number | null>(() => { try { return Number(localStorage.getItem('chat-w')) || null } catch { return null } })
  useEffect(() => { try { if (chatW) localStorage.setItem('chat-w', String(chatW)); else localStorage.removeItem('chat-w') } catch { /* sem storage */ } }, [chatW])
  const arrastar = (e: React.PointerEvent) => {
    const el = corpo.current
    if (!el) return
    e.preventDefault()
    const direita = el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight)
    const max = Math.min(900, el.clientWidth * 0.6)
    const mover = (ev: PointerEvent) => setChatW(Math.round(Math.max(300, Math.min(max, direita - ev.clientX))))
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); document.body.classList.remove('arrastando') }
    document.body.classList.add('arrastando')
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
  }   // trouxe um card para a conversa: o chat abre

  // o chat ocupa a altura toda, do topo ao pé da tela
  const corpo = useRef<HTMLElement>(null)

  // ⌘P: busca rápida de notas, que abre a nota no modal
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && ['p', 'o'].includes(e.key.toLowerCase())) {   // ⌘P ou ⌘O: busca de notas
        e.preventDefault()
        setPaleta(true)
      }
      // ⌘B mostra/oculta o chat do agente (no editor de nota fica livre para o negrito)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b' && !(e.target as HTMLElement)?.closest?.('.cm-editor')) {
        e.preventDefault()
        setChat((c) => !c)
      }
      // ⌘1…⌘7 trocam de aba, na ordem da navbar
      const n = Number(e.key)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && n >= 1 && n <= NAV.length) {
        e.preventDefault()
        setPagina(NAV[n - 1])
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])

  return (
    <div className="app">
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
                data-dica={`⌘${NAV.indexOf(p) + 1}`}>
                <Icone n={ICONE[p]} t={14} /><span>{p}</span>
              </button>
            ))}
          </Fragment>
        ))}
      </nav>
      <span />
      </div>

      <main ref={corpo} className={`corpo ${chat ? '' : 'sem-chat'}`}
        style={chat && chatW ? { gridTemplateColumns: `minmax(0, 1fr) ${chatW}px` } : undefined}>
        <section className="pagina">
          {pagina === 'Canvas' ? (canvasSlug
              ? <Canvas key={canvasSlug} canvas={canvasSlug} onCaminho={setCaminhoCanvas} onTrocarCanvas={setCanvasSlug} mostrar={mostrar} onAbrir={abrirModal} onTrecho={mandarTrecho} onPedido={mandarPedido} versao={versao + mudou} />
              : <Canvases onAbrir={setCanvasSlug} />)
            : pagina === 'Calendário' ? <CalendarioEditorial onAbrir={(raiz, nome) => abrirModal({ raiz, nome })} />
            : pagina === 'X' ? <Radar key="x" titulo="X" fontes={['x']} foco={foco} onConversar={setFoco} ir={irSinal} />
            : pagina === 'Sites' ? <Radar key="sites" titulo="Sites" fontes={['github', 'huggingface', 'hackernews']} foco={foco} onConversar={setFoco} ir={irSinal} />
            : pagina === 'Agendamento' ? <Calendario />
            : <EmBreve pagina={pagina} />}
          {modal && <ModalNota alvo={modal} onFechar={() => { setModal(null); setVoltar(null) }}
        voltar={voltar ? { rotulo: voltar.rotulo, fn: () => { setModal(null); setVoltar(null); voltar.fn() } } : undefined} onTrecho={mandarTrecho} onPedido={mandarPedido}
        onMudou={() => setMudou((n) => n + 1)} versao={versao}
        onMostrar={(a) => { setModal(null); setVoltar(null); setCanvasSlug((c) => c ?? 'geral'); setPagina('Canvas'); setMostrar((m) => ({ alvo: a, n: (m?.n ?? 0) + 1 })) }} />}
        </section>
        <Chat foco={foco} limparFoco={() => setFoco(null)} aberto={chat} onAlternar={() => setChat((v) => !v)}
          alca={<div className="chat-alca" onPointerDown={arrastar} onDoubleClick={() => setChatW(null)} title="Arraste para mudar a largura (duplo clique volta ao padrão)" />}
          onAbrirSinal={abrirSinal}
          trecho={trecho} limparTrecho={() => setTrecho(null)} pedido={pedido} onFim={() => setVersao((v) => v + 1)} />
      </main>

      {paleta && <Paleta onFechar={() => setPaleta(false)}
        onAbrir={(raiz, nome) => { setPaleta(false); setModal({ raiz, nome }) }}
        onImportar={canvasSlug ? (raiz, nome) => {   // ⌘↵: traz a nota para o canvas aberto, enquadra e seleciona o card
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
