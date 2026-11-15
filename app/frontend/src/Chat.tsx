import { canvasAberto, descreverOnde } from './canvasApi'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Markdown } from './Markdown'
import type { Trecho } from './notas'
import { api, conversar, type EventoChat, type Msg, type Sinal } from './api'
import { Fonte, Icone } from './Icone'

const VERBO: Record<string, string> = {
  Read: 'Lendo', Glob: 'Procurando', Grep: 'Buscando', Write: 'Escrevendo', Edit: 'Editando',
  WebSearch: 'Pesquisando', WebFetch: 'Abrindo', Skill: 'Usando a skill', TodoWrite: 'Planejando',
  mcp__jarvis__transcrever_youtube: 'Transcrevendo', mcp__jarvis__criar_ideia: 'Criando a ideia', mcp__jarvis__criar_saida: 'Criando a saída',
  mcp__jarvis__ligar_ao_canvas: 'Ligando no canvas', mcp__jarvis__criar_entrada: 'Criando a entrada', mcp__jarvis__posicionar: 'Posicionando',
}

/** Resposta do Jarvis em markdown completo (o mesmo leitor das notas: títulos, listas, citações, código, links).
 *  Os blocos 📎 (trecho de nota) e 📡 (sinal do radar) que o app manda viram um cartãozinho. */
