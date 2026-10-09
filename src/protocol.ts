export const DARK_READER_CONTROLLER_KEY = '__obsidianDarkReaderController';

// Returned by the page when it needs the @font-face rules for the action's font.
export const NEEDS_FONT_FACES = 'needs-font-faces';

export interface DarkReaderThemeOptions {
	mode: 0 | 1;
	brightness: number;
	contrast: number;
	sepia: number;
	darkSchemeBackgroundColor?: string;
	darkSchemeTextColor?: string;
	lightSchemeBackgroundColor?: string;
	lightSchemeTextColor?: string;
}

export interface PageFont {
	// A CSS font-family list.
	family: string;
	// Identifies the font faces that go with the family.
	facesKey: string;
}

// A font face Obsidian loads from an embedded data URL.
export interface PageFontFace {
	family: string;
	source: string;
	descriptors: FontFaceDescriptors;
}

export type DarkReaderAction =
	| {
			type: 'enable';
			theme: DarkReaderThemeOptions;
			font?: PageFont;
	  }
	| {
			type: 'disable';
			font?: PageFont;
	  };
