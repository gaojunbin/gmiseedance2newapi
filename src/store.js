import fs from 'node:fs/promises';
import path from 'node:path';

export class TaskStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.tasks = new Map();
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      for (const [id, task] of Object.entries(parsed.tasks || {})) {
        this.tasks.set(id, task);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  get(id) {
    return this.tasks.get(id) || null;
  }

  async upsert(id, patch) {
    const existing = this.get(id) || {};
    const task = {
      ...existing,
      ...patch,
      id,
      updatedAt: new Date().toISOString()
    };
    if (!task.createdAt) {
      task.createdAt = task.updatedAt;
    }
    this.tasks.set(id, task);
    await this.flush();
    return task;
  }

  async flush() {
    const payload = {
      version: 1,
      tasks: Object.fromEntries(this.tasks)
    };
    this.writeQueue = this.writeQueue.then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`);
      await fs.rename(tmp, this.filePath);
    });
    return this.writeQueue;
  }
}
