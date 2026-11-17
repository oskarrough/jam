// pnpm check: lint. Undefined names and duplicate keys fail; there's no build step to catch a typo otherwise.
// The multiplayer tests are by hand when sync/ or the transport changes (see AGENTS.md).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/browser.js'

if (!existsSync(join(ROOT, 'node_modules/.bin/oxlint')))
	spawnSync('pnpm', ['i'], { cwd: ROOT, stdio: 'inherit' })
const lint = spawnSync(join(ROOT, 'node_modules/.bin/oxlint'), ['--quiet', '.'], {
	cwd: ROOT,
	encoding: 'utf8',
	stdio: 'inherit',
})
if (lint.error) {
	console.log('no oxlint: pnpm i')
	process.exit(2)
}
console.log(lint.status ? '\nlint failed' : 'all good')
process.exit(lint.status)
