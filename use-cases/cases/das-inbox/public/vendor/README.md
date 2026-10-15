# Quadient Advantage Web SDK

The Digital Advantage Inbox needs `web-runtime.js` from the Quadient Advantage Web SDK in this folder.
The file belongs to Quadient and is not part of this repository.

1. Get the SDK package (`Package-AdvantageSDK_TechnologyDemo-<version>-Web`) from Quadient.
2. Copy `QuadientWebSDK/web-runtime.js` into this folder (`use-cases/cases/das-inbox/public/vendor/`).
3. Rebuild the Studio Manager image so the use-cases image picks it up.

Without the file the app opens with a message saying the SDK is missing.
Tested with version 24.06.0.
