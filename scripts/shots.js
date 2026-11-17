// pnpm shots [-- <instrument>|all] [--phone] [--at <ms>]: screenshots of the dial and each instrument's sheet into shots/.
// --at jumps the page clock forward, so a timed effect (a blink every 8-14 s) is on screen without waiting.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, serve, playwright, open, play } from './lib/browser.js'

const args = process.argv.slice(2),
	phone = args.includes('--phone'),
	at = +(args[args.indexOf('--at') + 1] || 0) * args.includes('--at'),
	want = args.find((a) => !a.startsWith('--') && a !== String(at)) || 'all'
const dir = join(ROOT, 'shots'),
	tag = phone ? '-phone' : ''
mkdirSync(dir, { recursive: true })
const srv = await serve()
const browser = await playwright().chromium.launch()
try {
	const page = await open(browser, `${srv.url}/?ws=off`, { phone, at })
	await page.click('#sound')
	const ids = want === 'all' ? await page.evaluate(() => [...window.jam.registry.keys()]) : [want]
	for (const id of ids) {
		await play(page, id)
		await page.screenshot({ path: join(dir, `${id}-dial${tag}.png`) })
		await play(page, id, { sheet: true })
		await page.screenshot({ path: join(dir, `${id}-sheet${tag}.png`) })
	}
	console.log(
		`${ids.length * 2} shots in shots/` +
			(page.errors.length ? '\nerrors:\n  ' + page.errors.join('\n  ') : ''),
	)
} finally {
	await browser.close()
	srv.close()
}
