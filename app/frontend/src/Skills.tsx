import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icone } from './Icone'
import { PainelNota } from './PainelNota'
import type { Alvo } from './canvasApi'

/** Editor de skills: as pastas de `3 Skills` à esquerda (cada skill com os arquivos de apoio dela), o texto no meio
 *  O editor é o mesmo da nota: salva sozinho. */
type Skill = { nome: string; descricao: string; categoria: string; mtime: number; arquivos: string[] }
/** Ordem das categorias na lista (as outras vêm depois, em ordem alfabética). */
const ORDEM_CAT = ['Copywriting', 'Pesquisa', 'Operações']

const ler = (k: string, padrao: string) => { try { return localStorage.getItem(k) ?? padrao } catch { return padrao } }
const gravar = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sem storage */ } }
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function Skills({ versao, onAbrirNota }: {
  versao?: number
  onAbrirNota?: (a: Alvo) => void   // [[link]] para uma nota fora das skills abre no modal
}) {
  const [lista, setLista] = useState<Skill[] | null>(null)
  const [aberta, setAberta] = useState<string>(() => ler('skill-aberta', ''))   // "viral-hooks" (SKILL.md) ou "viral-hooks/references/x.md"
  const [abertas, setAbertas] = useState<Set<string>>(() => new Set(JSON.parse(ler('skills-pastas', '[]')) as string[]))
  const [busca, setBusca] = useState('')
  const [nova, setNova] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const avisar = (m: string) => { setAviso(m); window.setTimeout(() => setAviso((a) => (a === m ? null : a)), 2600) }

  const carregar = useCallback(() => fetch('/api/skills').then((r) => r.json()).then((l: Skill[]) => { setLista(l); return l }), [])
  useEffect(() => { carregar().then((l) => { if (!l.length) return; setAberta((a) => (a && l.some((s) => a === s.nome || a.startsWith(`${s.nome}/`)) ? a : l[0].nome)) }).catch(() => setLista([])) }, [carregar])
  useEffect(() => { if (aberta) gravar('skill-aberta', aberta) }, [aberta])
  useEffect(() => { gravar('skills-pastas', JSON.stringify([...abertas])) }, [abertas])
  // a skill aberta mostra os arquivos dela
  useEffect(() => { const s = aberta.split('/')[0]; if (s) setAbertas((x) => (x.has(s) ? x : new Set([...x, s]))) }, [aberta])

  const alternar = (s: string) => setAbertas((x) => { const n = new Set(x); if (n.has(s)) n.delete(s); else n.add(s); return n })

  const filtradas = useMemo(() => {
    const q = semAcento(busca.trim())
    if (!lista || !q) return lista ?? []
    return lista.filter((s) => semAcento(`${s.nome} ${s.descricao} ${s.categoria} ${s.arquivos.join(' ')}`).includes(q))
  }, [lista, busca])
  // agrupadas pela categoria do frontmatter (`category:`)
  const grupos = useMemo(() => {
    const m = new Map<string, Skill[]>()
    for (const s of filtradas) m.set(s.categoria, [...(m.get(s.categoria) ?? []), s])
    const pos = (c: string) => { const i = ORDEM_CAT.indexOf(c); return i < 0 ? ORDEM_CAT.length : i }
    return [...m.entries()].sort(([a], [b]) => pos(a) - pos(b) || a.localeCompare(b))
  }, [filtradas])
  const [catFechadas, setCatFechadas] = useState<Set<string>>(() => new Set(JSON.parse(ler('skills-cat-fechadas', '[]')) as string[]))
  useEffect(() => { gravar('skills-cat-fechadas', JSON.stringify([...catFechadas])) }, [catFechadas])
  const alternarCat = (c: string) => setCatFechadas((x) => { const n = new Set(x); if (n.has(c)) n.delete(c); else n.add(c); return n })
  // ⌘B esconde e mostra a lista da esquerda (no editor, ⌘B continua sendo negrito)
  const [lado, setLado] = useState(() => ler('skills-lado', 'aberto') !== 'fechado')
  useEffect(() => { gravar('skills-lado', lado ? 'aberto' : 'fechado') }, [lado])
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'b') return
      if ((e.target as HTMLElement)?.closest?.('.cm-editor, input, textarea')) return
      e.preventDefault(); setLado((v) => !v)
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  async function criar(nome: string) {
    setNova(null)
    if (!nome.trim()) return
    const r = await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { avisar(d.detail || 'Não consegui criar a skill.'); return }
    await carregar()
    setAberta(d.nome)
    avisar(`Skill ${d.nome} criada em 3 Skills`)
  }

  // [[link]] no texto: outro arquivo de skill abre aqui; uma nota do vault abre no modal
  const abrirLink = (nome: string) => {
    const n = nome.replace(/\.md$/, '')
    const skill = lista?.find((s) => s.nome === n || s.nome === n.split('/')[0])
    const arquivo = lista?.flatMap((s) => s.arquivos).find((a) => a.replace(/\.md$/, '').endsWith(n))
    if (arquivo) setAberta(arquivo)
    else if (skill) setAberta(skill.nome)
    else onAbrirNota?.({ raiz: 'priorizar', nome: n })
  }

  return (
    <div className={`skills ${lado ? '' : 'is-sem-lado'}`}>
      {lado && <aside className="skills-lista glass glass--light" aria-label="Skills">
        <header className="skills-cabeca">
          <h1>Skills</h1>
          {lista && <span className="mudo">{lista.length}</span>}
          <button className="btn-icone skills-esconder" onClick={() => setLado(false)} title="Esconder a lista (⌘B)" aria-label="Esconder a lista"><Icone n="painel" t={15} /></button>
          <button className="btn-icone" onClick={() => setNova('')} title="Nova skill (cria a pasta em 3 Skills com um SKILL.md)" aria-label="Nova skill"><Icone n="mais" t={16} /></button>
        </header>
        {nova !== null && (
          <form className="skills-nova" onSubmit={(e) => { e.preventDefault(); criar(nova) }}>
            <input autoFocus value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nome da skill" aria-label="Nome da nova skill"
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNova(null) } }} onBlur={() => !nova.trim() && setNova(null)} />
          </form>
        )}
        <label className="skills-busca">
          <Icone n="busca" t={14} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar skill ou arquivo…" aria-label="Buscar skill" />
        </label>
        <nav className="skills-arvore">
          {!lista && <p className="mudo skills-vazio">Carregando…</p>}
          {lista && !filtradas.length && <p className="mudo skills-vazio">Nenhuma skill com “{busca}”.</p>}
          {grupos.map(([cat, itens]) => {
            const fechada = catFechadas.has(cat) && !busca.trim()
            return (
              <section key={cat} className="skills-cat">
                <button className={`skills-cat-nome ${fechada ? '' : 'is-aberta'}`} onClick={() => alternarCat(cat)}>
                  <span className="skills-cat-seta">›</span>{cat}<em>{itens.length}</em></button>
                {!fechada && <div className="skills-cat-itens">
                  {itens.map((s) => {
                const aberto = abertas.has(s.nome) || !!busca.trim()
                return (
                  <div key={s.nome} className="skills-item">
                    <div className={`skills-pasta ${aberta === s.nome ? 'is-on' : ''}`}>
                      <button className={`skills-seta ${s.arquivos.length ? '' : 'is-vazia'} ${aberto ? 'is-aberta' : ''}`} onClick={() => alternar(s.nome)}
                        aria-label={aberto ? 'Recolher' : 'Mostrar os arquivos'} tabIndex={s.arquivos.length ? 0 : -1}>›</button>
                      <button className="skills-nome" onClick={() => setAberta(s.nome)} title={s.descricao}>
                        <b>{s.nome}</b>
                      </button>
                    </div>
                    {aberto && s.arquivos.length > 0 && (
                      <div className="skills-arquivos">
                        {s.arquivos.map((a) => (
                          <button key={a} className={aberta === a ? 'is-on' : ''} onClick={() => setAberta(a)} title={a}>
                            <Icone n="nota" t={12} />{a.slice(s.nome.length + 1)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
                </div>}
              </section>
            )
          })}
        </nav>
      </aside>}

      <section className="skills-nota glass glass--light">
        {aberta
          ? <PainelNota key={aberta} alvo={{ raiz: 'skills', nome: aberta }} fixo versao={versao} avisar={avisar} onLink={abrirLink}
              onMudou={() => { carregar() }} />
          : <p className="mudo skills-vazio">Escolha uma skill na lista.</p>}
      </section>
      {aviso && createPortal(<div className="ideias-aviso" role="status">{aviso}</div>, document.body)}
    </div>
  )
}
