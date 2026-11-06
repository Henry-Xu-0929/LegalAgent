// 本地兜底配置。config/model-config.js 已加入 .gitignore，不随仓库提交；
// 云端下发的配置优先，仅在拿不到云函数配置时使用。
const i18n = require("../utils/i18n");
let localModelConfig = {};
try {
  localModelConfig = require("../config/model-config.js") || {};
} catch (e) {
  console.warn("未找到 config/model-config.js，模型配置将完全依赖云函数下发");
}

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
    return { success: false, errMsg: i18n.t("service.cloudFailed") };
  }
  if (payload.success === false || payload.ok === false) {
    return {
      success: false,
      statusCode: payload.statusCode,
      errCode: payload.errCode,
      errMsg: payload.message || payload.error || i18n.t("service.cloudFailed"),
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

const decodeUtf8Bytes = (bytes) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const b1 = bytes[i];
    if (b1 < 0x80) {
      out += String.fromCharCode(b1);
      continue;
    }
    if ((b1 & 0xe0) === 0xc0) {
      const b2 = bytes[i + 1];
      if (typeof b2 === "undefined") break;
      out += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
      i += 1;
      continue;
    }
    if ((b1 & 0xf0) === 0xe0) {
      const b2 = bytes[i + 1];
      const b3 = bytes[i + 2];
      if (typeof b2 === "undefined" || typeof b3 === "undefined") break;
      out += String.fromCharCode(
        ((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)
      );
      i += 2;
      continue;
    }
    if ((b1 & 0xf8) === 0xf0) {
      const b2 = bytes[i + 1];
      const b3 = bytes[i + 2];
      const b4 = bytes[i + 3];
      if (
        typeof b2 === "undefined" ||
        typeof b3 === "undefined" ||
        typeof b4 === "undefined"
      ) break;
      const codePoint =
        ((b1 & 0x07) << 18) |
        ((b2 & 0x3f) << 12) |
        ((b3 & 0x3f) << 6) |
        (b4 & 0x3f);
      out += String.fromCodePoint(codePoint);
      i += 3;
      continue;
    }
    out += "\ufffd";
  }
  return out;
};

const utf8Decode = (buffer) => {
  try {
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8").decode(buffer);
    }
  } catch (e) {
    console.warn("TextDecoder decode failed, fallback to manual UTF-8 decode");
  }
  return decodeUtf8Bytes(new Uint8Array(buffer));
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
  return i18n.t("service.defaultQuestion");
};

const buildTimeoutFallback = (messages) => {
  const question = getLastUserQuestion(messages);
  return i18n.t("service.timeoutFallback", { question });
};

const streamChat = ({ messages, model, maxTokens }, onChunkReceived, onDone, onError) => {
  let aborted = false;
  const parsedMaxTokens = Number(maxTokens);
  const outputMaxTokens = Number.isFinite(parsedMaxTokens) ? Math.max(256, Math.min(parsedMaxTokens, 8192)) : 8192;
  const requestMessages = compactMessages(messages);
  const shouldStop = () => aborted;
  let requestTask = null;
  const invoke = async () => {
    let hasTimeout = false;
    try {
      let config = null;
      try {
        config = await callCloudFunction("aiChat", { action: "getConfig" });
      } catch (err) {
        console.warn("获取云函数模型配置失败，尝试本地兜底配置：", err?.message || err);
      }

      if (shouldStop()) return;

      // 云端配置优先；云端未下发时回退到本地私有配置文件
      const apiKey = config?.apiKey || localModelConfig.MODEL_API_KEY || "";
      const baseURL =
        config?.baseURL ||
        localModelConfig.MODEL_BASE_URL ||
        "https://api.deepseek.com/v1/chat/completions";
      const actualModel =
        config?.modelName || localModelConfig.MODEL_NAME || normalizeModel(model);

      if (!apiKey) {
        throw new Error(config?.message || i18n.t("service.noApiKey"));
      }

      requestTask = wx.request({
        url: baseURL,
        method: "POST",
        header: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
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
            const err = new Error(i18n.t("service.requestFailedStatus", { n: res.statusCode }));
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
              // 实测 DeepSeek 的 reasoning_content 与 content 分段下发（不同帧），
              // 但协议未承诺这一点。若同帧同时出现，推理分支必须先于正文分支执行：
              // 下游回调为异步，正文回调会快照尚未累加的 reasoningContentText。
              if (delta.reasoning_content) {
                onChunkReceived && onChunkReceived(delta.reasoning_content, true);
              }
              if (delta.content) {
                onChunkReceived && onChunkReceived(delta.content, false);
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
