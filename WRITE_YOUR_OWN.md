# ✍️ Write Your Own Kubernetes Manifests — TaskFlow

> The pre-built YAML files in `k8s/` are your **answer key**.  
> This guide teaches you to write each one **from scratch**, field by field.  
> Work in a new folder `my-k8s/` and fill in the blanks (`___`).

---

## Before You Start — YAML Fundamentals

Every Kubernetes manifest has the same 4 top-level fields:

```yaml
apiVersion: <group/version>   # Which K8s API to use
kind: <ResourceType>          # What you're creating
metadata:                     # Name, namespace, labels
  ...
spec:                         # The desired state
  ...
```

> If unsure about any field: `kubectl explain <Kind>.<field>`  
> Example: `kubectl explain deployment.spec.strategy`

---

## Quick Reference — apiVersion cheatsheet

| Kind | apiVersion |
|------|-----------|
| Namespace, Pod, Service, ConfigMap, Secret, PV, PVC | `v1` |
| Deployment, ReplicaSet | `apps/v1` |
| HorizontalPodAutoscaler | `autoscaling/v2` |
| Ingress | `networking.k8s.io/v1` |
| CronJob | `batch/v1` |

```bash
# Always verify with:
kubectl api-resources | grep Deployment
```

---

## Step 1 — Namespace

**What:** A virtual cluster inside your cluster. Groups and isolates resources.

| Field | Meaning |
|-------|---------|
| `apiVersion: v1` | Core API — no prefix |
| `kind: Namespace` | Resource type |
| `metadata.name` | Used in every `-n <name>` flag |

**Write `my-k8s/00-namespace.yaml`:**

```yaml
apiVersion: ___
kind: ___
metadata:
  name: ___        # e.g. taskflow
  labels:
    app: ___
```

**Validate:**
```bash
kubectl apply -f my-k8s/00-namespace.yaml
kubectl get namespace taskflow
```

---

## Step 2 — ConfigMap

**What:** Non-sensitive key-value config that pods load as environment variables.

| Field | Meaning |
|-------|---------|
| `metadata.namespace` | Must match your namespace |
| `data:` | Plain string key-value pairs |

**Write `my-k8s/01-configmap.yaml`:**

```yaml
apiVersion: ___
kind: ___
metadata:
  name: app-config
  namespace: ___
data:
  DB_HOST: "___"      # will be your postgres Service name
  DB_PORT: "5432"
  DB_NAME: "taskdb"
  REDIS_HOST: "___"   # will be your redis Service name
  REDIS_PORT: "6379"
  PORT: "3001"
```

> **Tip:** `DB_HOST` must exactly match `metadata.name` of the postgres Service you create in Step 5.

**Validate:**
```bash
kubectl apply -f my-k8s/01-configmap.yaml
kubectl describe configmap app-config -n taskflow
```

---

## Step 3 — Secret

**What:** Like ConfigMap, but for sensitive data. Values must be **base64-encoded**.

```bash
# Encode values first:
echo -n "postgres"    | base64    # cG9zdGdyZXM=
echo -n "taskflow123" | base64    # dGFza2Zsb3cxMjM=
```

| Field | Meaning |
|-------|---------|
| `type: Opaque` | Generic secret (most common) |
| `data:` | Base64-encoded values |

**Write `my-k8s/02-secret.yaml`:**

```yaml
apiVersion: ___
kind: ___
metadata:
  name: db-secret
  namespace: ___
type: Opaque
data:
  DB_USER:     ___    # base64("postgres")
  DB_PASSWORD: ___    # base64("taskflow123")
```

**Validate:**
```bash
kubectl apply -f my-k8s/02-secret.yaml
# Decode to verify:
kubectl get secret db-secret -n taskflow \
  -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
```

---

## Step 4 — PersistentVolume + PersistentVolumeClaim

**PV** = actual disk (cluster-level, admin creates).  
**PVC** = request for disk (namespace-level, developer creates).  
Think: PV is a parking spot, PVC is your ticket claiming it.

Use `---` to put both in one file.

**PV key fields:**

