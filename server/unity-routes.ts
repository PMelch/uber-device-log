import express from 'express';
import { parseDocument } from 'yaml';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync, renameSync, unlinkSync, fsyncSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectContext } from './project-context.js';
import type { Device, LogMessage } from '../shared/types.js';
import type { OpenLogs } from './devices.js';
import { notification } from '../shared/notifications.js';

type Identity = { projectId: string; secret: string; sessions?: Record<string,string> };
function enabled(project: ProjectContext | undefined): boolean {
  if (!project) return false;
  const fd = openSync(project.configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid project configuration');
    const doc = parseDocument(readFileSync(fd,'utf8'));
    if (doc.errors.length) throw new Error('Invalid project YAML');
    return doc.getIn(['unity','enabled']) === true;
  } finally { closeSync(fd); }
}
function saveIdentity(project: ProjectContext, value: Identity) {
  const path=join(project.configDirectory,'local','unity.json');
  const temporary=path+'.'+randomUUID()+'.tmp';
  const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try { writeFileSync(fd,JSON.stringify(value));fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(temporary,path); } finally { try {unlinkSync(temporary);} catch {} }
}
function identity(project: ProjectContext): Identity {
  const directory = project.configDirectory;
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Project directory cannot be a symlink');
  const local = join(directory, 'local');
  try { mkdirSync(local, {mode: 0o700}); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const stat = lstatSync(local);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Local secrets directory cannot be a symlink');
  chmodSync(local, 0o700);
  const ignore = openSync(join(directory, '.gitignore'), constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    if (!fstatSync(ignore).isFile() || fstatSync(ignore).nlink !== 1) throw new Error('Invalid ignore file');
    const content = readFileSync(ignore, 'utf8');
    // Append last so existing negations cannot accidentally expose local secrets.
    if (!content.endsWith('/local/\n')) writeFileSync(ignore, (content.endsWith('\n') || !content ? '' : '\n') + '/local/\n');
  } finally { closeSync(ignore); }
  const path = join(local, 'unity.json');
  try {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify({projectId:randomUUID(),secret:randomBytes(32).toString('hex')})); } finally { closeSync(fd); }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.nlink !== 1 || s.size > 16384 || (s.mode & 0o077)) throw new Error('Unsafe Unity secret file');
    const value = JSON.parse(readFileSync(fd, 'utf8'));
    if (typeof value.projectId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.projectId) || !/^[a-f0-9]{64}$/.test(value.secret)) throw new Error('Invalid Unity identity');
    if (value.sessions !== undefined && (typeof value.sessions !== 'object' || value.sessions === null || Array.isArray(value.sessions) || Object.keys(value.sessions).length > 8 || !Object.entries(value.sessions).every(([id,hash]) => /^[a-zA-Z0-9._-]{1,128}$/.test(id) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)))) throw new Error('Invalid Unity authorizations');
    return value;
  } finally { closeSync(fd); }
}
const digest = (value: string) => createHash('sha256').update(value).digest();
const equal = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
const text = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && (empty || v.length > 0) && v.length <= max;
const levels: Record<string, string> = {Log:'I',Warning:'W',Error:'E',Assert:'E',Exception:'E'};
type Subscriber = {message: (m: LogMessage) => void; end: () => void};
type Source = {id:string; name:string; state:string; dropped:number; received:number; lastSeen:number; subscribers:Set<Subscriber>};

