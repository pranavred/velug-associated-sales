import { fail } from './db.js';
/** RFC 4180-style CSV; bounded by the HTTP/import layer. No formula evaluation. */
export function parseCSV(input:string):Record<string,string>[] {
  const csv=input.replace(/^\uFEFF/,'');
  const rows:string[][]=[]; let row:string[]=[],field='',quoted=false,closed=false;
  const fieldEnd=()=>{row.push(field);field='';closed=false;};
  const rowEnd=()=>{fieldEnd();if(row.some(s=>s.length))rows.push(row);row=[];};
  for(let i=0;i<csv.length;i++) {
    const c=csv[i];
    if(quoted) {
      if(c==='"') { if(csv[i+1]==='"') {field+='"';i++;} else {quoted=false;closed=true;} }
      else field+=c;
    } else if(c==='"') { if(field||closed)fail(400,'Unexpected quote in CSV');quoted=true; }
    else if(c===',') fieldEnd();
    else if(c==='\n'||c==='\r') { if(c==='\r'&&csv[i+1]==='\n')i++;rowEnd(); }
    else { if(closed)fail(400,'Unexpected content after CSV quote');field+=c; }
  }
  if(quoted)fail(400,'Unterminated CSV quote');
  if(field||row.length||closed)rowEnd();
  if(!rows.length)fail(400,'Empty CSV');
  const headers=rows.shift()!.map(h=>h.trim());
  if(headers.some(h=>!h)||new Set(headers).size!==headers.length)fail(400,'CSV headers must be nonempty and unique');
  return rows.map((r,i)=>{
    if(r.length!==headers.length)fail(400,`CSV row ${i+2} has the wrong column count`);
    const result:Record<string,string>=Object.create(null);
    headers.forEach((h,n)=>{result[h]=r[n];}); return result;
  });
}
