test:
	yarn test
.PHONY: test

build:
	yarn build
.PHONY: build

lint: build
	yarn lint
.PHONY: lint

check: test lint
.PHONY: check
