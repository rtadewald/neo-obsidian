import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown, separarFrontmatter } from './Markdown'

/** Exporta a copy em PDF: abre uma janela só com o texto (sem as propriedades) formatado para impressão e chama a
 *  impressão do navegador, onde "Salvar como PDF" gera o arquivo com o nome da nota. */
export function exportarPdf(nome: string, texto: string) {
  const [, corpo] = separarFrontmatter(texto)
  const html = renderToStaticMarkup(<Markdown md={corpo} />)
  const titulo = nome.replace(/[<>&"]/g, '')
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) { alert('O navegador bloqueou a janela do PDF. Libere pop-ups para este site.'); return }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title>
<style>
  @page { size: A4; margin: 22mm 20mm; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 720px; padding: 32px 24px; font: 12.5pt/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color: #1d1d1f; }
  h1.titulo { font-size: 22pt; line-height: 1.2; margin: 0 0 18px; }
  h2, h3, h4, h5, h6 { line-height: 1.25; margin: 22px 0 8px; page-break-after: avoid; }
  h2 { font-size: 17pt; } h3 { font-size: 14.5pt; } h4, h5, h6 { font-size: 12.5pt; }
  p { margin: 0 0 10px; } ul, ol { margin: 0 0 10px; padding-left: 22px; } li { margin: 2px 0; }
  blockquote { margin: 0 0 12px; padding: 4px 14px; border-left: 3px solid #8fd61f; color: #3a3a3c; }
  .md-callout-t { font-weight: 600; }
  pre { white-space: pre-wrap; background: #f3f2ef; padding: 10px 12px; border-radius: 8px; font-size: 10.5pt; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: .92em; }
  a { color: #1d1d1f; } mark { background: #f2f7c8; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 18px 0; }
  .md-wiki { text-decoration: none; } .md-embed { color: #8a8a8e; }
  .mudo { color: #8a8a8e; }
</style></head><body><h1 class="titulo">${titulo}</h1>${html}</body></html>`)
  w.document.close()
  w.addEventListener('afterprint', () => w.close())
  w.setTimeout(() => { w.focus(); w.print() }, 250)
}
