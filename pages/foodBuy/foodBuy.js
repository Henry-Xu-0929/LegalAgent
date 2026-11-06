const i18n = require("../../utils/i18n");
const { attachPageLanguage } = require("../../utils/i18n-page");

const CATEGORY_DEFS = [
  { value: "all", key: "archive.catAll" },
  { value: "合同起草", key: "archive.catDraft" },
  { value: "合同审查", key: "archive.catReview" },
  { value: "案件卷宗", key: "archive.catCase" },
  { value: "证据材料", key: "archive.catEvidence" },
  { value: "法律文书", key: "archive.catDocument" },
  { value: "对话分析", key: "archive.catAnalysis" },
];

const STATUS_KEY_BY_CODE = {
  final: "archive.statusFinal",
  uploaded: "archive.statusUploaded",
  generating: "archive.statusGenerating",
  generated: "archive.statusGenerated",
};

const buildCategories = () =>
  CATEGORY_DEFS.map((item) => ({ value: item.value, label: i18n.t(item.key) }));

Page({
  data: {
    searchInput: "",
    searchQuery: "",
    activeCategory: "all",
    categories: [],
    contracts: [],
    filteredContracts: [],
    isEmpty: false,
    page: 1,
    size: 20,
    total: 0,
    loading: false,
    showDetail: false,
    activeContract: null,
    isEditing: false,
    editContent: "",
    savingEdit: false,
    t: {},
  },
  async onLoad() {
    attachPageLanguage(this);
    await this.loadContracts(false, "");
  },
  onShow() {
    i18n.syncShell();
    const authUser = wx.getStorageSync("authUser");
    if (!authUser) {
      wx.reLaunch({
        url: "/pages/index/index",
      });
      return;
    }
    const safeSearchInput = this.normalizeTextValue(this.data.searchInput, "");
    const safeSearchQuery = this.normalizeTextValue(this.data.searchQuery, safeSearchInput);
    if (safeSearchInput !== this.data.searchInput || safeSearchQuery !== this.data.searchQuery) {
      this.setData({
        searchInput: safeSearchInput,
        searchQuery: safeSearchQuery,
      });
    }
    this.setData({ page: 1 });
    this.loadContracts(false, safeSearchInput);
  },
  onLanguageChanged() {
    this.setData({
      categories: buildCategories(),
      contracts: this.data.contracts.map((item) => this.localizeContractDisplay(item)),
      filteredContracts: this.data.filteredContracts.map((item) => this.localizeContractDisplay(item)),
      activeContract: this.data.activeContract
        ? this.localizeContractDisplay(this.data.activeContract)
        : null,
    });
  },
  onSearchInput(e) {
    const searchInput = this.normalizeTextValue(e?.detail?.value, "");
    this.setData({
      searchInput,
    });
    this.triggerSearch(searchInput);
  },
  onSearchConfirm(e) {
    const searchInput = this.normalizeTextValue(e?.detail?.value, this.data.searchInput);
    this.setData({
      searchInput,
    });
    this.triggerSearch(searchInput, true);
  },
  triggerSearch(query, immediate = false) {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
    }
    const execute = () => {
      this.setData({ page: 1 });
      this.loadContracts(false, query);
    };
    if (immediate) {
      execute();
    } else {
      this._searchTimer = setTimeout(execute, 500);
    }
  },
  async onCategoryChange(e) {
    const activeCategory = e.currentTarget.dataset.value;
    this.setData({
      activeCategory,
      page: 1,
    });
    await this.loadContracts();
  },
  async onReachBottom() {
    if (this.data.loading) {
      return;
    }
    if (this.data.contracts.length >= this.data.total) {
      return;
    }
    this.setData({
      page: this.data.page + 1,
    });
    await this.loadContracts(true);
  },
  async fetchContracts(extra = {}) {
    const { searchQuery, activeCategory, page, size } = this.data;
    const { query: extraQuery, ...restExtra } = extra || {};
    const mergedQuery = extraQuery == null ? searchQuery : extraQuery;
    const safeQuery = this.normalizeTextValue(mergedQuery, "");
    const safeCategory = String(activeCategory == null ? "all" : activeCategory).trim() || "all";
    const res = await wx.cloud.callFunction({
      name: "contract",
      data: {
        action: "list",
        query: safeQuery,
        category: safeCategory,
        page,
        size,
        ...restExtra,
      },
    });
    const payload = res?.result || {};
    if (!payload.ok) {
      throw new Error(payload.error || i18n.t("archive.fetchFailed"));
    }
    return payload;
  },
  sanitizeContractContent(content) {
    let text = String(content || "").replace(/\r\n/g, "\n");
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
    const introPattern =
      /我将为您|已为您|下面为您|以下为您|以下是|根据您的|重新生成|更精简|草案如下|建议稿|模板如下|请参考|供参考|需要确认.*信息|需要先澄清|需要补充|合同起草前需澄清的事实/;
    const contractStartPattern =
      /合同编号|甲方[:：]|乙方[:：]|出租方[:：]|承租方[:：]|买方[:：]|卖方[:：]|第[一二三四五六七八九十]+条|[一二三四五六七八九十]+、|租赁期限|违约责任|争议解决|签订日期|签订地点|^.{0,24}合同$|^.{0,24}协议$/;

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
  normalizeTextValue(value, fallback = "") {
    if (value == null) {
      return fallback;
    }
    const text = String(value).trim();
    if (!text) {
      return fallback;
    }
    if (text.toLowerCase() === "undefined" || text.toLowerCase() === "null") {
      return fallback;
    }
    return text;
  },
  normalizeArchiveStatus(value, finalConfirmed = false) {
    const raw = this.normalizeTextValue(value, "");
    const base = raw
      .replace(/第\s*[0-9一二三四五六七八九十百]+\s*版/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (finalConfirmed || /(最终|定稿)/.test(base)) {
      return "final";
    }
    if (/已上传/.test(base)) {
      return "uploaded";
    }
    if (/生成中/.test(base)) {
      return "generating";
    }
    if (/已生成|生成/.test(base)) {
      return "generated";
    }
    return base;
  },
  formatArchiveStatus(code) {
    if (!code) {
      return i18n.t("archive.statusUnmarked");
    }
    const key = STATUS_KEY_BY_CODE[code];
    return key ? i18n.t(key) : code;
  },
  buildArchiveVersionLabel(versionNo) {
    const version = Number(versionNo || 1);
    return i18n.t("archive.versionLabel", {
      n: Number.isFinite(version) && version > 0 ? version : 1,
    });
  },
  localizeContractDisplay(item = {}) {
    const rawVersionNo = Number(item.rawVersionNo || item.versionNo || 1);
    return {
      ...item,
      category: this.formatArchiveCategory(item.rawCategory != null ? item.rawCategory : item.category),
      sourceType: this.formatArchiveSource(item.rawSourceType != null ? item.rawSourceType : item.sourceType),
      title: this.formatArchiveTitle(item.rawTitle != null ? item.rawTitle : item.title),
      summary: this.formatArchiveSummary(item.rawSummary != null ? item.rawSummary : item.summary),
      status: item.statusCode,
      displayStatus: this.formatArchiveStatus(item.statusCode),
      displayVersionLabel: this.buildArchiveVersionLabel(rawVersionNo),
      manualEditCountLabel: i18n.t("archive.manualEditCount", {
        n: Number(item.manualEditCount || 1),
      }),
    };
  },
  formatArchiveCategory(value) {
    const text = this.normalizeTextValue(value, "");
    if (!text) {
      return i18n.t("archive.uncategorized");
    }
    const match = CATEGORY_DEFS.find((item) => item.value === text && item.value !== "all");
    return match ? i18n.t(match.key) : text;
  },
  formatArchiveSource(value) {
    const text = this.normalizeTextValue(value, "");
    return text || i18n.t("archive.unknown");
  },
  formatArchiveTitle(value) {
    const text = this.normalizeTextValue(value, "");
    return text || i18n.t("archive.untitled");
  },
  formatArchiveSummary(value) {
    const text = this.normalizeTextValue(value, "");
    return text || i18n.t("archive.noSummary");
  },
  normalizeContractDisplay(item = {}) {
    const cleanSummary = this.sanitizeContractContent(this.normalizeTextValue(item.summary));
    const cleanContent = this.sanitizeContractContent(this.normalizeTextValue(item.content));
    const rawKeywords = Array.isArray(item.keywords) ? item.keywords : [];
    const keywords = rawKeywords
      .map((value) => this.normalizeTextValue(value))
      .filter(Boolean);
    const versionNo = Number(item.versionNo || 1);
    const finalConfirmed = !!item.finalConfirmed;
    const statusCode = this.normalizeArchiveStatus(item.status, finalConfirmed);
    const rawTitle = this.normalizeTextValue(item.title, "");
    const rawCategory = this.normalizeTextValue(item.category, "");
    const rawSourceType = this.normalizeTextValue(item.sourceType, "");
    const rawSummary = cleanSummary || this.normalizeTextValue(item.summary, "");
    const display = {
      ...item,
      id: this.normalizeTextValue(item.id),
      rawTitle,
      rawCategory,
      rawSourceType,
      rawSummary,
      statusCode,
      versionNo,
      finalConfirmed,
      contractGroupKey: this.normalizeTextValue(item.contractGroupKey),
      fileId: this.normalizeTextValue(item.fileId),
      fileName: this.normalizeTextValue(item.fileName),
      fileType: this.normalizeTextValue(item.fileType),
      createdAt: this.normalizeTextValue(item.createdAt, "-"),
      updatedAt: this.normalizeTextValue(item.updatedAt, "-"),
      manualEdited: !!item.manualEdited,
      manualEditCount: Number(item.manualEditCount || 0),
      manualEditUpdatedAt: this.normalizeTextValue(item.manualEditUpdatedAt),
      manualEditHistory: Array.isArray(item.manualEditHistory) ? item.manualEditHistory : [],
      keywords,
      content: cleanContent || this.normalizeTextValue(item.content),
    };
    return this.localizeContractDisplay(display);
  },
  syncUpdatedContractToList(updatedContract = {}) {
    const targetId = this.normalizeTextValue(updatedContract.id);
    if (!targetId) {
      return;
    }
    const replaceById = (list = []) =>
      (Array.isArray(list) ? list : []).map((item) => (item?.id === targetId ? updatedContract : item));
    this.setData({
      contracts: replaceById(this.data.contracts),
      filteredContracts: replaceById(this.data.filteredContracts),
    });
  },
  async loadContracts(append = false, forceQuery) {
    this.setData({ loading: true });
    try {
      const safeSearchInput = this.normalizeTextValue(this.data.searchInput, "");
      const safeSearchQuery = this.normalizeTextValue(forceQuery == null ? safeSearchInput : forceQuery, "");
      if (safeSearchInput !== this.data.searchInput || safeSearchQuery !== this.data.searchQuery) {
        this.setData({
          searchInput: safeSearchInput,
          searchQuery: safeSearchQuery,
        });
      }
      const payload = await this.fetchContracts({ query: safeSearchQuery });
      const list = (payload.data || []).map((item) => this.normalizeContractDisplay(item));
      const finalList = append ? [...this.data.contracts, ...list] : list;
      this.setData({
        contracts: finalList,
        filteredContracts: finalList,
        isEmpty: finalList.length === 0,
        total: payload.total || finalList.length,
      });
    } catch (error) {
      wx.showToast({
        title: i18n.t("archive.searchFailed"),
        icon: "none",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  async clearSearch() {
    this.setData({
      searchInput: "",
      searchQuery: "",
      page: 1,
    });
    await this.loadContracts(false, "");
  },
  async openContractDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      return;
    }
    try {
      const res = await wx.cloud.callFunction({
        name: "contract",
        data: {
          action: "detail",
          id,
        },
      });
      const payload = res?.result || {};
      if (!payload.ok) {
        throw new Error(payload.error || i18n.t("archive.detailFailed"));
      }
      this.setData({
        showDetail: true,
        activeContract: this.normalizeContractDisplay(payload.data || {}),
        isEditing: false,
        editContent: "",
        savingEdit: false,
      });
    } catch (error) {
      wx.showToast({
        title: i18n.t("archive.detailFailed"),
        icon: "none",
      });
    }
  },
  async closeContractDetail() {
    if (this.data.isEditing) {
      const activeContent = this.normalizeTextValue(this.data.activeContract?.content, "");
      const editContent = this.normalizeTextValue(this.data.editContent, "");
      if (activeContent !== editContent) {
        const res = await wx.showModal({
          title: i18n.t("archive.abandonTitle"),
          content: i18n.t("archive.abandonContent"),
          confirmColor: "#ef4444",
        });
        if (!res.confirm) {
          return;
        }
      }
    }
    this.setData({
      showDetail: false,
      activeContract: null,
      isEditing: false,
      editContent: "",
      savingEdit: false,
    });
  },
  onEditContentInput(e) {
    this.setData({
      editContent: String(e?.detail?.value || ""),
    });
  },
  async toggleEditMode() {
    if (this.data.savingEdit) {
      return;
    }
    if (!this.data.isEditing) {
      this.setData({
        isEditing: true,
        editContent: this.normalizeTextValue(this.data.activeContract?.content, ""),
      });
      return;
    }
    await this.saveManualEdit();
  },
  async saveManualEdit() {
    const current = this.data.activeContract || {};
    const id = this.normalizeTextValue(current.id, "");
    if (!id) {
      wx.showToast({
        title: i18n.t("archive.missingFileId"),
        icon: "none",
      });
      return;
    }
    const nextContent = String(this.data.editContent || "");
    if (!nextContent.trim()) {
      wx.showToast({
        title: i18n.t("archive.emptyContent"),
        icon: "none",
      });
      return;
    }
    const oldContent = String(current.content || "");
    if (nextContent === oldContent) {
      this.setData({
        isEditing: false,
      });
      return;
    }
    this.setData({
      savingEdit: true,
    });
    try {
      const res = await wx.cloud.callFunction({
        name: "contract",
        data: {
          action: "updateManualEdit",
          id,
          content: nextContent,
        },
      });
      const payload = res?.result || {};
      if (!payload.ok) {
        throw new Error(payload.error || i18n.t("archive.saveFailed"));
      }
      const updated = this.normalizeContractDisplay(payload.data || {});
      this.setData({
        activeContract: updated,
        isEditing: false,
        editContent: "",
      });
      this.syncUpdatedContractToList(updated);
      wx.showToast({
        title: i18n.t("archive.saved"),
        icon: "success",
      });
    } catch (error) {
      const errorMessage = this.normalizeTextValue(error?.message || error?.errMsg, i18n.t("archive.saveFailed"));
      wx.showToast({
        title: errorMessage.slice(0, 20),
        icon: "none",
      });
    } finally {
      this.setData({
        savingEdit: false,
      });
    }
  },
  escapeWordHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  },
  shouldBufferBrokenWordLine(line = "") {
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
  mergeBrokenWordLines(lines = []) {
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
  normalizeWordExportContent(content, title = "") {
    let text = this.sanitizeContractContent(content) || this.normalizeTextValue(content, "");
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
    const titleText = this.normalizeTextValue(title, "");
    const lines = this.mergeBrokenWordLines(text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line, index) => !!line || (index > 0 && index < text.length - 1)));
    if (titleText && lines.length && lines[0] === titleText) {
      lines.shift();
    }
    return lines.join("\n").trim();
  },
  buildWordLineHtml(line, title = "") {
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
  buildContractWordHtml(contract = {}) {
    const title = this.normalizeTextValue(contract.title, i18n.t("archive.docTitle"));
    const content = this.normalizeWordExportContent(contract.content || contract.summary || "", title);
    const lines = content ? content.split("\n") : [];
    const bodyHtml = (lines.length ? lines : [i18n.t("archive.noContent")])
      .map((line) => this.buildWordLineHtml(line, title))
      .filter(Boolean)
      .join("");
    const safeTitle = this.escapeWordHtml(title);
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
  async exportContractWord() {
    const contract = this.data.activeContract || {};
    const title = this.normalizeTextValue(contract.title, i18n.t("archive.docTitle"));
    const content = this.normalizeWordExportContent(contract.content || contract.summary || "", title);
    if (!content) {
      wx.showToast({
        title: i18n.t("archive.noExportContent"),
        icon: "none",
      });
      return;
    }
    try {
      const safeTitle = title.replace(/[\\/:*?"<>|\r\n]/g, " ").trim().slice(0, 28) || i18n.t("archive.docTitle");
      const fileName = `${safeTitle}-${Date.now()}.doc`;
      const localPath = `${wx.env.USER_DATA_PATH}/${fileName}`;
      const fs = wx.getFileSystemManager();
      const html = this.buildContractWordHtml({
        ...contract,
        title,
        content,
      });
      fs.writeFileSync(localPath, `\uFEFF${html}`, "utf8");
      await wx.openDocument({
        filePath: localPath,
        showMenu: true,
      });
    } catch (error) {
      wx.showToast({
        title: i18n.t("archive.exportFailed"),
        icon: "none",
      });
    }
  },
  async openContractWord() {
    const fileId = this.data.activeContract?.fileId;
    if (!fileId) {
      wx.showToast({
        title: i18n.t("archive.noWordFile"),
        icon: "none",
      });
      return;
    }
    try {
      const downloadRes = await wx.cloud.downloadFile({
        fileID: fileId,
      });
      const filePath = downloadRes?.tempFilePath;
      if (!filePath) {
        throw new Error(i18n.t("archive.wordDownloadFailed"));
      }
      await wx.openDocument({
        filePath,
        showMenu: true,
      });
    } catch (error) {
      wx.showToast({
        title: i18n.t("archive.openWordFailed"),
        icon: "none",
      });
    }
  },
  async deleteContract(e) {
    const id = e.currentTarget.dataset.id || this.data.activeContract?.id;
    if (!id) {
      return;
    }
    try {
      const confirmRes = await wx.showModal({
        title: i18n.t("archive.deleteTitle"),
        content: i18n.t("archive.deleteContent"),
        confirmColor: "#ef4444",
      });
      if (!confirmRes.confirm) {
        return;
      }
      const res = await wx.cloud.callFunction({
        name: "contract",
        data: {
          action: "delete",
          id,
        },
      });
      const payload = res?.result || {};
      if (!payload.ok) {
        throw new Error(payload.error || i18n.t("archive.deleteFailed"));
      }
      wx.showToast({
        title: i18n.t("archive.deleted"),
        icon: "success",
      });
      this.setData({
        showDetail: false,
        activeContract: null,
        isEditing: false,
        editContent: "",
        savingEdit: false,
        page: 1,
      });
      await this.loadContracts();
    } catch (error) {
      const errorMessage = this.normalizeTextValue(error?.message || error?.errMsg, i18n.t("archive.deleteFailed"));
      wx.showToast({
        title: errorMessage.slice(0, 20),
        icon: "none",
      });
    }
  },
  noop() {},
});
