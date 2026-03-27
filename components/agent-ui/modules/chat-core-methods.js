const chatCoreStateMethods = require("./chat-core-state-methods");
const chatCoreArchiveMethods = require("./chat-core-archive-methods");
const chatCoreRetrievalMethods = require("./chat-core-retrieval-methods");
const chatCoreSendMethods = require("./chat-core-send-methods");

module.exports = {
  ...chatCoreStateMethods,
  ...chatCoreArchiveMethods,
  ...chatCoreRetrievalMethods,
  ...chatCoreSendMethods,
};
