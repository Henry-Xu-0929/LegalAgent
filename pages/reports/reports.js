const i18n = require("../../utils/i18n");
const { attachPageLanguage } = require("../../utils/i18n-page");

const buildTimeLabels = () => [
  i18n.t("report.timeMorning"),
  i18n.t("report.timeNoon"),
  i18n.t("report.timeAfternoon"),
  i18n.t("report.timeEvening"),
];

// 云端/Database 里的动态字段是中文，渲染前统一映射到 i18n 字典
const METRIC_LABEL_KEYS = {
  本月咨询数: "report.fallbackMetrics.consultations",
  审查合同: "report.fallbackMetrics.reviewedContracts",
  发现风险: "report.fallbackMetrics.risksFound",
};

const TREND_LABEL_KEYS = {
  较上月咨询增长: "report.fallbackTrends.consultGrowth",
  审查合同较上月增长: "report.fallbackTrends.reviewGrowth",
  合同一次通过率: "report.fallbackTrends.passRate",
};

const RISK_LABEL_KEYS = {
  违约责任缺失: "report.fallbackRisks.missingBreach",
  管辖法院不利: "report.fallbackRisks.jurisdiction",
  付款条款模糊: "report.fallbackRisks.payment",
  其他风险: "report.fallbackRisks.other",
  高风险: "report.fallbackRisks.highRisk",
  中风险: "report.fallbackRisks.mediumRisk",
  低风险: "report.fallbackRisks.lowRisk",
  未标注: "report.fallbackRisks.unlabeled",
  breach_of_contract: "report.fallbackRisks.missingBreach",
  unfavorable_jurisdiction: "report.fallbackRisks.jurisdiction",
  vague_payment_terms: "report.fallbackRisks.payment",
  other: "report.fallbackRisks.other",
};

const WEEKDAY_LABEL_KEYS = {
  周一: "report.weekdayMon",
  周二: "report.weekdayTue",
  周三: "report.weekdayWed",
  周四: "report.weekdayThu",
  周五: "report.weekdayFri",
  周六: "report.weekdaySat",
  周日: "report.weekdaySun",
};

const QUESTION_KEYS = {
  "劳动合同怎么约定试用期？": "report.fallbackQuestions.probation",
  "房屋租赁合同违约金一般定多少？": "report.fallbackQuestions.penalty",
  "离职竞业协议是否必须给补偿？": "report.fallbackQuestions.nonCompete",
  "买卖合同中发票条款如何拟定？": "report.fallbackQuestions.invoice",
};

const SUGGESTION_KEYS = {
  "近期「劳动合同」相关咨询激增，建议公司开展一次劳动法内部培训。":
    "report.fallbackSuggestions.laborTraining",
  "审查发现「违约责任缺失」是主要风险，建议更新标准合同模板，强制包含违约条款。":
    "report.fallbackSuggestions.breachClause",
  "周三和周五下午是法务咨询高峰，可在此时间段增加在线客服或支持人员。":
    "report.fallbackSuggestions.peakSupport",
};

const translateWithMap = (value, map) => {
  const text = String(value == null ? "" : value).trim();
  const key = map[text];
  return key ? i18n.t(key) : text;
};

const containsCjk = (text) => /[㐀-鿿]/.test(String(text == null ? "" : text));

const translateRiskName = (name) => {
  const text = String(name == null ? "" : name).trim();
  const key = RISK_LABEL_KEYS[text];
  if (key) {
    return i18n.t(key);
  }
  // 英文模式下未知中文风险名统一落到 Other risks，避免页面残留中文
  if (i18n.getLanguage() === "en" && containsCjk(text)) {
    return i18n.t("report.fallbackRisks.other");
  }
  return text;
};

// 前端超时兜底：应大于云函数 config.json 的 timeout（30s），
// 防止极端网络情况下 loading 永远不结束
const AI_SUGGESTION_TIMEOUT_MS = 35000;
const AI_TYPE_INTERVAL_MS = 24;
const AI_TYPE_STEP = 2;

