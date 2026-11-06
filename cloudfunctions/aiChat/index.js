const cloud = require("wx-server-sdk");
const https = require("https");
const { extractFileText, extractImageText } = require("./file-text-extractor");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const REQUEST_TIMEOUT_MS = 45000;

const requestJSON = (url, options, body) =>
  new Promise((resolve, reject) => {
    let finished = false;
    let req = null;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      if (req) {
        req.destroy(new Error("DEEPSEEK_REQUEST_TIMEOUT"));
      } else {
        reject(new Error("DEEPSEEK_REQUEST_TIMEOUT"));
      }
    }, REQUEST_TIMEOUT_MS);

    
    req = https.request(url, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (e) {
          json = null;
        }
        resolve({
          statusCode: res.statusCode,
          data: json,
          raw: text,
        });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("DEEPSEEK_REQUEST_TIMEOUT"));
    });
    req.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });
    req.write(JSON.stringify(body));
    req.end();
  });

exports.main = async (event, context) => {
  const apiKey = process.env.MODEL_API_KEY || process.env.DEEPSEEK_API_KEY || "";
  const baseURL = process.env.MODEL_BASE_URL || "https://api.deepseek.com/v1/chat/completions";
  const defaultModelName = process.env.MODEL_NAME || "deepseek-flash";

  if (event?.action === "getConfig") {
    return {
      success: true,
      apiKey,
      baseURL,
      modelName: defaultModelName
    };
  }

  if (event?.action === "extractFileText") {
    const fileId = event?.fileId || "";
    const fileName = String(event?.fileName || "");
    if (!fileId) {
      return {
        success: false,
        statusCode: 400,
        message: "缺少 fileId",
      };
    }
    try {
      const downloaded = await cloud.downloadFile({ fileID: fileId });
      return await extractFileText({ downloaded, fileName });
    } catch (err) {
      return {
        success: false,
        statusCode: 500,
        message: err?.message || "文件解析失败",
      };
    }
  }

  if (event?.action === "extractImageText") {
    const fileId = event?.fileId || "";
    const fileName = String(event?.fileName || "image.jpg");
    if (!fileId) {
      return {
        success: false,
        statusCode: 400,
        message: "缺少 fileId",
      };
    }
    try {
      const downloaded = await cloud.downloadFile({ fileID: fileId });
      return await extractImageText({ downloaded, fileName });
    } catch (err) {
      return {
        success: false,
        statusCode: 500,
        message: err?.message || "云端图片识别失败",
      };
    }
  }
  
  if (!apiKey) {
    return {
      success: false,
      statusCode: 500,
      message: "未配置模型 API_KEY 环境变量，请在云开发控制台配置 MODEL_API_KEY",
    };
  }
  const model = event?.model || defaultModelName;
  const messages = Array.isArray(event?.messages) ? event.messages : [];
  const eventMaxTokens = Number(event?.maxTokens);
  const maxTokens = Number.isFinite(eventMaxTokens)
    ? Math.max(256, Math.min(eventMaxTokens, 8192))
    : 8192;
  try {
    const res = await requestJSON(
      baseURL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
      {
        model,
        messages,
        stream: false,
        max_tokens: maxTokens,
      }
    );
    if (res.statusCode >= 400) {
      const errorMessage = res.data?.error?.message || res.raw || "请求失败";
      return {
        success: false,
        statusCode: res.statusCode,
        message: errorMessage,
      };
    }
    const choice = res.data?.choices?.[0] || {};
    const message = choice.message || {};
    return {
      success: true,
      content: message.content || "",
      reasoningContent: message.reasoning_content || "",
    };
  } catch (err) {
    if (err?.message === "DEEPSEEK_REQUEST_TIMEOUT") {
      return {
        success: false,
        statusCode: 504,
        errCode: "UPSTREAM_TIMEOUT",
        message: "上游模型响应超时，请稍后重试",
      };
    }
    return {
      success: false,
      statusCode: 500,
      message: err?.message || "调用 DeepSeek 失败",
    };
  }
};
