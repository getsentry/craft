FROM node:14-bullseye

ENV DEBIAN_FRONTEND=noninteractive \
  DOTNET_CLI_TELEMETRY_OPTOUT=1 \
  # See https://github.com/CocoaPods/CocoaPods/issues/6795
  COCOAPODS_ALLOW_ROOT=1 \
  CARGO_HOME=/root/.cargo \
  RUSTUP_HOME=/root/.rustup \
  PATH=${PATH}:/root/.cargo/bin:/opt/flutter/bin

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
    openjdk-11-jdk \
    maven \
    elixir \
  && curl -fsSL https://packages.microsoft.com/config/debian/10/packages-microsoft-prod.deb -o /tmp/packages-microsoft-prod.deb \
  && dpkg -i /tmp/packages-microsoft-prod.deb \
  && rm /tmp/packages-microsoft-prod.deb \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | apt-key add - \
  && echo 'deb [arch=amd64] https://download.docker.com/linux/debian buster stable' >> /etc/apt/sources.list \
  && apt-get update -qq \
  && apt-get install -y --no-install-recommends \
    dotnet-sdk-7.0 \
    docker-ce-cli \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s --  --profile minimal -y \
  && cargo --version \
  && cargo install cargo-hack \
  && gem install cocoapods --no-document \
  # Install https://github.com/getsentry/symbol-collector
  && symbol_collector_url=$(curl -s https://api.github.com/repos/getsentry/symbol-collector/releases/tags/1.8.0 | \
  jq -r '.assets[].browser_download_url | select(endswith("symbolcollector-console-linux-x64.zip"))') \
  && curl -sL $symbol_collector_url -o "/tmp/sym-collector.zip" \
  && unzip /tmp/sym-collector.zip -d /usr/local/bin/ \
  && rm /tmp/sym-collector.zip \
  && chmod +x /usr/local/bin/SymbolCollector.Console

# https://docs.flutter.dev/get-started/install/linux#install-flutter-manually
RUN curl -fsSL https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.10.0-stable.tar.xz -o /opt/flutter_linux_3.10.0-stable.tar.xz \
  && tar xf /opt/flutter_linux_3.10.0-stable.tar.xz -C /opt \
  && rm /opt/flutter_linux_3.10.0-stable.tar.xz

# craft does `git` things against mounted directories as root
RUN git config --global --add safe.directory '*'

COPY dist/craft /usr/local/bin/craft
RUN chmod +x /usr/local/bin/craft
ARG SOURCE_COMMIT
ENV CRAFT_BUILD_SHA=$SOURCE_COMMIT

ENTRYPOINT ["craft"]
