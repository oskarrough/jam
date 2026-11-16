// npm run check lints with this. Only real mistakes fail: undefined names, duplicate keys.
import globals from 'globals'
export default [
	{ ignores: ['**/node_modules/**', 'src/vendor/**', '.wrangler/**', '.cloudflare/**', 'shots/**'] },
	{
		files: ['**/*.js', '**/*.mjs'],
		languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.node, WebSocketPair: 'readonly', HTMLRewriter: 'readonly' } },
		rules: { 'no-undef': 'error', 'no-dupe-keys': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }] },
	},
]
