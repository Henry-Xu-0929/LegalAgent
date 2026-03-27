module.exports = {
  calculateContentHeight() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this);
      query
        .selectAll(".main >>> .contentBox")
        .boundingClientRect((rects) => {
          let totalHeight = 0;
          rects.forEach((rect) => {
            totalHeight += rect.height;
          });
          resolve(totalHeight);
        })
        .exec();
    });
  },
  calculateContentInTop() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this);
      query
        .selectAll(".main >>> .nav, .main >>> .tips")
        .boundingClientRect((rects) => {
          let totalHeight = 0;
          rects.forEach((rect) => {
            totalHeight += rect.height;
          });
          resolve(totalHeight);
        })
        .exec();
    });
  },
  onWheel: function (e) {
    if (!this.data.manualScroll && e.detail.deltaY < 0) {
      this.setData({
        manualScroll: true,
      });
    }
  },
  onScroll: function (e) {
    const scrollTop = Number(e?.detail?.scrollTop || 0);
    const previousTop = Number(this._lastScrollTop || this.data.lastScrollTop || 0);
    if (scrollTop < previousTop && !this.data.manualScroll) {
      this.setData({
        manualScroll: true,
      });
    }
    this._lastScrollTop = scrollTop;
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
    }
    this._scrollTimer = setTimeout(() => {
      const newTop = Math.max(this.data.scrollTop, scrollTop);
      if (this.data.manualScroll) {
        if (newTop !== this.data.scrollTop) {
          this.setData({
            scrollTop: newTop,
            lastScrollTop: scrollTop,
          });
        } else if (scrollTop !== this.data.lastScrollTop) {
          this.setData({
            lastScrollTop: scrollTop,
          });
        }
      } else {
        const nextPayload = {};
        if (newTop !== this.data.scrollTop) {
          nextPayload.scrollTop = newTop;
        }
        if (newTop !== this.data.viewTop) {
          nextPayload.viewTop = newTop;
        }
        if (scrollTop !== this.data.lastScrollTop) {
          nextPayload.lastScrollTop = scrollTop;
        }
        if (Object.keys(nextPayload).length) {
          this.setData(nextPayload);
        }
      }
    }, 80);
  },
  handleScrollStart: function (e) {
    if (e.detail.scrollTop > 0 && !this.data.manualScroll) {
      this.setData({
        manualScroll: true,
      });
    }
  },
  handleScrollToLower: function () {
    this.setData({
      manualScroll: false,
    });
  },
  autoToBottom: function () {
    const nextPayload = {
      manualScroll: false,
      scrollTo: "scroll-bottom",
    };
    if (this.data.manualScroll === false && this.data.scrollTo === "scroll-bottom") {
      return;
    }
    this.setData(nextPayload);
  },
  bindInputFocus: function () {
    this.setData({
      manualScroll: false,
    });
    this.autoToBottom();
  },
  bindKeyInput: function (e) {
    this.setData({
      inputValue: e.detail.value,
    });
  },
};
