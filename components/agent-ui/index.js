// components/agent-ui/index.js
import { checkConfig, randomSelectInitquestion, getCloudInstance } from "./tools";
import {
  ensureFeatureConversationState,
  initFeatureConversationState,
  switchFeatureConversationState,
} from "./feature-conversation-manager";
import { createWelcomeRecord, getFeatureWelcomeText } from "./model-request-builder";
const conversationMethods = require("./modules/conversation-methods");
const fileMethods = require("./modules/file-methods");
const audioMethods = require("./modules/audio-methods");
const agentV2Methods = require("./modules/agent-v2-methods");
const chatCoreMethods = require("./modules/chat-core-methods");
const uiMethods = require("./modules/ui-methods");
const voiceMenuMethods = require("./modules/voice-menu-methods");
const scrollInputMethods = require("./modules/scroll-input-methods");
Component({
  /**
   * 组件的属性列表
   */
  options: {
    multipleSlots: true
  },
  properties: {
    chatMode: {
      type: String,
      value: "",
    },
    envShareConfig: {
      type: Object,
      value: {},
    },
    showBotAvatar: {
      type: Boolean,
      value: false,
    },
    presentationMode: {
      type: String,
      value: "",
    },
    agentConfig: {
      type: Object,
      value: {
        botId: "",
        allowUploadFile: true,
        allowWebSearch: true,
        allowPullRefresh: true,
        allowUploadImage: true,
        allowMultiConversation: true,
        allowVoice: true,
        showToolCallDetail: true,
        showBotName: true,
        tools: [],
      },
    },
    modelConfig: {
      type: Object,
      value: {
        modelProvider: "",
        quickResponseModel: "",
        logo: "",
        welcomeMsg: "",
      },
    },
  },

  observers: {
    showWebSearchSwitch: function (showWebSearchSwitch) {
      this.setData({
        showFeatureList: showWebSearchSwitch,
      });
    },
    'modelConfig.welcomeMsg': function (welcomeMsg) {
      if (this.data.chatMode === "model") {
        const featureKey = this.data.modelConfig?.currentFeatureKey || this.data.activeFeatureKey || "consult";
        this.ensureFeatureConversation(featureKey, welcomeMsg);
      }
    },
    'modelConfig.currentFeatureKey': function (featureKey) {
      if (this.data.chatMode === "model") {
        this.hideMenu();
        this.closeSetPanel();
        if (this.data.chatStatus !== 0) {
          this.stop();
        }
        this.switchFeatureConversation(featureKey || "consult");
      }
    },
    chatRecords: function (chatRecords) {
      if (this.data.chatMode !== "model") {
        return;
      }
      if (this._suspendChatRecordSync) {
        this._pendingFeatureChatRecords = Array.isArray(chatRecords) ? [...chatRecords] : [];
        return;
      }
      this.syncActiveFeatureChatRecords(chatRecords);
    },
    messages: function () {
      if (!this.data.isAgent) {
        return;
      }
      this.persistAgentSession();
    },
    threadId: function () {
      if (!this.data.isAgent) {
        return;
      }
      this.persistAgentSession();
    },
    agentConfig: function (agentConfig) {
      // console.log('mode', this.properties.chatMode)
      // 如果是agent-开头的，从agentConfig中提取agentID和tools,组成新的agentV2Config，对用户不可见
      if (this.properties.chatMode === "bot" && agentConfig.botId.startsWith("agent")) {
        this.setData({
          isAgent: true,
          threadId: "threadId_" + Date.now(),
          agentV2Config: {
            agentID: agentConfig.botId,
            tools: agentConfig.tools,
          },
        });
      }
    },
  },

  data: {
    isAgent: false,
    agentV2Config: {
      agentID: "",
      tools: [],
    },
    showMenu: false,
    tapMenuRecordId: "",
    isLoading: true, // 判断是否尚在加载中
    article: {},
    windowInfo: wx.getWindowInfo(),
    bot: {},
    inputValue: "",
    output: "",
    chatRecords: [],
    setPanelVisibility: false,
    questions: [],
    scrollTop: 0, // 文字撑起来后能滚动的最大高度
    viewTop: 0, // 根据实际情况，可能用户手动滚动，需要记录当前滚动的位置
    scrollTo: "", // 快速定位到指定元素，置底用
    scrollTimer: null, //
    manualScroll: false, // 当前为手动滚动/自动滚动
    showTools: false, // 展示底部工具栏
    showFileList: false, // 展示输入框顶部文件行
    showTopBar: false, // 展示顶部bar
    sendFileList: [],
    lastScrollTop: 0,
    showUploadFile: true,
    showUploadImg: true,
    showWebSearchSwitch: false,
    showPullRefresh: true,
    showToolCallDetail: true,
    showMultiConversation: true,
    showBotName: true,
    showVoice: true,
    useWebSearch: false,
    showFeatureList: false,
    chatStatus: 0, // 页面状态： 0-正常状态，可输入，可发送， 1-发送中 2-思考中 3-输出content中
    triggered: false,
    page: 1,
    size: 10,
    total: 0,
    refreshText: "下拉加载历史记录",
    shouldAddScrollTop: false,
    isShowFeedback: false,
    feedbackRecordId: "",
    feedbackType: "",
    textareaHeight: 50,
    defaultErrorMsg: "网络繁忙，请稍后重试!",
    curScrollHeight: 0,
    isDrawerShow: false,
    conversations: [],
    transformConversations: {},
    conversationPageOptions: {
      page: 1,
      size: 15,
      total: 0,
    },
    conversation: null,
    defaultConversation: null, // 旧结构默认会话
    fetchConversationLoading: false,
    audioContext: {}, // 只存储当前正在使用的音频context playStatus 状态 0 默认待播放 1 解析中 2 播放中
    audioSrcMap: {}, // 下载过的音频 src 缓存
    useVoice: false,
    startY: 0, // 触摸起点Y坐标
    longPressTriggered: false, // 长按是否触发
    sendStatus: 0, // 0 默认态 （还未触发长按） 1 待发送态 （触发长按，待发送） 2 待取消态 （触发长按，但超出阈值）3 发送 4 取消
    moveThreshold: 50, // 滑动阈值（单位：px）
    longPressTimer: null, // 长按定时器
    recorderManager: null,
    recordOptions: {
      duration: 60000, // 最长60s
      sampleRate: 44100,
      numberOfChannels: 1,
      encodeBitRate: 192000,
      format: "aac",
      frameSize: 50,
    },
    voiceRecognizing: false,
    speedList: [2, 1.5, 1.25, 1, 0.75],

    showActionMenu: false, // 是否显示操作菜单
    selectedConversation: null, // 当前选中的会话

    messages: [], // 消息列表
    threadId: "",
    activeFeatureKey: "consult",
    featureChatRecordsMap: {},
    userAvatarUrl: "",
  },
  attached: async function () {
    const authUser = wx.getStorageSync("authUser") || {};
    this.setData({
      userAvatarUrl: authUser.avatarUrl || authUser.avatar || "",
    });
    if (this.shouldResetSessionOnAttach()) {
      await this.clearSessionForTesting();
    }
    const chatMode = this.data.chatMode;
    // 检查配置
    const [check, message] = checkConfig(chatMode, this.data.agentConfig, this.data.modelConfig);
    if (!check) {
      wx.showModal({
        title: "提示",
        content: message,
      });
      return;
    }
    // 初始化一次cloudInstance，它是单例的，后面不传参数也可以获取到
    const cloudInstance = await getCloudInstance(this.data.envShareConfig);
    // 配置型 Agent 初始化
    if (chatMode === "bot") {
      console.log("ryan bot")
      const { botId } = this.data.agentConfig;
      if (botId.startsWith("agent")) {
        await this.restoreAgentSession();
        return;
      }
      const ai = cloudInstance.extend.AI;
      // 查询 agent 相关配置
      const bot = await ai.bot.get({ botId });
      // 新增错误提示
      if (bot.code) {
        wx.showModal({
          title: "提示",
          content: bot.message,
        });
        return;
      }

      // 初始化第一条记录为welcomeMessage
      const record = {
        content: bot.welcomeMessage || "你好，有什么我可以帮到你？",
        record_id: "record_id" + String(+new Date() + 10),
        role: "assistant",
        hiddenBtnGround: true,
      };
      
      if (chatMode === "model" && this.data.modelConfig.welcomeMsg) {
        record.content = this.data.modelConfig.welcomeMsg;
      }

      const { chatRecords } = this.data;
      // 随机选取三个初始化问题
      const questions = randomSelectInitquestion(bot.initQuestions, 3);
      let {
        allowWebSearch,
        allowUploadFile,
        allowPullRefresh,
        allowUploadImage,
        showToolCallDetail,
        allowMultiConversation,
        allowVoice,
        showBotName,
      } = this.data.agentConfig;
      allowWebSearch = allowWebSearch === undefined ? true : allowWebSearch;
      allowUploadFile = allowUploadFile === undefined ? true : allowUploadFile;
      allowPullRefresh = allowPullRefresh === undefined ? true : allowPullRefresh;
      allowUploadImage = allowUploadImage === undefined ? true : allowUploadImage;
      showToolCallDetail = showToolCallDetail === undefined ? true : showToolCallDetail;
      allowMultiConversation = allowMultiConversation === undefined ? true : allowMultiConversation;
      allowVoice = allowVoice === undefined ? true : allowVoice;
      showBotName = showBotName === undefined ? true : showBotName;
      this.setData({
        bot,
        questions,
        chatRecords: chatRecords.length > 0 ? chatRecords : [record],
        showWebSearchSwitch: allowWebSearch,
        showUploadFile: allowUploadFile,
        showUploadImg: allowUploadImage,
        showPullRefresh: allowPullRefresh,
        showToolCallDetail: showToolCallDetail,
        showMultiConversation: allowMultiConversation,
        showVoice: allowVoice,
        showBotName: showBotName,
      });
      // 如果多会话开启，拉一次会话
      if (this.data.bot.multiConversationEnable) {
        // 拉一次默认旧会话
        await this.fetchDefaultConversationList();
        // 拉一遍新会话列表
        await this.resetFetchConversationList();
      }
      if (this.data.bot.voiceSettings?.enable) {
        // 初始化录音管理器
        await this.initRecordManager();
        // 提前获取语音权限
        wx.getSetting({
          success(res) {
            if (!res.authSetting["scope.record"]) {
              wx.authorize({
                scope: "scope.record",
                success() { },
                fail() {
                  // 用户拒绝授权，可以引导用户到设置页面手动开启权限
                  wx.openSetting({
                    success(res) {
                      if (res.authSetting["scope.record"]) {
                        // 用户手动开启权限，可以进行录音操作
                      }
                    },
                  });
                },
              });
            }
          },
        });
      }
    }
    if (chatMode === "model") {
      const hasRestored = await this.restoreModelSession();
      if (!hasRestored) {
        this.initModelFeatureConversation();
      }
    }
  },
  detached: function () {
    this.persistModelSession(undefined, undefined, true);
    this.persistAgentSession(true);
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
    }
    if (this._streamRecordFlushTimer) {
      clearTimeout(this._streamRecordFlushTimer);
    }
    // 在组件实例被从页面节点树移除时执行，释放当前的音频资源
    const context = this.data.audioContext.context;
    if (context) {
      context.stop();
      context.destroy();
    }
  },
  methods: Object.assign({}, conversationMethods, fileMethods, audioMethods, agentV2Methods, chatCoreMethods, uiMethods, voiceMenuMethods, scrollInputMethods, {
    getMiniProgramEnvVersion: function () {
      try {
        return wx.getAccountInfoSync()?.miniProgram?.envVersion || "release";
      } catch (e) {
        return "release";
      }
    },
    shouldResetSessionOnAttach: function () {
      const envVersion = this.getMiniProgramEnvVersion();
      return envVersion !== "release";
    },
    clearSessionDocsByType: async function (sessionType) {
      const collection = this.getSessionCollection();
      const queryRes = await collection.where({ sessionType }).limit(100).get();
      const list = Array.isArray(queryRes?.data) ? queryRes.data : [];
      for (const item of list) {
        if (item?._id) {
          await collection.doc(item._id).remove();
        }
      }
    },
    clearSessionForTesting: async function () {
      if (this._modelPersistTimer) {
        clearTimeout(this._modelPersistTimer);
      }
      if (this._agentPersistTimer) {
        clearTimeout(this._agentPersistTimer);
      }
      this.setData({
        chatRecords: [],
        featureChatRecordsMap: {},
        messages: [],
        threadId: "threadId_" + Date.now(),
        conversation: null,
        defaultConversation: null,
      });
      try {
        wx.removeStorageSync("active_case_context");
      } catch (e) {}
      try {
        await this.clearSessionDocsByType("model");
        await this.clearSessionDocsByType("agent");
      } catch (e) {
        console.log("clearSessionForTesting failed", e);
      }
    },
    getModelSessionStorageKey: function () {
      const model = this.data.modelConfig?.quickResponseModel || "default";
      const roleName = this.data.modelConfig?.roleName || "assistant";
      return `agent_ui_model_session_${model}_${roleName}`;
    },
    getSessionCollection: function () {
      return wx.cloud.database().collection("agent_ui_sessions");
    },
    normalizeModelFeatureMapForPersist: function (featureMap) {
      const map = featureMap || {};
      const result = {};
      Object.keys(map).forEach((key) => {
        const list = Array.isArray(map[key]) ? map[key] : [];
        result[key] = list.slice(-30);
      });
      return result;
    },
    normalizeAgentMessagesForPersist: function (messages) {
      const list = Array.isArray(messages) ? messages : [];
      return list.slice(-40);
    },
    upsertSessionDoc: async function (sessionType, sessionKey, payload) {
      const collection = this.getSessionCollection();
      const queryRes = await collection.where({ sessionType, sessionKey }).limit(1).get();
      if (queryRes.data && queryRes.data.length) {
        const docId = queryRes.data[0]._id;
        await collection.doc(docId).update({
          data: payload,
        });
      } else {
        await collection.add({
          data: {
            sessionType,
            sessionKey,
            createdAt: Date.now(),
            ...payload,
          },
        });
      }
    },
    persistModelSession: function (featureMap, activeFeatureKey, force) {
      if (this.data.chatMode !== "model") {
        return;
      }
      if (this._modelPersistTimer) {
        clearTimeout(this._modelPersistTimer);
      }
      const runner = async () => {
        try {
          const finalMap = this.normalizeModelFeatureMapForPersist(featureMap || this.data.featureChatRecordsMap || {});
          const finalActiveKey = activeFeatureKey || this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult";
          await this.upsertSessionDoc("model", this.getModelSessionStorageKey(), {
            featureChatRecordsMap: finalMap,
            activeFeatureKey: finalActiveKey,
            updatedAt: Date.now(),
          });
        } catch (e) {
          console.log("persistModelSession failed", e);
        }
      };
      if (force) {
        runner();
      } else {
        this._modelPersistTimer = setTimeout(runner, 1200);
      }
    },
    restoreModelSession: async function () {
      if (this.data.chatMode !== "model") {
        return false;
      }
      try {
        const collection = this.getSessionCollection();
        const queryRes = await collection
          .where({ sessionType: "model", sessionKey: this.getModelSessionStorageKey() })
          .limit(1)
          .get();
        if (!queryRes.data || !queryRes.data.length) {
          return false;
        }
        const session = queryRes.data[0];
        const activeFeatureKey = session.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult";
        const featureMap = session.featureChatRecordsMap || {};

        // 临时清理 "合同起草" (draft) 和 "合同审查" (review) 的历史记录
        delete featureMap["draft"];
        delete featureMap["review"];

        let chatRecords = featureMap[activeFeatureKey];
        if (!Array.isArray(chatRecords) || !chatRecords.length) {
          return false;
        }

        // 过滤掉历史记录中的 Welcome 消息，并将真实对话隐藏
        Object.keys(featureMap).forEach((key) => {
          if (Array.isArray(featureMap[key])) {
            featureMap[key] = featureMap[key]
              .filter((r) => !r.isWelcome && !r.hiddenBtnGround)
              .map((record) => ({ ...record, hideInUI: true }));
          }
        });

        // 重新获取处理后的当前 feature 记录
        chatRecords = featureMap[activeFeatureKey] || [];
        
        // 追加一条新的、可见的 Welcome 消息
        const welcomeRecord = createWelcomeRecord(
          getFeatureWelcomeText(activeFeatureKey, this.data.modelConfig, this.data.modelConfig?.welcomeMsg)
        );
        chatRecords.push(welcomeRecord);
        featureMap[activeFeatureKey] = chatRecords;

        this.setData({
          featureChatRecordsMap: featureMap,
          activeFeatureKey,
          chatRecords,
        });
        return true;
      } catch (e) {
        console.log("restoreModelSession failed", e);
        return false;
      }
    },
    getAgentSessionStorageKey: function () {
      const agentID = this.data.agentV2Config?.agentID || this.data.agentConfig?.botId || "default";
      return `agent_ui_agent_session_${agentID}`;
    },
    persistAgentSession: function (force) {
      if (!this.data.isAgent) {
        return;
      }
      if (this._agentPersistTimer) {
        clearTimeout(this._agentPersistTimer);
      }
      const runner = async () => {
        try {
          await this.upsertSessionDoc("agent", this.getAgentSessionStorageKey(), {
            threadId: this.data.threadId,
            messages: this.normalizeAgentMessagesForPersist(this.data.messages || []),
            updatedAt: Date.now(),
          });
        } catch (e) {
          console.log("persistAgentSession failed", e);
        }
      };
      if (force) {
        runner();
      } else {
        this._agentPersistTimer = setTimeout(runner, 1200);
      }
    },
    restoreAgentSession: async function () {
      if (!this.data.isAgent) {
        return;
      }
      try {
        const collection = this.getSessionCollection();
        const queryRes = await collection
          .where({ sessionType: "agent", sessionKey: this.getAgentSessionStorageKey() })
          .limit(1)
          .get();
        if (!queryRes.data || !queryRes.data.length) {
          return;
        }
        const session = queryRes.data[0];
        this.setData({
          threadId: session.threadId || this.data.threadId || "threadId_" + Date.now(),
          messages: Array.isArray(session.messages) ? session.messages : [],
        });
      } catch (e) {
        console.log("restoreAgentSession failed", e);
      }
    },
    ensureFeatureConversation: function (featureKey, fallbackWelcome) {
      ensureFeatureConversationState(this, featureKey, fallbackWelcome);
    },
    initModelFeatureConversation: function () {
      initFeatureConversationState(this);
    },
    switchFeatureConversation: function (nextFeatureKey) {
      switchFeatureConversationState(this, nextFeatureKey);
    },
    openSetPanel: function () {
      this.setData({ setPanelVisibility: true });
    },
    closeSetPanel: function () {
      this.setData({ setPanelVisibility: false });
    },
    syncActiveFeatureChatRecords: function (chatRecords) {
      if (this.data.chatMode !== "model") {
        return;
      }
      const featureKey = this.data.activeFeatureKey || this.data.modelConfig?.currentFeatureKey || "consult";
      const nextRecords = Array.isArray(chatRecords) ? [...chatRecords] : [];
      const map = {
        ...this.data.featureChatRecordsMap,
        [featureKey]: nextRecords,
      };
      this.setData({
        featureChatRecordsMap: map,
      });
      this.persistModelSession(map, featureKey);
    },
    suspendChatRecordSync: function () {
      this._suspendChatRecordSync = true;
    },
    resumeChatRecordSync: function () {
      this._suspendChatRecordSync = false;
      if (this.data.chatMode !== "model") {
        this._pendingFeatureChatRecords = null;
        return;
      }
      const pendingRecords = this._pendingFeatureChatRecords;
      this._pendingFeatureChatRecords = null;
      this.syncActiveFeatureChatRecords(pendingRecords || this.data.chatRecords);
    },
  }),
});
