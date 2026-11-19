import { useEffect, useState } from 'react'

import { EscolherIdeia } from './EscolherIdeia'
import { ehDivisor, listaCategorias } from './Categorias'
import { tudoEmCache } from './canvasApi'

/** Criação rápida de qualquer página: ⌘⇧I = 💡 nova ideia, ⌘⇧N = 🎬 nova produção (uma copy em Priorizar, Reels por padrão).
 *  A copy nasce em 1 Copies/1 Priorizar (não há mais canvas).
 *  O que nasce aqui ganha o selo NOVO no card. */
export type TipoNovo = 'ideia' | 'producao'

const FORMATOS: [string, string][] = [['📱', 'Reels'], ['💰', 'Ad'], ['🏞️', 'Carrossel'], ['📺', 'VSL'], ['🎥', 'YouTube'], ['🗣️', 'Stories']]
/** Ícone mostrado na janela quando difere do emoji do nome do arquivo (o carrossel aparece com 📝; o arquivo segue com 🏞️, a convenção do vault). */
const ICONE: Record<string, string> = { '🏞️': '📝' }
const icone = (f: string) => ICONE[f] ?? f

export type Criado = { raiz: string; nome: string; tipo: TipoNovo; formato?: string }

export function NovoRapido({ tipo: tipoInicial, onFechar, onCriado, alternar, ligar }: {
  tipo: TipoNovo
  onFechar: () => void
  onCriado: (canvas: string, msg: string, nota: Criado) => void
  alternar?: boolean                  // mostra a escolha 💡 Ideia | 🎬 Copy (flecha solta no vazio)
  ligar?: { ideia?: string; fonte?: string; de?: string }   // a copy nasce na ideia; a ideia nasce com a entrada como fonte
}) {
  const [tipo, setTipo] = useState<TipoNovo>(tipoInicial)
  const [titulo, setTitulo] = useState('')
  const [formato, setFormato] = useState(() => { try { const f = localStorage.getItem('novo-formato'); return f && FORMATOS.some(([x]) => x === f) ? f : '📱' } catch { return '📱' } })
  const canvas = 'inbox'
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)
  // 💡: criar uma ideia nova ou plugar o texto/link numa que já existe (vira entrada na seção Entradas dela)
  const [plugar, setPlugar] = useState(false)
  const [alvo, setAlvo] = useState<string | null>(null)

  useEffect(() => { try { localStorage.setItem('novo-formato', formato) } catch { /* sem storage */ } }, [formato])
  // categoria da copy nova: começa na escolhida no menu da Redação (se for uma só) ou na última usada aqui
  const [cats, setCats] = useState<string[]>(() => listaCategorias(tudoEmCache()?.producoes ?? [], []))
  useEffect(() => {
    fetch('/api/criacao', { cache: 'no-store' }).then((r) => r.json())
      .then((c) => setCats(listaCategorias(tudoEmCache()?.producoes ?? [], c.categorias ?? []).filter((x) => !(c.arquivadas ?? []).includes(x)))).catch(() => {})   // os divisores separam os grupos
  }, [])
  const [categoria, setCategoria] = useState<string>(() => {
    try {
      const sel = JSON.parse(localStorage.getItem('tabela-estado') || '{}')?.ideias?.t?.filtros?.categoria as string[] | undefined
      return sel?.length === 1 && sel[0] && !sel[0].startsWith('\u0000') ? sel[0] : localStorage.getItem('novo-categoria') ?? ''
    } catch { return '' }
  })
  useEffect(() => { try { localStorage.setItem('novo-categoria', categoria) } catch { /* sem storage */ } }, [categoria])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    const t = titulo.trim()
    if (!t || indo) return
    setIndo(true); setErro('')
    const cab = { 'Content-Type': 'application/json' }
    try {
      if (tipo === 'ideia' && plugar) {
        if (!alvo) throw new Error('Escolha a copy onde isso entra.')
        const r = await fetch('/api/copies/entrada', { method: 'POST', headers: cab, body: JSON.stringify({ conteudo: t, ideia: alvo }) })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.detail || 'Não consegui plugar na copy.')
        onCriado(canvas, `Entrou em ${alvo}`, { raiz: d.raiz || 'priorizar', nome: alvo, tipo })
        return
      }
      const r = tipo === 'ideia'
        ? await fetch(/https?:\/\//.test(t) || t.length > 90 ? '/api/copies/entrada' : '/api/copies/ideia', { method: 'POST', headers: cab, body: JSON.stringify({ titulo: t, conteudo: t }) })
        : await fetch('/api/notas/priorizar', { method: 'POST', headers: cab, body: JSON.stringify({ titulo: `${formato} ${t}` }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(r.status === 409 ? 'Já existe uma nota com esse nome.' : d.detail || 'Não consegui criar.')
      if (tipo === 'producao' && categoria && d.nome)   // a categoria vai no frontmatter (categoria:)
        await fetch('/api/copies/categoria', { method: 'POST', headers: cab, body: JSON.stringify({ nomes: [d.nome], categoria }) }).catch(() => {})
      onCriado(canvas, `${tipo === 'ideia' ? '📄 Copy criada' : `${icone(formato)} Criação criada`}`,
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
            {([['ideia', '🔗 Link ou texto'], ['producao', '🎬 Copy']] as const).map(([k, nome]) => (
              <button key={k} type="button" role="radio" aria-checked={k === tipo} className={k === tipo ? 'is-on' : ''} onClick={() => setTipo(k)}>{nome}</button>
            ))}
          </div>
        )}
        <label className="paleta-campo">
          <span className="novo-rapido-emoji">{tipo === 'ideia' ? '🔗' : icone(formato)}</span>
          <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={tipo === 'ideia' ? (plugar ? 'Link ou texto para a copy…' : 'Nome, link ou texto da copy nova…') : ligar?.ideia ? 'Nova copy desta ideia…' : 'Nova criação…'} />
        </label>
        {tipo === 'ideia' && (
          <div className="novo-rapido-opcoes" role="radiogroup" aria-label="Onde">
            {([[false, 'Copy nova'], [true, 'Plugar numa copy']] as const).map(([k, nome]) => (
              <button key={nome} type="button" role="radio" aria-checked={k === plugar} className={k === plugar ? 'is-on' : ''} onClick={() => setPlugar(k)}>{nome}</button>
            ))}
            {plugar && alvo && <span className="novo-rapido-rotulo">em {alvo}</span>}
          </div>
        )}
        {tipo === 'ideia' && plugar && <EscolherIdeia onEscolher={setAlvo} placeholder="Em qual copy isso entra?" />}
        {tipo === 'producao' && (
          <div className="novo-secao">
            <span className="novo-secao-t">Formato</span>
            <div className="novo-rapido-opcoes" role="radiogroup" aria-label="Formato">
              {FORMATOS.map(([f, nome]) => (
                <button key={f} type="button" role="radio" aria-checked={f === formato} className={f === formato ? 'is-on' : ''} onClick={() => setFormato(f)}>{icone(f)} {nome}</button>
              ))}
            </div>
          </div>
        )}
        {tipo === 'producao' && cats.some((c) => !ehDivisor(c)) && (
          <div className="novo-secao">
            <span className="novo-secao-t">Categoria</span>
            <div className="novo-rapido-opcoes novo-rapido-cats" role="radiogroup" aria-label="Categoria">
              {cats.map((c, i) => ehDivisor(c) ? (i > 0 && i < cats.length - 1 ? <span key={c} className="novo-cats-sep" aria-hidden="true" /> : null) : (
                <button key={c} type="button" role="radio" aria-checked={c === categoria} className={c === categoria ? 'is-on' : ''} onClick={() => setCategoria(c === categoria ? '' : c)}>{c}</button>
              ))}
            </div>
          </div>
        )}
        {erro && <p className="novo-rapido-erro">{erro}</p>}
        <footer className="paleta-pe"><span><kbd>↵</kbd> criar e abrir</span><span><kbd>esc</kbd> fechar</span></footer>
      </form>
    </div>
  )
}
