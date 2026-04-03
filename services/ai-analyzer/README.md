# AI 分析服务

SecuAI MVP 中用于可解释启发式风险评分的 FastAPI 服务。

## 评分模型

当前版本不会调用任何外部 AI API 或大模型。

服务会结合简单规则与加权启发式算法，根据以下信号进行风险评分：
- SQL 注入特征
- XSS 载荷特征
- 可疑 User-Agent
- 简化后的高频访问行为
- 异常 HTTP 状态码
- `/admin`、`/login`、`/wp-admin` 等敏感路径

输出结果刻意保持可解释性：
- `riskScore`: `0-100`
- `riskLevel`: `low | medium | high`
- `reasons`：说明每一项加分原因的具体文本

## 运行

在仓库根目录执行：

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r services/ai-analyzer/requirements.txt
```

然后在 `services/ai-analyzer` 目录启动服务：

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 接口

### 健康检查

```bash
curl http://localhost:8000/health
```

### 分析请求

`POST /analyze`

示例：

```bash
curl -X POST http://localhost:8000/analyze ^
  -H "Content-Type: application/json" ^
  -d "{\"request_log\":{\"method\":\"GET\",\"host\":\"example.com\",\"path\":\"/admin/login\",\"query_string\":\"id=1 UNION SELECT password FROM users\",\"status_code\":404,\"client_ip\":\"203.0.113.10\",\"user_agent\":\"sqlmap/1.8.4\",\"metadata\":{\"recentRequestCount\":7}},\"attack_event\":{\"event_type\":\"sql_injection\",\"severity\":\"high\",\"summary\":\"Potential SQL injection detected\",\"details\":{\"ruleCode\":\"mvp-sqli-keyword\"}}}"
```

响应示例：

```json
{
  "riskScore": 100,
  "riskLevel": "high",
  "reasons": [
    "Matched SQL injection indicators: union select.",
    "Suspicious scanning user-agent detected: sqlmap.",
    "Request targeted sensitive paths: /admin, /login.",
    "Response status code 404 is commonly seen during probing or unauthorized access attempts.",
    "Recent request count 7 exceeded the simplified high-frequency threshold.",
    "Attack event type indicates a SQL injection finding.",
    "Attack event severity is high.",
    "Attack event context references a sensitive access path."
  ]
}
```

## 请求结构

`request_log` 为必填字段：

```json
{
  "request_log": {
    "method": "GET",
    "host": "example.com",
    "path": "/login",
    "query_string": "q=test",
    "status_code": 200,
    "client_ip": "203.0.113.10",
    "user_agent": "Mozilla/5.0",
    "referer": "https://example.com",
    "metadata": {
      "recentRequestCount": 3
    }
  },
  "attack_event": {
    "event_type": "sql_injection",
    "severity": "high",
    "summary": "Potential SQL injection detected",
    "details": {
      "ruleCode": "mvp-sqli-keyword"
    }
  }
}
```

`attack_event` 为可选字段。

## 环境变量

如果需要自定义 host 或 port，请将 `.env.example` 复制为 `.env` 后修改。

## API 集成说明

该分析服务已接入后端主流程：
1. `apps/api` 先持久化写入的 `request_logs`
2. 后端规则检测生成 `attack_events`
3. 事件落库后，`apps/api` 将 `request_log` 和 `attack_event` 发送到 `/analyze`
4. 分析器响应会存储到 `ai_risk_results`
5. 分析器失败会安全降级，不会回滚 `attack_events`

该集成已通过后端链路做过端到端验证：

```text
request_logs -> detection -> attack_events -> ai_risk_results
```

当前 API 侧持久化契约如下：
- `model_name = heuristic-analyzer`
- `model_version = v1`
- `reasons` 在落库的 raw response / factors 载荷中应保持数组语义
