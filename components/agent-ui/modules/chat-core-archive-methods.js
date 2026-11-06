const i18n = require("../../../utils/i18n");
const { getCloudInstance } = require("../tools");

module.exports = {
  callContractCloud: function (action, data) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: "contract",
        data: {
          action,
          ...data,
        },
        success: (res) => {
          const payload = res?.result || {};
          if (payload.ok) {
            resolve(payload);
            return;
          }
          reject(new Error(payload.error || "合同处理失败"));
        },
        fail: (err) => {
          reject(err);
        },
      });
    });
  },
  saveContractFallback: function (payload) {
    const content = String(payload?.content || "").trim();
    if (!content) {
      return Promise.resolve({ ok: false, id: "" });
    }
    const now = Date.now();
    const keywords = Array.isArray(payload?.keywords) ? payload.keywords.slice(0, 12) : [];
    const normalized = {
      title: String(payload?.title || `法律文件草案-${now}`).trim().slice(0, 80),
      category: String(payload?.category || "案件卷宗").trim(),
      sourceType: String(payload?.sourceType || "generated").trim(),
      docType: String(payload?.docType || "").trim(),
      caseKey: String(payload?.caseKey || "").trim(),
      caseTitle: String(payload?.caseTitle || "").trim(),
      party: String(payload?.party || "").trim(),
      status: String(payload?.status || "已生成").trim(),
      summary: String(payload?.summary || content).trim().slice(0, 220),
      content: content.slice(0, 80000),
      keywords,
      fileName: String(payload?.fileName || "").trim(),
      fileType: String(payload?.fileType || "").trim(),
      createdAt: now,
      updatedAt: now,
    };
    const searchableText = [
      normalized.title,
      normalized.category,
      normalized.docType,
      normalized.caseTitle,
      normalized.caseKey,
      normalized.sourceType,
      normalized.status,
      normalized.summary,
      normalized.content,
      normalized.fileName,
      normalized.fileType,
      keywords.join(" "),
    ].join("\n").slice(0, 120000);
    return wx.cloud.database().collection("contracts").add({
      data: {
        ...normalized,
        searchableText,
      },
    });
  },
  persistContractArchive: async function (payload) {
    try {
      const result = await this.callContractCloud("saveFromChat", { payload });
      return {
        ok: true,
        id: result?.data?.id || payload?.id || "",
        error: "",
      };
    } catch (error) {
      try {
        const saveRes = await this.saveContractFallback(payload);
        return {
          ok: true,
          id: saveRes?._id || payload?.id || "",
          error: "",
        };
      } catch (fallbackError) {
        console.log("persistContractArchive failed", error, fallbackError);
        return {
          ok: false,
          id: "",
          error: (fallbackError && (fallbackError.message || fallbackError.errMsg)) || (error && (error.message || error.errMsg)) || "合同归档失败",
        };
      }
    }
  },
  normalizeFunctionArgs: function (rawArgs) {
    if (!rawArgs) {
      return {};
    }
    if (typeof rawArgs === "string") {
      try {
        return JSON.parse(rawArgs);
      } catch (e) {
        return {};
      }
    }
    if (typeof rawArgs === "object") {
      return rawArgs;
    }
    return {};
  },
  appendArchiveTrace: function (traceItem) {
    try {
      const key = "contract_archive_trace";
      const oldList = wx.getStorageSync(key);
      const list = Array.isArray(oldList) ? oldList : [];
      const next = [
        {
          time: Date.now(),
          chatMode: this.data.chatMode || "",
          ...traceItem,
        },
        ...list,
      ].slice(0, 30);
      wx.setStorageSync(key, next);
    } catch (e) {
      console.log("appendArchiveTrace failed", e);
    }
  },
  callFunctionByName: async function (name, rawArgs) {
    const functionName = String(name || "").trim().toLowerCase();
    const args = this.normalizeFunctionArgs(rawArgs);
    if (functionName === "archive_contract") {
      const options = {
        ...(args.options || {}),
      };
      const result = await this.archiveGeneratedContract(
        args.userInput || "",
        args.generatedContent || "",
        options
      );
      this.appendArchiveTrace({
        functionName,
        ok: !!result?.ok,
        id: result?.id || "",
        error: result?.error || "",
      });
      return result;
    }
    const failed = { ok: false, id: "", error: `unsupported function: ${functionName}` };
    this.appendArchiveTrace({
      functionName,
      ok: false,
      id: "",
      error: failed.error,
    });
    return failed;
  },
  escapeWordHtml: function (value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  },
  sanitizeContractPresentationContent: function (value) {
    let text = String(value || "").replace(/\r\n/g, "\n");
    text = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/```[\w-]*\n?/g, "").replace(/```/g, ""));
    text = text
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/_(.*?)_/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/\|/g, " ");
    let lines = text.split("\n").map((line) => line.trim());

    const introPattern = /我将为您|已为您|下面为您|以下为您|以下是|根据您的|重新生成|更精简|草案如下|建议稿|模板如下|请参考|供参考|需要确认.*信息|需要先澄清|需要补充|合同起草前需澄清的事实/;
    const contractStartPattern = /合同编号|甲方[:：]|乙方[:：]|出租方[:：]|承租方[:：]|买方[:：]|卖方[:：]|第[一二三四五六七八九十]+条|[一二三四五六七八九十]+、|租赁期限|违约责任|争议解决|签订日期|签订地点|^.{0,24}合同$|^.{0,24}协议$/;

    let contractStartIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (contractStartPattern.test(lines[i]) && !introPattern.test(lines[i])) {
        if (!/是什么|是哪家|怎么填|具体是|多少|是否|谁处理|怎么处理|待确认|需要您补充/.test(lines[i])) {
          contractStartIndex = i;
          break;
        }
      }
    }

    if (contractStartIndex > 0) {
      let titleIndex = contractStartIndex;
      for (let i = contractStartIndex - 1; i >= Math.max(0, contractStartIndex - 3); i--) {
        if (/.{2,30}(合同|协议|书|草案|意向)$/.test(lines[i]) && !/提供|起草|以下|为您/.test(lines[i])) {
          titleIndex = i;
        }
      }
      lines = lines.slice(titleIndex);
    } else {
      let dropCount = 0;
      for (let i = 0; i < lines.length; i++) {
        if (introPattern.test(lines[i]) || /待确认|需要补充|是否还有|由谁|请确认|请问|如下问题/.test(lines[i])) {
          dropCount = i + 1;
        } else if (lines[i].length > 15 && !/待确认|需要补充/.test(lines[i])) {
          break;
        }
      }
      if (dropCount > 0) {
        lines = lines.slice(dropCount);
      }
    }

    const riskStartIndex = lines.findIndex((line) =>
      /核心风险提示|签约前必须核实|关键条款建议|法律要点|风险提示|特别提醒|免责声明|温馨提示|以上是为你草拟的|如果需要进一步修改|待确认|待补充|以上就是|如果有任何修改意见|是否还有其他|您看这样/.test(line)
    );
    const sigIndexes = lines
      .map((line, index) => (/甲方.{0,12}(签名|签章|签字|盖章)|乙方.{0,12}(签名|签章|签字|盖章)/.test(line) ? index : -1))
      .filter((index) => index >= 0);
    let endIndex = lines.length;
    if (sigIndexes.length) {
      endIndex = sigIndexes[sigIndexes.length - 1] + 1;
      for (let i = endIndex; i < Math.min(lines.length, endIndex + 3); i++) {
        if (/日期|年|月|日|\d{4}[-/.年]\d{1,2}/.test(lines[i])) {
          endIndex = i + 1;
        }
      }
    } else if (riskStartIndex >= 0) {
      endIndex = riskStartIndex;
    }
    const picked = lines.slice(0, endIndex);
    const compact = [];
    let lastBlank = false;
    picked.forEach((line) => {
      const normalized = line.replace(/\s+/g, " ").trim();
      if (!normalized) {
        if (!lastBlank) {
          compact.push("");
        }
        lastBlank = true;
        return;
      }
      compact.push(normalized);
      lastBlank = false;
    });
    return compact.join("\n").trim();
  },
  shouldBufferBrokenWordLine: function (line = "") {
    const text = String(line || "").trim();
    if (!text) {
      return false;
    }
    if (/^[-—_]{2,}$/.test(text)) {
      return false;
    }
    if (/^(?:第[一二三四五六七八九十百0-9]+条|[一二三四五六七八九十]+、|[（(][一二三四五六七八九十0-9]+[）)])/.test(text)) {
      return false;
    }
    if (/^(?:甲方|乙方|丙方|出租方|承租方|买方|卖方|委托方|受托方|用人单位|劳动者|法定代表人|授权代表|签订地点|签订日期|日期)\s*[：:]/.test(text)) {
      return false;
    }
    if (/[：:；;，,。.!！?？]$/.test(text)) {
      return false;
    }
    return text.length <= 4 && /^[\u4e00-\u9fa5（）()A-Za-z]+$/.test(text);
  },
  mergeBrokenWordLines: function (lines = []) {
    const merged = [];
    let buffer = "";
    const flushBuffer = () => {
      if (buffer) {
        merged.push(buffer);
        buffer = "";
      }
    };
    (Array.isArray(lines) ? lines : []).forEach((item) => {
      const text = String(item || "").replace(/\s+/g, " ").trim();
      if (!text) {
        flushBuffer();
        return;
      }
      if (this.shouldBufferBrokenWordLine(text)) {
        buffer += text;
        return;
      }
      if (buffer) {
        merged.push(`${buffer}${text}`.trim());
        buffer = "";
        return;
      }
      merged.push(text);
    });
    flushBuffer();
    return merged;
  },
  normalizeWordExportLayout: function (content, title = "") {
    let text = this.sanitizeContractPresentationContent(content) || String(content || "").trim();
    if (!text) {
      return "";
    }
    text = text
      .replace(/\t+/g, " ")
      .replace(/\u00A0/g, " ")
      .replace(/([^\n])((?:第[一二三四五六七八九十百0-9]+条))/g, "$1\n$2")
      .replace(/([^\n])((?:[一二三四五六七八九十]+、))/g, "$1\n$2")
      .replace(/([^\n])([（(][一二三四五六七八九十0-9]+[）)])/g, "$1\n$2")
      .replace(/([^\n])((?:甲方|乙方|丙方|出租方|承租方|买方|卖方|委托方|受托方|用人单位|劳动者|法定代表人|授权代表|地址|电话|联系人|身份证号|统一社会信用代码|开户行|账号|签订地点|签订日期|日期)\s*[：:])/g, "$1\n$2")
      .replace(/([^\n])((?:（以下为签署页）|以下为签署页|签署页|签字页|盖章页))/g, "$1\n$2")
      .replace(/[ \u3000]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const titleText = String(title || "").trim();
    const lines = this.mergeBrokenWordLines(text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line, index) => !!line || (index > 0 && index < text.length - 1)));
    if (titleText && lines.length && lines[0] === titleText) {
      lines.shift();
    }
    return lines.join("\n").trim();
  },
  buildWordLineHtml: function (line, title = "") {
    const text = String(line || "").trim();
    if (!text) {
      return "<p class=\"spacer\">&nbsp;</p>";
    }
    const safe = this.escapeWordHtml(text);
    if (title && text === title) {
      return "";
    }
    if (/^[-—_]{3,}$/.test(text)) {
      return "<div class=\"divider\"></div>";
    }
    if (/^(?:（以下为签署页）|以下为签署页|签署页|签字页|盖章页)$/.test(text)) {
      return `<p class="sign-title">${safe}</p>`;
    }
    if (/^第[一二三四五六七八九十百0-9]+条/.test(text)) {
      return `<p class="clause">${safe}</p>`;
    }
    if (/^(?:[一二三四五六七八九十]+、|[（(][一二三四五六七八九十0-9]+[）)])/.test(text)) {
      return `<p class="section">${safe}</p>`;
    }
    if (/^(?:甲方|乙方|丙方|出租方|承租方|买方|卖方|委托方|受托方|用人单位|劳动者|法定代表人|授权代表|地址|电话|联系人|身份证号|统一社会信用代码|开户行|账号|签订地点|签订日期|日期)\s*[：:]/.test(text)) {
      return `<p class="party">${safe}</p>`;
    }
    if (text.length <= 28 && /(?:合同|协议|补充协议|意向书|确认书|承诺书|授权书|说明书)$/.test(text)) {
      return `<p class="sub-title">${safe}</p>`;
    }
    return `<p class="body">${safe}</p>`;
  },
  buildWordContent: function (title, content) {
    const safeTitle = this.escapeWordHtml(title);
    const layoutContent = this.normalizeWordExportLayout(content, title);
    const bodyHtml = (layoutContent ? layoutContent.split("\n") : ["暂无内容"])
      .map((line) => this.buildWordLineHtml(line, title))
      .filter(Boolean)
      .join("");
    return [
      "<html>",
      "<head>",
      "<meta charset=\"utf-8\" />",
      "<style>",
      "html,body{margin:0;padding:0;background:#fff;color:#111;font-family:'SimSun','Songti SC',serif;}",
      "body{font-size:12pt;line-height:1.9;}",
      ".page{padding:28mm 24mm 26mm;box-sizing:border-box;}",
      ".title{margin:0 0 20pt;text-align:center;font-size:22pt;font-weight:700;letter-spacing:1.5pt;}",
      ".sub-title{margin:12pt 0 8pt;text-align:center;font-size:14pt;font-weight:700;}",
      ".body,.party,.clause,.section,.sign-title{margin:0 0 8pt;white-space:pre-wrap;word-break:break-word;}",
      ".body{text-indent:2em;text-align:justify;}",
      ".party{text-indent:0;}",
      ".clause{font-weight:700;text-indent:0;margin-top:10pt;}",
      ".section{font-weight:700;text-indent:0;margin-top:8pt;}",
      ".sign-title{text-align:center;font-size:14pt;font-weight:700;margin:20pt 0 14pt;}",
      ".divider{height:1px;background:#d9dce3;margin:18pt 0;}",
      ".spacer{height:12pt;margin:0;}",
      "</style>",
      "</head>",
      "<body>",
      "<div class=\"page\">",
      `<div class="title">${safeTitle}</div>`,
      bodyHtml,
      "</div>",
      "</body>",
      "</html>",
    ].join("");
  },
  uploadGeneratedContractWord: async function (title, content) {
    const fullContent = this.sanitizeContractPresentationContent(content) || String(content || "").trim();
    if (!fullContent) {
      return { fileId: "", fileName: "", fileType: "" };
    }
    const cleanTitle = String(title || "合同草案")
      .replace(/[\\/:*?"<>|\r\n]/g, " ")
      .trim()
      .slice(0, 28) || "合同草案";
    const now = Date.now();
    const fileName = `${cleanTitle}-${now}.doc`;
    const localPath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    const html = this.buildWordContent(cleanTitle, fullContent);
    const fs = wx.getFileSystemManager();
    fs.writeFileSync(localPath, `\uFEFF${html}`, "utf8");
    const cloudPath = `contracts/generated/${now}_${Math.floor(Math.random() * 100000)}.doc`;
    const cloudInstance = await getCloudInstance(this.data.envShareConfig);
    const fileId = await new Promise((resolve, reject) => {
      cloudInstance.uploadFile({
        cloudPath,
        filePath: localPath,
        success: (res) => resolve(res?.fileID || ""),
        fail: (err) => reject(err),
      });
    });
    try {
      fs.unlinkSync(localPath);
    } catch (e) {
      console.log("remove temp word failed", e);
    }
    return {
      fileId,
      fileName,
      fileType: "doc",
    };
  },
  inferContractCategory: function () {
    const featureKey = this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult";
    if (featureKey === "draft") {
      return "合同起草";
    }
    if (featureKey === "review") {
      return "合同审查";
    }
    if (featureKey === "evidence") {
      return "证据材料";
    }
    if (featureKey === "document") {
      return "法律文书";
    }
    if (featureKey === "analysis") {
      return "对话分析";
    }
    return "案件卷宗";
  },
  inferArchiveDocType: function (fileName, inputText = "") {
    const lowerFileName = String(fileName || "").toLowerCase();
    const rawText = `${fileName || ""} ${inputText || ""}`;
    if (/(起诉状|答辩状|申请书|律师函|法律意见书|仲裁申请|再审申请)/.test(rawText)) {
      return "法律文书";
    }
    if (/(聊天记录|录音|转账|发票|收据|凭证|病历|影像)/.test(rawText) || /\.(png|jpg|jpeg|mp3|mp4|wav|pdf)$/.test(lowerFileName)) {
      return "证据材料";
    }
    if (/(合同|协议|补充协议|意向书)/.test(rawText)) {
      return "合同文件";
    }
    return "通用文件";
  },
  cleanGeneratedArchiveTitleLine: function (value) {
    let text = String(value || "")
      .replace(/^#+\s*/, "")
      .replace(/^[\-\*\u2022]+/, "")
      .replace(/^[（(]?[一二三四五六七八九十0-9]+[）)]?[、.．\s]*/, "")
      .replace(/^[0-9]+\.[\s]*/, "")
      .replace(/\s+/g, " ")
      .trim();
    text = text
      .replace(/^(?:本案|本合同|本次|以下|如下)(?:的)?/, "")
      .replace(/^(?:关于|针对|就|对)\s*/, "")
      .trim();
    return text;
  },
  extractGeneratedArchiveFocusTags: function (content) {
    const text = String(content || "").slice(0, 6000);
    if (!text) {
      return [];
    }
    const rules = [
      { pattern: /根本违约/, label: "根本违约" },
      { pattern: /解除(?:合同)?通知|解约通知/, label: "解约通知效力" },
      { pattern: /继续履行/, label: "继续履行" },
      { pattern: /定金/, label: "定金" },
      { pattern: /违约金/, label: "违约金" },
      { pattern: /赔偿/, label: "赔偿责任" },
      { pattern: /合同效力/, label: "合同效力" },
      { pattern: /付款|房款/, label: "付款义务" },
      { pattern: /转售|转卖/, label: "转售争议" },
      { pattern: /过户/, label: "过户义务" },
      { pattern: /举证责任/, label: "举证责任" },
      { pattern: /诉讼时效/, label: "诉讼时效" },
      { pattern: /管辖/, label: "管辖争议" },
      { pattern: /风险提示|风险点/, label: "风险提示" },
      { pattern: /修改建议|修订建议/, label: "修改建议" },
      { pattern: /审查意见/, label: "审查意见" },
    ];
    const result = [];
    rules.forEach(({ pattern, label }) => {
      if (pattern.test(text) && !result.includes(label)) {
        result.push(label);
      }
    });
    return result.slice(0, 3);
  },
  inferGeneratedArchiveTitleKind: function (userInput, content, category) {
    const text = `${userInput || ""}\n${content || ""}\n${category || ""}`;
    if (/争议焦点/.test(text)) {
      return "争议焦点梳理";
    }
    if (/(法律意见书|法律意见|律师意见)/.test(text)) {
      return "法律意见";
    }
    if (/代理词/.test(text)) {
      return "代理词";
    }
    if (/质证意见/.test(text)) {
      return "质证意见";
    }
    if (/答辩状/.test(text)) {
      return "答辩状草稿";
    }
    if (/起诉状/.test(text)) {
      return "起诉状草稿";
    }
    if (/律师函/.test(text)) {
      return "律师函草稿";
    }
    if (/申请书|仲裁申请/.test(text)) {
      return "申请书草稿";
    }
    if (/审查意见|修改建议|风险提示/.test(text) || category === "合同审查") {
      return "审查意见";
    }
    if (/合同|协议/.test(text) || category === "合同起草") {
      return "合同草案";
    }
    if (category === "证据材料") {
      return "证据整理";
    }
    return "法律分析";
  },
  isArchiveVersionReferenceIntent: function (queryText) {
    const query = String(queryText || "");
    return /(第[0-9一二三四五六七八九十百]+版|上一版|前一版|首版|初版|原版)/.test(query);
  },
  normalizeGeneratedArchiveBaseTitle: function (value) {
    let title = String(value || "")
      .replace(/[\\/:*?"<>|\r\n]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    title = title.replace(/(?:[-（(]\s*)?第[0-9一二三四五六七八九十百]+版(?:\s*[)）])?$/g, "").trim();
    return title.slice(0, 48);
  },
  shouldContinueGeneratedArchiveVersion: function (queryText, archiveItem = {}) {
    const sourceType = String(archiveItem?.sourceType || "generated").trim();
    const hasBaseArchive = !!(archiveItem?.id || archiveItem?.contractGroupKey || archiveItem?.title);
    if (!hasBaseArchive) {
      return false;
    }
    if (sourceType && sourceType !== "generated") {
      return false;
    }
    return this.isArchiveVersionReferenceIntent(queryText) || this.isArchiveRewriteIntent(queryText);
  },
  resolveGeneratedArchiveTitle: function (userInput, content, caseContext = {}, category = "", options = {}) {
    const baseTitle = this.normalizeGeneratedArchiveBaseTitle(options.baseArchiveTitle || "");
    if (
      baseTitle &&
      (
        options.forceBaseTitle ||
        this.shouldContinueGeneratedArchiveVersion(userInput, {
          id: options.baseArchiveId || "",
          contractGroupKey: options.contractGroupKey || "",
          title: baseTitle,
          sourceType: options.baseArchiveSourceType || "generated",
        })
      )
    ) {
      return baseTitle;
    }
    return this.buildGeneratedArchiveTitle(userInput, content, caseContext, category);
  },
  buildGeneratedArchiveTitle: function (userInput, content, caseContext = {}, category = "") {
    const normalizedContent = String(content || "").trim();
    const resolvedCaseContext = this.resolveCaseContext(`${userInput || ""}\n${normalizedContent}`, caseContext || {});
    const caseTitle = this.cleanCaseTitleCandidate(resolvedCaseContext?.caseTitle || caseContext?.caseTitle || "");
    const titleKind = this.inferGeneratedArchiveTitleKind(userInput, normalizedContent, category);
    const lines = normalizedContent
      .split("\n")
      .map((item) => this.cleanGeneratedArchiveTitleLine(item))
      .filter((item) => item.length >= 4);
    const firstMeaningfulLine = lines.find((item) => (
      !/^(?:事实与理由|请求事项|申请事项|争议焦点|核心争议焦点|法律依据|代理意见|法律意见|审查意见|修改建议|风险提示|综上所述)$/.test(item)
    )) || "";
    const fallbackCaseTitle = firstMeaningfulLine
      ? this.cleanCaseTitleCandidate(firstMeaningfulLine.replace(/[：:。！？；].*$/, "").trim())
      : "";
    const baseCaseTitle = caseTitle || fallbackCaseTitle || "未命名案件";
    let title = `${baseCaseTitle}-${titleKind}`;
    title = title
      .replace(/[\\/:*?"<>|\r\n]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return title.slice(0, 48) || `${category || "法律文件"}-${Date.now()}`;
  },
  isContractLikeArchiveRecord: function (item = {}) {
    const category = String(item?.category || "");
    const docType = String(item?.docType || "");
    const title = String(item?.title || "");
    return /(合同|协议|补充协议|意向书|合同起草|合同审查)/.test(`${category} ${docType} ${title}`);
  },
  isLikelyLegalDocumentBody: function (value) {
    const text = String(value || "").trim();
    if (!text || text.length < 80) {
      return false;
    }
    if (/^你好.*顾问/.test(text) || /^请问.*帮助/.test(text) || /常见咨询场景/.test(text)) {
      return false;
    }
    const hasDocTitle = /(?:民事起诉状|答辩状|申请书|律师函|法律意见书|代理词|质证意见|情况说明|答复函|仲裁申请书)/.test(text);
    const hasBodyStructure =
      /事实与理由|请求事项|申请事项|审查意见|法律依据|代理意见|综上所述|此致|敬礼|致[:：]|人民法院|仲裁委员会/.test(text);
    const hasLegalTerms =
      /依据《|根据《|中华人民共和国|民法典|民事诉讼法|合同法|证据|原告|被告|申请人|被申请人/.test(text);
    const hasMarkdownStructure = /^#\s*.+/m.test(text) || /^##\s*.+/m.test(text);
    let score = 0;
    if (hasDocTitle) score += 2;
    if (hasBodyStructure) score += 2;
    if (hasLegalTerms) score += 1;
    if (hasMarkdownStructure) score += 1;
    return score >= 3;
  },
  isLikelyArchivableGeneratedDocument: function (value, options = {}) {
    const text = String(value || "").trim();
    if (!text) {
      return false;
    }
    if (this.isLikelyContractBody(text)) {
      return true;
    }
    const featureKey = String(options.featureKey || this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "");
    if (featureKey === "document" || featureKey === "analysis" || featureKey === "evidence") {
      return this.isLikelyLegalDocumentBody(text);
    }
    return this.isLikelyLegalDocumentBody(text);
  },
  computeArchiveCategoryAffinityScore: function (item, queryText) {
    const featureKey = this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult";
    const query = String(queryText || "");
    const category = String(item?.category || "");
    const docType = String(item?.docType || "");
    const text = `${category}\n${docType}`;
    const isContractLike = this.isContractLikeArchiveRecord(item);
    const isLegalDocLike = /(法律文书|起诉状|答辩状|申请书|律师函|法律意见书|代理词|质证意见)/.test(text);
    if ((featureKey === "draft" || featureKey === "review") && isContractLike) {
      return 12;
    }
    if (featureKey === "document" && isLegalDocLike) {
      return 12;
    }
    if (/(合同|协议|补充协议|审查|起草)/.test(query) && isContractLike) {
      return 8;
    }
    if (/(法律文书|律师意见|法律意见|起诉状|答辩状|申请书|律师函|代理词)/.test(query) && isLegalDocLike) {
      return 8;
    }
    return 0;
  },
  extractArchivePartyTokens: function (queryText) {
    const query = String(queryText || "").trim();
    if (!query) {
      return [];
    }
    const result = [];
    const seen = {};
    const normalizeSource = (value) => String(value || "")
      .replace(/(?:请|帮我|麻烦|需要|想要|调出|调用|读取|找出|找到|定位|检索|匹配|搜索|恢复|引用|使用|基于|根据|结合|参照|依据|围绕|针对|关于|对于|把|将|原来|原先|之前|再次|重新|继续|那个|这个|该|这份|那份|上述|前述|一下|一版|版本|基础上)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const put = (value) => {
      const cleaned = String(value || "")
        .trim()
        .replace(/^(?:请|帮我|麻烦|需要|想要|调出|调用|读取|找出|找到|定位|检索|匹配|搜索|恢复|引用|使用|当事人|代理律师|代理人|委托人|我是|本人是|针对|关于|对于|围绕|基于|根据|结合|参照|依据|把|将)+/, "")
        .replace(/(?:先生|女士|老师|同学|案件|案子|一案|纠纷|代理律师|代理人|委托代理人)$/g, "")
        .trim();
      const token = this.normalizeRetrievalToken(cleaned);
      if (!token || token.length < 2 || token.length > 16 || this.isLowValueRetrievalToken(token) || seen[token]) {
        return;
      }
      seen[token] = true;
      result.push(token);
    };
    const patterns = [
      /(?:针对|关于|对于|围绕|基于)\s*([\u4e00-\u9fa5·]{2,8})(?:的)?(?:案件|案子|纠纷|一案)/g,
      /([\u4e00-\u9fa5·]{2,8})(?:的)?(?:代理律师|代理人|委托代理人|当事人)/g,
      /(?:原告|被告|申请人|被申请人|上诉人|被上诉人|委托人|客户)\s*[:：]?\s*([\u4e00-\u9fa5·A-Za-z0-9]{2,16})/g,
      /([\u4e00-\u9fa5·]{2,8})(?:先生|女士)?(?:一案|案件|案子|纠纷)/g,
      /(?:请|帮我|麻烦|调出|调用|读取|找出|找到|定位|检索|匹配|搜索|恢复|引用|使用)?\s*([\u4e00-\u9fa5·]{2,8})(?:的)?(?:案件|案子|纠纷|一案|项目)/g,
    ];
    [query, normalizeSource(query)].forEach((source) => {
      patterns.forEach((pattern) => {
        let match = pattern.exec(source);
        while (match) {
          put(match[1] || "");
          if (match[2]) {
            put(match[2]);
            put(`${match[1] || ""}诉${match[2] || ""}`);
          }
          match = pattern.exec(source);
        }
      });
    });
    return result.slice(0, 12);
  },
  extractArchiveReferenceTokens: function (queryText) {
    const query = String(queryText || "").trim();
    if (!query) {
      return [];
    }
    const actionPattern = /(请|帮我|麻烦|需要|想要|调出|调用|读取|找出|找到|定位|检索|匹配|搜索|恢复|引用|使用|生成|起草|撰写|草拟|出具|整理|总结|归纳|分析|审查|审阅|阅卷|根据|基于|结合|参照|依据|针对|关于|对于|围绕|原来|原先|之前|再次|重新|继续|那个|这个|该|这份|那份|上述|前述|基础上|一版|版本|一下)/;
    const tokens = this.extractRetrievalTokens(query, {
      includeNgrams: false,
      minLength: 2,
      maxLength: 16,
      maxTokens: 24,
      preferLonger: true,
    });
    return tokens
      .filter((token) => token && !actionPattern.test(token) && !this.isLowValueRetrievalToken(token))
      .slice(0, 12);
  },
  extractArchiveDocIntentTokens: function (queryText) {
    const query = String(queryText || "");
    const result = [];
    const seen = {};
    const put = (value) => {
      const token = String(value || "").trim();
      if (!token || seen[token]) {
        return;
      }
      seen[token] = true;
      result.push(token);
    };
    if (/(律师意见|意见书|法律意见)/.test(query)) {
      ["律师意见", "律师意见书", "法律意见", "法律意见书"].forEach(put);
    }
    if (/起诉状/.test(query)) {
      ["起诉状", "民事起诉状"].forEach(put);
    }
    if (/答辩状/.test(query)) {
      ["答辩状", "民事答辩状"].forEach(put);
    }
    if (/申请书|仲裁申请/.test(query)) {
      ["申请书", "仲裁申请书"].forEach(put);
    }
    if (/律师函|函件|答复函/.test(query)) {
      ["律师函", "答复函"].forEach(put);
    }
    if (/卷宗|案卷|案件材料|归档材料|证据材料/.test(query)) {
      ["卷宗", "案卷", "案件材料", "证据材料"].forEach(put);
    }
    return result.slice(0, 12);
  },
  computeArchiveDocIntentScore: function (item, queryText) {
    const query = String(queryText || "");
    const title = String(item?.title || "");
    const summary = String(item?.summary || "");
    const caseTitle = String(item?.caseTitle || "");
    const docType = String(item?.docType || "");
    const category = String(item?.category || "");
    const party = String(item?.party || "");
    const fileName = String(item?.fileName || "");
    const sourceType = String(item?.sourceType || "");
    const text = `${title}\n${summary}\n${caseTitle}\n${docType}\n${category}\n${party}\n${fileName}`;
    const isLegalOpinion = /(律师意见|律师意见书|法律意见|法律意见书)/.test(text);
    const isCaseMaterial = /(卷宗|案卷|证据材料|案件材料|证据目录|证据清单)/.test(text);
    const isLegalDocLike = /(法律文书|起诉状|答辩状|申请书|律师函|法律意见书|代理词|质证意见)/.test(text);
    let score = 0;
    if (/(律师意见|意见书|法律意见)/.test(query) && isLegalOpinion) {
      score += 18;
    }
    if (/(卷宗|案卷|案件材料|证据材料)/.test(query) && isCaseMaterial) {
      score += 14;
    }
    if (/(起诉状|答辩状|申请书|律师函|代理词|质证意见)/.test(query) && isLegalDocLike) {
      score += 12;
    }
    if (/(再写|重写|改写|优化|完善|修改|润色|升级|迭代)/.test(query) && sourceType === "generated" && (isLegalOpinion || isLegalDocLike)) {
      score += 8;
    }
    if (/(根据|基于|结合|参照|依据)/.test(query) && sourceType === "upload" && isCaseMaterial) {
      score += 6;
    }
    return score;
  },
  isArchiveRewriteIntent: function (queryText) {
    const query = String(queryText || "");
    return /(再写|重写|改写|优化|再优化|再次优化|完善|修改|润色|升级|迭代|重做)/.test(query);
  },
  normalizeCaseKey: function (rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) {
      return "";
    }
    return value
      .replace(/[【】\[\]（）()]/g, "")
      .replace(/\s+/g, "")
      .slice(0, 48);
  },
  cleanCaseTitleCandidate: function (rawValue) {
    let value = String(rawValue || "").trim();
    if (!value) {
      return "";
    }
    value = value
      .replace(/^(?:文件名[:：]?|案件名称[:：]?|案件[:：]?|项目[:：]?|客户[:：]?)/, "")
      .replace(/^(?:我是|我们是|本人是|本人系|我是做|我是负责|作为|关于|针对|对于|请就|请根据|请基于|帮我|麻烦|需要|请你|请帮我)+/, "")
      .trim();
    const suitTitleMatch = value.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,20}诉[\u4e00-\u9fa5A-Za-z0-9]{2,20}[\u4e00-\u9fa5A-Za-z0-9]{0,24}?(?:纠纷案|纠纷|案件)/);
    if (suitTitleMatch?.[0]) {
      value = suitTitleMatch[0];
    }
    value = value
      .replace(/(?:中的?|一案中|一案里|案件中|案件里).{0,20}$/, "")
      .replace(/(?:代理律师|代理人|律师|法务|当事人|原告|被告|申请人|被申请人).{0,20}$/, "")
      .replace(/(?:请阅卷|请审查|请分析|请起草|请生成).{0,20}$/, "")
      .trim();
    return value.slice(0, 40);
  },
  buildCaseTitleFragments: function (rawValue) {
    const title = this.cleanCaseTitleCandidate(rawValue);
    if (!title) {
      return [];
    }
    const seen = {};
    const result = [];
    const put = (value) => {
      const token = this.normalizeRetrievalToken(value);
      if (!token || token.length < 2 || seen[token]) {
        return;
      }
      seen[token] = true;
      result.push(token);
    };
    put(title);
    put(title.replace(/(?:纠纷案|纠纷|案件|一案)$/g, ""));
    const suitMatch = title.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,20})诉([\u4e00-\u9fa5A-Za-z0-9]{2,20})/);
    if (suitMatch) {
      put(suitMatch[1]);
      put(suitMatch[2]);
      put(`${suitMatch[1]}诉${suitMatch[2]}`);
    }
    const compact = this.normalizeRetrievalToken(title);
    for (let size = Math.min(8, compact.length); size >= 3; size--) {
      for (let i = 0; i + size <= compact.length; i++) {
        put(compact.slice(i, i + size));
      }
    }
    return result.slice(0, 24);
  },
  scoreCaseTitleSimilarity: function (sourceTitle, targetText) {
    const source = this.cleanCaseTitleCandidate(sourceTitle);
    const target = String(targetText || "");
    if (!source || !target) {
      return 0;
    }
    const normalizedSource = this.normalizeRetrievalToken(source);
    const normalizedTarget = this.normalizeRetrievalToken(target);
    if (!normalizedSource || !normalizedTarget) {
      return 0;
    }
    if (normalizedSource === normalizedTarget) {
      return 100;
    }
    if (normalizedTarget.includes(normalizedSource) || normalizedSource.includes(normalizedTarget)) {
      const ratio = Math.min(normalizedSource.length, normalizedTarget.length) / Math.max(normalizedSource.length, normalizedTarget.length);
      return 70 + Math.round(ratio * 20);
    }
    const fragments = this.buildCaseTitleFragments(source);
    if (!fragments.length) {
      return 0;
    }
    let score = 0;
    let hitCount = 0;
    fragments.forEach((fragment, index) => {
      if (!normalizedTarget.includes(fragment)) {
        return;
      }
      hitCount += 1;
      const baseWeight = Math.min(14, Math.max(3, fragment.length + (index === 0 ? 4 : 0)));
      score += baseWeight;
    });
    if (!hitCount) {
      return 0;
    }
    const coverage = Math.min(1, hitCount / Math.max(2, Math.min(8, fragments.length)));
    return Math.round(score + coverage * 20);
  },
  extractCaseContext: function (text) {
    const source = String(text || "");
    if (!source) {
      return { caseKey: "", caseTitle: "", caseNo: "", hasExplicitCaseNo: false };
    }
    const matchedNo = source.match(/(?:案号|案件编号|卷宗号|项目编号)\s*[:：]?\s*([A-Za-z0-9\u4e00-\u9fa5\-()（）\s]{4,30}?号)/);
    let matchedTitle = source.match(/(?:案件名称|案件|项目|客户)\s*[:：]\s*([^\n，。,；;]{2,40})/);

    if (!matchedTitle) {
      const disputeMatch = source.match(/([\u4e00-\u9fa5A-Za-z0-9 \t]{2,40}纠纷(?:案)?)/);
      if (disputeMatch) {
        let t = this.cleanCaseTitleCandidate(disputeMatch[1].replace(/^(?:文件名[:：]?|关于|请求|一份|上传的?|这份)/, "").trim());
        matchedTitle = [disputeMatch[0], t];
      } else if (!matchedNo) {
        const fileTitleMatch = source.match(/文件名\s*[:：]?\s*([^\n，。,；;]{2,40})/);
        if (fileTitleMatch) {
          let t = fileTitleMatch[1].replace(/\.(docx?|pdf|txt|png|jpg|jpeg)$/i, "").trim();
          t = this.cleanCaseTitleCandidate(t.replace(/^(?:关于|请求|一份)/, ""));
          matchedTitle = [fileTitleMatch[0], t];
        }
      }
    }

    const caseTitle = this.cleanCaseTitleCandidate((matchedTitle && matchedTitle[1]) || (matchedNo && matchedNo[1]) || "");
    const caseKey = this.normalizeCaseKey((matchedNo && matchedNo[1]) || caseTitle || "");
    return {
      caseKey,
      caseTitle,
      caseNo: String((matchedNo && matchedNo[1]) || "").trim(),
      hasExplicitCaseNo: !!(matchedNo && matchedNo[1]),
    };
  },
  resolveCaseContext: function (inputText, fallbackContext = {}) {
    const fromInput = this.extractCaseContext(inputText);
    const fromFallback = {
      caseKey: this.normalizeCaseKey(fallbackContext?.caseKey || ""),
      caseTitle: this.cleanCaseTitleCandidate(fallbackContext?.caseTitle || ""),
      caseNo: String(fallbackContext?.caseNo || "").trim(),
      hasExplicitCaseNo: !!fallbackContext?.hasExplicitCaseNo,
    };
    let cachedContext = { caseKey: "", caseTitle: "" };
    try {
      const cache = wx.getStorageSync("active_case_context");
      cachedContext = {
        caseKey: this.normalizeCaseKey(cache?.caseKey || ""),
        caseTitle: this.cleanCaseTitleCandidate(cache?.caseTitle || ""),
        caseNo: String(cache?.caseNo || "").trim(),
        hasExplicitCaseNo: !!cache?.hasExplicitCaseNo,
      };
    } catch (e) {
      console.log("read active_case_context failed", e);
    }
    const rawInput = String(inputText || "");
    const shouldReuseCached =
      !!cachedContext.caseKey &&
      (
        (cachedContext.caseTitle && rawInput.includes(cachedContext.caseTitle)) ||
        (fromInput.caseTitle && cachedContext.caseTitle && fromInput.caseTitle.includes(cachedContext.caseTitle)) ||
        (fromFallback.caseTitle && cachedContext.caseTitle && fromFallback.caseTitle.includes(cachedContext.caseTitle))
      );
    const finalContext = shouldReuseCached
      ? cachedContext
      : {
          caseKey: fromInput.caseKey || fromFallback.caseKey || cachedContext.caseKey || "",
          caseTitle: fromInput.caseTitle || fromFallback.caseTitle || cachedContext.caseTitle || "",
          caseNo: fromInput.caseNo || fromFallback.caseNo || cachedContext.caseNo || "",
          hasExplicitCaseNo: !!(fromInput.hasExplicitCaseNo || fromFallback.hasExplicitCaseNo || cachedContext.hasExplicitCaseNo),
        };
    const caseKey = finalContext.caseKey || "";
    const caseTitle = finalContext.caseTitle || caseKey;
    const caseNo = finalContext.caseNo || "";
    const hasExplicitCaseNo = !!finalContext.hasExplicitCaseNo;
    if (caseKey) {
      try {
        wx.setStorageSync("active_case_context", { caseKey, caseTitle, caseNo, hasExplicitCaseNo, updatedAt: Date.now() });
      } catch (e) {
        console.log("save active_case_context failed", e);
      }
      return { caseKey, caseTitle, caseNo, hasExplicitCaseNo };
    }
    if (cachedContext.caseKey) {
      return {
        caseKey: cachedContext.caseKey,
        caseTitle: cachedContext.caseTitle || cachedContext.caseKey,
        caseNo: cachedContext.caseNo || "",
        hasExplicitCaseNo: !!cachedContext.hasExplicitCaseNo,
      };
    }
    return { caseKey: "", caseTitle: "", caseNo: "", hasExplicitCaseNo: false };
  },
  buildContractKeywords: function (textList) {
    const text = Array.isArray(textList) ? textList.join(" ") : String(textList || "");
    const chunks = text
      .split(/[\s,，。！？；;:\n\r\t()（）【】\[\]、\/\\<>《》"'“”‘’|]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && item.length <= 16);
    const seen = {};
    const result = [];
    chunks.forEach((item) => {
      if (!seen[item]) {
        seen[item] = true;
        result.push(item);
      }
    });
    return result.slice(0, 10);
  },
  archiveUploadedContracts: async function (userRecord) {
    if (this.data.chatMode !== "model") {
      return;
    }
    const fileList = Array.isArray(userRecord?.fileList) ? userRecord.fileList : [];
    if (!fileList.length) {
      return;
    }
    const category = this.inferContractCategory();
    const userCaseContext = this.resolveCaseContext(userRecord?.content || "");
    for (const fileItem of fileList) {
      const fileText = fileItem.extractedText || fileItem.ocrText || "";
      const fileName = fileItem.rawFileName || fileItem.tempFileName || "上传合同";
      const ext = fileName.includes(".") ? fileName.split(".").pop() : "";
      const docType = this.inferArchiveDocType(fileName, userRecord.content || "");
      const content = this.normalizeArchivedDocumentLayout(
        [fileText, userRecord.content ? `用户意图：${userRecord.content}` : ""].filter(Boolean).join("\n\n")
      );

      const fileContextText = `文件名：${fileName}\n${fileText}`;
      const caseContext = this.resolveCaseContext(fileContextText, userCaseContext);

      const fallbackSummary = [fileText, userRecord.content].filter(Boolean).join(" ").trim();
      const finalContent = content || `文件名：${fileName}\n文件类型：${ext || "unknown"}\n未提取到正文文本`;
      const keywords = this.buildContractKeywords([fileName, userRecord.content, fileText, category]);
      try {
        await this.persistContractArchive({
          title: caseContext.caseTitle || fileName,
          category,
          docType,
          caseKey: caseContext.caseKey,
          caseTitle: caseContext.caseTitle,
          sourceType: "upload",
          status: "已上传",
          fileName,
          fileType: ext,
          content: finalContent,
          summary: fallbackSummary || finalContent,
          keywords,
        });
      } catch (error) {
        console.log("archiveUploadedContracts failed", error);
      }
    }
  },
  archiveGeneratedContract: async function (userInput, generatedContent, options = {}) {
    const category = this.inferContractCategory();
    const featureKey = this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult";
    if (featureKey === "consult") {
      return { ok: false, id: "", error: "skip: consult feature not archivable generated content" };
    }
    const caseContext = this.resolveCaseContext(userInput, {
      caseKey: options.caseKey || "",
      caseTitle: options.caseTitle || "",
    });

    const isWelcomeOrChat = /^你好.*顾问/.test(generatedContent) || /常见咨询场景/.test(generatedContent) || /告诉.*帮助/.test(generatedContent);
    const isValidBody = this.isLikelyArchivableGeneratedDocument(generatedContent, { featureKey });

    if (isWelcomeOrChat) {
      return { ok: false, id: "", error: "skip: welcome message" };
    }

    if (!isValidBody) {
      return { ok: false, id: "", error: "skip: not archivable generated document" };
    }

    const content = this.sanitizeContractPresentationContent(generatedContent) || String(generatedContent || "").trim();
    if (!content || content === this.data.defaultErrorMsg || content.startsWith("请求失败")) {
      return { ok: false, id: "", error: "skip: invalid content" };
    }
    if (/^一、\s*需确认的事实与信息/.test(content) || /^合同前提建议[:：]?/m.test(content) || /^请先补充以下信息[:：]?/m.test(content)) {
      return { ok: false, id: "", error: "skip: clarification content" };
    }
    const title = this.resolveGeneratedArchiveTitle(userInput, content, caseContext, category, options);
    const keywords = this.buildContractKeywords([title, userInput, content, category]);
    const finalConfirmed = options.finalConfirmed != null
      ? !!options.finalConfirmed
      : this.isFinalContractIntent(userInput, content);
    let wordFileInfo = {
      fileId: "",
      fileName: "",
      fileType: "",
    };
    if (!options.skipWord) {
      try {
        wordFileInfo = await this.uploadGeneratedContractWord(title, content);
      } catch (error) {
        console.log("uploadGeneratedContractWord failed", error);
      }
    }
    try {
      const result = await this.persistContractArchive({
        id: options.id || "",
        archiveKey: options.archiveKey || "",
        contractGroupKey: options.contractGroupKey || "",
        title,
        category,
        docType: this.inferArchiveDocType(title, userInput),
        caseKey: caseContext.caseKey,
        caseTitle: caseContext.caseTitle,
        sourceType: "generated",
        status: options.status || "已生成",
        finalConfirmed,
        content: content.slice(0, 80000),
        summary: content.slice(0, 80000),
        keywords,
        fileId: wordFileInfo.fileId || "",
        fileName: wordFileInfo.fileName || "",
        fileType: wordFileInfo.fileType || "",
      });
      if (!result.ok && !options.quiet) {
        wx.showToast({
          title: result.error || i18n.t("agent.archiveFailed"),
          icon: "none",
        });
      }
      return result;
    } catch (error) {
      console.log("archiveGeneratedContract failed", error);
      return { ok: false, id: "", error: error?.message || error?.errMsg || i18n.t("agent.archiveFailed") };
    }
  },
  isFinalContractIntent: function (userInput, generatedContent) {
    const userText = String(userInput || "");
    const outputText = String(generatedContent || "");
    if (/确认.*最终版|最终版确认|这是最终版|定稿|请输出最终版|输出最终合同|确认无误并定稿/.test(userText)) {
      return true;
    }
    if (/最终版合同|定稿版本|最终定稿/.test(outputText) && /甲方[:：]|乙方[:：]|第[一二三四五六七八九十百]+条/.test(outputText)) {
      return true;
    }
    return false;
  },
  isLikelyContractBody: function (value) {
    const text = String(value || "").trim();
    if (!text || text.length < 80) {
      return false;
    }
    if (/^你好.*我是.*顾问/.test(text) || /^请问.*帮助/.test(text) || /常见咨询场景/.test(text)) {
      return false;
    }
    if (/需要先澄清|需要确认.*信息|请提供|请补充|还需要了解|请问您|您需要|请告诉我|需要您提供/.test(text)) {
      if (!/第[一二三四五六七八九十]+条/.test(text) && !/甲方[:：].*乙方[:：]/.test(text) && !/风险等级|修改建议/.test(text)) {
        return false;
      }
    }
    if (/需确认的事实与信息|合同前提建议|待确认事项|请先补充以下信息/.test(text)) {
      if (!/第[一二三四五六七八九十百]+条|甲方[:：].*乙方[:：]|签订日期|违约责任|争议解决/.test(text)) {
        return false;
      }
    }

    const hasParty = /甲方[:：]|乙方[:：]|出租方[:：]|承租方[:：]|买方[:：]|卖方[:：]|授权方[:：]/.test(text);
    const hasArticle = /第[一二三四五六七八九十百]+条/.test(text);
    const hasTerms = /违约责任|争议解决|不可抗力|合同生效|保密条款|权利义务/.test(text);
    const hasTitle = /合同编号|协议书|合同书/.test(text);
    const isReview = /风险等级|修改建议|问题说明|审查意见|合规建议/.test(text);

    let score = 0;
    if (hasParty) score++;
    if (hasArticle) score += 2;
    if (hasTerms) score++;
    if (hasTitle) score++;
    if (isReview) score += 2;

    return score >= 2;
  },
};
