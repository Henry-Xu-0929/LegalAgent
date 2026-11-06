// pages/components/feedback/index.js
const i18n = require("../../../utils/i18n");
const i18nBehavior = require("../../../utils/i18n-behavior");

const UP_VOTE_KEYS = [
  "upAccurate",
  "upComprehensive",
  "upStance",
  "upFormat",
  "upProfessional",
  "upCreative",
  "upClear",
  "upTrustworthy",
  "upEfficient",
  "upSatisfied",
];

const DOWN_VOTE_KEYS = [
  "downMisunderstood",
  "downUnrecognized",
  "downFactual",
  "downReasoning",
  "downIncomplete",
  "downUnprofessional",
  "downHarmful",
  "downFormat",
  "downGarbled",
  "downRepeated",
];

const buildVoteList = (keys, previous) =>
  keys.map((key, index) => ({
    key,
    // 提交给后端的 value 仍为中文规范值，保证统计口径不变
    value: ZhVoteValues[key],
    label: i18n.t(`feedback.${key}`),
    selected: !!previous?.[index]?.selected,
  }));

// 中文规范值（后端统计依赖，不随界面语言变化）
const ZhVoteValues = {
  upAccurate: "准确有效",
  upComprehensive: "回答全面",
  upStance: "立场正确",
  upFormat: "格式规范",
  upProfessional: "专业性强",
  upCreative: "富有创意",
  upClear: "表达清晰",
  upTrustworthy: "值得信赖",
  upEfficient: "高效",
  upSatisfied: "满意",
  downMisunderstood: "理解错误",
  downUnrecognized: "未识别问题",
  downFactual: "事实错误",
  downReasoning: "推理错误",
  downIncomplete: "内容不完整",
  downUnprofessional: "不专业",
  downHarmful: "违法有害",
  downFormat: "格式错误",
  downGarbled: "乱码",
  downRepeated: "内容重复",
};

Component({
  behaviors: [i18nBehavior],

  /**
   * 组件的属性列表
   */
  properties: {
    isShowFeedback: {
      type: Boolean,
      value: false
    },
    feedbackRecordId: {
      type: String,
      value: ''
    },
    feedbackType: {
      type: String,
      value: ''
    },
    botId: {
      type: String,
      value: ''
    },
    input: {
      type: String,
      value: ""
    },
    aiAnswer: {
      type: String,
      value: ''
    }
  },

  /**
   * 组件的初始数据
   */
  data: {
    upVote: [],
    downVote: [],
    score: 5,
    message: ""
  },
  attached() {
    this.refreshVoteLists();
  },
  onLanguageChanged() {
    this.refreshVoteLists();
  },
  observers: {
    "feedbackType": function (value) {
      this.setData({ score: value === 'upvote' ? 5 : 1 })
    }
  },
  /**
   * 组件的方法列表
   */
  methods: {
    refreshVoteLists() {
      this.setData({
        upVote: buildVoteList(UP_VOTE_KEYS, this.data.upVote),
        downVote: buildVoteList(DOWN_VOTE_KEYS, this.data.downVote),
      });
    },
    reset: function () {
      this.setData({
        upVote: buildVoteList(UP_VOTE_KEYS),
        downVote: buildVoteList(DOWN_VOTE_KEYS),
        score: 5,
        message: ""
      })
    },
    onChangeScore: function (e) {
      const { score } = e.currentTarget.dataset
      this.setData({ score })
    },
    onSelect: function (e) {
      const { item } = e.currentTarget.dataset
      const newArr = [...this.data.feedbackType === 'upvote' ? this.data.upVote : this.data.downVote]
      const [selectedItem] = newArr.filter(i => i.key === item.key)
      if (selectedItem) {
        selectedItem.selected = !selectedItem.selected
      }
      if (this.data.feedbackType === 'upvote') {
        this.setData({ upVote: newArr })
      } else {
        this.setData({ downVote: newArr })
      }

    },
    inputChange: function (e) {
      const value = e.detail.value
      this.setData({ message: value })
    },
    closeShowFeedback: function () {
      this.triggerEvent('close')
    },
    submitFeedback: async function () {
      const res = await wx.cloud.extend.AI.bot.sendFeedback({
        userFeedback: {
          botId: this.data.botId,
          recordId: this.data.feedbackRecordId,
          comment: this.data.message,
          rating: this.data.score,
          tags: this.data.feedbackType === 'upvote' ? this.data.upVote.filter(item => item.selected).map(item => item.value) : this.data.downVote.filter(item => item.selected).map(item => item.value),
          aiAnswer: this.data.aiAnswer,
          input: this.data.input,
          type: this.data.feedbackType === 'upvote' ? "upvote" : 'downvote',
        },
        botId: this.data.botId
      });
      if (res.status === 'success') {
        wx.showToast({
          title: i18n.t("feedback.thanks"),
          icon: "success",
        });
      } else {
        wx.showToast({
          title: i18n.t("feedback.failed"),
          icon: "fail",
        });
      }
      this.reset();
      // console.log(res)
      this.triggerEvent("close")
    }
  }
})
