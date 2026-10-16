# DuckFlow Media Control

独立开发的 STRM / Emby 控制面板，默认按官方云盘 API 接入，CloudDrive2 只保留为后续可选适配器。

## 已实现

- 管理员与子账号登录、权限字段和服务端 RBAC
- 官方云盘适配器接口：文件列表、分享转存、直链、复制、删除、配额
- 多账号副本与路由缓存，按出口流量余量优先选择副本
- 每账号默认 5 TB 月度出口配额和剩余 500 GB 迁移阈值
- Telegram 通知适配器和频道消息链接解析基础
- STRM 逻辑路径到官方直链的 302 入口
- 深色控制塔概览：在线播放、配额、流量、告警、任务队列

## 启动

```bash
npm install
DUCK_ADMIN_PASSWORD=change-this npm start
```

首次启动默认创建 admin，建议通过环境变量修改密码。访问 http://127.0.0.1:17890。

## 官方 API 接入契约

真实供应商字段集中适配在 src/adapters/official.js，业务层不依赖具体返回格式。当前契约需要映射：GET /files?path= 目录列表、POST /transfers 分享转存、GET /files/direct?key= 返回临时直链、POST /files/copy 跨账号复制、DELETE /files 删除远端对象、GET /account/quota 查询容量和出口配额。

## 设计参考

媒体整理、STRM 全量/增量生成和 302 反代的产品分层参考了 https://github.com/walkingddd/TgtoDrive，本项目额外加入多账号分片、配额账本、迁移队列和 RBAC。
