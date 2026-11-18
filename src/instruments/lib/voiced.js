// Voices as inks: [[name, fn, mark], …] becomes the instrument's inks (chips under the sheet, one per stroke).
// The first is the default. Each ink leaves its own mark on the drawing: a note head shape (the chip shows
// the same shape) and a dash on the stroke's colour pass. fn(ctx, midi, time, dur, gain?).
// Parts saved before inks had one `voice` param for the whole seat; legacy(ctx) is that voice's ink,
// for strokes that don't carry one.

// a head's path, centred on x, y, about r across
const MARKS = {
	dot: (p, x, y, r) => p.arc(x, y, r, 0, 6.283),
	ring: (p, x, y, r) => {
		p.arc(x, y, r * 1.15, 0, 6.283)
		p.moveTo(x + r * 0.45, y)
		p.arc(x, y, r * 0.45, 0, 6.283) // the hole: head() fills evenodd
	},
	bar: (p, x, y, r) => p.roundRect(x - r * 1.35, y - r * 0.7, r * 2.7, r * 1.4, r * 0.5),
	tall: (p, x, y, r) => p.roundRect(x - r * 0.65, y - r * 1.45, r * 1.3, r * 2.9, r * 0.6),
	diamond: (p, x, y, r) => {
		p.moveTo(x, y - r * 1.45)
		p.lineTo(x + r * 1.15, y)
		p.lineTo(x, y + r * 1.45)
		p.lineTo(x - r * 1.15, y)
		p.closePath()
	},
	tri: (p, x, y, r) => {
		p.moveTo(x - r * 1.3, y + r)
		p.lineTo(x + r * 1.3, y + r)
		p.lineTo(x - r * 1.3, y - r * 1.4)
		p.closePath()
	},
	square: (p, x, y, r) => p.rect(x - r, y - r, r * 2, r * 2),
}
// the stroke's colour pass, in line widths: solid, or broken so the ink under it shows through
const DASHES = {
	dot: [],
	ring: [0.1, 2.2],
	bar: [5, 2],
	tall: [0.1, 1.8, 3, 1.8],
	diamond: [2.5, 2],
	tri: [4, 1.4, 0.1, 1.4],
	square: [1.6, 1.6],
}
// the chip: the mark big, over a short stroke in its dash
const svgOf = (mark) => {
	const p = svgPath()
	MARKS[mark](p, 16, 14, 6)
	const dash = DASHES[mark].map((d) => +(d * 2.2).toFixed(1)).join(' ')
	return (
		`<path d="M3 27h26" stroke-width="2.2"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` +
		`<path class="f" fill-rule="evenodd" d="${p.d}"/>`
	)
}

export function voiced(list, params = {}) {
	const names = list.map(([n]) => n)
	const at = (i) => list[i] || list[0]
	return {
		inks: list.map(([n, , mark]) => [n, svgOf(mark)]),
		names,
		params,
		fn: (i) => at(i)[1],
		mark: (i) => at(i)[2],
		index: (name) => Math.max(0, names.indexOf(name)),
		legacy: (ctx) => Math.max(0, names.indexOf(ctx.params.voice)),
	}
}

// one note head in its ink's shape; fill and stroke styles are the caller's
export function head(g, mark, x, y, r) {
	g.beginPath()
	;(MARKS[mark] || MARKS.dot)(g, x, y, r)
	g.fill('evenodd')
	g.stroke()
}
export const dash = (mark, lw) => (DASHES[mark] || []).map((d) => d * lw)

// just enough of a canvas path to write an svg one
function svgPath() {
	let d = ''
	const n = (v) => +v.toFixed(2)
	const pt = (x, y) => `${n(x)} ${n(y)}`
	const arcTo = (r, x, y) => `a${n(r)} ${n(r)} 0 0 1 ${pt(x, y)}`
	return {
		get d() {
			return d
		},
		moveTo: (x, y) => (d += `M${pt(x, y)}`),
		lineTo: (x, y) => (d += `L${pt(x, y)}`),
		closePath: () => (d += 'Z'),
		rect: (x, y, w, h) => (d += `M${pt(x, y)}h${n(w)}v${n(h)}h${n(-w)}Z`),
		roundRect: (x, y, w, h, r) =>
			(d +=
				`M${pt(x + r, y)}h${n(w - 2 * r)}${arcTo(r, r, r)}v${n(h - 2 * r)}${arcTo(r, -r, r)}` +
				`h${n(2 * r - w)}${arcTo(r, -r, -r)}v${n(2 * r - h)}${arcTo(r, r, -r)}Z`),
		// whole circles only
		arc: (x, y, r) =>
			(d += `M${pt(x + r, y)}A${n(r)} ${n(r)} 0 1 1 ${pt(x - r, y)}A${n(r)} ${n(r)} 0 1 1 ${pt(x + r, y)}Z`),
	}
}
