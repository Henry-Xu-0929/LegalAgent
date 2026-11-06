// 页面级 i18n 接入：在页面 onLoad 调用 attachPageLanguage(this)。
// 页面需自行实现 onLanguageChanged()，负责重建依赖语言的派生数据（标签数组、欢迎语等）。
const i18n = require("./i18n");

const applyPageLanguage = (page) => {
  if (!page) {
    return;
  }
  page.setData({ t: i18n.getDict() });
  if (typeof page.onLanguageChanged === "function") {
    page.onLanguageChanged();
  }
};

const attachPageLanguage = (page) => {
  if (!page) {
    return;
  }
  page.setData({ t: i18n.getDict() });
  if (page._i18nUnsubscribe) {
    return;
  }
  page._i18nUnsubscribe = i18n.subscribe(() => {
    applyPageLanguage(page);
  });
};

const detachPageLanguage = (page) => {
  if (page && page._i18nUnsubscribe) {
    page._i18nUnsubscribe();
    page._i18nUnsubscribe = null;
  }
};

module.exports = {
  applyPageLanguage,
  attachPageLanguage,
  detachPageLanguage,
};
