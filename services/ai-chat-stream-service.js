const normalizeModel = (model) => {
  if (model === "model-r1") {
    return "default-chat-model";
  }
  if (model === "model-v3") {
    return "default-chat-model";
  }
  return model || "default-chat-model";
};

const compactMessages = (messages) => {
  const list = Array.isArray(messages) ? messages : [];
  const firstSystem = list.find((item) => item?.role === "system");
  const nonSystem = list.filter((item) => item?.role !== "system");
  const recent = nonSystem.slice(-5);
  const normalized = firstSystem ? [firstSystem, ...recent] : recent;
  return normalized.map((item) => ({
    role: item?.role || "user",
    content: String(item?.content || "").slice(0, 80000),
  }));
};

const isFunctionTimeoutError = (err) => {
  const text = `${err?.errMsg || ""}${err?.message || ""}`;
  return err?.errCode === -504003 || err?.errCode === "UPSTREAM_TIMEOUT" || text.includes("FUNCTIONS_TIME_LIMIT_EXCEEDED") || text.includes("timed out") || text.includes("超时");
};

const parseCloudPayload = (payload) => {
  if (!payload) {
    return { success: false, errMsg: "云函数调用失败" };
  }
  if (payload.success === false || payload.ok === false) {
    return {
      success: false,
      statusCode: payload.statusCode,
      errCode: payload.errCode,
      errMsg: payload.message || payload.error || "云函数调用失败",
    };
  }
  const content = payload.content || payload.answer || payload.result || payload.data?.content || "";
  const reasoningContent = payload.reasoningContent || payload.reasoning_content || payload.data?.reasoningContent || "";
  return {
    success: true,
    content,
    reasoningContent,
  };
};

const callCloudFunction = (name, data) =>
  new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data,
      success: (res) => resolve(res?.result || {}),
      fail: (err) => reject(err),
    });
  });

const utf8Decode = (buffer) => {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8").decode(buffer);
  }
  return String.fromCharCode.apply(null, new Uint8Array(buffer)); // Fallback, might not handle multibyte correctly, but TextDecoder is widely supported
};

const invokeFunctionAndParse = async (name, data) => {
  const result = await callCloudFunction(name, data);
  const parsed = parseCloudPayload(result);
  if (!parsed.success) {
    throw {
      ...parsed,
      functionName: name,
    };
  }
  return parsed;
};

const TYPEWRITER_INTERVAL = 22;

const streamByChar = (text, isReasoning, onChunkReceived, onDone, shouldStop) => {
  const value = String(text || "");
  if (!value) {
    onDone && onDone();
    return;
  }
  let index = 0;
  const tick = () => {
    if (shouldStop()) {
      return;
    }
    onChunkReceived && onChunkReceived(value[index], isReasoning);
    index += 1;
    if (index >= value.length) {
      onDone && onDone();
      return;
    }
    setTimeout(tick, TYPEWRITER_INTERVAL);
  };
  tick();
};

const getLastUserQuestion = (messages) => {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === "user" && list[i]?.content) {
      let text = String(list[i].content);
      const matchIndex = text.indexOf("【系统匹配到历史合同】");
      if (matchIndex > 0) {
        text = text.slice(0, matchIndex).trim();
      }
      return text.slice(0, 120);
    }
  }
  return "请描述你的法律问题";
};

const buildTimeoutFallback = (messages) => {
  const question = getLastUserQuestion(messages);
  return `### 临时法律建议\n你咨询的是：**${question}**\n\n当前模型服务拥堵，我先给你一个可执行分析框架：\n\n1. **先确认事实**：时间、地点、行为方式、涉案金额、是否既遂。\n2. **再对照法条**：结合行为性质判断对应罪名与量刑区间。\n3. **最后定策略**：自首、退赃退赔、认罪认罚、谅解等会影响结果。\n\n请补充案件关键事实，我将继续按【法律咨询】给你具体判断。`;
};

const streamChat = ({ messages, model, maxTokens }, onChunkReceived, onDone, onError) => {
  let aborted = false;
  const finalModel = normalizeModel(model);
  const parsedMaxTokens = Number(maxTokens);
  const outputMaxTokens = Number.isFinite(parsedMaxTokens) ? Math.max(256, Math.min(parsedMaxTokens, 8192)) : 8192;
  const requestMessages = compactMessages(messages);
  const shouldStop = () => aborted;
  let requestTask = null;
  const invoke = async () => {
    let lastError = null;
    let hasTimeout = false;
    try {
      let config = null;
      try {
        config = await callCloudFunction("aiChat", { action: "getConfig" });
      } catch (err) {
        throw new Error("获取模型配置失败：" + (err.message || "未知错误"));
      }

      if (shouldStop()) return;

      if (!config || !config.success || !config.apiKey) {
        throw new Error(config?.message || "配置获取失败，未找到API Key");
      }

      const baseURL = config.baseURL || "https://api.deepseek.com/v1/chat/completions";
      const actualModel = config.modelName || finalModel;

      requestTask = wx.request({
        url: baseURL,
        method: "POST",
        header: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        data: {
          model: actualModel,
          messages: requestMessages,
          stream: true,
          max_tokens: outputMaxTokens,
        },
        enableChunked: true,
        success: (res) => {
          if (res.statusCode >= 400) {
            const err = new Error("请求失败，状态码：" + res.statusCode);
            err.statusCode = res.statusCode;
            onError && onError(err);
          } else {
            if (!shouldStop() && onDone && !isDoneCalled) {
              isDoneCalled = true;
              onDone();
            }
          }
        },
        fail: (err) => {
          if (!shouldStop()) {
            onError && onError(err);
          }
        }
      });

      let buffer = "";
      let isDoneCalled = false;
      requestTask.onChunkReceived((response) => {
        if (shouldStop()) {
          requestTask.abort();
          return;
        }
        const text = utf8Decode(response.data);
        buffer += text;
        const lines = buffer.split("\n");
        // Keep the last partial line in buffer
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === "data: [DONE]") {
            if (!shouldStop() && onDone && !isDoneCalled) {
              isDoneCalled = true;
              onDone();
            }
            return;
          }
          if (trimmed.startsWith("data: ")) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const delta = data?.choices?.[0]?.delta || {};
              const reasoningText = delta.reasoning_content;
              const contentText = delta.content;
              
              if (reasoningText) {
                onChunkReceived && onChunkReceived(reasoningText, true);
              }
              if (contentText) {
                onChunkReceived && onChunkReceived(contentText, false);
              }
            } catch (e) {
              console.log("JSON parse error for stream chunk", trimmed);
            }
          }
        }
      });

    } catch (err) {
      if (hasTimeout || isFunctionTimeoutError(err)) {
        const fallback = buildTimeoutFallback(messages);
        streamByChar(fallback, false, onChunkReceived, () => {
          if (!shouldStop() && onDone) {
            onDone();
          }
        }, shouldStop);
        return;
      }
      if (onError) {
        onError(err);
      }
    }
  };
  invoke();
  return {
    abort() {
      aborted = true;
      if (requestTask) {
        requestTask.abort();
      }
    },
  };
};

module.exports = {
  streamChat,
};