| Field | Meaning |
|-------|---------|
| `capacity.storage` | Size e.g. `1Gi` |
| `accessModes: [ReadWriteOnce]` | One node mounts r/w at a time |
| `hostPath.path` | Directory on the node (local practice) |
| `storageClassName: manual` | Label to match PV ↔ PVC |
| `persistentVolumeReclaimPolicy: Retain` | Keep data after PVC deleted |

**Write `my-k8s/03-postgres-pv.yaml`:**

```yaml
apiVersion: ___
kind: PersistentVolume     # cluster-scoped, NO namespace
metadata:
  name: postgres-pv
spec:
  storageClassName: manual
  capacity:
    storage: ___           # 1Gi
  accessModes:
    - ___                  # ReadWriteOnce
  hostPath:
    path: /data/postgres
  persistentVolumeReclaimPolicy: Retain

---
apiVersion: ___
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: ___
spec:
  storageClassName: manual  # must match PV
  accessModes:
    - ___                   # same as PV
  resources:
    requests:
      storage: ___          # <= PV capacity
```

**Validate:**
```bash
minikube ssh -- sudo mkdir -p /data/postgres   # create host dir first
kubectl apply -f my-k8s/03-postgres-pv.yaml
kubectl get pv postgres-pv
kubectl get pvc postgres-pvc -n taskflow
# STATUS must be "Bound"
```

---

## Step 5 — PostgreSQL Deployment + Service

### Deployment structure

```
Deployment → manages → ReplicaSet → manages → Pod(s)
```

| Field | Meaning |
|-------|---------|
| `spec.replicas` | Number of pod copies |
| `spec.selector.matchLabels` | Which pods this Deployment owns |
| `spec.strategy.type: Recreate` | Stop old pod before starting new (safe for DB) |
| `spec.template.metadata.labels` | Labels pods get — MUST match `selector.matchLabels` |

### Injecting config into pods

```yaml
# Option A — one key at a time
env:
  - name: POSTGRES_DB
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: DB_NAME

# Option B — inject ALL keys from ConfigMap/Secret at once
envFrom:
  - configMapRef:
      name: app-config
  - secretRef:
      name: db-secret
```

### Probes

```yaml
readinessProbe:   # Removes pod from Service if fails
  exec:
    command: ["pg_isready", "-U", "postgres", "-d", "taskdb"]
  initialDelaySeconds: 10
  periodSeconds: 5

livenessProbe:    # Restarts container if fails
  exec:
    command: ["pg_isready", "-U", "postgres"]
  initialDelaySeconds: 30
  periodSeconds: 10
```

### Volume mounting

```yaml
containers:
  - name: postgres
    volumeMounts:
      - name: postgres-storage
        mountPath: /var/lib/postgresql/data
        subPath: pgdata      # prevents "directory not empty" errors
volumes:
  - name: postgres-storage
    persistentVolumeClaim:
      claimName: postgres-pvc
```

**Write `my-k8s/04-postgres.yaml`:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres-deployment
  namespace: ___
  labels:
    app: postgres
spec:
  replicas: ___             # 1 for database
  selector:
    matchLabels:
      app: ___              # postgres
  strategy:
    type: ___               # Recreate
  template:
    metadata:
      labels:
        app: ___            # must match matchLabels
    spec:
      containers:
        - name: postgres
          image: postgres:15-alpine
          ports:
            - containerPort: ___
          env:
            - name: POSTGRES_DB
              valueFrom:
                configMapKeyRef:
                  name: app-config
                  key: ___          # DB_NAME
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: ___          # DB_USER
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: ___          # DB_PASSWORD
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "postgres", "-d", "taskdb"]
            initialDelaySeconds: ___
            periodSeconds: ___
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "postgres"]
            initialDelaySeconds: ___
            periodSeconds: ___
          volumeMounts:
            - name: postgres-storage
              mountPath: /var/lib/postgresql/data
              subPath: pgdata
      volumes:
        - name: postgres-storage
          persistentVolumeClaim:
            claimName: ___          # postgres-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: postgres-service    # ← this exact name goes in ConfigMap DB_HOST
  namespace: ___
