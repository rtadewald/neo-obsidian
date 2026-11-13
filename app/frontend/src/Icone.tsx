// Ícones de traço do design system JCO-359 (1,6 px, pontas redondas), mais os que o app precisou.
const P: Record<string, React.ReactNode> = {
  seta: <path d="M3 13 13 3M5 3h8v8" />,
  busca: <><circle cx="9" cy="9" r="6.2" /><path d="m13.6 13.6 4.4 4.4" /></>,
  sol: <><circle cx="10" cy="10" r="4.1" /><path d="M10 1.4v2.2M10 16.4v2.2M1.4 10h2.2M16.4 10h2.2M3.9 3.9l1.6 1.6M14.5 14.5l1.6 1.6M3.9 16.1l1.6-1.6M14.5 5.5l1.6-1.6" /></>,
  sino: <><path d="M10 2.4a5 5 0 0 0-5 5c0 4.6-1.7 6.3-2.4 7.1h14.8c-.7-.8-2.4-2.5-2.4-7.1a5 5 0 0 0-5-5Z" /><path d="M8 17.2a2.2 2.2 0 0 0 4 0" /></>,
  enviar: <><path d="m3.4 2.8 14 7.2-14 7.2 2.8-7.2Z" /><path d="M6.2 10h4.6" /></>,
  salvar: <path d="M5 2.8h10v15l-5-3.6-5 3.6Z" />,
  fechar: <path d="m5 5 10 10M15 5 5 15" />,
  chat: <path d="M3.2 4.2h13.6v9.2H8.6l-3.8 3v-3H3.2Z" />,
  atualizar: <><path d="M16.4 8.4A6.6 6.6 0 0 0 4.2 6.2M3.6 11.6a6.6 6.6 0 0 0 12.2 2.2" /><path d="M4 2.6v3.8h3.8M16 17.4v-3.8h-3.8" /></>,
  raio: <path d="M11.4 1.6 4.6 11h4.6l-1 7.4L15 9h-4.6Z" />,
  skills: <><path d="M4 3.2h8.6l3.4 3.4v10.2H4Z" /><path d="M12.4 3.4v3.4h3.4M7 10h6M7 13h4" /></>,
  calendario: <><rect x="3" y="4.2" width="14" height="12.6" rx="2.4" /><path d="M3 8.4h14M7 2.6v3.2M13 2.6v3.2" /></>,
  config: <><circle cx="10" cy="10" r="2.6" /><path d="M10 2.2v2.2M10 15.6v2.2M2.2 10h2.2M15.6 10h2.2M4.5 4.5l1.6 1.6M13.9 13.9l1.6 1.6M4.5 15.5l1.6-1.6M13.9 6.1l1.6-1.6" /></>,
  play: <path d="M6 4.2v11.6L15.6 10Z" />,
  coracao: <path d="M10 16.6s-6.4-3.9-6.4-8.5A3.6 3.6 0 0 1 10 5.9a3.6 3.6 0 0 1 6.4 2.2c0 4.6-6.4 8.5-6.4 8.5Z" />,
  like: <path d="M6.4 8.6 9.6 2.8c1.2 0 2 .9 1.8 2.1l-.5 2.9h4.2c1 0 1.8.9 1.6 1.9l-1.1 6.2c-.2.8-.9 1.3-1.7 1.3H6.4ZM6.4 8.6H3.2v8.6h3.2" />,
  deslike: <path d="M13.6 11.4 10.4 17.2c-1.2 0-2-.9-1.8-2.1l.5-2.9H4.9c-1 0-1.8-.9-1.6-1.9l1.1-6.2c.2-.8.9-1.3 1.7-1.3h7.5ZM13.6 11.4h3.2V2.8h-3.2" />,
  som: <><path d="M3.2 7.6h3l4-3.2v11.2l-4-3.2h-3Z" /><path d="M13.4 7.2a4 4 0 0 1 0 5.6M15.6 5a7 7 0 0 1 0 10" /></>,
  mudo: <><path d="M3.2 7.6h3l4-3.2v11.2l-4-3.2h-3Z" /><path d="m13.2 7.6 4.4 4.8M17.6 7.6l-4.4 4.8" /></>,
  nota: <><path d="M5 2.8h7l3 3v11.4H5Z" /><path d="M11.8 3v3h3M7.6 10h4.8M7.6 13h3.4" /></>,
  mais: <path d="M10 4v12M4 10h12" />,
  editar: <><path d="M3.6 16.4 4.4 13l8.8-8.8 2.6 2.6L7 15.6Z" /><path d="m11.6 5.8 2.6 2.6" /></>,
  ler: <><path d="M10 5.6C8.4 4.4 6 3.8 2.8 4v11.4c3.2-.2 5.6.4 7.2 1.6 1.6-1.2 4-1.8 7.2-1.6V4C14 3.8 11.6 4.4 10 5.6Z" /><path d="M10 5.6V17" /></>,
  pin: <><path d="M7.4 2.8h5.2l-.8 5 3 3H5.2l3-3Z" /><path d="M10 10.8v6.4" /></>,
  pasta: <path d="M2.8 5.4c0-.8.6-1.4 1.4-1.4h3.6l1.8 2h6.2c.8 0 1.4.6 1.4 1.4v7.8c0 .8-.6 1.4-1.4 1.4H4.2c-.8 0-1.4-.6-1.4-1.4Z" />,
  publicar: <><path d="M10 13V3.4M6.2 7 10 3.2 13.8 7" /><path d="M3.6 12.4v3.2c0 .8.6 1.4 1.4 1.4h10c.8 0 1.4-.6 1.4-1.4v-3.2" /></>,
  link: <><path d="M8.6 11.4a3.4 3.4 0 0 0 4.8 0l2.4-2.4a3.4 3.4 0 0 0-4.8-4.8l-1 1" /><path d="M11.4 8.6a3.4 3.4 0 0 0-4.8 0L4.2 11a3.4 3.4 0 0 0 4.8 4.8l1-1" /></>,
  lixeira: <><path d="M3.6 5.4h12.8M8 5.4V3.4h4v2M5.2 5.4l.8 11.2h8l.8-11.2" /><path d="M8.4 8.6v5M11.6 8.6v5" /></>,
  painel: <><rect x="2.8" y="3.6" width="14.4" height="12.8" rx="2.4" /><path d="M7.6 3.6v12.8" /></>,
  radar: <><circle cx="10" cy="10" r="7.2" /><circle cx="10" cy="10" r="3.8" /><path d="M10 10 15.1 4.9" /><circle cx="10" cy="10" r=".6" /></>,
  grafico: <path d="M3.2 16.8h13.6M5.6 13.6V9.8M9 13.6V5.6M12.4 13.6v-5.2M15.8 13.6V7" />,
  xlogo: <path d="M4 3.4h3.3l8.7 13.2h-3.3ZM15.6 3.4 4.4 16.6" />,
  instagram: <><rect x="3.2" y="3.2" width="13.6" height="13.6" rx="4" /><circle cx="10" cy="10" r="3.2" /><circle cx="14" cy="6" r=".5" /></>,
  globo: <><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2.2 2.8 4.5 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.5-2.8-7S8 5.2 10 3Z" /></>,
  olho: <><path d="M1.8 10S4.8 4.6 10 4.6 18.2 10 18.2 10 15.2 15.4 10 15.4 1.8 10 1.8 10Z" /><circle cx="10" cy="10" r="2.6" /></>,
  grafo: <><rect x="2.6" y="3" width="6" height="4.6" rx="1.4" /><rect x="11.4" y="12.4" width="6" height="4.6" rx="1.4" /><rect x="11.4" y="3" width="6" height="4.6" rx="1.4" /><path d="M8.6 5.3h2.8M5.6 7.6v4.6c0 1.2.8 2.5 2.4 2.5h3.4" /></>,
  ferramenta: <path d="M12.6 3.2a4 4 0 0 0-4.9 5.2l-4.6 4.6a1.7 1.7 0 0 0 2.4 2.4l4.6-4.6a4 4 0 0 0 5.2-4.9l-2.4 2.4-2.1-.6-.6-2.1Z" />,
  expandir: <path d="M3.4 7.6V3.4h4.2M12.4 3.4h4.2v4.2M16.6 12.4v4.2h-4.2M7.6 16.6H3.4v-4.2" />,
  usuario:<><circle cx="10" cy="6.4" r="3.6" /><path d="M3 17.6c.4-3.6 3-5.4 7-5.4s6.6 1.8 7 5.4" /></>,
}

export function Icone({ n, t = 18 }: { n: keyof typeof P | string; t?: number }) {
  return (
    <svg className="i" width={t} height={t} viewBox={n === 'seta' ? '0 0 16 16' : '0 0 20 20'} aria-hidden="true">
      {P[n]}
    </svg>
  )
}

export function Fonte({ f, so }: { f: string; so?: boolean }) {
  const nome: Record<string, string> = { github: 'GitHub', huggingface: 'Hugging Face', hackernews: 'Hacker News', x: 'X', instagram: 'Instagram' }
  const sigla: Record<string, string> = { github: 'GH', huggingface: 'HF', hackernews: 'HN', x: 'X', instagram: 'IG' }
  return (
    <span className={`fonte fonte--${f}`}>
      <b>{sigla[f] ?? '?'}</b>
      {!so && (nome[f] ?? f)}
    </span>
  )
}
