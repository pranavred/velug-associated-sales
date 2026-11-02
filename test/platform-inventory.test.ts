import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeDatabase } from '../app/node-db.js';
import { bootstrap, signIn, sessionPrincipal, provisionCompany, activateInvite } from '../app/auth.js';
import { parseCSV } from '../app/csv.js';
import { importInventory, listInventory, eligibility, createInventoryToken, inventoryPrincipal, revokeInventoryToken } from '../app/inventory.js';
const password='test organization owner passphrase';
async function setup() { const db=new NodeDatabase(':memory:'); await bootstrap(db,{email:'a@example.test',password,company:'A'}); const owner=(await sessionPrincipal(db,(await signIn(db,'a@example.test',password)).token))!; return {db,owner}; }
const product=(sku:string,extra:Record<string,unknown>={})=>({sku,name:'Water treatment '+sku,description:'Coagulant for process water',applications:['wastewater'],quantity:12,regions:['US'],...extra});
test('CSV parses escaped quotes, embedded newlines, BOM and CRLF, rejects broken/duplicate headers',()=>{
  const rows=parseCSV('\ufeffPart,Title,Stock\r\nA,"A \'quoted\' product, with a comma",3\r\nB,"two\nlines and ""quotes""",0\r\n');
  assert.equal(rows[0].Title,"A 'quoted' product, with a comma"); assert.equal(rows[1].Title,'two\nlines and "quotes"');
  assert.throws(()=>parseCSV('sku,sku\na,b'),/header/i);
  assert.throws(()=>parseCSV('sku,name\na,"unterminated'),/quote/i);
  assert.throws(()=>parseCSV('sku,name\na,b,c'),/column/i);
});
test('mapped imports are atomic and idempotency conflicts never alter stock',async()=>{
  const {db,owner}=await setup(); try{
    const input={source:'erp',key:'batch-one',mode:'replace' as const,rows:[{Part:'A',Title:'Filter',Stock:'3'}],mapping:{sku:'Part',name:'Title',quantity:'Stock'}};
    const receipt=await importInventory(db,owner,input);
    assert.equal(receipt.imported,1);
    assert.equal((await listInventory(db,owner))[0].quantity,3);
    const replay=await importInventory(db,owner,input); assert.equal(replay.id,receipt.id);
    await assert.rejects(importInventory(db,owner,{...input,rows:[{Part:'A',Title:'Filter',Stock:'9'}]}),/idempotency/i);
    await assert.rejects(importInventory(db,owner,{source:'erp',key:'bad',mode:'replace',rows:[product('A',{quantity:9}),product('B',{quantity:-1})]}),/quantity/i);
    await assert.rejects(importInventory(db,owner,{source:'erp',key:'duplicate',mode:'replace',rows:[product('A'),product('A')]}),/duplicate/i);
    assert.equal((await listInventory(db,owner))[0].quantity,3);
    assert.equal((await db.all('SELECT * FROM imports')).length,1);
  }finally{db.close();}
});
test('snapshot replacement only changes its source and organization, preserving product identity',async()=>{
  const {db,owner}=await setup(); try{
    await importInventory(db,owner,{source:'erp',key:'first',mode:'replace',rows:[product('A'),product('B')]});
    const old=(await listInventory(db,owner)).find(p=>p.sku==='A')!;
    await importInventory(db,owner,{source:'warehouse',key:'first',mode:'replace',rows:[product('A')]});
    const invite=await provisionCompany(db,owner,'B','b@example.test'); await activateInvite(db,invite.token,password);
    const b=(await sessionPrincipal(db,(await signIn(db,'b@example.test',password)).token))!;
    await importInventory(db,b,{source:'erp',key:'first',mode:'replace',rows:[product('PRIVATE')]});
    await importInventory(db,owner,{source:'erp',key:'second',mode:'replace',rows:[product('A',{quantity:8})]});
    const rows=await listInventory(db,owner); assert.equal(rows.length,2);
    assert.equal(rows.find(p=>p.source==='erp')!.id,old.id);
    assert.equal(rows.find(p=>p.source==='erp')!.quantity,8);
    assert.equal((await listInventory(db,b))[0].sku,'PRIVATE');
    await assert.rejects(importInventory(db,owner,{source:'erp',key:'empty',mode:'replace',rows:[]}),/empty/i);
  }finally{db.close();}
});
test('eligibility excludes unavailable, inactive, stale and wrong-region inventory; unknown availability stays explicit',async()=>{
  const {db,owner}=await setup(); try{
    await importInventory(db,owner,{source:'erp',key:'first',mode:'replace',rows:[product('A'),product('ZERO',{quantity:0}),product('INACTIVE',{active:false}),product('REGION',{regions:['CA']}),product('UNKNOWN',{quantity:null})]});
    const rows=await listInventory(db,owner), opts={region:'US',maxAgeDays:30,now:Date.now()};
    assert.equal(eligibility(rows.find(p=>p.sku==='A')!,opts).eligible,true);
    assert.equal(eligibility(rows.find(p=>p.sku==='ZERO')!,opts).eligible,false);
    assert.equal(eligibility(rows.find(p=>p.sku==='INACTIVE')!,opts).eligible,false);
    assert.equal(eligibility(rows.find(p=>p.sku==='REGION')!,opts).eligible,false);
    assert.equal(eligibility({...rows[0],updatedAt:Date.now()-31*86400000},opts).eligible,false);
    assert.equal(eligibility(rows.find(p=>p.sku==='UNKNOWN')!,opts).availability,'unknown');
  }finally{db.close();}
});
test('inventory tokens are scoped, hashed, and immediately revocable',async()=>{
  const {db,owner}=await setup(); try{
    const token=await createInventoryToken(db,owner,'erp','Nightly sync');
    const integration=(await inventoryPrincipal(db,token.token))!;
    assert.equal(integration.companyId,owner.companyId);
    assert.equal(integration.role,'integration');
    assert(!(await db.all('SELECT * FROM integration_tokens')).some(r=>JSON.stringify(r).includes(token.token)));
    await assert.rejects(importInventory(db,integration,{source:'other',key:'bad',mode:'upsert',rows:[product('A')]}),/source/i);
    await importInventory(db,integration,{source:'erp',key:'good',mode:'upsert',rows:[product('A')]});
    await revokeInventoryToken(db,owner,token.id); assert.equal(await inventoryPrincipal(db,token.token),null);
  }finally{db.close();}
});
