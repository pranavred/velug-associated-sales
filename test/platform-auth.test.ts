import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeDatabase } from '../app/node-db.js';
import { bootstrap, signIn, sessionPrincipal, provisionCompany, inviteMember, activateInvite, revokeMember, switchCompany, signOut } from '../app/auth.js';

const password = 'a test passphrase with enough entropy';
async function setup() {
  const db = new NodeDatabase(':memory:');
  await bootstrap(db, { email: 'owner@example.test', password, company: 'Alpha' });
  const login = await signIn(db, 'OWNER@example.test', password);
  const owner = (await sessionPrincipal(db, login.token))!;
  return { db, owner, token: login.token };
}
test('individual sessions use normalized identities and never return password material', async () => {
  const { db, owner, token } = await setup();
  try {
    assert.equal(owner.email, 'owner@example.test');
    assert.equal(owner.role, 'owner');
    assert.equal(owner.platformAdmin, true);
    assert(!JSON.stringify(owner).includes('password'));
    await assert.rejects(signIn(db, owner.email, 'wrong password'), /Invalid credentials/);
    await assert.rejects(signIn(db, 'missing@example.test', password), /Invalid credentials/);
    assert.equal(await sessionPrincipal(db, token + 'forged'), null);
    await signOut(db, token);
    assert.equal(await sessionPrincipal(db, token), null);
    await assert.rejects(bootstrap(db, { email:'other@example.test', password, company:'Other' }), /already initialized/);
  } finally { db.close(); }
});
test('invites are single use and cannot overwrite an existing account password', async () => {
  const { db, owner } = await setup();
  try {
    const invite = await inviteMember(db, owner, 'member@example.test', 'member');
    await activateInvite(db, invite.token, password);
    await assert.rejects(activateInvite(db, invite.token, password), /expired|used|invalid/i);
    const login = await signIn(db, 'member@example.test', password);
    const member = (await sessionPrincipal(db, login.token))!;
    assert.equal(member.companyId, owner.companyId);
    await assert.rejects(inviteMember(db, member, 'extra@example.test', 'owner'), /owner/i);
    await assert.rejects(provisionCompany(db, member, 'Forbidden', 'new@example.test'), /administrator/i);
    const other = await provisionCompany(db, owner, 'Beta', 'member@example.test');
    await assert.rejects(activateInvite(db, other.token, 'not the existing password'), /existing account/i);
    await activateInvite(db, other.token, password);
    await switchCompany(db, login.token, other.companyId);
    assert.equal((await sessionPrincipal(db, login.token))!.companyId, other.companyId);
    assert.equal((await signIn(db, 'member@example.test', password)).companies.length, 2);
  } finally { db.close(); }
});
test('membership checks isolate organizations and revocation invalidates access immediately', async () => {
  const { db, owner, token } = await setup();
  try {
    const beta = await provisionCompany(db, owner, 'Beta', 'beta@example.test');
    await activateInvite(db, beta.token, password);
    await assert.rejects(switchCompany(db, token, beta.companyId), /membership/i);
    const invite = await inviteMember(db, owner, 'member@example.test', 'member');
    await activateInvite(db, invite.token, password);
    const login = await signIn(db, 'member@example.test', password);
    const member = (await sessionPrincipal(db, login.token))!;
    await assert.rejects(revokeMember(db, owner, owner.userId), /yourself|owner/i);
    await revokeMember(db, owner, member.userId);
    assert.equal(await sessionPrincipal(db, login.token), null);
    await assert.rejects(signIn(db, member.email, password), /membership|access/i);
    assert.equal((await sessionPrincipal(db, token))!.companyId, owner.companyId);
  } finally { db.close(); }
});
test('SQL batch rolls back every statement on constraint failure', async () => {
  const db = new NodeDatabase(':memory:');
  try {
    await assert.rejects(db.batch([
      {sql:'INSERT INTO companies(id,name,created_at) VALUES (?,?,?)', args:['one','First',1]},
      {sql:'INSERT INTO companies(id,name,created_at) VALUES (?,?,?)', args:['one','Conflict',1]},
    ]));
    assert.equal((await db.all('SELECT * FROM companies')).length, 0);
  } finally { db.close(); }
});
