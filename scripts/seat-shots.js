// TEMPORARY: npm run seat-shots [-- 3 5] shoots each ?seat=N variant (0 = today) with ?seatdemo, desktop and phone
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, serve, playwright, open } from './lib/browser.js'
const want = process.argv.slice(2).map(Number)
const ns = want.length ? want : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const dir = join(ROOT, 'shots', 'seat')
mkdirSync(dir, { recursive: true })
const srv = await serve()
const browser = await playwright().chromium.launch()
try {
	for (const phone of [false, true])
		for (const n of ns) {
			const page = await open(browser, `${srv.url}/?ws=off&seatdemo&seat=${n}`, { phone })
			await page.click('#sound')
			await page.evaluate(() => {
				const { me, bots } = window.jam
				me.seat = 0
				bots.opts.on = true
			})
			await page.waitForTimeout(4500)
			await page.screenshot({ path: join(dir, `seat${n}${phone ? '-phone' : ''}.png`) })
			if (page.errors.length) console.log(n, page.errors)
			await page.context().close()
		}
} finally {
	await browser.close()
	srv.close()
}
