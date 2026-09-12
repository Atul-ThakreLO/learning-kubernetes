# ☸ TaskFlow — Kubernetes Practice Guide

> **What you built:** A full-stack Task Manager app (React Frontend → Node.js Backend → PostgreSQL + Redis) designed as a hands-on Kubernetes training ground.

---

## 📁 Project Structure

```
kubernetes/
├── backend/
│   ├── server.js          ← Express API (PostgreSQL + Redis)
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── index.html         ← Single-page Task Manager UI
│   ├── style.css
│   ├── app.js
│   ├── nginx.conf         ← Proxies /api/* → backend-service
│   └── Dockerfile
├── k8s/
│   ├── 00-namespace.yaml       ← Namespace: taskflow
│   ├── 01-configmap.yaml       ← Non-secret config (DB host, Redis host)
│   ├── 02-secret.yaml          ← Credentials (base64-encoded)
│   ├── 03-postgres-pv.yaml     ← PersistentVolume + PVC
│   ├── 04-postgres.yaml        ← DB Deployment + ClusterIP Service
│   ├── 05-redis.yaml           ← Cache Deployment + ClusterIP Service
│   ├── 06-backend.yaml         ← API Deployment (3 replicas) + ClusterIP Service
│   ├── 07-frontend.yaml        ← UI Deployment (2 replicas) + NodePort Service
│   ├── 08-standalone-pods.yaml ← Raw Pod examples for learning
│   └── 09-replicaset.yaml      ← Standalone ReplicaSet for experiments
├── docker-compose.yaml    ← Local testing without K8s
└── Makefile               ← Convenience commands
```

---

## 🗺️ Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │               taskflow namespace             │
                    │                                              │
  Browser  ──────▶  │  [NodePort :30080]                          │
                    │       │                                      │
                    │  ┌────▼────────────────┐                    │
                    │  │  frontend-service    │  ClusterIP:80      │
                    │  │  (nginx × 2 pods)   │                    │
                    │  └────────────┬────────┘                    │
                    │               │ /api/* proxy                 │
                    │  ┌────────────▼────────┐                    │
                    │  │  backend-service     │  ClusterIP:3001    │
                    │  │  (node × 3 pods)    │                    │
                    │  └──────┬──────────────┘                    │
                    │         │                                    │
                    │   ┌─────▼──────┐   ┌──────────────┐        │
                    │   │ postgres-  │   │ redis-       │        │
                    │   │ service    │   │ service      │        │
                    │   │ :5432      │   │ :6379        │        │
                    │   │ (1 pod)    │   │ (1 pod)      │        │
                    │   └─────┬──────┘   └──────────────┘        │
                    │         │                                    │
                    │   ┌─────▼──────┐                            │
                    │   │  postgres  │                            │
                    │   │    PVC     │                            │
                    │   └────────────┘                            │
                    └─────────────────────────────────────────────┘
```

**Service Types Summary:**
| Service           | Type        | Port  | Accessible From             |
|-------------------|-------------|-------|-----------------------------|
| `postgres-service`| ClusterIP   | 5432  | Inside cluster only         |
| `redis-service`   | ClusterIP   | 6379  | Inside cluster only         |
| `backend-service` | ClusterIP   | 3001  | Inside cluster only         |
| `frontend-service`| **NodePort**| 30080 | Your browser (node IP)      |

---

## ⚡ Quick Start

### Option A: Local Testing with Docker Compose

```bash
# Build images and start everything
make docker-up

# App is at http://localhost:8080
# API is at http://localhost:3001

# Stop and clean up
make docker-down
```

### Option B: Deploy to Kubernetes (minikube)

```bash
# 1. Start minikube
minikube start

# 2. Build Docker images
make build

# 3. Load images into minikube's Docker daemon
make minikube-load

# 4. Create host path for postgres data
minikube ssh -- sudo mkdir -p /data/postgres

# 5. Deploy everything
make deploy

# 6. Check status
make status

# 7. Open the app
minikube service frontend-service -n taskflow
```

### Option B: Deploy to Kubernetes (kind)

```bash
# 1. Create a cluster
kind create cluster --name taskflow

# 2. Build and load images
make kind-load

# 3. Create host path (inside kind node)
docker exec -it taskflow-control-plane mkdir -p /data/postgres

# 4. Deploy
make deploy

# 5. Access via port-forward
make port-forward
# Open http://localhost:8080
```

---

## 🎓 Learning Modules

### Module 1 — Pods

**What is a Pod?**  
The smallest deployable unit in K8s. Contains one or more containers sharing network and storage.

```bash
# View all pods in namespace
kubectl get pods -n taskflow

# Detailed pod info (node, IP, status, events)
kubectl describe pod <pod-name> -n taskflow

# Stream logs
kubectl logs -f <pod-name> -n taskflow

# Shell into a running pod
kubectl exec -it <pod-name> -n taskflow -- sh

# Get pod YAML definition
kubectl get pod <pod-name> -n taskflow -o yaml
```

**Experiment: Kill a pod**
```bash
# Get a backend pod name
kubectl get pods -n taskflow -l app=backend

# Delete it — Deployment will recreate immediately
kubectl delete pod <backend-pod-name> -n taskflow

# Watch it respawn
kubectl get pods -n taskflow -w
```

**Standalone Pod vs Deployment:**
```bash
# Apply the standalone debug pod (08-standalone-pods.yaml already applied)
kubectl get pod debug-pod -n taskflow

# Delete it manually
kubectl delete pod debug-pod -n taskflow

# It's GONE — no controller to recreate it
# Compare: deleting a Deployment pod → recreated automatically
```

---

### Module 2 — ReplicaSets

**What is a ReplicaSet?**  
Ensures N identical pod replicas are always running. If one dies, RS creates another.

```bash
# Deploy the standalone ReplicaSet
kubectl apply -f k8s/09-replicaset.yaml

# View ReplicaSet
kubectl get replicaset -n taskflow
kubectl describe replicaset backend-rs -n taskflow

# View pods managed by it
kubectl get pods -n taskflow -l app=backend-rs
```

**Experiment 1: Self-healing**
```bash
# Note the pod names
kubectl get pods -n taskflow -l app=backend-rs

# Kill one
kubectl delete pod <pod-name> -n taskflow

# RS immediately creates a replacement — watch it
kubectl get pods -n taskflow -l app=backend-rs -w
```

**Experiment 2: Manual scaling**
```bash
kubectl scale replicaset backend-rs --replicas=5 -n taskflow
kubectl get pods -n taskflow -l app=backend-rs

kubectl scale replicaset backend-rs --replicas=1 -n taskflow
```

**Experiment 3: Label manipulation (pod orphaning)**
```bash
# RS "owns" pods via label selector matching
# Remove the label from one pod — RS will create a new one, orphan keeps running

POD=$(kubectl get pods -n taskflow -l app=backend-rs -o name | head -1)
kubectl label pod ${POD##*/} app=orphaned -n taskflow --overwrite

