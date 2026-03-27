const { getCloudInstance } = require("../tools");
const { buildRequestMessages } = require("../model-request-builder");

module.exports = {
  clipArchiveContentForModel: function (content, options = {}) {
    const text = String(content || "").trim();
    if (!text) {
      return "";
    }
    const featureKey = String(options.featureKey || this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult");
    const maxLength = featureKey === "draft" || featureKey === "review"
      ? 24000
      : featureKey === "document"
      ? 20000
      : 16000;
    if (text.length <= maxLength) {
      return text;
    }
    const headLength = Math.max(6000, Math.floor(maxLength * 0.65));
    const tailLength = Math.max(2500, maxLength - headLength);
    const head = text.slice(0, headLength).trim();
    const tail = text.slice(-tailLength).trim();
    return [
      head,
      `【系统隐藏提示：归档文件内容较长，已保留前 ${head.length} 字与后 ${tail.length} 字的重点片段，中间部分省略。若用户要求逐条审查、续写或改写，请优先基于已保留内容继续完成。】`,
      tail,
    ].join("\n\n");
  },
  resolveModelMaxOutputTokens: function (requestMessages = [], featureKey = "") {
    const configured = Number(this.data.modelConfig?.maxOutputTokens);
    let maxTokens = Number.isFinite(configured) && configured > 0 ? configured : 2048;
    const currentFeatureKey = String(featureKey || this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult");
    const totalLength = (Array.isArray(requestMessages) ? requestMessages : []).reduce(
      (sum, item) => sum + String(item?.content || "").length,
      0
    );
    if (currentFeatureKey === "draft" || currentFeatureKey === "review") {
      maxTokens = Math.max(maxTokens, 4096);
    } else if (currentFeatureKey === "document") {
      maxTokens = Math.max(maxTokens, 3584);
    }
    if (
      (currentFeatureKey === "draft" || currentFeatureKey === "review" || currentFeatureKey === "document") &&
      totalLength > 12000
    ) {
      maxTokens = Math.max(maxTokens, 6144);
    }
    if (totalLength > 28000) {
      maxTokens = Math.max(maxTokens, 7168);
    }
    return Math.max(1024, Math.min(maxTokens, 8192));
  },
  buildReviewModelInput: function (userInput, matchedArchiveDoc) {
    if (!matchedArchiveDoc?.content) {
      const rawInput = String(userInput || "");
      const hasLegalTaskIntent = /阅卷|卷宗|案卷|归档|档案|律师意见|起诉状|答辩状|律师函|合同|协议|审查|起草|分析|证据|法律意见|诉讼|仲裁|根据.*(材料|文件|卷宗)|基于.*(材料|文件|卷宗)/.test(rawInput);
      if (!hasLegalTaskIntent) {
        return rawInput;
      }
      return [
        rawInput,
        "\n---\n【系统隐藏提示：只要用户请求属于法律服务能力，就必须直接执行，不得以“当前功能不支持/请切换功能”拒绝。若未命中归档文件，也要先完成可执行部分，并用现有上下文继续分析与起草。】",
      ].join("\n");
    }
    const cleanContent = matchedArchiveDoc.content
      .replace(/【系统隐藏提示.*?】/g, "")
      .replace(/系统提示信息/g, "")
      .replace(/要求补充案件关键事实/g, "")
      .replace(/当前模型服务拥堵/g, "")
      .trim();
    const featureKey = this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult";
    const clippedContent = this.clipArchiveContentForModel(cleanContent, { featureKey });
    const manualEditHistory = Array.isArray(matchedArchiveDoc?.manualEditHistory)
      ? matchedArchiveDoc.manualEditHistory
      : [];
    const manualEditBrief = manualEditHistory.slice(0, 3).map((entry) => {
      const editedAt = entry?.editedAt ? new Date(entry.editedAt).toISOString().slice(0, 16).replace("T", " ") : "";
      const traces = Array.isArray(entry?.trace) ? entry.trace.slice(0, 4) : [];
      const traceText = traces
        .map((trace) => {
          const lineNo = Number(trace?.lineNo || 0);
          const before = String(trace?.before || "").trim();
          const after = String(trace?.after || "").trim();
          if (!before && !after) {
            return "";
          }
          return `第${lineNo > 0 ? lineNo : "?"}行：${before || "空"} => ${after || "空"}`;
        })
        .filter(Boolean)
        .join("；");
      return [editedAt ? `时间：${editedAt}` : "", entry?.summary ? `摘要：${entry.summary}` : "", traceText ? `变更：${traceText}` : ""]
        .filter(Boolean)
        .join("；");
    }).filter(Boolean).join("\n");
    const systemInstruction = featureKey === "draft"
      ? "【系统隐藏提示：以下是你匹配到的归档文件，请在起草时直接引用其中的事实与条款，不要向用户索要已归档文件】"
      : featureKey === "review"
      ? "【系统隐藏提示：以下是你匹配到的归档文件，请基于文件原文给出审查与修改建议，不要向用户索要已归档文件】"
      : "【系统隐藏提示：以下是你匹配到的归档文件，请优先基于该文件完成用户当前任务，不要向用户索要已归档文件】";

    return [
      String(userInput || ""),
      `\n---\n${systemInstruction}`,
      "【系统隐藏提示：必须以“归档文件标题”作为唯一可用文件标题来源。若原文未出现完整案件名，不得自行编造“甲诉乙某某纠纷案”标题。称呼统一使用“您”或“当事人”。输出需使用清晰Markdown结构（标题、二级标题、要点列表），避免大段连写。】",
      matchedArchiveDoc?.manualEdited
        ? "【系统隐藏提示：该文件已被账号使用者手动编辑。若手动编辑内容与AI默认推断冲突，必须优先采用手动编辑内容。】"
        : "",
      `归档文件标题：${matchedArchiveDoc.title || "未命名文件"}`,
      `归档文件内容如下：\n${clippedContent}`,
      matchedArchiveDoc?.manualEdited && manualEditBrief
        ? `最近手动编辑记录：\n${manualEditBrief}`
        : "",
    ].join("\n");
  },
  sendMessage: async function (message) {
    if (this.data.showFileList) {
      this.setData({
        showFileList: !this.data.showFileList,
      });
    }
    if (this.data.showTools) {
      this.setData({
        showTools: !this.data.showTools,
      });
    }
    let { inputValue, bot, chatRecords, chatStatus, modelConfig } = this.data;
    if (chatStatus !== 0) {
      return;
    }
    if (message) {
      inputValue = message;
    }
    const chatMode = this.data.chatMode;
    const quickResponseModel = modelConfig?.quickResponseModel || "default-chat-model";
    const hasAttachmentInput = chatMode === "model" && this.data.sendFileList.length > 0;
    const hasImageInput = chatMode === "model" && this.data.sendFileList.some((item) => item.rawType === "image");
    if (!inputValue && !hasAttachmentInput) {
      return;
    }
    if (!inputValue && hasImageInput) {
      const hasOcrText = this.data.sendFileList.some((item) => item.rawType === "image" && !!item.ocrText);
      if (!hasOcrText) {
        wx.showToast({
          title: "图片中未识别到文字",
          icon: "none",
        });
        return;
      }
    }
    const pendingFileList = Array.isArray(this.data.sendFileList)
      ? this.data.sendFileList.map((item) => ({ ...item }))
      : [];
    const userRecord = {
      content: inputValue,
      modelContent: inputValue,
      record_id: "record_id" + String(+new Date() - 10),
      role: "user",
      fileList: pendingFileList,
      archiveLookup: chatMode === "model" ? {
        status: "检索归档中",
        title: "正在匹配历史材料",
        detail: "已发送请求，正在补充关联卷宗",
      } : null,
    };
    const record = {
      content: "",
      record_id: "record_id" + String(+new Date() + 10),
      role: "assistant",
      hiddenBtnGround: true,
    };
    const userRecordIndex = chatRecords.length;
    const assistantRecordIndex = userRecordIndex + 1;
    this.setData({
      inputValue: "",
      questions: [],
      sendFileList: [],
      chatRecords: [...chatRecords, userRecord, record],
      chatStatus: 1,
    });
    this.autoToBottom();
    try {
      const attachmentCaseContext = chatMode === "model"
        ? this.resolveCaseContextFromFileList(pendingFileList)
        : { caseKey: "", caseTitle: "", caseNo: "", hasExplicitCaseNo: false };
      const archiveLookupInput = [
        inputValue,
        attachmentCaseContext.caseTitle ? ` ${attachmentCaseContext.caseTitle}` : "",
        attachmentCaseContext.caseKey ? ` ${attachmentCaseContext.caseKey}` : "",
      ].join("").trim();
      const archiveLookupResult = chatMode === "model"
        ? await this.retrieveArchivedDocumentForInput(archiveLookupInput, pendingFileList)
        : { matchedDoc: null, debug: null };
      const matchedReviewContract = archiveLookupResult?.matchedDoc || null;
      const archiveLookupDisplay = this.buildArchiveLookupDisplay(archiveLookupResult?.debug || {});
      const activeCaseContext = this.resolveCaseContext(inputValue, {
        caseKey: matchedReviewContract?.caseKey || attachmentCaseContext.caseKey || "",
        caseTitle: matchedReviewContract?.caseTitle || attachmentCaseContext.caseTitle || "",
        caseNo: attachmentCaseContext.caseNo || "",
        hasExplicitCaseNo: attachmentCaseContext.hasExplicitCaseNo,
      });
      userRecord.modelContent = this.buildReviewModelInput(inputValue, matchedReviewContract);
      userRecord.archiveLookup = archiveLookupDisplay;
      this.queueStreamRecordPatch(userRecordIndex, {
        modelContent: userRecord.modelContent,
        archiveLookup: archiveLookupDisplay,
      }, {}, {
        immediate: true,
      });
      if (matchedReviewContract?.id) {
        wx.showToast({
          title: `已匹配：${matchedReviewContract.title || "归档文件"}`,
          icon: "none",
        });
      }
      if (chatMode === "bot") {
        const cloudInstance = await getCloudInstance(this.data.envShareConfig);
        const ai = cloudInstance.extend.AI;
        let res;
        if (!this.data.bot.multiConversationEnable) {
          res = await ai.bot.sendMessage({
            data: {
              botId: bot.botId,
              msg: inputValue,
              files: userRecord.fileList.length ? userRecord.fileList.map((item) => item.fileId) : undefined,
              searchEnable: this.data.useWebSearch,
            },
          });
        } else {
          if (!this.data.conversation && this.data.bot.multiConversationEnable) {
            try {
              const { data } = await this.createConversation();
              this.setData({
                conversation: {
                  conversationId: data.conversationId,
                  title: data.title,
                },
              });
            } catch (e) {
              console.log("createConversation e", e);
            }
          }

          const sendReq = {
            botId: bot.botId,
            msg: inputValue,
            files: userRecord.fileList.length ? userRecord.fileList.map((item) => item.fileId) : undefined,
            searchEnable: this.data.useWebSearch,
          };

          if (this.data.conversation?.conversationId) {
            sendReq.conversationId = this.data.conversation.conversationId;
          }

          res = await ai.bot.sendMessage({
            data: sendReq,
          });
          await this.resetFetchConversationList();
        }
        let contentText = "";
        let reasoningContentText = "";
        let isManuallyPaused = false;
        let startTime = null;
        let endTime = null;
        let archiveForcedByFunctionCall = false;
        let index = 0;
        for await (let event of res.eventStream) {
          const { chatStatus: currentChatStatus } = this.data;
          if (currentChatStatus === 0) {
            isManuallyPaused = true;
            break;
          }
          if (index % 10 === 0) {
            this.toBottom(40);
          }
          const { data } = event;
          if (data === "[DONE]") {
            break;
          }
          try {
            const dataJson = JSON.parse(data);
            const {
              type,
              content,
              reasoning_content,
              record_id,
              search_info,
              role,
              knowledge_meta,
              knowledge_base,
              finish_reason,
              search_results,
              error,
              usage,
            } = dataJson;
            const newValue = [...this.data.chatRecords];
            const lastValueIndex = newValue.length - 1;
            const lastValue = newValue[lastValueIndex];
            lastValue.role = role || "assistant";
            if (record_id) {
              lastValue.record_id = record_id;
            }
            if (finish_reason === "error" || finish_reason === "content_filter" || error) {
              lastValue.search_info = null;
              lastValue.reasoning_content = "";
              lastValue.knowledge_meta = [];
              lastValue.content = this.data.defaultErrorMsg;
              if (error && error.message) {
                if (error.code === "EXCEED_TOKEN_QUOTA_LIMIT") {
                  lastValue.content = "大模型 Token 已耗尽，请通知开发者前往云开发平台进行处理";
                  lastValue.error = lastValue.content;
                } else {
                  lastValue.content = error.message;
                }
                this.setData({
                  [`chatRecords[${lastValueIndex}].error`]: lastValue.error,
                });
                if (lastValue.toolCallList && lastValue.toolCallList.length) {
                  let errToolCallObj = null;
                  if (typeof error.message === "string") {
                    errToolCallObj = lastValue.toolCallList[lastValue.toolCallList.length - 1];
                  } else if (error.message?.toolCallId) {
                    errToolCallObj = lastValue.toolCallList.find((item) => item.id === error.message.toolCallId);
                  }
                  if (errToolCallObj && !errToolCallObj.callResult) {
                    errToolCallObj.error = error;
                    this.setData({
                      [`chatRecords[${lastValueIndex}].toolCallList`]: lastValue.toolCallList,
                    });
                    this.autoToBottom();
                  }
                }
              }
              this.setData({
                [`chatRecords[${lastValueIndex}].search_info`]: lastValue.search_info,
                [`chatRecords[${lastValueIndex}].reasoning_content`]: lastValue.reasoning_content,
                [`chatRecords[${lastValueIndex}].knowledge_meta`]: lastValue.knowledge_meta,
                [`chatRecords[${lastValueIndex}].content`]: lastValue.content,
                [`chatRecords[${lastValueIndex}].record_id`]: lastValue.record_id,
              });
              break;
            }
            if (type === "search" && !lastValue.search_info) {
              lastValue.search_info = search_info;
              this.setData({
                chatStatus: 2,
                [`chatRecords[${lastValueIndex}].search_info`]: lastValue.search_info,
                [`chatRecords[${lastValueIndex}].record_id`]: lastValue.record_id,
              });
            }
            if (type === "thinking") {
              if (!startTime) {
                startTime = +new Date();
                endTime = +new Date();
              } else {
                endTime = +new Date();
              }
              reasoningContentText += reasoning_content;
              lastValue.reasoning_content = reasoningContentText;
              lastValue.thinkingTime = Math.floor((endTime - startTime) / 1000);
              this.setData({
                [`chatRecords[${lastValueIndex}].reasoning_content`]: lastValue.reasoning_content,
                [`chatRecords[${lastValueIndex}].thinkingTime`]: lastValue.thinkingTime,
                [`chatRecords[${lastValueIndex}].record_id`]: lastValue.record_id,
                chatStatus: 2,
              });
            }
            if (type === "text") {
              let isToolCallContent = false;
              const toolCallList = lastValue.toolCallList;
              if (toolCallList && toolCallList.length) {
                const findToolCallObj = toolCallList.find((item) => item.callParams && !item.callResult);
                if (findToolCallObj) {
                  isToolCallContent = true;
                  findToolCallObj.content += content.replaceAll("\t", "").replaceAll("\n", "\n\n");
                  this.setData({
                    [`chatRecords[${lastValueIndex}].toolCallList`]: lastValue.toolCallList,
                    chatStatus: 3,
                  });
                  this.autoToBottom();
                }
              }

              if (!isToolCallContent) {
                contentText += content;
                lastValue.content = contentText;
                this.setData({
                  [`chatRecords[${lastValueIndex}].content`]: lastValue.content,
                  [`chatRecords[${lastValueIndex}].record_id`]: lastValue.record_id,
                  chatStatus: 3,
                });
              }
            }
            if (type === "knowledge" && !lastValue.knowledge_meta) {
              lastValue.knowledge_base = knowledge_base;
              this.setData({
                [`chatRecords[${lastValueIndex}].knowledge_base`]: lastValue.knowledge_base,
                chatStatus: 2,
              });
            }
            if (type === "db" && !lastValue.db_len) {
              lastValue.db_len = search_results.relateTables || 0;
              this.setData({
                [`chatRecords[${lastValueIndex}].db_len`]: lastValue.db_len,
                chatStatus: 2,
              });
            }
            if (type === "tool-call") {
              const { tool_call } = dataJson;
              const normalizedToolName = this.transformToolName(tool_call.function.name);
              if (String(normalizedToolName || "").toLowerCase() === "archive_contract") {
                archiveForcedByFunctionCall = true;
              }
              const callBody = {
                id: tool_call.id,
                name: normalizedToolName,
                rawParams: tool_call.function.arguments,
                callParams: "```json\n" + JSON.stringify(tool_call.function.arguments, null, 2) + "\n```",
                content: "",
              };
              if (!lastValue.toolCallList) {
                lastValue.toolCallList = [callBody];
              } else {
                lastValue.toolCallList.push(callBody);
              }
              this.setData({
                [`chatRecords[${lastValueIndex}].toolCallList`]: lastValue.toolCallList,
              });
              this.autoToBottom();
            }
            if (type === "tool-result") {
              const { toolCallId, result } = dataJson;
              if (lastValue.toolCallList && lastValue.toolCallList.length) {
                const lastToolCallObj = lastValue.toolCallList.find((item) => item.id === toolCallId);
                if (lastToolCallObj && !lastToolCallObj.callResult) {
                  lastToolCallObj.rawResult = result;
                  lastToolCallObj.callResult = "```json\n" + JSON.stringify(result, null, 2) + "\n```";
                  this.setData({
                    [`chatRecords[${lastValueIndex}].toolCallList`]: lastValue.toolCallList,
                  });
                  this.autoToBottom();
                }
              }
            }
            if (type === "finish" && finish_reason === "length") {
              const completionTokens = usage?.completionTokens || 0;
              lastValue.error = completionTokens
                ? `当前输出token长度为 ${completionTokens}，已超过最大限制，请重新提问`
                : "已超过最大限制，请重新提问";
              this.setData({
                [`chatRecords[${lastValueIndex}].error`]: lastValue.error,
              });
            }
          } catch (e) {
            console.log("err", event, e);
            break;
          }
          index++;
        }
        this.toBottom(40);
        const newValue = [...this.data.chatRecords];
        const lastValueIndex = newValue.length - 1;
        const lastValue = newValue[lastValueIndex];
        lastValue.hiddenBtnGround = isManuallyPaused;
        if (lastValue.content === "") {
          lastValue.content = this.data.defaultErrorMsg;
          this.setData({
            [`chatRecords[${lastValueIndex}].content`]: lastValue.content,
          });
        }
        this.setData({
          chatStatus: 0,
          [`chatRecords[${lastValueIndex}].hiddenBtnGround`]: isManuallyPaused,
        });
        if ((this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult") !== "consult") {
          await this.callFunctionByName("archive_contract", {
            userInput: inputValue,
            generatedContent: lastValue.content || contentText,
            options: {
              forceArchive: archiveForcedByFunctionCall,
              status: "已生成",
              archiveKey: `bot_${lastValue.record_id || Date.now()}`,
              caseKey: activeCaseContext.caseKey,
              caseTitle: activeCaseContext.caseTitle,
            },
          });
        }
        if (bot.isNeedRecommend && !isManuallyPaused) {
          const cloudInstance = await getCloudInstance(this.data.envShareConfig);
          const ai = cloudInstance.extend.AI;
          const latestChatRecords = this.data.chatRecords;
          const lastPairChatRecord = latestChatRecords.length >= 2 ? latestChatRecords.slice(latestChatRecords.length - 2) : [];
          const recommendRes = await ai.bot.getRecommendQuestions({
            data: {
              botId: bot.botId,
              history: lastPairChatRecord.map((item) => ({
                role: item.role,
                content: item.content,
              })),
              msg: inputValue,
              agentSetting: "",
              introduction: "",
              name: "",
            },
          });
          let result = "";
          for await (let str of recommendRes.textStream) {
            this.toBottom();
            result += str;
            this.setData({
              questions: result.split("\n").filter((item) => !!item),
            });
          }
        }
      }
      if (chatMode === "model") {
        const hasDocumentFile = userRecord.fileList.some((item) => item.rawType === "file");
        if (hasDocumentFile) {
          try {
            const readyFileList = await this.ensureModelFilesReadyByBot(userRecord.fileList);
            const newChatRecords = [...this.data.chatRecords];
            const userRecordIndex = newChatRecords.length - 2;
            if (newChatRecords[userRecordIndex]) {
              newChatRecords[userRecordIndex].fileList = readyFileList;
            }
            userRecord.fileList = readyFileList;
            this.setData({
              chatRecords: newChatRecords,
            });
            const unsupportedFile = readyFileList.find((item) => {
              if (item.rawType !== "file") {
                return false;
              }
              const ext = this.getFileExt(item.rawFileName || item.tempFileName);
              return !item.extractedText && !item.ocrText && !/^(jpg|jpeg|png|bmp|gif|webp)$/.test(ext);
            });
            if (unsupportedFile) {
              wx.showToast({
                title: "部分附件未提取正文，已按文件信息继续",
                icon: "none",
              });
            }
          } catch (e) {
            const newValue = [...this.data.chatRecords];
            const lastValue = newValue[newValue.length - 1];
            const errMsg = e && e.message ? String(e.message) : "附件解析失败";
            lastValue.content = `附件解析失败：${errMsg}`;
            lastValue.hiddenBtnGround = true;
            this.setData({
              chatRecords: newValue,
              chatStatus: 0,
            });
            wx.showToast({
              title: "附件解析失败",
              icon: "none",
            });
            return;
          }
        }
        this.archiveUploadedContracts(userRecord);
        const requestMessages = buildRequestMessages({
          chatRecords,
          userRecord,
          modelConfig: this.data.modelConfig,
          mergeModelInputByRecord: (record) => this.mergeModelInputByRecord(record),
        });
        let contentText = "";
        let reasoningContentText = "";
        let chatStatus = 2;
        let isManuallyPaused = false;
        let startTime = +new Date();
        let endTime = null;
        let archivedGeneratedId = "";
        const modelArchiveKey = `model_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
        const currentFeatureKey = this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult";
        const outputMaxTokens = this.resolveModelMaxOutputTokens(requestMessages, currentFeatureKey);
        const shouldContinueGeneratedArchiveVersion = this.shouldContinueGeneratedArchiveVersion(
          inputValue,
          matchedReviewContract || {}
        );
        const contractGroupKey =
          currentFeatureKey === "draft" || currentFeatureKey === "review" || shouldContinueGeneratedArchiveVersion
            ? (matchedReviewContract?.contractGroupKey || matchedReviewContract?.id || modelArchiveKey)
            : modelArchiveKey;
        const initialValue = [...this.data.chatRecords];
        const initialRecord = initialValue[assistantRecordIndex];
        initialRecord.content = "";
        initialRecord.reasoning_content = "";
        initialRecord.record_id = "record_id" + String(Date.now());
        this.suspendChatRecordSync();
        this.queueStreamRecordPatch(assistantRecordIndex, {
          content: "",
          reasoning_content: "",
          record_id: initialRecord.record_id,
        }, {
          chatStatus,
        }, {
          immediate: true,
        });
        this.toBottom();

        const aiController = require("../../../services/ai-chat-stream-service.js");

        const requestTask = aiController.streamChat(
          {
            messages: requestMessages,
            model: quickResponseModel,
            maxTokens: outputMaxTokens,
          },
          (deltaContent, isReasoning) => {
            if (this.data.chatStatus === 0) {
              isManuallyPaused = true;
              requestTask && requestTask.abort && requestTask.abort();
              return;
            }

            if (isReasoning && deltaContent) {
              reasoningContentText += deltaContent;
            } else if (!isReasoning && deltaContent) {
              contentText += deltaContent;
            }

            endTime = +new Date();
            const thinkingTime = Math.floor((endTime - startTime) / 1000);

            if (contentText) {
              chatStatus = 3;
            }

            this.queueStreamRecordPatch(assistantRecordIndex, {
              content: contentText,
              reasoning_content: reasoningContentText,
              thinkingTime,
            }, {
              chatStatus,
            });
            this.toBottom();
          },
          async () => {
            this.flushPendingStreamRecordPatch(true);
            try {
              this.setData({
                [`chatRecords[${assistantRecordIndex}].hiddenBtnGround`]: isManuallyPaused,
                chatStatus: 0,
              });
              const finalChatRecords = this.data.chatRecords || [];
              const finalAssistantRecord = finalChatRecords[assistantRecordIndex] || {};
              const finalContent = finalAssistantRecord.content || contentText;
              if (currentFeatureKey !== "consult" && this.isLikelyArchivableGeneratedDocument(finalContent, { featureKey: currentFeatureKey })) {
                const archiveRes = await this.callFunctionByName("archive_contract", {
                  userInput: inputValue,
                  generatedContent: finalContent,
                  options: {
                    id: archivedGeneratedId,
                    status: "已生成",
                    archiveKey: modelArchiveKey,
                    contractGroupKey,
                    caseKey: activeCaseContext.caseKey || matchedReviewContract?.caseKey || "",
                    caseTitle: activeCaseContext.caseTitle || matchedReviewContract?.caseTitle || "",
                    baseArchiveId: shouldContinueGeneratedArchiveVersion ? (matchedReviewContract?.id || "") : "",
                    baseArchiveTitle: shouldContinueGeneratedArchiveVersion ? (matchedReviewContract?.title || "") : "",
                    baseArchiveSourceType: shouldContinueGeneratedArchiveVersion ? (matchedReviewContract?.sourceType || "") : "",
                    finalConfirmed: this.isFinalContractIntent(inputValue, finalContent),
                  },
                });
                if (!archiveRes?.ok && !/^skip:/.test(String(archiveRes?.error || ""))) {
                  wx.showToast({
                    title: archiveRes?.error || "合同归档失败",
                    icon: "none",
                  });
                }
              }
            } finally {
              this.resumeChatRecordSync();
            }
          },
          (err) => {
            console.error("请求失败", err);
            this.flushPendingStreamRecordPatch(true);
            const errorValue = [...this.data.chatRecords];
            const errorRecord = errorValue[errorValue.length - 1];
            const detail = err?.errMsg || err?.message || "";
            if (detail.includes("url not in domain list")) {
              errorRecord.content = "请求失败：请在小程序后台配置 request 合法域名 https://api.deepseek.com";
            } else if (
              err?.errCode === -504003 ||
              detail.includes("FUNCTIONS_TIME_LIMIT_EXCEEDED") ||
              detail.includes("timed out after")
            ) {
              errorRecord.content = "请求失败：云函数超时，请在 aiChat 的版本与配置中把超时时间调大（建议 20-60 秒）";
            } else if (err?.errCode === "UPSTREAM_TIMEOUT") {
              errorRecord.content = "请求失败：模型服务响应超时，请重试一次或精简输入内容";
            } else if (err?.statusCode === 401) {
              errorRecord.content = "请求失败：API Key 无效或已过期";
            } else if (err?.statusCode === 429) {
              errorRecord.content = "请求失败：请求过于频繁或额度不足";
            } else {
              errorRecord.content = detail ? `请求失败：${detail}` : "请求失败，请检查网络或 API Key 设置。";
            }
            this.setData({ chatRecords: errorValue, chatStatus: 0 });
            this.resumeChatRecordSync();
          }
        );
      }
    } catch (err) {
      console.error("sendMessage failed", err);
      this.flushPendingStreamRecordPatch(true);
      const detail = err?.errMsg || err?.message || "";
      const errorValue = [...this.data.chatRecords];
      const errorRecord = errorValue[errorValue.length - 1];
      if (errorRecord) {
        if (detail.includes("url not in domain list")) {
          errorRecord.content = "请求失败：请在小程序后台配置 request 合法域名";
        } else if (
          err?.errCode === -504003 ||
          detail.includes("FUNCTIONS_TIME_LIMIT_EXCEEDED") ||
          detail.includes("timed out after")
        ) {
          errorRecord.content = "请求失败：云函数超时，请稍后重试";
        } else if (err?.statusCode === 401) {
          errorRecord.content = "请求失败：API Key 无效或已过期";
        } else if (err?.statusCode === 429) {
          errorRecord.content = "请求失败：请求过于频繁或额度不足";
        } else {
          errorRecord.content = detail ? `请求失败：${detail}` : this.data.defaultErrorMsg;
        }
        this.setData({ chatRecords: errorValue, chatStatus: 0 });
      } else {
        this.setData({ chatStatus: 0 });
      }
      this.resumeChatRecordSync();
    }
  },
};
