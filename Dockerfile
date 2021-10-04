FROM node:14-bullseye

ENV DEBIAN_FRONTEND=noninteractive \
  DOTNET_CLI_TELEMETRY_OPTOUT=1 \
  # See https://github.com/CocoaPods/CocoaPods/issues/6795
  COCOAPODS_ALLOW_ROOT=1 \
  CARGO_HOME=/root/.cargo \
  RUSTUP_HOME=/root/.rustup \
  PATH=${PATH}:/root/.cargo/bin

RUN apt-get -qq update \
  && apt-get install -y --no-install-recommends \
    apt-transport-https \
    build-essential \
    curl \
    dirmngr \
    gnupg \
    git \
    ruby-full \
    twine \
    jq \
    unzip \
  && curl -fsSL https://packages.microsoft.com/config/debian/10/packages-microsoft-prod.deb -o /tmp/packages-microsoft-prod.deb \
  && dpkg -i /tmp/packages-microsoft-prod.deb \
  && rm /tmp/packages-microsoft-prod.deb \
  && echo 'deb [arch=amd64] https://download.docker.com/linux/debian buster stable' >> /etc/apt/sources.list \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | apt-key add - \
  && apt-get update -qq \
  && apt-get install -y --no-install-recommends \
    dotnet-sdk-5.0 \
    docker-ce-cli \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s --  --profile minimal -y \
  && cargo --version \
  && cargo install cargo-hack \
  && gem install cocoapods \
  # Install https://github.com/getsentry/symbol-collector
  && symbol_collector_url=$(curl -s https://api.github.com/repos/getsentry/symbol-collector/releases/tags/1.4.0 | \
  jq -r '.assets[].browser_download_url | select(endswith("symbolcollector-console-linux-x64.zip"))') \
  && curl -sL $symbol_collector_url -o "/tmp/sym-collector.zip" \
  && unzip /tmp/sym-collector.zip -d /usr/local/bin/ \
  && chmod +x /usr/local/bin/SymbolCollector.Console

COPY dist/craft /usr/local/bin/craft
RUN chmod +x /usr/local/bin/craft
ARG SOURCE_COMMIT
ENV CRAFT_BUILD_SHA=$SOURCE_COMMIT

ENTRYPOINT ["craft"]
