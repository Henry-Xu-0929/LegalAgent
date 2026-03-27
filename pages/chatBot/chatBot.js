// pages/chatBot/chatBot.js
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
      quickResponseModel: "deepseek-v3", // 快速响应模型 （混元 turbo, gpt4 turbo版，deepseek v3等）
      logo: "", // model 头像
      welcomeMsg: "欢迎语", // model 欢迎语
      roleName: "法律顾问",
      currentFeatureKey: "consult",
      currentFeatureLabel: "法律咨询",
      businessCapabilities: [
        "法律咨询",
        "对话分析",
        "合同起草",
        "合同审查",
        "证据链整理",
        "文书生成",
      ],
      featureWelcomeMap: {
        consult: `你好，我是你的专业法律顾问
## 当前功能：法律咨询
我可以为你提供：
1. **案件定性初判**
2. **法律风险识别**
3. **可执行应对建议**

请先告诉我：
- 基本事实（时间、地点、人物、经过）
- 你的目标（维权、抗辩、协商、起诉）`,
        analysis: `你好，我是你的专业法律顾问
## 当前功能：对话分析
我会帮你输出：
1. **关键事实提炼**
2. **法律风险点识别**
3. **沟通与取证建议**

请粘贴完整对话（可脱敏），我会按时间线分析。`,
        draft: `你好，我是你的专业法律顾问
## 当前功能：合同起草
我会基于你的业务场景生成合同草案，重点覆盖：
1. **权利义务**
2. **违约责任**
3. **争议解决**

请提供：交易类型、双方信息、金额/期限、核心条款诉求。`,
        review: `你好，我是你的专业法律顾问
## 当前功能：合同审查
我将按条款给你：
1. **风险等级**
2. **问题说明**
3. **修改建议示例**

请发送合同原文（或关键条款），我会逐项审查。`,
        evidence: `你好，我是你的专业法律顾问
## 当前功能：证据链整理
我会帮你完成：
1. **证明目标拆解**
2. **现有证据归类**
3. **缺口与补强方案**

请先列出现有证据清单（聊天记录、转账、合同、录音等）。`,
        document: `你好，我是你的专业法律顾问
## 当前功能：文书生成
我可以协助生成：
1. **律师函/催告函**
2. **起诉状/答辩状**
3. **情况说明等法律文书**

请说明文书类型、案件事实、诉求和收件对象。`,
      },
    },
    features: [
      { key: "consult", label: "法律咨询" },
      { key: "analysis", label: "对话分析" },
      { key: "draft", label: "合同起草" },
      { key: "review", label: "合同审查" },
      { key: "evidence", label: "证据链整理" },
      { key: "document", label: "文书生成" },
    ],
    activeFeature: "consult",
    activeFeatureLabel: "法律咨询",
  },
  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {
    const currentLabel = this.getFeatureLabel(this.data.activeFeature);
    this.setData({
      activeFeatureLabel: currentLabel,
      "modelConfig.welcomeMsg": `当前功能：${currentLabel}`,
      "modelConfig.currentFeatureKey": this.data.activeFeature,
      "modelConfig.currentFeatureLabel": currentLabel,
    });
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {},

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
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
  selectFeature(e) {
    const key = e.currentTarget.dataset.key;
    const label = this.getFeatureLabel(key);
    this.setData({
      activeFeature: key,
      activeFeatureLabel: label,
      "modelConfig.welcomeMsg": `当前功能：${label}`,
      "modelConfig.currentFeatureKey": key,
      "modelConfig.currentFeatureLabel": label,
    });
  },
  getFeatureLabel(key) {
    const item = this.data.features.find((feature) => feature.key === key);
    return item ? item.label : "";
  },
});
