import { APP_I18N_LANGUAGE_CODES } from "./lib/appI18nLanguages";

export default {
  // Keep in sync with APP_I18N_LANGUAGES in app/lib/appI18nLanguages.ts
  supportedLngs: APP_I18N_LANGUAGE_CODES,
  // This is the language you want to use in case
  // if the user language is not in the supportedLngs
  interpolation: {
    escapeValue: false,
  },

  fallbackLng: "en",
  // The default namespace of i18next is "translation", but you can customize it here
  // defaultNS: "common",
};
