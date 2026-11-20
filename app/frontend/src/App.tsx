import { Fragment, useEffect, useRef, useState } from 'react'
import { Calendario } from './Calendario'
import { Chat, EVENTO_CHAT } from './Chat'
import { editorAtual, selecao } from './Editor'
import { PASTA } from './notas'
import { onde, type Alvo } from './canvasApi'
import { EVENTO_AVISO, assinarEventos, vigiarOnde } from './porta'
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
  const [paleta, setPaleta] = useState(false)
  const [novo, setNovo] = useState<TipoNovo | null>(null)   // ⌘⇧I nova ideia · ⌘⇧N nova produção
  const [avisoApp, setAvisoApp] = useState<string | null>(null)
  const avisarApp = (msg: string) => { setAvisoApp(msg); window.setTimeout(() => setAvisoApp((a) => (a === msg ? null : a)), 3200) }
  // a busca (⌘O) e o Claude abrem a copy numa aba da Redação (Enter: a da frente; ⌘↵: uma nova)
  const abrirNaRedacao = (alvo: Alvo, nova: boolean) => {
    setPagina('Redação')
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(EVENTO_REDACAO, { detail: { alvo, nova } })), 30)
  }
  const [mudou, setMudou] = useState(0)   // copy nova (⌘K, ⌘O): a Redação recarrega
  const [versao, setVersao] = useState(0)
  // eventos do backend: nota mudou no vault (o Claude editou daqui), o Claude mexendo na tela e se ele está ouvindo
  const tela = useRef<(ev: { acao: string; pagina?: string; raiz?: string; nome?: string; nova?: boolean }) => void>(() => {})
  tela.current = (ev) => {
    if (ev.acao === 'pagina' && ev.pagina && (NAV as readonly string[]).includes(ev.pagina)) setPagina(ev.pagina)
    else if ((ev.acao === 'abrir_nota' || ev.acao === 'mostrar') && ev.raiz && ev.nome) abrirNaRedacao({ raiz: ev.raiz, nome: ev.nome } as Alvo, !!ev.nova)
  }
  useEffect(() => assinarEventos((ev) => {
    if (ev.t === 'mudou') setVersao((v) => v + 1)
    else if (ev.t === 'tela') tela.current(ev)
  }), [])
  useEffect(() => vigiarOnde(), [])

  // o chat da direita (Claude Agent SDK no vault): ⌘J abre e fecha; recolhido vira a bolinha no canto
  const [chat, setChat] = useState(() => { try { return localStorage.getItem('chat') !== 'fechado' } catch { return true } })
  const chatRef = useRef(chat); chatRef.current = chat   // o atalho ⌘I lê o estado de agora
  useEffect(() => { try { localStorage.setItem('chat', chat ? 'aberto' : 'fechado') } catch { /* sem storage */ } }, [chat])
  // largura do chat: arrastando a borda esquerda dele (duplo clique volta ao padrão)
  // janela do chat: flutua por cima da página; arrasta pelo cabeçalho e muda de tamanho pelas bordas e cantos (fica guardada)
  type Janela = { x: number; y: number; w: number; h: number }
  const padrao = (): Janela => ({ w: 420, h: window.innerHeight - 96, x: window.innerWidth - 420 - 18, y: 70 })
  const [janela, setJanela] = useState<Janela>(() => { try { return JSON.parse(localStorage.getItem('chat-janela') || 'null') ?? padrao() } catch { return padrao() } })
  useEffect(() => { try { localStorage.setItem('chat-janela', JSON.stringify(janela)) } catch { /* sem storage */ } }, [janela])
  // sempre inteira na tela (a janela do navegador pode ter encolhido)
  const [, setTela] = useState(0)
  useEffect(() => { const f = () => setTela((n) => n + 1); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  const W = window.innerWidth, H = window.innerHeight
  const jw = Math.min(Math.max(janela.w, 300), W - 16), jh = Math.min(Math.max(janela.h, 260), H - 16)
  const jan = { w: jw, h: jh, x: Math.min(Math.max(janela.x, 8), W - jw - 8), y: Math.min(Math.max(janela.y, 8), H - jh - 8) }
  const mexerJanela = (modo: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const x0 = e.clientX, y0 = e.clientY, j0 = jan
    const mover = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0
      const n = { ...j0 }
      if (modo === 'm') { n.x += dx; n.y += dy }   // m = mover; e, d, c, b = bordas esquerda, direita, cima e baixo
      if (modo.includes('d')) n.w = j0.w + dx
      if (modo.includes('e')) { n.w = Math.max(300, j0.w - dx); n.x = j0.x + j0.w - n.w }
      if (modo.includes('b')) n.h = j0.h + dy
      if (modo.includes('c')) { n.h = Math.max(260, j0.h - dy); n.y = j0.y + j0.h - n.h }
      setJanela(n)
    }
    const soltar = () => { window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); document.body.classList.remove('arrastando') }
    document.body.classList.add('arrastando')
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
  }
  // arrastar pelo cabeçalho (fora dos botões)
  const pegarCabeca = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement
    if (!t.closest('.chat-cabeca') || t.closest('button, a, input, select, textarea, [role="menu"]')) return
    mexerJanela('m')(e)
  }
  // o botão "+ Nova copy" da Redação abre a mesma janela do ⌘K
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
      // ⌘I abre o chat da direita e foca o campo (aberto, esconde); com texto selecionado no editor da copy, manda o trecho junto
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === 'i' || e.code === 'KeyI')) {
        if (document.querySelector('.paleta-fundo')) return
        e.preventDefault(); e.stopPropagation()
        const v = editorAtual.v
        const nota = onde.nota
        let trecho = null
        if (v && v.dom.isConnected && v.hasFocus && !v.state.selection.main.empty && nota) {   // só a seleção de agora (editor em foco)
          const s = selecao(v)
          trecho = { ...s, nome: nota.nome, raiz: nota.raiz, caminho: `${PASTA[nota.raiz] ?? nota.raiz}/${nota.nome}.md` }
        }
        if (chatRef.current && !trecho) { setChat(false); return }   // aberto e sem trecho: ⌘I esconde o chat
        setChat(true)
        window.setTimeout(() => window.dispatchEvent(new CustomEvent(EVENTO_CHAT, { detail: { trecho } })), 30)
        return
      }
      // ⌘K nova copy, ⌥N nova criação (nascem em Priorizar e abrem numa aba da Redação)
      const cmdK = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')
      const opcao = e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyN'
      const comando = (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && ['i', 'n'].includes(e.key.toLowerCase())
      if (cmdK || opcao || comando) {
        const t = e.target as HTMLElement | null
        if (document.querySelector('.modal-fundo .modal-nota, .paleta-fundo')) return
        if (opcao && t?.closest?.('textarea, input, select, [contenteditable="true"], .cm-editor')) return   // dentro de um campo, o ⌥N é do campo
        if (cmdK && t?.closest?.('textarea, input, select')) return
        e.preventDefault(); e.stopPropagation()
        setNovo('producao')   // ⌘K, ⌥N, ⌘⇧N: copy nova com o ícone do formato (nasce como Ideia e aparece na Criação)
        return
      }
      // ⌘J mostra/oculta o chat (o ⌘B é o negrito do editor)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault(); e.stopPropagation()
        setChat((c) => !c)
        return
      }
      // ⌃1…⌃8 (ou ⌥1…, ou ⌘1… onde o navegador deixa: no Chrome o ⌘1–8 troca de aba do navegador antes da página)
      // trocam de aba, na ordem da navbar
      const n = /^Digit[1-9]$/.test(e.code) ? Number(e.code.slice(5)) : 0
      if ((e.metaKey || e.ctrlKey || e.altKey) && !e.shiftKey && n >= 1 && n <= NAV.length && !document.querySelector('.modal-fundo .modal-nota, .redacao-nota, .app.modo-w .redacao')) {   // modo copy: abas de nota; modo W na Redação: abas da tabela (Redacao)
        e.preventDefault()
        setPagina(NAV[n - 1])
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [])

  return (
    <div className={`app ${trabalho ? 'modo-w' : ''}`}>
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
      <span />
      </div>

      {/* o chat flutua à direita, por cima da página (a página não encolhe) */}
      <main className="corpo sem-chat">
        <section className="pagina">
          {pagina === 'Redação' ? <Redacao versao={versao + mudou} />
            : pagina === 'Skills' ? <Skills versao={versao + mudou} onAbrirNota={(alvo) => abrirNaRedacao(alvo, true)} />
            : pagina === 'X' ? <Radar key="x" titulo="X" fontes={['x']} />
            : pagina === 'Instagram' ? <Instagram />
            : pagina === 'Sites' ? <Radar key="sites" titulo="Sites" fontes={['github', 'huggingface', 'hackernews']} />
            : <Calendario />}
        </section>
      </main>
      <div className={`chat-janela ${chat ? '' : 'is-fechada'}`} onPointerDown={chat ? pegarCabeca : undefined}
        onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('.chat-cabeca') && !(e.target as HTMLElement).closest('button')) setJanela(padrao()) }}
        style={chat ? { left: jan.x, top: jan.y, width: jan.w, height: jan.h } : undefined}>
        <Chat aberto={chat} onAlternar={() => setChat((v) => !v)} onMudou={() => setVersao((v) => v + 1)}
          onTela={(ev) => tela.current(ev)} />
        {chat && ['e', 'd', 'c', 'b', 'ce', 'cd', 'be', 'bd'].map((m) => <i key={m} className={`chat-borda is-${m}`} onPointerDown={mexerJanela(m)} />)}
      </div>

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
