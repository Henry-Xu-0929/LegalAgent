const { getCloudInstance, sleep } = require("../tools");
const md5 = require("../md5.js").default || require("../md5.js");
const i18n = require("../../../utils/i18n");

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
            title: i18n.t("agent.imageSizeLimit"),
            icon: "error",
          });
          return;
        }
        const tempFiles = await Promise.all(res.tempFiles.map(async (item) => {
          const tempFileInfos = item.tempFilePath.split(".");
          const tempFileName = md5(tempFileInfos[0]) + "." + tempFileInfos[1];
          const isModelMode = self.data.chatMode === "model";
          const ocrResult = isModelMode
            ? await self.extractImageTextWithTrace(item.tempFilePath)
            : { text: "", trace: [] };
          const ocrText = String(ocrResult?.text || "");
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
            ocrDebug: Array.isArray(ocrResult?.trace)
              ? ocrResult.trace.map((step) => `${step.step}:${step.ok ? "ok" : "fail"}${step.detail ? `(${step.detail})` : ""}`).join(" | ")
              : "",
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
          if (recognizedCount > 0) {
            wx.showToast({
              title: i18n.t("agent.imagesRecognized", { n: recognizedCount }),
              icon: "success",
            });
          } else {
            const firstDebug = finalFileList.find((item) => item.rawType === "image" && item.ocrDebug)?.ocrDebug || "";
            const detail = firstDebug || i18n.t("agent.ocrUnavailable");
            wx.showModal({
              title: i18n.t("agent.ocrTitle"),
              content: `${i18n.t("agent.ocrDetailPrefix")}${detail.slice(0, 600)}`,
              showCancel: false,
              confirmText: i18n.t("agent.gotIt"),
            });
            console.warn("OCR_UPLOAD_FAIL_TRACE:", detail);
          }
        }
      },
    });
  },
  handleUploadImg: function (sourceType) {
    const isModelMode = this.data.chatMode === "model";
    if (!isModelMode && !this.data.isAgent && !this.data.bot.searchFileEnable) {
      wx.showModal({
        title: i18n.t("common.notice"),
        content: i18n.t("agent.imageUploadUnsupported"),
      });
      return;
    }
    if (!isModelMode && this.data.useWebSearch) {
      wx.showModal({
        title: i18n.t("common.notice"),
        content: i18n.t("agent.webSearchWithAttachment"),
      });
      return;
    }
    const self = this;
    const isCurSendFile = this.data.sendFileList.find((item) => item.rawType === "file");
    if (isCurSendFile) {
      wx.showModal({
        title: i18n.t("agent.replaceConfirm"),
        content: i18n.t("agent.replaceImageContent"),
        showCancel: "true",
        cancelText: i18n.t("common.cancel"),
        confirmText: i18n.t("common.confirm"),
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
        title: i18n.t("agent.fileCountLimit"),
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
            title: i18n.t("agent.fileSizeLimit"),
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
            title: i18n.t("agent.fileAdded"),
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
        title: i18n.t("common.notice"),
        content: i18n.t("agent.fileUploadUnsupported"),
      });
      return;
    }
    if (!isModelMode && this.data.useWebSearch) {
      wx.showModal({
        title: i18n.t("common.notice"),
        content: i18n.t("agent.webSearchWithAttachment"),
      });
      return;
    }
    const self = this;
    const isCurSendImage = this.data.sendFileList.find((item) => item.rawType === "image");
    if (isCurSendImage) {
      wx.showModal({
        title: i18n.t("agent.replaceConfirm"),
        content: i18n.t("agent.replaceFileContent"),
        showCancel: "true",
        cancelText: i18n.t("common.cancel"),
        confirmText: i18n.t("common.confirm"),
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
  extractImageText: async function (filePath) {
    const result = await this.extractImageTextWithTrace(filePath);
    return String(result?.text || "");
  },
  extractImageTextWithTrace: async function (filePath) {
    const trace = [];
    let serviceMarketBlocked = false;
    const pushTrace = (step, ok, detail) => {
      trace.push({
        step,
        ok: !!ok,
        detail: String(detail || "").slice(0, 180),
      });
    };
    const normalizeDetail = (detail) => String(detail || "")
      .replace(/requestId[:：]?\s*[\w\-_.]+/ig, "requestId:<hidden>")
      .replace(/\s+/g, " ")
      .trim();
    const isServiceMarketDisabled = (detail) => {
      const source = String(detail || "").toLowerCase();
      return source.includes("930101")
        || source.includes("930010")
        || source.includes("consumption failure")
        || source.includes("余额")
        || source.includes("欠费");
    };
    const toErrorDetail = (payload) => {
      const source = payload?.errMsg
        || payload?.message
        || payload?.error
        || payload?.msg
        || payload?.statusCode
        || payload?.errno
        || payload?.code;
      return normalizeDetail(source);
    };
    const parseServiceError = (res) => {
      const root = res?.data || res?.result || res || {};
      const source = typeof root === "string" ? (() => {
        try {
          return JSON.parse(root);
        } catch (e) {
          return { raw: root };
        }
      })() : root;
      const errCode = source?.errCode || source?.errno || source?.code || source?.errorCode || source?.error_code;
      const errMsg = source?.errMsg || source?.errmsg || source?.message || source?.error || source?.msg || "";
      if (errCode || errMsg) {
        return normalizeDetail(`code=${errCode || "unknown"},msg=${String(errMsg || "").slice(0, 120)}`);
      }
      return "";
    };
    const parseText = (step, res) => {
      const text = String(this.parseOcrText(res) || "").trim();
      if (text) {
        pushTrace(step, true, `len=${text.length}`);
      } else {
        const hint = parseServiceError(res) || toErrorDetail(res) || "empty";
        pushTrace(step, false, hint);
      }
      return text;
    };
    const invokeServiceMarket = (step, data) => new Promise((resolve) => {
      if (serviceMarketBlocked) {
        pushTrace(step, false, "skip(service unavailable)");
        resolve("");
        return;
      }
      if (!wx.serviceMarket) {
        pushTrace(step, false, "wx.serviceMarket unavailable");
        resolve("");
        return;
      }
      wx.serviceMarket.invokeService({
        service: "wx79ac3de8be320b71",
        api: "OcrAllInOne",
        data,
      }).then((res) => {
        const text = parseText(step, res);
        if (!text) {
          const detail = trace[trace.length - 1]?.detail || "";
          if (isServiceMarketDisabled(detail)) {
            serviceMarketBlocked = true;
          }
        }
        resolve(text);
      }).catch((err) => {
        const detail = toErrorDetail(err) || "invoke failed";
        pushTrace(step, false, detail);
        if (isServiceMarketDisabled(detail)) {
          serviceMarketBlocked = true;
        }
        resolve("");
      });
    });
    const callWxPrintedText = () => new Promise((resolve) => {
      if (!wx.ocr || typeof wx.ocr.printedText !== "function") {
        pushTrace("wx.ocr.printedText", false, "unavailable");
        resolve("");
        return;
      }
      wx.ocr.printedText({
        imagePath: filePath,
        success: (res) => resolve(parseText("wx.ocr.printedText", res)),
        fail: (err) => {
          pushTrace("wx.ocr.printedText", false, toErrorDetail(err));
          resolve("");
        },
      });
    });
    const callWxGeneralOcr = () => new Promise((resolve) => {
      if (!wx.ocr || typeof wx.ocr !== "function") {
        pushTrace("wx.ocr.general", false, "unavailable");
        resolve("");
        return;
      }
      wx.ocr({
        type: "ocrGeneral",
        filePath,
        success: (res) => resolve(parseText("wx.ocr.general", res)),
        fail: (err) => {
          pushTrace("wx.ocr.general", false, toErrorDetail(err));
          resolve("");
        },
      });
    });
    const readBase64 = () => new Promise((resolve) => {
      try {
        wx.getFileSystemManager().readFile({
          filePath,
          encoding: "base64",
          success: (res) => resolve(String(res?.data || "")),
          fail: (err) => {
            pushTrace("read.base64", false, toErrorDetail(err));
            resolve("");
          },
        });
      } catch (e) {
        pushTrace("read.base64", false, toErrorDetail(e));
        resolve("");
      }
    });
    const uploadToCloud = async () => {
      try {
        const ext = String(filePath || "").split(".").pop() || "jpg";
        const cloudPath = `ocr-temp/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath,
          filePath,
        });
        const fileID = String(uploadRes?.fileID || "");
        if (!fileID) {
          pushTrace("cloud.upload", false, "empty fileID");
          return "";
        }
        pushTrace("cloud.upload", true, "ok");
        return fileID;
      } catch (e) {
        pushTrace("cloud.upload", false, toErrorDetail(e));
        return "";
      }
    };
    const callBotVision = async (fileId) => {
      const botId = String(
        this.data?.agentConfig?.botId
        || this.data?.bot?.botId
        || ""
      );
      if (!botId) {
        pushTrace("bot.vision", false, "missing botId");
        return "";
      }
      try {
        const cloudInstance = await getCloudInstance(this.data.envShareConfig);
        const ai = cloudInstance.extend.AI;
        const res = await Promise.race([
          ai.bot.sendMessage({
            data: {
              botId,
              msg: "请逐字提取图片中的全部文字，只输出识别结果，不要解释。",
              files: [fileId],
              searchEnable: false,
              stream: false,
            },
          }),
          sleep(60000).then(() => Promise.reject(new Error("BOT_OCR_TIMEOUT"))),
        ]);
        const text = String(this.extractTextFromPayload(res) || "").trim();
        if (text) {
          pushTrace("bot.vision", true, `len=${text.length}`);
          return text;
        }
        pushTrace("bot.vision", false, "empty");
        return "";
      } catch (e) {
        pushTrace("bot.vision", false, toErrorDetail(e));
        return "";
      }
    };
    const callCloudModelOcr = async (fileId) => {
      try {
        const ext = this.getFileExt(filePath) || "jpg";
        const text = String(await this.extractImageTextByCloud(fileId, `ocr.${ext}`) || "").trim();
        if (text) {
          pushTrace("cloud.modelOCR", true, `len=${text.length}`);
          return text;
        }
        pushTrace("cloud.modelOCR", false, "empty");
        return "";
      } catch (e) {
        const detail = toErrorDetail(e);
        if (String(detail).includes("MODEL_TEXT_ONLY")) {
          pushTrace("cloud.modelOCR", false, "MODEL_TEXT_ONLY(当前DeepSeek通道不支持图片输入)");
        } else {
          pushTrace("cloud.modelOCR", false, detail);
        }
        return "";
      }
    };

    let text = await callWxPrintedText();
    if (text) {
      return { text, trace };
    }
    text = await callWxGeneralOcr();
    if (text) {
      return { text, trace };
    }

    const cloudFileId = await uploadToCloud();
    if (cloudFileId) {
      text = await callCloudModelOcr(cloudFileId);
      if (text) {
        return { text, trace };
      }
      text = await callBotVision(cloudFileId);
      if (text) {
        return { text, trace };
      }
      text = await invokeServiceMarket("serviceMarket.fileID", {
        img_url: cloudFileId,
        data_type: 3,
        ocr_type: 8,
      });
      if (text) {
        return { text, trace };
      }
    }

    text = await invokeServiceMarket("serviceMarket.cdnPath", {
      img_url: new wx.cloud.CDN({ type: "filePath", filePath }),
      data_type: 3,
      ocr_type: 8,
    });
    if (text) {
      return { text, trace };
    }

    const base64 = await readBase64();
    if (base64) {
      text = await invokeServiceMarket("serviceMarket.base64A", {
        img_base64: base64,
        data_type: 2,
        ocr_type: 8,
      });
      if (!text) {
        text = await invokeServiceMarket("serviceMarket.base64B", {
          img_data: base64,
          data_type: 2,
          ocr_type: 8,
        });
      }
      if (!text) {
        text = await invokeServiceMarket("serviceMarket.base64C", {
          img_base64: base64,
          ocr_type: 8,
        });
      }
      if (text) {
        return { text, trace };
      }
    }

    console.warn("OCR all strategies failed:", trace);
    return {
      text: "",
      trace,
    };
  },
  parseOcrText: function (ocrRes) {
    if (!ocrRes) return "";
    let source = ocrRes;

    if (typeof ocrRes.data === "string") {
      try { source = JSON.parse(ocrRes.data); } catch (e) { source = ocrRes; }
    } else if (ocrRes.data) {
      source = ocrRes.data;
    }

    if (source && source.ocr_res) {
      try {
        source = typeof source.ocr_res === "string" ? JSON.parse(source.ocr_res) : source.ocr_res;
      } catch (e) {}
    }

    if (source && source.result && typeof source.result === 'object') {
      if (Array.isArray(source.result.items) || Array.isArray(source.result.words_result) || Array.isArray(source.result.PrintedText)) {
        source = source.result;
      }
    }

    let textArr = [];
    const extractFromArray = (arr) => {
      if (!Array.isArray(arr)) return false;
      const texts = arr.map(item => item.text || item.words || item.Text || item.Word).filter(Boolean);
      if (texts.length > 0) {
        textArr = texts;
        return true;
      }
      return false;
    };

    if (extractFromArray(source.items)) return textArr.join("\n").trim();
    if (extractFromArray(source.words_result)) return textArr.join("\n").trim();
    if (extractFromArray(source.PrintedText)) return textArr.join("\n").trim();
    if (extractFromArray(source)) return textArr.join("\n").trim();

    // Deep fallback: recursively pull text-like fields from any nested structure
    const collected = [];
    const visited = new Set();
    const walk = (node) => {
      if (!node || visited.has(node)) return;
      if (typeof node === "object") {
        visited.add(node);
      }
      if (typeof node === "string") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== "object") return;
      Object.keys(node).forEach((key) => {
        const val = node[key];
        const lowerKey = String(key).toLowerCase();
        if (typeof val === "string") {
          if (/(text|word|content|sentence|line)/.test(lowerKey) && val.trim()) {
            collected.push(val.trim());
          }
        } else {
          walk(val);
        }
      });
    };
    walk(source);
    if (collected.length > 0) {
      return collected.join("\n").trim();
    }

    if (typeof source.text === "string") return source.text.trim();
    if (typeof source.words === "string") return source.words.trim();

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
  extractImageTextByCloud: async function (fileId, fileName) {
    const invokeExtract = () => new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: "aiChat",
        data: {
          action: "extractImageText",
          fileId,
          fileName,
        },
        success: (res) => {
          const result = res?.result || {};
          if (result.success && result.text) {
            resolve(String(result.text));
            return;
          }
          reject(new Error(result.message || "云端图片识别失败"));
        },
        fail: (err) => {
          const detail = err?.errMsg || err?.message || "云端图片识别失败";
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
      // Retry once after timeout, then fallback to generic file extractor (now supports image OCR).
      await sleep(500);
      try {
        return await invokeExtract();
      } catch (retryErr) {
        const retryDetail = String(retryErr?.message || "");
        const stillTimeout = retryDetail.includes("FUNCTIONS_TIME_LIMIT_EXCEEDED")
          || retryDetail.includes("timed out")
          || retryDetail.includes("errCode: -504003");
        if (!stillTimeout) {
          throw retryErr;
        }
        return await this.extractModelFileTextByCloud(fileId, fileName);
      }
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
