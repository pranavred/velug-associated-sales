import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plantOverviews} from '../src/plant-overview.js';
const claim = {id:'R',statement:'Contractor reports chemical receiving and CIP rooms as part of the New Berlin expansion.',quote:'chemical receiving, CIP and mechanical and electrical rooms',source_id:'S',locator:'HTML text block 1',version:'v1',site_match:'locality_only',classification:'reported_fact',temporal_scope:'Undated historical project.'};
test('overview keeps traceability and historical caveats without inventing quantities',()=>{
 const [o]=plantOverviews([{plant:'P',profile:{claims:[claim]}}],[{id:'S',version:'v1'}]);
 assert.equal(o.sections.equipment.length,2);
 assert.equal(o.sections.equipment[0].quote,claim.quote);
 assert.equal(o.sections.equipment[0].temporal_scope,claim.temporal_scope);
 assert.equal(o.sections.changes.length,0);
 assert.equal(o.sections.products.length,0);
});
test('overview excludes unresolved attribution and flags changed documents',()=>{
 const rows=plantOverviews([{plant:'P',profile:{claims:[{...claim,site_match:'wrong_site'}]}}]);
 assert.equal(rows[0].sections.equipment.length,0);
 const [o]=plantOverviews([{plant:'P',profile:{claims:[claim]}}],[{id:'S',version:'v2'}]);
 assert.equal(o.sections.equipment[0].stale,true);
});
test('new agent equipment claims remain available without curated display rules',()=>{
 const [o]=plantOverviews([{plant:'NEW',profile:{claims:[{...claim,statement:'The document reports two cooling towers.'}]}}]);
 assert.equal(o.sections.equipment[0].label,'The document reports two cooling towers.');
});
