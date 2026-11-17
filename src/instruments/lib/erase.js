// Erasing, the same in every instrument. The host marks a stroke as erasing with `e.alt`
// (the eraser token, shift, the right button, or a two-finger drag); it never reaches you as drawing.
// Instruments that keep a list of marks hand it to `rub` and return.

// true while an erasing stroke is down
export const rubbing = (e) => e.alt && (e.type === 'down' || (e.type === 'move' && e.pressed !== false))

// remove every item whose distance in pixels from the pointer, d(item), is under the rubber's reach.
// `e` comes from withPointer (it has w and h). Returns how many went.
export function rub(e, list, d) {
	if (!rubbing(e)) return 0
	const reach = Math.max(14, Math.min(e.w, e.h) * 0.045)
	let n = 0
	for (let k = list.length - 1; k >= 0; k--)
		if (d(list[k]) < reach) {
			list.splice(k, 1)
			n++
		}
	return n
}
