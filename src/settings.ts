import { App, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type DarkReaderWebViewerPlugin from './main';

export interface DarkReaderSettings {
	enabled: boolean;
	followObsidianTheme: boolean;
	matchObsidianColors: boolean;
	matchObsidianFont: boolean;
	brightness: number;
	contrast: number;
	sepia: number;
}

export const DEFAULT_SETTINGS: DarkReaderSettings = {
	enabled: true,
	followObsidianTheme: false,
	matchObsidianColors: true,
	matchObsidianFont: false,
	brightness: 100,
	contrast: 90,
	sepia: 0,
};

type SettingKey = keyof DarkReaderSettings;

export class DarkReaderSettingTab extends PluginSettingTab {
	plugin: DarkReaderWebViewerPlugin;

	constructor(app: App, plugin: DarkReaderWebViewerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				type: 'group',
				heading: 'Dark Reader',
				items: [
					{
						name: 'Enable Dark Reader',
						desc: 'Apply Dark Reader to pages opened in the web viewer.',
						control: {
							type: 'toggle',
							key: 'enabled',
							defaultValue: DEFAULT_SETTINGS.enabled,
						},
					},
					{
						name: 'Follow Obsidian theme',
						desc: 'Leave pages unchanged while Obsidian uses its light theme. Only applies when pages do not match Obsidian base colors.',
						control: {
							type: 'toggle',
							key: 'followObsidianTheme',
							defaultValue: DEFAULT_SETTINGS.followObsidianTheme,
						},
					},
					{
						name: 'Match Obsidian base colors',
						desc: "Give pages Obsidian's background and text colors, light or dark to match Obsidian. Links and accents keep their own colors.",
						control: {
							type: 'toggle',
							key: 'matchObsidianColors',
							defaultValue: DEFAULT_SETTINGS.matchObsidianColors,
						},
					},
					{
						name: 'Match Obsidian font',
						desc: "Show page text in Obsidian's text font. Code and icon fonts are left alone.",
						control: {
							type: 'toggle',
							key: 'matchObsidianFont',
							defaultValue: DEFAULT_SETTINGS.matchObsidianFont,
						},
					},
					{
						name: 'Brightness',
						desc: 'Dark Reader brightness percentage.',
						control: {
							type: 'slider',
							key: 'brightness',
							min: 50,
							max: 150,
							step: 1,
							defaultValue: DEFAULT_SETTINGS.brightness,
							displayFormat: (value) => `${value}%`,
						},
					},
					{
						name: 'Contrast',
						desc: 'Dark Reader contrast percentage.',
						control: {
							type: 'slider',
							key: 'contrast',
							min: 50,
							max: 150,
							step: 1,
							defaultValue: DEFAULT_SETTINGS.contrast,
							displayFormat: (value) => `${value}%`,
						},
					},
					{
						name: 'Sepia',
						desc: 'Dark Reader sepia percentage.',
						control: {
							type: 'slider',
							key: 'sepia',
							min: 0,
							max: 50,
							step: 1,
							defaultValue: DEFAULT_SETTINGS.sepia,
							displayFormat: (value) => `${value}%`,
						},
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		if (!this.isSettingKey(key)) {
			return undefined;
		}
		return this.plugin.settings[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!this.isSettingKey(key)) {
			return;
		}

		const currentValue = this.plugin.settings[key];
		if (typeof currentValue !== typeof value) {
			return;
		}

		await this.plugin.updateSettings({
			[key]: value,
		});
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Enable Dark Reader')
			.setDesc('Apply Dark Reader to pages opened in the web viewer.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enabled)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ enabled: value });
					}),
			);

		new Setting(containerEl)
			.setName('Follow Obsidian theme')
			.setDesc(
				'Leave pages unchanged while Obsidian uses its light theme. Only applies when pages do not match Obsidian base colors.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.followObsidianTheme)
					.onChange(async (value) => {
						await this.plugin.updateSettings({
							followObsidianTheme: value,
						});
					}),
			);

		new Setting(containerEl)
			.setName('Match Obsidian base colors')
			.setDesc(
				"Give pages Obsidian's background and text colors, light or dark to match Obsidian. Links and accents keep their own colors.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.matchObsidianColors)
					.onChange(async (value) => {
						await this.plugin.updateSettings({
							matchObsidianColors: value,
						});
					}),
			);

		new Setting(containerEl)
			.setName('Match Obsidian font')
			.setDesc(
				"Show page text in Obsidian's text font. Code and icon fonts are left alone.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.matchObsidianFont)
					.onChange(async (value) => {
						await this.plugin.updateSettings({
							matchObsidianFont: value,
						});
					}),
			);

		new Setting(containerEl)
			.setName('Brightness')
			.setDesc('Dark Reader brightness percentage.')
			.addSlider((slider) =>
				slider
					.setLimits(50, 150, 1)
					.setValue(this.plugin.settings.brightness)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ brightness: value });
					}),
			);

		new Setting(containerEl)
			.setName('Contrast')
			.setDesc('Dark Reader contrast percentage.')
			.addSlider((slider) =>
				slider
					.setLimits(50, 150, 1)
					.setValue(this.plugin.settings.contrast)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ contrast: value });
					}),
			);

		new Setting(containerEl)
			.setName('Sepia')
			.setDesc('Dark Reader sepia percentage.')
			.addSlider((slider) =>
				slider
					.setLimits(0, 50, 1)
					.setValue(this.plugin.settings.sepia)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ sepia: value });
					}),
			);
	}

	private isSettingKey(key: string): key is SettingKey {
		return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
	}
}
