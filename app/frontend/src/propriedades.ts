import { StateEffect, StateField, type EditorState, type Text } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'

/** Painel de propriedades no jeito do Obsidian: o frontmatter aparece como uma tabela editável
 *  (texto, data, caixinha, lista de tags) e cada mudança reescreve só a linha daquela chave no YAML. */

/** O que vem de fora do arquivo: o status (pasta da nota) e ações do app para data e publicação. */
export type Extra = {
  status?: { valor: string; opcoes: { k: string; rotulo: string }[]; mudar: (s: string) => void }
  onData?: (data: string) => void          // scheduled muda pelo app (que também agenda)
  onPublicado?: (sim: boolean) => void     // publicado muda o status (pasta)
}

export const definirExtra = StateEffect.define<Extra>()
export const extraCampo = StateField.define<Extra>({
  create: () => ({}),
  update(v, tr) { for (const e of tr.effects) if (e.is(definirExtra)) return e.value; return v },
})

type Item = { chave: string; valor: string | string[]; de: number; ate: number }  // de/ate: linhas (1-based) no doc

const LISTA = /^\s+-\s?(.*)$/
const tirarAspas = (s: string) => s.trim().replace(/^["'](.*)["']$/, '$1')

/** Lê o frontmatter: cada chave com o intervalo de linhas que ocupa (inclui os "  - item" de baixo). */
export function lerProps(doc: Text): { itens: Item[]; fim: number } | null {
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return null
  let fim = 0
  for (let n = 2; n <= doc.lines; n++) if (doc.line(n).text.trim() === '---') { fim = n; break }
  if (!fim) return null
  const itens: Item[] = []
  for (let n = 2; n < fim; n++) {
    const m = /^([^\s:#][^:]*):[ \t]*(.*)$/.exec(doc.line(n).text)
    if (!m) continue
    let ate = n
    const sub: string[] = []
    while (ate + 1 < fim && (LISTA.test(doc.line(ate + 1).text) || !doc.line(ate + 1).text.trim())) {
      const l = LISTA.exec(doc.line(ate + 1).text)
      if (l) sub.push(tirarAspas(l[1]))
      ate++
    }
    const bruto = m[2].trim()
    let valor: string | string[]
    if (sub.length) valor = sub.filter(Boolean)
    else if (/^\[.*\]$/.test(bruto) && !/^\[\[/.test(bruto)) valor = bruto.slice(1, -1).split(',').map(tirarAspas).filter(Boolean)
    else valor = tirarAspas(bruto)
    itens.push({ chave: m[1].trim(), valor, de: n, ate })
  }
  return { itens, fim }
}

const ehLista = (chave: string, v: Item['valor']) => Array.isArray(v) || /^(tags|aliases|cssclasses)$/.test(chave)
const ehData = (chave: string, v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) || /^(scheduled|data|date|done)$/i.test(chave)
const ehBool = (v: string) => v === 'true' || v === 'false'

/** Aspas quando o YAML precisaria delas (wikilink, emoji no começo, dois-pontos…). */
function yaml(v: string) {
  if (!v) return ''
  if (/^[\p{L}\p{N}][^:#[\]{},]*$/u.test(v) && !/\s$/.test(v)) return v
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
function bloco(chave: string, v: string | string[]) {
  if (Array.isArray(v)) return v.length ? `${chave}:\n${v.map((x) => `  - ${yaml(x)}`).join('\n')}` : `${chave}:`
  return v ? `${chave}: ${ehBool(v) ? v : yaml(v)}` : `${chave}:`
}

function trocar(view: EditorView, chave: string, v: string | string[] | null) {
  const p = lerProps(view.state.doc)
  const doc = view.state.doc
  if (!p) {
    if (v === null) return
    view.dispatch({ changes: { from: 0, insert: `---\n${bloco(chave, v)}\n---\n` } })
    return
  }
  const it = p.itens.find((i) => i.chave === chave)
  if (it) {
    const from = doc.line(it.de).from, to = doc.line(it.ate).to
    if (v === null) view.dispatch({ changes: { from, to: Math.min(to + 1, doc.length) } })
    else view.dispatch({ changes: { from, to, insert: bloco(chave, v) } })
  } else if (v !== null) {
    const pos = doc.line(p.fim).from
    view.dispatch({ changes: { from: pos, insert: bloco(chave, v) + '\n' } })
  }
}

let focoDepois: string | null = null   // depois de redesenhar, volta o foco para o campo onde se estava

class Painel extends WidgetType {
  readonly itens: Item[]; readonly extra: Extra
  constructor(itens: Item[], extra: Extra) { super(); this.itens = itens; this.extra = extra }
  eq(o: Painel) {
    return JSON.stringify(o.itens.map((i) => [i.chave, i.valor])) === JSON.stringify(this.itens.map((i) => [i.chave, i.valor]))
      && o.extra.status?.valor === this.extra.status?.valor && !!o.extra.onData === !!this.extra.onData
  }
  ignoreEvent() { return true }

  toDOM(view: EditorView) {
    const raiz = document.createElement('div')
    raiz.className = 'cm-lp-props'
    const linha = (rotulo: string, campo: HTMLElement, chave?: string) => {
      const d = document.createElement('div'); d.className = 'cm-prop'
      const k = document.createElement('span'); k.className = 'cm-prop-chave'; k.textContent = rotulo
      d.append(k, campo)
      if (chave) {
        const x = document.createElement('button'); x.className = 'cm-prop-tirar'; x.textContent = '×'; x.title = 'Remover propriedade'
        x.onclick = () => trocar(view, chave, null)
        d.append(x)
      }
      raiz.append(d)
    }

    const st = this.extra.status
    if (st) {
      const s = document.createElement('select'); s.className = 'cm-prop-campo'
      for (const o of st.opcoes) { const op = document.createElement('option'); op.value = o.k; op.textContent = o.rotulo; s.append(op) }
      s.value = st.valor
      s.onchange = () => st.mudar(s.value)
      linha('status', s)
    }

    for (const it of this.itens) {
      const { chave, valor } = it
      if (ehLista(chave, valor)) {
        const lista = Array.isArray(valor) ? valor : valor ? [valor] : []
        const caixa = document.createElement('div'); caixa.className = 'cm-prop-campo cm-prop-lista'
        lista.forEach((t, i) => {
          const c = document.createElement('span'); c.className = 'cm-prop-chip'; c.textContent = t
          const x = document.createElement('button'); x.textContent = '×'; x.title = 'Tirar'
          x.onclick = () => { focoDepois = `lista:${chave}`; trocar(view, chave, lista.filter((_, j) => j !== i)) }
          c.append(x); caixa.append(c)
        })
        const inp = document.createElement('input'); inp.placeholder = lista.length ? '' : 'Vazio'; inp.dataset.foco = `lista:${chave}`
        const add = () => { const v = inp.value.trim().replace(/^#/, ''); if (v) { focoDepois = `lista:${chave}`; trocar(view, chave, [...lista, v]) } }
        inp.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
          else if (e.key === 'Backspace' && !inp.value && lista.length) { focoDepois = `lista:${chave}`; trocar(view, chave, lista.slice(0, -1)) }
        }
        inp.onblur = add
        caixa.onclick = (e) => { if (e.target === caixa) inp.focus() }
        caixa.append(inp)
        linha(chave, caixa, chave)
        continue
      }
      const v = valor as string
      if (ehBool(v) || chave === 'publicado') {
        const c = document.createElement('input'); c.type = 'checkbox'; c.className = 'cm-prop-caixa'; c.checked = v === 'true'
        c.onchange = () => {
          if (chave === 'publicado' && this.extra.onPublicado) this.extra.onPublicado(c.checked)
          else trocar(view, chave, c.checked ? 'true' : 'false')
        }
        linha(chave, c, chave)
        continue
      }
      if (ehData(chave, v)) {
        const d = document.createElement('input'); d.type = 'date'; d.className = 'cm-prop-campo'; d.value = /^\d{4}-\d{2}-\d{2}/.exec(v)?.[0] ?? ''
        d.onchange = () => {
          if (/^scheduled$/i.test(chave) && this.extra.onData && d.value) this.extra.onData(d.value)
          else trocar(view, chave, d.value)
        }
        linha(chave, d, chave)
        continue
      }
      const t = document.createElement('input'); t.className = 'cm-prop-campo'; t.value = v; t.placeholder = 'Vazio'
      if (/^\[\[.*\]\]$/.test(v)) t.classList.add('is-link')
      t.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); t.blur() }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); t.value = v; t.blur() }
      }
      t.onblur = () => { if (t.value.trim() !== v) trocar(view, chave, t.value.trim()) }
      linha(chave, t, chave)
    }

    // + Adicionar propriedade
    const novo = document.createElement('div'); novo.className = 'cm-prop cm-prop-nova'
    const botao = document.createElement('button'); botao.textContent = '+ Adicionar propriedade'
    botao.onclick = () => {
      const k = document.createElement('input'); k.className = 'cm-prop-campo'; k.placeholder = 'nome da propriedade'
      const ok = () => {
        const n = k.value.trim().replace(/[:\s]+/g, '-')
        if (n && !this.itens.some((i) => i.chave === n)) trocar(view, n, '')
        else novo.replaceChildren(botao)
      }
      k.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok() } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); novo.replaceChildren(botao) } }
      k.onblur = ok
      novo.replaceChildren(k); k.focus()
    }
    novo.append(botao); raiz.append(novo)

    if (focoDepois) {
      const alvo = focoDepois; focoDepois = null
      requestAnimationFrame(() => (raiz.querySelector(`[data-foco="${CSS.escape(alvo)}"]`) as HTMLElement | null)?.focus())
    }
    return raiz
  }
}

/** Painel no lugar do frontmatter (posição final do bloco, para o resto do live preview começar depois). */
export function painelProps(state: EditorState): { widget: WidgetType; fim: number } | null {
  const p = lerProps(state.doc)
  const extra = state.field(extraCampo, false) ?? {}
  if (!p) return extra.status ? { widget: new Painel([], extra), fim: -1 } : null
  const fimLinha = state.doc.line(p.fim)
  return { widget: new Painel(p.itens, extra), fim: fimLinha.to }
}
