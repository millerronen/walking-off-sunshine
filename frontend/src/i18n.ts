import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import he from './locales/he.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      he: { translation: he },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      // Use device/browser language first, don't cache it
      order: ['navigator', 'htmlTag'],
      caches: [],
    },
  });

export default i18n;
