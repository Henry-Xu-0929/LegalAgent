const i18n = require("../../utils/i18n");
const { attachPageLanguage } = require("../../utils/i18n-page");

const LANGUAGE_MODES = ["system", "zh", "en"];

Page({
  data: {
    userInfo: {
      username: '',
      avatarUrl: ''
    },
    t: {},
    languageOptions: [],
    languageIndex: 0,
    languageLabel: "",
  },
  onLoad() {
    attachPageLanguage(this);
    const authUser = wx.getStorageSync('authUser');
    if (authUser) {
      this.setData({
        'userInfo.username': authUser.username || i18n.t('auth.defaultUser'),
        'userInfo.avatarUrl': 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'
      });
    }
  },
  onShow() {
    i18n.syncShell();
    this.refreshLanguageState();
  },
  onLanguageChanged() {
    this.refreshLanguageState();
    const authUser = wx.getStorageSync('authUser');
    if (authUser && !authUser.username) {
      this.setData({ 'userInfo.username': i18n.t('auth.defaultUser') });
    }
  },
  refreshLanguageState() {
    const languageOptions = [
      i18n.t('mine.languageSystem'),
      i18n.t('mine.languageZh'),
      i18n.t('mine.languageEn'),
    ];
    const index = Math.max(0, LANGUAGE_MODES.indexOf(i18n.getMode()));
    this.setData({
      languageOptions,
      languageIndex: index,
      languageLabel: languageOptions[index],
    });
  },
  handleLanguageChange(e) {
    const index = Number(e.detail.value);
    const mode = LANGUAGE_MODES[index] || 'system';
    i18n.setLanguage(mode);
    this.refreshLanguageState();
  },
  handleLogout() {
    wx.showModal({
      title: i18n.t('mine.logoutTitle'),
      content: i18n.t('mine.logoutConfirm'),
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('authUser');
          wx.reLaunch({
            url: '/pages/index/index'
          });
        }
      }
    });
  }
});
