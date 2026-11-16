const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

// 云开发集合名区分大小写；如果实际集合是小写，请同步修改这三个常量
const SESSIONS_COLLECTION = "Agent_UI_Sessions";
const CONTRACTS_COLLECTION = "Contracts";
const REPORTS_COLLECTION = "Reports";

const REPORT_DOC_ID = "overview";
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const QUESTION_PAGE_SIZE = 1000;
const MAX_QUESTIONS = 10000;
const TOP_QUESTION_LIMIT = 4;
const MAX_MERGE_CANDIDATES = 400;
const SIMILARITY_THRESHOLD = 0.55;

// 当前自然月（北京时间）的起止毫秒时间戳
const getMonthRange = () => {
  const now = new Date(Date.now() + TZ_OFFSET_MS);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    monthLabel: `${year}-${String(month + 1).padStart(2, "0")}`,
    startTs: Date.UTC(year, month, 1) - TZ_OFFSET_MS,
    endTs: Date.UTC(year, month + 1, 1) - TZ_OFFSET_MS,
  };
};

const readTotal = (res, field = "total") => {
  const row = Array.isArray(res?.list) ? res.list[0] : null;
  return Number(row?.[field] || 0);
};

// 本月咨询数：Agent_UI_Sessions 中 activeFeatureKey = consult
const countConsultations = async (startTs, endTs) => {
  const res = await db
    .collection(SESSIONS_COLLECTION)
    .aggregate()
    .match({
      activeFeatureKey: "consult",
      createdAtTs: _.gte(startTs).and(_.lt(endTs)),
    })
    .group({
      _id: null,
      total: $.sum(1),
    })
    .end();
  return readTotal(res);
};

// 本月审查合同数 + 风险点总数
// risks 缺失或不是数组时按 0 处理，避免 $size 报错
const countReviewedContractsAndRisks = async (startTs, endTs) => {
  const res = await db
    .collection(CONTRACTS_COLLECTION)
    .aggregate()
    .match({
      category: "合同审查",
      createdAtTs: _.gte(startTs).and(_.lt(endTs)),
    })
    .addFields({
      riskCount: $.cond({
        if: $.isArray("$risks"),
        then: $.size("$risks"),
        else: 0,
      }),
    })
    .group({
      _id: null,
      reviewCount: $.sum(1),
      riskCount: $.sum("$riskCount"),
    })
    .end();
  const row = Array.isArray(res?.list) ? res.list[0] : null;
  return {
    reviewCount: Number(row?.reviewCount || 0),
    riskCount: Number(row?.riskCount || 0),
  };
};

// 分页拉取本月咨询提问，只取 question 字段，降低传输与内存开销
const fetchMonthlyQuestions = async (startTs, endTs) => {
  const questions = [];
  let offset = 0;

  while (offset < MAX_QUESTIONS) {
    const res = await db
      .collection(SESSIONS_COLLECTION)
      .where({
        activeFeatureKey: "consult",
        createdAtTs: _.gte(startTs).and(_.lt(endTs)),
      })
      .field({ question: true })
      .orderBy("createdAtTs", "asc")
      .skip(offset)
      .limit(QUESTION_PAGE_SIZE)
      .get();

    const list = Array.isArray(res?.data) ? res.data : [];
    list.forEach((item) => {
      const question = typeof item?.question === "string" ? item.question.trim() : "";
      if (question) {
        questions.push(question);
      }
    });

    if (list.length < QUESTION_PAGE_SIZE) {
      break;
    }
    offset += list.length;
  }

  if (offset >= MAX_QUESTIONS) {
    console.warn(
      `[updateReportStats] 提问数量达到上限 ${MAX_QUESTIONS}，仅统计前 ${MAX_QUESTIONS} 条`
    );
  }
  return questions;
};

