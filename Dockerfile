FROM node:8.11-stretch

# Install craft
RUN yarn global add @sentry/craft

# Common
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    apt-transport-https \
    curl \
    git \
    wget \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Install twine
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python-pip \
  && pip install twine==1.11.0 \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Install dotnet core SDK
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
RUN wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > /etc/apt/trusted.gpg.d/microsoft.asc.gpg \
  && wget -q https://packages.microsoft.com/config/debian/9/prod.list \
  && mv prod.list /etc/apt/sources.list.d/microsoft-prod.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends dotnet-sdk-2.1 \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && dotnet --version

USER node

# Install Rust and Cargo
ENV PATH=${PATH}:/home/node/.cargo/bin
RUN curl https://sh.rustup.rs -sSf -o /tmp/rustup.sh \
  && bash /tmp/rustup.sh -y \
  && rustc --version \
  && cargo --version

ENTRYPOINT ["/usr/local/bin/craft"]
