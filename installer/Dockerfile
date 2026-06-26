# DT Orch Setup Installer — API + wizard UI
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY installer/frontend/package.json installer/frontend/package-lock.json ./
RUN npm ci
COPY installer/frontend/ ./
RUN npm run build

FROM docker:24-cli AS dockercli

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash curl openssh-client openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
RUN mkdir -p /usr/local/libexec/docker/cli-plugins
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-compose \
    /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=dockercli /usr/local/bin/docker-compose /usr/local/bin/docker-compose
RUN curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash \
    && curl -fsSL "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl

WORKDIR /opt/installer
COPY installer/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY installer/backend/ ./
COPY installer/shared/ /opt/installer/shared/

COPY --from=frontend-build /build/dist ./static/

ENV ETL_DEPLOYMENT_ROOT=/opt/etl-deployment
ENV INSTALLER_STATE_DIR=/opt/etl-deployment-state
ENV PYTHONPATH=/opt/installer

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
