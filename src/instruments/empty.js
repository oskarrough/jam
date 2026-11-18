// No instrument: what an empty seat holds in a jam that starts blank (/j/<name>). Silent, draws nothing on its ring,
// and its sheet points at the glyphs. Registered so it syncs, replays and saves like any part; kept out of the picker.
import { theme } from './lib/util.js'

export default {
	id: 'empty',
	name: 'Empty',
	hidden: true,
	how: 'Pick an instrument from the glyphs above.',
	glyph: '<path d="M16 10v12M10 16h12" stroke-width="1.4"/>',
	playhead: false,
	create(ctx) {
		const th = theme(ctx)
		return {
			state: null,
			setState() {},
			clear() {},
			pointer() {},
			step() {},
			frame(g, w, h, clock, shape) {
				if (shape !== 'sheet') return
				g.fillStyle = th.dim
				g.font = `${Math.round(Math.max(13, Math.min(w, h) * 0.04))}px ${th.font}`
				g.textAlign = 'center'
				g.textBaseline = 'middle'
				g.fillText('no instrument yet: pick one above', w / 2, h / 2)
			},
			dispose() {},
		}
	},
}
