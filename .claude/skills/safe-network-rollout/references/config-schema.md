# `networks/<id>/config.json` schema

Every entry in `networks/` must contain `config.json`. The shape (only `EIP155` and `SUPPORTED_VERSIONS` are mandatory):

```jsonc
{
  "EIP155": false,                          // mandatory — does the chain use EIP-155 Safe deployments?
  "SUPPORTED_VERSIONS": ["1.3.0", "1.4.1"], // mandatory — Safe contract versions available

  "SAFE_DEPLOYMENTS_OVERRIDE": {            // optional, when defaults differ. Two shapes:
    // (a) version-based — applies to every chain in this network entry
    "1.3.0": ["canonical", "eip155"],
    "1.4.1": "canonical"
    // (b) chain-specific — scope to a specific chain id, with `null` to skip a version
    // "<chain_id>": { "1.3.0": "canonical", "1.4.1": null }
  },

  "SAFE_UTILS_SUPPORTED": false,            // is the SafeUtils module deployed on this chain?

  "EXTRA_FOOTER_LINKS": [                   // optional, additional links on the footer
    { "label": "Docs", "link": "https://example.com/docs" }
  ],

  "IS_LICENSED": false,                     // partner-licensed Safe{Wallet}? Has UI/legal implications
  "LOGO_DIMENSIONS": {
    "HEADER": { "H": "40px" },              // header logo height; W is auto from viewBox
    "WELCOME": { "W": "200px", "H": "62px" } // optional, welcome page lockup; both W and H typical
  },

  "WELCOME_PALETTE": "#39c1cb, #006fec",    // optional, gradient stops for the welcome page

  "ALLOWANCE_MODULE_OVERRIDE": {            // chains needing custom allowance-module addresses
    "0.1.0": "0x386bc7cD21514f978a802d0818eA652Ee9346dAA",
    "0.1.1": "0x386bc7cD21514f978a802d0818eA652Ee9346dAA"
  }
}
```

## Optional palette files

Adjacent to `config.json`, a network can ship `lightPalette.json` and/or `darkPalette.json` to override Safe's MUI palette. Only specify keys that differ from default; everything else is inherited.

```jsonc
// lightPalette.json
{
  "secondary": {
    "dark": "#0069BA",
    "main": "#0090FF",
    "light": "#39C1CB",
    "background": "#EFFFF4"
  }
}
```

When a palette file exists, it overrides both the default and any `IS_LICENSED:true` partner palette.

## Field selection guide

| Decision | Pick this |
| --- | --- |
| New L2 with canonical Safe deployments | `EIP155: false`, `SUPPORTED_VERSIONS: ["1.3.0","1.4.1"]` |
| Chain uses a *specific* deployment per version | `SAFE_DEPLOYMENTS_OVERRIDE` with chain-id shape |
| Network has its own brand palette | Ship `lightPalette.json` + `darkPalette.json`, optionally `WELCOME_PALETTE` |
| Logo is wide+short (e.g. wordmark + icon, viewBox `0 0 78 24`) | `LOGO_DIMENSIONS.HEADER.H: "40px"` (24px crushes the icon) |
| Logo is square mark only | `LOGO_DIMENSIONS.HEADER.H: "32px"` is usually fine |
| Add this network to Safe{Wallet} partner program | `IS_LICENSED: true` (verify partnership status with the user first) |
| Has SafeUtils module | `SAFE_UTILS_SUPPORTED: true` |

## What conservative recent additions use (cronos, boba)

```json
{
  "EIP155": false,
  "SUPPORTED_VERSIONS": ["1.3.0", "1.4.1"],
  "SAFE_UTILS_SUPPORTED": false,
  "IS_LICENSED": false,
  "LOGO_DIMENSIONS": { "HEADER": { "H": "24px" } }
}
```

This is a safe starting point. **Bump `HEADER.H` to 40-48px and add `WELCOME` dimensions if the logo has an icon component** — at 24px the icon usually disappears next to the brand-name text.

## Adding a `WELCOME` block

If the network has a wide horizontal lockup (icon + wordmark), set both W and H so the logo aspect ratio is preserved on the welcome page. Sample values that work for typical lockups:

| Logo aspect | `WELCOME.W` × `WELCOME.H` |
| --- | --- |
| ~3.2:1 (icon + 8-letter wordmark)   | `200px × 62px` |
| ~2:1 (icon + short wordmark)        | `160px × 80px` |
| ~1:1 (square mark)                  | `120px × 120px` |
