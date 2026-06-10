# SmartElectricity

**Optimize your home battery against real-time electricity prices.**

**根据实时电价优化你的家庭电池。**

SmartElectricity is a local-first home energy operating cockpit for Amber users. It combines price backtesting, battery monitoring, strategy design, leaderboard/community views, and optional local battery control through your own bridge.

SmartElectricity 是一个面向 Amber 用户的本地优先家庭能源操作台。它把电价回测、电池监控、策略设计、社区榜单，以及通过你自己的本地 bridge 进行的可选电池控制整合到同一个界面里。

**Production:** https://smartelectricity.com.au

## Product Overview / 产品概览

- `Home`: live price curve, action guidance, usage context, decision console  
  `Home`：实时价格曲线、动作建议、用电上下文、决策面板
- `Backtest`: pull Amber data, compare strategies, inspect results, run LLM strategy overlays  
  `Backtest`：拉取 Amber 数据、对比策略、分析结果、运行 LLM 策略叠加
- `Monitor`: battery telemetry, source health, local control readiness, raw diagnostics  
  `Monitor`：电池遥测、数据源健康、本地控制就绪状态、原始诊断
- `Config`: account sync, onboarding, private secrets vault, bridge validation  
  `Config`：账号同步、onboarding、私有密钥仓、bridge 校验
- `Welcome / Leaderboard`: public-facing community surface with region map and filtered rankings  
  `Welcome / Leaderboard`：带区域地图和筛选榜单的公共社区界面

## Screenshots / 截图建议

Add screenshots under `docs/screenshots/` and replace the placeholders below.

把截图放到 `docs/screenshots/` 目录，然后替换下面这些占位图。

### Home / 首页
![Home screenshot placeholder](docs/screenshots/home.png)

Recommended capture:
- 30-min price curve
- action mix
- home decision console

建议截图内容：
- 30 分钟价格曲线
- 动作分布
- 首页决策面板

### Backtest / 回测
![Backtest screenshot placeholder](docs/screenshots/backtest.png)

Recommended capture:
- data pull controls
- strategy comparison
- LLM strategy panel

建议截图内容：
- 数据拉取区域
- 策略对比结果
- LLM Strategy 面板

### Monitor / 监控
![Monitor screenshot placeholder](docs/screenshots/monitor.png)

Recommended capture:
- telemetry cards
- source health
- local control readiness

建议截图内容：
- 遥测卡片
- 数据源健康状态
- 本地控制就绪状态

### Config / 配置
![Config screenshot placeholder](docs/screenshots/config.png)

Recommended capture:
- onboarding
- private secret vault
- bridge validation

建议截图内容：
- onboarding
- 私有密钥仓
- bridge 校验

### Welcome / 社区入口
![Welcome screenshot placeholder](docs/screenshots/welcome.png)

Recommended capture:
- Australia region map
- public metrics summary
- top preview list

建议截图内容：
- 澳洲区域地图
- 公共指标摘要
- 榜单预览

### Leaderboard / 榜单
![Leaderboard screenshot placeholder](docs/screenshots/leaderboard.png)

Recommended capture:
- region filters
- bucket filters
- current public view

建议截图内容：
- 区域筛选
- bucket 筛选
- 当前公共视图

### Local Bridge / 本地 Bridge
![Bridge screenshot placeholder](docs/screenshots/bridge-status.png)

Recommended capture:
- `/status` page
- config validation
- provider health

建议截图内容：
- `/status` 页面
- 配置校验结果
- provider 健康状态

## Core Capabilities / 核心能力

### 1. Amber Price Workflow / Amber 电价工作流

- Pull current and historical Amber prices
- Run strategy backtests across configurable windows
- Compare threshold, percentile, and custom strategy variants
- Use local or account-scoped Amber credentials

- 拉取 Amber 实时与历史电价
- 在可配置时间窗口内运行策略回测
- 对比 threshold、percentile 和自定义策略
- 支持本地或账号级 Amber 凭据

### 2. Battery Monitoring / 电池监控

- Unified battery telemetry model for UI rendering
- Live, degraded, fallback, and simulated status handling
- Battery source diagnostics and raw detail panels
- Monitor-first design when no local control path is available

- UI 层统一的电池遥测模型
- 支持 live、degraded、fallback、simulated 状态
- 电池数据源诊断和原始详情面板
- 没有本地控制路径时默认以监控优先

### 3. Strategy Studio + LLM / 策略工作台与 LLM

- Save local strategy snapshots
- Save cloud strategy profiles after sign-in
- Generate profile state from current backtest result
- Optional LLM strategy layer with a user-supplied API token

- 保存本地策略快照
- 登录后保存云端策略 profile
- 从当前回测结果生成策略状态
- 支持使用用户自带 API token 的 LLM 策略层

### 4. Public Community Surface / 公共社区界面

