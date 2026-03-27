const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const action = event?.action;
  const username = (event?.username || "").trim();
  const password = event?.password || "";
  if (!username || !password) {
    return { ok: false, error: "请输入账号和密码" };
  }
  try {
    const users = db.collection("users");
    if (action === "register") {
      const existsRes = await users.where({ username }).get();
      if (existsRes.data && existsRes.data.length) {
        return { ok: false, error: "账号已存在" };
      }
      const addRes = await users.add({
        data: {
          username,
          password,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
      return { ok: true, userId: addRes._id };
    }
    if (action === "login") {
      const matchedRes = await users.where({ username, password }).get();
      if (!matchedRes.data || matchedRes.data.length === 0) {
        return { ok: false, error: "账号或密码错误" };
      }
      const user = matchedRes.data[0];
      await users.doc(user._id).update({
        data: {
          updatedAt: db.serverDate(),
        },
      });
      return { ok: true, userId: user._id, username: user.username };
    }
    return { ok: false, error: "不支持的操作" };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || error?.errMsg || "认证请求失败",
    };
  }
};
