.PHONY: help build rebuild clean dev shell test test-v lint fmt dns ports certs db-list db-latest web

IMAGE := stackshield
MOUNT := -v $(CURDIR)/apps:/app/apps -v $(CURDIR)/lib:/app/lib
DATA_MOUNT := -v $(HOME)/.stackshield:/data

help: ## Show available targets
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  %-12s %s\n", $$1, $$2}'
	@echo ""
	@echo "Examples:"
	@echo "  make build"
	@echo "  make dns DOMAIN=example.com"
	@echo "  make ports TARGETS=10.0.0.1 PORTS=80,443   (specific ports)"
	@echo "  make ports TARGETS=10.0.0.1 PORTS=all       (all 65535 ports)"
	@echo "  make dev"

# -- Build & Clean --

build: ## Build the Docker image
	docker build -t $(IMAGE) .

rebuild: ## Rebuild the Docker image (no cache)
	docker build --no-cache -t $(IMAGE) .

clean: ## Remove the Docker image
	docker rmi $(IMAGE)

# -- Development --

dev: ## Interactive shell with local code mounted
	docker run --rm -it $(MOUNT) $(DATA_MOUNT) $(IMAGE) /bin/bash

shell: ## Interactive shell inside a fresh container
	docker run --rm -it $(DATA_MOUNT) $(IMAGE) /bin/bash

# -- Testing --

test: ## Run the test suite
	docker run --rm $(IMAGE) python -m pytest

test-v: ## Run the test suite (verbose)
	docker run --rm $(IMAGE) python -m pytest -v

# -- Linting & Formatting --

lint: ## Run ruff linter on local code
	docker run --rm $(MOUNT) $(IMAGE) ruff check apps/ lib/

fmt: ## Auto-format code with ruff
	docker run --rm $(MOUNT) $(IMAGE) ruff format apps/ lib/

# -- Tool Shortcuts --

dns: ## Run DNS discovery (DOMAIN=example.com)
ifndef DOMAIN
	$(error DOMAIN is required. Usage: make dns DOMAIN=example.com)
endif
	./ssx.sh dns -d $(DOMAIN)

RESOLVE_PORTS = $(if $(filter all ALL All,$(PORTS)),1-65535,$(PORTS))

ports: ## Run port scan (TARGETS=10.0.0.1 [PORTS=all|80,443])
ifndef TARGETS
	$(error TARGETS is required. Usage: make ports TARGETS=10.0.0.1)
endif
	./ssx.sh ports -t $(TARGETS) $(if $(RESOLVE_PORTS),-p $(RESOLVE_PORTS)) $(if $(SCAN_TYPE),--scan-type $(SCAN_TYPE))

certs: ## Run certificate discovery (DOMAIN=example.com [MODE=ct|tls|all] [PORTS=443,8443])
ifndef DOMAIN
	$(error DOMAIN is required. Usage: make certs DOMAIN=example.com)
endif
	./ssx.sh certs -d $(DOMAIN) $(if $(MODE),--mode $(MODE)) $(if $(PORTS),-p $(PORTS))

web: ## Launch the web UI on http://localhost:8080
	./ssx.sh web


db-list: ## List stored scans ([TOOL=dns] [DOMAIN=example.com])
	./ssx.sh db list $(if $(TOOL),--tool $(TOOL)) $(if $(DOMAIN),--domain $(DOMAIN))

db-latest: ## Show latest scan result (TOOL=dns [DOMAIN=example.com])
ifndef TOOL
	$(error TOOL is required. Usage: make db-latest TOOL=dns)
endif
	./ssx.sh db latest --tool $(TOOL) $(if $(DOMAIN),--domain $(DOMAIN))
