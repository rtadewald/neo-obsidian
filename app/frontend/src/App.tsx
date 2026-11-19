import { Fragment, useEffect, useRef, useState } from 'react'
import { Calendario } from './Calendario'
import { onde } from './canvasApi'
import { ModalNota } from './ModalNota'
import type { Alvo, Voltar } from './canvasApi'
import { EVENTO_AVISO, assinarEventos, vigiarOnde } from './porta'
import { EmBreve } from './EmBreve'
import { Icone } from './Icone'
import { Radar } from './Radar'
import { Instagram } from './Instagram'
import { EVENTO_REDACAO, Redacao } from './Redacao'
import { NovoRapido, type TipoNovo } from './NovoRapido'
import { Paleta } from './Paleta'
import { Skills } from './Skills'

// navbar do topo, em três grupos: Redação e Skills | radares | agendamento (Metricool).
// ⌘O busca notas e abre numa aba da Redação.
const GRUPOS = [['Redação', 'Skills'], ['Instagram', 'X', 'Sites'], ['Agendamento']] as const
const NAV = GRUPOS.flat()
const ICONE: Record<(typeof NAV)[number], string> = {
  Redação: 'editar', Skills: 'skills', X: 'xlogo', Instagram: 'instagram', Sites: 'globo', Agendamento: 'publicar',
}
export default function App() {
  const [pagina, setPagina] = useState<string>(() => { try { const p = localStorage.getItem('pagina'); return p && (NAV as readonly string[]).includes(p) ? p : 'Redação' } catch { return 'Redação' } })
  onde.pagina = pagina   // vai ao backend (GET /api/onde): o Claude Code sabe onde o Rodrigo está
  useEffect(() => { try { localStorage.setItem('pagina', pagina) } catch { /* sem storage */ } }, [pagina])
  // modal de nota (ideia + saídas em tabs): o calendário e as Skills abrem aqui
  const [modal, setModal] = useState<Alvo | null>(null)
  if (!modal) onde.nota = null   // com a nota aberta, o ModalNota informa a aba ativa (vai para GET /api/onde)
  const [voltar, setVoltar] = useState<Voltar | null>(null)
  const [paleta, setPaleta] = useState(false)
  const [novo, setNovo] = useState<TipoNovo | null>(null)   // ⌘⇧I nova ideia · ⌘⇧N nova produção
  const [avisoApp, setAvisoApp] = useState<string | null>(null)
  const avisarApp = (msg: string) => { setAvisoApp(msg); window.setTimeout(() => setAvisoApp((a) => (a === msg ? null : a)), 3200) }
  // a busca (⌘O) e o Claude abrem a copy numa aba da Redação (Enter: a da frente; ⌘↵: uma nova)
  const abrirNaRedacao = (alvo: Alvo, nova: boolean) => {
    setPagina('Redação'); setModal(null)
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(EVENTO_REDACAO, { detail: { alvo, nova } })), 30)
  }
  const [mudou, setMudou] = useState(0)   // algo mudou no vault pelo modal: a Redação recarrega
  const [versao, setVersao] = useState(0)
  // ⌘I no editor, "Mandar ao Claude" nos cards e pedidos prontos: abrem a caixa de pedido ao Claude Code
  // eventos do backend: nota mudou no vault (o Claude editou daqui), o Claude mexendo na tela e se ele está ouvindo
  const tela = useRef<(ev: { acao: string; pagina?: string; raiz?: string; nome?: string; nova?: boolean }) => void>(() => {})
  tela.current = (ev) => {
    if (ev.acao === 'pagina' && ev.pagina && (NAV as readonly string[]).includes(ev.pagina)) setPagina(ev.pagina)
    else if ((ev.acao === 'abrir_nota' || ev.acao === 'mostrar') && ev.raiz && ev.nome) abrirNaRedacao({ raiz: ev.raiz, nome: ev.nome } as Alvo, !!ev.nova)
    else if (ev.acao === 'fechar_nota') { setModal(null); setVoltar(null) }
  }
  useEffect(() => assinarEventos((ev) => {
    if (ev.t === 'mudou') setVersao((v) => v + 1)
    else if (ev.t === 'tela') tela.current(ev)
  }), [])
  useEffect(() => vigiarOnde(), [])
  // o botão "+ Nova copy" da Redação abre a mesma janela do ⌘I
  useEffect(() => { const f = () => setNovo('producao'); window.addEventListener('nova-copy', f); return () => window.removeEventListener('nova-copy', f) }, [])
  useEffect(() => {
    const f = (e: Event) => avisarApp((e as CustomEvent<string>).detail)
    window.addEventListener(EVENTO_AVISO, f); return () => window.removeEventListener(EVENTO_AVISO, f)
  }, [])



  // modo W: esconde a navbar do topo (W fora de campos liga e desliga; Esc sai)
  const [trabalho, setTrabalho] = useState(() => { try { return localStorage.getItem('modo-w') === 'sim' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('modo-w', trabalho ? 'sim' : 'nao') } catch { /* sem storage */ } }, [trabalho])
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      // Esc dentro de um campo só sai do campo (o editor faz o mesmo): W, ⌘[ e os outros atalhos voltam a valer
      const campo = (e.target as HTMLElement | null)?.closest?.('textarea, input, select, [contenteditable="true"]') as HTMLElement | null
      if (e.key === 'Escape' && campo && !e.defaultPrevented) { e.preventDefault(); campo.blur(); return }
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.modal-fundo, .paleta-fundo, .tabela-menu, .porta-caixa')) { setTrabalho(false); return }
      if (e.key.toLowerCase() !== 'w' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('textarea, input, select, [contenteditable="true"], .cm-editor') || document.querySelector('.modal-fundo, .paleta-fundo')) return
      e.preventDefault(); setTrabalho((w) => !w)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  // ⌘O: busca rápida de notas (abre numa aba da Redação)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {   // ⌘O: busca de notas
        e.preventDefault()
        setPaleta(true)
      }
      // nova copy / nova criação (nascem em Priorizar e abrem numa aba da Redação). ⌥N pela tecla física (e.code):
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
        setNovo('producao')   // ⌘I, ⌥N, ⌘⇧N: copy nova com o ícone do formato (nasce como Ideia e aparece na Criação)
        return
      }
      // ⌃1…⌃8 (ou ⌥1…, ou ⌘1… onde o navegador deixa: no Chrome o ⌘1–8 troca de aba do navegador antes da página)
      // trocam de aba, na ordem da navbar. Com uma nota aberta no modal, os números navegam entre as versões dela (ModalNota)
      const n = /^Digit[1-9]$/.test(e.code) ? Number(e.code.slice(5)) : 0
      if ((e.metaKey || e.ctrlKey || e.altKey) && !e.shiftKey && n >= 1 && n <= NAV.length && !document.querySelector('.modal-fundo .modal-nota, .redacao-nota')) {   // modo copy: os números são das abas de nota (Redacao)
        e.preventDefault()
        setPagina(NAV[n - 1])
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])

  return (
    <div className={`app ${modal ? 'com-nota' : ''} ${trabalho ? 'modo-w' : ''}`}>
      <div className="lateral-area">
      {/* breadcrumb: NEO-OBSIDIAN › a página aberta */}
      <nav className="migalhas" aria-label="Onde você está">
        <button type="button" className="neo-marca" title="Redação" onClick={() => setPagina('Redação')}><i />NEO-OBSIDIAN</button>
        <span className="migalhas-sep" aria-hidden="true">›</span>
        <span className="migalhas-item is-atual" aria-current="page">{pagina}</span>
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
      <div id="nav-direita" className="nav-direita" />   {/* a Redação põe aqui Skills e Calendário (portal) */}
      </div>

      <main className="corpo sem-chat">
        <section className="pagina">
          {pagina === 'Redação' ? <Redacao versao={versao + mudou} />
            : pagina === 'Skills' ? <Skills versao={versao + mudou} onAbrirNota={(alvo) => abrirNaRedacao(alvo, true)} />
            : pagina === 'X' ? <Radar key="x" titulo="X" fontes={['x']} />
            : pagina === 'Instagram' ? <Instagram />
            : pagina === 'Sites' ? <Radar key="sites" titulo="Sites" fontes={['github', 'huggingface', 'hackernews']} />
            : pagina === 'Agendamento' ? <Calendario />
            : <EmBreve pagina={pagina} />}
          {modal && <ModalNota alvo={modal} onFechar={() => { setModal(null); setVoltar(null) }}
        voltar={voltar ? { rotulo: voltar.rotulo, fn: () => { setModal(null); setVoltar(null); voltar.fn() } } : undefined}
        onMudou={() => setMudou((n) => n + 1)} versao={versao} />}
        </section>
      </main>

      {novo && <NovoRapido tipo={novo} onFechar={() => setNovo(null)}
        onCriado={(_c, msg, nota) => {   // a copy nova abre numa aba nova da Redação
          setNovo(null); setMudou((n) => n + 1)
          abrirNaRedacao({ raiz: nota.raiz, nome: nota.nome } as Alvo, true)
          avisarApp(msg)
        }} />}
      {avisoApp && <div className="ideias-aviso" role="status">{avisoApp}</div>}
      {paleta && <Paleta onFechar={() => setPaleta(false)}
        onAbrir={(raiz, nome) => { setPaleta(false); abrirNaRedacao({ raiz, nome } as Alvo, false) }}
        onImportar={(raiz, nome) => { setPaleta(false); abrirNaRedacao({ raiz, nome } as Alvo, true) }}
        onCriar={(t) => { setPaleta(false); fetch('/api/copies/ideia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: t }) })
          .then((r) => r.json()).then((d) => { if (d.nome) { setMudou((n) => n + 1); abrirNaRedacao({ raiz: (d.raiz ?? 'priorizar'), nome: d.nome } as Alvo, true) } }).catch(() => {}) }} />}

    </div>
  )
}