spec:
  type: ___                 # ClusterIP (internal only)
  selector:
    app: ___                # routes to postgres pods
  ports:
    - port: ___
      targetPort: ___
```

**Validate:**
```bash
kubectl apply -f my-k8s/04-postgres.yaml
kubectl get pods -n taskflow -l app=postgres
# Wait for 1/1 Running, then:
kubectl exec -it $(kubectl get pod -l app=postgres -n taskflow -o jsonpath='{.items[0].metadata.name}') \
  -n taskflow -- psql -U postgres -d taskdb -c '\dt'
```

---

## Step 6 — Redis Deployment + Service

No PVC needed — Redis is in-memory.

**Write `my-k8s/05-redis.yaml`:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis-deployment
  namespace: ___
  labels:
    app: redis
spec:
  replicas: ___
  selector:
    matchLabels:
      app: ___
  template:
    metadata:
      labels:
        app: ___
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          command: ["redis-server"]
          args: ["--maxmemory", "128mb", "--maxmemory-policy", "allkeys-lru"]
          ports:
            - containerPort: ___
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "200m"
              memory: "256Mi"
          readinessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: ___
            periodSeconds: ___

---
apiVersion: v1
kind: Service
metadata:
  name: redis-service       # ← must match ConfigMap REDIS_HOST
  namespace: ___
spec:
  type: ___
  selector:
    app: ___
  ports:
    - port: 6379
      targetPort: ___
```

**Validate:**
```bash
kubectl apply -f my-k8s/05-redis.yaml
kubectl exec -it $(kubectl get pod -l app=redis -n taskflow -o jsonpath='{.items[0].metadata.name}') \
  -n taskflow -- redis-cli ping
# Should return: PONG
```

---

## Step 7 — Backend Deployment + Service

New concepts: **3 replicas**, **RollingUpdate strategy**, **startup probe**, **envFrom**.

### RollingUpdate strategy

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1        # allow 1 extra pod temporarily during update
    maxUnavailable: 0  # never go below desired count (zero downtime)
```

### All three probes

```yaml
startupProbe:     # Runs FIRST — delays liveness. Gives app time to connect to DB.
  httpGet:
    path: /health
    port: 3001
  failureThreshold: 30   # 30 × 5s = 150s max startup window
  periodSeconds: 5

readinessProbe:   # Removes pod from Service if fails
  httpGet:
    path: /health
    port: 3001
  initialDelaySeconds: 5
  periodSeconds: 10

livenessProbe:    # Restarts container if fails
  httpGet:
    path: /health
    port: 3001
  initialDelaySeconds: 60
  periodSeconds: 15
```

**Write `my-k8s/06-backend.yaml`:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend-deployment
  namespace: ___
  labels:
    app: backend
spec:
  replicas: ___             # try 3
  selector:
    matchLabels:
      app: ___
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: ___
      maxUnavailable: ___
  template:
    metadata:
      labels:
        app: ___
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: backend
          image: taskflow-backend:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 3001
          envFrom:
            - configMapRef:
                name: ___
            - secretRef:
                name: ___
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
          startupProbe:
            httpGet:
              path: /health
              port: ___
            failureThreshold: 30
            periodSeconds: 5
          readinessProbe:
            httpGet:
              path: /health
              port: ___
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: ___
            initialDelaySeconds: 60
            periodSeconds: 15

---
apiVersion: v1
kind: Service
metadata:
  name: backend-service     # ← nginx.conf proxies /api/* to this
  namespace: ___
spec:
  type: ___                 # ClusterIP
  selector:
    app: ___
  ports:
    - port: 3001
      targetPort: ___
```

**Validate:**
```bash
kubectl apply -f my-k8s/06-backend.yaml
kubectl get pods -n taskflow -l app=backend     # should see 3 pods
kubectl get endpoints backend-service -n taskflow  # shows all 3 pod IPs
```

---

## Step 8 — Frontend Deployment + NodePort Service

**New concept:** `NodePort` — exposes the service on every node's IP at a fixed port.

| Service Type | Accessible From | Port Range |
|---|---|---|
| `ClusterIP` | Inside cluster only | Any |
| `NodePort` | Browser / outside | 30000–32767 |
| `LoadBalancer` | Cloud LB (AWS/GCP) | Any |