# RS sees only 1 pod (missing one) → creates a new one
kubectl get pods -n taskflow -l app=backend-rs
kubectl get pods -n taskflow -l app=orphaned
```

---

### Module 3 — Deployments

**What is a Deployment?**  
Manages ReplicaSets, enabling declarative updates, rollouts, and rollbacks.

```bash
# View deployments
kubectl get deployments -n taskflow

# Detailed deployment info
kubectl describe deployment backend-deployment -n taskflow

# View the ReplicaSet Deployment created
kubectl get replicaset -n taskflow
```

**Experiment 1: Scale**
```bash
# Scale backend to 5 replicas
kubectl scale deployment backend-deployment --replicas=5 -n taskflow
kubectl get pods -n taskflow -l app=backend

# Scale down
kubectl scale deployment backend-deployment --replicas=2 -n taskflow
```

**Experiment 2: Rolling Update (zero downtime)**
```bash
# Tag a new image version (edit server.js, rebuild)
docker build -t taskflow-backend:v2 ./backend
minikube image load taskflow-backend:v2

# Update the deployment image
kubectl set image deployment/backend-deployment backend=taskflow-backend:v2 -n taskflow \
  --record

# Watch the rolling update
kubectl rollout status deployment/backend-deployment -n taskflow
kubectl get pods -n taskflow -w   # old pods terminate, new ones start
```

**Experiment 3: Rollback**
```bash
# View rollout history
kubectl rollout history deployment/backend-deployment -n taskflow

# Rollback to previous version
kubectl rollout undo deployment/backend-deployment -n taskflow

