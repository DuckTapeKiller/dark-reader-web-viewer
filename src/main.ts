import { Notice, Plugin } from 'obsidian';
import {
	reachableFilter,
	splitFontFamilies,
	toHex,
	unfilterColor,
	unquoteFontFamily,
} from './colors';
import { DARK_READER_INJECTOR } from './generated-injector';
import { DARK_READER_CONTROLLER_KEY, NEEDS_FONT_FACES } from './protocol';
import type {
	DarkReaderAction,
	DarkReaderThemeOptions,
	PageFont,
	PageFontFace,
} from './protocol';
import {
	DEFAULT_SETTINGS,
	DarkReaderSettings,
	DarkReaderSettingTab,
} from './settings';

const WEB_VIEWER_VIEW_TYPE = 'webviewer';

// Identifies this build's injector, so pages still running a controller from
// an earlier build are reinstalled instead of being driven with a new protocol.
const INJECTOR_BUILD = hashString(DARK_READER_INJECTOR);

function hashString(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16);
}

type WebviewEventListener = EventListener;

interface WebviewElement extends HTMLElement {
	executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
	insertCSS(css: string): Promise<string>;
	removeInsertedCSS(key: string): Promise<void>;
	getWebContentsId(): number;
}

interface WebviewBinding {
	webview: WebviewElement;
	applying?: Promise<void>;
	stale: boolean;
	reinstall: boolean;
	// Counts cross-document navigations, to tell which document a fallback is in.
	navigation: number;
	fallback?: { navigation: number; key: Promise<string | undefined> };
	onDidNavigate: WebviewEventListener;
	onDomReady: WebviewEventListener;
	onDestroyed: WebviewEventListener;
}

interface ObsidianBaseColors {
	background: string;
	text: string;
}

// What pages are turned into; undefined leaves them as they are.
interface PageScheme {
	mode: 0 | 1;
	colors?: ObsidianBaseColors;
}

// Dark Reader's own dark scheme, used when Obsidian's colors are not matched.
const DEFAULT_DARK_COLORS: ObsidianBaseColors = {
	background: '#181a1b',
	text: '#e8e6e3',
};

export default class DarkReaderWebViewerPlugin extends Plugin {
	settings!: DarkReaderSettings;

	private readonly bindings = new Map<WebviewElement, WebviewBinding>();
	private mutationObserver?: MutationObserver;
	private scanTimer: number | null = null;
	private themeApplyTimer: number | null = null;
	private lastThemeKey = '';
	private colorContext?: CanvasRenderingContext2D | null;
	private fontFacesCache?: { family: string; faces: PageFontFace[] };

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addCommand({
			id: 'toggle-dark-reader',
			name: 'Toggle web viewer dark mode',
			callback: async () => {
				await this.updateSettings({ enabled: !this.settings.enabled });
				new Notice(
					this.settings.enabled
						? 'Dark Reader enabled for web viewer.'
						: 'Dark Reader disabled for web viewer.',
				);
			},
		});

		this.addCommand({
			id: 'reapply-dark-reader',
			name: 'Reapply web viewer dark mode',
			callback: async () => {
				this.fontFacesCache = undefined;
				await this.applyToAllWebviews(true);
				new Notice('Dark Reader reapplied to web viewer pages.');
			},
		});

