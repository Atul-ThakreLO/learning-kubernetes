NAMESPACE    := taskflow
BACKEND_IMG  := taskflow-backend:latest
FRONTEND_IMG := taskflow-frontend:latest
K8S_DIR      := ./k8s

.PHONY: help build build-backend build-frontend \
        deploy deploy-core deploy-app \
        delete status watch logs \
        minikube-load kind-load \
        port-forward open \
        docker-up docker-down

# ── Help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  TaskFlow — Kubernetes Practice App"
	@echo "  ───────────────────────────────────"
	@echo "  make build          Build both Docker images"
	@echo "  make minikube-load  Load images into minikube"
	@echo "  make kind-load      Load images into kind cluster"
	@echo "  make deploy         Deploy everything to K8s"
	@echo "  make delete         Remove all K8s resources"
	@echo "  make status         Show all resources in namespace"
	@echo "  make watch          Watch pods live"
	@echo "  make logs SVC=backend   Stream logs for a service"
	@echo "  make port-forward   Forward frontend to localhost:8080"
	@echo "  make docker-up      Run locally with docker-compose"
	@echo "  make docker-down    Stop docker-compose stack"
	@echo ""

# ── Build Images ──────────────────────────────────────────────────────────────
build: build-backend build-frontend
	@echo "✅ Both images built"

build-backend:
	docker build -t $(BACKEND_IMG) ./backend
	@echo "✅ Backend image built"

build-frontend:
	docker build -t $(FRONTEND_IMG) ./frontend
	@echo "✅ Frontend image built"

# ── Load into Local Cluster ───────────────────────────────────────────────────
minikube-load: build
	minikube image load $(BACKEND_IMG)
	minikube image load $(FRONTEND_IMG)
	@echo "✅ Images loaded into minikube"

kind-load: build
	kind load docker-image $(BACKEND_IMG)
	kind load docker-image $(FRONTEND_IMG)
	@echo "✅ Images loaded into kind"

# ── Deploy to Kubernetes ──────────────────────────────────────────────────────
deploy:
	@echo "🚀 Deploying TaskFlow to namespace: $(NAMESPACE)"
	kubectl apply -f $(K8S_DIR)/00-namespace.yaml
	kubectl apply -f $(K8S_DIR)/01-configmap.yaml
	kubectl apply -f $(K8S_DIR)/02-secret.yaml
	kubectl apply -f $(K8S_DIR)/03-postgres-pv.yaml
	kubectl apply -f $(K8S_DIR)/04-postgres.yaml
	kubectl apply -f $(K8S_DIR)/05-redis.yaml
	kubectl apply -f $(K8S_DIR)/06-backend.yaml
	kubectl apply -f $(K8S_DIR)/07-frontend.yaml
	@echo "✅ All manifests applied. Run 'make watch' to monitor."

# ── Delete All Resources ──────────────────────────────────────────────────────
delete:
	kubectl delete namespace $(NAMESPACE) --ignore-not-found
	kubectl delete pv postgres-pv --ignore-not-found
	@echo "🗑️  All TaskFlow resources deleted"

# ── Status & Monitoring ───────────────────────────────────────────────────────
status:
	@echo "\n──── Pods ──────────────────────────────────────────────────────"
	kubectl get pods -n $(NAMESPACE) -o wide
	@echo "\n──── Deployments ───────────────────────────────────────────────"
	kubectl get deployments -n $(NAMESPACE)
	@echo "\n──── ReplicaSets ───────────────────────────────────────────────"
	kubectl get replicasets -n $(NAMESPACE)
	@echo "\n──── Services ──────────────────────────────────────────────────"
	kubectl get svc -n $(NAMESPACE)
	@echo "\n──── PVCs ──────────────────────────────────────────────────────"
	kubectl get pvc -n $(NAMESPACE)
	@echo "\n──── ConfigMaps ────────────────────────────────────────────────"
	kubectl get configmaps -n $(NAMESPACE)

watch:
	kubectl get pods -n $(NAMESPACE) -w

logs:
	@[ "$(SVC)" ] || (echo "Usage: make logs SVC=backend|frontend|postgres|redis" && exit 1)
	kubectl logs -f -l app=$(SVC) -n $(NAMESPACE) --all-containers

# ── Access ────────────────────────────────────────────────────────────────────
port-forward:
	@echo "Forwarding frontend to http://localhost:8080"
	kubectl port-forward svc/frontend-service 8080:80 -n $(NAMESPACE)

# ── Docker Compose ────────────────────────────────────────────────────────────
docker-up: build
	docker-compose up -d
	@echo "✅ Stack running at http://localhost:8080"

docker-down:
	docker-compose down -v
	@echo "🗑️  Docker stack stopped and volumes removed"
