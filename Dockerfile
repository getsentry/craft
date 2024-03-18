FROM node:18-bullseye-slim as builder

WORKDIR /usr/local/lib

COPY package.json yarn.lock ./
RUN export YARN_CACHE_FOLDER="$(mktemp -d)" \
  && yarn install --frozen-lockfile --quiet \
  && rm -r "$YARN_CACHE_FOLDER"

COPY . .

RUN \
   NODE_ENV=production \
  NODE_PATH=/usr/local/lib/node_modules \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/lib/node_modules/.bin" \
  yarn --modules-folder /usr/local/lib/node_modules build

FROM node:18-bullseye

ENV DEBIAN_FRONTEND=noninteractive \
  DOTNET_CLI_TELEMETRY_OPTOUT=1 \
  # See https://github.com/CocoaPods/CocoaPods/issues/6795
  COCOAPODS_ALLOW_ROOT=1 \
  CARGO_HOME=/root/.cargo \
  RUSTUP_HOME=/root/.rustup \
  PATH=${PATH}:/root/.cargo/bin:/opt/flutter/bin:/venv/bin

RUN apt-get -qq update \
  && apt-get install -y --no-install-recommends \
    apt-transport-https \
    build-essential \
    curl \
    dirmngr \
    gnupg \
    git \
    python3-packaging \
    python3-venv \
    ruby-full \
    jq \
    unzip \
    openjdk-11-jdk \
    maven \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY Gemfile Gemfile.lock ./

RUN python3 -m venv /venv && pip install twine==4.0.2 pkginfo==1.10.0 --no-cache

RUN curl -fsSL https://packages.microsoft.com/config/debian/10/packages-microsoft-prod.deb -o /tmp/packages-microsoft-prod.deb \
  && dpkg -i /tmp/packages-microsoft-prod.deb \
  && rm /tmp/packages-microsoft-prod.deb \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | apt-key add - \
  && echo 'deb [arch=amd64] https://download.docker.com/linux/debian buster stable' >> /etc/apt/sources.list \
  && curl -fsSL https://packages.erlang-solutions.com/debian/erlang_solutions.asc | apt-key add - \
  && echo 'deb https://packages.erlang-solutions.com/debian bullseye contrib' >> /etc/apt/sources.list \
  && apt-get update -qq \
  && apt-get install -y --no-install-recommends \
    dotnet-sdk-8.0 \
    dotnet-sdk-7.0 \
    docker-ce-cli \
    erlang \
    elixir \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s --  --profile minimal -y \
  && cargo --version \
  && cargo install cargo-hack \
  && gem install -g --no-document \
  # Install https://github.com/getsentry/symbol-collector
  && symbol_collector_url=$(curl -s https://api.github.com/repos/getsentry/symbol-collector/releases/tags/1.12.0 | \
  jq -r '.assets[].browser_download_url | select(endswith("symbolcollector-console-linux-x64.zip"))') \
  && curl -sL $symbol_collector_url -o "/tmp/sym-collector.zip" \
  && unzip /tmp/sym-collector.zip -d /usr/local/bin/ \
  && rm /tmp/sym-collector.zip \
  && chmod +x /usr/local/bin/SymbolCollector.Console

# https://docs.flutter.dev/get-started/install/linux#install-flutter-manually
RUN curl -fsSL https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.10.0-stable.tar.xz -o /opt/flutter.tar.xz \
  && tar xf /opt/flutter.tar.xz -C /opt \
  && rm /opt/flutter.tar.xz

# https://learn.microsoft.com/en-us/powershell/scripting/install/install-debian
RUN curl -fsSL https://github.com/PowerShell/PowerShell/releases/download/v7.4.1/powershell_7.4.1-1.deb_amd64.deb -o /opt/powershell.deb \
  && dpkg -i /opt/powershell.deb \
  && apt-get install -f \
  && apt-get clean \
  && rm /opt/powershell.deb

# craft does `git` things against mounted directories as root
RUN git config --global --add safe.directory '*'

COPY --from=builder /usr/local/lib/dist/craft /usr/local/bin/craft
ARG SOURCE_COMMIT
ENV CRAFT_BUILD_SHA=$SOURCE_COMMIT

ENTRYPOINT ["craft"]
