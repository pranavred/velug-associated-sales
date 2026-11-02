import { fail, text, type Sql, type Statement } from './db.js';
export type Principal = { userId:string; email:string; companyId:string; companyName:string; role:'owner'|'member'|'integration'; platformAdmin:boolean; source?:string };
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');
const unhex = (value: string) => Uint8Array.from(value.match(/.{2}/g) || [], s=>parseInt(s,16));
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export const emailAddress = (value: unknown) => {
  const email = text(value,'email',254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'Invalid email');
  return email;
};
function validPassword(password: string) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 256) fail(400,'Use a password between 14 and 256 characters');
}
async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:100000,hash:'SHA-256'},key,256));
}
export async function passwordHash(password: string) {
  validPassword(password); const salt=randomToken(); return `pbkdf2-sha256$100000$${salt}$${await derive(password,salt)}`;
}
async function matches(password: string, hash: string) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const parts=hash.split('$'); const expected=parts[3] || '0'.repeat(64);
  const actual=await derive(password,parts[2] || '0'.repeat(64));
  let difference=expected.length ^ actual.length;
  for(let i=0;i<actual.length;i++) difference|=actual.charCodeAt(i) ^ (expected.charCodeAt(i)||0);
  return difference===0 && parts[0]==='pbkdf2-sha256' && parts[1]==='100000';
}
export function requireOwner(p: Principal) { if(p.role!=='owner') fail(403,'Company owner access required'); }
export async function audit(db:Sql,p:Principal,action:string,detail:unknown) {
  await db.run('INSERT INTO audit_events VALUES (?,?,?,?,?,?)',crypto.randomUUID(),p.companyId,p.userId,action,JSON.stringify(detail),Date.now());
}
export async function bootstrap(db:Sql,input:{email:string;password:string;company:string}) {
  if(await db.get("SELECT 1 FROM app_state WHERE key='initialized'")) fail(409,'Instance already initialized');
  const email=emailAddress(input.email), name=text(input.company,'company name',150), password=await passwordHash(input.password);
  const companyId=crypto.randomUUID(),userId=crypto.randomUUID(),now=Date.now();
  try { await db.batch([
    {sql:'INSERT INTO app_state VALUES (?,?)',args:['initialized','1']},
    {sql:'INSERT INTO companies VALUES (?,?,?)',args:[companyId,name,now]},
    {sql:'INSERT INTO users VALUES (?,?,?,?,?)',args:[userId,email,password,1,now]},
    {sql:'INSERT INTO memberships VALUES (?,?,?)',args:[companyId,userId,'owner']},
  ]); } catch(e) { if(await db.get("SELECT 1 FROM app_state WHERE key='initialized'")) fail(409,'Instance already initialized'); throw e; }
  return {companyId,userId};
}
export async function signIn(db:Sql,email:string,password:string) {
  const normalized=emailAddress(email), user=await db.get('SELECT * FROM users WHERE email=?',normalized);
  if(!await matches(password,user?.password || '')) fail(401,'Invalid credentials');
  const companies=await db.all('SELECT c.id,c.name,m.role FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.user_id=? ORDER BY c.name',user!.id);
  if(!companies.length) fail(403,'No active company membership');
  const token=randomToken();
  await db.run('DELETE FROM sessions WHERE expires_at<?',Date.now());
  await db.run('INSERT INTO sessions VALUES (?,?,?,?)',await digest(token),user!.id,companies[0].id,Date.now()+8*3600000);
  return {token,companies};
}
export async function sessionPrincipal(db:Sql,token:string):Promise<Principal|null> {
  if(!/^[a-f0-9]{64}$/.test(token)) return null;
  const row=await db.get(`SELECT u.id,u.email,u.platform_admin,c.id AS company_id,c.name,m.role FROM sessions s
    JOIN users u ON s.user_id=u.id JOIN memberships m ON m.user_id=s.user_id AND m.company_id=s.company_id
    JOIN companies c ON c.id=s.company_id WHERE s.hash=? AND s.expires_at>?`,await digest(token),Date.now());
  return row ? {userId:row.id,email:row.email,companyId:row.company_id,companyName:row.name,role:row.role,platformAdmin:row.platform_admin===1} : null;
}
export async function signOut(db:Sql,token:string) { await db.run('DELETE FROM sessions WHERE hash=?',await digest(token)); }
export async function switchCompany(db:Sql,token:string,companyId:string) {
  const session=await db.get('SELECT * FROM sessions WHERE hash=? AND expires_at>?',await digest(token),Date.now());
  if(!session || !await db.get('SELECT 1 FROM memberships WHERE user_id=? AND company_id=?',session.user_id,companyId)) fail(403,'Active company membership required');
  await db.run('UPDATE sessions SET company_id=? WHERE hash=?',companyId,session.hash);
}
export async function inviteMember(db:Sql,p:Principal,email:string,role:'owner'|'member'='member') {
  requireOwner(p);
  if(!['owner','member'].includes(role)) fail(400,'Invalid role');
  const id=crypto.randomUUID(),token=randomToken(),normalized=emailAddress(email);
  await db.run('INSERT INTO invites VALUES (?,?,?,?,?,?,NULL)',id,p.companyId,normalized,role,await digest(token),Date.now()+24*3600000);
  await audit(db,p,'invite.created',{email:normalized,role}); return {id,token,companyId:p.companyId};
}
export async function provisionCompany(db:Sql,p:Principal,name:string,email:string) {
  if(!p.platformAdmin || p.role==='integration') fail(403,'Platform administrator access required');
  const companyId=crypto.randomUUID(),token=randomToken(),id=crypto.randomUUID();
  await db.batch([
    {sql:'INSERT INTO companies VALUES (?,?,?)',args:[companyId,text(name,'company name',150),Date.now()]},
    {sql:'INSERT INTO invites VALUES (?,?,?,?,?,?,NULL)',args:[id,companyId,emailAddress(email),'owner',await digest(token),Date.now()+24*3600000]},
  ]);
  await audit(db,p,'company.provisioned',{companyId}); return {id,companyId,token};
}
export async function activateInvite(db:Sql,token:string,password:string) {
  const hash=await digest(text(token,'invitation',64,64)),now=Date.now();
  const invite=await db.get('SELECT * FROM invites WHERE hash=? AND used_at IS NULL AND expires_at>?',hash,now);
  if(!invite) fail(400,'Invitation expired, used or invalid');
  const user=await db.get('SELECT * FROM users WHERE email=?',invite.email);
  if(user && !await matches(password,user.password)) fail(401,'Use the password for your existing account');
  const userId=user?.id || crypto.randomUUID(), statements:Statement[]=[];
  if(!user) statements.push({sql:'INSERT INTO users SELECT ?,?,?,0,? WHERE EXISTS(SELECT 1 FROM invites WHERE hash=? AND used_at IS NULL AND expires_at>?)',args:[userId,invite.email,await passwordHash(password),now,hash,now]});
  statements.push({sql:`INSERT INTO memberships SELECT company_id,?,role FROM invites WHERE hash=? AND used_at IS NULL AND expires_at>?
    ON CONFLICT(company_id,user_id) DO NOTHING`,args:[userId,hash,now]});
  statements.push({sql:'UPDATE invites SET used_at=? WHERE hash=? AND used_at IS NULL AND expires_at>? RETURNING id',args:[now,hash,now]});
  const results=await db.batch(statements);
  if(!results.at(-1)!.rows.length) fail(409,'Invitation already used');
  return {email:invite.email,companyId:invite.company_id};
}
export async function revokeMember(db:Sql,p:Principal,userId:string) {
  requireOwner(p); if(userId===p.userId) fail(400,'Cannot revoke yourself');
  const changed=await db.run('DELETE FROM memberships WHERE company_id=? AND user_id=?',p.companyId,userId);
  if(!changed) fail(404,'Member not found');
  await db.run('DELETE FROM sessions WHERE company_id=? AND user_id=?',p.companyId,userId);
  await audit(db,p,'member.revoked',{userId});
}
export async function limit(db:Sql,key:string,max:number,windowMs:number) {
  const window=Math.floor(Date.now()/windowMs),id=await digest(key+':'+window);
  const result=await db.get(`INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 WHERE attempts<? RETURNING attempts`,id,Date.now()+windowMs,max);
  if(!result) fail(429,'Too many requests. Try again later.');
}
