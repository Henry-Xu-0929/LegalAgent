const fs = require("fs");

const MAX_EXTRACT_TEXT_LENGTH = 30000;
const PDF_PARSE_MAX_PAGES = 3;

const getExt = (fileName) => {
  const name = String(fileName || "");
  const idx = name.lastIndexOf(".");
  if (idx < 0) {
    return "";
  }
  return name.slice(idx + 1).toLowerCase();
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

const extractFileText = async ({ downloaded, fileName }) => {
  const ext = getExt(fileName);
  const tempPath = downloaded?.tempFilePath || "";
  const fileBuffer = Buffer.isBuffer(downloaded?.fileContent)
    ? downloaded.fileContent
    : (tempPath ? fs.readFileSync(tempPath) : null);
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
      
      const rawLines = rawXmlText.split("\n").map(l => l.trim()).filter(l => l.length > 1);
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

    text = mammothText ? (missingPrefix + mammothText) : rawXmlText;
  } else if (ext === "pdf") {
    const pdfParse = require("pdf-parse");
    const parsed = await pdfParse(fileBuffer, { max: PDF_PARSE_MAX_PAGES });
    text = parsed?.text || "";
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
};
