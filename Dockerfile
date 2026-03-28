FROM kalilinux/kali-rolling

# Install system dependencies in a single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    wget \
    whois \
    dnsutils \
    unzip \
    ca-certificates \
    libpcap-dev \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip3 install uv --break-system-packages

# Detect target architecture for multi-arch binary downloads
ARG TARGETARCH

# Install subfinder (pinned version)
RUN wget -q https://github.com/projectdiscovery/subfinder/releases/download/v2.6.6/subfinder_2.6.6_linux_${TARGETARCH}.zip \
    -O /tmp/subfinder.zip \
    && unzip /tmp/subfinder.zip subfinder -d /usr/local/bin/ \
    && chmod +x /usr/local/bin/subfinder \
    && rm /tmp/subfinder.zip

# Install dnsx (pinned version)
RUN wget -q https://github.com/projectdiscovery/dnsx/releases/download/v1.2.1/dnsx_1.2.1_linux_${TARGETARCH}.zip \
    -O /tmp/dnsx.zip \
    && unzip /tmp/dnsx.zip dnsx -d /usr/local/bin/ \
    && chmod +x /usr/local/bin/dnsx \
    && rm /tmp/dnsx.zip

# Install naabu (pinned version)
RUN wget -q https://github.com/projectdiscovery/naabu/releases/download/v2.5.0/naabu_2.5.0_linux_${TARGETARCH}.zip \
    -O /tmp/naabu.zip \
    && unzip /tmp/naabu.zip naabu -d /usr/local/bin/ \
    && chmod +x /usr/local/bin/naabu \
    && rm /tmp/naabu.zip

WORKDIR /app

# Copy source code
COPY . .

# Install Python dependencies via uv (installs project + deps into .venv)
RUN uv sync

# Add venv to PATH so `python` resolves to the venv Python
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app"
