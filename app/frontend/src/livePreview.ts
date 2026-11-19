import { EditorState, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { ensureSyntaxTree } from '@codemirror/language'
import { extraCampo, painelProps } from './propriedades'

/** "Live preview" do Obsidian: o markdown aparece formatado e as marcas (#, **, >, [[ ]], ---)
 *  só aparecem na linha onde está o cursor. O texto do arquivo nunca muda, só o que se vê. */

type Abrir = (nome: string, nova?: boolean) => void   // nova: ⌘+clique abre numa aba nova

class Bolinha extends WidgetType {
  eq() { return true }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-lp-bolinha'; s.textContent = '•'; return s }
}

class Caixa extends WidgetType {
  constructor(readonly feita: boolean, readonly pos: number) { super() }
  eq(o: Caixa) { return o.feita === this.feita && o.pos === this.pos }
  toDOM(view: EditorView) {
    const i = document.createElement('input')
    i.type = 'checkbox'; i.checked = this.feita; i.className = 'cm-lp-caixa'
    i.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.feita ? ' ' : 'x' } })
    })
    return i
  }
  ignoreEvent() { return true }
}

class Icone extends WidgetType {
  constructor(readonly tipo: string) { super() }
  eq(o: Icone) { return o.tipo === this.tipo }
  toDOM() { const s = document.createElement('span'); s.className = `cm-lp-callout-icone is-${this.tipo}`; return s }
}

const esconder = Decoration.replace({})
const linha = (c: string) => Decoration.line({ class: c })
const marca = (c: string, attrs?: Record<string, string>) => Decoration.mark({ class: c, attributes: attrs })

function linhasAtivas(state: EditorState) {
  const s = new Set<number>()
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) s.add(n)
  }
  return s
}

