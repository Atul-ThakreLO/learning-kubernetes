const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Pool } = require('pg');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(morgan('combined'));

// ── PostgreSQL Connection ─────────────────────────────────────────────────────
const pgPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'taskdb',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// ── Redis Connection ──────────────────────────────────────────────────────────
const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
});

redisClient.on('error', (err) => console.error('Redis error:', err));
redisClient.on('connect', () => console.log('✅ Connected to Redis'));

// ── DB Initialisation ─────────────────────────────────────────────────────────
async function initDB() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title      TEXT    NOT NULL,
      description TEXT,
      status     TEXT    NOT NULL DEFAULT 'todo',
      priority   TEXT    NOT NULL DEFAULT 'medium',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ Database initialised');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const CACHE_TTL = 60; // seconds

async function invalidateCache(pattern = 'tasks:*') {
  const keys = await redisClient.keys(pattern);
  if (keys.length > 0) await redisClient.del(keys);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/health', async (req, res) => {
  const checks = { status: 'ok', timestamp: new Date().toISOString() };
  try {
    await pgPool.query('SELECT 1');
    checks.database = 'connected';
  } catch { checks.database = 'error'; checks.status = 'degraded'; }

  try {
    await redisClient.ping();
    checks.redis = 'connected';
  } catch { checks.redis = 'error'; checks.status = 'degraded'; }

  checks.hostname = process.env.HOSTNAME || require('os').hostname();
  checks.version  = '1.0.0';
  res.json(checks);
});

// GET /api/tasks — list all tasks (with Redis cache)
app.get('/api/tasks', async (req, res) => {
  const cacheKey = `tasks:all:${req.query.status || 'all'}`;
  try {
    // Try cache first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json({ source: 'cache', data: JSON.parse(cached) });
    }

    const { status } = req.query;
    const query = status
      ? 'SELECT * FROM tasks WHERE status = $1 ORDER BY created_at DESC'
      : 'SELECT * FROM tasks ORDER BY created_at DESC';
    const params = status ? [status] : [];

    const result = await pgPool.query(query, params);
    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(result.rows));

    res.json({ source: 'database', data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// GET /api/tasks/:id — single task
app.get('/api/tasks/:id', async (req, res) => {
  const cacheKey = `tasks:${req.params.id}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json({ source: 'cache', data: JSON.parse(cached) });

    const result = await pgPool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Task not found' });

    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(result.rows[0]));
    res.json({ source: 'database', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks — create task
app.post('/api/tasks', async (req, res) => {
  const { title, description, status = 'todo', priority = 'medium' } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  try {
    const result = await pgPool.query(
      'INSERT INTO tasks (title, description, status, priority) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, description, status, priority]
    );
    await invalidateCache('tasks:all:*');
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/:id — update task
app.put('/api/tasks/:id', async (req, res) => {
  const { title, description, status, priority } = req.body;
  try {
    const result = await pgPool.query(
      `UPDATE tasks SET
        title       = COALESCE($1, title),
        description = COALESCE($2, description),
        status      = COALESCE($3, status),
        priority    = COALESCE($4, priority),
        updated_at  = NOW()
       WHERE id = $5 RETURNING *`,
      [title, description, status, priority, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Task not found' });

    await invalidateCache('tasks:all:*');
    await redisClient.del(`tasks:${req.params.id}`);
    res.json({ data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id — delete task
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const result = await pgPool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Task not found' });

    await invalidateCache('tasks:all:*');
    await redisClient.del(`tasks:${req.params.id}`);
    res.json({ message: 'Task deleted', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats — dashboard stats
app.get('/api/stats', async (req, res) => {
  try {
    const result = await pgPool.query(`
      SELECT
        COUNT(*)                                         AS total,
        COUNT(*) FILTER (WHERE status = 'todo')         AS todo,
        COUNT(*) FILTER (WHERE status = 'in_progress')  AS in_progress,
        COUNT(*) FILTER (WHERE status = 'done')         AS done,
        COUNT(*) FILTER (WHERE priority = 'high')       AS high_priority
      FROM tasks
    `);
    res.json({ data: result.rows[0], hostname: process.env.HOSTNAME || require('os').hostname() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function start() {
  let dbRetries = 10;
  while (dbRetries > 0) {
    try {
      await pgPool.query('SELECT 1');
      break;
    } catch {
      console.log(`⏳ Waiting for PostgreSQL... (${dbRetries} retries left)`);
      dbRetries--;
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  await initDB();

  let redisRetries = 10;
  while (redisRetries > 0) {
    try {
      await redisClient.connect();
      break;
    } catch {
      console.log(`⏳ Waiting for Redis... (${redisRetries} retries left)`);
      redisRetries--;
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Backend API running on port ${PORT}`);
  });
}

start().catch(console.error);
