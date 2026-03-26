# Contributing a Plugin

## Step-by-Step Guide

### 1. Fork this repo

Click the **Fork** button at the top right of this page. This creates your own copy.

### 2. Create your plugin folder

In your fork, create a new folder with your plugin name (lowercase, hyphens):
```
my-awesome-avatar/
```

### 3. Add plugin.json

Every plugin needs a `plugin.json` — see the [README](README.md) for the full spec.

### 4. Add your files

- **Face scripts** go in `faces/`
- **Canvas pages** go in `pages/`
- **API routes** go in `routes/`
- **Example profiles** go in `profiles/`
- **Add a README.md** with screenshots and credits

### 5. Open a Pull Request

Go to the original repo and click "New Pull Request". Select your fork. Describe what your plugin does.

### 6. Review

We'll review your submission for:
- Valid plugin.json structure
- No security issues (eval, external tracking, obfuscated code)
- Working functionality
- Proper attribution and licensing

We may request changes — this is normal and collaborative.

### 7. Merge

Once approved, your plugin is available to all OpenVoiceUI users. Your GitHub username is credited as the author.

## Guidelines

- Keep plugins self-contained — don't depend on other plugins
- Use the FaceRenderer.registerFace() API for face plugins
- Host large assets (images, audio) externally (GitHub Pages, CDN) — don't put huge files in this repo
- Include a LICENSE file or specify the license in plugin.json
- Be respectful of intellectual property — only submit art you have rights to use
