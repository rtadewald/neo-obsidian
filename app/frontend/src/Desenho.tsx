import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import '@excalidraw/excalidraw/index.css'
import { cabecalhoCanvas } from './canvasApi'

/** Camada de desenho do canvas: o Excalidraw de verdade (ferramentas, atalhos, cores, estilo à mão), por baixo dos
 *  cards e com o mesmo pan/zoom do React Flow. Fora do modo desenho ele só mostra os desenhos (não pega o mouse);
 *  no modo desenho ele vem para a frente e o canvas de cards para de responder.
 *  Coordenadas: o React Flow põe um ponto da cena na tela em `cena * zoom + x`; o Excalidraw em
 *  `(cena + scrollX) * zoom`. Logo scrollX = x / zoom (os dois ocupam o mesmo retângulo).
 *  Cada canvas tem o seu desenho em app/dados/canvas/<slug>.desenho.json (GET/PUT /api/canvas/desenho). */

// fontes servidas pelo próprio app (public/fonts, copiadas de node_modules no npm install), sem CDN
;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/'

type Modulo = typeof import('@excalidraw/excalidraw')
type Api = Parameters<NonNullable<React.ComponentProps<Modulo['Excalidraw']>['excalidrawAPI']>>[0]
type Elementos = Parameters<NonNullable<React.ComponentProps<Modulo['Excalidraw']>['onChange']>>[0]
type Arquivos = Parameters<NonNullable<React.ComponentProps<Modulo['Excalidraw']>['onChange']>>[2]
export type Vista = { x: number; y: number; zoom: number }

let modulo: Modulo | null = null
const Excalidraw = lazy(() => import('@excalidraw/excalidraw').then((m) => { modulo = m; return { default: m.Excalidraw } }))

/** Teclas de ferramenta do Excalidraw: apertar uma delas no canvas entra no modo desenho já com a ferramenta.
 *  O T (texto) ficou de fora: no canvas ele não entra no modo desenho (lá dentro continua sendo o texto). */
export const TECLAS_FERRAMENTA: Record<string, string> = {
  r: 'rectangle', '2': 'rectangle', d: 'diamond', '3': 'diamond', o: 'ellipse', '4': 'ellipse', a: 'arrow', '5': 'arrow',
  l: 'line', '6': 'line', p: 'freedraw', x: 'freedraw', '7': 'freedraw', '8': 'text', '0': 'eraser',
}

/** O que a mesa usa para falar com a camada: empurrar o pan/zoom do canvas e escolher a ferramenta. */
export type ControleDesenho = {
  vista: (v: Vista) => void; ferramenta: (t: string) => void; podeSair: () => boolean
  elementoEm: (x: number, y: number) => string | null   // id do desenho no ponto da tela (ou null)
  selecionar: (id: string) => void                       // ao entrar no modo desenho, já com este elemento selecionado
}

