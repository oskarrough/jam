// The instruments, one file each; README.md here has the contract.
// `npm run new-instrument <name>` starts one. Order here is picker order.

import drums from './drums.js'
import gears from './gears.js'
import embers from './embers.js'
import steps from './steps.js'
import bass from './bass.js'
import bloom from './bloom.js'
import strum from './strum.js'
import sweep from './sweep.js'
import drift from './drift.js'
import tide from './tide.js'
import bell from './bell.js'
import scribble from './scribble.js'
import swarm from './swarm.js'
import orbits from './orbits.js'
import contour from './contour.js'
import empty from './empty.js'
// new instruments: imported above this line by `pnpm new-instrument`

// grouped by role: beat, low, chords, tune; the picker leaves a little room before each group's first
export const instruments = [
	drums,
	gears,
	embers,
	steps,
	bass,
	bloom,
	sweep,
	drift,
	strum,
	tide,
	bell,
	scribble,
	swarm,
	orbits,
	contour,
]
export const groupStarts = new Set(['bass', 'bloom', 'bell'])
export const registry = new Map()

export function register(mod) {
	for (const k of ['id', 'name', 'create'])
		if (!mod[k]) throw new Error(`instrument is missing ${k}`)
	const create = mod.create
	// Foreign state (bot part, older peer) must not break the seat: keep the old one.
	// Keys a module lists in `optional` may be missing (parts saved before they existed).
	mod.create = (ctx) => {
		const inst = create.call(mod, ctx)
		const setState = inst.setState
		inst.setState = (s) => {
			if (s == null) {
				try {
					setState.call(inst, s)
				} catch {}
				return
			}
			const backup = JSON.parse(JSON.stringify(inst.state ?? null))
			const keys = backup && typeof backup === 'object' ? Object.keys(backup) : []
			if (typeof s !== 'object' || !keys.every((k) => k in s || mod.optional?.includes(k))) return
			try {
				setState.call(inst, s)
			} catch (e) {
				setState.call(inst, backup)
				console.warn(mod.id, 'ignored a state that did not fit', e)
			}
		}
		return inst
	}
	registry.set(mod.id, mod)
	return mod
}

instruments.forEach(register)
// an empty seat in a blank jam: in the registry so it syncs and replays, never in the picker
register(empty)
