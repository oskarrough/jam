// npm run setup: get a checkout ready in one call. Safe to run any time, never discards work.
// Fetches origin, moves a clean checkout with no commits of its own onto origin/main, installs deps if missing.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/browser.js'

const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' })
const out = (...a) => git(...a).stdout.trim()
const say = []

if (git('fetch', '-q', 'origin', 'main').status) say.push('fetch failed (offline?), using what is here')
else {
	const dirty = out('status', '--porcelain', '--untracked-files=no'),
		ahead = +out('rev-list', '--count', 'origin/main..HEAD') || 0,
		behind = +out('rev-list', '--count', 'HEAD..origin/main') || 0
	if (dirty) say.push(`uncommitted changes, left alone (${behind} behind origin/main)`)
	else if (ahead) say.push(`${ahead} local commit(s) ahead of origin/main, left alone (${behind} behind): pull --rebase before you push`)
	else if (behind) {
		git('reset', '-q', '--hard', 'origin/main')
		say.push(`moved ${behind} commit(s) forward to origin/main`)
	} else say.push('up to date with origin/main')
}

if (!existsSync(join(ROOT, 'node_modules/.bin/oxlint'))) {
	const r = spawnSync('npm', ['i', '--no-save', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'ignore' })
	say.push(r.status ? 'npm install failed: run it by hand' : 'installed deps')
}
console.log('setup: ' + say.join('; ') + `\nat ${out('log', '--oneline', '-1')}`)
