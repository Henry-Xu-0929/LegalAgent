const i18n = require("../../utils/i18n");
const { attachPageLanguage } = require("../../utils/i18n-page");

const buildTimeLabels = () => [
  i18n.t("report.timeMorning"),
  i18n.t("report.timeNoon"),
  i18n.t("report.timeAfternoon"),
  i18n.t("report.timeEvening"),
];

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

Page({
  data: {
    metrics: [],
    trends: [],
    heatmap: [],
    risks: [],
    frequentQuestions: [],
    suggestions: [],
    isEmpty: false,
    timeLabels: [],
    t: {},
  },
  onLoad() {
    attachPageLanguage(this);
    this.loadOverview();
  },
  onShow() {
    i18n.syncShell();
    const authUser = wx.getStorageSync("authUser");
    if (!authUser) {
      wx.reLaunch({
        url: "/pages/index/index",
      });
    }
  },
  onLanguageChanged() {
    this.setData({ timeLabels: buildTimeLabels() });
    if (this._usingFallback) {
      this.applyOverview(buildFallbackOverview());
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
    // 云端数据原样展示（不做翻译），仅补充热力图颜色
    const processedHeatmap = (overview.heatmap || []).map(dayItem => {
      return {
        ...dayItem,
        blocks: dayItem.counts.map(count => ({
          count,
          color: this.getHeatmapColor(count)
        }))
      };
    });

    this.setData({
      metrics: overview.metrics || [],
      trends: overview.trends || [],
      heatmap: processedHeatmap,
      risks: overview.risks || [],
      frequentQuestions: overview.frequentQuestions || [],
      suggestions: overview.suggestions || [],
      timeLabels: buildTimeLabels(),
      isEmpty:
        (!overview.metrics || overview.metrics.length === 0) &&
        (!overview.trends || overview.trends.length === 0),
    });
  },
  async loadOverview() {
    try {
      const res = await wx.cloud.callFunction({
        name: "report",
      });
      const payload = res?.result || {};
      if (!payload.ok) {
        throw new Error(payload.error || i18n.t("report.loadFailed"));
      }
      let overview = payload.data || {};

      // 如果云端数据为空(可能云函数未更新部署)，在前端兜底提供默认展示数据
      if (!overview.metrics || overview.metrics.length === 0) {
        overview = buildFallbackOverview();
        this._usingFallback = true;
      } else {
        this._usingFallback = false;
      }

      this.applyOverview(overview);
    } catch (error) {
      wx.showToast({
        title: i18n.t("report.loadFailed"),
        icon: "none",
      });
    }
  },
});
