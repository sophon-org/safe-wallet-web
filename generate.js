const { favicons } = require('favicons');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config();

const TEMPLATE_ID = process.env.TEMPLATE_ID || 'generated';
const BRAND_NAME = process.env.BRAND_NAME || 'Protofire Safe';

(async () => {
  try {
    // Default folder for config template application
    const defaultFolder = path.join(__dirname,`../networks/default`)

    // Source SVGs
    const logoNoTextSvg = 'logo-wo-text.svg';     // SVG without text
    const logoTextSvg = 'logo-w-text.svg';  // SVG with text

    // Output folders
    const networkFolder = path.join(__dirname,`../networks/${TEMPLATE_ID}`)
    const publicFolder = path.join(networkFolder, `public`);
    const faviconsFolder = path.join(publicFolder, 'favicons');
    const imagesFolder = path.join(publicFolder, 'images');


    // Ensure output folders exist
    await fs.mkdir(faviconsFolder, { recursive: true });
    await fs.mkdir(imagesFolder, { recursive: true });

  
    // STEP 1: copy default .json assets
    await fs.copyFile(path.join(defaultFolder, 'config.json'), path.join(networkFolder, 'config.json'));

    // Copy default manifest and update with BRAND_NAME values
    const defaultManifest = await fs.readFile(path.join(defaultFolder, 'public/safe.webmanifest'), 'utf8');

    const newManifest = JSON.parse(defaultManifest)
    newManifest.name = BRAND_NAME;
    newManifest.short_name = BRAND_NAME;
    newManifest.description = `${BRAND_NAME} is a trusted platform to manage digital assets on chain.`

    fs.writeFile(path.join(publicFolder, 'safe.webmanifest'), JSON.stringify(newManifest, null, 2), 'utf8');

    console.log(`Applied default config and manifest values for ${BRAND_NAME}. Make sure to edit if needed.`);

    // STEP 2: generate favicons
    const faviconNames = [
      "android-chrome-192x192.png",
      "android-chrome-512x512.png",
      "apple-touch-icon.png",
      "favicon-16x16.png",
      "favicon-32x32.png",
      "logo_120x120.png",
      "mstile-70x70.png",
      "mstile-144x144.png",
      "mstile-150x150.png",
      "mstile-310x150.png",
      "mstile-310x310.png",
      "safari-pinned-tab.svg"
    ];

    const response = await favicons(logoNoTextSvg, {
      icons: {
        android: true,
        appleIcon: true,
        favicons: true,
        windows: true,
        appleStartup: false,
        coast: false,
        yandex: false,
      }
    });

    // Favicons package generates more files than required, therefore we need to filter out only relevant ones
    for (const img of response.images) {
      if (faviconNames.includes(img.name)) {
        await fs.writeFile(path.join(faviconsFolder, img.name), img.contents);
      }
    }

    const faviconIco = response.images.find(img => img.name === 'favicon.ico');
    if (faviconIco) {
      await fs.writeFile(path.join(publicFolder, 'favicon.ico'), faviconIco.contents);
      await fs.writeFile(path.join(faviconsFolder, 'favicon.ico'), faviconIco.contents);
      await fs.writeFile(path.join(faviconsFolder, 'favicon-dot.ico'), faviconIco.contents);
    }

    await fs.copyFile(logoNoTextSvg, path.join(imagesFolder, 'logo-no-text.svg'));
    await fs.copyFile(logoNoTextSvg, path.join(imagesFolder, 'logo-round.svg'));
    await fs.copyFile(logoTextSvg, path.join(imagesFolder, 'logo-text.svg'));
    await fs.copyFile(logoTextSvg, path.join(imagesFolder, 'logo.svg'));

    await sharp(logoNoTextSvg).resize(192, 192).png().toFile(path.join(imagesFolder, 'safe-logo-green.png'));
    await sharp(logoNoTextSvg).resize(120, 120).png().toFile(path.join(faviconsFolder, 'logo_120x120.png'));

    console.log(`Assets for '${BRAND_NAME}' were generated in '${TEMPLATE_ID}' folder.`);
  } catch (err) {
    console.error('Error during asset generation:', err);
    process.exit(1);
  }
})();
