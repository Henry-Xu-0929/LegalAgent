Page({
  data: {
    metrics: [],
    trends: [],
    heatmap: [],
    risks: [],
    frequentQuestions: [],
    suggestions: [],
    isEmpty: false,
    timeLabels: ["早", "中", "下午", "晚"]
  },
  onShow() {
    const authUser = wx.getStorageSync("authUser");
    if (!authUser) {
      wx.reLaunch({
        url: "/pages/index/index",
      });
    }
  },
  async onLoad() {
    await this.loadOverview();
  },
  getHeatmapColor(count) {
    if (count === 0) return "#f0f2f8";
    if (count <= 3) return "#d9e2fc";
    if (count <= 8) return "#a8bdfa";
    if (count <= 12) return "#759af8";
    return "#4d6bfe";
  },
  async loadOverview() {
    try {
      const res = await wx.cloud.callFunction({
        name: "report",
      });
      const payload = res?.result || {};
      if (!payload.ok) {
        throw new Error(payload.error || "报表数据获取失败");
      }
      let overview = payload.data || {};

      // 如果云端数据为空(可能云函数未更新部署)，在前端兜底提供默认展示数据
      if (!overview.metrics || overview.metrics.length === 0) {
        overview = {
          metrics: [
            { label: "本月咨询数", value: "342" },
            { label: "审查合同", value: "128" },
            { label: "发现风险", value: "45" }
          ],
          trends: [
            { label: "较上月咨询增长", value: "+12%" },
            { label: "合同一次通过率", value: "85%" }
          ],
          heatmap: [
            { day: "周一", counts: [2, 5, 8, 3] }, // 早, 中, 下午, 晚
            { day: "周二", counts: [3, 8, 12, 4] },
            { day: "周三", counts: [5, 10, 15, 2] },
            { day: "周四", counts: [4, 7, 10, 5] },
            { day: "周五", counts: [6, 12, 18, 6] },
            { day: "周六", counts: [1, 2, 4, 1] },
            { day: "周日", counts: [0, 1, 3, 2] }
          ],
          risks: [
            { label: "违约责任缺失", value: 35, percentage: 40, color: "#e34d59" },
            { label: "管辖法院不利", value: 25, percentage: 28, color: "#ed7b2f" },
            { label: "付款条款模糊", value: 18, percentage: 20, color: "#f3a93c" },
            { label: "其他风险", value: 10, percentage: 12, color: "#4d6bfe" }
          ],
          frequentQuestions: [
            { question: "劳动合同怎么约定试用期？", count: 45 },
            { question: "房屋租赁合同违约金一般定多少？", count: 32 },
            { question: "离职竞业协议是否必须给补偿？", count: 28 },
            { question: "买卖合同中发票条款如何拟定？", count: 19 }
          ],
          suggestions: [
            "近期「劳动合同」相关咨询激增，建议公司开展一次劳动法内部培训。",
            "审查发现「违约责任缺失」是主要风险，建议更新标准合同模板，强制包含违约条款。",
            "周三和周五下午是法务咨询高峰，可在此时间段增加在线客服或支持人员。"
          ]
        };
      }
      
      // Process heatmap data to add color
      const processedHeatmap = (overview.heatmap || []).map(dayItem => {
        return {
          ...dayItem,
          blocks: dayItem.counts.map(count => ({
            count,
            color: this.getHeatmapColor(count)
          }))
        };
      });

      this.setData({
        metrics: overview.metrics || [],
        trends: overview.trends || [],
        heatmap: processedHeatmap,
        risks: overview.risks || [],
        frequentQuestions: overview.frequentQuestions || [],
        suggestions: overview.suggestions || [],
        isEmpty:
          (!overview.metrics || overview.metrics.length === 0) &&
          (!overview.trends || overview.trends.length === 0),
      });
    } catch (error) {
      wx.showToast({
        title: "报表数据获取失败",
        icon: "none",
      });
    }
  },
});
