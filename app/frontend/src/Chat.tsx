import { descreverOnde } from './canvasApi'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Markdown } from './Markdown'
import type { Trecho } from './notas'
import { api, conversar, type Msg, type Sinal } from './api'
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

type Props = {
  foco: Sinal | null; limparFoco: () => void; aberto?: boolean; onAlternar?: () => void
  trecho?: Trecho | null; limparTrecho?: () => void
  pedido?: { texto: string; n: number }   // ação rápida do editor: manda sozinho
  onFim?: () => void                       // terminou de responder (a nota pode ter mudado)
  alca?: React.ReactNode                   // borda de arrastar para mudar a largura
  onAbrirSinal?: (a: { id?: number; url?: string | null; fonte?: string }) => void   // volta para o card do sinal no Radar
}

export function Chat({ foco, limparFoco, aberto = true, onAlternar, trecho = null, limparTrecho, pedido, onFim, alca, onAbrirSinal }: Props) {
  // modo construtor: o mesmo chat, mas o agente mexe no código do app (outra conversa, com desfazer)
  const [modo, setModo] = useState<'vault' | 'app'>(() => { try { return localStorage.getItem('chat-modo') === 'app' ? 'app' : 'vault' } catch { return 'vault' } })
  useEffect(() => { try { localStorage.setItem('chat-modo', modo) } catch { /* sem storage */ } }, [modo])
  const conversa = modo === 'app' ? 'construtor' : 'radar'
  const [pontos, setPontos] = useState(0)
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
  const [ocupado, setOcupado] = useState(false)
  const [fila, setFila] = useState<string[]>([])   // pedidos digitados enquanto o Jarvis ainda respondia o de cima
  const log = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)
  const cb = useRef({ trecho, limparTrecho, onFim, foco })
  cb.current = { trecho, limparTrecho, onFim, foco }
  const filaRef = useRef<string[]>(fila)
  filaRef.current = fila
  const processando = useRef(false)   // trava de verdade (ocupado é só pra UI; estado React é tarde demais pro encadeamento)
  const sinalEnviado = useRef<number | null>(null)   // o mesmo sinal não é repetido a cada mensagem

  useEffect(() => { api.historico(conversa).then((h) => setMsgs(h)).catch(() => {}) }, [conversa])
  const lerPontos = () => fetch('/api/construtor').then((r) => r.json()).then((d) => setPontos(d.pontos)).catch(() => {})
  useEffect(() => { if (modo === 'app') lerPontos() }, [modo])
  async function desfazer() {
    const r = await fetch('/api/construtor/desfazer', { method: 'POST' })
    const d = await r.json().catch(() => ({}))
    setMsgs((m) => [...m, { papel: 'jarvis', texto: r.ok ? `↩︎ Desfeito: “${d.desfeito}”. O app voltou ao ponto de antes desse pedido.` : '', erro: r.ok ? undefined : d.detail || 'Não consegui desfazer.' }])
    lerPontos()
  }
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }) }, [msgs])

  useEffect(() => { if (trecho || foco) campo.current?.focus() }, [trecho, foco])
  useEffect(() => { if (pedido?.n) enviar(undefined, pedido.texto) }, [pedido?.n])  // eslint-disable-line react-hooks/exhaustive-deps

  async function enviar(e?: React.FormEvent, direto?: string) {
    e?.preventDefault()
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
      await conversar({ conversa, texto: t, sinal: foco?.id ?? null, modo, onde: descreverOnde() }, (ev) => {
        if (ev.t === 'texto') mexe((u) => ({ ...u, texto: u.texto + ev.v }))
        else if (ev.t === 'ferramenta') mexe((u) => ({ ...u, ferramentas: [...(u.ferramentas ?? []), `${VERBO[ev.nome] ?? ev.nome} ${ev.alvo}`.trim()] }))
        else if (ev.t === 'erro') mexe((u) => ({ ...u, erro: ev.v }))
      })
    } catch (err) {
      mexe((u) => ({ ...u, erro: String(err) }))
    } finally {
      processando.current = false
      setOcupado(false)
      cb.current.onFim?.()
      if (modo === 'app') lerPontos()
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
    <aside className={`chat glass glass--light ${modo === 'app' ? 'is-construtor' : ''}`} aria-label="Chat do Jarvis">
      {alca}
      <header className="chat-cabeca">
        <span className="orb orb--p" />
        <span className="chat-nome">JARVIS</span>
        <span className="chat-status">{ocupado ? 'pensando…' : modo === 'app' ? 'mexendo no app' : 'vault conectado'}{fila.length > 0 ? ` · ${fila.length} na fila` : ''}</span>
        <button className={`btn-icone ${modo === 'app' ? 'is-on' : ''}`} disabled={ocupado} onClick={() => setModo((m) => (m === 'app' ? 'vault' : 'app'))}
          title={modo === 'app' ? 'Sair do modo construtor (voltar ao vault)' : 'Modo construtor: pedir mudanças no próprio app'} aria-pressed={modo === 'app'}><Icone n="ferramenta" t={16} /></button>
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

      {modo === 'app' && (
        <div className="chat-construtor">
          <span>🛠 Modo construtor: os pedidos mudam o código do app.</span>
          {pontos > 0 && !ocupado && <button onClick={desfazer} title="Volta o app para antes do último pedido">↩︎ Desfazer última mudança</button>}
        </div>
      )}
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
      <form className="campo" onSubmit={enviar}
        onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) e.preventDefault() }}
        onDrop={(e) => { const f = [...e.dataTransfer.files]; if (f.some((x) => x.type.startsWith('image/'))) { e.preventDefault(); anexar(f) } }}>
        <textarea
          onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.some((x) => x.type.startsWith('image/'))) { e.preventDefault(); anexar(f) } }}
          ref={campo} rows={1} value={texto} placeholder={modo === 'app' ? 'O que mudar no app?' : trecho ? 'O que fazer com esse trecho?' : 'Pergunte ao Jarvis…'} aria-label="Mensagem"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() }
            else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur() }   // Esc sai do chat (volta aos atalhos da página)
          }}
        />
        <button className="btn-enviar" type="submit" disabled={!texto.trim() && !imagens.length} aria-label={ocupado ? 'Colocar na fila' : 'Enviar'} title={ocupado ? 'O Jarvis está ocupado: entra na fila' : 'Enviar'}><Icone n="enviar" t={16} /></button>
      </form>
    </aside>
  )
}
