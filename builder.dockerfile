FROM node:14-buster-slim as builder

WORKDIR /usr/local/lib

COPY package.json yarn.lock ./
RUN export YARN_CACHE_FOLDER="$(mktemp -d)" \
  && yarn install --frozen-lockfile --quiet \
  && rm -r "$YARN_CACHE_FOLDER"

ENV NODE_ENV=production \
  NODE_PATH=/usr/local/lib/node_modules \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/lib/node_modules/.bin"

CMD ["yarn", "--modules-folder", "/usr/local/lib/node_modules", "build"]
