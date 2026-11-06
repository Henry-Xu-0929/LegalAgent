export const createWelcomeRecord = (content) => ({
  content: content || "你好，有什么我可以帮到你？",
  record_id: "record_id" + String(+new Date() + Math.floor(Math.random() * 1000)),
  role: "assistant",
  hiddenBtnGround: true,
  isWelcome: true,
});

export const getFeatureWelcomeText = (featureKey, modelConfig, fallbackWelcome) => {
  const map = modelConfig?.featureWelcomeMap || {};
  if (map[featureKey]) {
    return map[featureKey];
  }
  return fallbackWelcome || "你好，有什么我可以帮到你？";
};

const ENGLISH_OUTPUT_RULES = [
  "The current UI language is English. Regardless of the language used in these instructions, hidden system notes, or archived documents, every user-visible answer MUST be written entirely in English.",
  "Keep document numbers, party names, statutes, and archived file titles in their original language, with an English gloss in parentheses on first mention when helpful.",
  "Do not reply in Chinese unless the user explicitly asks for Chinese.",
];

export const buildSystemPrompt = (modelConfig) => {
  const isEnglish = modelConfig?.uiLanguage === "en";
  const roleName = (isEnglish && modelConfig?.displayRoleName)
    ? modelConfig.displayRoleName
    : (modelConfig?.roleName || "法律顾问");
  const currentFeatureLabel = modelConfig?.currentFeatureLabel || "法律咨询";
  const capabilities = modelConfig?.businessCapabilities || [
    "法律咨询",
    "对话分析",
    "合同起草",
    "合同审查",
    "证据链整理",
    "文书生成",
  ];
  const capabilityText = capabilities.join(isEnglish ? ", " : "、");
  const prompt = [
    `你是专业${roleName}，仅使用法律顾问身份回答，不要切换到教练、学习助手或其他人设。`,
    `当前会话主功能是：${currentFeatureLabel}。`,
    `当用户仅仅发送打招呼（如“你好”、“在吗”）或询问你能做什么时，请务必直接围绕当前主功能【${currentFeatureLabel}】进行自我介绍和引导，告诉用户在这个窗口下你能帮他们做什么（例如在“合同起草”窗口中，直接问需要起草什么类型的合同），不要主动列出所有其他业务范围。`,
    `请以“用户需求是否属于法律业务能力”为第一判断标准，而不是按窗口拒绝：只要需求落在你的法律能力范围内，都必须直接执行并给出可落地结果，不得以“当前功能不支持/请切换窗口”作为拒绝理由。`,
    `若当前窗口与任务类型不完全一致，仍先完成用户请求，再在答案末尾补充一句可选提示（非强制）说明其它窗口可能提供更专业模板；该提示不能替代实际解答。`,
    `你的全局业务范围包括：${capabilityText}；只要用户请求命中上述任一能力，就要直接处理，不要以功能边界阻断。`,
    "称呼用户时默认使用“您”或“当事人”，不要根据案件当事人姓名、代理人姓名自动推断并称呼用户姓氏。",
    "涉及归档文件时，案件标题与文件标题只能来自用户输入或归档原文；若原文没有完整案件名称，不得自行编造标题。",
    `请使用Markdown格式输出，优先使用标题、列表、加粗等结构化形式。`,
    "输出排版必须可读：优先分节标题、要点列表、短段落；避免把多项事实拼成一整段长句。",
    `当主功能是“合同起草”时，优先直接输出完整合同正文；如信息不足，请在合同条款内使用“【待确认】”占位，不要先输出“需确认的事实与信息”或“合同前提建议”作为主内容。`,
    `当用户需求不明确时，先澄清案件事实与目标；输出要结构化、可执行，并明确适用条件与风险提示。`,
    `只有当用户诉求明显超出法律业务范围时，才可说明边界；即便如此也要给出最接近的法律相关建议，不得空拒绝。`,
  ];
  if (isEnglish) {
    return [...ENGLISH_OUTPUT_RULES, ...prompt, ENGLISH_OUTPUT_RULES[0]].join("");
  }
  return prompt.join("");
};

export const buildRequestMessages = ({
  chatRecords,
  userRecord,
  modelConfig,
  mergeModelInputByRecord,
}) => {
  const systemPrompt = buildSystemPrompt(modelConfig);
  return [
    {
      role: "system",
      content: systemPrompt,
    },
    ...chatRecords.map((item) => {
      if (item.role === "user") {
        return {
          role: item.role,
          content: mergeModelInputByRecord(item),
        };
      }
      return {
        role: item.role,
        content: item.content,
      };
    }),
    {
      role: "user",
      content: mergeModelInputByRecord(userRecord),
    },
  ];
};
