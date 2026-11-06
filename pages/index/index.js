const i18n = require("../../utils/i18n");
const { attachPageLanguage } = require("../../utils/i18n-page");

Page({
  data: {
    mode: "login",
    username: "",
    password: "",
    confirmPassword: "",
    t: {},
  },
  onShow() {
    i18n.syncShell();
    const authUser = wx.getStorageSync("authUser");
    if (authUser) {
      wx.switchTab({
        url: "/pages/chatBot/chatBot",
      });
    }
  },
  onLoad() {
    attachPageLanguage(this);
  },
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      mode,
      username: "",
      password: "",
      confirmPassword: "",
    });
  },
  handleInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [field]: e.detail.value,
    });
  },
  async submit() {
    const mode = this.data.mode;
    const username = this.data.username.trim();
    const password = this.data.password;
    const confirmPassword = this.data.confirmPassword;
    if (!username || !password) {
      wx.showToast({
        title: i18n.t("auth.errMissing"),
        icon: "none",
      });
      return;
    }
    try {
      if (mode === "register") {
        if (password !== confirmPassword) {
          wx.showToast({
            title: i18n.t("auth.errPasswordMismatch"),
            icon: "none",
          });
          return;
        }
        const registerCallRes = await wx.cloud.callFunction({
          name: "auth",
          data: {
            action: "register",
            username,
            password,
          },
        });
        const registerRes = registerCallRes?.result || {};
        if (!registerRes.ok) {
          wx.showToast({
            title: registerRes.error || i18n.t("auth.errRegister"),
            icon: "none",
          });
          return;
        }
        wx.setStorageSync("authUser", { username, userId: registerRes.userId });
        wx.showToast({
          title: i18n.t("auth.successRegister"),
          icon: "success",
        });
        wx.switchTab({
          url: "/pages/chatBot/chatBot",
        });
        return;
      }
      const loginCallRes = await wx.cloud.callFunction({
        name: "auth",
        data: {
          action: "login",
          username,
          password,
        },
      });
      const loginRes = loginCallRes?.result || {};
      if (!loginRes.ok) {
        wx.showToast({
          title: loginRes.error || i18n.t("auth.errLogin"),
          icon: "none",
        });
        return;
      }
      wx.setStorageSync("authUser", {
        username: loginRes.username,
        userId: loginRes.userId,
      });
      wx.showToast({
        title: i18n.t("auth.successLogin"),
        icon: "success",
      });
      wx.switchTab({
        url: "/pages/chatBot/chatBot",
      });
    } catch (error) {
      const message =
        error && error.errMsg ? error.errMsg : i18n.t("auth.errNetwork");
      wx.showToast({
        title: message,
        icon: "none",
      });
    }
  },
});
