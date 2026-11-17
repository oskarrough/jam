// TEMPORARY: ten takes on the seat badge and its caption, behind ?seat=1..10. ?seatdemo fakes one seat of each kind
// (you, a player, a robot, empty) so a single shot shows every state. Pick one, fold it into view.js, delete this file.
import { INK, SERIF } from './palette.js'
import { rgba } from './instruments/lib/util.js'

const TAU = Math.PI * 2
const SYNE = 'Syne, "Bricolage Grotesque", sans-serif'
const q = new URLSearchParams(location.search)
export const seatVariant = +q.get('seat') || 0
export const seatDemo = q.has('seatdemo')
const ink = (a) => rgba(INK, a)

// one occupant of each kind round the dial: you, a player, a robot, an empty seat
export function demoOccupant(i, real) {
	return (
		[
			{ name: 'you', label: 'you', initial: 'O', me: true, human: true },
			{ name: 'maja', label: 'maja', initial: 'm', human: true },
			{ name: 'Robot C', label: 'Robot C', initial: 'C', bot: true },
			{ name: '', label: 'sit' },
		][i % 4] || real
	)
}

// letters along a circle round (ox, oy), centred on angle a, upright on both halves.
// o: { px, font, upper, track, col, halo, align: 'center'|'start'|'end', flip }
export function arcText(g, ox, oy, text, a, R, o = {}) {
	const px = o.px || 12
	g.save()
	g.font = o.font || `600 ${Math.round(px)}px ${SYNE}`
	g.textAlign = 'center'
	g.textBaseline = 'middle'
	const chars = [...(o.upper === false ? text : text.toUpperCase())]
	const ws = chars.map((ch) => g.measureText(ch).width + px * (o.track ?? 0.16))
	const total = ws.reduce((x, y) => x + y, 0)
	const bottom = o.flip ?? Math.sin(a) > 0.05,
		dir = bottom ? -1 : 1
	const off = o.align === 'start' ? 0 : o.align === 'end' ? total : total / 2
	const t = a - (dir * off) / R
	if (o.halo) {
		g.lineJoin = 'round'
		g.lineWidth = Math.max(2.5, px * 0.28)
		g.strokeStyle = o.halo
	}
	for (const pass of o.halo ? ['stroke', 'fill'] : ['fill']) {
		let u = t
		for (let k = 0; k < ws.length; k++) {
			const mid = u + (dir * ws[k]) / R / 2
			g.save()
			g.translate(ox + Math.cos(mid) * R, oy + Math.sin(mid) * R)
			g.rotate(mid + (bottom ? -Math.PI / 2 : Math.PI / 2))
			if (pass === 'stroke') g.strokeText(chars[k], 0, 0)
			else {
				g.fillStyle = o.col || INK
				g.fillText(chars[k], 0, 0)
			}
			g.restore()
			u += (dir * ws[k]) / R
		}
	}
	g.restore()
	return total / R // angular width
}

// text running straight out along the radius from (x, y) at angle a; reads outward on the right half, inward on the left
function rayText(g, x, y, a, text, font, col, halo) {
	g.save()
	g.translate(x, y)
	const left = Math.cos(a) < 0
	g.rotate(left ? a + Math.PI : a)
	g.font = font
	g.textAlign = left ? 'right' : 'left'
	g.textBaseline = 'middle'
	if (halo) {
		g.lineJoin = 'round'
		g.lineWidth = 3
		g.strokeStyle = halo
		g.strokeText(text, 0, 0)
	}
	g.fillStyle = col
	g.fillText(text, 0, 0)
	g.restore()
}

const who = (c) => (c.empty ? '' : c.st.label)
const caps = (c) => (c.dark ? c.PAPER : INK)
const halo = (c) => rgba(c.G.sky[c.dark ? 0 : 2], 0.85)

