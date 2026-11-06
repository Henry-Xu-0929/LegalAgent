import { createWelcomeRecord, getFeatureWelcomeText } from "./model-request-builder";

const resolveWelcome = (component, featureKey, fallbackWelcome) =>
  typeof component.getLocalizedFeatureWelcomeText === "function"
    ? component.getLocalizedFeatureWelcomeText(featureKey)
    : getFeatureWelcomeText(featureKey, component.data.modelConfig, fallbackWelcome);

export const ensureFeatureConversationState = (component, featureKey, fallbackWelcome) => {
  const key = featureKey || "consult";
  const map = { ...component.data.featureChatRecordsMap };
  if (!map[key] || !map[key].length) {
    map[key] = [createWelcomeRecord(resolveWelcome(component, key, fallbackWelcome))];
  }
  const shouldUseThisFeature = component.data.activeFeatureKey === key;
  component.setData(
    shouldUseThisFeature
      ? { featureChatRecordsMap: map, chatRecords: map[key] }
      : { featureChatRecordsMap: map }
  );
};

export const initFeatureConversationState = (component) => {
  const featureKey = component.data.modelConfig?.currentFeatureKey || "consult";
  component.setData({
    activeFeatureKey: featureKey,
  });
  ensureFeatureConversationState(component, featureKey, component.data.modelConfig?.welcomeMsg);
};

export const switchFeatureConversationState = (component, nextFeatureKey) => {
  const nextKey = nextFeatureKey || "consult";
  const prevKey = component.data.activeFeatureKey || nextKey;
  const map = { ...component.data.featureChatRecordsMap };
  if (prevKey) {
    map[prevKey] = [...(component.data.chatRecords || [])];
  }
  
  let chatRecords = map[nextKey] || [];
  
  // 如果没有任何记录，则追加一条欢迎语
  if (!chatRecords.length) {
    const welcomeRecord = createWelcomeRecord(
      resolveWelcome(component, nextKey, component.data.modelConfig?.welcomeMsg)
    );
    chatRecords.push(welcomeRecord);
    map[nextKey] = chatRecords;
  }

  // 切换模式时，将该模式下之前可能被隐藏的历史记录恢复显示
  chatRecords = chatRecords.map(r => ({ ...r, hideInUI: false }));
  map[nextKey] = chatRecords;

  component.setData({
    featureChatRecordsMap: map,
    activeFeatureKey: nextKey,
    chatRecords: map[nextKey],
    chatStatus: 0,
  });
  component.toBottom();
};
