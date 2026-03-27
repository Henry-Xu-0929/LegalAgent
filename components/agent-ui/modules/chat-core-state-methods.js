const { getCloudInstance, randomSelectInitquestion } = require("../tools");
const { createWelcomeRecord, getFeatureWelcomeText } = require("../model-request-builder");

module.exports = {
  handleRefresh: function () {
    if (this.data.triggered) {
      return;
    }
    console.log("开始刷新");
    this.setData(
      {
        triggered: true,
        refreshText: "刷新中",
      },
      async () => {
        if (this.data.chatMode === "bot") {
          if (this.data.chatRecords.length > 1) {
            const newPage = Math.floor(this.data.chatRecords.length / this.data.size) + 1;
            this.setData({
              page: newPage,
            });
          }
          const cloudInstance = await getCloudInstance(this.data.envShareConfig);
          const ai = cloudInstance.extend.AI;
          const getRecordsReq = {
            botId: this.data.agentConfig.botId,
            pageNumber: this.data.page,
            pageSize: this.data.size,
            sort: "desc",
          };
          if (this.data.conversation?.conversationId) {
            getRecordsReq.conversationId = this.data.conversation?.conversationId;
          }
          const res = await ai.bot.getChatRecords(getRecordsReq);
          if (res.recordList) {
            this.setData({
              total: res.total,
            });

            if (this.data.total === this.data.chatRecords.length - 1) {
              this.setData({
                triggered: false,
                refreshText: "到底啦",
              });
              return;
            }

            const freshNum = this.data.size - ((this.data.chatRecords.length - 1) % this.data.size);
            const freshChatRecords = res.recordList
              .reverse()
              .slice(0, freshNum)
              .map((item) => {
                let transformItem = {
                  ...item,
                  record_id: item.recordId,
                };
                if (item.role === "user" && item.fileInfos) {
                  transformItem.fileList = item.fileInfos.map((fileItem) => ({
                    status: "parsed",
                    rawFileName: fileItem.fileName,
                    rawType: fileItem.type,
                    fileId: fileItem.cloudId,
                    fileSize: fileItem.bytes,
                  }));
                }
                if (item.role === "assistant") {
                  if (item.content === "") {
                    transformItem.content = this.data.defaultErrorMsg;
                    transformItem.error = {};
                    transformItem.reqId = item.trace_id || "";
                  }

                  if (item.origin_msg) {
                    const originMsgObj = JSON.parse(item.origin_msg);
                    if (originMsgObj.aiResHistory) {
                      const transformToolCallList = this.transformToolCallHistoryList(originMsgObj.aiResHistory);
                      transformItem.toolCallList = transformToolCallList;
                      const toolCallErr = transformToolCallList.find((toolItem) => toolItem.error)?.error;
                      if (toolCallErr?.error?.message) {
                        transformItem.error = toolCallErr.error.message;
                        transformItem.reqId = item.trace_id || "";
                      }
                    }
                  }
                }
                return transformItem;
              })
              .filter((item) => item);
            this.setData({
              chatRecords:
                this.data.chatRecords.length === 1
                  ? [...this.data.chatRecords, ...freshChatRecords]
                  : [...freshChatRecords, ...this.data.chatRecords],
            });
          }
          this.setData({
            triggered: false,
            refreshText: "下拉加载历史记录",
          });
        }
      }
    );
  },
  handleTapClear: function () {
    this.clearChatRecords();
  },
  clearChatRecords: function () {
    const chatMode = this.data.chatMode;
    const { bot } = this.data;
    this.setData({ showTools: false });
    if (chatMode === "model") {
      const featureKey = this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult";
      const initialRecord = createWelcomeRecord(
        getFeatureWelcomeText(featureKey, this.data.modelConfig, this.data.modelConfig?.welcomeMsg)
      );
      const map = {
        ...this.data.featureChatRecordsMap,
        [featureKey]: [initialRecord],
      };
      this.setData({
        featureChatRecordsMap: map,
        chatRecords: [initialRecord],
        chatStatus: 0,
      });
      return;
    }
    if (this.data.isAgent) {
      this.setData({
        messages: [],
        chatStatus: 0,
        threadId: "threadId_" + String(+new Date()),
      });
      return;
    }
    const record = {
      content: bot.welcomeMessage || "你好，有什么我可以帮到你？",
      record_id: "record_id" + String(+new Date() + 10),
      role: "assistant",
      hiddenBtnGround: true,
    };
    const questions = randomSelectInitquestion(bot.initQuestions, 3);
    this.setData({
      chatRecords: [record],
      chatStatus: 0,
      questions,
      page: 1,
      conversation: null,
    });
  },
  stop: function () {
    this.flushPendingStreamRecordPatch(true);
    this.autoToBottom();
    if (this.data.isAgent) {
      this.setData({
        chatStatus: 0,
      });
    } else {
      const { chatRecords, chatStatus } = this.data;
      const newChatRecords = [...chatRecords];
      const record = newChatRecords[newChatRecords.length - 1];
      if (chatStatus === 1) {
        record.content = "已暂停生成";
      }
      if (chatStatus === 2) {
        record.pauseThinking = true;
      }
      this.setData({
        chatRecords: newChatRecords,
        manualScroll: false,
        chatStatus: 0,
      });
    }
  },
  flushPendingStreamRecordPatch: function (force = false) {
    const pending = this._pendingStreamRecordPatch;
    if (!pending) {
      return;
    }
    if (this._streamRecordFlushTimer) {
      clearTimeout(this._streamRecordFlushTimer);
      this._streamRecordFlushTimer = null;
    }
    const now = Date.now();
    const delay = Number(pending.delay || 80);
    if (!force && this._lastStreamRecordFlushAt && now - this._lastStreamRecordFlushAt < delay) {
      const waitMs = Math.max(0, delay - (now - this._lastStreamRecordFlushAt));
      this._streamRecordFlushTimer = setTimeout(() => {
        this.flushPendingStreamRecordPatch(true);
      }, waitMs);
      return;
    }
    this._pendingStreamRecordPatch = null;
    this._lastStreamRecordFlushAt = now;
    this.setData(pending.payload);
  },
  queueStreamRecordPatch: function (recordIndex, fields = {}, extraPayload = {}, options = {}) {
    const payload = { ...(extraPayload || {}) };
    if (Number.isInteger(recordIndex) && recordIndex >= 0) {
      Object.keys(fields || {}).forEach((key) => {
        payload[`chatRecords[${recordIndex}].${key}`] = fields[key];
      });
    }
    if (!Object.keys(payload).length) {
      return;
    }
    const delay = Math.max(32, Number(options.delay || 80));
    if (options.immediate) {
      this.flushPendingStreamRecordPatch(true);
      this._lastStreamRecordFlushAt = Date.now();
      this.setData(payload);
      return;
    }
    if (!this._pendingStreamRecordPatch) {
      this._pendingStreamRecordPatch = {
        payload: {},
        delay,
      };
    }
    Object.assign(this._pendingStreamRecordPatch.payload, payload);
    this._pendingStreamRecordPatch.delay = delay;
    const now = Date.now();
    if (!this._lastStreamRecordFlushAt || now - this._lastStreamRecordFlushAt >= delay) {
      this.flushPendingStreamRecordPatch(true);
      return;
    }
    if (this._streamRecordFlushTimer) {
      return;
    }
    const waitMs = Math.max(0, delay - (now - this._lastStreamRecordFlushAt));
    this._streamRecordFlushTimer = setTimeout(() => {
      this.flushPendingStreamRecordPatch(true);
    }, waitMs);
  },
  handleSendMessage: async function (event) {
    if (
      this.data.chatMode !== "model" &&
      this.data.sendFileList.some((item) => !item.fileId || item.status !== "parsed")
    ) {
      wx.showToast({
        title: "文件上传解析中",
        icon: "error",
      });
      return;
    }
    if (this.data.isAgent) {
      await this.handleSendMessageV2(event.currentTarget.dataset.message);
    } else {
      await this.sendMessage(event.currentTarget.dataset.message);
    }
  },
};
