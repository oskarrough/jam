// npm run check [-- --quick]: lint, then every instrument loaded, drawn on and zoomed in a headless browser,
// then the multiplayer tests (skipped with --quick). Any uncaught error or console.error fails it.
import { spawnSync, execSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT, serve, playwright, open, play } from './lib/browser.js'

const quick = process.argv.includes('--quick')
let failed = 0
const say = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++ }

// lint: undefined names and duplicate keys fail; skipped with a note when eslint isn't installed
const lint = spawnSync('npx', ['--no-install', 'eslint', '--quiet', '.'], { cwd: ROOT, encoding: 'utf8' })
if (lint.error || /could not determine executable|not found/i.test(lint.stderr)) console.log('skip lint (npm i to get eslint)')
else say(lint.status === 0, 'lint' + (lint.status ? '\n' + lint.stdout.trim() : ''))

const srv = await serve()
const browser = await playwright().chromium.launch()
try {
	const page = await open(browser, `${srv.url}/?ws=off`)
	say(await page.evaluate(() => !!window.jam), 'page boots')
	await page.click('#sound')
	const ids = await page.evaluate(() => [...window.jam.registry.keys()])
	for (const id of ids) {
		const before = page.errors.length
		await play(page, id)
		await play(page, id, { sheet: true })
		// a short stroke across the sheet exercises pointer() and the state push
		const r = await page.evaluate(() => window.jam.view.focus.sheet)
		await page.mouse.move(r.x + r.w * 0.3, r.y + r.h * 0.4); await page.mouse.down()
		await page.mouse.move(r.x + r.w * 0.6, r.y + r.h * 0.6, { steps: 6 }); await page.mouse.up()
		await page.waitForTimeout(200)
		say(page.errors.length === before, `${id}: dial, sheet, stroke` + page.errors.slice(before).map((e) => '\n  ' + e.split('\n')[0]).join(''))
	}
	const lab = await open(browser, `${srv.url}/lab/`)
	await lab.click('#start').catch(() => {})
	await lab.waitForTimeout(800)
	say(!lab.errors.length, 'lab boots' + lab.errors.map((e) => '\n  ' + e.split('\n')[0]).join(''))
} finally { await browser.close(); srv.close() }

if (!quick) {
	const env = { ...process.env, NODE_PATH: execSync('npm root -g').toString().trim() }
	const t = spawnSync('node', ['test.mjs'], { cwd: join(ROOT, 'sync'), env, encoding: 'utf8' })
	const lines = (t.stdout + t.stderr).split('\n').filter((l) => /^(ok|FAIL)/.test(l))
	say(t.status === 0, `sync tests (${lines.filter((l) => l.startsWith('ok')).length} ok)` + lines.filter((l) => l.startsWith('FAIL')).map((l) => '\n  ' + l).join(''))
}
console.log(failed ? `\n${failed} failed` : '\nall good')
process.exit(failed ? 1 : 0)
