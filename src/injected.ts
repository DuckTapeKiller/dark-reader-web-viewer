import { disable, enable, setFetchMethod } from 'darkreader';
import { DARK_READER_CONTROLLER_KEY, NEEDS_FONT_FACES } from './protocol';
import type {
	DarkReaderAction,
	DarkReaderThemeOptions,
	PageFont,
	PageFontFace,
} from './protocol';

type DarkReaderController = {
	// Set by the plugin after installing, to tell its own build apart.
	build?: string;
	apply: (action: DarkReaderAction) => unknown;
	setFontFaces?: (key: string, faces: PageFontFace[]) => void;
	destroy?: () => void;
};

type InjectedWindow = Window & {
	[DARK_READER_CONTROLLER_KEY]?: DarkReaderController;
};

// Same exclusions Dark Reader uses for its own font option, so icon fonts keep
// working, plus code-like elements that should stay monospaced.
const FONT_EXCLUSIONS = [
	'pre',
	'pre *',
	'code',
	'code *',
	'kbd',
	'kbd *',
	'samp',
	'samp *',
	'tt',
	'svg',
	'svg *',
	'math',
	'math *',
	'[aria-hidden="true"]',
	'[class*="fa-"]',
	'.fa',
	'.fab',
	'.fad',
	'.fal',
	'.far',
	'.fas',
	'.fass',
	'.fasr',
	'.fat',
	'.icofont',
	'[style*="font-"]',
	'[class*="icon"]',
	'[class*="Icon"]',
	'[class*="symbol"]',
	'[class*="Symbol"]',
	'.glyphicon',
	'[class*="material-symbol"]',
	'[class*="material-icon"]',
	'mu',
	'[class*="mu-"]',
	'.typcn',
	'[class*="vjs-"]',
].join(', ');

const page = window as InjectedWindow;

// Dark Reader only recolors a running page in place when it is given a fixes
// object both times; without one, later color changes are silently ignored.
const NO_FIXES = {
	invert: [],
	css: '',
	ignoreInlineStyle: [],
	ignoreImageAnalysis: [],
	disableStyleSheetsProxy: false,
	ignoreCSSUrl: [],
};
let enabledMode: DarkReaderThemeOptions['mode'] | undefined;

// A constructed sheet is not subject to the page's style-src policy, and fonts
// built from bytes fetch nothing, so font-src cannot block them either.
const fontFamilySheet = new CSSStyleSheet();
let fontFacesKey: string | undefined;
let fontFaces: FontFace[] = [];

function decodeDataUrl(source: string): ArrayBuffer | undefined {
	const comma = source.indexOf(',');
	if (comma < 0 || !source.slice(0, comma).endsWith(';base64')) {
		return undefined;
	}
	try {
		const binary = atob(source.slice(comma + 1));
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index++) {
			bytes[index] = binary.charCodeAt(index);
		}
		return bytes.buffer;
	} catch {
		return undefined;
	}
}

function setFontFaces(key: string | undefined, faces: PageFontFace[]): void {
	fontFaces.forEach((face) => document.fonts.delete(face));
	fontFaces = [];
	for (const { family, source, descriptors } of faces) {
		const bytes = decodeDataUrl(source);
		if (!bytes) {
			continue;
		}
		const face = new FontFace(family, bytes, descriptors);
		face.loaded.catch(() => undefined);
		document.fonts.add(face);
		fontFaces.push(face);
	}
	fontFacesKey = key;
}

function setAdopted(sheet: CSSStyleSheet, adopted: boolean): void {
	const sheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
	document.adoptedStyleSheets = adopted ? [...sheets, sheet] : sheets;
}

function applyFont(font: PageFont | undefined): boolean {
	if (!font || /[;{}]/.test(font.family)) {
		setAdopted(fontFamilySheet, false);
		setFontFaces(undefined, []);
		return true;
	}

	fontFamilySheet.replaceSync(
		`html, body, body *:not(${FONT_EXCLUSIONS}) { font-family: ${font.family} !important; }`,
	);
	setAdopted(fontFamilySheet, true);
	return fontFacesKey === font.facesKey;
}

const previous = page[DARK_READER_CONTROLLER_KEY];
if (previous) {
	// A controller from another plugin build is still running in this page.
	previous.apply({ type: 'disable' });
	previous.destroy?.();
}
setFetchMethod((url) => window.fetch(url));

page[DARK_READER_CONTROLLER_KEY] = {
	apply(action: DarkReaderAction) {
		if (action.type === 'enable') {
			// A mode switch is not a color-only change, and Dark Reader would
			// keep the old colors. Start over from the original page instead.
			if (enabledMode !== undefined && enabledMode !== action.theme.mode) {
				disable();
			}
			enable(action.theme, NO_FIXES);
			enabledMode = action.theme.mode;
		} else {
			disable();
			enabledMode = undefined;
		}
		return applyFont(action.font) ? 'applied' : NEEDS_FONT_FACES;
	},
	setFontFaces,
	destroy() {
		disable();
		enabledMode = undefined;
		applyFont(undefined);
	},
};
