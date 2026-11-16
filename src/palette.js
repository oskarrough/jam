// Dusk palette: pale paper sky, violet hills, ochre fields, ink line. Shared by the view, the engine (seat colours) and the instruments.
export const INK = '#211a2e'
export const PAPER = '#f3e8cf'
export const SERIF = 'Fraunces, "Iowan Old Style", Georgia, serif'
export const SANS = '"Bricolage Grotesque", system-ui, sans-serif'
// seat pigments, picked to read on paper: violet, viridian, flamingo, ultramarine, ochre, vermilion
export const SEAT_COLORS = ['#5a3f8e', '#2f7a58', '#d65f7c', '#2b4fa6', '#c08419', '#d24b2a']
// theme handed to the lab instruments (see lab/util.js theme())
export const INK_THEME = { fg: INK, dim: 'rgba(33,26,46,0.45)', faint: 'rgba(33,26,46,0.1)', font: SANS }

// Grounds: whole-scene colourings for the landscape and the dial. Pick one in the debug panel (view > ground).
// paper is the dial's own ground; dark marks grounds whose sky needs light marks and a light title.
export const GROUNDS = {
	flamingo: {
		sky: ['#f4c200', '#f5c80c', '#f7d03a'], sun: '#d24b2a', far: '#ef9fb2', farShade: 'rgba(160,50,90,.25)', near: '#c4566f', trees: '#211a2e',
		field: '#f5f2ea', furrow: 'rgba(33,26,46,.32)', grass: '#e8e2d4', grassInk: 'rgba(33,26,46,.4)', shadow: 'rgba(90,63,142,.55)',
		paper: '#fbfaf4', mark: '#211a2e', line: 'rgba(33,26,46,.7)', scrap: '#2f7a58', dark: false,
	},
	nortel: {
		sky: ['#1b3786', '#2648a0', '#3760b4'], sun: '#b9d63c', far: '#3f8a3c', farShade: 'rgba(10,30,10,.3)', near: '#225428', trees: '#120e24',
		field: '#e06d2a', furrow: 'rgba(90,30,10,.35)', grass: '#1a2d6a', grassInk: 'rgba(200,215,255,.3)', shadow: 'rgba(14,10,36,.6)',
		paper: '#efeee9', mark: '#f1ead8', line: 'rgba(241,234,216,.6)', scrap: '#b9d63c', dark: true,
	},
	vallotton: {
		sky: ['#4e3f84', '#7d68a8', '#d59aa3'], sun: '#f4e7a0', far: '#3c2d66', farShade: 'rgba(15,10,30,.3)', near: '#271d40', trees: '#16111f',
		field: '#d99a34', furrow: 'rgba(100,50,10,.3)', grass: '#5f8a33', grassInk: 'rgba(20,40,10,.4)', shadow: 'rgba(30,20,60,.7)',
		paper: '#f1ecc4', mark: '#16111f', line: 'rgba(241,236,196,.55)', scrap: '#f4e7a0', dark: true,
	},
	sand: {
		sky: ['#efe2c3', '#f2dcb0', '#f3cf98'], sun: '#ee9d83', far: '#9a85b4', farShade: 'rgba(74,56,112,.35)', near: '#4a3870', trees: '#2b2142',
		field: '#d9a03c', furrow: 'rgba(120,70,20,.28)', grass: '#6f9338', grassInk: 'rgba(30,50,20,.35)', shadow: 'rgba(74,56,112,.85)',
		paper: '#f3e8cf', mark: '#211a2e', line: 'rgba(33,26,46,.7)', scrap: '#9fc23f', dark: false,
	},
}
