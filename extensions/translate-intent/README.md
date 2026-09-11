# Translate intent

Registers `shopify/content-localization` (`edit`) on `admin.app.intent.link`
so Ciwi stays in Settings > Languages → Translate after 2027-01-01.

Launch URL is `/`. Admin appends `?shopLocale=<iso>` (e.g. `fr`).
The App does not yet consume `shopLocale` or send an intent completion signal.

`shopify app deploy` currently fails with Partner
`Intent is invalid: type 'shopify/content-localization' is not supported`
until Shopify enables that type (email: unstable on 2026-09-11). Retry
`npm run deployTest` then `deployProd`; do not change the intent type.
