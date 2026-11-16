// npm run check: lint. Undefined names and duplicate keys fail; there's no build step to catch a typo otherwise.
// The multiplayer tests are by hand when sync/ or the transport changes (see AGENTS.md).
import { spawnSync } from 'node:child_process'
import { ROOT } from './lib/browser.js'

const lint = spawnSync('npx', ['--no-install', 'eslint', '--quiet', '.'], { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' })
if (lint.error) { console.log('no eslint: npm i'); process.exit(2) }
console.log(lint.status ? '\nlint failed' : 'all good')
process.exit(lint.status)
