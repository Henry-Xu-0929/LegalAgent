const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const DEFAULT_PAGE_SIZE = 20;

const normalizeTimestamp = (value, fallback) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return fallback;
};

const formatDate = (value) => {
  if (!value) return "";
  const time = normalizeTimestamp(value, 0);
  if (!time) return "";
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

const toText = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((item) => toText(item)).filter(Boolean).join(" ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const toBool = (value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  const text = toText(value).toLowerCase();
  return text === "true" || text === "1" || text === "yes";
};

const compactKeywords = (keywords = []) => {
  const unique = [];
  keywords.forEach((item) => {
    const keyword = toText(item);
    if (!keyword) {
      return;
    }
    if (!unique.includes(keyword)) {
      unique.push(keyword);
    }
  });
  return unique.slice(0, 12);
};

const buildSummary = (content, summary) => {
  const rawSummary = toText(summary);
  if (rawSummary) {
    return rawSummary.slice(0, 220);
  }
  return toText(content).replace(/\s+/g, " ").slice(0, 220);
};

const stripMarkdown = (value) => {
  let text = toText(value).replace(/\r\n/g, "\n");
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
  return text;
};

const pruneContractTail = (value) => {
  const text = stripMarkdown(value);
  if (!text) {
    return "";
  }
  let lines = text.split("\n").map((line) => line.trim());
  const introPattern =
    /我将为您|已为您|下面为您|以下为您|以下是|根据您的|重新生成|更精简|草案如下|建议稿|模板如下|请参考|供参考|需要确认.*信息|需要先澄清|需要补充|合同起草前需澄清的事实/;
  const contractStartPattern =
    /合同编号|甲方[:：]|乙方[:：]|出租方[:：]|承租方[:：]|买方[:：]|卖方[:：]|第[一二三四五六七八九十]+条|[一二三四五六七八九十]+、|租赁期限|违约责任|争议解决|签订日期|签订地点|^.{0,24}合同$|^.{0,24}协议$/;
  const contractStartIndex = lines.findIndex((line) => contractStartPattern.test(line) && !introPattern.test(line));
  if (contractStartIndex > 0) {
    lines = lines.slice(contractStartIndex);
  } else {
    while (lines.length && introPattern.test(lines[0])) {
      lines.shift();
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
};

const buildSearchText = (payload) => {
  const keywordsText = Array.isArray(payload.keywords) ? payload.keywords.join(" ") : "";
  const manualEditSearchText = Array.isArray(payload.manualEditHistory)
    ? payload.manualEditHistory
      .map((entry) => {
        const traces = Array.isArray(entry?.trace) ? entry.trace : [];
        const traceText = traces
          .map((trace) => [trace?.lineNo ? `第${trace.lineNo}行` : "", trace?.before || "", trace?.after || ""].filter(Boolean).join(" "))
          .filter(Boolean)
          .join(" ");
        return [entry?.summary || "", traceText].filter(Boolean).join(" ");
      })
      .filter(Boolean)
      .join(" ")
    : "";
  return [
    payload.title,
    payload.category,
    payload.docType,
    payload.caseTitle,
    payload.caseKey,
    payload.party,
    payload.status,
    payload.summary,
    payload.content,
    keywordsText,
    manualEditSearchText,
    payload.fileId,
    payload.fileName,
    payload.fileType,
  ].map((item) => toText(item)).filter(Boolean).join("\n");
};

const buildManualEditTrace = (beforeContent, afterContent) => {
  const beforeLines = String(beforeContent || "").replace(/\r\n/g, "\n").split("\n");
  const afterLines = String(afterContent || "").replace(/\r\n/g, "\n").split("\n");
  const maxLength = Math.max(beforeLines.length, afterLines.length);
  const traces = [];
  for (let index = 0; index < maxLength; index += 1) {
    const before = toText(beforeLines[index] == null ? "" : beforeLines[index]);
    const after = toText(afterLines[index] == null ? "" : afterLines[index]);
    if (before === after) {
      continue;
    }
    traces.push({
      lineNo: index + 1,
      before: before.slice(0, 120),
      after: after.slice(0, 120),
    });
    if (traces.length >= 30) {
      break;
    }
  }
  return traces;
};

const normalizeStatusBase = (statusText) =>
  toText(statusText)
    .replace(/第\s*[0-9一二三四五六七八九十百]+\s*版/g, "")
    .replace(/\s+/g, " ")
    .trim();

const buildVersionStatus = (statusText, versionNo, finalConfirmed) => {
  const base = normalizeStatusBase(statusText) || "已生成";
  if (finalConfirmed || /(最终|定稿)/.test(base)) {
    return "定稿版";
  }
  if (/已上传/.test(base)) {
    return "已上传";
  }
  if (/生成中/.test(base)) {
    return "生成中";
  }
  if (/已生成|生成/.test(base)) {
    return "已生成";
  }
  return base || "已生成";
};

const isInvalidContractContent = (value) => {
  const text = toText(value).trim();
  if (!text) {
    return true;
  }
  if (/^一、\s*需确认的事实与信息/.test(text)) {
    return true;
  }
  if (/^合同前提建议[:：]?/m.test(text)) {
    return true;
  }
  if (/^请先补充以下信息[:：]?/m.test(text)) {
    return true;
  }
  if (/^生成中(?:\s*第\d+版)?$/m.test(text)) {
    return true;
  }
  if (/需要先澄清|需要确认.*信息|请补充以下信息/.test(text)) {
    if (!/第[一二三四五六七八九十百]+条|甲方[:：].*乙方[:：]|违约责任|争议解决/.test(text)) {
      return true;
    }
  }
  return false;
};

const isContractLikeRecord = (item = {}) => {
  const category = toText(item?.category);
  const docType = toText(item?.docType);
  const title = toText(item?.title);
  return /(合同|协议|补充协议|意向书|合同起草|合同审查)/.test(`${category} ${docType} ${title}`);
};

const escapeRegExp = (input) => String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeContracts = (list) =>
  list
    .filter((item) => {
      const statusText = toText(item?.status);
      if (/^生成中(?:\s*第\d+版)?$/.test(statusText)) {
        return false;
      }
      if (!isContractLikeRecord(item)) {
        return true;
      }
      return !isInvalidContractContent(item?.content || item?.summary);
    })
    .map((item) => ({
    id: item._id,
    title: item.title || "",
    party: item.party || "",
    status: buildVersionStatus(item.status || "", Number(item.versionNo || 1), !!item.finalConfirmed),
    category: item.category || "未分类",
    sourceType: item.sourceType || "",
    summary: item.summary || "",
    keywords: Array.isArray(item.keywords) ? item.keywords : [],
    fileId: item.fileId || "",
    fileName: item.fileName || "",
    fileType: item.fileType || "",
    docType: item.docType || "",
    caseKey: item.caseKey || "",
    caseTitle: item.caseTitle || "",
    contractGroupKey: item.contractGroupKey || "",
    manualEdited: !!item.manualEdited,
    manualEditCount: Number(item.manualEditCount || 0),
    manualEditUpdatedAt: formatDate(item.manualEditUpdatedAt || item.updatedAt),
    versionNo: Number(item.versionNo || 1),
    finalConfirmed: !!item.finalConfirmed,
    createdAt: formatDate(item.createdAt),
    updatedAt: formatDate(item.updatedAt),
    createdAtTs: normalizeTimestamp(item.createdAt, 0),
    updatedAtTs: normalizeTimestamp(item.updatedAt, 0),
  }));

const normalizeContractDetail = (item) => ({
  id: item._id,
  title: item.title || "",
  party: item.party || "",
  status: buildVersionStatus(item.status || "", Number(item.versionNo || 1), !!item.finalConfirmed),
  category: item.category || "未分类",
  sourceType: item.sourceType || "",
  summary: item.summary || "",
  content: item.content || "",
  keywords: Array.isArray(item.keywords) ? item.keywords : [],
  fileId: item.fileId || "",
  fileName: item.fileName || "",
  fileType: item.fileType || "",
  docType: item.docType || "",
  caseKey: item.caseKey || "",
  caseTitle: item.caseTitle || "",
  contractGroupKey: item.contractGroupKey || "",
  manualEdited: !!item.manualEdited,
  manualEditCount: Number(item.manualEditCount || 0),
  manualEditUpdatedAt: formatDate(item.manualEditUpdatedAt || item.updatedAt),
  manualEditHistory: Array.isArray(item.manualEditHistory) ? item.manualEditHistory : [],
  versionNo: Number(item.versionNo || 1),
  finalConfirmed: !!item.finalConfirmed,
  createdAt: formatDate(item.createdAt),
  updatedAt: formatDate(item.updatedAt),
  createdAtTs: normalizeTimestamp(item.createdAt, 0),
  updatedAtTs: normalizeTimestamp(item.updatedAt, 0),
});

const buildBaseWhere = (openId) => {
  const userOpenId = toText(openId);
  if (!userOpenId) {
    return {};
  }
  return _.or([
    { _openid: userOpenId },
    { ownerOpenId: userOpenId },
    _.and([
      { _openid: _.exists(false) },
      { ownerOpenId: _.exists(false) },
    ]),
  ]);
};

const buildFilterWhere = (openId, event) => {
  const query = toText(event?.query);
  const keyword = toText(event?.keyword);
  const category = toText(event?.category);
  const sourceType = toText(event?.sourceType);
  const caseKey = toText(event?.caseKey);
  const conditions = [];
  const base = buildBaseWhere(openId);
  if (base && Object.keys(base).length) {
    conditions.push(base);
  }
  if (category && category !== "all") {
    conditions.push({ category });
  }
  if (sourceType) {
    conditions.push({ sourceType });
  }
  if (caseKey) {
    conditions.push({ caseKey });
  }
  const regexSource = query || keyword;
  if (regexSource) {
    const regex = db.RegExp({ regexp: escapeRegExp(regexSource), options: "i" });
    conditions.push({ searchableText: regex });
  }
  if (!conditions.length) {
    return {};
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return _.and(conditions);
};

exports.main = async (event) => {
  const action = event?.action;
  const contracts = db.collection("contracts");
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  try {
    if (action === "list") {
      const page = Math.max(Number(event?.page || 1), 1);
      const size = Math.min(Math.max(Number(event?.size || DEFAULT_PAGE_SIZE), 1), 50);
      const where = buildFilterWhere(openId, event);
      const countRes = await contracts.where(where).count();
      const res = await contracts
        .where(where)
        .orderBy("updatedAt", "desc")
        .skip((page - 1) * size)
        .limit(size)
        .get();
      const normalizedList = normalizeContracts(res.data || []);
      return {
        ok: true,
        data: normalizedList,
        total: countRes.total || 0,
        page,
        size,
      };
    }
    if (action === "search") {
      const where = buildFilterWhere(openId, event);
      const res = await contracts.where(where).orderBy("updatedAt", "desc").limit(100).get();
      return {
        ok: true,
        data: normalizeContracts(res.data || []),
      };
    }
    if (action === "detail") {
      const id = toText(event?.id);
      if (!id) {
        return { ok: false, error: "缺少合同ID" };
      }
      const res = await contracts.doc(id).get();
      const item = res.data;
      const itemOwner = toText(item?.ownerOpenId) || toText(item?._openid);
      const userOpenId = toText(openId);
      if (!item || (userOpenId && itemOwner && itemOwner !== userOpenId)) {
        return { ok: false, error: "合同不存在" };
      }
      if (isContractLikeRecord(item) && isInvalidContractContent(item?.content || item?.summary)) {
        return { ok: false, error: "合同内容无效或已过期" };
      }
      return { ok: true, data: normalizeContractDetail(item) };
    }
    if (action === "saveFromChat") {
      const now = Date.now();
      const payload = event?.payload || {};
      const category = toText(payload.category) || "未分类";
      const docType = toText(payload.docType);
      const isContractLike = isContractLikeRecord({ category, docType, title: payload?.title });
      const cleanedContent = isContractLike ? pruneContractTail(payload.content) : "";
      const content = (cleanedContent || toText(payload.content)).slice(0, 80000);
      if (isContractLike && isInvalidContractContent(content)) {
        return { ok: false, error: "内容不符合合同正文归档条件" };
      }
      const title = toText(payload.title) || `${category}-${formatDate(now)}`;
      const cleanedSummary = isContractLike ? pruneContractTail(payload.summary || content) : toText(payload.summary || content);
      const finalConfirmed = toBool(payload.finalConfirmed);
      const contractGroupKey = toText(payload.contractGroupKey);
      const data = {
        title,
        category,
        sourceType: toText(payload.sourceType) || "chat",
        party: toText(payload.party),
        status: toText(payload.status) || "已生成",
        summary: buildSummary(content, cleanedSummary),
        content,
        keywords: compactKeywords(payload.keywords || []),
        fileId: toText(payload.fileId),
        fileName: toText(payload.fileName),
        fileType: toText(payload.fileType),
        docType,
        caseKey: toText(payload.caseKey),
        caseTitle: toText(payload.caseTitle),
        ownerOpenId: toText(payload.ownerOpenId) || toText(openId),
        archiveKey: toText(payload.archiveKey),
        contractGroupKey,
        finalConfirmed,
        createdAt: normalizeTimestamp(payload.createdAt, now),
        updatedAt: now,
      };
      data.searchableText = buildSearchText(data).slice(0, 120000);
      const id = toText(payload.id);
      if (id) {
        try {
          const exists = await contracts.doc(id).get();
          const existsOwner = toText(exists?.data?.ownerOpenId) || toText(exists?.data?._openid);
          const userOpenId = toText(openId);
          if (exists.data && (!userOpenId || !existsOwner || existsOwner === userOpenId)) {
            const existsVersionNo = Number(exists?.data?.versionNo || 1);
            data.versionNo = existsVersionNo;
            data.contractGroupKey = toText(exists?.data?.contractGroupKey) || contractGroupKey || id;
            data.status = buildVersionStatus(data.status, data.versionNo, finalConfirmed);
            await contracts.doc(id).update({ data });
            if (finalConfirmed && data.contractGroupKey) {
              const sameGroup = await contracts.where({
                ownerOpenId: data.ownerOpenId,
                contractGroupKey: data.contractGroupKey,
              }).get();
              const removeIds = (sameGroup.data || []).map((item) => item._id).filter((itemId) => itemId && itemId !== id);
              for (const removeId of removeIds) {
                await contracts.doc(removeId).remove();
              }
            }
            return { ok: true, data: { id, updatedAt: formatDate(now) } };
          }
        } catch (e) {
          console.log("saveFromChat update fallback", e);
        }
      }
      if (data.archiveKey) {
        const whereByKey = data.ownerOpenId
          ? { ownerOpenId: data.ownerOpenId, archiveKey: data.archiveKey }
          : { archiveKey: data.archiveKey };
        const existedByKey = await contracts.where(whereByKey).orderBy("updatedAt", "desc").limit(1).get();
        const existedItem = Array.isArray(existedByKey.data) ? existedByKey.data[0] : null;
        if (existedItem?._id) {
          const existedVersionNo = Number(existedItem?.versionNo || 1);
          data.versionNo = existedVersionNo;
          data.contractGroupKey = toText(existedItem?.contractGroupKey) || contractGroupKey || existedItem._id;
          data.status = buildVersionStatus(data.status, data.versionNo, finalConfirmed);
          await contracts.doc(existedItem._id).update({ data });
          if (finalConfirmed && data.contractGroupKey) {
            const sameGroup = await contracts.where({
              ownerOpenId: data.ownerOpenId,
              contractGroupKey: data.contractGroupKey,
            }).get();
            const removeIds = (sameGroup.data || [])
              .map((item) => item._id)
              .filter((itemId) => itemId && itemId !== existedItem._id);
            for (const removeId of removeIds) {
              await contracts.doc(removeId).remove();
            }
          }
          return { ok: true, data: { id: existedItem._id, updatedAt: formatDate(now) } };
        }
      }
      if (contractGroupKey) {
        const sameGroupRes = await contracts.where({
          ownerOpenId: data.ownerOpenId,
          contractGroupKey,
        }).orderBy("updatedAt", "desc").limit(10).get();
        const sameGroupList = Array.isArray(sameGroupRes.data) ? sameGroupRes.data : [];
        const maxVersionNo = sameGroupList.reduce((max, item) => Math.max(max, Number(item?.versionNo || 1)), 0);
        data.versionNo = maxVersionNo + 1;
        data.status = buildVersionStatus(data.status, data.versionNo, finalConfirmed);
        const addRes = await contracts.add({ data });
        if (finalConfirmed) {
          for (const item of sameGroupList) {
            if (item?._id) {
              await contracts.doc(item._id).remove();
            }
          }
          return { ok: true, data: { id: addRes._id, updatedAt: formatDate(now) } };
        }
        const nonFinalList = [addRes._id, ...sameGroupList.filter((item) => !item?.finalConfirmed).map((item) => item._id).filter(Boolean)];
        const keepIds = nonFinalList.slice(0, 2);
        for (const item of sameGroupList) {
          if (!item?._id) {
            continue;
          }
          if (item?.finalConfirmed) {
            continue;
          }
          if (!keepIds.includes(item._id)) {
            await contracts.doc(item._id).remove();
          }
        }
        return { ok: true, data: { id: addRes._id, updatedAt: formatDate(now) } };
      }
      data.versionNo = Number(payload.versionNo || 1) || 1;
      data.status = buildVersionStatus(data.status, data.versionNo, finalConfirmed);
      const addRes = await contracts.add({ data });
      await contracts.doc(addRes._id).update({
        data: {
          contractGroupKey: addRes._id,
          searchableText: buildSearchText({ ...data, contractGroupKey: addRes._id }).slice(0, 120000),
        },
      });
      return { ok: true, data: { id: addRes._id, updatedAt: formatDate(now) } };
    }
    if (action === "updateManualEdit") {
      const id = toText(event?.id);
      if (!id) {
        return { ok: false, error: "缺少合同ID" };
      }
      const nextContent = String(event?.content || "").replace(/\r\n/g, "\n");
      if (!nextContent.trim()) {
        return { ok: false, error: "编辑内容不能为空" };
      }
      const detailRes = await contracts.doc(id).get();
      const item = detailRes?.data;
      const itemOwner = toText(item?.ownerOpenId) || toText(item?._openid);
      const userOpenId = toText(openId);
      if (!item || (userOpenId && itemOwner && itemOwner !== userOpenId)) {
        return { ok: false, error: "合同不存在" };
      }
      const now = Date.now();
      const oldContent = String(item?.content || "").replace(/\r\n/g, "\n");
      const clippedContent = nextContent.slice(0, 80000);
      const trace = buildManualEditTrace(oldContent, clippedContent);
      const oldHistory = Array.isArray(item?.manualEditHistory) ? item.manualEditHistory : [];
      const newEntry = {
        editedAt: now,
        summary: `编辑${trace.length}处`,
        trace: trace.slice(0, 12),
      };
      const manualEditHistory = [newEntry, ...oldHistory].slice(0, 20);
      const manualEditCount = Number(item?.manualEditCount || 0) + 1;
      const nextSummary = buildSummary(clippedContent, event?.summary || item?.summary || clippedContent);
      const updatePayload = {
        content: clippedContent,
        summary: nextSummary,
        manualEdited: true,
        manualEditCount,
        manualEditUpdatedAt: now,
        manualEditHistory,
        updatedAt: now,
      };
      updatePayload.searchableText = buildSearchText({
        ...item,
        ...updatePayload,
      }).slice(0, 120000);
      await contracts.doc(id).update({
        data: updatePayload,
      });
      const latestRes = await contracts.doc(id).get();
      return {
        ok: true,
        data: normalizeContractDetail(latestRes?.data || { ...item, ...updatePayload, _id: id }),
      };
    }
    if (action === "delete") {
      const id = toText(event?.id);
      if (!id) {
        return { ok: false, error: "缺少合同ID" };
      }
      let item = null;
      try {
        const res = await contracts.doc(id).get();
        item = res.data || null;
      } catch (error) {
        const errText = `${error?.message || ""} ${error?.errMsg || ""}`.toLowerCase();
        if (/not\s*exist|不存在|无记录/.test(errText)) {
          return { ok: true };
        }
        throw error;
      }
      const itemOwner = toText(item?.ownerOpenId) || toText(item?._openid);
      const userOpenId = toText(openId);
      if (!item || (userOpenId && itemOwner && itemOwner !== userOpenId)) {
        return { ok: false, error: "合同不存在" };
      }
      try {
        await contracts.doc(id).remove();
      } catch (error) {
        const errText = `${error?.message || ""} ${error?.errMsg || ""}`.toLowerCase();
        if (/not\s*exist|不存在|无记录/.test(errText)) {
          return { ok: true };
        }
        throw error;
      }
      return { ok: true };
    }
    return { ok: false, error: "不支持的操作" };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || error?.errMsg || "合同请求失败",
    };
  }
};
