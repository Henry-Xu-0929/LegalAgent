Page({
  data: {
    mode: "login",
    username: "",
    password: "",
    confirmPassword: "",
  },
  onShow() {
    const authUser = wx.getStorageSync("authUser");
    if (authUser) {
      wx.switchTab({
        url: "/pages/chatBot/chatBot",
      });
    }
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
        title: "请输入账号和密码",
        icon: "none",
      });
      return;
    }
    try {
      if (mode === "register") {
        if (password !== confirmPassword) {
          wx.showToast({
            title: "两次密码不一致",
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
            title: registerRes.error || "注册失败",
            icon: "none",
          });
          return;
        }
        wx.setStorageSync("authUser", { username, userId: registerRes.userId });
        wx.showToast({
          title: "注册成功",
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
          title: loginRes.error || "登录失败",
          icon: "none",
        });
        return;
      }
      wx.setStorageSync("authUser", {
        username: loginRes.username,
        userId: loginRes.userId,
      });
      wx.showToast({
        title: "登录成功",
        icon: "success",
      });
      wx.switchTab({
        url: "/pages/chatBot/chatBot",
      });
    } catch (error) {
      const message =
        error && error.errMsg ? error.errMsg : "网络异常，请稍后再试";
      wx.showToast({
        title: message,
        icon: "none",
      });
    }
  },
});
