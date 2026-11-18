// pnpm shots [-- <instrument>|all] [--phone] [--at <ms>]: screenshots of the dial and each instrument's sheet into shots/.
// --jam <name> instead opens a fresh /j/<name> as it comes, blank: the dial and your sheet.
// --at jumps the page clock forward, so a timed effect (a blink every 8-14 s) is on screen without waiting.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, serve, playwright, open, play } from './lib/browser.js'

const args = process.argv.slice(2),
	phone = args.includes('--phone'),
	at = +(args[args.indexOf('--at') + 1] || 0) * args.includes('--at'),
	jam = args.includes('--jam') ? args[args.indexOf('--jam') + 1] || 'blank' : null,
	want = args.find((a) => !a.startsWith('--') && a !== String(at) && a !== jam) || 'all'
const dir = join(ROOT, 'shots'),
	tag = phone ? '-phone' : ''
mkdirSync(dir, { recursive: true })
const srv = await serve()
const browser = await playwright().chromium.launch()
try {
	const page = await open(browser, `${srv.url}/${jam ? 'j/' + jam : ''}?ws=off`, { phone, at })
	await page.click('#sound')
	if (jam) {
		await page.waitForTimeout(1500)
		await page.screenshot({ path: join(dir, `jam-dial${tag}.png`) })
		await page.evaluate(() => window.jam.view.setFocus(window.jam.me.seat))
		await page.waitForTimeout(1200)
		await page.screenshot({ path: join(dir, `jam-sheet${tag}.png`) })
		console.log(
			'2 shots in shots/' + (page.errors.length ? '\nerrors:\n  ' + page.errors.join('\n  ') : ''),
		)
		process.exit(0)
	}
	const ids =
		want === 'all'
			? await page.evaluate(() =>
					[...window.jam.registry].filter(([, m]) => !m.hidden).map(([id]) => id),
				)
			: [want]
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