function disc(c, rr = c.r, seed = c.i * 5 + 2) {
	c.wobble(c.g, c.x, c.y, rr, seed, 0.6, { a: c.J.a, depth: c.J.s.x * rr * 0.4, w: 0.7 })
}
function glyph(c, color, k = 0.78, x = c.x, y = c.y) {
	const img = c.glyphImg(c.L.module.id, color)
	if (img) c.g.drawImage(img, x - c.r * k, y - c.r * k, c.r * k * 2, c.r * k * 2)
}
// your seat: a marching dashed orbit (the current look)
function orbit(c, k = 6) {
	const g = c.g
	g.save()
	g.strokeStyle = INK
	g.lineWidth = 1
	g.setLineDash([3, 4])
	g.lineDashOffset = c.reduce ? 0 : -c.t / 120
	c.wobble(g, c.x, c.y, c.r + k, c.i * 7 + 3, 0.8)
	g.stroke()
	g.restore()
}
function shadow(c, rr = c.r) {
	c.g.fillStyle = 'rgba(40,25,60,.45)'
	c.g.beginPath()
	c.g.arc(c.x + 3, c.y + 4, rr, 0, TAU)
	c.g.fill()
}

const V = {}

// 1 socket: an empty seat is a hole punched in the night, a taken one a coin pressed into it.
// Caption is the instrument, then who, in Fraunces italic; an empty seat just names its instrument.
V[1] = {
	badge(c) {
		const g = c.g
		if (c.empty) {
			disc(c)
			g.fillStyle = ink(0.55)
			g.fill()
			g.strokeStyle = rgba(c.PAPER, 0.7)
			g.lineWidth = 1
			g.setLineDash([2, 3])
			g.stroke()
			g.setLineDash([])
			glyph(c, rgba(c.PAPER, 0.45))
			return
		}
		if (c.me) (shadow(c), orbit(c))
		disc(c)
		g.fillStyle = c.color
		g.fill()
		g.strokeStyle = INK
		g.lineWidth = c.me ? 2.4 : 1.1
		g.stroke()
		glyph(c, c.PAPER)
	},
	caption(c) {
		const txt = c.empty ? c.name : `${c.name}, ${who(c)}${c.tag}`
		arcText(c.g, c.CX, c.CY, txt, c.a, c.Rcap, {
			px: c.px * 1.25,
			font: `italic ${c.me ? 700 : 500} ${Math.round(c.px * 1.25)}px ${SERIF}`,
			upper: false,
			track: 0.04,
			col: c.empty ? rgba(caps(c), 0.6) : caps(c),
			halo: halo(c),
		})
	},
}

// 2 bead on a string: the badge sits between two words on the badge circle itself.
// Instrument runs off one side, who sits there off the other. Empty: the other side is a dotted thread.
V[2] = {
	badge(c) {
		V[1].badge({ ...c, empty: false, color: c.empty ? c.PAPER : c.color, me: c.me })
		if (c.empty) {
			c.g.strokeStyle = INK
			c.g.lineWidth = 1.1
			c.g.setLineDash([2.5, 3])
			disc(c)
			c.g.fillStyle = c.PAPER
			c.g.fill()
			c.g.stroke()
			c.g.setLineDash([])
			glyph(c, ink(0.55))
		}
	},
	caption(c) {
		const R = c.Rbadge,
			gap = (c.r + 8) / R,
			o = {
				px: c.px,
				col: caps(c),
				halo: halo(c),
				font: `${c.me ? 800 : 600} ${Math.round(c.px)}px ${SYNE}`,
			}
		// reading order on either half: instrument, badge, who
		const dir = Math.sin(c.a) > 0.05 ? -1 : 1
		arcText(c.g, c.CX, c.CY, c.name, c.a - dir * gap, R, { ...o, align: 'end' })
		if (c.empty) {
			const g = c.g
			g.save()
			g.strokeStyle = rgba(caps(c), 0.7)
			g.lineWidth = 1.2
			g.setLineDash([1, 5])
			g.lineCap = 'round'
			g.beginPath()
			const a0 = c.a + dir * gap
			g.arc(c.CX, c.CY, R, Math.min(a0, a0 + dir * 0.32), Math.max(a0, a0 + dir * 0.32))
			g.stroke()
			g.restore()
		} else arcText(c.g, c.CX, c.CY, who(c) + c.tag, c.a + dir * gap, R, { ...o, align: 'start' })
	},
}

