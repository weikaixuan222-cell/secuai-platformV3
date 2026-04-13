# SecuAI 智能防御平台

SecuAI 是一个面向小微企业网站的安全防护平台。当前仓库已同时提供：

- 开发联调入口：`npm run dev:demo-stack`
- Ubuntu 单机生产部署入口：`npm run prod:prepare`、`npm run prod:start`、`npm run doctor:prod`

如果你要自己部署 Ubuntu 服务器，请优先阅读：

- [Ubuntu 单机部署操作手册](./DEPLOYMENT_UBUNTU.md)

如果你只是本地开发或演示联调，请使用：

```bash
npm install
npm run dev:demo-stack
```

更多模块说明：

- [Web 使用说明](./apps/web/README.md)
- [API 使用说明](./apps/api/README.md)
- [演示指南](./DEMO_GUIDE.md)
- [站点接入主链路图](./SITE_INTEGRATION_FLOW.md)
