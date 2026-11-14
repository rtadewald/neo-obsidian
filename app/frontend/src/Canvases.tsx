import { useEffect, useState } from 'react'
import { listarCanvases, type ResumoCanvas } from './canvasApi'

/** Página de controle dos canvas (como a home de projetos do Neo Stitch): cada canvas é isolado, com o seu layout.
 *  "Geral" mostra todas as notas; os de produto mostram só as copies com a tag deles (🤖fia, 🖼️fid…). */
let ultimaLista: ResumoCanvas[] | null = null
/** Busca a lista já ao abrir o app: o clique em NEO-OBSIDIAN mostra a página na hora. */
export const preCarregarCanvases = () => { listarCanvases().then((l) => { ultimaLista = l }).catch(() => {}) }

export function Canvases({ onAbrir }: { onAbrir: (slug: string) => void }) {
  // mostra na hora a última lista conhecida e atualiza por trás (as contagens leem o vault inteiro)
  const [lista, setLista] = useState<ResumoCanvas[] | null>(ultimaLista)
  const [novo, setNovo] = useState(false)
  const [erro, setErro] = useState('')
  const carregar = () => listarCanvases().then((l) => { ultimaLista = l; setLista(l) }).catch(() => setErro('Não consegui ler os canvas.'))
  useEffect(() => { carregar() }, [])

  async function criar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const corpo = {
      nome: String(f.get('nome') || '').trim(), icone: String(f.get('icone') || '').trim() || '🗂️',
      tags: String(f.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean),
    }
    const r = await fetch('/api/canvases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setErro(d.detail || 'Não deu certo.'); return }
    setNovo(false); setErro(''); onAbrir(d.slug)
  }

  return (
    <div className="canvases">
      <header className="canvases-topo">
        <h1>Canvas</h1>
        <p className="mudo">Cada canvas tem as suas caixas e posições. Os de produto mostram só as copies com a tag deles.</p>
      </header>
      {erro && <p className="canvases-erro">{erro}</p>}
      <div className="canvases-grade">
        {lista?.map((c) => (
          <button key={c.slug} type="button" className="canvases-card glass glass--light" onClick={() => onAbrir(c.slug)} title={`Abrir o canvas ${c.nome}`}>
            <span className="canvases-icone">{c.icone}</span>
            <span className="canvases-nome">{c.nome}</span>
            <span className="canvases-numeros">
              <span><b>{c.producoes}</b> produções</span><span><b>{c.vsls}</b> VSLs</span><span><b>{c.ideias}</b> ideias</span><span><b>{c.caixas}</b> caixas</span>
            </span>
            <span className="canvases-tags">{c.tags.length ? c.tags.map((t) => <i key={t}>{t}</i>) : <em>todas as notas</em>}</span>
          </button>
        ))}
        {lista && !novo && (
          <button type="button" className="canvases-card canvases-novo" onClick={() => setNovo(true)}>
            <span className="canvases-icone">＋</span><span className="canvases-nome">Novo canvas</span>
          </button>
        )}
        {novo && (
          <form className="canvases-card canvases-form glass glass--light" onSubmit={criar}>
            <div className="canvases-linha">
              <input name="icone" className="canvases-campo canvases-campo--icone" placeholder="🗂️" maxLength={4} aria-label="Ícone" />
              <input name="nome" className="canvases-campo" placeholder="Nome (ex.: AI Designer)" autoFocus required aria-label="Nome" />
            </div>
            <input name="tags" className="canvases-campo" placeholder="Tags que ele mostra, separadas por vírgula (ex.: 🖼️fid)" aria-label="Tags" />
            <p className="mudo">Sem tag, o canvas mostra todas as notas. Nota criada nele já nasce com a primeira tag.</p>
            <div className="canvases-linha">
              <button type="button" className="pilula" onClick={() => setNovo(false)}>Cancelar</button>
              <button type="submit" className="pilula pilula--escura">Criar</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