// 3 coin: the legend runs round the badge itself, like a coin's edge. Empty: just the instrument and a dashed
// rest of the rim waiting for a name.
V[3] = {
	badge(c) {
		const g = c.g
		if (c.me) shadow(c)
		disc(c)
		g.fillStyle = c.empty ? c.PAPER : c.color
		g.fill()
		g.strokeStyle = INK
		g.lineWidth = c.me ? 2.2 : 1.1
		g.stroke()
		if (c.me) {
			c.wobble(g, c.x, c.y, c.r - 3.5, c.i * 3 + 1, 0.4)
			g.strokeStyle = c.PAPER
			g.lineWidth = 1
			g.stroke()
		}
		glyph(c, c.empty ? ink(0.55) : c.PAPER, 0.7)
	},
	caption(c) {
		const out = c.a // legend centred on the outward side
		const R = c.r + c.px * 0.85
		const o = {
			px: c.px * 0.85,
			col: caps(c),
			halo: halo(c),
			track: 0.22,
			font: `${c.me ? 800 : 700} ${Math.round(c.px * 0.85)}px ${SYNE}`,
		}
		if (c.empty) {
			const w = arcText(c.g, c.x, c.y, c.name, out, R, o)
			const g = c.g
			g.save()
			g.strokeStyle = rgba(caps(c), 0.55)
			g.lineWidth = 1
			g.setLineDash([2, 4])
			g.beginPath()
			g.arc(c.x, c.y, R, out + w / 2 + 0.25, out + TAU - w / 2 - 0.25)
			g.stroke()
			g.restore()
		} else arcText(c.g, c.x, c.y, `${c.name} ✦ ${who(c)}${c.tag}`, out, R, o)
	},
}

// 4 moon: occupancy as a phase. Empty is a new moon (dark, a hairline of light), a robot a half moon,
// a player gibbous, you full and haloed. The caption only names the instrument and who.
V[4] = {
	badge(c) {
		const g = c.g,
			r = c.r
		const lit = c.empty ? 0.04 : c.st.bot ? 0.5 : c.me ? 1 : 0.78
		if (c.me) {
			const gr = g.createRadialGradient(c.x, c.y, r, c.x, c.y, r * 2.2)
			gr.addColorStop(0, rgba(c.color, 0.55))
			gr.addColorStop(1, rgba(c.color, 0))
			g.fillStyle = gr
			g.beginPath()
			g.arc(c.x, c.y, r * 2.2, 0, TAU)
			g.fill()
		}
		disc(c)
		g.fillStyle = INK
		g.fill()
		// the lit part faces the eye in the centre
		const toward = Math.atan2(c.CY - c.y, c.CX - c.x)
		g.save()
		disc(c)
		g.clip()
		g.translate(c.x, c.y)
		g.rotate(toward)
		g.beginPath()
		g.arc(0, 0, r + 1, -Math.PI / 2, Math.PI / 2)
		const k = 1 - 2 * lit // terminator: ellipse from +r (thin) to -r (full)
		g.ellipse(0, 0, Math.abs(k) * (r + 1), r + 1, 0, Math.PI / 2, -Math.PI / 2, k > 0)
		g.fillStyle = c.color
		g.fill()
		g.restore()
		disc(c)
		g.strokeStyle = c.empty ? rgba(c.PAPER, 0.6) : INK
		g.lineWidth = c.me ? 2 : 1
		g.stroke()
		glyph(c, c.empty ? rgba(c.PAPER, 0.35) : c.PAPER, 0.66)
	},
	caption(c) {
		const txt = c.empty ? c.name : `${c.name} · ${who(c)}${c.tag}`
		arcText(c.g, c.CX, c.CY, txt, c.a, c.Rcap, {
			px: c.px,
			col: c.empty ? rgba(caps(c), 0.55) : caps(c),
			halo: halo(c),
			font: `${c.me ? 800 : 500} ${Math.round(c.px)}px ${SYNE}`,
			track: 0.3,
		})
	},
}