const withTimeout = (promise, timeoutMs) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("AI_REPORT_TIMEOUT"));
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const looksLikeRawJson = (text) =>
  /^\s*\{\s*"suggestions"\s*:/i.test(text) ||
  /"suggestions"\s*:\s*\[/i.test(text);

const toSuggestionItems = (list) =>
  (Array.isArray(list) ? list : [])
    .map((item, index) => {
      const raw = item && typeof item === "object" ? item.text : item;
      return { id: index, text: String(raw == null ? "" : raw).trim() };
    })
    .filter((item) => item.text)
    .slice(0, 3);

const buildFallbackOverview = () => ({
  metrics: [
    { label: i18n.t("report.fallbackMetrics.consultations"), value: "342" },
    { label: i18n.t("report.fallbackMetrics.reviewedContracts"), value: "128" },
    { label: i18n.t("report.fallbackMetrics.risksFound"), value: "45" }
  ],
  trends: [
    { label: i18n.t("report.fallbackTrends.consultGrowth"), value: "+12%" },
    { label: i18n.t("report.fallbackTrends.passRate"), value: "85%" }
  ],
  heatmap: [
    { day: i18n.t("report.weekdayMon"), counts: [2, 5, 8, 3] }, // 早, 中, 下午, 晚
    { day: i18n.t("report.weekdayTue"), counts: [3, 8, 12, 4] },
    { day: i18n.t("report.weekdayWed"), counts: [5, 10, 15, 2] },
    { day: i18n.t("report.weekdayThu"), counts: [4, 7, 10, 5] },
    { day: i18n.t("report.weekdayFri"), counts: [6, 12, 18, 6] },
    { day: i18n.t("report.weekdaySat"), counts: [1, 2, 4, 1] },
    { day: i18n.t("report.weekdaySun"), counts: [0, 1, 3, 2] }
  ],
  risks: [
    { label: i18n.t("report.fallbackRisks.missingBreach"), value: 35, percentage: 40, color: "#e34d59" },
    { label: i18n.t("report.fallbackRisks.jurisdiction"), value: 25, percentage: 28, color: "#ed7b2f" },
    { label: i18n.t("report.fallbackRisks.payment"), value: 18, percentage: 20, color: "#f3a93c" },
    { label: i18n.t("report.fallbackRisks.other"), value: 10, percentage: 12, color: "#4d6bfe" }
  ],
  frequentQuestions: [
    { question: i18n.t("report.fallbackQuestions.probation"), count: 45 },
    { question: i18n.t("report.fallbackQuestions.penalty"), count: 32 },
    { question: i18n.t("report.fallbackQuestions.nonCompete"), count: 28 },
    { question: i18n.t("report.fallbackQuestions.invoice"), count: 19 }
  ],
  suggestions: [
    i18n.t("report.fallbackSuggestions.laborTraining"),
    i18n.t("report.fallbackSuggestions.breachClause"),
    i18n.t("report.fallbackSuggestions.peakSupport")
  ]
});

// 云端只负责可聚合的真实指标；热力图/高频问题暂无可聚合数据源，
// 继续使用 reports 集合配置或本地兜底；AI 建议由 generateAIReport 异步覆盖。
const mergeCloudOverview = (cloudOverview = {}) => {
  const fallback = buildFallbackOverview();
  const pick = (key) => {
    const value = cloudOverview[key];
    return Array.isArray(value) ? value : fallback[key];
  };
  const pickNonEmpty = (key) => {
    const value = cloudOverview[key];
    return Array.isArray(value) && value.length ? value : fallback[key];
  };
  return {
    metrics: pick("metrics"),
    trends: pick("trends"),
    risks: pick("risks"),
    heatmap: pickNonEmpty("heatmap"),
    frequentQuestions: pickNonEmpty("frequentQuestions"),
    suggestions: pickNonEmpty("suggestions"),
  };
};

Page({
  data: {
    metrics: [],
    trends: [],
    heatmap: [],
    risks: [],
    frequentQuestions: [],
    suggestions: [],
    suggestionsLoading: false,
    suggestionsTyping: false,
    aiSuggestionFailed: false,
    isEmpty: false,
    timeLabels: [],
    t: {},
  },
  onLoad() {
    attachPageLanguage(this);
    this.loadOverview();
  },
  onUnload() {
    this.stopSuggestionTypewriter();
    this._aiRequestId = (this._aiRequestId || 0) + 1;
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
    // tabBar 页面切换回来时不会重新触发 onLoad，这里静默刷新一次统计
    if (this._overviewLoadedOnce) {
      this.loadOverview({ silent: true, regenerateAI: false });
    }
  },
  async onPullDownRefresh() {
    try {
      await this.loadOverview({ silent: true, regenerateAI: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },
  onLanguageChanged() {
    this.setData({ timeLabels: buildTimeLabels() });
    if (this._cloudOverview) {
      this.applyOverview(mergeCloudOverview(this._cloudOverview));
      // 语言切换后按新语言重新生成 AI 建议
      this.loadAISuggestions();
    }
  },
  getHeatmapColor(count) {
    if (count === 0) return "#f0f2f8";
    if (count <= 3) return "#d9e2fc";
    if (count <= 8) return "#a8bdfa";
    if (count <= 12) return "#759af8";
    return "#4d6bfe";
  },
  applyOverview(overview) {
    // 数据库里的动态字段是中文，渲染前统一翻译成当前语言
    const processedHeatmap = (overview.heatmap || []).map(dayItem => {
      return {
        ...dayItem,
        day: translateWithMap(dayItem.day, WEEKDAY_LABEL_KEYS),
        blocks: dayItem.counts.map(count => ({
          count,
          color: this.getHeatmapColor(count)
        }))
      };
    });

    const metrics = (overview.metrics || []).map(item => ({
      ...item,
      label: translateWithMap(item.label, METRIC_LABEL_KEYS),
    }));
    const trends = (overview.trends || []).map(item => ({
      ...item,
      label: translateWithMap(item.label, TREND_LABEL_KEYS),
    }));
    const risks = (overview.risks || []).map(item => ({
      ...item,
      label: translateRiskName(item.label),
    }));
    const isEnglish = i18n.getLanguage() === "en";
    // 无法本地翻译的原始中文问题/建议，英文模式下先隐藏，避免页面残留中文
    const frequentQuestions = (overview.frequentQuestions || [])
      .map(item => ({
        ...item,
        question: translateWithMap(item.question, QUESTION_KEYS),
      }))
      .filter(item => !isEnglish || !containsCjk(item.question));
    const suggestions = (overview.suggestions || [])
      .map(item => translateWithMap(item, SUGGESTION_KEYS))
      .filter(item => !isEnglish || !containsCjk(item));

    this.setData({
      metrics,
      trends,
      heatmap: processedHeatmap,
      risks,
      frequentQuestions,
      suggestions: toSuggestionItems(suggestions),
      timeLabels: buildTimeLabels(),
      isEmpty:
        (!overview.metrics || overview.metrics.length === 0) &&
        (!overview.trends || overview.trends.length === 0),
    });
  },
  buildAIStats() {
    const overview = this._cloudOverview || {};
    const meta = overview.meta || {};
    const fromOverview = (key) =>
      (Array.isArray(overview[key]) ? overview[key] : this.data[key]) || [];
    return {
      month: meta.month || "",
      metrics: fromOverview("metrics").map((item) => ({
        label: item?.label,
        value: item?.value,
      })),
      trends: fromOverview("trends").map((item) => ({
        label: item?.label,
        value: item?.value,
      })),
      risks: fromOverview("risks").map((item) => ({
        label: item?.label,
        value: item?.value,
        percentage: item?.percentage,
      })),
      frequentQuestions: fromOverview("frequentQuestions").map((item) => ({
        question: item?.question,
        count: item?.count,
      })),
      reviewTotal: meta.reviewTotal || 0,
      riskFlagged: meta.riskFlagged || 0,
    };
  },
  async loadAISuggestions() {
    if (!this._cloudOverview) {
      return;
    }
    this.stopSuggestionTypewriter();
    const requestId = (this._aiRequestId || 0) + 1;
    this._aiRequestId = requestId;
    this.setData({
      suggestionsLoading: true,
      suggestionsTyping: false,
      aiSuggestionFailed: false,
    });
    try {
      const res = await withTimeout(
        wx.cloud.callFunction({
          name: "generateAIReport",
          data: {
            lang: i18n.getLanguage(),
            stats: this.buildAIStats(),
          },
        }),
        AI_SUGGESTION_TIMEOUT_MS
      );
      if (requestId !== this._aiRequestId) {
        return;
      }
      const payload = res?.result || {};
      if (!payload.ok) {
        const detail = payload.detail ? ` (${payload.detail})` : "";
        throw new Error(`${payload.error || "AI suggestions failed"}${detail}`);
      }
      const suggestions = (payload.data?.suggestions || [])
        .map((text) => String(text == null ? "" : text).trim())
        .filter((text) => text && !looksLikeRawJson(text))
        .slice(0, 3);
      if (!suggestions.length) {
        throw new Error("Empty AI suggestions");
      }
      this.setData({
        suggestionsLoading: false,
        aiSuggestionFailed: false,
      });
      this.startSuggestionTypewriter(suggestions);
    } catch (error) {
      if (requestId !== this._aiRequestId) {
        return;
      }
      console.error("[reports] loadAISuggestions failed", error);
      const overview = this._cloudOverview || {};
      const fallback =
        Array.isArray(overview.suggestions) && overview.suggestions.length
          ? overview.suggestions
          : buildFallbackOverview().suggestions;
      this.setData({
        suggestionsLoading: false,
        suggestionsTyping: false,
        aiSuggestionFailed: true,
        suggestions: toSuggestionItems(fallback),
      });
    }
  },
  startSuggestionTypewriter(suggestions) {
    this.stopSuggestionTypewriter();
    const items = toSuggestionItems(suggestions);
    const charLists = items.map((item) => Array.from(item.text));
    const maxLength = charLists.reduce(
      (max, chars) => Math.max(max, chars.length),
      0
    );
    if (!maxLength) {
      this.setData({ suggestions: items, suggestionsTyping: false });
      return;
    }
    let visible = 0;
    this.setData({
      suggestions: items.map((item) => ({ id: item.id, text: "" })),
      suggestionsTyping: true,
    });
    this._suggestionTimer = setInterval(() => {
      visible = Math.min(visible + AI_TYPE_STEP, maxLength);
      this.setData({
        suggestions: items.map((item, index) => ({
          id: item.id,
          text: charLists[index].slice(0, visible).join(""),
        })),
        suggestionsTyping: visible < maxLength,
      });
      if (visible >= maxLength) {
        this.stopSuggestionTypewriter();
      }
    }, AI_TYPE_INTERVAL_MS);
  },
  stopSuggestionTypewriter() {
    if (this._suggestionTimer) {
      clearInterval(this._suggestionTimer);
      this._suggestionTimer = null;
    }
  },
  async loadOverview(options = {}) {
    const { silent = false, regenerateAI = true } = options || {};
    if (!silent) {
      wx.showLoading({
        title: i18n.t("common.loading"),
        mask: true,
      });
    }
    try {
      const res = await wx.cloud.callFunction({
        name: "getReportData",
      });
      const payload = res?.result || {};
      if (!payload.ok) {
        throw new Error(payload.error || i18n.t("report.loadFailed"));
      }
      this._cloudOverview = payload.data || {};
      this.applyOverview(mergeCloudOverview(this._cloudOverview));
      this._overviewLoadedOnce = true;
      // 不阻塞报表首屏，AI 建议异步生成
      if (regenerateAI) {
        this.loadAISuggestions();
      }
    } catch (error) {
      console.error("[reports] loadOverview failed", error);
      if (!silent) {
        wx.hideLoading();
        wx.showToast({
          title: i18n.t("report.loadFailed"),
          icon: "none",
        });
      }
      return;
    }
    if (!silent) {
      wx.hideLoading();
    }
  },
});
