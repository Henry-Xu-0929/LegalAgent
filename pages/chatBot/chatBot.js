// pages/chatBot/chatBot.js
const i18n = require("../../utils/i18n");
const { attachPageLanguage } = require("../../utils/i18n-page");

const FEATURE_KEYS = ["consult", "analysis", "draft", "review", "evidence", "document"];

const buildFeatures = () =>
  FEATURE_KEYS.map((key) => ({
    key,
    label: i18n.t(`chat.feature.${key}`),
  }));

const buildFeatureWelcomeMap = () => {
  const map = {};
  FEATURE_KEYS.forEach((key) => {
    map[key] = i18n.t(`chat.welcome.${key}`);
  });
  return map;
};

Page({
  /**
   * 页面的初始数据
   */
  data: {
    chatMode: "model", // bot: agent 模式，model：直连大模型
    showBotAvatar: true, // 是否在对话框左侧显示头像
    // envShareConfig: {
    //   // 不使用环境共享，请删除此配置或配置EnvShareConfig:null
    //   // 资源方 AppID
    //   resourceAppid: "wx7ac1bfecc7bf5f4f",
    //   // 资源方环境 ID
    //   resourceEnv: "chriscc-demo-7ghlpjf846d46d2d",
    // },
    agentConfig: {
      botId: "agent-ryan-3ghdryeyb5ad5812", //  bot ID 或者 agent ID,
      allowWebSearch: true, // 允许客户端选择启用联网搜索（仅对配置型 agent 生效）
      allowUploadFile: true, // 允许上传文件（仅对配置型 agent 生效）
      allowPullRefresh: true, // 允许下拉刷新（仅对配置型 agent 生效）
      allowUploadImage: true, // 允许上传图片（仅对配置型 agent 生效）
      showToolCallDetail: true, // 展示 toolCall 细节（仅对配置型 agent 生效）
      allowMultiConversation: true, // 允许多轮对话（仅对配置型 agent 生效）
      allowVoice: true, // 允许语音输入（仅对配置型 agent 生效）
      showBotName: true, // 是否展示 bot 名称（仅对配置型 agent 生效）
      // 前端工具列表（仅对云托管或者云函数 agent 生效）
      tools: [
        {
          name: "get_weather",
          description: "获取指定城市的天气",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
          // 同步函数示例
          handler: (params) => {
            const { city } = params;
            return `城市${city}的天气是晴朗的，温度是25摄氏度，无风`;
          }
        },
        {
          name: "get_location",
          description: "获取指定城市的经纬度",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
          // 异步函数示例
          handler: async (params) => {
            const { city } = params;
            // 模拟网络延迟
            return new Promise((resolve) => {
              setTimeout(() => {
                resolve(`城市${city}的位置是东经114.305556度，北纬22.543056度`);
              }, 2000);
            });
          },
        },
      ],
    },
    modelConfig: {
      modelProvider: "", // 大模型服务厂商 (已隐藏)
      quickResponseModel: "deepseek-flash", // 快速响应模型（DeepSeek V4.1 Flash，支持深度思考）
      logo: "", // model 头像
      welcomeMsg: "", // model 欢迎语
      // roleName 参与会话存储 key 的生成，必须保持稳定；展示/提示词用 displayRoleName
      roleName: "法律顾问",
      displayRoleName: "法律顾问",
      uiLanguage: "zh",
      currentFeatureKey: "consult",
      currentFeatureLabel: "",
      businessCapabilities: [],
      featureWelcomeMap: {},
    },
    features: [],
    activeFeature: "consult",
    activeFeatureLabel: "",
    t: {},
  },
  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {
    attachPageLanguage(this);
    this.applyFeatureLanguage();
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {},

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    i18n.syncShell();
    const authUser = wx.getStorageSync("authUser");
    if (!authUser) {
      wx.reLaunch({
        url: "/pages/index/index",
      });
    }
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {},

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {},

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {},

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {},

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {},
  onLanguageChanged() {
    this.applyFeatureLanguage();
  },
  applyFeatureLanguage() {
    const features = buildFeatures();
    const featureWelcomeMap = buildFeatureWelcomeMap();
    const displayRoleName = i18n.t("chat.roleName");
    const activeFeatureLabel = this.getFeatureLabel(this.data.activeFeature, features);
    // 注意：不要在此处重设 modelConfig.currentFeatureKey，组件观察到该字段会切换会话并停止流式输出
    this.setData({
      features,
      activeFeatureLabel,
      "modelConfig.featureWelcomeMap": featureWelcomeMap,
      "modelConfig.businessCapabilities": features.map((item) => item.label),
      "modelConfig.roleName": "法律顾问",
      "modelConfig.displayRoleName": displayRoleName,
      "modelConfig.uiLanguage": i18n.getLanguage(),
      "modelConfig.welcomeMsg": i18n.t("chat.currentFeature", { name: activeFeatureLabel }),
      "modelConfig.currentFeatureLabel": activeFeatureLabel,
    });
  },
  selectFeature(e) {
    const key = e.currentTarget.dataset.key;
    const label = this.getFeatureLabel(key);
    this.setData({
      activeFeature: key,
      activeFeatureLabel: label,
      "modelConfig.welcomeMsg": i18n.t("chat.currentFeature", { name: label }),
      "modelConfig.currentFeatureKey": key,
      "modelConfig.currentFeatureLabel": label,
    });
  },
  getFeatureLabel(key, features) {
    const list = features || this.data.features;
    const item = list.find((feature) => feature.key === key);
    return item ? item.label : "";
  },
});
