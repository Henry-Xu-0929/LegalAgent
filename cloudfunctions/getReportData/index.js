const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

// 云开发集合名区分大小写，这里沿用项目实际使用的集合名
const CONTRACTS = "contracts";
const SESSIONS = "agent_ui_sessions";
const REPORTS = "reports";

// 月份边界按北京时间（UTC+8）计算，避免云函数运行在 UTC 时区导致月初/月末错位
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

// 合同审查结果目前没有独立字段，从全文检索文本中匹配风险等级关键词；
// 按「高风险 > 中风险 > 低风险」的优先级归类，避免一份合同被重复计数
const RISK_KEYWORDS = {
  高风险: ["高风险", "风险等级：高", "风险等级:高"],
  中风险: ["中风险", "风险等级：中", "风险等级:中"],
  低风险: ["低风险", "风险等级：低", "风险等级:低"],
};

const RISK_META = [
  { label: "高风险", color: "#e34d59" },
  { label: "中风险", color: "#ed7b2f" },
  { label: "低风险", color: "#f3a93c" },
  { label: "未标注", color: "#8a94a6" },
];

const getMonthWindow = () => {
  const now = new Date(Date.now() + TZ_OFFSET_MS);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    currentStart: Date.UTC(year, month, 1) - TZ_OFFSET_MS,
    currentEnd: Date.UTC(year, month + 1, 1) - TZ_OFFSET_MS,
    previousStart: Date.UTC(year, month - 1, 1) - TZ_OFFSET_MS,
    label: `${year}-${String(month + 1).padStart(2, "0")}`,
  };
};

const formatGrowth = (current, previous) => {
  if (!previous) {
    return current > 0 ? `+${current}` : "0%";
  }
  const percent = Math.round(((current - previous) / previous) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
};

const readTotal = (res) => {
  const row = Array.isArray(res?.list) ? res.list[0] : null;
  return Number(row?.total || 0);
};

// 会话表以 updatedAt 记录最近活跃时间，兼容 createdAt
const sessionTsExpr = () => $.ifNull(["$updatedAt", "$createdAt"]);

// 合同表实际落库的是 createdAt，兼容你描述的 createdAtTs
const contractTsExpr = () => $.ifNull(["$createdAtTs", "$createdAt"]);

const contractTextExpr = () => $.ifNull(["$searchableText", "$content"]);

const hasAnyKeyword = (textExpr, keywords) =>
  $.or(
    keywords.map((keyword) =>
      $.gte([$.indexOfCP([textExpr, keyword]), 0])
    )
  );

const buildRiskLevelExpr = () =>
  $.cond({
    if: hasAnyKeyword(contractTextExpr(), RISK_KEYWORDS["高风险"]),
    then: "高风险",
    else: $.cond({
      if: hasAnyKeyword(contractTextExpr(), RISK_KEYWORDS["中风险"]),
      then: "中风险",
      else: $.cond({
        if: hasAnyKeyword(contractTextExpr(), RISK_KEYWORDS["低风险"]),
        then: "低风险",
        else: "未标注",
      }),
    }),
  });

const countInRange = async (collectionName, match, tsExpr, start, end) => {
  const res = await db
    .collection(collectionName)
    .aggregate()
    .addFields({ reportTs: tsExpr })
    .match({
      ...match,
      reportTs: _.gte(start).and(_.lt(end)),
    })
    .group({ _id: null, total: $.sum(1) })
    .end();
  return readTotal(res);
};

// 分别返回「本月」与「上月」数量
const countMonthly = async (collectionName, match, tsExpr) => {
  const { currentStart, currentEnd, previousStart } = getMonthWindow();
  const [current, previous] = await Promise.all([
    countInRange(collectionName, match, tsExpr, currentStart, currentEnd),
    countInRange(collectionName, match, tsExpr, previousStart, currentStart),
  ]);
  return { current, previous };
};

// 非聚合区块（热力图/高频问题/建议）仍可从 reports 集合的 overview 文档读取
const readStoredOverview = async () => {
  try {
    const res = await db
      .collection(REPORTS)
      .where({ type: "overview" })
      .limit(1)
      .get();
    return res?.data?.[0] || {};
  } catch (error) {
    console.warn("read reports overview failed", error);
    return {};
  }
};

exports.main = async () => {
  try {
    const { label } = getMonthWindow();

    const [consultMonthly, reviewMonthly, reviewRes, riskRes, stored] =
      await Promise.all([
        // 只统计逐条咨询日志，避免把“会话文档”也算成一次咨询
        countMonthly(
          SESSIONS,
          { sessionType: "consult_log", activeFeatureKey: "consult" },
          sessionTsExpr()
        ),
        countMonthly(CONTRACTS, { category: "合同审查" }, contractTsExpr()),
        db
          .collection(CONTRACTS)
          .aggregate()
          .match({ category: "合同审查" })
          .group({ _id: null, total: $.sum(1) })
          .end(),
        db
          .collection(CONTRACTS)
          .aggregate()
          .match({ category: "合同审查" })
          .addFields({ riskLevel: buildRiskLevelExpr() })
          .group({ _id: "$riskLevel", count: $.sum(1) })
          .end(),
        readStoredOverview(),
      ]);

    const reviewTotal = readTotal(reviewRes);
    const riskCountMap = {};
    (riskRes?.list || []).forEach((item) => {
      riskCountMap[item._id || "未标注"] = Number(item.count || 0);
    });

    // 占比统一以前端展示的「审查合同总数」为分母；数量为 0 的风险等级不展示
    const risks = RISK_META.map(({ label: riskLabel, color }) => {
      const count = riskCountMap[riskLabel] || 0;
      return {
        label: riskLabel,
        value: count,
        percentage:
          reviewTotal > 0 ? Math.round((count / reviewTotal) * 100) : 0,
        color,
      };
    }).filter((item) => item.value > 0);

    const riskFlagged = ["高风险", "中风险", "低风险"].reduce(
      (sum, key) => sum + (riskCountMap[key] || 0),
      0
    );

    const data = {
      metrics: [
        { label: "本月咨询数", value: String(consultMonthly.current) },
        { label: "审查合同", value: String(reviewTotal) },
        { label: "发现风险", value: String(riskFlagged) },
      ],
      trends: [
        {
          label: "较上月咨询增长",
          value: formatGrowth(
            consultMonthly.current,
            consultMonthly.previous
          ),
        },
        {
          label: "审查合同较上月增长",
          value: formatGrowth(reviewMonthly.current, reviewMonthly.previous),
        },
      ],
      risks,
      meta: {
        month: label,
        consultThisMonth: consultMonthly.current,
        consultLastMonth: consultMonthly.previous,
        reviewThisMonth: reviewMonthly.current,
        reviewLastMonth: reviewMonthly.previous,
        reviewTotal,
        riskFlagged,
        generatedAt: Date.now(),
      },
    };

    ["heatmap", "frequentQuestions", "suggestions"].forEach((key) => {
      if (Array.isArray(stored[key]) && stored[key].length) {
        data[key] = stored[key];
      }
    });

    return { ok: true, data };
  } catch (error) {
    console.error("getReportData failed", error);
    return {
      ok: false,
      error: error?.message || error?.errMsg || "报表数据计算失败",
    };
  }
};
