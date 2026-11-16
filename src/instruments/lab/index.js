// Registry, in the order they appear in the lab.
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

const all = [contour, grid, rings, sweep, drift, scribble, strum, swarm, orbits, embers]

// A state meant for another instrument (say a bot's part generated just before the
// seat switched instruments) must not break the lane: ignore states that don't fit.
for (const mod of all) {
  const create = mod.create
  mod.create = (ctx) => {
    const inst = create(ctx)
    const setState = inst.setState
    inst.setState = (s) => {
      const keys = Object.keys(inst.state)
      if (!s || typeof s !== 'object' || !keys.every((k) => k in s)) return
      const backup = JSON.parse(JSON.stringify(inst.state))
      try { setState.call(inst, s) } catch (e) { setState.call(inst, backup); console.warn(mod.id, 'ignored bad state', e) }
    }
    return inst
  }
}

export const instruments = all
export default instruments
