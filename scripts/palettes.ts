// Renders the real screens in each candidate palette to an HTML page, for
// picking a theme: `bun scripts/palettes.ts > out.html`.

import type { Feed, View } from '../plugin/types'
import { draw, initialState, type AppState } from '../plugin/client/app'
import { VGA, parsePipe } from '../plugin/shared/pipe'

type Theme = { id: string; name: string; blurb: string; pal: number[] }

// Each theme reprograms the 16 VGA registers, as a DOS board's palette did.
// Roles in the screens: 5 dark accent + lightbar bg, 13 accent, 15 bright,
// 7 text, 8 frames, 11 handles, 10 ok, 12 new/error, 14 warning.
const base = [...VGA]
const theme = (over: Record<number, number>) => base.map((c, i) => over[i] ?? c)
const THEMES: Theme[] = [
  { id: 'ultraviolet', name: 'Ultraviolet', blurb: 'What ships today: magenta on black.', pal: theme({}) },
  { id: 'ice', name: 'ACiD Ice', blurb: 'Cyan and deep blue, the 1990s ANSI-pack default.', pal: theme({ 5: 0x0000aa, 13: 0x55ffff, 11: 0x55aaff, 8: 0x3a4a6a }) },
  { id: 'telegard', name: 'Telegard Grey', blurb: 'Grey ramp with a blue lightbar. Quiet, very elite.', pal: theme({ 5: 0x0000aa, 13: 0xffffff, 11: 0x55ffff, 15: 0xffffff }) },
  { id: 'fire', name: 'Iniquity Fire', blurb: 'Red, orange and yellow. Loud in the best way.', pal: theme({ 5: 0xaa0000, 13: 0xff8800, 11: 0xffff55, 8: 0x6a3a2a, 12: 0xff5555 }) },
  { id: 'amber', name: 'Amber CRT', blurb: 'Monochrome amber phosphor. Every color is a shade of orange.', pal: [0x000000, 0x553300, 0x885500, 0xaa6600, 0x995500, 0x773d00, 0xaa6a00, 0xcc8800, 0x5a3a10, 0xdd9922, 0xffbb33, 0xffaa22, 0xffcc66, 0xffaa00, 0xffdd88, 0xffe0a0] },
  { id: 'phosphor', name: 'Green Phosphor', blurb: 'A VT220 on a night shift. Monochrome green.', pal: [0x000000, 0x003300, 0x116611, 0x1a7a1a, 0x226622, 0x0a4a0a, 0x2a8a2a, 0x33bb33, 0x1a4a1a, 0x44cc44, 0x55ff55, 0x66ee66, 0x88ff88, 0x44ff44, 0xaaffaa, 0xccffcc] },
]

const now = Date.now()
const ago = (s: number) => new Date(now - s * 1000).toISOString()
const feed: Feed = {
  v: 1, seq: 42, generatedAt: ago(3), motd: '|07a board for the hours |13Claude|07 is busy',
  oneliners: [{ id: 1, handle: 'Phiber', text: '|11hack the planet', ts: ago(60) }],
  rumors: [], lastCallers: [],
  nodes: [{ node: 1, handle: 'Acid Burn', status: 'tool:Bash', since: ago(40) }, { node: 2, handle: 'mattf', status: 'thinking', since: ago(5) }],
  stats: { users: 31, callsToday: 12, callsTotal: 512, onelinersTotal: 88, postsTotal: 140 },
  conferences: [
    { n: 1, slug: 'general', name: 'General', sponsor: 'SysOp', description: 'Anything goes. Mostly.', posts: 96, lastPostId: 96, lastPostAt: ago(120) },
    { n: 2, slug: 'claude', name: 'Claude Talk', sponsor: 'SysOp', description: 'Prompts, skills, hooks.', posts: 31, lastPostId: 31, lastPostAt: ago(900) },
    { n: 3, slug: 'showoff', name: 'Show Off', sponsor: 'Acid Burn', description: '', posts: 13, lastPostId: 13, lastPostAt: ago(4000) },
  ],
  polls: [{ id: 2, question: 'Which modem did you have first?', options: [{ text: '2400 baud', votes: 3 }, { text: '14.4k', votes: 9 }, { text: 'US Robotics Courier', votes: 5 }], total: 17, closed: false, createdAt: ago(7200) }],
  top: { posters: [], callers: [], oneliners: [] },
}
const view: View = {
  phase: 'ready', busy: false, claude: 'running Bash…', feed, me: { handle: 'mattf', location: 'Toronto', node: 2 }, lastRead: { general: 90, claude: 31 }, votes: {},
  thread: { slug: 'general', id: 3, subject: 'what are you building?', total: 7, focus: 95, posts: [{ id: 95, n: 6, handle: 'Acid Burn', to: 'mattf', subject: 'Re: what are you building?', ts: ago(400), replyTo: 94, body: '> a BBS that lives in a Claude Code pane\n\n|11no way.|07 does it have a voting booth? because if it\ndoes not have a voting booth i am not calling.\n\n  -=|13AB|07=-' }] },
}

const screens: { label: string; state: Partial<AppState>; h: number }[] = [
  { label: 'Matrix', state: { screen: 'matrix' }, h: 14 },
  { label: 'Main menu', state: { screen: 'main', sel: 2 }, h: 12 },
  { label: 'Base change', state: { screen: 'bases', list: 1 }, h: 9 },
  { label: 'Reading a message', state: { screen: 'read', reader: { slug: 'general', thread: 3, scroll: 0, fromScan: false } }, h: 13 },
  { label: 'Voting booth', state: { screen: 'poll', poll: 2 }, h: 9 },
]

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const index = new Map(VGA.map((c, i) => [c, i]))