// 5 satellite: the badge is the instrument and always wears its colour. Whoever sits there is a small moon
// circling it, one lap a bar: a robot a square with its letter, a player a dot with an initial, you the eye.
// Empty: the orbit is drawn, nothing on it.
V[5] = {
	badge(c) {
		const g = c.g,
			r = c.r
		disc(c)
		g.fillStyle = c.empty ? rgba(c.color, 0.35) : c.color
		g.fill()
		g.strokeStyle = INK
		g.lineWidth = 1.1
		g.stroke()
		glyph(c, c.empty ? ink(0.6) : c.PAPER)
		const R = r + 7
		g.save()
		g.strokeStyle = rgba(c.dark ? c.PAPER : INK, c.empty ? 0.6 : 0.25)
		g.lineWidth = 0.8
		g.setLineDash([1.5, 3.5])
		g.beginPath()
		g.arc(c.x, c.y, R, 0, TAU)
		g.stroke()
		g.restore()
		if (c.empty) return
		const m = c.a + Math.PI * 0.75 + (c.reduce ? 0 : c.phase * TAU),
			mx = c.x + Math.cos(m) * R,
			my = c.y + Math.sin(m) * R,
			s = r * 0.44
		g.lineWidth = 1.2
		g.strokeStyle = INK
		if (c.st.bot) {
			g.fillStyle = c.PAPER
			g.save()
			g.translate(mx, my)
			g.rotate(m)
			g.fillRect(-s, -s, s * 2, s * 2)
			g.strokeRect(-s, -s, s * 2, s * 2)
			g.restore()
		} else if (c.me) {
			g.fillStyle = c.PAPER
			g.beginPath()
			g.ellipse(mx, my, s * 1.5, s * 0.95, m, 0, TAU)
			g.fill()
			g.stroke()
			g.fillStyle = INK
			g.beginPath()
			g.arc(mx, my, s * 0.5, 0, TAU)
			g.fill()
			return
		} else {
			g.fillStyle = c.PAPER
			g.beginPath()
			g.arc(mx, my, s * 1.1, 0, TAU)
			g.fill()
			g.stroke()
		}
		g.fillStyle = INK
		g.font = `700 ${Math.round(s * 1.5)}px ${SYNE}`
		g.textAlign = 'center'
		g.textBaseline = 'middle'
		g.fillText(c.st.bot ? c.st.initial : c.st.initial.toUpperCase(), mx, my + 0.5)
	},
	caption(c) {
		arcText(c.g, c.CX, c.CY, c.name + c.tag, c.a, c.Rcap + 4, {
			px: c.px,
			col: caps(c),
			halo: halo(c),
			font: `${c.me ? 800 : 600} ${Math.round(c.px)}px ${SYNE}`,
		})
	},
}

// 6 spoke: a hairline from the badge into the dial ends on its own ring, so the badge says which ring is whose.
// The caption leaves the badge straight outward like a ray: instrument big, who small beneath.
function spoke(c) {
	const g = c.g,
		ux = Math.cos(c.a),
		uy = Math.sin(c.a)
	const [rx, ry] = [c.CX + ux * c.ringMid, c.CY + uy * c.ringMid]
	g.save()
	g.strokeStyle = c.empty ? ink(0.45) : c.color
	g.lineWidth = c.me ? 2 : 1.2
	if (c.empty) g.setLineDash([2, 4])
	g.beginPath()
	g.moveTo(c.x - ux * c.r, c.y - uy * c.r)
	g.lineTo(rx, ry)
	g.stroke()
	g.setLineDash([])
	g.fillStyle = c.empty ? c.PAPER : c.color
	g.strokeStyle = INK
	g.lineWidth = 1
	g.beginPath()
	g.arc(rx, ry, c.me ? 4.5 : 3.2, 0, TAU)
	g.fill()
	g.stroke()
	g.restore()
}
V[6] = {
	badge(c) {
		spoke(c)
		V[3].badge(c)
	},
	caption(c) {
		const ux = Math.cos(c.a),
			uy = Math.sin(c.a),
			d = c.r + 9
		rayText(
			c.g,
			c.x + ux * d,
			c.y + uy * d,
			c.a,
			c.name.toUpperCase(),
			`${c.me ? 800 : 700} ${Math.round(c.px * 1.15)}px ${SYNE}`,
			caps(c),
			halo(c),
		)
		if (c.empty) return
		// who, a line off the ray, small italic
		const n = Math.cos(c.a) < 0 ? -1 : 1,
			off = c.px * 1.05
		rayText(
			c.g,
			c.x + ux * d - uy * off * n,
			c.y + uy * d + ux * off * n,
			c.a,
			who(c) + c.tag,
			`italic ${c.me ? 700 : 500} ${Math.round(c.px * 1.05)}px ${SERIF}`,
			caps(c),
			halo(c),
		)
	},
}