**Write `my-k8s/07-frontend.yaml`:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend-deployment
  namespace: ___
  labels:
    app: frontend
spec:
  replicas: ___             # 2
  selector:
    matchLabels:
      app: ___
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: ___
    spec:
      containers:
        - name: frontend
          image: taskflow-frontend:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: ___   # 80 (nginx)
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "200m"
              memory: "128Mi"
          readinessProbe:
            httpGet:
              path: /
              port: ___
            initialDelaySeconds: 5
            periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: frontend-service
  namespace: ___
spec:
  type: ___                # NodePort
  selector:
    app: ___
  ports:
    - port: 80
      targetPort: ___
      nodePort: ___        # choose 30000-32767, e.g. 30080
```

**Validate:**
```bash
kubectl apply -f my-k8s/07-frontend.yaml
kubectl get svc frontend-service -n taskflow
minikube service frontend-service -n taskflow   # opens in browser
# OR
kubectl port-forward svc/frontend-service 8080:80 -n taskflow
```

---

## Step 9 — Standalone Pod (practice)

Raw Pod — no Deployment, no ReplicaSet. If it dies, it's gone.

**Write `my-k8s/08-pod.yaml`:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: debug-pod
  namespace: ___
  labels:
    app: debug
spec:
  containers:
    - name: debug
      image: alpine:latest
      command: ["sh", "-c", "while true; do echo hello; sleep 5; done"]
      resources:
        requests:
          cpu: "10m"
          memory: "16Mi"
  restartPolicy: Always
```

**Experiment:**
```bash
kubectl apply -f my-k8s/08-pod.yaml
kubectl delete pod debug-pod -n taskflow
kubectl get pods -n taskflow    # it's gone — no controller to recreate it
# Compare: deleting a Deployment pod → it respawns automatically
```

---

## Step 10 — Standalone ReplicaSet (practice)

**Write `my-k8s/09-replicaset.yaml`:**

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: backend-rs
  namespace: ___
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend-rs
  template:
    metadata:
      labels:
        app: backend-rs
    spec:
      containers:
        - name: backend
          image: taskflow-backend:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 3001
          envFrom:
            - configMapRef:
                name: app-config
            - secretRef:
                name: db-secret
```

**Experiments:**

```bash
# 1. Self-healing
kubectl delete pod <pod-name> -n taskflow
kubectl get pods -n taskflow -l app=backend-rs -w   # watch it respawn

# 2. Scale
kubectl scale replicaset backend-rs --replicas=5 -n taskflow

# 3. Orphan a pod — change its label, RS creates a replacement
kubectl label pod <pod-name> app=orphaned -n taskflow --overwrite
kubectl get pods -n taskflow --show-labels
```

---

## Full Deploy Order

```bash
kubectl apply -f my-k8s/00-namespace.yaml
kubectl apply -f my-k8s/01-configmap.yaml
kubectl apply -f my-k8s/02-secret.yaml
kubectl apply -f my-k8s/03-postgres-pv.yaml
kubectl apply -f my-k8s/04-postgres.yaml
kubectl apply -f my-k8s/05-redis.yaml
kubectl apply -f my-k8s/06-backend.yaml
kubectl apply -f my-k8s/07-frontend.yaml
```

**Verify all pods are healthy:**
```bash
kubectl get all -n taskflow
# All pods should show Running and 1/1 or 3/3 READY
# Any 0/1 = readiness probe failing → kubectl describe pod <name> -n taskflow
```

---

## Rolling Update Practice

```bash
# After changing server.js and rebuilding:
docker build -t taskflow-backend:v2 ./backend
minikube image load taskflow-backend:v2

# Trigger rolling update
kubectl set image deployment/backend-deployment backend=taskflow-backend:v2 -n taskflow

# Watch zero-downtime rollout
kubectl rollout status deployment/backend-deployment -n taskflow
kubectl get pods -n taskflow -w

# Rollback if something breaks
kubectl rollout undo deployment/backend-deployment -n taskflow
kubectl rollout history deployment/backend-deployment -n taskflow
```