function render(t: Theme, s: Partial<AppState>, h: number): string {
  const lines = draw({ ...initialState(), onBoard: true, ...s } as AppState, view, 80, h, now)
  return lines
    .map(line => {
      let out = ''
      let run = ''
      let key = ''
      const flush = () => {
        if (run) out += `<span style="${key}">${esc(run)}</span>`
        run = ''
      }
      for (const c of parsePipe(line)) {
        const k = `color:${hex(t.pal[index.get(c.fg)!])};background:${hex(t.pal[index.get(c.bg)!])}`
        if (k !== key) {
          flush()
          key = k
        }
        run += c.ch
      }
      flush()
      return out
    })
    .join('\n')
}

const panels = THEMES.map(
  (t, i) => `
  <section class="panel" id="p-${t.id}" ${i ? 'hidden' : ''} aria-labelledby="t-${t.id}">
    <div class="meta">
      <div><h2>${t.name}</h2><p>${t.blurb}</p></div>
      <ol class="regs" aria-label="Palette registers 0 to 15">${t.pal.map((c, r) => `<li title="|${String(r).padStart(2, '0')} ${hex(c)}"><span style="background:${hex(c)}"></span><b>${r}</b></li>`).join('')}</ol>
    </div>
    <div class="screens">${screens
      .map(sc => `<figure><figcaption>${sc.label}</figcaption><div class="crt" style="background:${hex(t.pal[0])}"><pre>${render(t, sc.state, sc.h)}</pre></div></figure>`)
      .join('')}</div>
  </section>`,
).join('')

const tabs = THEMES.map((t, i) => `<button role="tab" id="t-${t.id}" aria-controls="p-${t.id}" aria-selected="${i === 0}" data-id="${t.id}"><span class="dot" style="background:${hex(t.pal[13])};box-shadow:inset 0 0 0 3px ${hex(t.pal[5])}"></span>${t.name}</button>`).join('')

console.log(`<title>lATENT sPACE Palettes</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Space+Mono:wght@700&display=swap">
<style>
/* One dark room, CRTs on the wall: tabs pick a palette, screens are the real draw() output. */
:root {
  --room: #0d0c10; --panel: #16141b; --line: #2a2631; --ink: #e8e4ee; --dim: #8f889c; --focus: #ffcc66;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --head: "Space Mono", "IBM Plex Mono", ui-monospace, monospace;
  color-scheme: dark;
}
body { background: var(--room); color: var(--ink); font-family: var(--mono); }
.wrap { max-width: 1180px; margin: 0 auto; padding-inline: 16px; padding-block: 28px 48px; display: grid; gap: 22px; }
header h1 { font-family: var(--head); font-size: clamp(22px, 3vw, 30px); margin: 0 0 6px; letter-spacing: .02em; text-wrap: balance; }
header p { margin: 0; color: var(--dim); max-width: 68ch; line-height: 1.55; font-size: 13.5px; }
[role=tablist] { display: flex; flex-wrap: wrap; gap: 8px; }
[role=tab] { font: 600 13px var(--mono); color: var(--dim); background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 8px 12px; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
[role=tab][aria-selected=true] { color: var(--ink); border-color: var(--dim); }
[role=tab]:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.dot { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
.panel { display: grid; gap: 18px; }
.meta { display: flex; flex-wrap: wrap; gap: 16px 32px; justify-content: space-between; align-items: end; border-bottom: 1px solid var(--line); padding-block: 4px 16px; }
.meta h2 { font-family: var(--head); font-size: 20px; margin: 0 0 4px; }
.meta p { margin: 0; color: var(--dim); font-size: 13px; }
.regs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(16, 22px); gap: 3px; }
.regs li { display: grid; gap: 2px; justify-items: center; }
.regs span { width: 22px; height: 22px; border-radius: 2px; box-shadow: inset 0 0 0 1px #ffffff1f; }
.regs b { font-weight: 400; font-size: 9.5px; color: var(--dim); font-variant-numeric: tabular-nums; }
.screens { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 540px), 1fr)); gap: 18px; }
figure { margin: 0; display: grid; gap: 6px; min-width: 0; }
figcaption { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }
.crt { border-radius: 6px; border: 1px solid var(--line); padding: 10px 12px; overflow-x: auto; }
.crt pre { margin: 0; font: 12px/1.02 var(--mono); letter-spacing: 0; }
@media (max-width: 600px) { .regs { grid-template-columns: repeat(8, 22px); } }
</style>
<div class="wrap">
  <header>
    <h1>lATENT sPACE palettes</h1>
    <p>Each theme reprograms the 16 VGA color registers, the way a DOS board did. Every screen, the logo gradient and callers' own pipe colors change together. These are the real screens from the mod, drawn at 80 columns.</p>
  </header>
  <div role="tablist" aria-label="Palette">${tabs}</div>
  ${panels}
</div>
<script>
const tabs = [...document.querySelectorAll('[role=tab]')]
function pick(id) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.id === id))
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== 'p-' + id
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => pick(t.dataset.id))
  t.addEventListener('keydown', e => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    const n = tabs[(i + d + tabs.length) % tabs.length]
    n.focus(); pick(n.dataset.id)
  })
})
</script>`)
