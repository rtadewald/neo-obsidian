import { useEffect, useRef, useState } from 'react'
import { onde } from './canvasApi'
import { EVENTO_PEDIR, avisar, copiar, pedidoEmTexto, type Anexo, type PedidoAberto } from './porta'

/** A porta para o Claude Code: a bolinha do canto (verde = ele está ouvindo a fila) e a caixa de pedido.
 *  Enviar põe o pedido em dados/fila.jsonl; o Claude Code recebe na hora. Sem ninguém ouvindo, o pedido vai para a
 *  área de transferência, pronto para colar no terminal. ⌘J abre e fecha. */
export function Pedido({ ouvindo }: { ouvindo: boolean }) {
  const [aberto, setAberto] = useState(false)
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [texto, setTexto] = useState('')
  const [indo, setIndo] = useState(false)
  const campo = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const abrir = (e: Event) => {
      const p = (e as CustomEvent<PedidoAberto>).detail
      setAnexos((a) => [...a.filter((x) => !p.anexos.some((y) => y.codigo === x.codigo)), ...p.anexos])
      if (p.texto) setTexto(p.texto)
      setAberto(true)
      window.setTimeout(() => campo.current?.focus(), 30)
    }
    const tecla = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault(); e.stopPropagation()
        setAberto((v) => { if (!v) window.setTimeout(() => campo.current?.focus(), 30); return !v })
      }
    }
    window.addEventListener(EVENTO_PEDIR, abrir)
    window.addEventListener('keydown', tecla, true)
    return () => { window.removeEventListener(EVENTO_PEDIR, abrir); window.removeEventListener('keydown', tecla, true) }
  }, [])

  // ao abrir (ou ganhar um anexo), o cursor vai para o campo, mesmo depois do clique que fechou um menu
  useEffect(() => { if (!aberto) return; const t = window.setTimeout(() => campo.current?.focus(), 120); return () => window.clearTimeout(t) }, [aberto, anexos])

  const limpar = () => { setTexto(''); setAnexos([]); setAberto(false) }

  async function enviar() {
    if (indo || (!texto.trim() && !anexos.length)) return
    setIndo(true)
    try {
      const trecho = anexos.find((a) => a.linhas)
      const r = await fetch('/api/fila', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texto, codigos: anexos.map((a) => a.codigo),
          trecho: trecho ? { codigo: trecho.codigo, linhaIni: trecho.linhas![0], linhaFim: trecho.linhas![1], texto: trecho.texto } : null,
        }),
      }).then((x) => x.json())
      if (r.ouvindo) avisar('Pedido enviado ao Claude')
      else await copiar(pedidoEmTexto(texto, anexos), 'O Claude não está ouvindo: copiei o pedido, cole no terminal')
      limpar()
    } catch { avisar('Não consegui enviar o pedido') } finally { setIndo(false) }
  }

  return (
    <div className={`porta ${aberto ? 'is-aberta' : ''}`}>
      {aberto && (
        <div className="porta-caixa glass glass--light" role="dialog" aria-label="Pedido ao Claude">
          <div className="porta-cabeca">
            <span className={`porta-luz ${ouvindo ? 'is-on' : ''}`} />
            <b>Claude Code</b>
            <span className="porta-estado">{ouvindo ? 'ouvindo' : 'fora do ar · o pedido vai copiado'}</span>
            <button type="button" className="porta-fechar" onClick={() => setAberto(false)} aria-label="Fechar (⌘J)">×</button>
          </div>
          {!!anexos.length && (
            <div className="porta-anexos">
              {anexos.map((a) => (
                <span key={a.codigo + (a.linhas?.join('-') ?? '')} className="porta-anexo" title={a.texto || a.rotulo}>
                  <code>{a.codigo}</code>{a.linhas && <em>L{a.linhas[0]}–{a.linhas[1]}</em>}<span>{a.rotulo}</span>
                  <button type="button" onClick={() => setAnexos((l) => l.filter((x) => x !== a))} aria-label="Tirar">×</button>
                </span>
              ))}
            </div>
          )}
          <textarea ref={campo} value={texto} onChange={(e) => setTexto(e.target.value)} rows={4}
            placeholder={onde.nota ? 'O que fazer com esta nota?' : 'Peça ao Claude (ele vê onde você está no app)'}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); enviar() }
              if (e.key === 'Escape') { e.preventDefault(); setAberto(false) }
            }} />
          <div className="porta-pe">
            <button type="button" className="btn-texto" onClick={() => copiar(pedidoEmTexto(texto, anexos), 'Pedido copiado')}>Copiar</button>
            <button type="button" className="btn-primario" disabled={indo || (!texto.trim() && !anexos.length)} onClick={enviar}>Enviar ⌘↵</button>
          </div>
        </div>
      )}
      <button type="button" className={`porta-bola glass glass--light ${ouvindo ? 'is-on' : ''}`} onClick={() => setAberto((v) => !v)}
        title={ouvindo ? 'Claude Code ouvindo · pedir algo (⌘J)' : 'Claude Code fora do ar · os pedidos vão copiados (⌘J)'}>
        <span className="porta-luz" />
      </button>
    </div>
  )
}
