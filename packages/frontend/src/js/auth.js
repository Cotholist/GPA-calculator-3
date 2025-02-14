// JWT令牌管理
class AuthManager {
    constructor() {
        this.tokenKey = 'gpa_jwt_token';
        this.userKey = 'gpa_user_info';
        this.checkInterval = null;
        
        // Cloudflare Access配置
        this.config = {
            // 使用你的Workers域名作为认证域名
            authDomain: 'gpa-calculator.1810601166hank.workers.dev',
            // 应用程序域名
            appDomain: '59a1f0ce.gpa-calculator-3.pages.dev'
        };
    }

    // 获取登录URL
    getLoginUrl() {
        return `https://${this.config.authDomain}/cdn-cgi/access/login?redirect_url=https://${this.config.appDomain}`;
    }

    // 获取登出URL
    getLogoutUrl() {
        return `https://${this.config.authDomain}/cdn-cgi/access/logout?redirect_url=https://${this.config.appDomain}`;
    }

    // 获取身份验证URL
    getIdentityUrl() {
        return `https://${this.config.authDomain}/cdn-cgi/access/get-identity`;
    }

    // 解析JWT令牌
    parseJWT(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));

            return JSON.parse(jsonPayload);
        } catch (error) {
            console.error('解析JWT令牌失败:', error);
            return null;
        }
    }

    // 获取并存储用户信息
    async fetchAndStoreUserInfo() {
        try {
            const response = await fetch(this.getIdentityUrl(), {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('获取用户信息失败');
            }

            const data = await response.json();
            const userInfo = {
                email: data.email,
                name: data.name || data.email.split('@')[0],
                id: data.id,
                groups: data.groups || [],
                lastUpdate: new Date().getTime()
            };

            // 安全地存储用户信息
            sessionStorage.setItem(this.userKey, JSON.stringify(userInfo));
            return userInfo;
        } catch (error) {
            console.error('获取用户信息时出错:', error);
            return null;
        }
    }

    // 获取当前用户信息
    getUserInfo() {
        try {
            const userInfoStr = sessionStorage.getItem(this.userKey);
            if (!userInfoStr) {
                return null;
            }
            return JSON.parse(userInfoStr);
        } catch (error) {
            console.error('读取用户信息时出错:', error);
            return null;
        }
    }

    // 开始会话监控
    startSessionMonitor() {
        // 每5分钟检查一次会话状态
        this.checkInterval = setInterval(() => this.checkSession(), 5 * 60 * 1000);
    }

    // 停止会话监控
    stopSessionMonitor() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    // 检查会话状态
    async checkSession() {
        try {
            const response = await fetch(this.getIdentityUrl(), {
                credentials: 'include'
            });

            if (!response.ok) {
                this.clearSession();
                window.location.href = this.getLoginUrl();
                return false;
            }

            return true;
        } catch (error) {
            console.error('检查会话状态时出错:', error);
            this.clearSession();
            window.location.href = this.getLoginUrl();
            return false;
        }
    }

    // 清除会话
    clearSession() {
        sessionStorage.removeItem(this.userKey);
        this.stopSessionMonitor();
    }

    // 登出
    async logout() {
        this.clearSession();
        window.location.href = this.getLogoutUrl();
    }
}

// 导出单例实例
export const authManager = new AuthManager();
