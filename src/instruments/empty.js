// No instrument: what an empty seat holds in a jam that starts blank (/j/<name>). Silent, draws nothing on its ring,
// and its sheet points an arrow at the glyphs. Registered so it syncs, replays and saves like any part; kept out of the picker.
import { theme } from './lib/util.js'

export default {
	id: 'empty',
	name: 'Empty',
	hidden: true,
	ownLength: true, // nothing to loop yet, so no bracket
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
				// a dotted arrow rising from the middle to the glyphs above, bobbing gently
				const m = Math.min(w, h),
					bob = Math.sin(clock.now() * 2.5) * m * 0.01,
					x = w / 2,
					y0 = h * 0.62 + bob,
					y1 = h * 0.18 + bob,
					head = m * 0.05
				g.strokeStyle = th.dim
				g.lineWidth = Math.max(1.5, m * 0.004)
				g.lineCap = g.lineJoin = 'round'
				g.setLineDash([2, 7])
				g.beginPath()
				g.moveTo(x, y0)
				g.lineTo(x, y1 + 4)
				g.stroke()
				g.setLineDash([])
				g.beginPath()
				g.moveTo(x - head, y1 + head)
				g.lineTo(x, y1)
				g.lineTo(x + head, y1 + head)
				g.stroke()
			},
			dispose() {},
		}
	},
}