# Rollback to specific revision
kubectl rollout undo deployment/backend-deployment --to-revision=1 -n taskflow
```

**Experiment 4: Pause & Resume**
```bash
# Pause a rollout (useful for canary-style manual control)
kubectl rollout pause deployment/backend-deployment -n taskflow

# Make changes, then resume
kubectl rollout resume deployment/backend-deployment -n taskflow
```

---

### Module 4 — Services

**What is a Service?**  
A stable network endpoint (IP + DNS name) that load-balances traffic to matching pods. Pods are ephemeral; Services are persistent.

```bash
# View all services
kubectl get svc -n taskflow

# See endpoints (which pod IPs are behind each service)
kubectl get endpoints -n taskflow

# Describe a service
kubectl describe svc backend-service -n taskflow
```

**Service Type Experiments:**

**ClusterIP — internal only**
```bash
# Shell into the nettest pod
kubectl exec -it nettest-pod -n taskflow -- sh

# Inside the pod, call the backend by Service DNS name:
wget -qO- http://backend-service:3001/health
wget -qO- http://backend-service:3001/api/tasks

# Ping postgres (DNS resolves to ClusterIP)
ping postgres-service
nslookup redis-service
```

**NodePort — exposed externally**
```bash
# Get the node IP
kubectl get nodes -o wide

# Access the frontend
curl http://<NODE-IP>:30080

# With minikube, get URL automatically:
minikube service frontend-service -n taskflow --url
```

**Port Forward (temporary access without NodePort)**
```bash
# Forward backend port to local machine
kubectl port-forward svc/backend-service 3001:3001 -n taskflow

# In another terminal — now accessible locally
curl http://localhost:3001/health

# Forward frontend
kubectl port-forward svc/frontend-service 8080:80 -n taskflow
```

---

### Module 5 — ConfigMaps & Secrets

**ConfigMap — non-sensitive config**
```bash
# View ConfigMap
kubectl get configmap app-config -n taskflow
kubectl describe configmap app-config -n taskflow

# Get raw YAML
kubectl get configmap app-config -n taskflow -o yaml

# Edit live (triggers pod env refresh on next pod start)
kubectl edit configmap app-config -n taskflow
```

**Secret — sensitive data**
```bash
# Secrets are base64-encoded (not encrypted by default!)
kubectl get secret db-secret -n taskflow -o yaml

# Decode a value
kubectl get secret db-secret -n taskflow -o jsonpath='{.data.DB_PASSWORD}' | base64 -d

# Create a secret from CLI (alternative to YAML)
kubectl create secret generic my-secret \
  --from-literal=API_KEY=supersecret123 \
  -n taskflow
```

---

### Module 6 — Persistent Volumes

**PersistentVolume (PV) — cluster resource (admin creates)**
```bash
kubectl get pv
kubectl describe pv postgres-pv
```

**PersistentVolumeClaim (PVC) — namespace resource (developer requests)**
```bash
kubectl get pvc -n taskflow
kubectl describe pvc postgres-pvc -n taskflow
```

**Experiment: Data Persistence**
```bash
# Connect to postgres and create data
kubectl exec -it $(kubectl get pod -l app=postgres -n taskflow -o jsonpath='{.items[0].metadata.name}') \
  -n taskflow -- psql -U postgres -d taskdb -c "INSERT INTO tasks(title, status, priority) VALUES ('My test task', 'todo', 'high');"

# Delete the postgres pod
kubectl delete pod -l app=postgres -n taskflow

# Wait for it to restart
kubectl get pods -n taskflow -l app=postgres -w

# Reconnect and verify data persists (it's on the PVC)
kubectl exec -it $(kubectl get pod -l app=postgres -n taskflow -o jsonpath='{.items[0].metadata.name}') \
  -n taskflow -- psql -U postgres -d taskdb -c "SELECT * FROM tasks;"
```

---

### Module 7 — Probes (Liveness, Readiness, Startup)

**Readiness Probe:** "Is the container ready to receive traffic?"  
**Liveness Probe:** "Is the container still alive (should it be restarted)?"  
**Startup Probe:** "Is the container still starting up? (delays liveness check)"

```bash
# View probe configuration
kubectl describe pod <backend-pod> -n taskflow | grep -A 10 "Liveness\|Readiness\|Startup"

