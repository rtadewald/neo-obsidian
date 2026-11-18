import { useEffect, useState } from 'react'
import { INBOX, listarCanvases, type ResumoCanvas } from './canvasApi'
import { EscolherIdeia } from './EscolherIdeia'

/** Criação rápida de qualquer página: ⌘⇧I = 💡 nova ideia, ⌘⇧N = 🎬 nova produção (uma copy em Priorizar, Reels por padrão).
 *  Dentro de um canvas, vai para ele; nas outras páginas, um seletor escolhe o canvas (começa no último aberto).
 *  O que nasce aqui ganha o selo NOVO no card. */
export type TipoNovo = 'ideia' | 'producao'

const FORMATOS: [string, string][] = [['📱', 'Reels'], ['💰', 'Ad'], ['🏞️', 'Carrossel'], ['📺', 'VSL'], ['🎥', 'YouTube'], ['🗣️', 'Stories']]
/** Ícone mostrado na janela quando difere do emoji do nome do arquivo (o carrossel aparece com 📝; o arquivo segue com 🏞️, a convenção do vault). */
const ICONE: Record<string, string> = { '🏞️': '📝' }
const icone = (f: string) => ICONE[f] ?? f

export type Criado = { raiz: string; nome: string; tipo: TipoNovo; formato?: string }

