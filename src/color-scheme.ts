import { remote } from 'electron';

const LIGHT_SCHEME = [{ name: 'prefers-color-scheme', value: 'light' }];

/**
 * Web viewer pages see the system's light or dark preference, not Obsidian's.
 * With the system in dark mode, a site like GitHub serves its dark design even
 * while Obsidian is light, and Dark Reader's light mode keeps dark pages dark.
 *
 * While pages are themed, this makes them prefer a light scheme instead,
 * through each page's own DevTools protocol. Dark Reader then always starts
 * from a site's light design, which it maps exactly onto Obsidian's colors in
 * both modes. Obsidian and the system setting are not affected.
 */
export class PageColorScheme {
	// Pages whose debugger this plugin attached, and so may detach again.
	private readonly owned = new Set<number>();

	async preferLight(webContentsId: number, light: boolean): Promise<void> {
		const webContents = remote?.webContents?.fromId(webContentsId);
		if (!webContents || webContents.isDestroyed()) {
			this.owned.delete(webContentsId);
			return;
		}

		const client = webContents.debugger;
		try {
			if (!this.owned.has(webContentsId)) {
				// Something else is debugging this page; leave it alone.
				if (!light || client.isAttached()) {
					return;
				}
				client.attach('1.3');
				this.owned.add(webContentsId);
			}
			await client.sendCommand('Emulation.setEmulatedMedia', {
				features: light ? LIGHT_SCHEME : [],
			});
			if (!light) {
				client.detach();
				this.owned.delete(webContentsId);
			}
		} catch {
			// The page closed or its debugger was detached elsewhere.
			this.owned.delete(webContentsId);
		}
	}
}