export function unityRoutes(project: ProjectContext | undefined, port: number, options: {now?: () => number} = {}) {
  const now = options.now ?? Date.now;
  const isEnabled = enabled(project);
  const credentials = isEnabled ? identity(project!) : undefined;
  const router = express.Router();
  const sessions = new Map<string, string>(Object.entries(credentials?.sessions ?? {})); // instance -> token digest (never expose tokens in state)
  const reloadSessions = () => {
    if (!credentials) return;
    const latest=identity(project!);
    sessions.clear();
    if (latest.projectId !== credentials.projectId || latest.secret !== credentials.secret) return;
    for (const [id,hash] of Object.entries(latest.sessions ?? {})) sessions.set(id,hash);
  };
  const persistSessions = () => saveIdentity(project!, {...credentials!,sessions:Object.fromEntries(sessions)});
  const sources = new Map<string, Source>();
  let pairing: {code:string; expiresAt:number} | undefined;
  let closed = false;
  let requests = 0, window = now(), pairRequests = 0;
  const remove = (id: string) => {
    const source = sources.get(id); sources.delete(id);
    if (source) for (const subscriber of [...source.subscribers]) subscriber.end();
  };
  const sweep = () => { for (const [id,s] of sources) if (now() - s.lastSeen >= 15000) remove(id); };
  const timer = setInterval(sweep, 1000); timer.unref();
  router.use((req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    const host = req.headers.host;
    const origin = req.headers.origin;
    const local = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    if (!local || ![`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(host ?? '') || (origin !== undefined && origin !== 'http://' + host)) {res.sendStatus(403); return;}
    if (req.method !== 'GET' && ((origin !== undefined || req.path === '/pairing') && (origin !== 'http://' + host || req.headers['x-udl-unity'] !== '1'))) {res.sendStatus(403);return;}
    if (closed) {res.sendStatus(503);return;}
    if (now() - window >= 1000) {window=now();requests=0;}
    if (++requests > 100) {res.setHeader('Retry-After','1');res.sendStatus(429);return;}
    if (!credentials && req.path !== '/state') {res.sendStatus(409);return;}
    if (req.method === 'POST' && !req.is('application/json')) {res.sendStatus(415);return;}
    next();
  });
  router.use(express.json({limit:'256kb',strict:true}));
  router.get('/state', (_req,res) => {
    reloadSessions();sweep();
    res.json({enabled:isEnabled,projectName:project ? basename(project.directory) : null,packagePath:join(dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('.ts') ? '..' : '../..', 'unity-package'),sources:[...sources.values()].map(({subscribers:_,...s}) => s),paired:sessions.size > 0});
  });
  router.post('/pairing', (_req,res) => {
    pairing = {code:String(randomInt(0, 100000000)).padStart(8,'0'),expiresAt:now()+120000}; pairRequests=0;
    res.json({...pairing,projectId:credentials!.projectId});
  });
  router.delete('/pairing', (_req,res) => {
    pairing=undefined;sessions.clear();persistSessions();for (const id of sources.keys()) remove(id);res.sendStatus(204);
  });
  router.post('/pair', (req,res) => {
    const b = req.body;
    if (!text(b?.instanceId,128) || !/^[a-zA-Z0-9._-]+$/.test(b.instanceId) || !text(b?.name,128) || !text(b?.code,32) || !text(b?.projectId,128)) {res.sendStatus(400);return;}
    if (++pairRequests > 10) {pairing=undefined;res.setHeader('Retry-After','120');res.sendStatus(429);return;}
    if (!pairing || now() >= pairing.expiresAt || !equal(b.code,pairing.code) || !equal(b.projectId,credentials!.projectId)) {res.sendStatus(401);return;}
    reloadSessions();
    if (!sessions.has(b.instanceId) && sessions.size >= 8) {res.sendStatus(429);return;}
    pairing=undefined;
    const token = randomBytes(32).toString('hex');
    remove('unity:' + credentials!.projectId + ':' + b.instanceId);
    sessions.set(b.instanceId,digest(credentials!.secret + token).toString('hex'));
    persistSessions();
    res.json({token,projectId:credentials!.projectId});
  });
  router.post('/batch', (req,res) => {
    const b = req.body; const authorization = req.headers.authorization ?? '';
    if (!text(b?.instanceId,128) || !text(b?.projectId,128) || !/^Bearer [a-f0-9]{64}$/.test(authorization)) {res.sendStatus(401);return;}
    reloadSessions();
    const expected = sessions.get(b.instanceId);
    const actual = digest(credentials!.secret + authorization.slice(7)).toString('hex');
    if (!equal(actual,expected ?? 'invalid') || !equal(b.projectId,credentials!.projectId)) {res.sendStatus(401);return;}
    if (b.version !== 1 || !text(b.name,128) || !Number.isSafeInteger(b.dropped) || b.dropped < 0 || !Array.isArray(b.logs) || b.logs.length > 200 || !b.logs.every((l: any) => l && text(l.timestamp,64) && Number.isFinite(Date.parse(l.timestamp)) && text(l.message,16384,true) && text(l.stackTrace,16384,true) && typeof l.type === 'string' && Object.hasOwn(levels,l.type))) {res.sendStatus(400);return;}
    sweep(); const id = 'unity:' + credentials!.projectId + ':' + b.instanceId;
    let source = sources.get(id);
    if (!source) {source={id,name:b.name,state:'connected',dropped:0,received:0,lastSeen:now(),subscribers:new Set()};sources.set(id,source);}
    source.name=b.name;source.lastSeen=now();source.dropped=Math.min(Number.MAX_SAFE_INTEGER,source.dropped+b.dropped);source.received=Math.min(Number.MAX_SAFE_INTEGER,source.received+b.logs.length);
    for (const l of b.logs) {
      if (l.message.length + (l.stackTrace ? 1 + l.stackTrace.length : 0) > 16384) source.dropped = Math.min(Number.MAX_SAFE_INTEGER, source.dropped + 1);
      const message: LogMessage = {timestamp:l.timestamp,message:(l.message + (l.stackTrace ? '\n'+l.stackTrace : '')).slice(0,16384),level:levels[l.type],tag:'Unity'};
      for (const sub of source.subscribers) sub.message(message);
    }
    res.json({accepted:b.logs.length});
  });
  router.use((error: any,_req: express.Request,res: express.Response,_next: express.NextFunction) => {res.sendStatus(error?.type === 'entity.too.large' ? 413 : 400);});
  const devices = (): Device[] => {sweep();return [...sources.values()].map(s => ({id:s.id,name:s.name,state:s.state,platform:'unity'}));};
  const openLogs: OpenLogs = async (device,onMessage,onEnd,signal) => {
    sweep();const source = sources.get(device.id);
    if (closed || !source || device.platform !== 'unity') throw new Error('Unity source unavailable');
    if (source.subscribers.size >= 8) throw new Error('Unity subscriber limit');
    let stopped=false;
    const stop = () => {if (stopped) return;stopped=true;source.subscribers.delete(subscriber);signal?.removeEventListener('abort',stop);};
    const subscriber: Subscriber = {message:onMessage,end:() => {stop();onEnd(notification('streamEnded', {platform:'Unity'}));}};
    if (!signal?.aborted) {source.subscribers.add(subscriber);signal?.addEventListener('abort',stop,{once:true});}
    return stop;
  };
  return {enabled:isEnabled,router,devices,openLogs,sweep,close:() => {if(closed)return;closed=true;clearInterval(timer);pairing=undefined;sessions.clear();for(const id of sources.keys())remove(id);}};
}
