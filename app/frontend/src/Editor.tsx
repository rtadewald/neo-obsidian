import { useEffect, useRef, type MutableRefObject } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { livePreview } from './livePreview'
import { definirExtra, type Extra } from './propriedades'

/** Editor de markdown no jeito do Obsidian (modo fonte com estilo): títulos maiores, negrito e itálico
 *  visíveis, marcas de sintaxe apagadas, quebra de linha, sem numeração. */
const estilo = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '600', letterSpacing: '-.02em' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '600', letterSpacing: '-.015em' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '600' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#5a6f0a', textDecoration: 'underline' },
  { tag: t.url, color: '#7d7a79' },
  { tag: t.quote, color: '#3c3b3a' },
  { tag: t.monospace, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.9em', backgroundColor: 'rgba(23,24,27,.06)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: '#a9a5a2' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: '#7d7a79', fontSize: '.9em' },
  { tag: [t.string, t.content], color: 'inherit' },
])

const tema = EditorView.theme({
  '&': { height: '100%', fontSize: '15px', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'Raleway, system-ui, sans-serif', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': { padding: '6px 0 40vh', caretColor: '#17181b', maxWidth: '760px' },
  '.cm-line': { padding: '0 2px' },
  '.cm-content ::selection, .cm-content::selection': { backgroundColor: 'rgba(226,240,92,.6)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(226,240,92,.55) !important' },
  '.cm-placeholder': { color: '#7d7a79' },
})

/** Posição logo depois do frontmatter (ou 0 quando não há). */
function inicioDoTexto(t: string) {
  const m = /^---\n[\s\S]*?\n---[ \t]*(\n|$)/.exec(t)
  return m ? Math.min(m[0].length, t.length) : 0
}

export type Selecao = { texto: string; linhaIni: number; linhaFim: number }

/** O que está selecionado; sem seleção, a linha do cursor (ou a nota inteira, se a linha estiver vazia). */
export function selecao(v: EditorView): Selecao {
  const { from, to } = v.state.selection.main
  const doc = v.state.doc
  if (from !== to) return { texto: doc.sliceString(from, to).trim(), linhaIni: doc.lineAt(from).number, linhaFim: doc.lineAt(to).number }
  const l = doc.lineAt(from)
  if (l.text.trim()) return { texto: l.text.trim(), linhaIni: l.number, linhaFim: l.number }
  return { texto: '', linhaIni: 1, linhaFim: doc.lines }
}

/** Liga e desliga uma marca (**, *, ==, ~~) em volta da seleção. */
export function envolver(v: EditorView, m: string) {
  const { from, to } = v.state.selection.main
  const doc = v.state.doc
  const ja = doc.sliceString(from - m.length, from) === m && doc.sliceString(to, to + m.length) === m
  v.dispatch(ja
    ? { changes: [{ from: from - m.length, to: from }, { from: to, to: to + m.length }], selection: { anchor: from - m.length, head: to - m.length } }
    : { changes: [{ from, insert: m }, { from: to, insert: m }], selection: { anchor: from + m.length, head: to + m.length } })
  v.focus()
}

/** Troca o nível de título da linha do cursor (0 = texto normal). */
export function titulo(v: EditorView, nivel: number) {
  const l = v.state.doc.lineAt(v.state.selection.main.head)
  const sem = l.text.replace(/^#{1,6}\s+/, '')
  v.dispatch({ changes: { from: l.from, to: l.to, insert: (nivel ? '#'.repeat(nivel) + ' ' : '') + sem } })
  v.focus()
}

type Props = {
  valor: string; onMudar: (v: string) => void; onSalvar?: () => void; onLink?: (nome: string) => void; chave: string
  onJarvis?: (s: Selecao) => void                    // ⌘I: manda o trecho para o chat
  onMenu?: (x: number, y: number) => void            // botão direito
  viewRef?: MutableRefObject<EditorView | null>
  extra?: Extra                                      // status e ações do app no painel de propriedades
}

export function Editor({ valor, onMudar, onSalvar, onLink, onJarvis, onMenu, viewRef, chave, extra }: Props) {
  const extraRef = useRef(extra)
  extraRef.current = extra
  const caixa = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const cb = useRef({ onMudar, onSalvar, onLink, onJarvis, onMenu })
  cb.current = { onMudar, onSalvar, onLink, onJarvis, onMenu }

  useEffect(() => {  // um editor novo por nota (histórico de desfazer não vaza entre notas)
    if (!caixa.current) return
    const v = new EditorView({
      parent: caixa.current,
      state: EditorState.create({
        doc: valor,
        selection: { anchor: inicioDoTexto(valor) },   // cursor depois das propriedades, que ficam formatadas
        extensions: [
          history(), EditorView.lineWrapping,
          yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }), syntaxHighlighting(estilo), tema,
          placeholder('Escreva aqui…'), livePreview((n) => cb.current.onLink?.(n)),
          EditorView.domEventHandlers({
            contextmenu: (e) => { if (!cb.current.onMenu) return false; e.preventDefault(); cb.current.onMenu(e.clientX, e.clientY); return true },
          }),
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { cb.current.onSalvar?.(); return true } },
            { key: 'Mod-i', preventDefault: true, run: (v) => { cb.current.onJarvis?.(selecao(v)); return true } },
            indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onMudar(u.state.doc.toString()) }),
        ],
      }),
    })
    view.current = v
    if (viewRef) viewRef.current = v
    // foca ao abrir, mas não rouba o foco de um campo aberto por cima (busca ⌘P, renomear)
    const ativo = document.activeElement
    if (!(ativo instanceof HTMLInputElement || ativo instanceof HTMLTextAreaElement)) v.focus()
    return () => { v.destroy(); view.current = null; if (viewRef) viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  // painel de propriedades: os callbacks leem sempre a versão atual (o widget pode ficar com a antiga)
  const assinatura = JSON.stringify([extra?.status?.valor, extra?.status?.opcoes, !!extra?.onData, !!extra?.onPublicado])
  useEffect(() => {
    const v = view.current, e = extraRef.current
    if (!v) return
    const fixo: Extra = {
      status: e?.status && { valor: e.status.valor, opcoes: e.status.opcoes, mudar: (s) => extraRef.current?.status?.mudar(s) },
      onData: e?.onData && ((d) => extraRef.current?.onData?.(d)),
      onPublicado: e?.onPublicado && ((b) => extraRef.current?.onPublicado?.(b)),
    }
    v.dispatch({ effects: definirExtra.of(fixo) })
  }, [assinatura, chave])

  useEffect(() => {  // texto trocado por fora (recarregar depois de conflito)
    const v = view.current
    if (v && v.state.doc.toString() !== valor) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: valor } })
  }, [valor])

  return <div ref={caixa} className="editor" />
}
