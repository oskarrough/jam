// Shapes for an instrument's `demo`: the gesture a ghost hand plays once when you switch to it.
// A demo is a list of strokes of [x, y] in 0..1 (lane-local); one point is a tap.

export const tap = (x, y) => [[x, y]]
export const line = (x0, y0, x1, y1, n = 14) =>
	Array.from({ length: n + 1 }, (_, k) => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n])
export const wave = (x0, x1, y, amp, turns = 1.5, n = 22) =>
	Array.from({ length: n + 1 }, (_, k) => {
		const f = k / n
		return [x0 + (x1 - x0) * f, y - amp * Math.sin(f * turns * Math.PI * 2)]
	})
// part of a circle around (cx, cy), r a fraction of the sheet's short side, angles in turns clockwise from
// twelve; aspect = w / h keeps it round on screen
export const arc = (cx, cy, r, a0, a1, aspect = 1, n = 20) =>
	Array.from({ length: n + 1 }, (_, k) => {
		const a = (a0 + ((a1 - a0) * k) / n) * Math.PI * 2
		return [
			cx + Math.sin(a) * r * Math.min(1, 1 / aspect),
			cy - Math.cos(a) * r * Math.min(aspect, 1),
		]
	})
