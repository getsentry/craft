FROM node:12-buster as builder

WORKDIR /workspace
COPY package.json yarn.lock ./
RUN export YARN_CACHE_FOLDER="$(mktemp -d)" \
  && yarn install --frozen-lockfile --quiet \
  && rm -r "$YARN_CACHE_FOLDER"

COPY . .
RUN yarn build

FROM node:12-buster

ENV DEBIAN_FRONTEND=noninteractive \
  DOTNET_CLI_TELEMETRY_OPTOUT=1 \
  PATH=${PATH}:/root/.cargo/bin

RUN apt-get -qq update \
  && apt-get install -y --no-install-recommends \
  apt-transport-https \
  cargo \
  curl \
  dirmngr \
  gnupg \
  git \
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
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY --from=builder /workspace/package.json /workspace/yarn.lock /craft/
RUN export YARN_CACHE_FOLDER="$(mktemp -d)" \
  && cd /craft \
  && yarn install --frozen-lockfile --production --quiet \
  && rm -r "$YARN_CACHE_FOLDER"

COPY --from=builder /workspace/dist /craft/dist/

ENTRYPOINT ["node", "/craft/dist"]
