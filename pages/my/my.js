Page({
  data: {
    userInfo: {
      username: '',
      avatarUrl: ''
    }
  },
  onLoad() {
    const authUser = wx.getStorageSync('authUser');
    if (authUser) {
      this.setData({
        'userInfo.username': authUser.username || '微信用户',
        'userInfo.avatarUrl': 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'
      });
    }
  },
  handleLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
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