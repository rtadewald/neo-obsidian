import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Calendario } from './Calendario'
import { CalendarioEditorial } from './CalendarioEditorial'
import { Canvas } from './Canvas'
import { ModalNota } from './ModalNota'
import type { Alvo } from './canvasApi'
import { Chat } from './Chat'
import { Icone } from './Icone'
import { EmBreve } from './EmBreve'
import { Leque, Orbe, type SkillResumo } from './Menu'
import { Radar } from './Radar'
import { Ideias, Paleta, type Raiz, type Trecho } from './Ideias'
import type { Sinal } from './api'

// navbar do topo, em três grupos: criar (canvas, planejamento, lista de ideias) | radares | agendamento (Metricool).
// Orbe no canto de baixo: as skills e as configurações. ⌘P busca notas e abre no modal.
const GRUPOS = [['Canvas', 'Calendário', 'Ideias'], ['X', 'Instagram', 'Sites'], ['Agendamento']] as const
const NAV = GRUPOS.flat()
const ICONE: Record<(typeof NAV)[number], string> = {
  Canvas: 'grafo', Calendário: 'calendario', Ideias: 'nota', X: 'xlogo', Instagram: 'instagram', Sites: 'globo', Agendamento: 'publicar',
}
/** Aba do radar de onde veio um sinal, pela fonte ou pelo link. */
const abaDoSinal = (a: { fonte?: string; url?: string | null }) =>
  a.fonte === 'x' || /^https?:\/\/(www\.)?(x|twitter)\.com\//.test(a.url ?? '') ? 'X' : 'Sites'

export default function App() {
  const [pagina, setPagina] = useState<string>(() => { try { const p = localStorage.getItem('pagina'); return p && (NAV as readonly string[]).includes(p) ? p : 'Canvas' } catch { return 'Canvas' } })
  useEffect(() => { try { localStorage.setItem('pagina', pagina) } catch { /* sem storage */ } }, [pagina])
  // modal de nota (ideia + saídas em tabs): canvas, calendário e ⌘P abrem aqui
  const [modal, setModal] = useState<Alvo | null>(null)
  const [paleta, setPaleta] = useState(false)
  const [mudou, setMudou] = useState(0)   // algo mudou no vault pelo modal: o canvas recarrega
  // sinal em conversa no chat: sobrevive a recarregar a página
  const [foco, setFoco] = useState<Sinal | null>(() => { try { return JSON.parse(localStorage.getItem('foco-sinal') || 'null') } catch { return null } })
  useEffect(() => { try { if (foco) localStorage.setItem('foco-sinal', JSON.stringify(foco)); else localStorage.removeItem('foco-sinal') } catch { /* sem storage */ } }, [foco])
  // clicar no sinal do chat (o anexado ou um do histórico) volta para o card dele no Radar, no modo foco
  const [irSinal, setIrSinal] = useState<{ id?: number; url?: string | null; n: number }>()
  const abrirSinal = useCallback((a: { id?: number; url?: string | null; fonte?: string }) => { setPagina(abaDoSinal(a)); setIrSinal((x) => ({ ...a, n: (x?.n ?? 0) + 1 })) }, [])
  const [leque, setLeque] = useState(false)
  const [skills, setSkills] = useState<SkillResumo[]>([])
  const [abrir, setAbrir] = useState<{ raiz: Raiz; nome: string | null; n: number } | undefined>()
  const fechar = useCallback(() => setLeque(false), [])
  // trecho de nota mandado do editor para o chat (⌘I), pedido pronto das ações rápidas e aviso de que a nota pode ter mudado
  const [trecho, setTrecho] = useState<Trecho | null>(null)
  const [pedido, setPedido] = useState<{ texto: string; n: number }>({ texto: '', n: 0 })
  const [versao, setVersao] = useState(0)
  const mandarTrecho = useCallback((t: Trecho, p?: string) => {
    setTrecho(t); setChat(true)
    if (p) setPedido((x) => ({ texto: p, n: x.n + 1 }))
  }, [])
  const mandarPedido = useCallback((p: string) => { setChat(true); setPedido((x) => ({ texto: p, n: x.n + 1 })) }, [])
  const abrirModal = useCallback((a: Alvo) => setModal(a), [])
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

  useEffect(() => { fetch('/api/skills').then((r) => r.json()).then(setSkills).catch(() => {}) }, [])
  // ⌘P: busca rápida de notas. Na aba Ideias abre lá; no resto abre a nota no modal
  const [busca, setBusca] = useState(0)
  const paginaRef = useRef(pagina)
  paginaRef.current = pagina
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        if (paginaRef.current === 'Ideias') setBusca((n) => n + 1)
        else setPaleta(true)
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
  // as skills abrem na mesa de Ideias, na aba Skills (leitura e edição)
  const abrirSkill = (nome: string | null) => { setAbrir((a) => ({ raiz: 'skills', nome, n: (a?.n ?? 0) + 1 })); setPagina('Ideias') }

  return (
    <div className={`app ${leque ? 'com-leque' : ''}`}>
      <div className="lateral-area">
      <span className="neo-marca"><i />NEO-OBSIDIAN</span>
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
          {pagina === 'Canvas' ? <Canvas onAbrir={abrirModal} onTrecho={mandarTrecho} onPedido={mandarPedido} versao={versao + mudou} />
            : pagina === 'Calendário' ? <CalendarioEditorial onAbrir={(raiz, nome) => setModal({ raiz, nome })} />
            : pagina === 'X' ? <Radar key="x" titulo="X" fontes={['x']} foco={foco} onConversar={setFoco} ir={irSinal} />
            : pagina === 'Sites' ? <Radar key="sites" titulo="Sites" fontes={['github', 'huggingface', 'hackernews']} foco={foco} onConversar={setFoco} ir={irSinal} />
            : pagina === 'Ideias' ? <Ideias abrir={abrir} busca={busca} onTrecho={mandarTrecho} versao={versao} />
            : pagina === 'Agendamento' ? <Calendario />
            : <EmBreve pagina={pagina} />}
          {modal && <ModalNota alvo={modal} onFechar={() => setModal(null)} onTrecho={mandarTrecho} onPedido={mandarPedido}
        onMudou={() => setMudou((n) => n + 1)} versao={versao} />}
        </section>
        <Chat foco={foco} limparFoco={() => setFoco(null)} aberto={chat} onAlternar={() => setChat((v) => !v)}
          alca={<div className="chat-alca" onPointerDown={arrastar} onDoubleClick={() => setChatW(null)} title="Arraste para mudar a largura (duplo clique volta ao padrão)" />}
          onAbrirSinal={abrirSinal}
          trecho={trecho} limparTrecho={() => setTrecho(null)} pedido={pedido} onFim={() => setVersao((v) => v + 1)} />
      </main>

      {paleta && <Paleta onFechar={() => setPaleta(false)}
        onAbrir={(raiz, nome) => { setPaleta(false); if (raiz === 'skills') abrirSkill(nome); else setModal({ raiz, nome }) }}
        onCriar={(t) => { setPaleta(false); fetch('/api/canvas/ideia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: t }) })
          .then((r) => r.json()).then((d) => { if (d.nome) { setModal({ raiz: 'ideias', nome: d.nome }); setMudou((n) => n + 1) } }).catch(() => {}) }} />}


      <Leque aberto={leque} skills={skills} onSkill={abrirSkill} onTodas={() => abrirSkill(null)}
        onConfig={() => setPagina('Config')} onFechar={fechar} />
      <Orbe aberto={leque} onClick={() => setLeque((v) => !v)} />
    </div>
  )
}
