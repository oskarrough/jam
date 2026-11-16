// The instruments. Each one is a single file in this folder; see README.md here for the contract,
// or run `npm run new-instrument <name>` to start one. Order here is the order in the picker.

import bass from './bass.js'
import keys from './keys.js'
import bell from './bell.js'
import drums from './drums.js'
import contour from './contour.js'
import grid from './grid.js'
import rings from './rings.js'
import sweep from './sweep.js'
import drift from './drift.js'
import scribble from './scribble.js'
import strum from './strum.js'
import swarm from './swarm.js'
import orbits from './orbits.js'
import embers from './embers.js'
// new instruments: imported above this line by `npm run new-instrument`

export const instruments = [bass, keys, bell, drums, contour, grid, rings, sweep, drift, scribble, strum, swarm, orbits, embers]
export const registry = new Map()

export function register(mod) {
	for (const k of ['id', 'name', 'create']) if (!mod[k]) throw new Error(`instrument is missing ${k}`)
	const create = mod.create
	// A state meant for something else (a bot's part generated just before the seat switched
	// instruments, a peer on an older version) must not break the lane: keep the old state instead.
	mod.create = (ctx) => {
		const inst = create.call(mod, ctx)
		const setState = inst.setState
		inst.setState = (s) => {
			if (s == null) { try { setState.call(inst, s) } catch {} return }
			const backup = JSON.parse(JSON.stringify(inst.state ?? null))
			const keys = backup && typeof backup === 'object' ? Object.keys(backup) : []
			if (typeof s !== 'object' || !keys.every((k) => k in s)) return
			try { setState.call(inst, s) } catch (e) { setState.call(inst, backup); console.warn(mod.id, 'ignored a state that did not fit', e) }
		}
		return inst
	}
	registry.set(mod.id, mod)
	return mod
}

instruments.forEach(register)
