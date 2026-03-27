module.exports = {
  normalizeRetrievalToken: function (value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[【】\[\]（）()《》<>]/g, "")
      .replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
  },
  isLowValueRetrievalToken: function (value) {
    const token = this.normalizeRetrievalToken(value);
    if (!token || token.length < 2) {
      return true;
    }
    if (/^\d+$/.test(token)) {
      return true;
    }
    return [
      "帮我", "请帮我", "请", "一下", "一个", "一份", "那个", "这个", "这个案子", "那个案子",
      "这份", "那份", "上述", "前述", "相关", "需要", "可以", "是否", "怎么", "怎样", "什么",
      "进行", "作为", "关于", "我的", "里面", "已经", "之前", "现在", "继续", "一下子",
      "调出", "调用", "读取", "找出", "找到", "定位", "检索", "匹配", "搜索", "恢复", "引用",
      "使用", "原来", "原先", "再次", "重新", "基础上", "一版", "版本", "重写", "改写", "优化", "修改"
    ].includes(token);
  },
  extractRetrievalTokens: function (queryText, options = {}) {
    const query = String(queryText || "").trim();
    if (!query) {
      return [];
    }
    const minLength = Math.max(2, Number(options.minLength || 2));
    const maxLength = Math.max(minLength, Number(options.maxLength || 24));
    const maxTokens = Math.max(1, Number(options.maxTokens || 50));
    const includeNgrams = options.includeNgrams !== false;
    const preferLonger = options.preferLonger !== false;
    const bag = [];
    query
      .replace(/[\r\n\t]+/g, " ")
      .split(/[\s,，。！？；;:：、\/\\|]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => bag.push(item));
    const phraseMatches = query.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,40}/g) || [];
    bag.push(...phraseMatches);
    if (includeNgrams) {
      const compact = query.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
      const ngrams = [];
      for (let i = 0; i < compact.length; i++) {
        for (let size = 2; size <= 5; size++) {
          if (i + size > compact.length) {
            continue;
          }
          ngrams.push(compact.slice(i, i + size));
        }
      }
      bag.push(...ngrams.slice(0, 200));
    }
    const seen = {};
    const tokens = [];
    bag.forEach((item) => {
      const raw = String(item || "").trim();
      const normalized = this.normalizeRetrievalToken(raw);
      if (!normalized || normalized.length < minLength || normalized.length > maxLength) {
        return;
      }
      if (this.isLowValueRetrievalToken(normalized) || seen[normalized]) {
        return;
      }
      seen[normalized] = true;
      tokens.push(normalized);
    });
    if (preferLonger) {
      tokens.sort((a, b) => b.length - a.length);
    }
    return tokens.slice(0, maxTokens);
  },
  extractReviewQueryKeywords: function (queryText) {
    return this.extractRetrievalTokens(queryText, {
      includeNgrams: true,
      minLength: 2,
      maxLength: 16,
      maxTokens: 50,
      preferLonger: true,
    });
  },
  buildCompactRetrievalWindows: function (queryText, options = {}) {
    const compact = this.normalizeRetrievalToken(queryText);
    if (!compact) {
      return [];
    }
    const minGram = Math.max(2, Number(options.minGram || 3));
    const maxGram = Math.max(minGram, Number(options.maxGram || 6));
    const maxTokens = Math.max(1, Number(options.maxTokens || 24));
    const seen = {};
    const ranked = [];
    for (let size = maxGram; size >= minGram; size--) {
      for (let i = 0; i + size <= compact.length; i++) {
        const token = compact.slice(i, i + size);
        if (!token || seen[token] || this.isLowValueRetrievalToken(token)) {
          continue;
        }
        seen[token] = true;
        ranked.push({
          token,
          score: size * 10 - i,
        });
      }
    }
    return ranked
      .sort((a, b) => b.score - a.score)
      .map((item) => item.token)
      .slice(0, maxTokens);
  },
  extractCoreCaseTokens: function (queryText) {
    const query = String(queryText || "").trim();
    if (!query) {
      return [];
    }
    const caseContext = this.extractCaseContext(query);
    const bag = [
      caseContext.caseTitle,
      caseContext.caseKey,
    ];
    const suitMatch = query.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,20})诉([\u4e00-\u9fa5A-Za-z0-9]{2,20})/);
    if (suitMatch) {
      bag.push(suitMatch[1], suitMatch[2], `${suitMatch[1]}诉${suitMatch[2]}`);
    }
    bag.push(...this.extractArchivePartyTokens(query));
    const quotedMatches = [];
    const quotedReg = /《([^》]{2,40})》/g;
    let quoted = quotedReg.exec(query);
    while (quoted) {
      quotedMatches.push(quoted[1]);
      quoted = quotedReg.exec(query);
    }
    bag.push(...quotedMatches);
    const caseLikeMatches = query.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,40}(?:纠纷案|案件|纠纷|一案)/g) || [];
    bag.push(...caseLikeMatches);
    const genericCoreHints = this.extractRetrievalTokens(query, {
      includeNgrams: false,
      minLength: 2,
      maxLength: 20,
      maxTokens: 16,
      preferLonger: true,
    }).filter((token) => {
      if (!token) {
        return false;
      }
      if (/(律师意见|法律意见|起诉状|答辩状|申请书|律师函|代理词|质证意见|卷宗|案卷|材料|证据材料|优化|再优化|修改|重写|改写|生成|起草)/.test(token)) {
        return false;
      }
      return /诉|纠纷|案件|一案|项目|案号/.test(token);
    });
    bag.push(...genericCoreHints);
    const seen = {};
    return bag
      .map((item) => String(item || "").trim())
      .map((item) => item.replace(/(?:纠纷案|案件|纠纷|一案)$/g, ""))
      .map((item) => this.normalizeRetrievalToken(item))
      .filter((item) => item.length >= 2)
      .filter((item) => {
        if (seen[item]) {
          return false;
        }
        seen[item] = true;
        return true;
      })
      .slice(0, 28);
  },
  extractCaseEntityTokens: function (queryText) {
    const query = String(queryText || "").trim();
    const coreTokens = this.extractCoreCaseTokens(query);
    const keywordTokens = this.extractReviewQueryKeywords(query)
      .filter((item) => String(item || "").length >= 3)
      .slice(0, 12);
    const seen = {};
    return [...coreTokens, ...keywordTokens].filter((item) => {
      const token = String(item || "").trim();
      if (!token || seen[token]) {
        return false;
      }
      seen[token] = true;
      return true;
    });
  },
  buildArchivedQuerySignals: function (queryText) {
    const query = String(queryText || "").trim();
    const keywords = this.extractReviewQueryKeywords(query).slice(0, 40);
    const coreCaseTokens = this.extractCoreCaseTokens(query).slice(0, 24);
    const caseTokens = this.extractCaseEntityTokens(query).slice(0, 24);
    const partyTokens = this.extractArchivePartyTokens(query).slice(0, 12);
    const referenceTokens = this.extractArchiveReferenceTokens(query).slice(0, 12);
    const docIntentTokens = this.extractArchiveDocIntentTokens(query).slice(0, 12);
    const signalSet = {};
    const signals = [];
    [...partyTokens, ...referenceTokens, ...docIntentTokens, ...caseTokens, ...keywords].forEach((word) => {
      const token = String(word || "").trim();
      if (token.length < 2 || signalSet[token]) {
        return;
      }
      signalSet[token] = true;
      signals.push(token);
    });
    return {
      query,
      keywords,
      coreCaseTokens,
      caseTokens,
      partyTokens,
      referenceTokens,
      docIntentTokens,
      signals: signals.slice(0, 60),
    };
  },
  buildArchivedSearchQueries: function (queryText, querySignals = null) {
    const query = String(queryText || "").trim();
    const signals = querySignals || this.buildArchivedQuerySignals(query);
    const compactWindows = this.buildCompactRetrievalWindows(query, {
      minGram: 3,
      maxGram: 6,
      maxTokens: 24,
    });
    const queue = [];
    const put = (value) => {
      const text = String(value || "").trim();
      if (!text) {
        return;
      }
      if (queue.includes(text)) {
        return;
      }
      queue.push(text);
    };
    const caseContext = this.extractCaseContext(query);
    put(caseContext.caseTitle);
    put(caseContext.caseKey);
    this.buildCaseTitleFragments(caseContext.caseTitle).forEach((token) => put(token));
    (signals.partyTokens || []).forEach((token) => put(token));
    (signals.referenceTokens || []).forEach((token) => put(token));
    (signals.docIntentTokens || []).forEach((token) => put(token));
    (signals.coreCaseTokens || []).forEach((token) => put(token));
    compactWindows.forEach((token) => put(token));
    query
      .replace(/\r\n/g, "\n")
      .split(/[\n。！？；;]/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && item.length <= 48)
      .slice(0, 4)
      .forEach((item) => put(item));
    const compactQuery = query.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
    if (compactQuery.length && compactQuery.length <= 48) {
      put(compactQuery);
    }
    (signals.keywords || []).slice(0, 18).forEach((token) => put(token));
    return queue.slice(0, 32);
  },
  extractLeadingText: function (value, lineCount = 4) {
    const text = String(value || "").replace(/\r\n/g, "\n");
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !!line);
    return lines.slice(0, Math.max(1, lineCount)).join("\n");
  },
  countSignalHits: function (text, tokens = [], limit = 40) {
    const source = String(text || "");
    if (!source) {
      return 0;
    }
    let count = 0;
    tokens.slice(0, limit).forEach((token) => {
      if (!token || token.length < 2) {
        return;
      }
      if (source.includes(token)) {
        count += 1;
      }
    });
    return count;
  },
  scoreSignalHits: function (text, tokens = [], weight = 1, limit = 40) {
    const source = String(text || "");
    if (!source) {
      return 0;
    }
    let score = 0;
    tokens.slice(0, limit).forEach((token) => {
      const word = String(token || "");
      if (word.length < 2) {
        return;
      }
      if (source.includes(word)) {
        const lenWeight = Math.min(6, Math.max(1, Math.floor(word.length / 2)));
        score += lenWeight * weight;
      }
    });
    return score;
  },
  computeQueryNgramCoverageScore: function (queryText, text) {
    const query = String(queryText || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
    const source = String(text || "");
    if (query.length < 4 || !source) {
      return 0;
    }
    const ngramSet = {};
    const ngrams = [];
    for (let i = 0; i < query.length; i++) {
      for (let size = 3; size <= 5; size++) {
        if (i + size > query.length) {
          continue;
        }
        const gram = query.slice(i, i + size);
        if (!ngramSet[gram]) {
          ngramSet[gram] = true;
          ngrams.push(gram);
        }
      }
    }
    const sliced = ngrams.slice(0, 80);
    if (!sliced.length) {
      return 0;
    }
    let hit = 0;
    sliced.forEach((gram) => {
      if (source.includes(gram)) {
        hit += 1;
      }
    });
    const ratio = hit / sliced.length;
    return Math.round(ratio * 24);
  },
  scoreArchivedCandidate: function (item, queryText, querySignals = null) {
    const signals = querySignals || this.buildArchivedQuerySignals(queryText);
    const query = String(signals?.query || queryText || "").trim();
    const title = String(item?.title || "");
    const summary = String(item?.summary || "");
    const caseTitle = String(item?.caseTitle || "");
    const docType = String(item?.docType || "");
    const category = String(item?.category || "");
    const party = String(item?.party || "");
    const fileName = String(item?.fileName || "");
    const sourceType = String(item?.sourceType || "");
    const keywordList = Array.isArray(item?.keywords) ? item.keywords : [];
    const keywordText = keywordList.join(" ");
    const fullText = `${title}\n${summary}\n${keywordText}\n${caseTitle}\n${docType}\n${category}\n${party}\n${fileName}\n${sourceType}`;
    let score = 0;
    const keywords = Array.isArray(signals?.keywords) ? signals.keywords : [];
    const caseTokens = Array.isArray(signals?.caseTokens) ? signals.caseTokens : [];
    const partyTokens = Array.isArray(signals?.partyTokens) ? signals.partyTokens : [];
    const referenceTokens = Array.isArray(signals?.referenceTokens) ? signals.referenceTokens : [];
    const docIntentTokens = Array.isArray(signals?.docIntentTokens) ? signals.docIntentTokens : [];
    if (title.length >= 2 && query.includes(title)) {
      score += 20;
    } else {
      for (let i = 0; i < title.length - 1; i++) {
        const biGram = title.slice(i, i + 2);
        if (query.includes(biGram)) score += 2;
      }
    }
    score += this.scoreSignalHits(title, caseTokens, 5, 18);
    score += this.scoreSignalHits(caseTitle, caseTokens, 4, 18);
    score += this.scoreSignalHits(`${title}\n${caseTitle}\n${party}\n${summary}`, partyTokens, 6, 12);
    score += this.scoreSignalHits(fullText, referenceTokens, 4, 16);
    score += this.scoreSignalHits(`${title}\n${docType}\n${category}\n${fileName}`, docIntentTokens, 5, 12);
    score += Math.min(36, this.scoreCaseTitleSimilarity(query, `${title}\n${caseTitle}`));
    score += this.scoreSignalHits(`${summary}\n${keywordText}`, keywords, 2, 28);
    score += this.scoreSignalHits(fullText, keywords, 1, 36);
    score += this.computeQueryNgramCoverageScore(query, fullText);
    score += this.computeArchiveCategoryAffinityScore(item, query);
    score += this.computeArchiveDocIntentScore(item, query);
    if (docType && query.includes(docType)) {
      score += 4;
    }
    if (category && query.includes(category)) {
      score += 3;
    }
    const coreCaseTokens = Array.isArray(signals?.coreCaseTokens) ? signals.coreCaseTokens : [];
    const caseTokenHit = this.countSignalHits(fullText, coreCaseTokens, 18);
    if (coreCaseTokens.length >= 2 && caseTokenHit === 0) {
      score -= 14;
    } else if (coreCaseTokens.length >= 2 && caseTokenHit === 1) {
      score -= 6;
    }
    if (keywords.length >= 6) {
      const keywordHit = this.countSignalHits(fullText, keywords, 28);
      if (keywordHit <= 1) {
        score -= 8;
      }
    }
    return score;
  },
  collectArchiveExpansionCases: function (contractList, queryText, querySignals = null) {
    const list = Array.isArray(contractList) ? contractList : [];
    if (!list.length) {
      return [];
    }
    const signals = querySignals || this.buildArchivedQuerySignals(queryText);
    const seen = {};
    return [...list]
      .map((item) => ({
        item,
        score: this.scoreArchivedCandidate(item, queryText, signals),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((entry) => entry.item)
      .filter((item) => {
        const key = this.normalizeCaseKey(item?.caseKey || item?.caseTitle || "");
        if (!key || seen[key]) {
          return false;
        }
        seen[key] = true;
        return true;
      })
      .map((item) => ({
        caseKey: this.normalizeCaseKey(item?.caseKey || ""),
        caseTitle: String(item?.caseTitle || "").trim(),
      }));
  },
  buildArchiveRelationSignals: function (value, options = {}) {
    const text = String(value || "").trim();
    if (!text) {
      return [];
    }
    const tokens = this.extractRetrievalTokens(text, {
      includeNgrams: false,
      minLength: 2,
      maxLength: 18,
      maxTokens: Math.max(12, Number(options.maxTokens || 32)),
      preferLonger: true,
    });
    const windows = this.buildCompactRetrievalWindows(text, {
      minGram: 3,
      maxGram: 6,
      maxTokens: Math.max(8, Number(options.maxWindowTokens || 16)),
    });
    const seen = {};
    return [...tokens, ...windows].filter((token) => {
      const word = this.normalizeRetrievalToken(token);
      if (!word || seen[word] || this.isLowValueRetrievalToken(word)) {
        return false;
      }
      seen[word] = true;
      return true;
    });
  },
  computeArchiveRelationScore: function (candidateText, anchorSignals = []) {
    const source = String(candidateText || "");
    const tokens = Array.isArray(anchorSignals) ? anchorSignals : [];
    if (!source || !tokens.length) {
      return 0;
    }
    const hitCount = this.countSignalHits(source, tokens, 36);
    if (!hitCount) {
      return 0;
    }
    return this.scoreSignalHits(source, tokens, 3, 36) + Math.min(24, hitCount * 4);
  },
  resolveCaseContextFromFileList: function (fileList = [], fallbackContext = {}) {
    const list = Array.isArray(fileList) ? fileList : [];
    let best = {
      caseKey: this.normalizeCaseKey(fallbackContext?.caseKey || ""),
      caseTitle: this.cleanCaseTitleCandidate(fallbackContext?.caseTitle || ""),
      caseNo: String(fallbackContext?.caseNo || "").trim(),
      hasExplicitCaseNo: !!fallbackContext?.hasExplicitCaseNo,
      score: 0,
    };
    list.forEach((item) => {
      const source = [
        item?.rawFileName || item?.tempFileName || "",
        item?.extractedText || "",
        item?.ocrText || "",
      ].filter(Boolean).join("\n");
      if (!source) {
        return;
      }
      const context = this.extractCaseContext(source);
      if (!context.caseKey && !context.caseTitle) {
        return;
      }
      let score = 0;
      if (context.hasExplicitCaseNo) {
        score += 10;
      }
      if (context.caseTitle) {
        score += Math.min(8, Math.floor(String(context.caseTitle).length / 2));
      }
      if (context.caseKey) {
        score += 6;
      }
      if (score > best.score) {
        best = {
          ...context,
          score,
        };
      }
    });
    return {
      caseKey: best.caseKey || "",
      caseTitle: best.caseTitle || "",
      caseNo: best.caseNo || "",
      hasExplicitCaseNo: !!best.hasExplicitCaseNo,
    };
  },
  pickReviewContractCandidate: function (contractList, queryText) {
    const list = Array.isArray(contractList) ? contractList : [];
    if (!list.length) {
      return null;
    }
    const query = String(queryText || "").trim();
    if (!query) {
      return list[0];
    }
    const querySignals = this.buildArchivedQuerySignals(query);
    let best = null;
    let bestScore = -999999;
    list.forEach((item) => {
      const score = this.scoreArchivedCandidate(item, query, querySignals);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    });
    return bestScore > 0 ? best : list[0];
  },
  rerankArchivedCandidatesByContent: async function (contractList, queryText, caseContext = {}) {
    const list = Array.isArray(contractList) ? contractList : [];
    if (!list.length) {
      return null;
    }
    const query = String(queryText || "").trim();
    const querySignals = this.buildArchivedQuerySignals(query);
    const primarySorted = [...list]
      .map((item) => ({
        item,
        score: this.scoreArchivedCandidate(item, query, querySignals),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((entry) => entry.item);
    const probePool = [];
    const idMap = {};
    const pushProbe = (item) => {
      if (!item?.id || idMap[item.id]) {
        return;
      }
      idMap[item.id] = true;
      probePool.push(item);
    };
    primarySorted.forEach(pushProbe);
    list.slice(0, 16).forEach(pushProbe);
    const candidatesToProbe = probePool.slice(0, 18);
    const detailedCandidates = [];
    const candidateDetails = {};
    for (const item of candidatesToProbe) {
      if (!item?.id) {
        continue;
      }
      const detailRes = await this.callContractCloud("detail", { id: item.id });
      const detail = detailRes?.data || {};
      const content = this.sanitizeArchivedDocumentContent(detail.content || item.content || "");
      const metaFallback = this.sanitizeArchivedDocumentContent([
        detail.title || item.title || "",
        detail.caseTitle || item.caseTitle || "",
        detail.summary || item.summary || "",
        Array.isArray(detail.keywords || item.keywords) ? (detail.keywords || item.keywords).join("、") : "",
      ].filter((line) => !!String(line || "").trim()).join("\n"));
      const contentSlice = (content || metaFallback).slice(0, 50000);
      if (!contentSlice) {
        continue;
      }
      const merged = {
        ...item,
        ...detail,
        content: content || metaFallback,
        contentSlice,
        summary: detail.summary || item.summary || "",
      };
      candidateDetails[item.id] = merged;
      detailedCandidates.push(merged);
    }
    const relationAnchors = detailedCandidates
      .map((item) => ({
        item,
        baseScore: this.scoreArchivedCandidate(item, query, querySignals),
      }))
      .sort((a, b) => b.baseScore - a.baseScore)
      .slice(0, 4)
      .map((entry) => ({
        id: entry.item.id,
        signals: this.buildArchiveRelationSignals([
          entry.item.title || "",
          entry.item.caseTitle || "",
          entry.item.summary || "",
          String(entry.item.contentSlice || "").slice(0, 6000),
          Array.isArray(entry.item.keywords) ? entry.item.keywords.join(" ") : "",
        ].join("\n")),
      }))
      .filter((entry) => entry.signals.length >= 3);
    let best = null;
    let bestScore = -999999;
    for (const item of candidatesToProbe) {
      if (!item?.id) {
        continue;
      }
      const mergedDetail = candidateDetails[item.id];
      if (!mergedDetail?.contentSlice) {
        continue;
      }
      let score = this.scoreArchivedCandidate(
        mergedDetail,
        query,
        querySignals
      );
      score += this.scoreSignalHits(mergedDetail.contentSlice, querySignals.partyTokens, 7, 12);
      score += this.scoreSignalHits(mergedDetail.contentSlice, querySignals.docIntentTokens, 5, 12);
      score += this.scoreSignalHits(mergedDetail.contentSlice, querySignals.caseTokens, 6, 18);
      score += this.scoreSignalHits(mergedDetail.contentSlice, querySignals.keywords, 2, 36);
      score += this.computeQueryNgramCoverageScore(query, mergedDetail.contentSlice);
      const leadingText = this.extractLeadingText(mergedDetail.contentSlice, 5);
      score += this.scoreSignalHits(leadingText, querySignals.coreCaseTokens, 9, 18);
      score += this.scoreSignalHits(leadingText, querySignals.keywords, 3, 24);
      let bestRelationScore = 0;
      relationAnchors.forEach((anchor) => {
        if (!anchor?.signals?.length || anchor.id === item.id) {
          return;
        }
        const relationScore = this.computeArchiveRelationScore(
          [
            mergedDetail.title || "",
            mergedDetail.caseTitle || "",
            mergedDetail.summary || "",
            mergedDetail.contentSlice || "",
          ].join("\n"),
          anchor.signals
        );
        if (relationScore > bestRelationScore) {
          bestRelationScore = relationScore;
        }
      });
      score += Math.min(42, bestRelationScore);
      if (
        caseContext?.enforceCaseKey &&
        caseContext?.caseKey &&
        String(mergedDetail?.caseKey || item?.caseKey || "").trim() !== String(caseContext.caseKey)
      ) {
        score -= 30;
      }
      if (score > bestScore) {
        bestScore = score;
        best = {
          ...mergedDetail,
        };
      }
    }
    if (best?.id) {
      const minAcceptScore = Number(caseContext?.minAcceptScore);
      const hasPartyHints = (querySignals.partyTokens || []).length > 0;
      const hasDocIntentHints = (querySignals.docIntentTokens || []).length > 0;
      const relaxedThreshold = hasPartyHints || hasDocIntentHints ? 2 : 8;
      const scoreThreshold = Number.isFinite(minAcceptScore) ? minAcceptScore : relaxedThreshold;
      if (bestScore < scoreThreshold) {
        return null;
      }
      const fullText = `${best.title || ""}\n${best.summary || ""}\n${best.caseTitle || ""}\n${best.content || ""}`;
      const mustHitCount = this.countSignalHits(fullText, querySignals.coreCaseTokens, 18);
      if (
        querySignals.coreCaseTokens.length >= 2 &&
        mustHitCount === 0 &&
        !hasPartyHints &&
        !hasDocIntentHints
      ) {
        return null;
      }
      return best;
    }
    return primarySorted[0] || null;
  },
  shouldLookupArchivedDocument: function (queryText, fileList = []) {
    return this.buildArchiveRetrievalIntent(queryText, fileList).shouldLookup;
  },
  isDirectArchiveReference: function (value) {
    const query = String(value || "");
    return /对应的卷宗|这个文件|该文件|这份文件|那份文件|该卷宗|这个卷宗|这份卷宗|那份卷宗|上述卷宗|前述卷宗|这个案卷|这份案卷|上述案卷|前述案卷|上述文件|前述文件|该材料|这份材料|上述材料|前述材料/.test(query);
  },
  buildArchiveRetrievalIntent: function (queryText, fileList = []) {
    const query = String(queryText || "").trim();
    const featureKey = this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult";
    const hasAttachments = Array.isArray(fileList) && fileList.length > 0;
    const hasDirectFileReference = this.isDirectArchiveReference(query);
    const hasCaseId = /(?:案号|案件编号|卷宗号|项目编号)\s*[:：]?/.test(query);
    const caseContext = this.resolveCaseContext(query);
    const hasCaseContext = !!(caseContext.caseKey || caseContext.caseTitle);
    const genericTokens = this.extractRetrievalTokens(query, {
      includeNgrams: false,
      minLength: 2,
      maxLength: 18,
      maxTokens: 12,
      preferLonger: true,
    });
    const partyTokens = this.extractArchivePartyTokens(query);
    const referenceTokens = this.extractArchiveReferenceTokens(query);
    const docIntentTokens = this.extractArchiveDocIntentTokens(query);
    const hasAction = /(写|生成|起草|撰写|草拟|出具|整理|总结|归纳|分析|审查|审阅|阅卷|读取|引用|依据|根据|基于|结合|参照|定位|匹配|检索|查找|调用|使用|对照|识别|提取|解析)/.test(query);
    const featureSuggestsLookup = ["draft", "review", "evidence", "document", "analysis"].includes(featureKey);
    const shouldLookup =
      !!query &&
      !hasAttachments &&
      !(this.isLikelyContractBody(query) && query.length > 200) &&
      (
        hasDirectFileReference ||
        hasCaseId ||
        (featureSuggestsLookup && (partyTokens.length > 0 || docIntentTokens.length > 0)) ||
        (featureSuggestsLookup && referenceTokens.length > 0) ||
        (featureSuggestsLookup && (hasAction || hasCaseContext)) ||
        (genericTokens.length >= 3 && (hasAction || hasCaseContext || referenceTokens.length > 0))
      );
    return {
      query,
      featureKey,
      hasAttachments,
      hasDirectFileReference,
      hasCaseId,
      hasCaseContext,
      caseContext,
      genericTokens,
      partyTokens,
      referenceTokens,
      docIntentTokens,
      hasAction,
      featureSuggestsLookup,
      shouldLookup,
    };
  },
  shouldPreferActiveCaseContextForArchive: function (queryText, caseContext = {}, hasDirectFileReference = false) {
    const caseKey = this.normalizeCaseKey(caseContext?.caseKey || "");
    const caseTitle = String(caseContext?.caseTitle || "").trim();
    if (!caseKey && !caseTitle) {
      return false;
    }
    if (hasDirectFileReference) {
      return true;
    }
    const intent = this.buildArchiveRetrievalIntent(queryText);
    return !!(intent.featureSuggestsLookup || intent.hasAction || intent.hasCaseId);
  },
  buildArchiveRetrievalQuery: function (queryText, caseContext = {}, useCaseContext = false) {
    const query = String(queryText || "").trim();
    if (!useCaseContext) {
      return query;
    }
    const parts = [query];
    const caseTitle = String(caseContext?.caseTitle || "").trim();
    const caseKey = this.normalizeCaseKey(caseContext?.caseKey || "");
    if (caseTitle && !query.includes(caseTitle)) {
      parts.push(`关联案件：${caseTitle}`);
    }
    if (caseKey && caseKey !== caseTitle && !query.includes(caseKey)) {
      parts.push(`关联案件标识：${caseKey}`);
    }
    return parts.filter(Boolean).join("\n");
  },
  sanitizeArchivedDocumentContent: function (value) {
    const text = String(value || "").replace(/\r\n/g, "\n").trim();
    if (!text) {
      return "";
    }
    return text
      .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[\w-]*\n?/g, "").replace(/```/g, ""))
      .replace(/\u0000/g, "")
      .trim();
  },
  normalizeArchivedDocumentLayout: function (value) {
    let text = this.sanitizeArchivedDocumentContent(value);
    if (!text) {
      return "";
    }
    text = text.replace(/\t+/g, " ").replace(/\u00A0/g, " ");
    text = text
      .replace(/([^\n])([A-Za-z0-9\u4e00-\u9fa5]{1,30}\s*[：:])/g, "$1\n$2")
      .replace(/([^\n])((?:第[一二三四五六七八九十百0-9]+[条章节部分]|[一二三四五六七八九十0-9]+、))/g, "$1\n$2")
      .replace(/([^\n])([（(][一二三四五六七八九十0-9]+[）)])/g, "$1\n$2")
      .replace(/\s{2,}/g, " ")
      .replace(/([^\n])((?:[一二三四五六七八九十]+、))/g, "$1\n$2")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text;
  },
  buildArchiveLookupDisplay: function (debugInfo = {}) {
    if (!debugInfo?.attempted) {
      return null;
    }
    if (debugInfo.matched) {
      return {
        status: "已命中归档",
        title: debugInfo.matchedTitle || "未命名文件",
        detail: [
          debugInfo.matchedCaseTitle,
          debugInfo.matchedDocType || debugInfo.matchedCategory,
          debugInfo.usedCaseContext ? "已带入案件上下文" : "",
        ].filter(Boolean).join(" · "),
      };
    }
    return {
      status: "未命中归档",
      title: debugInfo.caseTitle || "未定位到归档文件",
      detail: debugInfo.usedCaseContext ? "已按当前案件上下文执行检索" : "本次问题未触发有效卷宗召回",
    };
  },
  retrieveArchivedDocumentForInput: async function (queryText, fileList = []) {
    const lookupIntent = this.buildArchiveRetrievalIntent(queryText, fileList);
    if (!lookupIntent.shouldLookup) {
      return {
        matchedDoc: null,
        debug: {
          attempted: false,
          matched: false,
          query: lookupIntent.query,
          featureKey: lookupIntent.featureKey,
        },
      };
    }
    const query = String(queryText || "").trim();
    try {
      const hasDirectFileReference = this.isDirectArchiveReference(query);
      const directCaseContext = this.extractCaseContext(query);
      const hasExplicitCaseKey = !!directCaseContext?.hasExplicitCaseNo;
      const caseContext = this.resolveCaseContext(query);
      const preferActiveCaseContext = this.shouldPreferActiveCaseContextForArchive(query, caseContext, hasDirectFileReference);
      const retrievalQuery = this.buildArchiveRetrievalQuery(query, caseContext, preferActiveCaseContext);
      const canUseScopedCaseKey = !!(hasExplicitCaseKey || (preferActiveCaseContext && caseContext?.hasExplicitCaseNo));
      const retrievalCaseKey = canUseScopedCaseKey ? caseContext.caseKey : "";
      const querySignals = this.buildArchivedQuerySignals(retrievalQuery);
      const searchKeywords = this.buildArchivedSearchQueries(retrievalQuery, querySignals);
      let contractList = [];
      const idMap = {};
      for (const searchKeyword of searchKeywords) {
        if (!searchKeyword) {
          continue;
        }
        const directSearchRes = await this.callContractCloud("search", {
          query: searchKeyword,
          caseKey: retrievalCaseKey,
        });
        const partList = Array.isArray(directSearchRes?.data) ? directSearchRes.data : [];
        partList.forEach((item) => {
          if (!item?.id || idMap[item.id]) {
            return;
          }
          idMap[item.id] = true;
          contractList.push(item);
        });
      }
      if (!contractList.length && preferActiveCaseContext) {
        const fallbackKeywords = [caseContext.caseTitle, caseContext.caseKey].filter(Boolean);
        for (const searchKeyword of fallbackKeywords) {
          const directSearchRes = await this.callContractCloud("search", {
            query: searchKeyword,
            caseKey: retrievalCaseKey,
          });
          const partList = Array.isArray(directSearchRes?.data) ? directSearchRes.data : [];
          partList.forEach((item) => {
            if (!item?.id || idMap[item.id]) {
              return;
            }
            idMap[item.id] = true;
            contractList.push(item);
          });
        }
      }
      const shouldSupplementRecentList =
        !!(
          hasDirectFileReference ||
          lookupIntent.featureSuggestsLookup ||
          (querySignals.partyTokens || []).length ||
          (querySignals.docIntentTokens || []).length
        );
      if (shouldSupplementRecentList && contractList.length < 18) {
        const maxPage = hasDirectFileReference || (querySignals.partyTokens || []).length >= 1 ? 2 : 1;
        for (let page = 1; page <= maxPage; page++) {
          const recentListRes = await this.callContractCloud("list", {
            page,
            size: 50,
            caseKey: retrievalCaseKey,
          });
          const pageList = Array.isArray(recentListRes?.data) ? recentListRes.data : [];
          pageList.forEach((item) => {
            if (!item?.id || idMap[item.id]) {
              return;
            }
            idMap[item.id] = true;
            contractList.push(item);
          });
          if (pageList.length < 50) {
            break;
          }
        }
      }
      if (!contractList.length) {
        const maxPage = hasDirectFileReference ? 4 : 2;
        for (let page = 1; page <= maxPage; page++) {
          const allDraftRes = await this.callContractCloud("list", {
            page,
            size: 50,
            caseKey: retrievalCaseKey,
          });
          const pageList = Array.isArray(allDraftRes?.data) ? allDraftRes.data : [];
          pageList.forEach((item) => {
            if (!item?.id || idMap[item.id]) {
              return;
            }
            idMap[item.id] = true;
            contractList.push(item);
          });
          if (pageList.length < 50) {
            break;
          }
        }
      }
      const expansionCases = this.collectArchiveExpansionCases(contractList, retrievalQuery, querySignals);
      for (const item of expansionCases) {
        if (item.caseKey) {
          for (let page = 1; page <= 2; page++) {
            const caseListRes = await this.callContractCloud("list", {
              page,
              size: 50,
              caseKey: item.caseKey,
            });
            const pageList = Array.isArray(caseListRes?.data) ? caseListRes.data : [];
            pageList.forEach((entry) => {
              if (!entry?.id || idMap[entry.id]) {
                return;
              }
              idMap[entry.id] = true;
              contractList.push(entry);
            });
            if (pageList.length < 50) {
              break;
            }
          }
          continue;
        }
        if (item.caseTitle) {
          const siblingSearchRes = await this.callContractCloud("search", {
            query: item.caseTitle,
            caseKey: retrievalCaseKey,
          });
          const pageList = Array.isArray(siblingSearchRes?.data) ? siblingSearchRes.data : [];
          pageList.forEach((entry) => {
            if (!entry?.id || idMap[entry.id]) {
              return;
            }
            idMap[entry.id] = true;
            contractList.push(entry);
          });
        }
      }
      if (canUseScopedCaseKey && caseContext.caseKey) {
        const scopedList = contractList.filter((item) => String(item?.caseKey || "").trim() === caseContext.caseKey);
        if (scopedList.length) {
          contractList = scopedList;
        }
      }
      if (preferActiveCaseContext && caseContext.caseTitle) {
        const scopedByTitle = contractList.filter((item) => {
          const haystack = `${item?.title || ""}\n${item?.caseTitle || ""}\n${item?.summary || ""}`;
          return this.scoreCaseTitleSimilarity(caseContext.caseTitle, haystack) >= 20;
        });
        if (scopedByTitle.length) {
          contractList = scopedByTitle;
        }
      }
      if (!contractList.length) {
        return {
          matchedDoc: null,
          debug: {
            attempted: true,
            matched: false,
            query,
            retrievalQuery,
            featureKey: lookupIntent.featureKey,
            usedCaseContext: preferActiveCaseContext,
            caseTitle: caseContext.caseTitle || "",
            caseKey: caseContext.caseKey || "",
            searchKeywords: searchKeywords.slice(0, 8),
            candidateCount: 0,
          },
        };
      }
      const previewCandidates = [...contractList]
        .map((item) => ({
          id: item?.id || "",
          title: item?.title || "未命名文件",
          caseTitle: item?.caseTitle || "",
          score: this.scoreArchivedCandidate(item, retrievalQuery, querySignals),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const target = await this.rerankArchivedCandidatesByContent(contractList, retrievalQuery, {
        ...caseContext,
        enforceCaseKey: canUseScopedCaseKey,
        minAcceptScore: hasDirectFileReference ? 0 : 8,
      });
      let finalTarget = target;
      if (!finalTarget?.id && this.isArchiveRewriteIntent(query) && (querySignals.docIntentTokens || []).length) {
        const rewritePreferred = [...contractList]
          .map((item) => ({
            item,
            score: this.scoreArchivedCandidate(item, retrievalQuery, querySignals),
          }))
          .sort((a, b) => b.score - a.score)
          .find((entry) => entry.score >= 0 && /(生成|已生成|最终版|定稿|第\d+版)/.test(`${entry.item?.sourceType || ""} ${entry.item?.status || ""}`));
        finalTarget = rewritePreferred?.item || finalTarget;
      }
      if (!finalTarget?.id && hasDirectFileReference) {
        const latest = [...contractList].sort((a, b) => {
          const ta = Number(a?.updatedAtTs || a?.createdAtTs || 0);
          const tb = Number(b?.updatedAtTs || b?.createdAtTs || 0);
          return tb - ta;
        })[0];
        finalTarget = latest || null;
      }
      if (!finalTarget?.id) {
        return {
          matchedDoc: null,
          debug: {
            attempted: true,
            matched: false,
            query,
            retrievalQuery,
            featureKey: lookupIntent.featureKey,
            usedCaseContext: preferActiveCaseContext,
            caseTitle: caseContext.caseTitle || "",
            caseKey: caseContext.caseKey || "",
            searchKeywords: searchKeywords.slice(0, 8),
            candidateCount: contractList.length,
            previewCandidates,
          },
        };
      }
      const detailRes = finalTarget?.content ? null : await this.callContractCloud("detail", { id: finalTarget.id });
      const detail = detailRes?.data || {};
      const content = this.normalizeArchivedDocumentLayout(detail.content || finalTarget.content || "");
      const fallbackContent = this.sanitizeArchivedDocumentContent([
        detail.title || finalTarget.title || "",
        detail.caseTitle || finalTarget.caseTitle || "",
        detail.summary || finalTarget.summary || "",
        (detail.docType || finalTarget.docType) ? `文档类型：${detail.docType || finalTarget.docType}` : "",
        (detail.category || finalTarget.category) ? `分类：${detail.category || finalTarget.category}` : "",
      ].filter((line) => !!String(line || "").trim()).join("\n"));
      const finalContent = content || fallbackContent;
      if (!finalContent || finalContent.includes("当前模型服务拥堵")) {
        return {
          matchedDoc: null,
          debug: {
            attempted: true,
            matched: false,
            query,
            retrievalQuery,
            featureKey: lookupIntent.featureKey,
            usedCaseContext: preferActiveCaseContext,
            caseTitle: caseContext.caseTitle || "",
            caseKey: caseContext.caseKey || "",
            searchKeywords: searchKeywords.slice(0, 8),
            candidateCount: contractList.length,
            previewCandidates,
          },
        };
      }
      const matchedDoc = {
        id: detail.id || finalTarget.id,
        title: detail.title || finalTarget.title || "归档文件",
        content: finalContent,
        docType: detail.docType || finalTarget.docType || "",
        category: detail.category || finalTarget.category || "",
        caseKey: detail.caseKey || finalTarget.caseKey || caseContext.caseKey || "",
        caseTitle: detail.caseTitle || finalTarget.caseTitle || caseContext.caseTitle || "",
        contractGroupKey: detail.contractGroupKey || finalTarget.contractGroupKey || finalTarget.id,
        manualEdited: !!(detail.manualEdited || finalTarget.manualEdited),
        manualEditCount: Number(detail.manualEditCount || finalTarget.manualEditCount || 0),
        manualEditUpdatedAt: detail.manualEditUpdatedAt || finalTarget.manualEditUpdatedAt || "",
        manualEditHistory: Array.isArray(detail.manualEditHistory)
          ? detail.manualEditHistory
          : (Array.isArray(finalTarget.manualEditHistory) ? finalTarget.manualEditHistory : []),
      };
      const debug = {
        attempted: true,
        matched: true,
        query,
        retrievalQuery,
        featureKey: lookupIntent.featureKey,
        usedCaseContext: preferActiveCaseContext,
        caseTitle: caseContext.caseTitle || "",
        caseKey: caseContext.caseKey || "",
        searchKeywords: searchKeywords.slice(0, 8),
        candidateCount: contractList.length,
        previewCandidates,
        matchedTitle: matchedDoc.title,
        matchedCaseTitle: matchedDoc.caseTitle,
        matchedDocType: matchedDoc.docType,
        matchedCategory: matchedDoc.category,
      };
      matchedDoc.retrievalDebug = debug;
      return {
        matchedDoc,
        debug,
      };
    } catch (error) {
      console.log("retrieveArchivedDocumentForInput failed", error);
      return {
        matchedDoc: null,
        debug: {
          attempted: true,
          matched: false,
          query,
          featureKey: lookupIntent.featureKey,
          error: error?.message || error?.errMsg || "lookup_failed",
        },
      };
    }
  },
  findArchivedDocumentForInput: async function (queryText, fileList = []) {
    const result = await this.retrieveArchivedDocumentForInput(queryText, fileList);
    return result?.matchedDoc || null;
  },
};