export function NovoRapido({ tipo: tipoInicial, canvasAtual, comSeletor, onFechar, onCriado, alternar, ligar, pos }: {
  tipo: TipoNovo
  canvasAtual: string | null          // o canvas aberto (ou o último), usado direto ou como padrão do seletor
  comSeletor: boolean                 // fora de um canvas: mostra o seletor
  onFechar: () => void
  onCriado: (canvas: string, msg: string, nota: Criado) => void
  alternar?: boolean                  // mostra a escolha 💡 Ideia | 🎬 Copy (flecha solta no vazio)
  ligar?: { ideia?: string; fonte?: string; de?: string }   // a copy nasce na ideia; a ideia nasce com a entrada como fonte
  pos?: { x: number; y: number }      // onde o card da ideia nasce no canvas
}) {
  const [tipo, setTipo] = useState<TipoNovo>(tipoInicial)
  const [titulo, setTitulo] = useState('')
  const [formato, setFormato] = useState(() => { try { const f = localStorage.getItem('novo-formato'); return f && FORMATOS.some(([x]) => x === f) ? f : '📱' } catch { return '📱' } })
  const [canvases, setCanvases] = useState<ResumoCanvas[]>([])
  const [canvas, setCanvas] = useState(canvasAtual ?? INBOX)
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  // 💡: criar uma ideia nova ou plugar o texto/link numa que já existe (vira entrada na seção Entradas dela)
  const [plugar, setPlugar] = useState(false)
  const [alvo, setAlvo] = useState<string | null>(null)

  useEffect(() => {
    if (!comSeletor) return
    listarCanvases().then((l) => {
      const ativos = l.filter((c) => !c.arquivado && c.slug !== INBOX)   // o Inbox não é destino
      setCanvases(ativos)
      if (!ativos.some((c) => c.slug === canvas)) setCanvas(ativos.find((c) => c.slug !== INBOX)?.slug ?? INBOX)
    }).catch(() => {})
  }, [comSeletor])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem('novo-formato', formato) } catch { /* sem storage */ } }, [formato])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    const t = titulo.trim()
    if (!t || indo) return
    setIndo(true); setErro('')
    const cab = { 'Content-Type': 'application/json', 'X-Canvas': canvas }
    try {
      if (tipo === 'ideia' && plugar) {
        if (!alvo) throw new Error('Escolha a ideia onde isso entra.')
        const r = await fetch('/api/canvas/entrada', { method: 'POST', headers: cab, body: JSON.stringify({ conteudo: t, ideia: alvo }) })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.detail || 'Não consegui plugar na ideia.')
        onCriado(canvas, `Entrou em ${alvo}`, { raiz: 'ideias', nome: alvo, tipo })
        return
      }
      const r = tipo === 'ideia'
        ? await fetch('/api/canvas/ideia', { method: 'POST', headers: cab, body: JSON.stringify({ titulo: t, ...(pos ? { pos } : {}) }) })
        : ligar?.ideia
          ? await fetch('/api/canvas/saida', { method: 'POST', headers: cab, body: JSON.stringify({ ideia: ligar.ideia, formato, titulo: `${formato} ${t}` }) })
          : await fetch('/api/notas/priorizar', { method: 'POST', headers: cab, body: JSON.stringify({ titulo: `${formato} ${t}` }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(r.status === 409 ? 'Já existe uma nota com esse nome.' : d.detail || 'Não consegui criar.')
      if (tipo === 'ideia' && ligar?.fonte)   // a entrada de onde a flecha saiu vira fonte da ideia nova
        await fetch('/api/canvas/fonte', { method: 'POST', headers: cab, body: JSON.stringify({ ideia: d.nome, entrada: ligar.fonte }) }).catch(() => {})
      const nomeCanvas = canvases.find((c) => c.slug === canvas)?.nome
      onCriado(canvas, `${tipo === 'ideia' ? '💡 Ideia criada' : `${icone(formato)} Criação criada`}${comSeletor && nomeCanvas ? ` em ${nomeCanvas}` : ''}`,
        { raiz: d.raiz, nome: d.nome, tipo, formato: tipo === 'producao' ? formato : undefined })
    } catch (x) { setErro((x as Error).message); setIndo(false) }
  }

  return (
    <div className="paleta-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <form className="paleta novo-rapido glass glass--light" role="dialog" aria-label={tipo === 'ideia' ? 'Nova ideia' : 'Nova criação'} onSubmit={criar}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onFechar() } }}>
        {alternar && (
          <div className="novo-rapido-opcoes" role="radiogroup" aria-label="Criar">
            {ligar?.de && <span className="novo-rapido-rotulo">de {ligar.de}</span>}
            {([['ideia', '💡 Ideia'], ['producao', '🎬 Copy']] as const).map(([k, nome]) => (
              <button key={k} type="button" role="radio" aria-checked={k === tipo} className={k === tipo ? 'is-on' : ''} onClick={() => setTipo(k)}>{nome}</button>
            ))}
          </div>
        )}
        <label className="paleta-campo">
          <span className="novo-rapido-emoji">{tipo === 'ideia' ? '💡' : icone(formato)}</span>
          <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={tipo === 'ideia' ? (plugar ? 'Link ou texto para a ideia…' : 'Nova ideia…') : ligar?.ideia ? 'Nova copy desta ideia…' : 'Nova criação…'} />
        </label>
        {tipo === 'ideia' && (
          <div className="novo-rapido-opcoes" role="radiogroup" aria-label="Onde">
            {([[false, 'Nova ideia'], [true, 'Plugar numa ideia']] as const).map(([k, nome]) => (
              <button key={nome} type="button" role="radio" aria-checked={k === plugar} className={k === plugar ? 'is-on' : ''} onClick={() => setPlugar(k)}>{nome}</button>
            ))}
            {plugar && alvo && <span className="novo-rapido-rotulo">em {alvo}</span>}
          </div>
        )}
        {tipo === 'ideia' && plugar && <EscolherIdeia onEscolher={setAlvo} placeholder="Em qual ideia isso entra?" />}
        {tipo === 'producao' && (
          <div className="novo-rapido-opcoes" role="radiogroup" aria-label="Formato">
            {FORMATOS.map(([f, nome]) => (
              <button key={f} type="button" role="radio" aria-checked={f === formato} className={f === formato ? 'is-on' : ''} onClick={() => setFormato(f)}>{icone(f)} {nome}</button>
            ))}
          </div>
        )}
        {comSeletor && (
          <div className="novo-rapido-opcoes" role="radiogroup" aria-label="Canvas">
            <span className="novo-rapido-rotulo">Canvas</span>
            {canvases.map((c) => (
              <button key={c.slug} type="button" role="radio" aria-checked={c.slug === canvas} className={c.slug === canvas ? 'is-on' : ''} onClick={() => setCanvas(c.slug)}>
                {c.icone !== '🗂️' ? `${c.icone} ` : ''}{c.nome}</button>
            ))}
          </div>
        )}
        {erro && <p className="novo-rapido-erro">{erro}</p>}
        <footer className="paleta-pe"><span><kbd>↵</kbd> criar e abrir</span><span><kbd>esc</kbd> fechar</span></footer>
      </form>
    </div>
  )
}
