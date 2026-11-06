// 轻量 i18n 单例：语言解析、词典、插值、订阅、壳层（标题/tabBar）同步。
// 注意：本文件顶层不直接访问 wx，便于在 Node 中做语言包完整性检查。
const zh = require("./locales/zh");
const en = require("./locales/en");

const STORAGE_KEY = "app_language";
const VALID_MODES = ["system", "zh", "en"];
const DEFAULT_MODE = "system";

const TAB_INDEX_BY_ROUTE = {
  "pages/chatBot/chatBot": 0,
  "pages/foodBuy/foodBuy": 1,
  "pages/reports/reports": 2,
  "pages/my/my": 3,
};

const NAV_TITLE_BY_ROUTE = {
  "pages/index/index": "nav.titleIndex",
  "pages/chatBot/chatBot": "nav.titleChat",
  "pages/foodBuy/foodBuy": "nav.titleArchive",
  "pages/reports/reports": "nav.titleReports",
  "pages/my/my": "nav.titleMine",
};

const TAB_TEXTS = ["nav.tabChat", "nav.tabArchive", "nav.tabReports", "nav.tabMine"];

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const deepMerge = (base, override) => {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const result = { ...base };
  Object.keys(override).forEach((key) => {
    result[key] = deepMerge(base[key], override[key]);
  });
  return result;
};

// 英文缺失的 key 回退中文，避免界面出现原始 key
const dictionaries = {
  zh,
  en: deepMerge(zh, en),
};

let currentMode = DEFAULT_MODE;
let currentLanguage = "zh";
let currentDict = dictionaries.zh;
const listeners = new Set();

const getWx = () => (typeof wx !== "undefined" ? wx : null);

const detectSystemLanguage = () => {
  const client = getWx();
  if (!client) {
    return "zh";
  }
  let systemLanguage = "";
  try {
    if (typeof client.getAppBaseInfo === "function") {
      systemLanguage = client.getAppBaseInfo()?.language || "";
    }
  } catch (e) {}
  if (!systemLanguage) {
    try {
      systemLanguage = client.getSystemInfoSync()?.language || "";
    } catch (e) {}
  }
  return /^zh/i.test(String(systemLanguage)) ? "zh" : "en";
};

const refreshDictionary = () => {
  currentLanguage = currentMode === "system" ? detectSystemLanguage() : currentMode;
  currentDict = dictionaries[currentLanguage] || dictionaries.zh;
};

const readStoredMode = () => {
  const client = getWx();
  if (!client) {
    return DEFAULT_MODE;
  }
  try {
    const stored = client.getStorageSync(STORAGE_KEY);
    return VALID_MODES.includes(stored) ? stored : DEFAULT_MODE;
  } catch (e) {
    return DEFAULT_MODE;
  }
};

const initLanguage = () => {
  currentMode = readStoredMode();
  refreshDictionary();
  return currentLanguage;
};

const getMode = () => currentMode;
const getLanguage = () => currentLanguage;

const lookup = (dict, key) => {
  const parts = String(key || "").split(".");
  let value = dict;
  for (let i = 0; i < parts.length; i += 1) {
    if (!isPlainObject(value)) {
      return undefined;
    }
    value = value[parts[i]];
  }
  return value;
};

const interpolate = (template, params) => {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
};

const t = (key, params) => {
  let value = lookup(currentDict, key);
  if (value === undefined) {
    value = lookup(dictionaries.zh, key);
  }
  if (typeof value !== "string") {
    return key;
  }
  return interpolate(value, params);
};

const getDict = () => currentDict;

const getCurrentRoute = () => {
  if (typeof getCurrentPages !== "function") {
    return "";
  }
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  return page?.route || "";
};

const syncShell = () => {
  const client = getWx();
  if (!client) {
    return;
  }
  const route = getCurrentRoute();
  const titleKey = NAV_TITLE_BY_ROUTE[route];
  if (titleKey) {
    try {
      client.setNavigationBarTitle({ title: t(titleKey) });
    } catch (e) {}
  }
  // setTabBarItem 只能在 tabBar 页面调用；非 tab 页会失败，忽略即可
  if (TAB_INDEX_BY_ROUTE[route] === undefined) {
    return;
  }
  TAB_TEXTS.forEach((key, index) => {
    try {
      client.setTabBarItem({ index, text: t(key) });
    } catch (e) {}
  });
};

const notify = () => {
  listeners.forEach((listener) => {
    try {
      listener(currentLanguage, currentDict);
    } catch (e) {
      console.error("[i18n] listener failed", e);
    }
  });
};

const subscribe = (listener) => {
  if (typeof listener !== "function") {
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const setLanguage = (mode) => {
  const nextMode = VALID_MODES.includes(mode) ? mode : DEFAULT_MODE;
  const changed = nextMode !== currentMode;
  currentMode = nextMode;
  const previousLanguage = currentLanguage;
  refreshDictionary();
  const client = getWx();
  if (client) {
    try {
      client.setStorageSync(STORAGE_KEY, nextMode);
    } catch (e) {}
  }
  if (changed || previousLanguage !== currentLanguage) {
    notify();
  }
  syncShell();
  return currentLanguage;
};

module.exports = {
  STORAGE_KEY,
  initLanguage,
  getLanguage,
  getMode,
  getDict,
  t,
  subscribe,
  setLanguage,
  syncShell,
};
