import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { ASSOCIATED_SALES_URL, INVENTORY_TOKEN, INVENTORY_SOURCE='erp' }=process.env;
if(!ASSOCIATED_SALES_URL||!INVENTORY_TOKEN||!process.argv[2])throw Error('Set ASSOCIATED_SALES_URL and INVENTORY_TOKEN; pass a JSON file containing an array of inventory rows.');
const rows=JSON.parse(await readFile(process.argv[2],'utf8'));
if(!Array.isArray(rows)||!rows.length)throw Error('Expected a nonempty JSON array');
// Upserts support catalogs larger than one request. Send explicit active:false tombstones for removed items.
const batchId=process.env.SYNC_ID||new Date().toISOString();
for(let offset=0;offset<rows.length;offset+=500){
  const body={source:INVENTORY_SOURCE,mode:'upsert',rows:rows.slice(offset,offset+500),asOf:process.env.INVENTORY_AS_OF||batchId};
  const key=createHash('sha256').update(batchId+':'+offset+':'+JSON.stringify(body)).digest('hex');
  const response=await fetch(ASSOCIATED_SALES_URL.replace(/\/$/,'')+'/api/inventory/import',{method:'POST',headers:{Authorization:'Bearer '+INVENTORY_TOKEN,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('Inventory sync failed ('+response.status+'): '+await response.text());
  console.log(JSON.stringify(await response.json()));
}
