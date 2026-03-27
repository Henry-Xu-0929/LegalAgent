const { getCloudInstance, sleep } = require("../tools");
const md5 = require("../md5.js").default || require("../md5.js");

module.exports = {
  chooseMedia: function (sourceType) {
    const self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: [sourceType],
      maxDuration: 30,
      camera: "back",
      async success(res) {
        const isImageSizeValid = res.tempFiles.every((item) => item.size <= 30 * 1024 * 1024);
        if (!isImageSizeValid) {
          wx.showToast({
            title: "图片大小30M限制",
            icon: "error",
          });
          return;
        }
        const tempFiles = await Promise.all(res.tempFiles.map(async (item) => {
          const tempFileInfos = item.tempFilePath.split(".");
          const tempFileName = md5(tempFileInfos[0]) + "." + tempFileInfos[1];
          const isModelMode = self.data.chatMode === "model";
          const ocrText = isModelMode ? await self.extractImageText(item.tempFilePath) : "";
          return {
            tempId: tempFileName,
            rawType: item.fileType,
            tempFileName: tempFileName,
            rawFileName: "",
            tempPath: item.tempFilePath,
            fileSize: item.size,
            fileUrl: "",
            fileId: isModelMode ? item.tempFilePath : "",
            botId: self.data.agentConfig.botId,
            status: isModelMode ? "parsed" : "",
            ocrText,
          };
        }));
        const finalFileList = [...tempFiles];
        self.setData({
          sendFileList: finalFileList,
        });
        if (finalFileList.length) {
          self.setData({
            showTools: false,
          });
          if (!self.data.showFileList) {
            self.setData({
              showFileList: true,
            });
          }
        }
        if (self.data.chatMode === "model") {
          const recognizedCount = finalFileList.filter((item) => !!item.ocrText).length;
          wx.showToast({
            title: recognizedCount > 0 ? `已识别${recognizedCount}张图片` : "未识别到文字",
            icon: recognizedCount > 0 ? "success" : "none",
          });
        }
      },
    });
  },
  handleUploadImg: function (sourceType) {
    const isModelMode = this.data.chatMode === "model";
    if (!isModelMode && !this.data.isAgent && !this.data.bot.searchFileEnable) {
      wx.showModal({
        title: "提示",
        content: "请前往腾讯云开发平台启用 Agent 图片上传功能",
      });
      return;
    }
    if (!isModelMode && this.data.useWebSearch) {
      wx.showModal({
        title: "提示",
        content: "联网搜索不支持上传文件/图片",
      });
      return;
    }
    const self = this;
    const isCurSendFile = this.data.sendFileList.find((item) => item.rawType === "file");
    if (isCurSendFile) {
      wx.showModal({
        title: "确认替换吗",
        content: "上传图片将替换当前文件内容",
        showCancel: "true",
        cancelText: "取消",
        confirmText: "确认",
        success() {
          self.chooseMedia(sourceType);
        },
      });
    } else {
      self.chooseMedia(sourceType);
    }
  },
  chooseMessageFile: function () {
    const self = this;
    const isModelMode = this.data.chatMode === "model";
    const oldFileLen = this.data.sendFileList.filter((item) => item.rawType === "file").length;
    const subFileCount = oldFileLen <= 5 ? 5 - oldFileLen : 0;
    if (subFileCount === 0) {
      wx.showToast({
        title: "文件数量限制5个",
        icon: "error",
      });
      return;
    }
    wx.chooseMessageFile({
      count: subFileCount,
      type: "file",
      async success(res) {
        const isFileSizeValid = res.tempFiles.every((item) => item.size <= 30 * 1024 * 1024);
        if (!isFileSizeValid) {
          wx.showToast({
            title: "单文件30M限制",
            icon: "error",
          });
          return;
        }
        const tempFiles = await Promise.all(res.tempFiles.map(async (item) => {
          const tempFileInfos = item.path.split(".");
          const tempFileName = md5(tempFileInfos[0]) + "." + tempFileInfos[1];
          const ext = self.getFileExt(item.name || tempFileName);
          const extractedText = isModelMode ? await self.extractLocalTextForModelFile(item.path, ext) : "";
          return {
            tempId: tempFileName,
            rawType: item.type,
            tempFileName: tempFileName,
            rawFileName: item.name,
            tempPath: item.path,
            fileSize: item.size,
            fileUrl: "",
            fileId: isModelMode ? item.path : "",
            botId: self.data.agentConfig.botId,
            status: isModelMode ? "parsed" : "",
            parsedByBot: false,
            extractedText,
          };
        }));
        const filterFileList = self.data.sendFileList.filter((item) => item.rawType !== "image");
        const finalFileList = [...filterFileList, ...tempFiles];
        console.log("final", finalFileList);
        self.setData({
          sendFileList: finalFileList,
        });
        if (finalFileList.length) {
          self.setData({
            showTools: false,
          });
          if (!self.data.showFileList) {
            self.setData({
              showFileList: true,
            });
          }
        }
        if (isModelMode) {
          wx.showToast({
            title: "已添加文件",
            icon: "success",
          });
        }
      },
      fail(e) {
        console.log("choose e", e);
      },
    });
  },
  handleUploadMessageFile: function () {
    const isModelMode = this.data.chatMode === "model";
    if (!isModelMode && !this.data.isAgent && !this.data.bot.searchFileEnable) {
      wx.showModal({
        title: "提示",
        content: "请前往腾讯云开发平台启用 Agent 文件上传功能",
      });
      return;
    }
    if (!isModelMode && this.data.useWebSearch) {
      wx.showModal({
        title: "提示",
        content: "联网搜索不支持上传文件/图片",
      });
      return;
    }
    const self = this;
    const isCurSendImage = this.data.sendFileList.find((item) => item.rawType === "image");
    if (isCurSendImage) {
      wx.showModal({
        title: "确认替换吗",
        content: "上传文件将替换当前图片内容",
        showCancel: "true",
        cancelText: "取消",
        confirmText: "确认",
        success() {
          self.chooseMessageFile();
        },
        fail(error) {
          console.log("choose file e", error);
        },
      });
    } else {
      self.chooseMessageFile();
    }
  },
  handleAlbum: function () {
    this.handleUploadImg("album");
  },
  handleCamera: function () {
    this.handleUploadImg("camera");
  },
  extractImageText: function (filePath) {
    return new Promise((resolve) => {
      if (!wx.ocr) {
        resolve("");
        return;
      }
      wx.ocr({
        type: "ocrGeneral",
        filePath,
        success: (res) => {
          resolve(this.parseOcrText(res));
        },
        fail: () => {
          resolve("");
        },
      });
    });
  },
  parseOcrText: function (ocrRes) {
    if (!ocrRes) {
      return "";
    }
    const source = typeof ocrRes.data === "string"
      ? (() => {
        try {
          return JSON.parse(ocrRes.data);
        } catch (e) {
          return ocrRes;
        }
      })()
      : (ocrRes.result || ocrRes);
    if (Array.isArray(source.words_result)) {
      return source.words_result.map((item) => item.words).filter(Boolean).join("\n").trim();
    }
    if (Array.isArray(source.items)) {
      return source.items.map((item) => item.text || item.words).filter(Boolean).join("\n").trim();
    }
    if (typeof source.text === "string") {
      return source.text.trim();
    }
    return "";
  },
  getFileExt: function (fileName) {
    const name = String(fileName || "");
    const index = name.lastIndexOf(".");
    if (index < 0) {
      return "";
    }
    return name.substring(index + 1).toLowerCase();
  },
  extractLocalTextForModelFile: function (filePath, ext) {
    return new Promise((resolve) => {
      if (!["txt", "csv", "md", "markdown", "json", "xml", "html", "htm", "yaml", "yml", "ini", "log", "sql", "js", "ts", "py", "java", "go", "c", "cpp"].includes(ext)) {
        resolve("");
        return;
      }
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: "utf8",
        success: (res) => {
          const text = String(res?.data || "").trim();
          resolve(text.slice(0, 12000));
        },
        fail: () => {
          resolve("");
        },
      });
    });
  },
  extractModelFileTextByCloud: async function (fileId, fileName) {
    const invokeExtract = () => new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: "aiChat",
        data: {
          action: "extractFileText",
          fileId,
          fileName,
        },
        success: (res) => {
          const result = res?.result || {};
          if (result.success && result.text) {
            resolve(String(result.text));
            return;
          }
          reject(new Error(result.message || "文件解析失败"));
        },
        fail: (err) => {
          const detail = err?.errMsg || err?.message || "文件解析失败";
          reject(new Error(detail));
        },
      });
    });
    try {
      return await invokeExtract();
    } catch (err) {
      const detail = String(err?.message || "");
      const isTimeout = detail.includes("FUNCTIONS_TIME_LIMIT_EXCEEDED")
        || detail.includes("timed out")
        || detail.includes("errCode: -504003");
      if (!isTimeout) {
        throw err;
      }
      await sleep(500);
      return await invokeExtract();
    }
  },
  ensureModelFilesReadyByBot: async function (fileList) {
    const botId = this.data.agentConfig?.botId || "";
    if (!botId) {
      return fileList;
    }
    const cloudInstance = await getCloudInstance(this.data.envShareConfig);
    const result = [];
    for (const item of fileList || []) {
      if (item.rawType !== "file") {
        result.push(item);
        continue;
      }
      let nextItem = { ...item };
      const hasCloudId = typeof nextItem.fileId === "string" && nextItem.fileId.indexOf("cloud://") === 0;
      if (!hasCloudId && nextItem.tempPath) {
        const uploaded = await Promise.race([
          new Promise((resolve, reject) => {
            cloudInstance.uploadFile({
              cloudPath: `agent_file/${botId}/${nextItem.tempFileName}`,
              filePath: nextItem.tempPath,
              success: (res) => resolve(res.fileID),
              fail: reject,
            });
          }),
          sleep(45000).then(() => Promise.reject(new Error("UPLOAD_TIMEOUT"))),
        ]);
        nextItem.fileId = uploaded;
      }
      if (nextItem.fileId) {
        if (!nextItem.extractedText) {
          try {
            nextItem.extractedText = await this.extractModelFileTextByCloud(
              nextItem.fileId,
              nextItem.rawFileName || nextItem.tempFileName
            );
            nextItem.parseError = "";
          } catch (e) {
            nextItem.parseError = String(e?.message || "");
          }
        }
        nextItem.status = "parsed";
        nextItem.parsedByBot = true;
      }
      result.push(nextItem);
    }
    return result;
  },
  extractTextFromPayload: function (payload) {
    if (!payload) {
      return "";
    }
    if (typeof payload === "string") {
      return payload;
    }
    if (Array.isArray(payload)) {
      return payload.map((item) => this.extractTextFromPayload(item)).filter(Boolean).join("");
    }
    const contentArrayText = Array.isArray(payload.content)
      ? payload.content.map((item) => this.extractTextFromPayload(item)).filter(Boolean).join("")
      : "";
    const messageContentArrayText = Array.isArray(payload.message?.content)
      ? payload.message.content.map((item) => this.extractTextFromPayload(item)).filter(Boolean).join("")
      : "";
    return payload.delta
      || payload.text
      || payload.content
      || payload.answer
      || payload.output
      || payload.result
      || payload?.message?.text
      || payload?.message?.content
      || payload?.choices?.[0]?.delta?.content
      || payload?.choices?.[0]?.message?.content
      || payload?.data?.content
      || contentArrayText
      || messageContentArrayText
      || payload?.value
      || "";
  },
  setModelAssistantRecordContent: function (contentText, startTime, endTime) {
    const newValue = [...this.data.chatRecords];
    const lastValue = newValue[newValue.length - 1];
    lastValue.content = contentText;
    lastValue.thinkingTime = endTime ? Math.floor((endTime - startTime) / 1000) : 0;
    this.setData({ chatRecords: newValue, chatStatus: 3 });
    this.toBottom();
  },
  streamModelFileFallbackByBot: async function (userRecord) {
    const botId = this.data.agentConfig?.botId || "";
    if (!botId) {
      return false;
    }
    const cloudInstance = await getCloudInstance(this.data.envShareConfig);
    const ai = cloudInstance.extend.AI;
    const msg = this.mergeModelInputByRecord(userRecord);
    const files = userRecord.fileList
      .filter((item) => item.rawType === "file" && item.fileId && item.status === "parsed")
      .map((item) => item.fileId);
    const res = await Promise.race([
      ai.bot.sendMessage({
        data: {
          botId,
          msg,
          files: files.length ? files : undefined,
          searchEnable: false,
        },
      }),
      sleep(90000).then(() => Promise.reject(new Error("MODEL_FILE_ROUTE_TIMEOUT"))),
    ]);
    const directText = this.extractTextFromPayload(res);
    let contentText = "";
    let startTime = +new Date();
    let endTime = null;
    let hasAnyChunk = false;
    if (directText) {
      hasAnyChunk = true;
      contentText = String(directText);
      endTime = +new Date();
      this.setModelAssistantRecordContent(contentText, startTime, endTime);
    }
    for await (let event of res.eventStream) {
      if (this.data.chatStatus === 0) {
        return true;
      }
      const raw = event?.data;
      if (raw === "[DONE]") {
        break;
      }
      const payload = (() => {
        if (event?.json && typeof event.json === "object") {
          return event.json;
        }
        if (typeof raw === "string") {
          try {
            return JSON.parse(raw);
          } catch (e) {
            return null;
          }
        }
        return null;
      })();
      if (!payload) {
        continue;
      }
      if (payload.type === "ERROR" || payload.finish_reason === "error" || payload.error) {
        throw new Error(payload?.message || payload?.error?.message || "文件解析失败");
      }
      const delta = this.extractTextFromPayload(payload);
      if (!delta) {
        continue;
      }
      hasAnyChunk = true;
      if (contentText && String(delta).startsWith(contentText)) {
        contentText = String(delta);
      } else {
        contentText += String(delta);
      }
      endTime = +new Date();
      this.setModelAssistantRecordContent(contentText, startTime, endTime);
    }
    if (!hasAnyChunk) {
      const retryRes = await Promise.race([
        ai.bot.sendMessage({
          data: {
            botId,
            msg,
            files: files.length ? files : undefined,
            searchEnable: false,
            stream: false,
          },
        }),
        sleep(90000).then(() => Promise.reject(new Error("MODEL_FILE_ROUTE_TIMEOUT"))),
      ]);
      const retryText = this.extractTextFromPayload(retryRes);
      if (retryText) {
        hasAnyChunk = true;
        contentText = String(retryText);
        endTime = +new Date();
        this.setModelAssistantRecordContent(contentText, startTime, endTime);
      }
    }
    if (!hasAnyChunk) {
      throw new Error("MODEL_FILE_ROUTE_EMPTY");
    }
    this.setData({
      chatStatus: 0,
    });
    return true;
  },
  mergeModelInputByRecord: function (record) {
    const content = record?.modelContent || record?.content || "";
    const fileList = record?.fileList || [];
    const ocrTextList = fileList
      .filter((item) => item.rawType === "image" && item.ocrText)
      .map((item, index) => `图片${index + 1}识别文本：\n${item.ocrText}`);
    const docTextList = fileList
      .filter((item) => item.rawType === "file")
      .map((item, index) => {
        const ext = this.getFileExt(item.rawFileName || item.tempFileName);
        if (item.extractedText) {
          return `附件${index + 1}（${item.rawFileName || item.tempFileName}）提取文本：\n${item.extractedText}`;
        }
        const parseHint = item.parseError ? `；文本提取状态：${item.parseError}` : "";
        return `附件${index + 1}：${item.rawFileName || item.tempFileName}（${ext || "未知类型"}）${parseHint}`;
      });
    const mergedParts = [content];
    if (ocrTextList.length) {
      mergedParts.push(ocrTextList.join("\n\n"));
    }
    if (docTextList.length) {
      mergedParts.push(docTextList.join("\n\n"));
    }
    const merged = mergedParts.filter(Boolean).join("\n\n").trim();
    return merged;
  },
  checkFileExt: function (ext) {
    return true;
  },
};
