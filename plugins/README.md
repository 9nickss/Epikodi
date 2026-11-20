# EpiKodi plugins

A plugin adds a section to the EpiKodi sidebar. It is a folder containing a
`manifest.json` file and a web page (HTML/CSS/JS). It does not need a build
step or `npm install`, and EpiKodi does not need to be recompiled.

This folder contains the plugins shipped with EpiKodi. `radio-web/` is the
reference example: it plays web radios in the EpiKodi player, searches the
[Radio Browser](https://www.radio-browser.info/) directory and saves favorites.

## Installing a plugin

1. Open **Plugins** in the sidebar, then click **Open folder**. This opens
   `userData/plugins/`. On Linux, this is `~/.config/EpiKodi/plugins/`.
2. Copy the plugin folder into it.
3. Click **Reload**. The section appears in the sidebar under *Explorer*.

The same page lets you enable or disable each plugin. It also lists folders
that could not be loaded, with the reason. A broken plugin is ignored, and it
never prevents the others or the app from starting.

## Folder structure

```
my-plugin/
├─ manifest.json   # required
├─ index.html      # page shown in the section (section.entry)
├─ app.js          # anything else is up to you: scripts, styles, images, JSON...
└─ style.css
```

## `manifest.json`

```json
{
  "id": "my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "What it does, shown on the Plugins page.",
  "author": "Me",
  "section": { "label": "My section", "icon": "🧩", "entry": "index.html" },
  "permissions": []
}
```

| Field | Required | Description |
|---|---|---|
| `id` | yes | Lowercase letters, digits and dashes. Must be unique (a user plugin cannot reuse the id of a bundled plugin). |
| `name`, `version` | yes | Shown on the Plugins page. |
| `apiVersion` | yes | Version of the message API targeted by the plugin (currently `1`). A plugin requesting a newer version is rejected with an explicit message. |
| `section.label` | yes | Name of the entry in the sidebar. |
| `section.icon` | no | One emoji or up to 4 characters (default `🧩`). |
| `section.entry` | no | Page to show, relative to the folder (default `index.html`). |
| `permissions` | no | See below. |
| `description`, `author` | no | Shown on the Plugins page. |

### Permissions

| Permission | Grants |
|---|---|
| `network` | `fetch()` to `https://` APIs and displaying `https://` images. Without it, the page can only load its own files. |
| `library` | `epikodi.library.list()` and the `libraryChanged` event. |

## Isolation

The page is displayed in an `<iframe sandbox="allow-scripts allow-forms">` and served on
`app-plugin://<id>/`:

- it has no access to Node, IPC, `window.epikodi` or the EpiKodi DOM;
- it cannot open windows or navigate away from `app-plugin://`;
- forms work (the `submit` event fires), but the CSP blocks actually sending
  them: handle `submit` in JavaScript with `event.preventDefault()`;
- its scripts can only come from its own folder (CSP header), so inline
  `<script>` blocks are rejected, use `.js` files;
- `localStorage` is not available (opaque origin), use `epikodi.storage`.

Nothing from a plugin runs in the Electron main process: the loader only
reads the manifest and serves the files.

## JavaScript API

Include the SDK served by EpiKodi at the root of every plugin, before your
own scripts:

```html
<script src="epikodi-sdk.js"></script>
<script src="app.js" defer></script>
```

The SDK exposes `window.epikodi` and applies the EpiKodi theme to the page.
Your CSS can use the same variables as the app, and they follow theme
changes live: `--bg`, `--bg-elevated`, `--text`, `--text-h`, `--accent`,
`--accent-bg`, `--accent-border`, `--accent-contrast`, `--border`, `--danger`,
`--ok`, `--warning`, `--sans`, `--mono`... The theme id is also set on
`<html data-theme="...">` (for example `[data-theme^='metro']` targets all
Metro themes). Leave `body` with a transparent background so the EpiKodi
background shows through the frame.

All methods return a Promise. It rejects with an `Error` when EpiKodi refuses
the request, for example on an invalid parameter or a missing permission.

```js
const info = await epikodi.ready
// { pluginId, apiVersion, theme, nowPlaying }

// play a stream or a remote file in the EpiKodi player (http/https)
await epikodi.player.play({
  url: 'https://icecast.radiofrance.fr/fip-midfi.mp3',
  title: 'FIP',
  subtitle: 'eclectique', // optional, second line in the player
  kind: 'audio', // 'audio' (default) or 'video'
})

// what is currently playing, or null
// { title, kind, source: 'library' | 'stream', url }
// url is only provided for a stream opened by this plugin
await epikodi.player.state()

// JSON values saved per plugin (256 KB max per key, null deletes the key)
await epikodi.storage.set('favorites', [{ name: 'FIP' }])
await epikodi.storage.get('favorites')

// "library" permission: media in the library, without file paths
// [{ id, title, category: 'film' | 'music' | 'podcast', kind, durationSeconds, artist, album, year }]
await epikodi.library.list()

// events - on() returns an unsubscribe function
epikodi.on('nowPlaying', (nowPlaying) => {})
epikodi.on('theme', (theme) => {}) // already applied by the SDK
epikodi.on('libraryChanged', ({ count }) => {}) // "library" permission
```

Playback started by a plugin keeps going when the user leaves the plugin
section, like any other EpiKodi media.

## Debugging

- The **Reload** button, in the plugin section or on the Plugins page, rereads
  the manifests and reloads the page. You do not need to restart EpiKodi.
- In development, `console.log` messages from the plugin appear in the
  Electron DevTools (the iframe has its own JavaScript context).
- Under the hood, the SDK exchanges messages through `postMessage`:
  `{ tag: 'epikodi-plugin', type: 'request' | 'response' | 'event', ... }`. The
  exact format is documented in `shared/plugins.ts`.
