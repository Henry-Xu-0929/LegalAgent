const md5 = require("../md5.js");
const { getCloudInstance, commonRequest } = require("../tools");

module.exports = {
  initRecordManager: async function () {
    const cloudInstance = await getCloudInstance();
    const recorderManager = wx.getRecorderManager();
    recorderManager.onStart(() => {
      console.log("recorder start");
    });
    recorderManager.onPause(() => {
      console.log("recorder pause");
    });
    recorderManager.onStop((res) => {
      console.log("停止录音");
      console.log("this.data.sendStatus", this.data.sendStatus);
      if (this.data.sendStatus === 3) {
        console.log("确认发送");
        console.log("recorder stop", res);
        const { tempFilePath } = res;
        console.log("tempFilePath", tempFilePath);
        const fileName = md5(tempFilePath) + ".aac";
        console.log("fileName", fileName);
        if (fileName) {
          new Promise((resolve, reject) => {
            cloudInstance.uploadFile({
              cloudPath: `agent_file/${this.data.bot.botId}/${fileName}`,
              filePath: tempFilePath,
              success: async (uploadRes) => {
                console.log("uploadFile res", uploadRes);
                const fileId = uploadRes.fileID;
                cloudInstance.getTempFileURL({
                  fileList: [fileId],
                  success: (tempRes) => {
                    console.log("getTempFileURL", tempRes);
                    const { fileList } = tempRes;
                    if (fileList && fileList.length) {
                      console.log("开始转文字");
                      commonRequest({
                        path: `bots/${this.data.bot.botId}/speech-to-text`,
                        data: {
                          url: fileList[0].tempFileURL,
                          engSerViceType: this.data.bot.voiceSettings?.inputType,
                          voiceFormat: "aac",
                        },
                        method: "POST",
                        timeout: 60000,
                        success: (sttRes) => {
                          console.log("speech-to-text res", sttRes);
                          const { data } = sttRes;
                          if (data && data.Result) {
                            this.sendMessage(data.Result);
                            resolve(data.Result);
                          } else {
                            resolve();
                          }
                        },
                        fail: (e) => {
                          console.log("e", e);
                          reject(e);
                        },
                        complete: () => { },
                        header: {},
                      });
                    }
                  },
                  fail: (e) => {
                    reject(e);
                  },
                });
              },
              fail: (err) => {
                console.error("上传失败：", err);
                reject(err);
              },
            });
          }).finally(() => {
            this.setData({
              sendStatus: 0,
              voiceRecognizing: false,
              longPressTriggered: false,
            });
          });
        }
      } else {
        this.setData({
          sendStatus: 0,
          longPressTriggered: false,
        });
      }
    });
    recorderManager.onError((err) => {
      console.log("recorder err", err);
      this.setData({
        sendStatus: 0,
      });
    });
    this.setData({
      recorderManager: recorderManager,
    });
  },
  handleChangeInputType(e) {
    if (!this.data.bot.voiceSettings?.enable) {
      wx.showModal({
        title: "提示",
        content: "请前往腾讯云开发平台启用语音输入输出能力",
      });
      return;
    }
    this.setData({
      useVoice: !this.data.useVoice,
    });
  },
  handleCopyAll(e) {
    const { content } = e.currentTarget.dataset;
    wx.setClipboardData({
      data: content,
      success: () => {
        wx.showToast({
          title: "复制成功",
          icon: "success",
        });
        this.hideMenu();
      },
    });
  },
  handleEdit(e) {
    const { content } = e.currentTarget.dataset;
    this.setData({
      inputValue: content,
    });
    this.hideMenu();
  },
  handleLongPress(e) {
    const { id } = e.currentTarget.dataset;
    this.setData({
      showMenu: true,
      tapMenuRecordId: id,
    });
  },
  hideMenu() {
    this.setData({
      showMenu: false,
      tapMenuRecordId: "",
    });
  },
  onTapPage() {
    if (this.data.showMenu) {
      this.hideMenu();
    }
  },
  showErrorMsg: function (e) {
    const { content, reqid } = e.currentTarget.dataset;
    const transformContent =
      typeof content === "string"
        ? reqid
          ? `${content}|reqId:${reqid}`
          : content
        : JSON.stringify({ err: content, reqid });
    wx.showModal({
      title: "错误原因",
      content: transformContent,
      success() {
        wx.setClipboardData({
          data: transformContent,
          success: function () {
            wx.showToast({
              title: "复制错误完成",
              icon: "success",
            });
          },
        });
      },
    });
  },
  transformToolCallHistoryList: function (toolCallList) {
    const callParamsList = toolCallList.filter((item) => item.type === "tool-call");
    const callContentList = toolCallList.filter((item) => item.type === "text");
    const transformToolCallList = [];
    for (let i = 0; i < callParamsList.length; i++) {
      const curParam = callParamsList[i];
      const curResult = toolCallList.find(
        (item) => item.type === "tool-result" && item.toolCallId === curParam.tool_call.id
      );
      const curContent = callContentList[i];
      const curError = toolCallList.find(
        (item) => item.finish_reason === "error" && item.error.message.toolCallId === curParam.tool_call.id
      );
      const transformToolCallObj = {
        id: curParam.tool_call.id,
        name: this.transformToolName(curParam.tool_call.function.name),
        rawParams: curParam.tool_call.function.arguments,
        callParams: "```json\n\n" + JSON.stringify(curParam.tool_call.function.arguments, null, 2) + "\n```",
        content: ((curContent && curContent.content) || "").replaceAll("\t", "").replaceAll("\n", "\n\n"),
      };
      if (curResult) {
        transformToolCallObj.rawResult = curResult.result;
        transformToolCallObj.callResult = "```json\n\n" + JSON.stringify(curResult.result, null, 2) + "\n```";
      }
      if (curError) {
        transformToolCallObj.error = curError;
      }

      transformToolCallList.push(transformToolCallObj);
    }
    return transformToolCallList;
  },
  handleLineChange: function () {
    const self = this;
    const query = wx.createSelectorQuery().in(this);
    query
      .select(".foot_function")
      .boundingClientRect(function (res) {
        if (res) {
          self.setData({
            textareaHeight: res.height,
          });
        }
      })
      .exec();
  },
  openFeedback: function (e) {
    const { feedbackrecordid, feedbacktype } = e.currentTarget.dataset;
    let index = null;
    this.data.chatRecords.forEach((item, _index) => {
      if (item.record_id === feedbackrecordid) {
        index = _index;
      }
    });
    const inputRecord = this.data.chatRecords[index - 1];
    const answerRecord = this.data.chatRecords[index];
    this.setData({
      isShowFeedback: true,
      feedbackRecordId: feedbackrecordid,
      feedbackType: feedbacktype,
      aiAnswer: answerRecord.content,
      input: inputRecord.content,
    });
  },
  closefeedback: function () {
    this.setData({ isShowFeedback: false, feedbackRecordId: "", feedbackType: "" });
  },
};
