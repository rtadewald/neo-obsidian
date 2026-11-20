import { useEffect, useRef, useState, type ReactNode } from 'react'
import { onde } from './canvasApi'
import { Markdown } from './Markdown'
import { conversar, historico, type EventoChat, type Msg } from './api'
import { Icone } from './Icone'

/** O chat da coluna da direita: o Claude Code (Claude Agent SDK) rodando dentro do vault, com as skills de lá.
 *  Ver backend/agente.py. */

const VERBO: Record<string, string> = {
  Read: 'Lendo', Glob: 'Procurando', Grep: 'Buscando', Write: 'Escrevendo', Edit: 'Editando', Bash: 'Rodando',
  WebSearch: 'Pesquisando', WebFetch: 'Abrindo', Skill: 'Usando a skill', TodoWrite: 'Planejando',
  mcp__neo__transcrever_youtube: 'Transcrevendo', mcp__neo__rotas: 'Vendo as rotas', mcp__neo__app: 'No app:',
  mcp__neo__tela: 'Na tela:',
}

/** Resposta em markdown completo (o mesmo leitor das notas). Os blocos 📎 (trecho de nota) viram um cartãozinho e as
 *  linhas 🖼️ ![[…]] (imagens coladas) viram miniaturas. */
function Texto({ md }: { md: string }) {
  const partes: ReactNode[] = []
  let resto: string[] = []
  const fechar = (k: number) => { if (resto.join('').trim()) partes.push(<Markdown key={`m${k}`} md={resto.join('\n\n')} />); resto = [] }
  md.trim().split(/\n{2,}/).forEach((b, i) => {
    const linhas = b.split('\n')
    if (linhas.every((l) => /^🖼️ !\[\[[^\]]+\]\]$/.test(l.trim()))) {
      fechar(i)
      partes.push(<div key={`img${i}`} className="msg-imagens">{linhas.map((l) => {
        const nome = /\[\[([^\]]+)\]\]/.exec(l)![1]
        return <a key={nome} href={`/api/anexo/${encodeURIComponent(nome)}`} target="_blank" rel="noreferrer"><img src={`/api/anexo/${encodeURIComponent(nome)}`} alt={nome} loading="lazy" /></a>
      })}</div>)
      return
    }
    if (!linhas[0].startsWith('📎 ')) { resto.push(b); return }
    fechar(i)
    partes.push(
      <div key={`t${i}`} className="msg-trecho">
        <span>{linhas[0].replace(/^📎 /, '').replace(/ · `[^`]*`$/, '').replace(/\[\[|\]\]/g, '')}</span>
        <blockquote>{linhas.slice(1).map((l) => l.replace(/^> ?/, '')).join('\n')}</blockquote>
      </div>,
    )
  })
  fechar(-1)
  return <>{partes}</>
}

/** "Onde o Rodrigo está" para o agente: a página e a nota aberta na Redação. */
function descreverOnde() {
  const l = [`- Tela: ${onde.pagina || '?'}`]
  if (onde.nota) l.push(`- Nota aberta: [[${onde.nota.nome}]] (${onde.nota.raiz})`)
  return l.join('\n')
}

/** "agora", "há 5 min", "ontem", "12/11": quando a conversa mexeu por último. */
function quando(ts: number) {
  const d = Date.now() / 1000 - ts
  if (d < 60) return 'agora'
  if (d < 3600) return `há ${Math.round(d / 60)} min`
  if (d < 86400) return `há ${Math.round(d / 3600)} h`
  if (d < 172800) return 'ontem'
  return new Date(ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

type Props = {
  aberto?: boolean; onAlternar?: () => void
  onMudou?: () => void                     // uma ferramenta mudou o vault/app (ou a resposta terminou): a tela recarrega
  alca?: ReactNode                         // borda de arrastar para mudar a largura
  onTela?: (ev: Extract<EventoChat, { t: 'tela' }>) => void   // o chat mexe na tela (trocar de página, abrir nota)
}

/** ⌘I (App.tsx): abre o chat, foca o campo e, com texto selecionado no editor, traz o trecho. */
export const EVENTO_CHAT = 'chat-abrir'
export type Trecho = { nome: string; raiz: string; caminho: string; texto: string; linhaIni: number; linhaFim: number }

/** Texto da mensagem com o trecho na frente, no formato que o agente sabe ler (ver agente.py). */
function comTrecho(t: Trecho | null, texto: string) {
  if (!t) return texto
  const linhas = t.linhaIni === t.linhaFim ? `linha ${t.linhaIni}` : `linhas ${t.linhaIni}–${t.linhaFim}`
  const corpo = t.texto ? t.texto.split('\n').map((l) => `> ${l}`).join('\n') : '> (a nota inteira)'
  return `📎 [[${t.nome}]] · ${linhas} · \`${t.caminho}\`\n${corpo}\n\n${texto}`
}

const novaId = () => `c-${Date.now().toString(36)}`

export function Chat({ aberto = true, onAlternar, onMudou, alca, onTela }: Props) {
  // várias conversas: cada uma com o seu histórico e a sua sessão do Claude
  const [conversa, setConversa] = useState(() => { try { return localStorage.getItem('chat-conversa') || novaId() } catch { return novaId() } })
  useEffect(() => { try { localStorage.setItem('chat-conversa', conversa) } catch { /* sem storage */ } }, [conversa])
  const [lista, setLista] = useState<{ id: string; titulo: string; n: number; atualizado_em: number }[] | null>(null)   // aberta = não nula
  const listaRef = useRef<HTMLDivElement>(null)
  const abrirLista = () => fetch('/api/chats', { cache: 'no-store' }).then((r) => r.json()).then(setLista).catch(() => setLista([]))
  useEffect(() => {
    if (!lista) return
    const fora = (e: PointerEvent) => { if (!listaRef.current?.contains(e.target as HTMLElement)) setLista(null) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setLista(null)
    window.addEventListener('pointerdown', fora, true); window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('keydown', esc) }
  }, [lista])
  const novaConversa = () => { setLista(null); setConversa(novaId()) }
  const apagarConversa = async (id: string) => {
    await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    if (id === conversa) setConversa(novaId())
    abrirLista()
  }
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [texto, setTexto] = useState('')
  // imagens coladas (⌘V) ou soltas no campo: já salvas nos anexos do vault, vão na mensagem como ![[...]]
  const [imagens, setImagens] = useState<string[]>([])
  const [subindo, setSubindo] = useState(0)
  async function anexar(arquivos: File[]) {
    const imgs = arquivos.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return false
    setSubindo((n) => n + imgs.length)
    for (const f of imgs) {
      try {
        const b64 = await new Promise<string>((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = erro; r.readAsDataURL(f) })
        const res = await fetch('/api/chat/imagem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dados: b64, tipo: f.type }) })
        const d = await res.json()
        if (res.ok) setImagens((l) => [...l, d.nome])
      } finally { setSubindo((n) => n - 1) }
    }
    return true
  }
  // ditado: o reconhecimento de voz do navegador (pt-BR) escreve no campo enquanto você fala; o texto que já estava fica
  const [ouvindo, setOuvindo] = useState(false)
  const [erroVoz, setErroVoz] = useState('')
  const voz = useRef<{ stop: () => void } | null>(null)
  const temVoz = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)  // eslint-disable-line @typescript-eslint/no-explicit-any
  function ditar() {
    if (voz.current) { voz.current.stop(); return }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition  // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!SR) return
    const r = new SR()
    r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true
    const antes = texto.trim() ? texto.trimEnd() + ' ' : ''
    let final = ''
    r.onresult = (ev: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
      let parcial = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript
        if (ev.results[i].isFinal) final += t; else parcial += t
      }
      setTexto((antes + final + parcial).replace(/\s+/g, ' ').replace(/^ /, ''))
    }
    r.onerror = (ev: any) => setErroVoz(ev.error === 'not-allowed' ? 'Libere o microfone para este site no navegador.' : ev.error === 'no-speech' ? '' : `Ditado: ${ev.error}`)  // eslint-disable-line @typescript-eslint/no-explicit-any
    r.onend = () => { voz.current = null; setOuvindo(false); campo.current?.focus() }
    setErroVoz(''); voz.current = r; setOuvindo(true); r.start()
  }
  useEffect(() => () => voz.current?.stop(), [])
  const [ocupado, setOcupado] = useState(false)
  const [fila, setFila] = useState<string[]>([])   // pedidos digitados enquanto ele ainda respondia o de cima
  const log = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)
  const cb = useRef({ onMudou, onTela })
  cb.current = { onMudou, onTela }
  const filaRef = useRef<string[]>(fila)
  filaRef.current = fila
  const [trecho, setTrecho] = useState<Trecho | null>(null)
  const trechoRef = useRef<Trecho | null>(null)
  trechoRef.current = trecho
  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ trecho: Trecho | null }>).detail
      if (d?.trecho) setTrecho(d.trecho)
      requestAnimationFrame(() => campo.current?.focus())
    }
    window.addEventListener(EVENTO_CHAT, f); return () => window.removeEventListener(EVENTO_CHAT, f)
  }, [])
  const processando = useRef(false)   // trava de verdade (ocupado é só pra UI; estado React é tarde demais pro encadeamento)

  useEffect(() => { setMsgs([]); historico(conversa).then((h) => setMsgs(h)).catch(() => {}) }, [conversa])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }) }, [msgs])
  // ao reabrir o chat (o log é montado de novo) ou ao carregar o histórico: já no fim da conversa, sem animação
  useEffect(() => { if (aberto) requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight })) }, [aberto, conversa])

  // parar: o botão de enviar vira ⏹ enquanto ele responde (como no Claude Code); Esc no campo também para
  const controle = useRef<AbortController | null>(null)
  function parar() {
    if (!controle.current) return
    setFila([])   // parar cancela também o que estava na fila
    controle.current.abort()
  }

  // "/" no começo do campo abre o seletor de skills (as do vault, em 3 Skills); escolher insere "/nome "
  const [skills, setSkills] = useState<{ nome: string; descricao: string }[] | null>(null)
  const [selSkill, setSelSkill] = useState(0)
  const [barraFechada, setBarraFechada] = useState<string | null>(null)   // Esc fecha até o texto mudar
  const termo = /^\/([\p{L}\p{N}_-]*)$/u.exec(texto)?.[1]
  useEffect(() => { if (termo !== undefined && !skills) fetch('/api/skills').then((r) => r.json()).then(setSkills).catch(() => setSkills([])) }, [termo, skills])
  const barra = termo === undefined || barraFechada === texto || !skills ? [] : skills
    .filter((k) => !termo || k.nome.toLowerCase().includes(termo.toLowerCase()) || (k.descricao ?? '').toLowerCase().includes(termo.toLowerCase()))
    .sort((a, b) => Number(!a.nome.startsWith(termo ?? '')) - Number(!b.nome.startsWith(termo ?? '')))
    .slice(0, 8)
  useEffect(() => setSelSkill(0), [termo])
  const escolherSkill = (nome: string) => { setTexto(`/${nome} `); campo.current?.focus() }

  async function enviar(e?: React.FormEvent, direto?: string) {
    e?.preventDefault()
    if (direto === undefined) voz.current?.stop()   // enviar encerra o ditado
    const anexos = direto === undefined ? imagens : []
    const pergunta = [(direto ?? texto).trim(), anexos.map((n) => `🖼️ ![[${n}]]`).join('\n')].filter(Boolean).join('\n\n')
    if (!pergunta) return
    const t = direto === undefined ? comTrecho(trechoRef.current, pergunta) : pergunta
    if (direto === undefined) setTrecho(null)
    if (direto === undefined) setImagens([])
    if (processando.current) {   // já está respondendo outra: entra na fila
      if (direto === undefined) { setFila((f) => [...f, t]); setTexto('') }
      return
    }
    processando.current = true
    if (direto === undefined) setTexto('')
    setOcupado(true)
    setMsgs((m) => [...m, { papel: 'usuario', texto: t }, { papel: 'jarvis', texto: '', ferramentas: [] }])
    const mexe = (f: (u: Msg) => Msg) => setMsgs((m) => [...m.slice(0, -1), f(m[m.length - 1])])
    const ctl = new AbortController()
    controle.current = ctl
    try {
      await conversar({ conversa, texto: t, onde: descreverOnde(), nota: onde.nota ?? null }, (ev) => {
        if (ev.t === 'texto') mexe((u) => ({ ...u, texto: u.texto + ev.v }))
        else if (ev.t === 'ferramenta') mexe((u) => ({ ...u, ferramentas: [...(u.ferramentas ?? []), `${VERBO[ev.nome] ?? ev.nome} ${ev.alvo}`.trim()] }))
        else if (ev.t === 'erro') mexe((u) => ({ ...u, erro: ev.v }))
        else if (ev.t === 'mudou') cb.current.onMudou?.()   // a tela recarrega a cada mudança, sem esperar a resposta
        else if (ev.t === 'tela') cb.current.onTela?.(ev)
      }, ctl.signal)
    } catch (err) {
      if (ctl.signal.aborted) mexe((u) => ({ ...u, texto: `${u.texto}${u.texto ? '\n\n' : ''}⏹ Parado.` }))
      else mexe((u) => ({ ...u, erro: String(err) }))
    } finally {
      controle.current = null
      processando.current = false
      setOcupado(false)
      cb.current.onMudou?.()
      const prox = filaRef.current[0]
      if (prox !== undefined) { setFila((f) => f.slice(1)); enviar(undefined, prox) }
    }
  }

  if (!aberto) return (
    <aside className="chat chat--fechado glass glass--light" aria-label="Chat (recolhido)">
      <button className="chat-abrir" onClick={onAlternar} title="Abrir o chat (⌘I ou ⌘J)">
        <span className={`orb orb--p ${ocupado ? 'is-pensando' : ''}`} />
        <span className="chat-abrir-nome">CLAUDE</span>
        <Icone n="painel" t={17} />
      </button>
    </aside>
  )

  return (
    <aside className="chat glass glass--light" aria-label="Chat">
      {alca}
      <header className="chat-cabeca">
        <span className={`orb orb--p ${ocupado ? 'is-pensando' : ''}`} />
        <span className="chat-nome">CLAUDE</span>
        <span className="chat-status">{ocupado ? 'pensando…' : 'no vault'}{fila.length > 0 ? ` · ${fila.length} na fila` : ''}</span>
        <div className="chat-conversas" ref={listaRef}>
          <button className="btn-icone" disabled={ocupado} onClick={() => (lista ? setLista(null) : abrirLista())} title="Conversas anteriores" aria-label="Conversas anteriores" aria-expanded={!!lista}>
            <svg className="i" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.4 10a6.6 6.6 0 1 0 2-4.7M3.4 3.6v3.2h3.2M10 6.4V10l2.4 1.6" /></svg></button>
          <button className="btn-icone" disabled={ocupado || msgs.length === 0} onClick={novaConversa} title="Nova conversa" aria-label="Nova conversa"><Icone n="mais" t={16} /></button>
          {lista && (
            <div className="chat-conversas-lista glass glass--light" role="menu">
              <p className="menu-titulo">Conversas</p>
              {lista.length === 0 && <p className="chat-conversas-vazio">Nenhuma conversa ainda.</p>}
              {lista.map((c) => (
                <div key={c.id} className={`chat-conversa ${c.id === conversa ? 'is-on' : ''}`}>
                  <button role="menuitem" onClick={() => { setLista(null); setConversa(c.id) }}>
                    <span className="chat-conversa-titulo">{c.titulo}</span>
                    <em>{quando(c.atualizado_em)} · {c.n} msgs</em>
                  </button>
                  <button className="chat-conversa-apagar" onClick={() => apagarConversa(c.id)} title="Apagar esta conversa" aria-label="Apagar conversa"><Icone n="lixeira" t={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        {onAlternar && <button className="btn-icone chat-recolher" onClick={onAlternar} title="Recolher o chat (⌘J)" aria-label="Recolher o chat"><Icone n="painel" t={16} /></button>}
      </header>

      <div className="chat-log" ref={log} aria-live="polite">
        {msgs.length === 0 && (
          <div className="chat-vazio">
            <p>O Claude Code, rodando no teu vault, com as tuas skills.</p>
            <p className="mudo">Ele sabe qual copy está aberta. / abre as skills.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg msg--${m.papel}`}>
            {m.papel === 'jarvis' && <span className="orb orb--msg" />}
            <div className="balao">
              {m.ferramentas && m.ferramentas.length > 0 && (
                <ul className="passos">{m.ferramentas.slice(-4).map((f, k) => <li key={k}>{f}</li>)}</ul>
              )}
              {m.texto ? <Texto md={m.texto} /> : !m.erro && ocupado && i === msgs.length - 1 ? <span className="digitando"><i /><i /><i /></span> : null}
              {m.erro && <p className="erro">{m.erro}</p>}
            </div>
          </div>
        ))}
      </div>

      {fila.length > 0 && (
        <ul className="chat-fila">
          {fila.map((f, i) => (
            <li key={i}>
              <span>{f}</span>
              <button className="btn-icone" aria-label="Tirar da fila" onClick={() => setFila((x) => x.filter((_, j) => j !== i))}><Icone n="fechar" t={12} /></button>
            </li>
          ))}
        </ul>
      )}
      {trecho && (
        <div className="foco foco--trecho">
          <Icone n="nota" t={14} />
          <span className="foco-titulo" title={trecho.texto}>
            <b>{trecho.nome}</b> · {trecho.linhaIni === trecho.linhaFim ? `linha ${trecho.linhaIni}` : `linhas ${trecho.linhaIni}–${trecho.linhaFim}`}
            {trecho.texto && <em>“{trecho.texto.replace(/\s+/g, ' ').slice(0, 90)}{trecho.texto.length > 90 ? '…' : ''}”</em>}
          </span>
          <button className="btn-icone" aria-label="Tirar o trecho" onClick={() => setTrecho(null)}><Icone n="fechar" t={14} /></button>
        </div>
      )}
      {(imagens.length > 0 || subindo > 0) && (
        <div className="campo-imagens">
          {imagens.map((n) => (
            <span key={n} className="campo-imagem">
              <img src={`/api/anexo/${encodeURIComponent(n)}`} alt={n} />
              <button type="button" aria-label="Tirar a imagem" onClick={() => setImagens((l) => l.filter((x) => x !== n))}>×</button>
            </span>
          ))}
          {subindo > 0 && <span className="campo-imagem is-subindo" aria-label="Enviando imagem" />}
        </div>
      )}
      {erroVoz && <p className="chat-voz-erro">{erroVoz}</p>}
      {barra.length > 0 && (
        <div className="chat-skills glass glass--light" role="listbox" aria-label="Skills">
          <p className="menu-titulo">Skills</p>
          {barra.map((k, i) => (
            <button key={k.nome} type="button" role="option" aria-selected={i === selSkill} className={i === selSkill ? 'is-sel' : ''}
              onMouseMove={() => setSelSkill(i)} onMouseDown={(e) => { e.preventDefault(); escolherSkill(k.nome) }}>
              <b>/{k.nome}</b><span>{k.descricao}</span>
            </button>
          ))}
        </div>
      )}
      <form className="campo" onSubmit={enviar}
        onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) e.preventDefault() }}
        onDrop={(e) => { const f = [...e.dataTransfer.files]; if (f.some((x) => x.type.startsWith('image/'))) { e.preventDefault(); anexar(f) } }}>
        <textarea
          onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.some((x) => x.type.startsWith('image/'))) { e.preventDefault(); anexar(f) } }}
          ref={campo} rows={1} value={texto} placeholder={trecho ? 'O que fazer com esse trecho?' : 'Pergunte ao Claude…'} aria-label="Mensagem"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (barra.length) {   // seletor de skills aberto: ↑↓ escolhem, ↵/Tab inserem, Esc fecha
              if (e.key === 'ArrowDown') { e.preventDefault(); setSelSkill((i) => (i + 1) % barra.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSelSkill((i) => (i - 1 + barra.length) % barra.length); return }
              if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); escolherSkill(barra[selSkill].nome); return }
              if (e.key === 'Escape') { e.preventDefault(); setBarraFechada(texto); return }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() }
            else if (e.key === 'd' && e.metaKey && e.shiftKey && temVoz) { e.preventDefault(); ditar() }   // ⌘⇧D liga/desliga o ditado
            else if (e.key === 'Escape') { e.preventDefault(); if (ocupado) parar(); else e.currentTarget.blur() }   // Esc para a resposta; parado, sai do chat
          }}
        />
        {temVoz && (
          <button type="button" className={`btn-icone btn-ditar ${ouvindo ? 'is-ouvindo' : ''}`} onClick={ditar} aria-pressed={ouvindo}
            aria-label={ouvindo ? 'Parar o ditado' : 'Ditar'} title={ouvindo ? 'Ouvindo… clique para parar (⌘⇧D)' : 'Ditar a mensagem (⌘⇧D)'}>
            <svg className="i" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="2.5" width="6" height="10" rx="3" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" /></svg>
          </button>
        )}
        {ocupado && !texto.trim() && !imagens.length
          ? <button className="btn-enviar is-parar" type="button" onClick={parar} aria-label="Parar a resposta" title="Parar a resposta (Esc)">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" /></svg></button>
          : <button className="btn-enviar" type="submit" disabled={!texto.trim() && !imagens.length} aria-label={ocupado ? 'Colocar na fila' : 'Enviar'} title={ocupado ? 'Ocupado: entra na fila' : 'Enviar'}><Icone n="enviar" t={16} /></button>}
      </form>
    </aside>
  )
}
