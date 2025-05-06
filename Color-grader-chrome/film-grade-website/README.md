# Film Grade - Website Color Grading Chrome Extension

![Film Grade](assets/icon.png)

## Overview

Film Grade is a Chrome extension that manipulates media assets on websites to apply film-inspired color grading. It transforms images and backgrounds to simulate different film stocks like Fuji and Kodak, and adds optional film grain and vignette effects.

## Features

- **Film Emulation Presets**: Apply realistic film emulation to images using LUT (Look-Up Table) technology
- **Multiple Film Stocks**: Choose between different film looks (Fuji, Kodak)
- **Film Grain Effect**: Add authentic film grain
- **Vignette Effect**: Apply subtle darkening around the edges
- **Easy Toggle**: Quickly enable/disable the extension with a single click
- **SVG/Vector Safe**: Only processes actual images (not SVGs or vector graphics)

## Technical Details

This extension is built using:
- [Plasmo Framework](https://docs.plasmo.com/) for Chrome extension development
- React for the UI components
- TypeScript for type-safe code
- CUBE LUT format for color grading

## Development

This is a [Plasmo extension](https://docs.plasmo.com/) project bootstrapped with [`plasmo init`](https://www.npmjs.com/package/plasmo).

### Getting Started

First, run the development server:

```bash
pnpm dev
# or
npm run dev
```

Open your browser and load the appropriate development build. For example, if you are developing for the chrome browser, using manifest v3, use: `build/chrome-mv3-dev`.

You can start editing the popup by modifying `popup.tsx`. It should auto-update as you make changes. To add an options page, simply add a `options.tsx` file to the root of the project, with a react component default exported. Likewise to add a content page, add a `content.ts` file to the root of the project, importing some module and do some logic, then reload the extension on your browser.

For further guidance, [visit our Documentation](https://docs.plasmo.com/)

### Making production build

Run the following:

```bash
pnpm build
# or
npm run build
```

This should create a production bundle for your extension, ready to be zipped and published to the Chrome Web Store.

## How It Works

The extension works by:
1. Finding all images and background images on a webpage
2. Creating a canvas to draw each image
3. Applying the selected Look-Up Table (LUT) using WebGL
4. Adding optional effects (grain, vignette)
5. Replacing the original image with the processed one

## License

MIT License

## Submit to the webstores

The easiest way to deploy your Plasmo extension is to use the built-in [bpp](https://bpp.browser.market) GitHub action. Prior to using this action however, make sure to build your extension and upload the first version to the store to establish the basic credentials. Then, simply follow [this setup instruction](https://docs.plasmo.com/framework/workflows/submit) and you should be on your way for automated submission!
