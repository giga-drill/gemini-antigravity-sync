function useTranslation() {
  return {
    t: globalThis.__TEST_TRANSLATE__,
    i18n: globalThis.__TEST_I18N__,
  };
}

const initReactI18next = {
  type: '3rdParty',
  init() {},
};

module.exports = {
  useTranslation,
  initReactI18next,
};