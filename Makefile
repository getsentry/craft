test:
	yarn test
.PHONY: test

lint:
	yarn lint
.PHONY: lint

check: test lint
.PHONY: check
