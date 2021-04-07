FROM node:12-buster

ENV DEBIAN_FRONTEND=noninteractive \
  DOTNET_CLI_TELEMETRY_OPTOUT=1 \
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
  && curl -fsSL https://packages.microsoft.com/config/debian/10/packages-microsoft-prod.deb -o /tmp/packages-microsoft-prod.deb \
  && dpkg -i /tmp/packages-microsoft-prod.deb \
  && rm /tmp/packages-microsoft-prod.deb \
  && echo 'deb [arch=amd64] https://download.docker.com/linux/debian buster stable' >> /etc/apt/sources.list \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | apt-key add - \
  && apt-get update -qq \
  && apt-get install -y --no-install-recommends \
    dotnet-sdk-3.1 \
    docker-ce-cli \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s --  --profile minimal -y \
  && cargo --version \
  && cargo install cargo-hack \
  # Stick with 3.1.x as 3.2.x doesn't install on Debian Buster for some reason
  && gem update --no-document --system 3.1.5 \
  && gem install cocoapods

COPY dist/craft /usr/local/bin/craft
RUN chmod +x /usr/local/bin/craft

ENTRYPOINT ["craft"]
