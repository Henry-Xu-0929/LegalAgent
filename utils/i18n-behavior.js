// 组件级 i18n 接入：behavior: [i18nBehavior]
// 组件可选实现 onLanguageChanged()，用于重建依赖语言的派生数据。
const i18n = require("./i18n");

module.exports = Behavior({
  data: {
    t: {},
  },
  lifetimes: {
    attached() {
      this.setData({ t: i18n.getDict() });
      this._i18nUnsubscribe = i18n.subscribe(() => {
        this.setData({ t: i18n.getDict() });
        if (typeof this.onLanguageChanged === "function") {
          this.onLanguageChanged();
        }
      });
    },
    detached() {
      if (this._i18nUnsubscribe) {
        this._i18nUnsubscribe();
        this._i18nUnsubscribe = null;
      }
    },
  },
});
