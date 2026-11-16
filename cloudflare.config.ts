import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
	accountId: "b29de5cf62555d67d57242aeddc91344",
	worker: {
		name: "roughjam",
		compatibilityDate: "2026-11-01",
		entrypoint: "sync/worker.js",
		assets: {
			runWorkerFirst: [
				"/",
			],
		},
		domains: [
			"jam.0sk.ar",
		],
		env: {
			ROOMS: bindings.durableObject({
				worker: "roughjam",
				exportName: "JamRoom",
			}),
			ASSETS: bindings.assets(),
		},
		exports: {
			JamRoom: exports.durableObject({
				storage: "sqlite",
			}),
		},
	},
});