export function Texto({ md, onSinal }: { md: string; onSinal?: (url: string) => void }) {
  const partes: ReactNode[] = []
  let resto: string[] = []
  const fechar = (k: number) => { if (resto.join('').trim()) partes.push(<Markdown key={`m${k}`} md={resto.join('\n\n')} />); resto = [] }
  md.trim().split(/\n{2,}/).forEach((b, i) => {
    const linhas = b.split('\n')
    // imagens coladas: `🖼️ ![[Pasted image ….png]]`, uma por linha
    if (linhas.every((l) => /^🖼️ !\[\[[^\]]+\]\]$/.test(l.trim()))) {
      fechar(i)
      partes.push(<div key={`img${i}`} className="msg-imagens">{linhas.map((l) => {
        const nome = /\[\[([^\]]+)\]\]/.exec(l)![1]
        return <a key={nome} href={`/api/anexo/${encodeURIComponent(nome)}`} target="_blank" rel="noreferrer"><img src={`/api/anexo/${encodeURIComponent(nome)}`} alt={nome} loading="lazy" /></a>
      })}</div>)
      return
    }
    if (!linhas[0].startsWith('📎 ') && !linhas[0].startsWith('📡 ')) { resto.push(b); return }
    fechar(i)
    const url = linhas[0].startsWith('📡 ') ? linhas[0].match(/ · (https?:\/\/\S+)$/)?.[1] : undefined
    partes.push(
      <div key={`t${i}`} className={`msg-trecho ${url && onSinal ? 'is-clicavel' : ''}`} title={url && onSinal ? 'Abrir este sinal no Radar' : undefined}
        onClick={url && onSinal ? () => onSinal(url) : undefined}>
        <span>{linhas[0].replace(/^(📎|📡) /, '').replace(/ · `[^`]*`$/, '').replace(/ · https?:\/\/\S+$/, '').replace(/\[\[|\]\]/g, '')}</span>
        <blockquote>{linhas.slice(1).map((l) => l.replace(/^> ?/, '')).join('\n')}</blockquote>
      </div>,
    )
  })
  fechar(-1)
  return <>{partes}</>
}

/** Texto da mensagem com o trecho na frente, no formato que o Jarvis sabe ler (ver agente.py). */
function comTrecho(t: Trecho | null, texto: string) {
  if (!t) return texto
  const linhas = t.linhaIni === t.linhaFim ? `linha ${t.linhaIni}` : `linhas ${t.linhaIni}–${t.linhaFim}`
  const corpo = t.texto ? t.texto.split('\n').map((l) => `> ${l}`).join('\n') : '> (a nota inteira)'
  return `📎 [[${t.nome}]] · ${linhas} · \`${t.caminho}\`\n${corpo}\n\n${texto}`
}

const FONTE: Record<string, string> = { x: 'X', github: 'GitHub', huggingface: 'Hugging Face', hackernews: 'Hacker News', instagram: 'Instagram' }

/** O sinal do radar vai escrito na própria mensagem (a sessão retomada não relê o contexto de sistema). */
function comSinal(s: Sinal | null, texto: string) {
  if (!s) return texto
  const m = s.metricas as { texto?: string }
  const corpo = [m.texto || [s.titulo, s.resumo].filter(Boolean).join(' — '), s.destaque && `Por que importa: ${s.destaque}`]
    .filter(Boolean).join('\n').split('\n').map((l) => `> ${l}`).join('\n')
  return `📡 Sinal do radar · ${FONTE[s.fonte] ?? s.fonte}${s.autor ? ` · ${s.autor}` : ''}${s.url ? ` · ${s.url}` : ''}\n${corpo}\n\n${texto}`
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
  foco: Sinal | null; limparFoco: () => void; aberto?: boolean; onAlternar?: () => void
  trecho?: Trecho | null; limparTrecho?: () => void
  pedido?: { texto: string; n: number }   // ação rápida do editor: manda sozinho
  onFim?: () => void                       // terminou de responder (a nota pode ter mudado)
  alca?: React.ReactNode                   // borda de arrastar para mudar a largura
  onAbrirSinal?: (a: { id?: number; url?: string | null; fonte?: string }) => void   // volta para o card do sinal no Radar
  onTela?: (ev: Extract<EventoChat, { t: 'tela' }>) => void   // o Jarvis mexe na tela (abrir canvas, mostrar card…)
}

export function Chat({ foco, limparFoco, aberto = true, onAlternar, trecho = null, limparTrecho, pedido, onFim, alca, onAbrirSinal, onTela }: Props) {
  // várias conversas: cada uma com o seu histórico e a sua sessão do Claude (a primeira, de sempre, é "radar")
  const [conversa, setConversa] = useState(() => { try { return localStorage.getItem('chat-conversa') || 'radar' } catch { return 'radar' } })
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
  const novaConversa = () => { setLista(null); setConversa(`c-${Date.now().toString(36)}`) }
  const apagarConversa = async (id: string) => {
    await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    if (id === conversa) setConversa(`c-${Date.now().toString(36)}`)
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
  const [fila, setFila] = useState<string[]>([])   // pedidos digitados enquanto o Jarvis ainda respondia o de cima
  const log = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)
  const cb = useRef({ trecho, limparTrecho, onFim, foco, onTela })
  cb.current = { trecho, limparTrecho, onFim, foco, onTela }
  const filaRef = useRef<string[]>(fila)
  filaRef.current = fila
  const processando = useRef(false)   // trava de verdade (ocupado é só pra UI; estado React é tarde demais pro encadeamento)
  const sinalEnviado = useRef<number | null>(null)   // o mesmo sinal não é repetido a cada mensagem

  useEffect(() => { sinalEnviado.current = null; setMsgs([]); api.historico(conversa).then((h) => setMsgs(h)).catch(() => {}) }, [conversa])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }) }, [msgs])
  // ao reabrir o chat (o log é montado de novo) ou ao carregar o histórico: já no fim da conversa, sem animação
  useEffect(() => { if (aberto) requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight })) }, [aberto, conversa])

  useEffect(() => { if (trecho || foco) campo.current?.focus() }, [trecho, foco])
  useEffect(() => { if (pedido?.n) enviar(undefined, pedido.texto) }, [pedido?.n])  // eslint-disable-line react-hooks/exhaustive-deps

  async function enviar(e?: React.FormEvent, direto?: string) {
    e?.preventDefault()
    if (direto === undefined) voz.current?.stop()   // enviar encerra o ditado
    const anexos = direto === undefined ? imagens : []
    const pergunta = [(direto ?? texto).trim(), anexos.map((n) => `🖼️ ![[${n}]]`).join('\n')].filter(Boolean).join('\n\n')
    if (!pergunta) return
    if (direto === undefined) setImagens([])
    if (processando.current) {   // o Jarvis já está respondendo outra: entra na fila
      if (direto === undefined) { setFila((f) => [...f, pergunta]); setTexto('') }
      return
    }
    processando.current = true
    const s = cb.current.foco && cb.current.foco.id !== sinalEnviado.current ? cb.current.foco : null
    if (s) sinalEnviado.current = s.id
    const t = comSinal(s, comTrecho(cb.current.trecho, pergunta))
    if (direto === undefined) setTexto('')
    cb.current.limparTrecho?.()
    setOcupado(true)
    setMsgs((m) => [...m, { papel: 'usuario', texto: t }, { papel: 'jarvis', texto: '', ferramentas: [] }])
    const mexe = (f: (u: Msg) => Msg) => setMsgs((m) => [...m.slice(0, -1), f(m[m.length - 1])])
    try {
      await conversar({ conversa, texto: t, sinal: foco?.id ?? null, onde: descreverOnde(), canvas: canvasAberto() }, (ev) => {
        if (ev.t === 'texto') mexe((u) => ({ ...u, texto: u.texto + ev.v }))
        else if (ev.t === 'ferramenta') mexe((u) => ({ ...u, ferramentas: [...(u.ferramentas ?? []), `${VERBO[ev.nome] ?? ev.nome} ${ev.alvo}`.trim()] }))
        else if (ev.t === 'erro') mexe((u) => ({ ...u, erro: ev.v }))
        else if (ev.t === 'mudou') cb.current.onFim?.()   // o canvas recarrega a cada mudança, sem esperar a resposta
        else if (ev.t === 'tela') cb.current.onTela?.(ev)
      })
    } catch (err) {
      mexe((u) => ({ ...u, erro: String(err) }))
    } finally {
      processando.current = false
      setOcupado(false)
      cb.current.onFim?.()
      const prox = filaRef.current[0]
      if (prox !== undefined) { setFila((f) => f.slice(1)); enviar(undefined, prox) }
    }
  }

  if (!aberto) return (
    <aside className="chat chat--fechado glass glass--light" aria-label="Chat do Jarvis (recolhido)">
      <button className="chat-abrir" onClick={onAlternar} title="Abrir o chat do Jarvis">
        <span className={`orb orb--p ${ocupado ? 'is-pensando' : ''}`} />
        <span className="chat-abrir-nome">JARVIS</span>
        <Icone n="painel" t={17} />
      </button>
    </aside>
  )

  return (
    <aside className="chat glass glass--light" aria-label="Chat do Jarvis">
      {alca}
      <header className="chat-cabeca">
        <span className="orb orb--p" />
        <span className="chat-nome">JARVIS</span>
        <span className="chat-status">{ocupado ? 'pensando…' : 'conectado'}{fila.length > 0 ? ` · ${fila.length} na fila` : ''}</span>
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
        {onAlternar && <button className="btn-icone chat-recolher" onClick={onAlternar} title="Recolher o chat" aria-label="Recolher o chat"><Icone n="painel" t={16} /></button>}
      </header>

      <div className="chat-log" ref={log} aria-live="polite">
        {msgs.length === 0 && (
          <div className="chat-vazio">
            <p>Pergunte sobre o radar, peça hooks ou um roteiro.</p>
            <p className="mudo">Clique no balão de um card para trazê-lo para cá.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg msg--${m.papel}`}>
            {m.papel === 'jarvis' && <span className="orb orb--msg" />}
            <div className="balao">
              {m.ferramentas && m.ferramentas.length > 0 && (
                <ul className="passos">{m.ferramentas.slice(-4).map((f, k) => <li key={k}>{f}</li>)}</ul>
              )}
              {m.texto ? <Texto md={m.texto} onSinal={onAbrirSinal ? (url) => onAbrirSinal({ url }) : undefined} /> : !m.erro && ocupado && i === msgs.length - 1 ? <span className="digitando"><i /><i /><i /></span> : null}
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
      {foco && (
        <div className="foco">
          <button className="foco-abrir" onClick={() => onAbrirSinal?.({ id: foco.id, url: foco.url, fonte: foco.fonte })} title="Abrir este sinal no Radar">
            <Fonte f={foco.fonte} />
            <span className="foco-titulo">{foco.titulo}</span>
          </button>
          <button className="btn-icone" aria-label="Tirar do contexto" onClick={limparFoco}><Icone n="fechar" t={14} /></button>
        </div>
      )}
      {trecho && (
        <div className="foco foco--trecho">
          <Icone n="nota" t={14} />
          <span className="foco-titulo" title={trecho.texto}>
            <b>{trecho.nome}</b> · {trecho.linhaIni === trecho.linhaFim ? `linha ${trecho.linhaIni}` : `linhas ${trecho.linhaIni}–${trecho.linhaFim}`}
            {trecho.texto && <em>“{trecho.texto.replace(/\s+/g, ' ').slice(0, 90)}{trecho.texto.length > 90 ? '…' : ''}”</em>}
          </span>
          <button className="btn-icone" aria-label="Tirar o trecho" onClick={limparTrecho}><Icone n="fechar" t={14} /></button>
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
      <form className="campo" onSubmit={enviar}
        onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) e.preventDefault() }}
        onDrop={(e) => { const f = [...e.dataTransfer.files]; if (f.some((x) => x.type.startsWith('image/'))) { e.preventDefault(); anexar(f) } }}>
        <textarea
          onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.some((x) => x.type.startsWith('image/'))) { e.preventDefault(); anexar(f) } }}
          ref={campo} rows={1} value={texto} placeholder={trecho ? 'O que fazer com esse trecho?' : 'Pergunte ao Jarvis…'} aria-label="Mensagem"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() }
            else if (e.key === 'd' && e.metaKey && e.shiftKey && temVoz) { e.preventDefault(); ditar() }   // ⌘⇧D liga/desliga o ditado
            else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur() }   // Esc sai do chat (volta aos atalhos da página)
          }}
        />
        {temVoz && (
          <button type="button" className={`btn-icone btn-ditar ${ouvindo ? 'is-ouvindo' : ''}`} onClick={ditar} aria-pressed={ouvindo}
            aria-label={ouvindo ? 'Parar o ditado' : 'Ditar'} title={ouvindo ? 'Ouvindo… clique para parar (⌘⇧D)' : 'Ditar a mensagem (⌘⇧D)'}>
            <svg className="i" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="2.5" width="6" height="10" rx="3" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" /></svg>
          </button>
        )}
        <button className="btn-enviar" type="submit" disabled={!texto.trim() && !imagens.length} aria-label={ocupado ? 'Colocar na fila' : 'Enviar'} title={ocupado ? 'O Jarvis está ocupado: entra na fila' : 'Enviar'}><Icone n="enviar" t={16} /></button>
      </form>
    </aside>
  )
}
