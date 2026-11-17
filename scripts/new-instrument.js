#!/usr/bin/env node
// Writes src/instruments/<name>.js from a small working template and registers it.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'src/instruments')
const raw = process.argv[2]
if (!raw) {
	console.error('usage: pnpm new-instrument <name>')
	process.exit(1)
}
const id = raw
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, '-')
	.replace(/^-|-$/g, '')
if (!/^[a-z]/.test(id)) {
	console.error(`"${raw}" needs to start with a letter`)
	process.exit(1)
}
const ident = id.replace(/-(.)/g, (_, c) => c.toUpperCase())
const name = id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())
const file = join(dir, `${id}.js`)
if (existsSync(file)) {
	console.error(`src/instruments/${id}.js already exists`)
	process.exit(1)
}

writeFileSync(
	file,
	`// ${name}: tap to drop a note. Across is time, up is pitch. Tap a note again to lift it.

import { mtof, env, osc, rgba } from './lib/util.js'

const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22]
const ROOT = 57

export default {
	id: '${id}',
	name: '${name}',
	how: 'Tap to drop a note; tap it again to lift it.',
	glyph: '<circle class="f" cx="9" cy="20" r="2.5"/><circle class="f" cx="16" cy="12" r="2.5"/><circle class="f" cx="23" cy="17" r="2.5"/>',
	params: {
		decay: { value: 0.5, min: 0.05, max: 2, step: 0.05 },
		shape: { value: 'triangle', options: ['sine', 'triangle', 'square', 'sawtooth'] },
	},

	generate: (steps) => ({ notes: Array.from({ length: 6 }, () => [Math.floor(Math.random() * steps), Math.floor(Math.random() * SCALE.length)]) }),
	sample: (steps) => ({ notes: [[0, 0], [Math.floor(steps / 4), 4], [Math.floor(steps / 2), 2], [Math.floor((3 * steps) / 4), 6]] }),

	create(ctx) {
		const { audio, out, clock, params } = ctx
		let notes = [] // [step, degree]: the whole state, plain JSON

		return {
			get state() { return { notes } },
			setState(s) { notes = s?.notes ? s.notes.map((n) => [...n]) : [] },
			clear() { notes = [] },

			// 2. play: x, y in 0..1 (y = 0 at the top, which is the outside of your ring)
			pointer(e) {
				if (e.type !== 'down') return
				const step = Math.min(clock.steps - 1, Math.floor(e.x * clock.steps))
				const degree = Math.min(SCALE.length - 1, Math.floor((1 - e.y) * SCALE.length))
				const i = notes.findIndex(([s, d]) => s === step && d === degree)
				if (i >= 0 || e.alt) notes = notes.filter(([s, d]) => !(s === step && d === degree))
				else notes.push([step, degree])
			},

			// 3. schedule: called just ahead of time for every 16th; time is AudioContext seconds
			step(i, time) {
				for (const [s, d] of notes) {
					if (s % clock.steps !== i) continue
					const g = audio.createGain()
					env(g, time, 0.005, 0.2, params.decay)
					g.connect(out)
					osc(audio, params.shape, mtof(ROOT + SCALE[d]), time, params.decay + 0.1, g)
				}
			},

			frame(g, w, h, clock, shape) {
				const n = clock.steps, pos = clock.pos()
				if (shape === 'sheet') {
					g.strokeStyle = rgba(ctx.color, 0.15)
					for (let s = 0; s <= n; s += 4) { g.beginPath(); g.moveTo((s / n) * w, 0); g.lineTo((s / n) * w, h); g.stroke() }
				}
				const r = shape === 'sheet' ? Math.min(w / n, h / SCALE.length) * 0.35 : Math.max(2, h * 0.08)
				for (const [s, d] of notes) {
					const since = (pos - s + n) % n, lit = since < 1.5 ? 1 - since / 1.5 : 0
					g.fillStyle = ctx.color
					g.beginPath()
					g.arc(((s + 0.5) / n) * w, (1 - (d + 0.5) / SCALE.length) * h, r * (1 + lit * 0.6), 0, Math.PI * 2)
					g.fill()
				}
			},

			dispose() {},
		}
	},
}
`,
)

const index = join(dir, 'index.js')
let src = readFileSync(index, 'utf8')
const marker = '// new instruments: imported above this line by `pnpm new-instrument`'
src = src.replace(marker, `import ${ident} from './${id}.js'\n${marker}`)
src = src.replace(/(export const instruments = \[[^\]]*)\]/, `$1, ${ident}]`)
writeFileSync(index, src)

console.log(`made src/instruments/${id}.js and registered it.
open /?instrument=${id} to sit down with it (serve the repo root first, e.g. python3 -m http.server)`)
