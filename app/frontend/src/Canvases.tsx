import { useEffect, useState } from 'react'
import { INBOX, listarCanvases, type Produto, type ResumoCanvas } from './canvasApi'

/** Página inicial: os canvas (onde as notas vivem: o `grupo:` delas) e o 📥 Inbox (as notas sem canvas).
 *  Cada card mostra quantas copies de cada produto (FIA, FID…) vivem ali: produto é filtro, não lugar. */
let ultimaLista: ResumoCanvas[] | null = null
let ultimosProdutos: Produto[] = []
/** Busca a lista já ao abrir o app: o clique em NEO-OBSIDIAN mostra a página na hora. */
export const preCarregarCanvases = () => {
  listarCanvases().then((l) => { ultimaLista = l }).catch(() => {})
  fetch('/api/produtos').then((r) => r.json()).then((p) => { ultimosProdutos = p }).catch(() => {})
}

async function salvar(corpo: Record<string, string>) {
  const r = await fetch('/api/canvases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || 'Não deu certo.')
  return d as ResumoCanvas
}

export function Canvases({ onAbrir }: { onAbrir: (slug: string) => void }) {
  // mostra na hora a última lista conhecida e atualiza por trás (as contagens leem o vault inteiro)
  const [lista, setLista] = useState<ResumoCanvas[] | null>(ultimaLista)
  const [produtos, setProdutos] = useState<Produto[]>(ultimosProdutos)
  const [novo, setNovo] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)   // slug do canvas sendo renomeado
  const [apagando, setApagando] = useState<string | null>(null)   // slug esperando a confirmação
  const [erro, setErro] = useState('')
  const carregar = () => listarCanvases().then((l) => { ultimaLista = l; setLista(l) }).catch(() => setErro('Não consegui ler os canvas.'))
  useEffect(() => {
    carregar()
    fetch('/api/produtos').then((r) => r.json()).then((p) => { ultimosProdutos = p; setProdutos(p) }).catch(() => {})
  }, [])

  async function criar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      const d = await salvar({ nome: String(f.get('nome') || '').trim(), icone: String(f.get('icone') || '').trim() || '🗂️' })
      setNovo(false); setErro(''); onAbrir(d.slug)
    } catch (x) { setErro((x as Error).message) }
  }
  async function renomear(c: ResumoCanvas, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      await salvar({ slug: c.slug, nome: String(f.get('nome') || '').trim(), icone: String(f.get('icone') || '').trim() })
      setEditando(null); setErro(''); carregar()
    } catch (x) { setErro((x as Error).message) }
  }
  async function apagar(c: ResumoCanvas) {
    const r = await fetch(`/api/canvases/${c.slug}`, { method: 'DELETE' })
    if (!r.ok) { setErro((await r.json().catch(() => ({}))).detail || 'Não deu para apagar.'); return }
    setApagando(null); setErro(''); carregar()
  }

  return (
    <div className="canvases">
      <header className="canvases-topo">
        <h1>Canvas</h1>
        <p className="mudo">Cada nota vive num canvas (a propriedade grupo). Produto (FIA, FID…) é filtro dentro do canvas.</p>
      </header>
      {erro && <p className="canvases-erro">{erro}</p>}
      <div className="canvases-grade">
        {lista?.map((c) => editando === c.slug ? (
          <form key={c.slug} className="canvases-card canvases-form glass glass--light" onSubmit={(e) => renomear(c, e)}>
            <div className="canvases-linha">
              <input name="icone" className="canvases-campo canvases-campo--icone" defaultValue={c.icone} maxLength={4} aria-label="Ícone" />
              <input name="nome" className="canvases-campo" defaultValue={c.nome} autoFocus required aria-label="Nome" />
            </div>
            <p className="mudo">As notas deste canvas mudam o grupo junto.</p>
            <div className="canvases-linha">
              <button type="button" className="pilula" onClick={() => setEditando(null)}>Cancelar</button>
              <button type="submit" className="pilula pilula--escura">Salvar</button>
            </div>
          </form>
        ) : (
          <div key={c.slug} className="canvases-item">
            <button type="button" className={`canvases-card glass glass--light ${c.slug === INBOX ? 'is-inbox' : ''}`} onClick={() => onAbrir(c.slug)} title={`Abrir o canvas ${c.nome}`}
              style={{ '--cor': c.cor } as React.CSSProperties}>
              <span className="canvases-icone">{c.icone}</span>
              <span className="canvases-nome">{c.nome}</span>
              <span className="canvases-numeros">
                <span><b>{c.producoes}</b> produções</span><span><b>{c.vsls}</b> VSLs</span><span><b>{c.ideias}</b> ideias</span>
              </span>
              <span className="canvases-tags">
                {produtos.filter((p) => c.produtos?.[p.slug]).map((p) => <i key={p.slug} title={`${c.produtos[p.slug]} copies de ${p.nome}`}><b style={{ background: p.cor }} />{p.nome} {c.produtos[p.slug]}</i>)}
                {c.slug === INBOX && <em>notas sem canvas</em>}
              </span>
            </button>
            {c.slug !== INBOX && (apagando === c.slug ? (
              <div className="canvases-acoes is-confirmar">
                <span>As notas voltam para o Inbox.</span>
                <button type="button" className="pilula" onClick={() => setApagando(null)}>Cancelar</button>
                <button type="button" className="pilula is-perigo" onClick={() => apagar(c)}>Apagar</button>
              </div>
            ) : (
              <div className="canvases-acoes">
                <button type="button" className="pilula" onClick={() => setEditando(c.slug)}>Renomear</button>
                <button type="button" className="pilula" onClick={() => setApagando(c.slug)}>Apagar</button>
              </div>
            ))}
          </div>
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
              <input name="nome" className="canvases-campo" placeholder="Nome (ex.: Hacks e Dicas)" autoFocus required aria-label="Nome" />
            </div>
            <p className="mudo">Nota criada dentro dele já nasce com o grupo dele.</p>
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