// 7 banderole: an etched ribbon scroll behind the badge carries the words, its tails forked.
// Taken: the ribbon is dyed the seat's colour. Empty: a pale blank-ish ribbon, the instrument in faint ink.
V[7] = {
	badge(c) {
		const g = c.g,
			R = c.Rcap,
			w = c.px * 1.55
		const txt = c.empty ? c.name : `${c.name} · ${who(c)}${c.tag}`
		g.save()
		g.font = `${c.me ? 800 : 600} ${Math.round(c.px)}px ${SYNE}`
		const len =
			[...txt.toUpperCase()].reduce((s, ch) => s + g.measureText(ch).width + c.px * 0.16, 0) / R
		const a0 = c.a - len / 2 - 0.05,
			a1 = c.a + len / 2 + 0.05
		const fill = c.empty ? rgba(c.PAPER, 0.75) : c.color
		// tails, tucked behind
		for (const [a, s] of [
			[a0, -1],
			[a1, 1],
		]) {
			const t0 = a + s * 0.0,
				t1 = a + s * 0.09
			const p = (t, r) => [c.CX + Math.cos(t) * r, c.CY + Math.sin(t) * r]
			g.beginPath()
			g.moveTo(...p(t0, R - w / 2 + 3))
			g.lineTo(...p(t1, R - w / 2 + 6))
			g.lineTo(...p(t1 - s * 0.03, R))
			g.lineTo(...p(t1, R + w / 2 + 6))
			g.lineTo(...p(t0, R + w / 2 + 3))
			g.closePath()
			g.fillStyle = c.empty ? rgba(c.PAPER, 0.5) : rgba(INK, 0.75)
			g.fill()
			g.strokeStyle = INK
			g.lineWidth = 1
			g.stroke()
		}
		g.beginPath()
		g.arc(c.CX, c.CY, R + w / 2, a0, a1)
		g.arc(c.CX, c.CY, R - w / 2, a1, a0, true)
		g.closePath()
		g.fillStyle = fill
		g.fill()
		g.strokeStyle = INK
		g.lineWidth = c.me ? 2 : 1
		g.stroke()
		// etched hatching along the ribbon edge
		g.strokeStyle = ink(0.3)
		g.lineWidth = 0.6
		g.beginPath()
		g.arc(c.CX, c.CY, R + w / 2 - 2.5, a0 + 0.01, a1 - 0.01)
		g.stroke()
		g.restore()
		if (c.me) orbit(c)
		disc(c)
		g.fillStyle = c.empty ? c.PAPER : c.color
		g.fill()
		g.strokeStyle = INK
		g.lineWidth = c.me ? 2.4 : 1.1
		g.stroke()
		glyph(c, c.empty ? ink(0.55) : c.PAPER)
	},
	caption(c) {
		const txt = c.empty ? c.name : `${c.name} · ${who(c)}${c.tag}`
		arcText(c.g, c.CX, c.CY, txt, c.a, c.Rcap, {
			px: c.px,
			col: c.empty ? ink(0.6) : c.PAPER,
			font: `${c.me ? 800 : 600} ${Math.round(c.px)}px ${SYNE}`,
		})
	},
}