- Welcome landing with Australia region map
- Region -> leaderboard handoff
- Public-only leaderboard metrics
- No local hostnames, bridge URLs, or private credentials on public panels

- 带澳洲区域地图的 Welcome 入口
- 从区域点击跳转到榜单筛选
- 仅展示公共指标的榜单
- 公共页面不暴露本地主机、bridge URL 或私有凭据

## Local Control Model / 本地控制模型

Launch scope supports local control only through:

上线版本地控制只支持以下两种路径：

- `home-assistant`
- `generic-modbus`

The website does **not** relay battery control through the cloud.

网站**不会**通过云端代发电池控制命令。

It only talks to your own local bridge.

它只会与用户自己的本地 bridge 通信。

### Required Local Endpoints / 本地桥必需接口

Your local bridge should expose:

你的本地 bridge 需要提供：

```http
GET /api/health
GET /status
GET /api/config/validate
GET /api/battery/telemetry
GET /api/device/command/health
POST /api/device/command
```

### Bundled Server Behavior / 内置本地 server 的行为

The bundled dev server is intentionally read-only:

项目自带的 dev server 是刻意设计成只读的：

- it can help with local development
- it is **not** a production battery control path
- real battery control requires your own Home Assistant or Generic Modbus bridge

- 可用于本地开发
- **不是**生产环境电池控制链路
- 真正的电池控制需要你自己的 Home Assistant 或 Generic Modbus bridge

## Security Model / 安全模型

### What stays out of cloud config / 哪些内容不会进入云配置

- Amber token
- Solcast API key
- LLM API token
- HA token
- Modbus host / port / unit / base register
- bridge URL
- vendor credentials

- Amber token
- Solcast API key
- LLM API token
- HA token
- Modbus host / port / unit / base register
- bridge URL
- 厂商凭据

### What is cloud-synced / 哪些内容会云同步

- Amber site ID
- non-secret strategy settings
- region / profile metadata
- control mode labels and non-secret readiness metadata

- Amber site ID
- 非敏感策略参数
- 区域 / profile 元数据
- 控制模式标签及非敏感状态元数据

### Private Secrets Vault / 私有密钥仓

The app supports an owner-scoped private secrets vault for:

应用支持账号所有者私有密钥仓，用于保存：

- Amber API token
- Solcast API key
- LLM API token

Guest mode does not expose saved account secrets.

Guest 模式不会暴露账号已保存的私有密钥。

## Quick Start / 快速开始

### 1. Web UI / 前端界面

```bash
cd web
npm install
npm run dev
```

Open:

打开：

```text
http://localhost:5173
```

### 2. Local Dev Server / 本地开发 server

```bash
cd web
npm run server
```

Runs on:

运行地址：

```text
http://localhost:5174
```

### 3. Frontend Environment / 前端环境变量

Create `web/.env` from `web/.env.example`:

从 `web/.env.example` 复制一份 `web/.env`：

```env
VITE_SUPABASE_FUNCTIONS_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_CUSTOM_DOMAIN=...
VITE_PUBLIC_APP_URL=...
```

Do **not** place third-party secrets like `SOLCAST_API_KEY`, `AMBER_TOKEN`, or `OPENROUTER_API_KEY` in the frontend `.env`.

不要把 `SOLCAST_API_KEY`、`AMBER_TOKEN`、`OPENROUTER_API_KEY` 这类第三方密钥放进前端 `.env`。

## Onboarding Flow / 新用户引导流程

1. Open `Config`
2. Sign up or sign in
3. Add your Amber site ID
4. Add your private API tokens
5. Validate your local bridge if you want battery telemetry or control
6. Go to `Backtest` and pull data

1. 打开 `Config`
2. 注册或登录
3. 填写自己的 Amber site ID
4. 填写自己的私有 API token
5. 如果要电池遥测或控制，先校验本地 bridge
6. 回到 `Backtest` 拉数据

## Local Bridge / 本地 Bridge

See:

详见：

- [bridge/README.md](bridge/README.md)
- [docs/local-bridge-onboarding.md](docs/local-bridge-onboarding.md)
- [docs/local-bridge-spec.md](docs/local-bridge-spec.md)

## Release / 上线前检查

See:

详见：

- [docs/release-checklist.md](docs/release-checklist.md)
- [docs/release-smoke-report.md](docs/release-smoke-report.md)
- [docs/payload-audit.md](docs/payload-audit.md)

## Repo Notes / 仓库说明

- internal repo/workspace path is still `SmartElectricity`
- user-facing product name is `SmartElectricity`

- 仓库内部目录名仍然是 `SmartElectricity`
- 面向用户展示的产品名是 `SmartElectricity`

## License / 许可

This project is proprietary. Commercial use, redistribution, and modification are not allowed without prior written permission from Wang Zhen. See [LICENSE](LICENSE).

本项目采用专有许可。未经 Wang Zhen 书面许可，不得商用、再分发或修改。详见 [LICENSE](LICENSE)。
