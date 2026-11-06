const i18n = require("../../../utils/i18n");

module.exports = {
  toBottom: async function (unit) {
    const now = Date.now();
    const addUnit = unit === undefined ? 4 : unit;
    if (this.data.shouldAddScrollTop) {
      if (this._lastBottomBumpAt && now - this._lastBottomBumpAt < 48) {
        return;
      }
      this._lastBottomBumpAt = now;
      const newTop = this.data.scrollTop + addUnit;
      if (this.data.manualScroll) {
        this.setData({
          scrollTop: newTop,
        });
      } else {
        this.setData({
          scrollTop: newTop,
          viewTop: newTop,
        });
      }
      return;
    }
    if (this._pendingBottomMeasure || (this._lastBottomMeasureAt && now - this._lastBottomMeasureAt < 120)) {
      return;
    }
    this._pendingBottomMeasure = true;
    this._lastBottomMeasureAt = now;
    const clientHeight = this.data.curScrollHeight;
    try {
      const contentHeight = await this.calculateContentHeight();
      if (clientHeight - contentHeight < 10 && !this.data.shouldAddScrollTop) {
        this.setData({
          shouldAddScrollTop: true,
        });
      }
    } finally {
      this._pendingBottomMeasure = false;
    }
  },
  copyChatRecord: function (e) {
    const { content } = e.currentTarget.dataset;
    wx.setClipboardData({
      data: content,
      success: function () {
        wx.showToast({
          title: i18n.t("common.copySuccess"),
          icon: "success",
        });
      },
    });
  },
  addFileList: function () {
    this.setData({});
  },
  subFileList: function () { },
  copyUrl: function (e) {
    const { url } = e.currentTarget.dataset;
    console.log(url);
    wx.setClipboardData({
      data: url,
      success: function () {
        wx.showToast({
          title: i18n.t("common.copySuccess"),
          icon: "success",
        });
      },
    });
  },
  handleRemoveChild: function (e) {
    if (e.detail.tempId) {
      const newSendFileList = this.data.sendFileList.filter((item) => item.tempId !== e.detail.tempId);
      console.log("newSendFileList", newSendFileList);
      this.setData({
        sendFileList: newSendFileList,
      });
      if (newSendFileList.length === 0 && this.data.showFileList) {
        this.setData({
          showFileList: false,
        });
      }
    }
  },
  handleChangeChild: function (e) {
    console.log("change", e.detail);
    const { fileId, tempId, status } = e.detail;
    const newSendFileList = this.data.sendFileList.map((item) => {
      if (item.tempId === tempId) {
        const obj = {};
        if (fileId) {
          obj.fileId = fileId;
        }
        if (status) {
          obj.status = status;
        }
        return {
          ...item,
          ...obj,
        };
      }
      return item;
    });
    this.setData({
      sendFileList: newSendFileList,
    });
  },
  handleClickTools: function () {
    this.setData({
      showTools: !this.data.showTools,
    });
  },
  handleClickWebSearch: function () {
    if (!this.data.useWebSearch && !this.data.bot.searchEnable) {
      wx.showModal({
        title: i18n.t("common.notice"),
        content: i18n.t("agent.webSearchUnsupported"),
      });
      return;
    }
    if (this.data.sendFileList.length) {
      wx.showModal({
        title: i18n.t("common.notice"),
        content: i18n.t("agent.webSearchWithAttachment"),
      });
      return;
    }
    this.setData({
      useWebSearch: !this.data.useWebSearch,
    });
  },
};
