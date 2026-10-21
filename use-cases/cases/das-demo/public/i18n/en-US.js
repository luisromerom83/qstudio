// Custom demo dictionary en-US (keys: common.*, demo.*)
window.I18N_MESSAGES = window.I18N_MESSAGES || {};
window.I18N_MESSAGES["en-US"] = Object.assign(window.I18N_MESSAGES["en-US"] || {}, {
  "common.language": "Language",
  "demo.retry": "Retry",
  "demo.frameTitle": "Document",
  "demo.sdk.title": "The Quadient SDK is missing",
  "demo.sdk.body": "Copy web-runtime.js from the Advantage Web SDK into use-cases/cases/das-inbox/public/vendor/ and rebuild the Studio Manager image.",
  "demo.config.title": "Incomplete demo",
  "demo.config.body": "Fill in the URL, Application ID, Client ID and Document ID in Studio Manager › Settings › Custom demos.",
  "demo.error.appTitle": "Couldn't query the application",
  "demo.error.appBody": "Check the demo's URL, Application ID and Client ID.",
  "demo.error.anonymousTitle": "The application has no anonymous access",
  "demo.error.anonymousBody": "In Quadient Cloud, assign an Anonymous Access provider in Application Settings › Authentication.",
  "demo.error.docTitle": "Couldn't open the document",
  "demo.error.docBody": "Check the Document ID and that the document is published in the application."
});
