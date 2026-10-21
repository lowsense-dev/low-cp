# low-cp build. The panel is built into internal/panel/dist and embedded in the binary.
.PHONY: web build test

web:
	cd web && pnpm install --frozen-lockfile && pnpm build

build: web
	go build -o low-cp ./cmd/server

test:
	go test ./sdk/cliproxy/auth/ ./internal/api/... ./internal/panel/ ./internal/config/
	cd web && pnpm typecheck