# Check pod events for probe failures
kubectl describe pod <pod-name> -n taskflow | grep -A 5 Events
```

**Experiment: Simulate readiness failure**
```bash
# Temporarily break the backend (stop DB connection) and watch pod removed from endpoints
kubectl get endpoints backend-service -n taskflow -w

# In another terminal, scale postgres to 0
kubectl scale deployment postgres-deployment --replicas=0 -n taskflow

# Watch backend pods fail readiness → removed from service endpoints
kubectl get endpoints backend-service -n taskflow

# Restore
kubectl scale deployment postgres-deployment --replicas=1 -n taskflow
```

---

## 🔧 Useful kubectl Cheatsheet

```bash
# ── Namespace shortcuts ──────────────────────────────────────────────────────
kubectl config set-context --current --namespace=taskflow  # set default namespace
kubectl get all -n taskflow                                # see everything

# ── Describe (best for debugging) ───────────────────────────────────────────
kubectl describe pod <name> -n taskflow
kubectl describe deployment <name> -n taskflow
kubectl describe svc <name> -n taskflow

# ── Logs ────────────────────────────────────────────────────────────────────
kubectl logs <pod> -n taskflow                   # last logs
kubectl logs <pod> -n taskflow --previous        # crashed container logs
kubectl logs -f -l app=backend -n taskflow       # stream from all backend pods

# ── Exec ────────────────────────────────────────────────────────────────────
kubectl exec -it <pod> -n taskflow -- sh         # alpine/busybox
kubectl exec -it <pod> -n taskflow -- bash       # debian/ubuntu

# ── Apply / Delete ───────────────────────────────────────────────────────────
kubectl apply -f k8s/               # apply all files in directory
kubectl delete -f k8s/06-backend.yaml

# ── Scale ───────────────────────────────────────────────────────────────────
kubectl scale deployment backend-deployment --replicas=3 -n taskflow

# ── Rollout ─────────────────────────────────────────────────────────────────
kubectl rollout status deployment/backend-deployment -n taskflow
kubectl rollout history deployment/backend-deployment -n taskflow
kubectl rollout undo deployment/backend-deployment -n taskflow

# ── Resource usage ──────────────────────────────────────────────────────────
kubectl top pods -n taskflow        # requires metrics-server
kubectl top nodes

# ── Labels ──────────────────────────────────────────────────────────────────
kubectl get pods -n taskflow --show-labels
kubectl get pods -n taskflow -l app=backend
kubectl label pod <name> env=staging -n taskflow
```

---

## 🐛 Troubleshooting

| Symptom | Command | Likely Cause |
|---------|---------|--------------|
| Pod in `Pending` | `kubectl describe pod <name>` | No node resources / PVC not bound |
| Pod in `CrashLoopBackOff` | `kubectl logs <pod> --previous` | App crash / wrong env vars |
| Pod in `ImagePullBackOff` | `kubectl describe pod <name>` | Image not found / not loaded into cluster |
| Service not routing | `kubectl get endpoints <svc>` | No pods match selector labels |
| PVC stuck in `Pending` | `kubectl describe pvc <name>` | No matching PV / wrong storageClass |
| App can't reach DB | `kubectl exec -it nettest-pod -- ping postgres-service` | Service name mismatch |

---

## 🚀 Next Steps to Practice

1. **HorizontalPodAutoscaler (HPA)** — auto-scale backend based on CPU
   ```bash
   kubectl autoscale deployment backend-deployment --cpu-percent=50 --min=2 --max=10 -n taskflow
   kubectl get hpa -n taskflow
   ```

2. **Ingress** — replace NodePort with a proper Ingress controller (nginx-ingress)

3. **StatefulSet** — migrate postgres from Deployment → StatefulSet (proper for databases)

4. **ResourceQuota** — limit total resources in the namespace
   ```yaml
   apiVersion: v1
   kind: ResourceQuota
   metadata:
     name: taskflow-quota
     namespace: taskflow
   spec:
     hard:
       pods: "20"
       requests.cpu: "2"
       requests.memory: "2Gi"
   ```

5. **NetworkPolicy** — allow only frontend → backend → DB traffic

6. **Helm** — package all manifests into a Helm chart

---

> **Tip:** Use `kubectl explain <resource>` to read built-in docs for any K8s resource:
> ```bash
> kubectl explain deployment.spec.strategy
> kubectl explain pod.spec.containers.livenessProbe
> ```
