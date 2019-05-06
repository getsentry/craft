test:
	yarn test
.PHONY: test

check: test
	yarn lint
.PHONY: check
