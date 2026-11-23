import { useEffect, useRef, useState } from 'react'
import type { Alvo, Producao } from './canvasApi'
import { avisar } from './porta'

/** Clicar num formato que a copy ainda não tem (coluna Formatos ou faixa da nota): propõe criar a nota daquele formato,
 *  perguntando a coleção; a nota nova parte do texto da original (com um link para ela). */
const PREFIXO: Record<string, string> = { '💰': 'VSL - ', '📜': 'LP - ', '🎣': 'ISCA - ' }
const base = (nome: string) => nome.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^(VSL|LP|ISCA|Isca|Ads?|AD)\b\s*[-–—:]?\s*/i, '').trim()
export const nomeNovoFormato = (origem: string, f: string) => `${f} ${PREFIXO[f] ?? ''}${base(origem)}`

const cab = { 'Content-Type': 'application/json' }
async function criarFormato(origem: Producao, f: string, colecao: string): Promise<Alvo> {
  const r = await fetch('/api/copies/ideia', { method: 'POST', headers: cab, body: JSON.stringify({ titulo: nomeNovoFormato(origem.nome, f) }) })
  if (!r.ok) throw new Error('Não consegui criar a nota.')
  const nova = await r.json() as Alvo
  // o texto da original (sem o frontmatter dela) entra embaixo do frontmatter da nova
  const url = (a: Alvo) => `/api/notas/${a.raiz}/${encodeURIComponent(a.nome)}`
  const [o, n] = await Promise.all([fetch(url(origem)).then((x) => x.json()), fetch(url(nova)).then((x) => x.json())])
  const corpo = String(o.texto ?? '').replace(/^---\n[\s\S]*?\n---\n/, '').trim()
  const m = /^(---\n[\s\S]*?\n---\n)/.exec(n.texto ?? '')
  const texto = `${m ? m[1] : ''}\nBase: [[${origem.nome}]]\n\n${corpo}\n`
  await fetch(url(nova), { method: 'PUT', headers: cab, body: JSON.stringify({ texto, mtime: n.mtime }) })
  if (colecao) await fetch('/api/copies/categoria', { method: 'POST', headers: cab, body: JSON.stringify({ nomes: [nova.nome], categoria: colecao }) })
  return nova
}

export function NovoFormato({ origem, f, rotulo, colecoes, x, y, onFechar, onCriado }: {
  origem: Producao; f: string; rotulo: string; colecoes: { v: string; r: string }[]; x: number; y: number
  onFechar: () => void; onCriado: (a: Alvo) => void
}) {
  const [colecao, setColecao] = useState(origem.categoria ?? '')
  const [indo, setIndo] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fora = (e: PointerEvent) => { if (!caixa.current?.contains(e.target as Node)) onFechar() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onFechar() } }
    window.addEventListener('pointerdown', fora, true); window.addEventListener('keydown', esc, true)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('keydown', esc, true) }
  }, [onFechar])
  const criar = async () => {
    setIndo(true)
    try { const a = await criarFormato(origem, f, colecao); avisar(`${a.nome} criada`); onCriado(a) }
    catch (e) { avisar((e as Error).message); setIndo(false) }
  }
  return (
    <div ref={caixa} className="novo-formato glass glass--light" role="dialog" aria-label={`Criar ${rotulo}`}
      style={{ left: Math.min(x, window.innerWidth - 300), top: Math.min(y + 8, window.innerHeight - 200) }}>
      <p className="novo-formato-t">Criar {f} {rotulo}?</p>
      <p className="novo-formato-nome">{nomeNovoFormato(origem.nome, f)}</p>
      <label className="novo-formato-campo"><span>Coleção</span>
        <select value={colecao} onChange={(e) => setColecao(e.target.value)}>
          <option value="">— Sem coleção</option>
          {colecoes.map((c) => <option key={c.v} value={c.v}>{c.r}</option>)}
        </select></label>
      <p className="novo-formato-dica">Começa com o texto de {origem.nome}.</p>
      <div className="novo-formato-acoes">
        <button type="button" onClick={onFechar}>Cancelar</button>
        <button type="button" className="pilula is-on" disabled={indo} onClick={criar}>{indo ? 'Criando…' : 'Criar e abrir'}</button>
      </div>
    </div>
  )
}
