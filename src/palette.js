// Dusk palette: pale paper sky, violet hills, ochre fields, ink line. Shared by the view, the engine (lane colours) and the instruments.
export const INK = '#211a2e'
export const PAPER = '#f3e8cf'
export const SERIF = 'Fraunces, "Iowan Old Style", Georgia, serif'
export const SANS = '"Bricolage Grotesque", system-ui, sans-serif'
// lane pigments, picked to read on paper: violet, viridian, flamingo, ultramarine, ochre, vermilion
export const LANE_COLORS = ['#5a3f8e', '#2f7a58', '#d65f7c', '#2b4fa6', '#c08419', '#d24b2a']
// theme handed to the lab instruments (see lab/util.js theme())
export const INK_THEME = { fg: INK, dim: 'rgba(33,26,46,0.45)', faint: 'rgba(33,26,46,0.1)', font: SANS }