function montar(state: EditorState): DecorationSet {
  const doc = state.doc
  const ativas = linhasAtivas(state)
  const ativa = (pos: number) => ativas.has(doc.lineAt(pos).number)
  const d: Range<Decoration>[] = []
  const texto = doc.toString()

  // frontmatter → painel de propriedades editável (como no Obsidian), sempre visível
  let inicio = 0
  const painel = painelProps(state)
  if (painel) {
    if (painel.fim >= 0) { inicio = painel.fim; d.push(Decoration.replace({ widget: painel.widget, block: true }).range(0, painel.fim)) }
    else d.push(Decoration.widget({ widget: painel.widget, block: true, side: -1 }).range(0))
  }

  const tree = ensureSyntaxTree(state, doc.length, 200)
  tree?.iterate({
    from: inicio,
    enter: (n) => {
      const { from, to, name } = n
      if (from < inicio) return
      const ln = doc.lineAt(from)
      const on = ativa(from)
      if (/^ATXHeading(\d)$/.test(name)) d.push(linha(`cm-lp-h cm-lp-h${name.slice(-1)}`).range(ln.from))
      else if (name === 'HeaderMark' && !on && n.node.parent?.name.startsWith('ATX')) {
        d.push(esconder.range(from, Math.min(to + (doc.sliceString(to, to + 1) === ' ' ? 1 : 0), ln.to)))
      } else if ((name === 'EmphasisMark' || name === 'StrikethroughMark') && !on) d.push(esconder.range(from, to))
      else if (name === 'CodeMark' && !on && n.node.parent?.name === 'InlineCode') d.push(esconder.range(from, to))
      else if (name === 'InlineCode') d.push(marca('cm-lp-codigo').range(from, to))
      else if (name === 'Link' && !on) {
        // [texto](url): mostra só o texto, com cara de link
        const marcas = n.node.getChildren('LinkMark')
        const url = n.node.getChild('URL')
        if (marcas.length >= 2) {
          d.push(esconder.range(from, marcas[0].to))
          d.push(marca('cm-lp-link', url ? { 'data-url': doc.sliceString(url.from, url.to) } : undefined).range(marcas[0].to, marcas[1].from))
          d.push(esconder.range(marcas[1].from, to))
        }
        return false
      } else if (name === 'Blockquote') {
        const primeira = doc.lineAt(from), ultima = doc.lineAt(to)
        const call = /^>\s*\[!(\w+)\][+-]?\s*(.*)$/.exec(primeira.text)
        const base = call ? `cm-lp-callout is-${call[1].toLowerCase()}` : 'cm-lp-citacao'
        for (let k = primeira.number; k <= ultima.number; k++) {
          const l = doc.line(k)
          d.push(linha(`${base}${k === primeira.number ? ' is-primeira' : ''}${k === ultima.number ? ' is-ultima' : ''}`).range(l.from))
        }
        if (call) {
          d.push(linha('cm-lp-callout-t').range(primeira.from))
          if (!ativa(primeira.from)) {
            const ini = primeira.text.indexOf('[!')
            const fimTag = primeira.text.indexOf(']', ini) + 1
            const espaco = primeira.text[fimTag] === ' ' || /[+-]/.test(primeira.text[fimTag]) ? 1 : 0
            d.push(Decoration.replace({ widget: new Icone(call[1].toLowerCase()) }).range(primeira.from + ini, primeira.from + fimTag + espaco))
          }
        }
      } else if (name === 'QuoteMark' && !on) {
        d.push(esconder.range(from, Math.min(to + (doc.sliceString(to, to + 1) === ' ' ? 1 : 0), ln.to)))
      } else if (name === 'ListMark' && !on && /^[-*+]$/.test(doc.sliceString(from, to))) {
        const tarefa = /^\s*\[[ xX]\]/.test(doc.sliceString(to, to + 5))
        if (!tarefa) d.push(Decoration.replace({ widget: new Bolinha() }).range(from, to))
        else d.push(esconder.range(from, to + 1))
      } else if (name === 'TaskMarker') {
        const feita = /x/i.test(doc.sliceString(from, to))
        if (!on) d.push(Decoration.replace({ widget: new Caixa(feita, from) }).range(from, to))
        if (feita) {
          const fimL = doc.lineAt(from).to
          if (fimL > to + 1) d.push(marca('cm-lp-feita').range(to + 1, fimL))
        }
      } else if (name === 'HorizontalRule' && !on) {
        d.push(linha('cm-lp-hr').range(ln.from))
        d.push(esconder.range(from, to))
      } else if (name === 'FencedCode') {
        const a = doc.lineAt(from).number, b = doc.lineAt(to).number
        for (let k = a; k <= b; k++) d.push(linha(`cm-lp-bloco${k === a ? ' is-primeira' : ''}${k === b ? ' is-ultima' : ''}`).range(doc.line(k).from))
        return false
      }
    },
  })

  // links soltos (https://…): ganham cara de link e abrem com um clique, como no Obsidian (na linha do cursor
  // continuam texto editável)
  const urlSolta = /https?:\/\/[^\s<>)\]"']+[^\s<>)\]"'.,;:!?]/g
  let u: RegExpExecArray | null
  while ((u = urlSolta.exec(texto))) {
    const a = u.index, b = a + u[0].length
    if (a < inicio || ativa(a)) continue
    if (texto[a - 1] === '(' && texto[a - 2] === ']') continue   // já é [texto](url)
    if (texto.slice(Math.max(0, a - 3), a) === '[[' ) continue
    d.push(marca('cm-lp-link cm-lp-url', { 'data-url': u[0] }).range(a, b))
  }

  // o que o parser de markdown não conhece: [[wikilinks]], ![[embeds]] e ==destaque==
  const re = /(!?)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]|==([^=\n]+)==/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto))) {
    const a = m.index, b = a + m[0].length
    if (a < inicio || ativa(a)) continue
    if (m[5] !== undefined) {
      d.push(esconder.range(a, a + 2), marca('cm-lp-destaque').range(a + 2, b - 2), esconder.range(b - 2, b))
      continue
    }
    const rotulo = m[4] ?? m[2] + (m[3] ?? '')
    const ini = m[4] ? b - 2 - m[4].length : a + m[1].length + 2
    d.push(esconder.range(a, ini))
    d.push(marca(m[1] ? 'cm-lp-embed' : 'cm-lp-wiki', { 'data-nota': m[2].trim(), title: rotulo }).range(ini, b - 2))
    d.push(esconder.range(b - 2, b))
  }

  return Decoration.set(d, true)
}

const campo = StateField.define<DecorationSet>({
  create: montar,
  update(v, tr) { return tr.docChanged || tr.selection || tr.reconfigured || tr.effects.length ? montar(tr.state) : v },
  provide: (f) => EditorView.decorations.from(f),
})

/** Clique abre o [[link]] (⌘/Ctrl+clique numa aba nova, como no Obsidian); ⌘+clique abre o link normal em outra aba. */
export function livePreview(abrir?: Abrir) {
  return [
    extraCampo, campo,
    EditorView.domEventHandlers({
      mousedown(e) {
        // link solto: um clique abre (fora da linha do cursor ele nem é texto editável)
        const solto = (e.target as HTMLElement).closest('.cm-lp-url') as HTMLElement | null
        if (solto?.dataset.url && !e.metaKey && !e.ctrlKey && e.button === 0) {
          e.preventDefault(); window.open(solto.dataset.url, '_blank', 'noopener,noreferrer'); return true
        }
        // [[link]]: clique abre a nota na aba da frente; ⌘+clique numa aba nova
        const nota = (e.target as HTMLElement).closest('[data-nota]') as HTMLElement | null
        if (nota?.dataset.nota && e.button === 0) { e.preventDefault(); abrir?.(nota.dataset.nota, e.metaKey || e.ctrlKey); return true }
        if (!(e.metaKey || e.ctrlKey)) return false
        const alvo = (e.target as HTMLElement).closest('[data-url]') as HTMLElement | null
        if (!alvo) return false
        e.preventDefault()
        if (alvo.dataset.url) window.open(alvo.dataset.url, '_blank', 'noopener,noreferrer')
        return true
      },
    }),
  ]
}