export function Desenho({ canvas, ativo, vistaInicial, onVista, onSair, controle }: {
  canvas: string; ativo: boolean; vistaInicial: () => Vista
  onVista: (v: Vista) => void   // o usuário mexeu no pan/zoom dentro do Excalidraw: o canvas acompanha
  onSair: () => void
  controle: React.MutableRefObject<ControleDesenho | null>
}) {
  const [dados, setDados] = useState<{ elements: Elementos; files: Arquivos } | null>(null)
  const api = useRef<Api | null>(null)
  const ultimaVista = useRef<Vista | null>(null)
  const assinatura = useRef('')
  const timer = useRef<number | undefined>(undefined)
  const caixa = useRef<HTMLDivElement>(null)
  const ferramentaPendente = useRef<string | null>(null)   // pedida antes do Excalidraw sair do modo leitura

  useEffect(() => {
    let vivo = true
    fetch('/api/canvas/desenho', { headers: cabecalhoCanvas() }).then((r) => r.json())
      .then((d) => { if (vivo) setDados({ elements: d.elements ?? [], files: d.files ?? {} }) })
      .catch(() => { if (vivo) setDados({ elements: [], files: {} }) })
    return () => { vivo = false }
  }, [canvas])

  const aplicarVista = (v: Vista) => {
    ultimaVista.current = v
    const a = api.current
    if (!a || !modulo) return
    a.updateScene({ appState: { scrollX: v.x / v.zoom, scrollY: v.y / v.zoom, zoom: { value: v.zoom as never } }, captureUpdate: modulo.CaptureUpdateAction.NEVER })
  }
  // o desenho que está num ponto da tela (pela caixa de cada elemento, com uma folga), do mais de cima para o de baixo
  const elementoEm = (x: number, y: number): string | null => {
    const a = api.current, el = caixa.current
    if (!a || !el) return null
    const st = a.getAppState(), z = st.zoom.value as number, r = el.getBoundingClientRect()
    const sx = (x - r.left) / z - st.scrollX, sy = (y - r.top) / z - st.scrollY, folga = 6 / z
    const achado = [...a.getSceneElements()].reverse().find((e) => !e.isDeleted && sx >= Math.min(e.x, e.x + e.width) - folga && sx <= Math.max(e.x, e.x + e.width) + folga
      && sy >= Math.min(e.y, e.y + e.height) - folga && sy <= Math.max(e.y, e.y + e.height) + folga)
    return achado ? achado.id : null
  }
  const selecaoPendente = useRef<string | null>(null)
  controle.current = {
    elementoEm,
    selecionar: (id) => { selecaoPendente.current = id },
    vista: aplicarVista,
    ferramenta: (t) => { ferramentaPendente.current = t; if (ativo) api.current?.setActiveTool({ type: t as never }) },
    podeSair: () => {
      const s = api.current?.getAppState()
      return !s || (s.activeTool.type === 'selection' && !Object.keys(s.selectedElementIds).length && !s.editingTextElement && !s.newElement)
    },
  }

  // grava o desenho (com uma pausa para não gravar a cada traço); a assinatura evita gravar quando só o pan mudou
  const gravar = (els: Elementos, files: Arquivos) => {
    const sig = `${els.length}:${els.reduce((s, e) => s + e.version, 0)}:${Object.keys(files).length}`
    if (sig === assinatura.current) return
    const primeira = !assinatura.current
    assinatura.current = sig
    if (primeira) return   // o primeiro onChange é o próprio carregamento
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      fetch('/api/canvas/desenho', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...cabecalhoCanvas() },
        body: JSON.stringify({ elements: els.filter((e) => !e.isDeleted), files }) }).catch(() => {})
    }, 700)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // ao entrar no modo desenho, o foco vai para o Excalidraw (os atalhos dele só valem com foco dentro dele)
  useEffect(() => {
    if (!ativo) return
    // sair do modo leitura volta o Excalidraw para a seleção: a ferramenta pedida (tecla R, O…) entra depois disso
    const t = window.setTimeout(() => {
      api.current?.refresh()
      if (ferramentaPendente.current) { api.current?.setActiveTool({ type: ferramentaPendente.current as never }); ferramentaPendente.current = null }
      if (selecaoPendente.current) {   // entrou clicando num desenho: ele já vem selecionado
        api.current?.updateScene({ appState: { selectedElementIds: { [selecaoPendente.current]: true } as never } })
        selecaoPendente.current = null
      }
      caixa.current?.querySelector<HTMLElement>('.excalidraw')?.focus()
    }, 80)
    return () => window.clearTimeout(t)
  }, [ativo])

  // No modo desenho, com a seleção (ou a mão) ativa, o card de baixo continua vivo quando não há desenho no ponto:
  // arrastar move o card (a camada do desenho sai do caminho durante o gesto) e clicar sem mover abre a nota.
  // Com as outras ferramentas (retângulo, lápis…), desenha por cima.
  useEffect(() => {
    const el = caixa.current
    if (!ativo || !el) return
    let gesto: { x: number; y: number } | null = null
    const noCard = (x: number, y: number) => document.elementsFromPoint(x, y).find((n) => !el.contains(n) && n.closest('.react-flow__node')) as HTMLElement | undefined
    const desce = (e: PointerEvent) => {
      gesto = null
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const tipo = api.current?.getAppState().activeTool.type
      if (tipo !== 'selection' && tipo !== 'hand') return
      const alvo = noCard(e.clientX, e.clientY)
      if (!alvo || elementoEm(e.clientX, e.clientY)) return
      // sem preventDefault: ele cortaria os eventos de mouse (mousemove/mouseup) que o arraste do card usa
      e.stopPropagation()
      gesto = { x: e.clientX, y: e.clientY }
      el.style.pointerEvents = 'none'   // o resto do gesto (mover, soltar) vai para o card
      const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, button: 0, buttons: 1 }
      alvo.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: true }))
      alvo.dispatchEvent(new MouseEvent('mousedown', o))
    }
    const sobe = (e: PointerEvent) => {
      if (!gesto) return
      const g = gesto; gesto = null
      window.setTimeout(() => { el.style.pointerEvents = '' }, 0)
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 5) noCard(e.clientX, e.clientY)?.click()   // sem mover: abre a nota
    }
    const engole = (e: MouseEvent) => { if (gesto) e.stopPropagation() }   // o mousedown de verdade do gesto não chega ao Excalidraw
    el.addEventListener('pointerdown', desce, true)
    el.addEventListener('mousedown', engole, true)
    window.addEventListener('pointerup', sobe, true)
    return () => { el.removeEventListener('pointerdown', desce, true); el.removeEventListener('mousedown', engole, true); window.removeEventListener('pointerup', sobe, true); el.style.pointerEvents = '' }
  }, [ativo])  // eslint-disable-line react-hooks/exhaustive-deps

  // Esc com a ferramenta de seleção e nada selecionado sai do modo desenho
  useEffect(() => {
    if (!ativo) return
    // o Esc que fecha uma nota, a busca ou um menu não tira do modo desenho
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal-fundo, .paleta-fundo, .menu-ctx') && controle.current?.podeSair()) onSair() }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [ativo, onSair, controle])

  if (!dados) return null
  const v = vistaInicial()
  return (
    <div ref={caixa} className={`desenho ${ativo ? 'is-ativo' : ''}`} aria-hidden={!ativo}>
      <Suspense fallback={null}>
        <Excalidraw
          key={canvas}
          langCode="pt-BR"
          theme="light"
          viewModeEnabled={!ativo}
          initialData={{ elements: dados.elements, files: dados.files,
            appState: { viewBackgroundColor: 'transparent', scrollX: v.x / v.zoom, scrollY: v.y / v.zoom, zoom: { value: v.zoom as never } } }}
          UIOptions={{ canvasActions: { changeViewBackgroundColor: false, clearCanvas: true, loadScene: false, saveToActiveFile: false, toggleTheme: false, export: false, saveAsImage: true } }}
          excalidrawAPI={(a) => { api.current = a; if (import.meta.env.DEV) (window as unknown as { __desenho: Api }).__desenho = a; if (ultimaVista.current) window.setTimeout(() => aplicarVista(ultimaVista.current!), 0) }}
          onChange={(els, st, files) => {
            gravar(els, files)
            if (!ativo) return
            // pan/zoom feito dentro do Excalidraw (roda, pinça, ⌘+): o canvas de cards acompanha
            const z = st.zoom.value as number
            const nova = { x: st.scrollX * z, y: st.scrollY * z, zoom: z }
            const u = ultimaVista.current
            if (!u || Math.abs(u.x - nova.x) > 0.5 || Math.abs(u.y - nova.y) > 0.5 || Math.abs(u.zoom - nova.zoom) > 1e-4) {
              ultimaVista.current = nova
              onVista(nova)
            }
          }}
        />
      </Suspense>
    </div>
  )
}
