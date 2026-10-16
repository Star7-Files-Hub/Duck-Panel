# Docker 部署

复制 config.example.json 为 config.json 并填写真实参数，然后执行：

```bash
mkdir -p data
export DUCKFLOW_IMAGE=stars7/duck-panel:latest
export DUCK_ADMIN_PASSWORD=change-this-password
docker compose pull
docker compose up -d
docker compose ps
```

compose 只拉取 Docker Hub 镜像，不进行本地 build。

GitHub Actions 需要配置 Repository variable `DOCKERHUB_USERNAME` 和 secret `DOCKERHUB_TOKEN`。推送 main 发布 latest，推送 v0.1.0 发布版本标签。