// 8 postmark: a taken seat is franked. The sitter's name is stamped across the badge in a tilted oval with
// wavy cancel lines; you get a vermilion stamp. Empty: an unfranked badge. Caption is the instrument alone.
V[8] = {
	badge(c) {
		const g = c.g
		disc(c)
		g.fillStyle = c.empty ? c.PAPER : c.color
		g.fill()
		g.strokeStyle = INK
		g.lineWidth = c.empty ? 1 : 1.1
		if (c.empty) g.setLineDash([2.5, 3])
		g.stroke()
		g.setLineDash([])
		glyph(c, c.empty ? ink(0.55) : rgba(c.PAPER, 0.85))
		if (c.empty) return
		const col = c.me ? '#d24b2a' : c.st.bot ? INK : '#1d2a6e'
		const tilt = -0.32 + (c.i % 2) * 0.18
		g.save()
		g.translate(c.x, c.y)
		g.rotate(Math.cos(c.a) < 0 ? tilt : -tilt)
		g.globalAlpha *= 0.92
		const label = (c.st.bot ? c.st.name : c.me ? 'you' : c.st.name).toUpperCase()
		g.font = `800 ${Math.round(c.px * 0.8)}px ${SYNE}`
		const tw = g.measureText(label).width
		const ew = tw / 2 + 7,
			eh = c.px * 0.95
		// cancel waves trailing off to the right
		g.strokeStyle = col
		g.lineWidth = 1.2
		const side = Math.cos(c.a) < 0 ? 1 : -1 // waves trail toward the dial
		for (let k = -1; k <= 1; k++) {
			g.beginPath()
			for (let s = 0; s <= 24; s++) {
				const xx = side * (ew + s * 1.6),
					yy = k * 4.5 + Math.sin(s * 0.7) * 1.5
				s ? g.lineTo(xx, yy) : g.moveTo(xx, yy)
			}
			g.stroke()
		}
		g.fillStyle = rgba(c.PAPER, 0.92)
		g.beginPath()
		g.ellipse(0, 0, ew, eh, 0, 0, TAU)
		g.fill()
		g.lineWidth = 1.6
		g.stroke()
		g.lineWidth = 0.6
		g.beginPath()
		g.ellipse(0, 0, ew - 2.5, eh - 2.5, 0, 0, TAU)
		g.stroke()
		g.fillStyle = col
		g.textAlign = 'center'
		g.textBaseline = 'middle'
		g.fillText(label, 0, 1)
		g.restore()
	},
	caption(c) {
		arcText(c.g, c.CX, c.CY, c.name + c.tag, c.a, c.Rcap + 2, {
			px: c.px,
			col: c.empty ? rgba(caps(c), 0.6) : caps(c),
			halo: halo(c),
			font: `${c.me ? 800 : 600} ${Math.round(c.px)}px ${SYNE}`,
		})
	},
}

// 9 whisper: the glyph already names the instrument, so the caption only names who sits there, in a large
// Fraunces italic. An empty seat says nothing: a ghost badge that breathes on the beat.
V[9] = {
	badge(c) {
		const g = c.g
		if (c.empty) {
			const k = c.reduce ? 1 : 1 + 0.07 * Math.pow(1 - ((c.phase * 4) % 1), 3)
			c.wobble(g, c.x, c.y, c.r * k, c.i * 5 + 2, 0.6)
			g.fillStyle = rgba(c.PAPER, 0.18)
			g.fill()
			g.strokeStyle = rgba(c.PAPER, 0.8)
			g.lineWidth = 1
			g.setLineDash([2.5, 3.5])
			g.stroke()
			g.setLineDash([])
			glyph(c, rgba(c.PAPER, 0.7))
			return
		}
		V[1].badge(c)
	},
	caption(c) {
		if (c.empty) return
		const px = c.px * 1.55
		const w = arcText(c.g, c.CX, c.CY, who(c) + c.tag, c.a, c.Rcap + 2, {
			px,
			font: `italic ${c.me ? 700 : 400} ${Math.round(px)}px ${SERIF}`,
			upper: false,
			track: 0.02,
			col: caps(c),
			halo: halo(c),
		})
		if (c.me) {
			const g = c.g,
				R = c.Rcap + 2 + (Math.sin(c.a) > 0.05 ? -px * 0.62 : px * 0.62) * -1
			g.save()
			g.strokeStyle = c.color
			g.lineWidth = 2
			g.lineCap = 'round'
			g.beginPath()
			for (let s = 0; s <= 30; s++) {
				const t = c.a - w / 2 + (w * s) / 30,
					rr = R + Math.sin(s * 0.9) * 1.2
				const px_ = c.CX + Math.cos(t) * rr,
					py = c.CY + Math.sin(t) * rr
				s ? g.lineTo(px_, py) : g.moveTo(px_, py)
			}
			g.stroke()
			g.restore()
		}
	},
}

