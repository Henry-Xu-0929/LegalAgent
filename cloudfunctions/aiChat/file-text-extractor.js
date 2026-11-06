const fs = require("fs");
const https = require("https");

const MAX_EXTRACT_TEXT_LENGTH = 30000;
const PDF_PARSE_MAX_PAGES = 3;
const OCR_TIMEOUT_MS = 2500;
const DOCX_OCR_MAX_IMAGES = 5;
const DOCX_OCR_PER_IMAGE_MAX_CHARS = 4000;

const getExt = (fileName) => {
  const name = String(fileName || "");
  const idx = name.lastIndexOf(".");
  if (idx < 0) {
    return "";
  }
  return name.slice(idx + 1).toLowerCase();
};
const isImageExt = (ext) => ["jpg", "jpeg", "png", "bmp", "gif", "webp"].includes(ext);
const getMimeByExt = (ext) => {
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  return "image/jpeg";
};

const normalizeText = (text) => String(text || "").replace(/\u0000/g, "").trim().slice(0, MAX_EXTRACT_TEXT_LENGTH);
const isReadableText = (text) => {
  const source = String(text || "");
  if (!source) return false;
  const cleaned = source.replace(/\s+/g, "");
  if (!cleaned) return false;
  const readableChars = cleaned.match(/[\u4e00-\u9fa5A-Za-z0-9，。！？；：、“”‘’【】《》\[\]\(\)\-_/\\@#%&*+=.,:;'"!?]/g) || [];
  return readableChars.length / cleaned.length >= 0.55;
};
const tryDecodeBufferAsText = (buffer) => {
  const utf8 = normalizeText(buffer.toString("utf8"));
  if (isReadableText(utf8)) {
    return utf8;
  }
  const latin1 = normalizeText(buffer.toString("latin1"));
  if (isReadableText(latin1)) {
    return latin1;
  }
  return "";
};
const readDownloadedBuffer = (downloaded) => {
  const tempPath = downloaded?.tempFilePath || "";
  return Buffer.isBuffer(downloaded?.fileContent)
    ? downloaded.fileContent
    : (tempPath ? fs.readFileSync(tempPath) : null);
};
const requestOcrSpace = (params) => new Promise((resolve, reject) => {
  const body = Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key] ?? ""))}`)
    .join("&");
  let finished = false;
  let req = null;
  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    if (req) {
      req.destroy(new Error("OCR_REQUEST_TIMEOUT"));
    } else {
      reject(new Error("OCR_REQUEST_TIMEOUT"));
    }
  }, OCR_TIMEOUT_MS);
  req = https.request("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
  }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(new Error("OCR_RESPONSE_PARSE_FAILED"));
      }
    });
  });
  req.setTimeout(OCR_TIMEOUT_MS, () => req.destroy(new Error("OCR_REQUEST_TIMEOUT")));
  req.on("error", (err) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    reject(err);
  });
  req.write(body);
  req.end();
});
const parseOcrSpaceText = (res) => {
  const parsed = Array.isArray(res?.ParsedResults) ? res.ParsedResults : [];
  const text = parsed.map((item) => String(item?.ParsedText || "")).filter(Boolean).join("\n");
  const compact = normalizeText(text);
  if (compact) {
    return compact;
  }
  const errs = [];
  if (Array.isArray(res?.ErrorMessage)) {
    errs.push(...res.ErrorMessage.map((v) => String(v)));
  } else if (typeof res?.ErrorMessage === "string") {
    errs.push(res.ErrorMessage);
  }
  if (res?.ErrorDetails) {
    errs.push(String(res.ErrorDetails));
  }
  return errs.join(" ").trim();
};
const ocrBuffer = async (buffer, fileName, opts = {}) => {
  const apiKey = process.env.OCR_SPACE_API_KEY || "";
  if (!apiKey) {
    throw new Error("未配置 OCR_SPACE_API_KEY");
  }
  const ext = getExt(fileName) || "jpg";
  const dataUrl = `data:${getMimeByExt(ext)};base64,${buffer.toString("base64")}`;
  const payload = {
    apikey: apiKey,
    language: process.env.OCR_SPACE_LANG || "chs",
    isOverlayRequired: "false",
    detectOrientation: "true",
    OCREngine: process.env.OCR_SPACE_ENGINE || "2",
    scale: "true",
  };
  if (opts.asPdf) {
    payload.base64Image = `data:application/pdf;base64,${buffer.toString("base64")}`;
    payload.filetype = "PDF";
  } else {
    payload.base64Image = dataUrl;
  }
  const res = await requestOcrSpace(payload);
  const output = parseOcrSpaceText(res);
  if (res?.IsErroredOnProcessing && !normalizeText(output)) {
    throw new Error(output || "OCR 处理失败");
  }
  return normalizeText(output);
};
const extractDocxMediaOcrText = async (fileBuffer) => {
  try {
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(fileBuffer);
    const mediaNames = Object.keys(zip.files).filter((filename) => {
      if (!filename.startsWith("word/media/")) return false;
      const ext = getExt(filename);
      return isImageExt(ext);
    }).slice(0, DOCX_OCR_MAX_IMAGES);
    const parts = [];
    for (const filename of mediaNames) {
      const file = zip.file(filename);
      if (!file) continue;
      const imageBuffer = await file.async("nodebuffer");
      try {
        const ocrText = await ocrBuffer(imageBuffer, filename);
        if (ocrText) {
          parts.push(ocrText.slice(0, DOCX_OCR_PER_IMAGE_MAX_CHARS));
        }
      } catch (e) {}
    }
    return normalizeText(parts.join("\n"));
  } catch (e) {
    return "";
  }
};
const extractImageText = async ({ downloaded, fileName }) => {
  const fileBuffer = readDownloadedBuffer(downloaded);
  if (!fileBuffer) {
    return {
      success: false,
      statusCode: 500,
      message: "下载图片失败",
    };
  }
  try {
    const text = await ocrBuffer(fileBuffer, fileName);
    if (!text) {
      return {
        success: false,
        statusCode: 422,
        message: "图片OCR结果为空",
      };
    }
    return {
      success: true,
      text,
    };
  } catch (e) {
    return {
      success: false,
      statusCode: 500,
      message: String(e?.message || "图片OCR失败"),
    };
  }
};

const extractFileText = async ({ downloaded, fileName }) => {
  const ext = getExt(fileName);
  const fileBuffer = readDownloadedBuffer(downloaded);
  if (!fileBuffer) {
    return {
      success: false,
      statusCode: 500,
      message: "下载文件失败",
    };
  }
  let text = "";
  if (["txt", "csv"].includes(ext)) {
    text = fileBuffer.toString("utf8");
  } else if (isImageExt(ext)) {
    try {
      text = await ocrBuffer(fileBuffer, fileName);
    } catch (e) {
      text = "";
    }
  } else if (ext === "docx") {
    let mammothText = "";
    try {
      const mammoth = require("mammoth");
      const res = await mammoth.extractRawText({ buffer: fileBuffer });
      mammothText = res?.value || "";
    } catch (e) {}

    let rawXmlText = "";
    let missingPrefix = "";
    try {
      const JSZip = require("jszip");
      const zip = await JSZip.loadAsync(fileBuffer);
      const extractFromXml = async (filename) => {
        const file = zip.file(filename);
        if (!file) return "";
        const xml = await file.async("string");
        let t = xml.replace(/<\/w:p>/g, "\n");
        t = t.replace(/<[^>]+>/g, "");
        return t;
      };

      let parts = [];
      for (const filename of Object.keys(zip.files)) {
        if (filename.startsWith("word/header") && filename.endsWith(".xml")) {
          parts.push(await extractFromXml(filename));
        }
      }
      parts.push(await extractFromXml("word/document.xml"));
      rawXmlText = parts.join("\n");

      const rawLines = rawXmlText.split("\n").map((l) => l.trim()).filter((l) => l.length > 1);
      const toCheck = rawLines.slice(0, 30);
      const missing = [];
      const compactMammoth = mammothText.replace(/\s+/g, "");
      for (const line of toCheck) {
        const compactLine = line.replace(/\s+/g, "");
        if (compactLine.length > 2 && !compactMammoth.includes(compactLine)) {
          missing.push(line);
        }
      }
      if (missing.length > 0) {
        missingPrefix = missing.join("\n") + "\n\n";
      }
    } catch (e) {
      console.log("jszip docx parse failed", e);
    }

    const mediaOcrText = await extractDocxMediaOcrText(fileBuffer);
    const mainText = mammothText ? (missingPrefix + mammothText) : rawXmlText;
    text = mediaOcrText ? `${mainText}\n\n[文档内图片OCR]\n${mediaOcrText}` : mainText;
  } else if (ext === "pdf") {
    const pdfParse = require("pdf-parse");
    const parsed = await pdfParse(fileBuffer, { max: PDF_PARSE_MAX_PAGES });
    text = parsed?.text || "";
    if (!normalizeText(text)) {
      try {
        const ocrPdfText = await ocrBuffer(fileBuffer, fileName, { asPdf: true });
        if (ocrPdfText) {
          text = ocrPdfText;
        }
      } catch (e) {}
    }
  } else {
    text = tryDecodeBufferAsText(fileBuffer);
  }
  const finalText = normalizeText(text);
  if (!finalText) {
    const fallbackText = tryDecodeBufferAsText(fileBuffer);
    if (fallbackText) {
      return {
        success: true,
        text: fallbackText,
      };
    }
  }
  if (!finalText) {
    return {
      success: false,
      statusCode: 422,
      message: "文件解析结果为空",
    };
  }
  return {
    success: true,
    text: finalText,
  };
};

module.exports = {
  extractFileText,
  extractImageText,
};
