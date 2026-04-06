(function () {
  // ========== 新增：本地存储相关常量和工具函数 ==========
  // 登录状态存储的key
  const LOGIN_STATUS_KEY = "user_login_status";
  // 有效期：3天（单位：毫秒）
  const LOGIN_EXPIRE_TIME = 0.6 * 24 * 60 * 60 * 1000;

  /**
   * 保存登录状态到本地存储（带过期时间）
   * @param {Object} userInfo 用户信息
   */
  function saveLoginStatus(userInfo) {
    const loginData = {
      userInfo: userInfo,
      loginTime: new Date().getTime(), // 登录时间戳
      expireTime: LOGIN_EXPIRE_TIME, // 有效期
    };
    localStorage.setItem(LOGIN_STATUS_KEY, JSON.stringify(loginData));
  }

  /**
   * 获取本地存储的登录状态（校验是否过期）
   * @returns {Object|null} 有效返回用户信息，无效返回null
   */
  function getLoginStatus() {
    try {
      const loginDataStr = localStorage.getItem(LOGIN_STATUS_KEY);
      if (!loginDataStr) return null;

      const loginData = JSON.parse(loginDataStr);
      const now = new Date().getTime();
      // 校验是否过期：当前时间 - 登录时间 > 有效期 → 过期
      if (now - loginData.loginTime > loginData.expireTime) {
        // 过期则清除存储
        removeLoginStatus();
        return null;
      }
      return loginData.userInfo;
    } catch (e) {
      console.error("获取登录状态失败：", e);
      removeLoginStatus();
      return null;
    }
  }

  /**
   * 移除本地存储的登录状态
   */
  function removeLoginStatus() {
    localStorage.removeItem(LOGIN_STATUS_KEY);
  }

  // ========== 新增：创建退出登录按钮 ==========
  /**
   * 创建退出登录按钮并添加到页面
   */
  function createLogoutButton() {
    // 避免重复创建
    if (document.getElementById("logout-btn")) return;

    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logout-btn";
    logoutBtn.className = "hidden"; // 默认隐藏
    // 添加退出登录的SVG图标
    logoutBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-power-icon lucide-circle-power">
        <path d="M12 7v4"/>
        <path d="M7.998 9.003a5 5 0 1 0 8-.005"/>
        <circle cx="12" cy="12" r="10"/>
      </svg>
    `;
    // 绑定退出登录事件
    logoutBtn.addEventListener("click", handleLogout);
    // 添加到body末尾
    document.body.appendChild(logoutBtn);
  }

  /**
   * 处理退出登录逻辑
   */
  function handleLogout() {
    // 1. 清除本地登录状态
    removeLoginStatus();
    // 2. 隐藏退出按钮
    hideLogoutButton();
    // ========== 新增：清空登录提示文本和输入框 ==========
    const tipText = document.getElementById("login-tip");
    if (tipText) {
      tipText.innerText = ""; // 清空提示文字
      tipText.className = ""; // 清空提示样式
    }
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    if (usernameInput) usernameInput.value = ""; // 清空用户名
    if (passwordInput) passwordInput.value = ""; // 清空密码
    // 3. 重新显示登录弹窗
    showLoginModal();
    // 4. 提示退出成功
    alert("已成功退出登录");
  }

  /**
   * 显示退出登录按钮
   */
  function showLogoutButton() {
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.classList.remove("hidden");
    }
  }

  /**
   * 隐藏退出登录按钮
   */
  function hideLogoutButton() {
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.classList.add("hidden");
    }
  }

  // ========== 原有逻辑改造 ==========
  /**
   * 动态创建登录弹窗HTML结构
   */
  function createLoginModal() {
    const loginContainer = document.getElementById("login");
    if (!loginContainer) {
      console.error("未找到id为login的容器");
      return false;
    }

    const modalHTML = `
      <div id="login-mask" class="hidden">
        <div id="login-modal">
          <h3 class="login-title">系统登录</h3>
          <div class="input-wrap">
            <label class="input-label" for="username">用户名：</label>
            <input type="text" id="username" class="login-input" placeholder="请输入用户名" />
          </div>
          <div class="input-wrap password-wrap">
            <label class="input-label" for="password">密码：</label>
            <input type="password" id="password" class="login-input" placeholder="请输入密码" />
          </div>
          <div id="login-tip"></div>
          <button id="login-btn">登录</button>
        </div>
      </div>
    `;
    loginContainer.innerHTML = modalHTML;
    return true;
  }

  // 账户数据
  const userAccounts = [
    { username: "admin", password: "123456", type: "超级管理员" },
    { username: "1", password: "1", type: "超级管理员" },
    { username: "editor", password: "editor123", type: "内容编辑" },
    { username: "viewer", password: "viewer123", type: "只读查看" },
    { username: "operator", password: "op123456", type: "运维人员" },
  ];

  // 登录成功对外暴露的接口
  window.loginSuccess = function (userInfo) {
    console.log("登录成功，账户信息：", userInfo);
    return userInfo;
  };

  /**
   * 显示登录弹窗
   */
  function showLoginModal() {
    const mask = document.getElementById("login-mask");
    if (mask) {
      mask.classList.remove("hidden");
      document.body.style.overflow = "hidden";
      // 聚焦用户名输入框
      document.getElementById("username")?.focus();
    }
  }

  /**
   * 登录验证逻辑
   */
  function bindLoginEvent(
    usernameInput,
    passwordInput,
    tipText,
    mask,
    loginBtn,
  ) {
    const validateLogin = () => {
      const inputUsername = usernameInput.value.trim();
      const inputPassword = passwordInput.value.trim();

      // 清空提示
      tipText.innerText = "";
      tipText.className = "";

      // 空值验证
      if (!inputUsername) {
        tipText.innerText = "请输入用户名";
        tipText.className = "error";
        usernameInput.focus();
        return;
      }
      if (!inputPassword) {
        tipText.innerText = "请输入密码";
        tipText.className = "error";
        passwordInput.focus();
        return;
      }

      // 匹配账户信息
      const matchedUser = userAccounts.find(
        (user) =>
          user.username === inputUsername && user.password === inputPassword,
      );

      if (matchedUser) {
        // ========== 新增：登录成功逻辑改造 ==========
        // 1. 保存登录状态到本地存储（3天有效期）
        saveLoginStatus(matchedUser);
        // 2. 执行对外接口
        window.loginSuccess(matchedUser);
        // 3. 显示登录成功提示
        const successText = `${matchedUser.username} 登录成功，以${matchedUser.type}权限进入...`;
        tipText.innerText = successText;
        tipText.className = "success";
        // 4. 延迟关闭弹窗并显示退出按钮
        setTimeout(() => {
          mask.classList.add("hidden");
          document.body.style.overflow = "";
          // 清空输入框
          usernameInput.value = "";
          passwordInput.value = "";
          // 显示退出登录按钮
          showLogoutButton();
        }, 166);
      } else {
        // 验证失败
        tipText.innerText = "用户名或密码错误，请重新输入";
        tipText.className = "error";
        passwordInput.value = "";
        passwordInput.focus();
      }
    };

    // 绑定按钮点击事件
    loginBtn.addEventListener("click", validateLogin);

    // 回车触发登录
    [usernameInput, passwordInput].forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") validateLogin();
      });
    });
  }

  /**
   * 初始化登录逻辑（核心入口）
   */
  function initLoginSystem() {
    // 1. 创建退出登录按钮
    createLogoutButton();
    // 2. 创建登录弹窗DOM
    const isCreated = createLoginModal();
    if (!isCreated) return;

    const mask = document.getElementById("login-mask");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const tipText = document.getElementById("login-tip");
    const loginBtn = document.getElementById("login-btn");

    // 3. 校验本地登录状态
    const loginUser = getLoginStatus();
    if (loginUser) {
      // 有有效登录状态：隐藏登录弹窗，显示退出按钮
      mask.classList.add("hidden");
      document.body.style.overflow = "";
      showLogoutButton();
      console.log("自动登录成功：", loginUser);
      window.loginSuccess(loginUser); // 执行登录成功回调
    } else {
      // 无有效登录状态：显示登录弹窗
      showLoginModal();
    }

    // 4. 绑定登录事件
    bindLoginEvent(usernameInput, passwordInput, tipText, mask, loginBtn);
  }

  // 页面加载完成后初始化
  window.addEventListener("load", initLoginSystem);
})();
