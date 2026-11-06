const i18n = require("../../../utils/i18n");
const { getCloudInstance } = require("../tools");

module.exports = {
  handleUserMessage: function (message) {
    const { inputValue, sendFileList } = this.data;
    const content = message || inputValue;
    const userMsg = { id: "user_message_" + Date.now(), role: "user", content, fileList: sendFileList || [] };
    if (sendFileList && sendFileList.length > 0) {
      userMsg.files = sendFileList.map(item => item.fileId);
    }
    return [userMsg];
  },
  handleFrontendToolCallMessage: function (frontendToolsResult) {
    const toolCallMessages = frontendToolsResult.map((item) => ({
      id: item.toolCallId,
      role: "tool",
      toolCallId: item.toolCallId,
      content: item.result,
    }));
    return toolCallMessages;
  },
  handleSendMessageV2: async function (message) {
    const userMessages = this.handleUserMessage(message);
    this.setData({
      chatStatus: 1,
      inputValue: "",
      sendFileList: [],
      showFileList: false,
      showTools: false
    });
    await this.sendMessageV2(userMessages);
    this.setData({
      chatStatus: 0,
    });
  },
  sendMessageV2: async function (message) {
    const {
      agentV2Config: { agentID },
      messages,
      threadId,
    } = this.data;
    const newMessages = [...messages];
    if (message?.[0]?.role === "user") {
      const aiMsg = { id: "assistant_message_" + Date.now(), role: "assistant", parts: [] };
      newMessages.push(message?.[0], aiMsg);
      this.setData({
        messages: newMessages,
      });
    }
    const currentAiMsgIndex = newMessages.length - 1;
    const cloudInstance = await getCloudInstance();
    const ai = cloudInstance.extend.AI;
    try {
      const res = await ai.bot.sendMessage({
        data: {
          botId: agentID,
          threadId: threadId,
          runId: "run_id_" + Date.now(),
          messages: message,
          tools: this.data.agentV2Config.tools.map((item) => ({
            name: item.name,
            description: item.description,
            parameters: item.parameters,
          })),
          context: [],
          state: {},
        },
      });
      await this.handleStream(res.eventStream, ai, agentID, currentAiMsgIndex);
    } catch (e) {
      console.error(e);
      this.setData({
        [`messages[${currentAiMsgIndex}].parts`]: [{ type: "error", content: i18n.t("agent.networkError") }],
      });
    }
  },
  handleStream: async function (stream, ai, agentID, currentAiMsgIndex) {
    let fullContent = "";
    let archiveForcedByToolCall = false;
    const currentParts = this.data.messages[currentAiMsgIndex].parts;
    for await (let event of stream) {
      if (this.data.chatStatus === 0) {
        return;
      }
      this.toBottom();
      const data = event.json;
      switch (data.type) {
        case "TEXT_MESSAGE_START":
          fullContent = "";
          const textPart = { type: "text", content: fullContent, id: data.messageId };
          currentParts.push(textPart);
          this.setData({
            [`messages[${currentAiMsgIndex}].parts`]: currentParts,
          });
          break;
        case "TEXT_MESSAGE_CONTENT":
          fullContent += data.delta || "";
          this.setData({
            [`messages[${currentAiMsgIndex}].parts[${currentParts.length - 1}].content`]: fullContent,
          });
          break;
        case "TOOL_CALL_START":
          fullContent = "";
          if (String(data.toolCallName || "").toLowerCase() === "archive_contract") {
            archiveForcedByToolCall = true;
          }
          const toolCallPart = {
            type: "tool_call",
            toolCallName: data.toolCallName,
            id: data.toolCallId,
            arguments: fullContent,
            status: "running",
          };
          currentParts.push(toolCallPart);
          this.setData({
            [`messages[${currentAiMsgIndex}].parts`]: currentParts,
          });
          break;
        case "TOOL_CALL_ARGS":
          fullContent += data.delta || "";
          this.setData({
            [`messages[${currentAiMsgIndex}].parts[${currentParts.length - 1}].arguments`]: fullContent,
          });
          break;
        case "TOOL_CALL_RESULT":
          const toolCallId = data.toolCallId;
          const toolCallIndex = currentParts.findIndex(
            (item) => item.id === toolCallId && item.type === "tool_call" && item.status === "running"
          );
          if (toolCallIndex === -1) {
            continue;
          }
          this.setData({
            [`messages[${currentAiMsgIndex}].parts[${toolCallIndex}].status`]: "success",
          });
          this.setData({
            [`messages[${currentAiMsgIndex}].parts[${toolCallIndex}].result`]: data.content,
          });
          break;
        case "RUN_ERROR":
          const agentErrorPart = {
            type: "error",
            content: i18n.t("agent.networkError"),
          };
          currentParts.push(agentErrorPart);
          this.setData({
            [`messages[${currentAiMsgIndex}].parts`]: currentParts,
          });
          return;
        default:
          break;
      }
    }
    const toolCalls = currentParts.filter((part) => part.type === "tool_call" && part.status === "running");
    if (toolCalls.length > 0) {
      const frontendToolsResult = [];
      for (const toolCall of toolCalls) {
        const { toolCallName, arguments: args, id: toolCallId } = toolCall;
        const tool = this.data.agentV2Config.tools.find((item) => item.name === toolCallName);
        try {
          const parsedArgs = args ? JSON.parse(args) : {};
          let toolResult = null;
          if (tool && typeof tool.handler === "function") {
            toolResult = await tool.handler(parsedArgs);
          } else if (typeof this.callFunctionByName === "function") {
            toolResult = await this.callFunctionByName(toolCallName, parsedArgs);
          } else {
            throw new Error(i18n.t("agent.toolNotConfigured", { tool: toolCallName }));
          }
          const toolResultStr = JSON.stringify(toolResult);
          frontendToolsResult.push({
            toolCallId,
            result: toolResultStr,
          });
          this.setData({
            [`messages[${currentAiMsgIndex}].parts[${currentParts.findIndex(
              (item) => item.id === toolCallId
            )}].status`]: "success",
          });
          this.setData({
            [`messages[${currentAiMsgIndex}].parts[${currentParts.findIndex(
              (item) => item.id === toolCallId
            )}].result`]: toolResultStr,
          });
        } catch (e) {
          frontendToolsResult.push({
            toolCallId,
            result: i18n.t("agent.toolCallFailed", { tool: toolCallName, message: e.message }),
          });
          this.setData({
            [`messages[${currentAiMsgIndex}].parts[${currentParts.findIndex(
              (item) => item.id === toolCallId
            )}].status`]: "failed",
          });
          this.setData({
            [`messages[${currentAiMsgIndex}].parts[${currentParts.findIndex(
              (item) => item.id === toolCallId
            )}].result`]: e.message,
          });
        }
      }
      const toolCallMessages = this.handleFrontendToolCallMessage(frontendToolsResult);
      await this.sendMessageV2(toolCallMessages);
      return;
    }
    const assistantContent = currentParts
      .filter((part) => part.type === "text" && part.content)
      .map((part) => part.content)
      .join("\n")
      .trim();
    const currentFeatureKey = this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult";
    if (currentFeatureKey !== "consult" && assistantContent && typeof this.callFunctionByName === "function") {
      const lastUserMessage = [...(this.data.messages || [])].reverse().find((item) => item.role === "user");
      const assistantMessageId = this.data.messages?.[currentAiMsgIndex]?.id || `assistant_${Date.now()}`;
      await this.callFunctionByName("archive_contract", {
        userInput: lastUserMessage?.content || "",
        generatedContent: assistantContent,
        options: {
          forceArchive: archiveForcedByToolCall,
          status: "已生成",
          archiveKey: `v2_${assistantMessageId}`,
        },
      });
    }
  },
};
