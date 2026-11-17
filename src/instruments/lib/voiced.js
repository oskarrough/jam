// A choice of voices for one instrument: [[name, fn], …] becomes a synced `voice` param (first is the default),
// the names the sheet lists in its corner, and play(ctx) for the one picked. fn(ctx, midi, time, dur, gain?).
export function voiced(voices, params = {}) {
	const byName = new Map(voices)
	return {
		voices: voices.map(([n]) => n),
		params: { voice: { value: voices[0][0], options: voices.map(([n]) => n) }, ...params },
		play: (ctx) => byName.get(ctx.params.voice) || voices[0][1],
	}
}
