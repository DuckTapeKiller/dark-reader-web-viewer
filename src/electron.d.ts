// The parts of Electron's renderer API this plugin uses. Obsidian provides the
// module at run time; the plugin does not bundle Electron.
declare module 'electron' {
	interface DebuggerClient {
		isAttached(): boolean;
		attach(protocolVersion?: string): void;
		detach(): void;
		sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
	}

	interface WebContents {
		isDestroyed(): boolean;
		readonly debugger: DebuggerClient;
	}

	export const remote:
		| {
				webContents?: {
					fromId(id: number): WebContents | undefined;
				};
		  }
		| undefined;
}
