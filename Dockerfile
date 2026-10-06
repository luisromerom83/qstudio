FROM python:3.11-slim

LABEL maintainer="Luis Romero <luisromerom>"
LABEL description="Quadient Inspire Flex - Demo & PoC Studio Manager Orchestrator"

# Install Docker CLI and Docker Compose v2 plugin
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    tar \
    && mkdir -m 0755 -p /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update && apt-get install -y --no-install-recommends \
    docker-ce-cli \
    docker-compose-plugin \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy manager application and bundled assets (demo-mode, helpers)
COPY manager/ ./manager/
COPY Inspire/demo-mode/ ./Inspire/demo-mode/
COPY init-databases.sql .
COPY grant_impersonation.java .
COPY clean_config.json .
COPY docker-compose.yml .

# Security hygiene: strip any local runtime files or credentials
RUN rm -rf ./manager/environments/* \
    && rm -rf ./manager/data/environments.json \
    && rm -rf ./manager/data/snapshots/* \
    && rm -f .quadient_credentials.env \
    && rm -f .env \
    && rm -f ./manager/studio.log \
    && rm -f ./manager/.studio.pid

# Expose Studio Manager port
EXPOSE 8090

# Entrypoint setup
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["python", "manager/app.py"]
