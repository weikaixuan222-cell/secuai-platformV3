# 数据库层

## 文件说明

- `../../db/schema.sql`：MVP 的 PostgreSQL schema
- `client.ts`：创建共享 PostgreSQL 连接池
- `apply-schema.ts`：将 schema 应用到运行中的 PostgreSQL 实例
- `types.ts`：数据库行与写入输入对应的 TypeScript 类型

## 运行

在 PostgreSQL 已启动且环境变量已配置后执行：

```bash
npm run db:schema --workspace @secuai/api
```
