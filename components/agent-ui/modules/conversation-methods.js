const { commonRequest } = require("../tools");

const i18n = require("../../../utils/i18n");

module.exports = {
  transformToolName: function (str) {
    if (str) {
      const strArr = str.split(/\/+/);
      return strArr[strArr.length - 1];
    }
    return "";
  },
  handleClickConversation: async function (e) {
    this.clearChatRecords();
    const { conversation } = e.currentTarget.dataset;
    this.setData({
      isDrawerShow: false,
      conversation: {
        conversationId: conversation.conversationId,
        title: conversation.title,
      },
      page: 1,
      size: 10,
    });
    this.handleRefresh();
  },
  fetchDefaultConversationList: async function () {
    try {
      if (this.data.bot.botId) {
        const res = await this.fetchConversationList(true, this.data.bot.botId);
        if (res) {
          const { data } = res;
          if (data && !data.code) {
            if (data.data) {
              if (data.data.length) {
                this.setData({
                  defaultConversation: data.data[0],
                  conversations: data.data,
                  transformConversations: this.transformConversationList(data.data),
                });
              }
            } else {
              this.setData({
                defaultConversation: data,
                conversations: [data],
                transformConversations: this.transformConversationList([data]),
              });
            }
          }
        }
      }
    } catch (e) {
      console.log("fetchDefaultConversationList e", e);
    }
  },
  fetchConversationList: async function (isDefault, botId) {
    if (this.data.fetchConversationLoading) {
      return;
    }
    return new Promise((resolve, reject) => {
      const { page, size } = this.data.conversationPageOptions;
      const limit = size;
      const offset = (page - 1) * size;
      this.setData({
        fetchConversationLoading: true,
      });
      commonRequest({
        path: `bots/${botId}/conversation/?limit=${limit}&offset=${offset}&isDefault=${isDefault}`,
        method: "GET",
        header: {},
        success: (res) => {
          resolve(res);
        },
        fail(e) {
          console.log("conversation list e", e);
          reject(e);
        },
        complete: () => {
          this.setData({
            fetchConversationLoading: false,
          });
        },
      });
    });
  },
  createConversation: async function () {
    return new Promise((resolve, reject) => {
      commonRequest({
        path: `bots/${this.data.agentConfig.botId}/conversation`,
        header: {},
        data: {
          botId: this.data.agentConfig.botId,
        },
        method: "POST",
        success: (res) => {
          resolve(res);
        },
        fail(e) {
          console.log("create conversation e", e);
          reject(e);
        },
      });
    });
  },
  deleteConversation: async function (conversationId) {
    return new Promise((resolve, reject) => {
      commonRequest({
        path: `bots/${this.data.agentConfig.botId}/conversation/${conversationId}`,
        method: "DELETE",
        success: (res) => {
          resolve(res);
        },
        fail(e) {
          console.log("delete conversation e", e);
          reject(e);
        },
      });
    });
  },
  handleDeleteConversation: async function (e) {
    const { conversation } = e.currentTarget.dataset;
    const that = this;
    this.hideActionMenu();
    wx.showModal({
      title: i18n.t("common.notice"),
      content: i18n.t("agent.deleteSessionConfirm"),
      confirmText: i18n.t("common.delete"),
      confirmColor: "#ff303b",
      success: async function (res) {
        if (res.confirm) {
          try {
            const deleteRes = await that.deleteConversation(conversation.conversationId);
            if (deleteRes && !deleteRes.code) {
              const updatedConversations = that.data.conversations.filter(
                (item) => item.conversationId !== conversation.conversationId
              );
              that.setData({
                conversations: updatedConversations,
                transformConversations: that.transformConversationList(updatedConversations),
              });
              if (that.data.conversation?.conversationId === conversation.conversationId) {
                that.clearChatRecords();
                if (updatedConversations.length > 0) {
                  that.handleClickConversation({
                    currentTarget: {
                      dataset: {
                        conversation: updatedConversations[0],
                      },
                    },
                  });
                } else {
                  that.setData({
                    conversation: null,
                  });
                }
              }
              wx.showToast({
                title: i18n.t("agent.deleteSuccess"),
                icon: "success",
              });
            } else {
              wx.showToast({
                title: i18n.t("agent.deleteFailed"),
                icon: "error",
              });
            }
          } catch (error) {
            console.error("删除会话失败", error);
            wx.showToast({
              title: i18n.t("agent.deleteFailed"),
              icon: "error",
            });
          }
        }
      },
    });
  },
  handleLongPressConversation: function (e) {
    const { conversation } = e.currentTarget.dataset;
    this.setData({
      showActionMenu: true,
      selectedConversation: conversation,
    });
  },
  hideActionMenu: function () {
    this.setData({
      showActionMenu: false,
      selectedConversation: null,
    });
  },
  clickCreateInDrawer: function () {
    this.setData({
      isDrawerShow: false,
    });
    this.createNewConversation();
  },
  createNewConversation: async function () {
    if (!this.data.bot.multiConversationEnable) {
      wx.showModal({
        title: i18n.t("common.notice"),
        content: i18n.t("agent.multiSessionUnsupported"),
      });
      return;
    }
    this.clearChatRecords();
    this.setData({
      refreshText: i18n.t("agent.refreshDefault"),
    });
  },
  scrollConToBottom: async function (e) {
    console.log("scrollConToBottom", e);
    const { page, size } = this.data.conversationPageOptions;
    if (page * size >= this.data.conversationPageOptions.total) {
      return;
    }
    this.setData({
      conversationPageOptions: {
        ...this.data.conversationPageOptions,
        page: this.data.conversationPageOptions.page + 1,
      },
    });
    if (this.data.bot.botId) {
      const res = await this.fetchConversationList(false, this.data.bot.botId);
      if (res) {
        const { data } = res;
        if (data && !data.code) {
          const addConversations = [...this.data.conversations, ...data.data];
          const sortConData = addConversations.sort(
            (a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
          );
          this.setData({
            conversations: sortConData,
            transformConversations: this.transformConversationList(sortConData),
          });
        }
      }
    }
  },
  resetFetchConversationList: async function () {
    this.setData({
      conversationPageOptions: {
        page: 1,
        size: 15,
        total: 0,
      },
    });
    try {
      if (this.data.bot.botId) {
        const res = await this.fetchConversationList(false, this.data.bot.botId);
        if (res) {
          const { data } = res;
          if (data && !data.code) {
            const sortData = data.data.sort(
              (a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
            );
            const finalConData = this.data.defaultConversation
              ? sortData.concat(this.data.defaultConversation)
              : sortData;
            this.setData({
              conversations: finalConData,
              transformConversations: this.transformConversationList(finalConData),
              conversationPageOptions: {
                ...this.data.conversationPageOptions,
                total: data.total,
              },
            });
          }
        }
      }
    } catch (e) {
      console.log("fetchConversationList e", e);
    }
  },
  transformConversationList: function (conversations) {
    const todayCon = [];
    const curMonthCon = [];
    const earlyCon = [];
    const now = new Date();
    const todayDate = now.setHours(0, 0, 0, 0);
    const monthFirstDate = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    for (let item of conversations) {
      const itemDate = new Date(item.createTime).getTime();
      if (itemDate >= todayDate) {
        todayCon.push(item);
      } else if (itemDate >= monthFirstDate) {
        curMonthCon.push(item);
      } else {
        earlyCon.push(item);
      }
    }
    return {
      todayCon,
      curMonthCon,
      earlyCon,
    };
  },
  openDrawer: async function () {
    if (!this.data.bot.multiConversationEnable) {
      wx.showModal({
        title: i18n.t("common.notice"),
        content: i18n.t("agent.multiSessionUnsupported"),
      });
      return;
    }
    this.setData({
      isDrawerShow: true,
    });
  },
  closeDrawer: function () {
    this.setData({
      isDrawerShow: false,
    });
  },
};