		this.addSettingTab(new DarkReaderSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.scheduleScan()),
		);
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => this.scheduleScan()),
		);
		// Fires for light/dark switches, theme, font and snippet changes, all of
		// which can change what pages are matched to.
		this.registerEvent(
			this.app.workspace.on('css-change', () => {
				this.fontFacesCache = undefined;
				this.scheduleThemeApply();
			}),
		);

		this.mutationObserver = new MutationObserver((mutations) => {
			this.scheduleScan();

			const themeChanged = mutations.some(
				(mutation) =>
					mutation.type === 'attributes' &&
					mutation.target === document.body &&
					mutation.attributeName === 'class',
			);
			if (themeChanged) {
				this.scheduleThemeApply();
			}
		});
		if (document.body) {
			this.mutationObserver.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ['class'],
			});
		}
		this.lastThemeKey = this.getThemeKey();

		this.register(() => {
			if (this.scanTimer !== null) {
				window.clearTimeout(this.scanTimer);
				this.scanTimer = null;
			}
			if (this.themeApplyTimer !== null) {
				window.clearTimeout(this.themeApplyTimer);
				this.themeApplyTimer = null;
			}
			this.mutationObserver?.disconnect();
			this.mutationObserver = undefined;

			for (const binding of [...this.bindings.values()]) {
				this.unbindWebview(binding);
				if (this.isWebviewReady(binding.webview)) {
					void this.executeAction(binding.webview, { type: 'disable' }).catch(
						() => undefined,
					);
					void this.removeFallback(binding);
				}
			}
		});

		this.scheduleScan();
	}

	async updateSettings(changes: Partial<DarkReaderSettings>): Promise<void> {
		Object.assign(this.settings, changes);
		this.lastThemeKey = this.getThemeKey();
		await Promise.all([this.saveData(this.settings), this.applyToAllWebviews()]);
	}

	private async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<DarkReaderSettings>,
		);
	}

	private scheduleScan(): void {
		if (this.scanTimer !== null) {
			return;
		}

		this.scanTimer = window.setTimeout(() => {
			this.scanTimer = null;
			this.scanWebviews();
		}, 0);
	}

	private scheduleThemeApply(): void {
		if (this.themeApplyTimer !== null) {
			return;
		}

		this.themeApplyTimer = window.setTimeout(() => {
			this.themeApplyTimer = null;
			// The body class also changes for unrelated reasons, such as window
			// focus, so only reapply when the resulting action would differ.
			const themeKey = this.getThemeKey();
			if (themeKey === this.lastThemeKey) {
				return;
			}
			this.lastThemeKey = themeKey;
			void this.applyToAllWebviews();
		}, 0);
	}

	private getThemeKey(): string {
		return JSON.stringify(this.getAction());
	}

	private scanWebviews(): void {
		const discovered = this.findWebviews();

		for (const webview of discovered) {
			if (!this.bindings.has(webview)) {
				this.bindWebview(webview);
			}
		}

		for (const binding of [...this.bindings.values()]) {
			if (!discovered.has(binding.webview)) {
				this.unbindWebview(binding);
			}
		}
	}

	private findWebviews(): Set<WebviewElement> {
		const webviews = new Set<WebviewElement>();

		for (const leaf of this.app.workspace.getLeavesOfType(WEB_VIEWER_VIEW_TYPE)) {
			const webview = this.asWebview(
				leaf.view.containerEl.querySelector('webview'),
			);
			if (webview) {
				webviews.add(webview);
			}
		}

		// The view type is an internal implementation detail. Keep the class
		// selector as a fallback for Obsidian versions that do not expose the
		// native Web viewer through getLeavesOfType().
		document
			.querySelectorAll('.webviewer-content webview')
			.forEach((element) => {
				const webview = this.asWebview(element);
				if (webview) {
					webviews.add(webview);
				}
			});

		return webviews;
	}

	private asWebview(element: Element | null): WebviewElement | null {
		if (
			!element ||
			typeof (element as Partial<WebviewElement>).executeJavaScript !==
				'function'
		) {
			return null;
		}
		return element as WebviewElement;
	}

	private bindWebview(webview: WebviewElement): void {
		if (this.bindings.has(webview)) {
			return;
		}

		const binding = {} as WebviewBinding;
		binding.webview = webview;
		binding.stale = false;
		binding.reinstall = false;
		binding.navigation = 0;
		binding.onDidNavigate = () => {
			binding.navigation++;
			this.insertFallback(binding);
		};
		binding.onDomReady = () => {
			// The first page of a new tab cannot be reached before dom-ready.
			this.insertFallback(binding);
			void this.applyToBinding(binding);
		};
		binding.onDestroyed = () => {
			this.unbindWebview(binding);
		};

		webview.addEventListener('did-navigate', binding.onDidNavigate);
		webview.addEventListener('dom-ready', binding.onDomReady);
		webview.addEventListener('destroyed', binding.onDestroyed);
		this.bindings.set(webview, binding);

		// If the plugin is enabled after a page has already finished loading,
		// there will be no future dom-ready event, so apply now. A webview that
		// is still loading is handled by its dom-ready event instead.
		if (this.isWebviewReady(webview)) {
			void this.applyToBinding(binding);
		}
	}

	private isWebviewReady(webview: WebviewElement): boolean {
		// Electron throws from every webview method until the first dom-ready.
		try {
			webview.getWebContentsId();
			return true;
		} catch {
			return false;
		}
	}

	private unbindWebview(binding: WebviewBinding): void {
		binding.webview.removeEventListener('did-navigate', binding.onDidNavigate);
		binding.webview.removeEventListener('dom-ready', binding.onDomReady);
		binding.webview.removeEventListener('destroyed', binding.onDestroyed);
		this.bindings.delete(binding.webview);
	}

	private async applyToAllWebviews(reinstall = false): Promise<void> {
		this.scanWebviews();
		await Promise.all(
			[...this.bindings.values()].map((binding) =>
				this.applyToBinding(binding, reinstall),
			),
		);
	}

	// Applies run one at a time per page. A request that arrives while one is
	// running marks the page stale, and the loop applies the latest settings
	// again once the current run finishes, so no change is ever dropped.
	private applyToBinding(
		binding: WebviewBinding,
		reinstall = false,
	): Promise<void> {
		binding.stale = true;
		binding.reinstall ||= reinstall;
		if (!binding.applying) {
			binding.applying = this.drainApplies(binding).finally(() => {
				binding.applying = undefined;
			});
		}
		return binding.applying;
	}

	private async drainApplies(binding: WebviewBinding): Promise<void> {
		while (binding.stale && this.bindings.get(binding.webview) === binding) {
			binding.stale = false;
			const reinstall = binding.reinstall;
			binding.reinstall = false;
			try {
				await this.performApply(binding.webview, reinstall);
				// The page now has its real theme, or none, so the placeholder
				// colors from the start of the navigation can go.
				await this.removeFallback(binding);
			} catch (error: unknown) {
				console.warn(
					'[Dark Reader for Web Viewer] Could not update a web viewer page:',
					error,
				);
			}
		}
	}

	private async performApply(
		webview: WebviewElement,
		reinstall: boolean,
	): Promise<void> {
		const action = this.getAction();

		// The page itself reports whether this document already has the
		// controller. Load events cannot tell, because in-page navigation
		// starts loading without replacing the document.
		let result = reinstall ? false : await this.executeAction(webview, action);
		if (result === false) {
			if (action.type === 'disable' && !action.font && !reinstall) {
				return;
			}
			if (!DARK_READER_INJECTOR) {
				throw new Error(
					'Dark Reader injector is missing. Run npm run build before installing the plugin.',
				);
			}
			await webview.executeJavaScript(this.createInstallScript(), false);
			result = await this.executeAction(webview, action);
		}

		if (result === NEEDS_FONT_FACES && action.font) {
			await webview.executeJavaScript(
				this.createFontFacesScript(action.font),
				false,
			);
		}
	}

	// Electron holds every executeJavaScript() call until the page has finished
	// loading, images included, so Dark Reader cannot arrive before the page is
	// painted. insertCSS() is not held back: paint the page in the target
	// colors as soon as the navigation commits, until Dark Reader takes over.
	private insertFallback(binding: WebviewBinding): void {
		if (binding.fallback?.navigation === binding.navigation) {
			return;
		}
		const css = this.getFallbackCss();
		if (!css || !this.isWebviewReady(binding.webview)) {
			return;
		}
		binding.fallback = {
			navigation: binding.navigation,
			key: binding.webview.insertCSS(css).catch(() => undefined),
		};
	}

	private async removeFallback(binding: WebviewBinding): Promise<void> {
		const fallback = binding.fallback;
		if (!fallback) {
			return;
		}
		binding.fallback = undefined;
		const key = await fallback.key;
		if (key) {
			await binding.webview.removeInsertedCSS(key).catch(() => undefined);
		}
	}

	private getFallbackCss(): string | undefined {
		const scheme = this.getScheme();
		if (!scheme) {
			return undefined;
		}
		const { background, text } = scheme.colors ?? DEFAULT_DARK_COLORS;
		// Dark Reader's own fallback style, which it shows while it starts up.
		return `html, body, body :not(iframe) {
	background-color: ${background} !important;
	border-color: color-mix(in srgb, ${text} 30%, ${background}) !important;
	color: ${text} !important;
}`;
	}

	private getScheme(): PageScheme | undefined {
		if (!this.settings.enabled) {
			return undefined;
		}

		const dark = this.isObsidianDark();
		const colors = this.settings.matchObsidianColors
			? this.getObsidianBaseColors()
			: undefined;

		// Matched pages take Obsidian's palette in both themes: Dark Reader's
		// dark mode while Obsidian is dark, its light mode while it is light.
		if (colors) {
			return { mode: dark ? 1 : 0, colors };
		}

		// Unmatched pages are darkened with Dark Reader's own colors, except in
		// light Obsidian when following its theme.
		if (!dark && this.settings.followObsidianTheme) {
			return undefined;
		}
		return { mode: 1 };
	}

	private getAction(): DarkReaderAction {
		const font = this.getObsidianFont();
		const scheme = this.getScheme();
		if (!scheme) {
			return { type: 'disable', font };
		}

		const { colors } = scheme;
		const filter = colors
			? reachableFilter(this.getFilterOptions(), [colors.background, colors.text])
			: this.getFilterOptions();
		const theme: DarkReaderThemeOptions = { ...filter, mode: scheme.mode };
		if (colors) {
			const background = unfilterColor(colors.background, filter);
			const text = unfilterColor(colors.text, filter);
			if (scheme.mode === 1) {
				theme.darkSchemeBackgroundColor = background;
				theme.darkSchemeTextColor = text;
			} else {
				theme.lightSchemeBackgroundColor = background;
				theme.lightSchemeTextColor = text;
			}
		}
		return { type: 'enable', theme, font };
	}

	private isObsidianDark(): boolean {
		return document.body?.classList.contains('theme-dark') ?? false;
	}

	private getFilterOptions(): Omit<DarkReaderThemeOptions, 'mode'> {
		return {
			brightness: this.settings.brightness,
			contrast: this.settings.contrast,
			sepia: this.settings.sepia,
		};
	}

	private getObsidianBaseColors(): ObsidianBaseColors | undefined {
		if (!document.body) {
			return undefined;
		}
		const styles = getComputedStyle(document.body);
		const background = this.toHexColor(
			styles.getPropertyValue('--background-primary'),
		);
		const text = this.toHexColor(styles.getPropertyValue('--text-normal'));
		return background && text ? { background, text } : undefined;
	}

	// Themes may write colors in any CSS syntax (hsl(), color-mix(), named
	// colors...). Dark Reader needs plain sRGB, so let the browser resolve them.
	private toHexColor(value: string): string | undefined {
		const color = value.trim();
		if (!color || !CSS.supports('color', color)) {
			return undefined;
		}

		if (this.colorContext === undefined) {
			const canvas = createEl('canvas', { attr: { width: 1, height: 1 } });
			this.colorContext = canvas.getContext('2d', { willReadFrequently: true });
		}
		const context = this.colorContext;
		if (!context) {
			return undefined;
		}

		context.clearRect(0, 0, 1, 1);
		context.fillStyle = color;
		context.fillRect(0, 0, 1, 1);
		const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
		return toHex([red / 255, green / 255, blue / 255]);
	}

	private getObsidianFont(): PageFont | undefined {
		if (!this.settings.matchObsidianFont || !document.body) {
			return undefined;
		}

		// Obsidian fills unset font slots with the placeholder family '??'.
		const family = splitFontFamilies(
			getComputedStyle(document.body).getPropertyValue('--font-text'),
		)
			.filter((name) => unquoteFontFamily(name) !== '??')
			.join(', ');
		if (!family || family.length > 2000 || /[;{}<>\\]/.test(family)) {
			return undefined;
		}
		return { family, facesKey: family };
	}

	// The page cannot load fonts from Obsidian's app:// origin, but themes embed
	// their fonts as data URLs, which can be carried over as they are.
	private getFontFaces(family: string): PageFontFace[] {
		if (this.fontFacesCache?.family === family) {
			return this.fontFacesCache.faces;
		}

		const names = new Set(splitFontFamilies(family).map(unquoteFontFamily));
		const faces: PageFontFace[] = [];
		for (const sheet of Array.from(document.styleSheets)) {
			let cssRules: CSSRuleList;
			try {
				cssRules = sheet.cssRules;
			} catch {
				continue;
			}
			for (const rule of Array.from(cssRules)) {
				if (!(rule instanceof CSSFontFaceRule)) {
					continue;
				}
				const style = rule.style;
				const name = style.getPropertyValue('font-family').trim();
				if (!names.has(unquoteFontFamily(name))) {
					continue;
				}
				const source = /url\(\s*(['"]?)(data:.*?)\1\s*\)/.exec(
					style.getPropertyValue('src'),
				)?.[2];
				if (!source) {
					continue;
				}
				const descriptors: FontFaceDescriptors = {};
				const weight = style.getPropertyValue('font-weight');
				const fontStyle = style.getPropertyValue('font-style');
				const stretch = style.getPropertyValue('font-stretch');
				const unicodeRange = style.getPropertyValue('unicode-range');
				if (weight) descriptors.weight = weight;
				if (fontStyle) descriptors.style = fontStyle;
				if (stretch) descriptors.stretch = stretch;
				if (unicodeRange) descriptors.unicodeRange = unicodeRange;
				faces.push({
					family: name.replace(/^(['"])(.*)\1$/, '$2'),
					source,
					descriptors,
				});
			}
		}

		this.fontFacesCache = { family, faces };
		return faces;
	}

	private executeAction(
		webview: WebviewElement,
		action: DarkReaderAction,
	): Promise<unknown> {
		return webview.executeJavaScript(this.createActionScript(action), false);
	}

	private createInstallScript(): string {
		const key = JSON.stringify(DARK_READER_CONTROLLER_KEY);
		return `${DARK_READER_INJECTOR}
;if (globalThis[${key}]) { globalThis[${key}].build = ${JSON.stringify(INJECTOR_BUILD)}; }`;
	}

	private createActionScript(action: DarkReaderAction): string {
		return `(() => {
	const controller = globalThis[${JSON.stringify(DARK_READER_CONTROLLER_KEY)}];
	if (!controller || controller.build !== ${JSON.stringify(INJECTOR_BUILD)}) {
		return false;
	}
	return controller.apply(${JSON.stringify(action)});
})()`;
	}

	private createFontFacesScript(font: PageFont): string {
		return `(() => {
	const controller = globalThis[${JSON.stringify(DARK_READER_CONTROLLER_KEY)}];
	controller?.setFontFaces?.(${JSON.stringify(font.facesKey)}, ${JSON.stringify(this.getFontFaces(font.family))});
})()`;
	}
}