// ASCII 标点 + 中文标点(U+3000-303F) + 全角符号(U+FF01-FF0F/U+FF1A-FF20/U+FF3B-FF40/U+FF5B-FF65)
const PUNCTUATION_REGEX =
  /[\s　-〿！-／：-＠［-｀｛-･!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;

const STOP_WORDS = [
  "请问一下",
  "我想问一下",
  "麻烦问一下",
  "咨询一下",
  "请教一下",
  "我想问",
  "想问一下",
  "麻烦问",
  "想问",
  "请问",
  "请教",
  "咨询",
  "你好",
  "您好",
  "能不能",
  "可不可以",
  "能否",
  "可以",
  "是否",
  "怎么样",
  "怎么办",
  "怎么",
  "如何",
  "一下",
  "吗",
  "呢",
  "啊",
  "吧",
  "呀",
].sort((a, b) => b.length - a.length);

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STOP_WORD_REGEX = new RegExp(
  STOP_WORDS.map(escapeRegExp).join("|"),
  "g"
);

// 轻量清洗：去标点、常见停用词，英文转小写
const cleanQuestion = (raw) => {
  let text = String(raw == null ? "" : raw).toLowerCase();
  text = text.replace(PUNCTUATION_REGEX, "");
  text = text.replace(STOP_WORD_REGEX, "");
  return text.trim();
};

// 中文用字符二元组，英文用单词，作为 Jaccard 相似度 token
const buildSimilarityTokens = (text) => {
  const tokens = new Set();
  const latinWords = text.match(/[a-z0-9]+/g) || [];
  latinWords.forEach((word) => tokens.add(word));

  // 保留 CJK 统一表意文字（U+3400-U+9FFF）
  const cjk = text.replace(/[^㐀-鿿]/g, "");
  if (cjk.length === 1) {
    tokens.add(cjk);
  }
  for (let index = 0; index < cjk.length - 1; index += 1) {
    tokens.add(cjk.slice(index, index + 2));
  }

  if (!tokens.size && text) {
    tokens.add(text);
  }
  return tokens;
};

const jaccardSimilarity = (left, right) => {
  if (!left.size || !right.size) {
    return 0;
  }
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let intersection = 0;
  small.forEach((token) => {
    if (large.has(token)) {
      intersection += 1;
    }
  });
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
};

const pickDisplayQuestion = (cluster) => {
  let display = "";
  let bestCount = -1;
  cluster.displayCounts.forEach((count, text) => {
    if (count > bestCount || (count === bestCount && text.length < display.length)) {
      display = text;
      bestCount = count;
    }
  });
  return display;
};

// 先用清洗后前 10 个字分桶，再对高频桶做 Jaccard 合并
const buildTopQuestions = (rawQuestions) => {
  const exactClusters = new Map();

  rawQuestions.forEach((raw) => {
    const original = String(raw || "").trim();
    if (!original) {
      return;
    }
    const cleaned = cleanQuestion(original);
    if (!cleaned) {
      return;
    }

    const key = Array.from(cleaned).slice(0, 10).join("");
    let cluster = exactClusters.get(key);
    if (!cluster) {
      cluster = {
        count: 0,
        tokens: buildSimilarityTokens(cleaned),
        displayCounts: new Map(),
      };
      exactClusters.set(key, cluster);
    }
    cluster.count += 1;
    cluster.displayCounts.set(
      original,
      (cluster.displayCounts.get(original) || 0) + 1
    );
  });

  // 只对出现次数靠前的桶做两两相似度比较，控制最坏情况下的计算量
  const candidates = Array.from(exactClusters.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, MAX_MERGE_CANDIDATES);

  const mergedClusters = [];
  candidates.forEach((candidate) => {
    let target = null;
    for (const existing of mergedClusters) {
      if (
        jaccardSimilarity(existing.tokens, candidate.tokens) >=
        SIMILARITY_THRESHOLD
      ) {
        target = existing;
        break;
      }
    }

    if (!target) {
      mergedClusters.push({
        count: candidate.count,
        tokens: candidate.tokens,
        displayCounts: new Map(candidate.displayCounts),
      });
      return;
    }

    target.count += candidate.count;
    candidate.displayCounts.forEach((count, text) => {
      target.displayCounts.set(
        text,
        (target.displayCounts.get(text) || 0) + count
      );
    });
  });

  return mergedClusters
    .sort((left, right) => right.count - left.count)
    .slice(0, TOP_QUESTION_LIMIT)
    .map((cluster) => ({
      question: pickDisplayQuestion(cluster),
      count: cluster.count,
    }));
};

exports.main = async () => {
  try {
    const { monthLabel, startTs, endTs } = getMonthRange();

    const [consultCount, contractStats, rawQuestions] = await Promise.all([
      countConsultations(startTs, endTs),
      countReviewedContractsAndRisks(startTs, endTs),
      fetchMonthlyQuestions(startTs, endTs),
    ]);

    const topQuestions = buildTopQuestions(rawQuestions);
    const now = Date.now();

    const reportData = {
      type: "overview",
      month: monthLabel,
      period: {
        startTs,
        endTs,
      },
      consultCount,
      reviewCount: contractStats.reviewCount,
      riskCount: contractStats.riskCount,
      topQuestions,
      updatedAt: now,
    };

    // doc('overview').set 是 upsert 语义，多次执行结果一致（幂等）
    await db
      .collection(REPORTS_COLLECTION)
      .doc(REPORT_DOC_ID)
      .set({ data: reportData });

    console.log(
      `[updateReportStats] ${monthLabel} consult=${consultCount} review=${contractStats.reviewCount} risk=${contractStats.riskCount} questions=${rawQuestions.length}`
    );

    return {
      ok: true,
      data: reportData,
    };
  } catch (error) {
    console.error("[updateReportStats] failed", error);
    return {
      ok: false,
      error: error?.message || error?.errMsg || "报表统计失败",
    };
  }
};
