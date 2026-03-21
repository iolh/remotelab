import { randomBytes } from 'crypto';
import { dirname } from 'path';
import { VISITORS_FILE } from '../lib/config.mjs';
import { createSerialTaskQueue, ensureDir, readJson, writeJsonAtomic } from './fs-utils.mjs';

const runVisitorsMutation = createSerialTaskQueue();

function cloneVisitor(visitor) {
  return visitor ? JSON.parse(JSON.stringify(visitor)) : null;
}

function normalizeVisitorName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeVisitorAppId(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function generateVisitorId() {
  return `visitor_${randomBytes(12).toString('hex')}`;
}

function generateVisitorShareToken() {
  return `visit_${randomBytes(16).toString('hex')}`;
}

async function loadVisitors() {
  const visitors = await readJson(VISITORS_FILE, []);
  return Array.isArray(visitors) ? visitors : [];
}

async function saveVisitors(list) {
  const dir = dirname(VISITORS_FILE);
  await ensureDir(dir);
  await writeJsonAtomic(VISITORS_FILE, list);
}

export async function listVisitors() {
  const visitors = await loadVisitors();
  return visitors
    .filter((visitor) => visitor && !visitor.deleted)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map((visitor) => cloneVisitor(visitor));
}

export async function getVisitor(id) {
  if (!id) return null;
  const visitors = await loadVisitors();
  return cloneVisitor(visitors.find((visitor) => visitor?.id === id && !visitor.deleted) || null);
}

export async function getVisitorByShareToken(shareToken) {
  if (!shareToken) return null;
  const visitors = await loadVisitors();
  return cloneVisitor(visitors.find((visitor) => visitor?.shareToken === shareToken && !visitor.deleted) || null);
}

export async function createVisitor(input = {}) {
  const name = normalizeVisitorName(input.name) || 'New visitor';
  const appId = normalizeVisitorAppId(input.appId);
  if (!appId) {
    throw new Error('appId is required');
  }
  return runVisitorsMutation(async () => {
    const visitor = {
      id: generateVisitorId(),
      name,
      appId,
      shareToken: generateVisitorShareToken(),
      createdAt: new Date().toISOString(),
    };
    const visitors = await loadVisitors();
    visitors.push(visitor);
    await saveVisitors(visitors);
    return cloneVisitor(visitor);
  });
}

export async function updateVisitor(id, updates = {}) {
  if (!id) return null;
  return runVisitorsMutation(async () => {
    const visitors = await loadVisitors();
    const index = visitors.findIndex((visitor) => visitor?.id === id && !visitor.deleted);
    if (index === -1) return null;
    const nextName = normalizeVisitorName(updates.name);
    if (nextName) {
      visitors[index].name = nextName;
    }
    const nextAppId = normalizeVisitorAppId(updates.appId);
    if (nextAppId) {
      visitors[index].appId = nextAppId;
    }
    await saveVisitors(visitors);
    return cloneVisitor(visitors[index]);
  });
}

export async function deleteVisitor(id) {
  if (!id) return false;
  return runVisitorsMutation(async () => {
    const visitors = await loadVisitors();
    const index = visitors.findIndex((visitor) => visitor?.id === id && !visitor.deleted);
    if (index === -1) return false;
    visitors[index] = {
      ...visitors[index],
      deleted: true,
      deletedAt: new Date().toISOString(),
    };
    await saveVisitors(visitors);
    return true;
  });
}