// 10 lids: the machine's logo is an eye, so every seat has one, perched on the badge's outer edge.
// Empty: shut, a lashed curve. A robot: open with a square pupil. A player: open. You: wide, glancing at the centre.
V[10] = {
	badge(c) {
		const g = c.g,
			r = c.r
		disc(c)
		g.fillStyle = c.empty ? c.PAPER : c.color
		g.fill()
		g.strokeStyle = INK
		g.lineWidth = c.me ? 2.2 : 1.1
		g.stroke()
		glyph(c, c.empty ? ink(0.55) : c.PAPER)
		const ux = Math.cos(c.a),
			uy = Math.sin(c.a)
		const ex = c.x - ux * (r + 1),
			ey = c.y - uy * (r + 1)
		const ew = r * (c.me ? 0.95 : 0.8),
			eh = c.empty ? 0 : r * (c.me ? 0.55 : 0.42)
		g.save()
		g.translate(ex, ey)
		g.rotate(c.a + Math.PI / 2)
		g.lineWidth = 1.3
		g.strokeStyle = INK
		if (c.empty) {
			g.beginPath()
			g.moveTo(-ew, 0)
			g.quadraticCurveTo(0, ew * 0.55, ew, 0)
			g.stroke()
			for (const k of [-0.6, -0.2, 0.2, 0.6]) {
				const xx = k * ew,
					yy = ew * 0.55 * (1 - k * k) * 0.5
				g.beginPath()
				g.moveTo(xx, yy)
				g.lineTo(xx * 1.15, yy + 4)
				g.stroke()
			}
			g.restore()
			return
		}
		g.beginPath()
		g.moveTo(-ew, 0)
		g.quadraticCurveTo(0, -eh * 2, ew, 0)
		g.quadraticCurveTo(0, eh * 2, -ew, 0)
		g.fillStyle = c.PAPER
		g.fill()
		g.stroke()
		// pupil looks toward the centre (down in the rotated frame)
		g.fillStyle = INK
		const py = eh * 0.35
		if (c.st.bot) g.fillRect(-eh * 0.45, py - eh * 0.45, eh * 0.9, eh * 0.9)
		else {
			g.beginPath()
			g.arc(0, py, eh * (c.me ? 0.62 : 0.5), 0, TAU)
			g.fill()
		}
		g.restore()
	},
	caption(c) {
		const txt = c.empty ? c.name : `${c.name} · ${who(c)}${c.tag}`
		arcText(c.g, c.CX, c.CY, txt, c.a, c.Rcap, {
			px: c.px,
			col: c.empty ? rgba(caps(c), 0.6) : caps(c),
			halo: halo(c),
			font: `${c.me ? 800 : 600} ${Math.round(c.px)}px ${SYNE}`,
		})
	},
}

// 11 the pick, assembled: 4's moon phases for who sits there, 6's spoke to the ring, 9's words (only who).
V[11] = {
	badge(c) {
		spoke(c)
		V[4].badge(c)
	},
	caption: (c) => V[9].caption(c),
}

export const variants = V
