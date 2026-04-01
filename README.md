# OpenVoiceUI Plugins

Community plugins for [OpenVoiceUI](https://github.com/MCERQUA/OpenVoiceUI) — animated face avatars, canvas pages, tools, and customizations.

## What's a Plugin?

A plugin is a folder with a `plugin.json` manifest and the files it provides. Plugins can add:

- **Face avatars** — animated characters that replace the default AI face (lip-sync, expressions, custom art)
- **Canvas pages** — interactive HTML tools (character builders, dashboards, games)
- **API routes** — backend endpoints for plugin-specific data
- **Example profiles** — pre-configured agent personalities that use the plugin
- **Gateways** — alternative LLM backends (connect to different AI providers)
- **OpenClaw extensions** — plugins that add capabilities to the OpenClaw agent (memory, tools, context engines)

## Available Plugins

| Plugin | Type | Description | Author |
|--------|------|-------------|--------|
| [BHB Animated Characters](bhb-animated-characters/) | face | Animated BigHead Billionaires character avatars with lip-sync, mood expressions, character builder, and show lore | bhaleyart |
| [ByteRover Long-Term Memory](byterover-memory/) | openclaw-extension | Persistent long-term memory via ByteRover context engine. Curates knowledge every turn into a markdown knowledge base | OpenVoiceUI |
| [Hermes Agent](hermes-agent/) | gateway | Self-improving AI agent with auto-generated skills, deep memory search, and autonomous tasks | Nous Research / JamBot |
| [Example Gateway](example-gateway/) | gateway | Reference echo gateway implementation. Use as a template for custom LLM backends | OpenVoiceUI |

## How to Submit a Plugin

### Quick Start (no coding experience needed)

1. **Fork this repo** — click the "Fork" button at the top right
2. **Create your plugin folder** — name it something like `my-cool-avatar`
3. **Add your files** following the [plugin template](#plugin-structure) below
4. **Open a Pull Request** — we'll review it, help you fix anything, and merge it when ready

You can do all of this through GitHub's web interface — no git command line needed. Just click "Add file" > "Upload files" in your fork.

### Plugin Structure

```
your-plugin-name/
  plugin.json              # Required — describes your plugin
  README.md                # Required — what it does, screenshots, credits
  faces/                   # Face avatar files (if your plugin adds a face)
    YourFace.js            #   JavaScript renderer
    your-face.css          #   Styles
    previews/icon.svg      #   Thumbnail for the face picker
  pages/                   # Canvas pages (if any)
    builder.html           #   Interactive config/builder page
  routes/                  # Python API routes (if any)
    your_api.py            #   Flask blueprint
  profiles/                # Example agent profiles (if any)
    example-character.json #   Pre-configured personality
```

### plugin.json

```json
{
  "id": "your-plugin-name",
  "name": "Your Plugin Display Name",
  "version": "1.0.0",
  "description": "What your plugin does in one sentence",
  "author": "YourGitHubUsername",
  "type": "face",
  "license": "MIT",

  "faces": [{
    "id": "your-face-id",
    "name": "Your Face Name",
    "script": "faces/YourFace.js",
    "css": "faces/your-face.css",
    "preview": "faces/previews/icon.svg",
    "moods": ["neutral", "happy", "sad", "angry"],
    "features": ["lip-sync", "customizable"],
    "configurable": true,
    "config_page": "builder.html"
  }],

  "pages": [{
    "file": "pages/builder.html",
    "name": "Character Builder",
    "icon": "icon-emoji-here"
  }],

  "routes": [{
    "module": "routes/your_api.py",
    "blueprint": "your_bp"
  }],

  "profiles": [
    "profiles/example-character.json"
  ]
}
```

### Face Plugin JavaScript

Your face script should be a self-contained IIFE that registers with the FaceRenderer plugin system:

```javascript
window.YourFace = (function() {
    // Your rendering code here...

    return {
        start(container, config) { /* start rendering */ },
        stop() { /* cleanup */ },
        setMood(mood) { /* change expression */ },
        setThinking(v) { /* thinking animation */ }
    };
})();

// Self-register with OpenVoiceUI
if (window.FaceRenderer?.registerFace) {
    window.FaceRenderer.registerFace('your-face-id', {
        start(container, config) { window.YourFace.start(container, config); },
        stop() { window.YourFace.stop(); },
        setMood(mood) { window.YourFace.setMood(mood); },
        setThinking(v) { window.YourFace.setThinking(v); }
    }, {
        name: 'Your Face Name',
        description: 'What your face does'
    });
}
```

## Review Process

When you submit a PR:

1. We check that `plugin.json` is valid
2. We review the code for safety (no eval, no external data collection, no malicious behavior)
3. We test it in a sandbox environment
4. We may suggest changes or improvements
5. Once approved, we merge — the plugin becomes available to all OpenVoiceUI installations

## For Art Projects / NFT Collections

If you have a character art collection (like BigHead Billionaires, Bored Apes, CryptoPunks, etc.) and want to create an animated face plugin:

1. You provide the layered character art (PNG/SVG layers for body parts)
2. Host the assets on GitHub Pages, IPFS, or any CDN
3. The face script loads layers and composites them on a canvas
4. A character builder page lets users customize their character
5. Submit it as a plugin — your community gets animated AI avatars

We can help you build it. Open an issue or reach out.

## License

Each plugin specifies its own license in `plugin.json`. The plugin system infrastructure is MIT licensed.
