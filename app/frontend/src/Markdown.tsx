import type { ReactNode } from 'react'

/** Leitura de nota no estilo Obsidian: propriedades do frontmatter, títulos, listas, tarefas, citações,
 *  blocos de código, [[wikilinks]] (clicáveis quando a nota existe), links e embeds de imagem do vault. */
export function separarFrontmatter(md: string): [Record<string, string>, string] {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return [{}, md]
  const props: Record<string, string> = {}
  let chave = ''
  for (const l of m[1].split('\n')) {
    const kv = l.match(/^([\wÀ-ſ-]+):\s*(.*)$/)
    if (kv) { chave = kv[1]; props[chave] = kv[2].replace(/^["']|["']$/g, '') }
    else if (chave && /^\s*-\s+/.test(l)) props[chave] = [props[chave], l.replace(/^\s*-\s+/, '')].filter(Boolean).join(', ')
  }
  return [props, md.slice(m[0].length)]
}

type Props = { md: string; existe?: (nome: string) => boolean; onLink?: (nome: string) => void }

export function Markdown({ md, existe, onLink }: Props) {
  const [props, corpo] = separarFrontmatter(md)

  const inline = (t: string, k = 0): ReactNode[] => {
    const partes = t.split(/(!?\[\[[^\]]+\]\]|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+|==[^=]+==)/g)
    return partes.map((p, i) => {
      const key = `${k}-${i}`
      if (/^!\[\[/.test(p)) return <span key={key} className="md-embed">🖼 {p.slice(3, -2).split('|')[0]}</span>
      if (/^\[\[/.test(p)) {
        const [alvo, alias] = p.slice(2, -2).split('|')
        const nome = alvo.split('#')[0]
        const ok = existe?.(nome)
        return <a key={key} className={`md-wiki ${ok ? '' : 'is-fantasma'}`} onClick={() => ok && onLink?.(nome)}>{alias ?? alvo}</a>
      }
      if (/^\*\*|^__/.test(p)) return <strong key={key}>{inline(p.slice(2, -2), i)}</strong>
      if (/^==/.test(p)) return <mark key={key}>{p.slice(2, -2)}</mark>
      if (/^\*/.test(p)) return <em key={key}>{p.slice(1, -1)}</em>
      if (p.startsWith('`')) return <code key={key}>{p.slice(1, -1)}</code>
      const lk = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (lk) return <a key={key} href={lk[2]} target="_blank" rel="noreferrer">{lk[1]}</a>
      if (/^https?:\/\//.test(p)) return <a key={key} href={p} target="_blank" rel="noreferrer">{p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</a>
      return p
    })
  }

  const blocos: ReactNode[] = []
  const linhas = corpo.split('\n')
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]
    if (/^```/.test(l)) {
      const ini = i
      const cod: string[] = []
      while (++i < linhas.length && !/^```/.test(linhas[i])) cod.push(linhas[i])
      blocos.push(<pre key={ini} className="md-pre"><code>{cod.join('\n')}</code></pre>)
      continue
    }
    if (!l.trim()) continue
    const h = l.match(/^(#{1,6})\s+(.*)$/)
    if (h) { const N = `h${Math.min(h[1].length + 1, 6)}` as 'h2'; blocos.push(<N key={i} className={`md-h${h[1].length}`}>{inline(h[2], i)}</N>); continue }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { blocos.push(<hr key={i} />); continue }
    if (/^>/.test(l)) {
      const ini = i, q: string[] = []
      while (i < linhas.length && /^>/.test(linhas[i])) q.push(linhas[i++].replace(/^>\s?/, ''))
      i--
      const call = q[0]?.match(/^\[!(\w+)\][-+]?\s*(.*)$/)
      blocos.push(<blockquote key={ini} className={call ? `md-callout md-callout--${call[1].toLowerCase()}` : ''}>
        {call && <p className="md-callout-t">{call[2] || call[1]}</p>}
        {(call ? q.slice(1) : q).map((x, k) => <p key={k}>{inline(x, k)}</p>)}
      </blockquote>)
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s/.test(l)) {
      const ini = i, itens: ReactNode[] = []
      const ordenada = /^\s*\d/.test(l)
      while (i < linhas.length && /^\s*([-*+]|\d+[.)])\s/.test(linhas[i])) {
        const x = linhas[i], nivel = Math.floor((x.match(/^\s*/)?.[0].length ?? 0) / 2)
        const t = x.replace(/^\s*([-*+]|\d+[.)])\s/, '')
        const tarefa = t.match(/^\[( |x|X)\]\s?(.*)$/)
        itens.push(<li key={i} style={nivel ? { marginLeft: nivel * 18 } : undefined} className={tarefa ? 'md-tarefa' : ''}>
          {tarefa ? <><input type="checkbox" checked={tarefa[1] !== ' '} readOnly /> <span className={tarefa[1] !== ' ' ? 'is-feita' : ''}>{inline(tarefa[2], i)}</span></> : inline(t, i)}
        </li>)
        i++
      }
      i--
      blocos.push(ordenada ? <ol key={ini}>{itens}</ol> : <ul key={ini}>{itens}</ul>)
      continue
    }
    const ini = i, par: string[] = []
    while (i < linhas.length && linhas[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s|-{3,}\s*$)/.test(linhas[i])) par.push(linhas[i++])
    i--
    blocos.push(<p key={ini}>{par.map((x, k) => <span key={k}>{k > 0 && <br />}{inline(x, k)}</span>)}</p>)
  }

  const chaves = Object.keys(props)
  return (
    <div className="md">
      {chaves.length > 0 && (
        <dl className="md-props">
          {chaves.map((k) => <div key={k}><dt>{k}</dt><dd>{props[k] ? inline(props[k]) : <span className="mudo">vazio</span>}</dd></div>)}
        </dl>
      )}
      {blocos.length ? blocos : <p className="mudo">Nota vazia. Clique em Editar para escrever.</p>}
    </div>
  )
}
