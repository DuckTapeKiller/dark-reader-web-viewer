# Dark Reader for Web Viewer

A desktop-only [Obsidian](https://obsidian.md/) plugin that applies [Dark Reader](https://github.com/darkreader/darkreader) to pages opened in Obsidian's native **Web viewer**.

It does not install a Chrome or Firefox extension. Instead, it bundles Dark Reader's public JavaScript API inside the plugin and injects it into Obsidian's Electron webview.

## Features

- Applies Dark Reader to native Web viewer tabs, including tabs in popout windows.
- Works with multiple Web viewer tabs.
- Reapplies Dark Reader after page navigation, without a white flash while the next page loads.
- Matches pages to Obsidian's background and text colors, and follows theme, light/dark and snippet changes as they happen.
- Optionally shows pages in Obsidian's text font, including fonts embedded in a theme.
- Enable or disable it from the command palette or plugin settings.
- Optionally follows Obsidian's light/dark theme.
- Configurable brightness, contrast, and sepia values.
- Does not load Dark Reader from a remote CDN at runtime.

## Requirements

- Obsidian for desktop.
- Obsidian 1.8.3 or newer.
- The built-in **Web viewer** core plugin enabled.

Mobile Obsidian is not supported because this plugin uses Electron's desktop `<webview>` API.

## Installation

### Manual installation

1. Download `manifest.json` and `main.js` from the latest GitHub release, or build them from source.
2. Create this directory inside your vault:

   ```text
   .obsidian/plugins/dark-reader-web-viewer/
   ```

3. Copy `manifest.json` and `main.js` into that directory.
4. Restart Obsidian, or reload the application.
5. Enable **Dark Reader for Web Viewer** under **Settings → Community plugins**.

The built-in **Web viewer** core plugin must also be enabled.

### Build from source

```sh
git clone https://github.com/DuckTapeKiller/dark-reader-web-viewer.git
cd dark-reader-web-viewer
npm install
npm run build
```

The production plugin bundle is written to `main.js`.

For development with an automatic rebuild watcher:

```sh
npm run dev
```

## Code quality and dependency updates

Every production build runs the official [Obsidian ESLint plugin](https://github.com/obsidianmd/eslint-plugin) before TypeScript checking and bundling:

```text
npm run lint (zero warnings) → tsc --noEmit → esbuild
```

Lint warnings are treated as build failures. The configuration uses the plugin's recommended rules and checks the TypeScript source, settings UI, Obsidian API usage, command names, and user-interface text.

Refresh the linting toolchain to its latest published versions with:

```sh
npm run update:lint
```

The repository also uses Dependabot to propose dependency updates, while the lockfile keeps ordinary builds reproducible.

## Settings

Open the plugin's settings to configure:

- **Enable Dark Reader** — enable or disable page theming.
- **Follow Obsidian theme** — leave pages unchanged while Obsidian is using its light theme. It only applies when **Match Obsidian base colors** is off; matched pages always follow Obsidian.
- **Match Obsidian base colors** — make a page's base background and text exactly Obsidian's `--background-primary` and `--text-normal`, light or dark to match Obsidian. Dark Reader derives every other color from them, so links, buttons and accents keep their own colors. This is enabled by default.
- **Match Obsidian font** — show page text in Obsidian's text font (`--font-text`). Code, preformatted text and icon fonts are left alone. Disabled by default.
- **Brightness** — Dark Reader brightness percentage.
- **Contrast** — Dark Reader contrast percentage.
- **Sepia** — Dark Reader sepia percentage.

How the theme settings combine:

| Obsidian | Follow Obsidian theme | Match Obsidian base colors | Web viewer pages |
| --- | --- | --- | --- |
| Dark | either | on | Dark, in Obsidian's colors |
| Light | either | on | Light, in Obsidian's colors |
| Dark | either | off | Dark, in Dark Reader's default colors |
| Light | off | off | Dark, in Dark Reader's default colors |
| Light | on | off | Unchanged |

The command palette provides:

- **Toggle web viewer dark mode**
- **Reapply web viewer dark mode**

## How it works

The plugin watches for Obsidian Web viewer elements and binds to their Electron lifecycle events. It uses `webview.executeJavaScript()` to install a locally bundled Dark Reader API in each page and drive it with `DarkReader.enable()` and `DarkReader.disable()`. Before every update it asks the page whether this document already runs the current build's controller, so in-page navigation, reloads and plugin updates are all handled the same way. Updates to a page run one at a time, and the latest settings always win.

Electron holds `executeJavaScript()` until a page has finished loading, images included. To avoid a white flash in the meantime, the plugin paints each newly committed page in the target colors with `webview.insertCSS()`, which is not held back, and removes that style once Dark Reader is running.

**Match Obsidian base colors** passes Obsidian's colors to Dark Reader as its scheme colors. Dark Reader turns a page's white background and black text into exactly those colors and then applies brightness, contrast and sepia, so the plugin hands it colors with that filter already undone. The page's base colors then come out as Obsidian's own.

**Match Obsidian font** reads Obsidian's text font and sets it on the page with a constructed stylesheet. Fonts that a theme embeds as data URLs are recreated in the page with the `FontFace` API, so they also load on sites whose content security policy blocks web fonts. They are sent once per page.

The injector is generated during the build from the [`darkreader`](https://www.npmjs.com/package/darkreader) package. No third-party script is downloaded while the plugin is running.

## Known limitations

- The native Web viewer's `webviewer` view type and DOM structure are internal Obsidian implementation details rather than a stable public plugin API. An Obsidian update may require changes.
- The plugin only affects native Web viewer tabs. It does not affect external browsers, Markdown preview, Canvas, or other embedded pages.
- Page-specific Dark Reader settings and the full browser-extension settings UI are not included.
- Cross-origin pages may behave differently from pages viewed through a full browser extension because this plugin runs through the page's Electron webview context.
- At low brightness or contrast, Dark Reader cannot reach Obsidian's exact colors, and pages come out dimmer than Obsidian.
- **Match Obsidian font** can only use fonts installed on the system or embedded in the theme. Obsidian's own bundled fonts are served from its app origin, which pages cannot reach, so the next font in the list is used instead.

## Development notes

`src/generated-injector.ts` is a build-time placeholder. `esbuild.config.mjs` replaces it with the bundled Dark Reader injector before producing `main.js`; do not edit the generated value manually.

Run the production checks with:

```sh
npm run build
node --check main.js
```

## Licence

This project is distributed under the MIT License. See [`LICENSE`](LICENSE).

Dark Reader is included under its own MIT License. See [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
