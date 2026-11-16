// Instrument registry. Drop a module in this folder and add it here.
//
// Module:   export default { id, name, params, create(ctx), generate?(steps), sample?(steps) }
//   params:   { key: default } or { key: { value, min, max, step } | { value, options: [...] } }
//   generate: optional, returns a fresh state; frengers (bots) use it to redraw their part
//   sample:   optional, returns the state a lane starts with on a fresh campfire
// ctx:      { audio: AudioContext, out: AudioNode, clock, params, color }
//   clock:    { bpm, steps, stepDur (s), startTime (audio s), now() (audio s), pos() (fractional step), playing }
//   params:   live values, same keys as module.params; the debug panel mutates this object in place
// Instance: { state, setState(s), pointer(e), step(i, time, dur), frame(g, w, h, clock), clear?(), dispose() }
//   state:    JSON-serializable, the only thing that goes over the network
//   pointer:  { type: 'down'|'move'|'up', x, y (0..1, y=0 is the top/outer edge), id, alt, button }
//   step:     called ahead of time for each 16th; time is AudioContext seconds
//   frame:    draw into a cleared w×h lane (CSS px). The fire view wraps the lane round a ring,
//             x = loop phase clockwise from 12 o'clock, y = 0 on the outside.

import { bass, keys, bell, drums } from './builtins.js'
import { instruments as lab } from './lab/index.js'

export const registry = new Map()
export function register(mod) {
	registry.set(mod.id, mod)
	return mod
}

;[bass, keys, bell, drums].forEach(register)
// the ten drawable instruments from the lab (lab/index.html plays them one at a time)
lab.forEach(register)
