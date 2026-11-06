const i18n = require("../../../utils/i18n");
const { commonRequest, sleep } = require("../tools");

module.exports = {
  fetchAudioUrlByContent: async function (recordId, content) {
    if (this.data.audioSrcMap[recordId]) {
      return this.data.audioSrcMap[recordId];
    }
    const res = await new Promise((resolve, reject) => {
      commonRequest({
        path: `bots/${this.data.bot.botId}/text-to-speech`,
        header: {},
        data: {
          text: content,
          voiceType: this.data.bot.voiceSettings?.outputType,
        },
        method: "POST",
        success: (res) => {
          resolve(res);
        },
        fail(e) {
          console.log("create text-to-speech task e", e);
          reject(e);
        },
      });
    });
    const { data } = res;
    if (data && data.TaskId) {
      const taskId = data.TaskId;
      let loopQueryStatus = true;
      let audioUrl = "";
      while (loopQueryStatus) {
        const res = await new Promise((resolve, reject) => {
          commonRequest({
            path: `bots/${this.data.bot.botId}/text-to-speech`,
            header: {},
            data: {
              taskId,
            },
            method: "GET",
            success: (res) => {
              resolve(res);
            },
            fail(e) {
              console.log("create text-to-speech task e", e);
              reject(e);
            },
          });
        });
        const { data } = res;
        if (data.code || data.Status === 2) {
          loopQueryStatus = false;
        }
        if (data.Status === 2) {
          audioUrl = data.ResultUrl;
          this.setData({
            audioSrcMap: {
              ...this.data.audioSrcMap,
              [recordId]: audioUrl,
            },
          });
        }
        if (loopQueryStatus) {
          await sleep(1000);
        }
      }
      return audioUrl;
    }
    return "";
  },
  handlePlayAudio: async function (e) {
    console.log("handlePlayAudio e", e);
    if (!this.data.bot.voiceSettings?.enable) {
      wx.showModal({
        title: i18n.t("common.notice"),
        content: i18n.t("agent.voiceUnsupported"),
      });
      return;
    }
    const { recordid: botRecordId, content } = e.target.dataset;
    const audioContext = this.data.audioContext;
    if (audioContext.context) {
      if (audioContext.recordId === botRecordId) {
        audioContext.playStatus = 2;
        audioContext.showSpeedList = false;
        this.setData({
          audioContext: audioContext,
        });
        audioContext.context.playbackRate = audioContext.currentSpeed;
        audioContext.context.play();
      } else {
        audioContext.context.stop();
        audioContext.recordId = botRecordId;
        audioContext.playStatus = 1;
        audioContext.showSpeedList = false;
        audioContext.currentSpeed = 1.25;
        this.setData({
          audioContext: {
            ...audioContext,
          },
        });
        const audioUrl = await this.fetchAudioUrlByContent(botRecordId, content);
        if (audioUrl) {
          audioContext.context.src = audioUrl;
          audioContext.context.seek(0);
          audioContext.context.playbackRate = audioContext.currentSpeed;
          audioContext.context.play();
          this.setData({
            audioContext: {
              ...audioContext,
              playStatus: 2,
            },
          });
        } else {
          console.log("文本转语音失败");
          this.setData({
            audioContext: {
              ...audioContext,
              playStatus: 0,
            },
          });
        }
      }
    } else {
      const audioContext = {
        recordId: botRecordId,
        playStatus: 1,
        showSpeedList: false,
        currentSpeed: 1.25,
      };
      const innerAudioContext = wx.createInnerAudioContext({
        useWebAudioImplement: false,
      });
      try {
        await wx.setInnerAudioOption({
          obeyMuteSwitch: false,
        });
      } catch (e) {
        console.log("不遵循静音模式控制", e);
      }
      innerAudioContext.onEnded(() => {
        this.setData({
          audioContext: {
            ...this.data.audioContext,
            playStatus: 0,
          },
        });
      });
      audioContext.context = innerAudioContext;
      this.setData({
        audioContext: audioContext,
      });
      const audioUrl = await this.fetchAudioUrlByContent(botRecordId, content);
      if (audioUrl) {
        audioContext.context.src = audioUrl;
        audioContext.context.playbackRate = audioContext.currentSpeed;
        audioContext.context.play();
        this.setData({
          audioContext: {
            ...audioContext,
            playStatus: 2,
          },
        });
      } else {
        console.log("文本转语音失败");
        this.setData({
          audioContext: {
            ...audioContext,
            playStatus: 0,
          },
        });
      }
    }
  },
  handlePauseAudio: function (e) {
    console.log("handlePauseAudio e", e);
    const { recordid: botRecordId } = e.target.dataset;
    const audioContext = this.data.audioContext;
    if (botRecordId === audioContext.recordId && audioContext.context) {
      audioContext.context.pause();
      audioContext.playStatus = 0;
      this.setData({
        audioContext: {
          ...audioContext,
        },
      });
    } else {
      console.log("暂停异常");
    }
  },
  toggleSpeedList: function () {
    this.setData({
      audioContext: {
        ...this.data.audioContext,
        showSpeedList: !this.data.audioContext.showSpeedList,
      },
    });
  },
  chooseSpeed: function (e) {
    const speed = e.currentTarget.dataset.speed;
    const audioContext = this.data.audioContext;
    audioContext.showSpeedList = !this.data.audioContext.showSpeedList;
    audioContext.currentSpeed = Number(speed);
    audioContext.context.pause();
    audioContext.context.playbackRate = audioContext.currentSpeed;
    audioContext.context.play();
    this.setData({
      audioContext: {
        ...this.data.audioContext,
        ...audioContext,
      },
    });
  },
  handleTouchStart: function (e) {
    if (this.data.chatStatus !== 0 || this.data.voiceRecognizing === true) {
      wx.showToast({
        title: i18n.t("agent.waitForChat"),
        icon: "error",
      });
      return;
    }
    console.log("touchstart e", e);
    const { clientY } = e.touches[0];
    this.setData({
      startY: clientY,
      longPressTriggered: false,
    });
    this.data.longPressTimer = setTimeout(() => {
      this.setData({ longPressTriggered: true, sendStatus: 1 });
      wx.vibrateShort();
      this.startRecord();
    }, 300);
  },
  handleTouchMove: function (e) {
    if (this.data.chatStatus !== 0 || this.data.voiceRecognizing === true) {
      wx.showToast({
        title: i18n.t("agent.waitForChat"),
        icon: "error",
      });
      return;
    }
    if (!this.data.longPressTriggered) return;
    const { clientY } = e.touches[0];
    const deltaY = clientY - this.data.startY;
    if (Math.abs(deltaY) > this.data.moveThreshold) {
      console.log("touchMove 待取消");
      if (this.data.sendStatus !== 2) {
        this.setData({ sendStatus: 2 });
      }
    } else {
      console.log("touchMove 待发送");
      if (this.data.sendStatus !== 1) {
        this.setData({ sendStatus: 1 });
      }
    }
  },
  handleTouchEnd: function (e) {
    if (this.data.chatStatus !== 0 || this.data.voiceRecognizing === true) {
      wx.showToast({
        title: i18n.t("agent.waitForChat"),
        icon: "error",
      });
      return;
    }
    console.log("touchEnd e", e);
    clearTimeout(this.data.longPressTimer);
    if (this.data.longPressTriggered) {
      const { clientY } = e.changedTouches[0];
      const deltaY = clientY - this.data.startY;
      if (deltaY < -this.data.moveThreshold) {
        this.cancelSendVoice();
      } else {
        this.sendVoice();
      }
    }
    this.setData({ longPressTriggered: false });
  },
  sendVoice: function () {
    console.log("发送语音");
    if (this.data.recorderManager) {
      this.setData({
        sendStatus: 3,
        voiceRecognizing: true,
      });
      this.data.recorderManager.stop();
    }
  },
  cancelSendVoice: function () {
    console.log("取消发送");
    if (this.data.recorderManager) {
      this.setData({
        sendStatus: 4,
      });
      console.log("停止录音");
      this.data.recorderManager.stop();
    }
  },
  startRecord: function () {
    console.log("startRecord sendStatus", this.data.sendStatus);
    if (this.data.recorderManager && this.data.sendStatus === 1) {
      console.log("开始录音");
      this.data.recorderManager.start(this.data.recordOptions);
    }
  },
};
