FROM node:12-buster-slim as builder

COPY package.json yarn.lock ./
RUN export YARN_CACHE_FOLDER="$(mktemp -d)" \
  export NODE_ENV="development" \
  && yarn install --frozen-lockfile --quiet \
  && rm -r "$YARN_CACHE_FOLDER"

CMD ["yarn", "build"]
