import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'mag-waha-contacts-'));
process.env.SITE_DATA_DIR=directory;process.env.CRM_DISABLE_WORKER='1';
const db=await import('../src/lib/local-db.server.ts'),auth=await import('../src/lib/local-auth-core.server.ts'),crm=await import('../src/lib/crm.server.ts'),waha=await import('../src/lib/crm-waha.server.ts'),units=await import('../src/lib/units.server.ts');
const actor=async(email,roles)=>({id:(await auth.createUser(email,'QA-Strong-Password-123',roles)).id,email,roles,created_at:''});
const admin=await actor('admin@catalog.example.test',['admin']),seller=await actor('seller@catalog.example.test',['comercial']),other=await actor('other@catalog.example.test',['comercial']),dho=await actor('dho@catalog.example.test',['dho']);
const baseUrl='http://waha.catalog.test:3000',apiKey='CATALOG-PRIVATE-KEY',hmacKey='CATALOG-PRIVATE-HMAC';
const phones={catalog:'5585991110001',other:'5585991110002'};
waha.saveWahaSettings(admin,{revision:0,enabled:true,baseUrl,apiKey,hmacKey});
const line=await waha.saveWahaLine(admin,{userId:seller.id,expectedPhone:phones.catalog,session:'catalog'});
const otherLine=await waha.saveWahaLine(admin,{userId:other.id,expectedPhone:phones.other,session:'other'});
const unit=units.listUnitsPublic()[0];
db.getDb().prepare('INSERT INTO lead_distribution_consultants(user_id,unit_id) VALUES(?,?)').run(seller.id,unit.id);
const known=crm.createContact(seller,{name:'Nome cadastrado preservado',phone:'5585988887777',email:'cliente@catalog.example.test',city:''});
const otherKnown=crm.createContact(other,{name:'Outra carteira privada',phone:'5585988887777',email:'',city:''});
const registered='558588887777',lid='900000001@lid',unresolved='900000002@lid';
const chats=Array.from({length:250},(_,i)=>({id:`${5585992000000n+BigInt(i)}@s.whatsapp.net`,name:`Cliente ${String(i).padStart(3,'0')}`,conversationTimestamp:1700000000+i}));
chats.push({id:registered+'@s.whatsapp.net',name:'Núbia Oliveira',conversationTimestamp:1700000100},{id:phones.catalog+'@s.whatsapp.net',name:'Meu próprio número'},{id:'123456@g.us',name:'Grupo privado'},{id:'status@broadcast',name:'Status'},{id:'12345@newsletter',name:'Canal'},{id:'5585998610074@s.whatsapp.net',name:'Número oficial protegido'},{id:lid,name:'Pessoa com LID'},{id:unresolved,name:'Pessoa sem telefone confirmado'});
chats.sort((a,b)=>a.id.localeCompare(b.id));
const contactNames=new Map(chats.map(c=>[c.id.replace(/@s\.whatsapp\.net$/,'@c.us'),c.name]));
let lidPhone='5585993334444',override=null,state='WORKING';
const calls=[],originalFetch=globalThis.fetch;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(url,options={})=>{
 const u=new URL(String(url));u.pathname=decodeURIComponent(u.pathname);assert.equal(u.origin,baseUrl);assert.equal(options.headers['X-Api-Key'],apiKey);assert.equal(options.method||'GET','GET','catalog/import must not send, read-mark or alter the WhatsApp account');
 calls.push({path:u.pathname,query:u.search});
 if(override){const response=await override(u,options);if(response)return response;}
 const session=u.pathname.startsWith('/api/sessions/')?u.pathname.split('/')[3]:u.pathname.split('/')[2];
 if(u.pathname===`/api/sessions/${session}`)return json({status:state,me:{id:phones[session]+'@c.us'}});
 if(u.pathname===`/api/${session}/chats`){assert.equal(u.searchParams.get('sortBy'),'id');assert.equal(u.searchParams.get('sortOrder'),'asc');const offset=Number(u.searchParams.get('offset'));const limit=Number(u.searchParams.get('limit'));return json(chats.slice(offset,offset+limit));}
 if(u.pathname===`/api/${session}/chats/overview`){const id=u.searchParams.get('ids');const c=chats.find(c=>c.id.replace(/@s\.whatsapp\.net$/,'@c.us')===id);return json(c?[{id,name:c.name,lastMessage:{body:'Must never reach the frontend'},picture:'https://private-provider.invalid/picture?token=private'}]:[]);}
 if(u.pathname===`/api/${session}/lids/${lid}`)return json({lid,pn:lidPhone+'@c.us'});
 if(u.pathname===`/api/${session}/lids/${unresolved}`)return json({error:'not_found'},404);
 if(u.pathname==='/api/contacts')return json({name:contactNames.get(u.searchParams.get('contactId'))||null});
 throw Error('Unexpected connector path '+u.pathname);
};
const count=table=>Number(db.getDb().prepare(`SELECT count(*) n FROM ${table}`).get().n);
const stateCounts=()=>Object.fromEntries(['crm_contacts','crm_opportunities','crm_messages','crm_tasks','crm_waha_events','crm_waha_outbox'].map(t=>[t,count(t)]));
const catalog=async input=>waha.readWahaContactCatalog(seller,input);
const allPages=async(search='')=>{let before;const items=[];for(let n=0;n<20;n++){const page=await catalog({search,limit:50,...(before?{before}:{})});items.push(...page.items);if(!page.hasMore)return items;assert.ok(page.nextCursor);before=page.nextCursor;}throw Error('Pagination did not finish');};
test.after(async()=>{globalThis.fetch=originalFetch;db.closeDb();await rm(directory,{recursive:true,force:true,maxRetries:5});});
let first,knownItem,newItem,lidItem;
test('catalog is read-only, reaches all 250+ chats with explicit continuation and returns metadata only',async()=>{
 const before=stateCounts();first=await catalog({limit:50});assert.equal(first.items.length,50);assert.equal(first.hasMore,true);assert.equal(first.searchScope,'loaded-window');assert.ok(first.nextCursor);
 const items=await allPages();assert.equal(items.filter(i=>i.name.startsWith('Cliente ')).length,250);assert.ok(items.every(i=>!i.chatId.includes('g.us')&&!i.chatId.includes('broadcast')&&!i.chatId.includes('newsletter')));assert.ok(!items.some(i=>i.phone===phones.catalog||i.name.includes('protegido')));
 assert.deepEqual(stateCounts(),before,'reading a remote catalog cannot create leads, unread records or messages');
 const payload=JSON.stringify(items);assert.ok(!payload.includes(apiKey)&&!payload.includes(hmacKey)&&!payload.includes('private-provider')&&!payload.includes('Must never reach'));
 knownItem=items.find(i=>i.name==='Núbia Oliveira');assert.equal(knownItem.contactId,known.id);assert.equal(knownItem.phone,'5585988887777');
 newItem=items.find(i=>i.name==='Cliente 200');lidItem=items.find(i=>i.chatId===lid);assert.ok(newItem.selectionToken&&lidItem.selectionToken);
 const unknown=items.find(i=>i.chatId===unresolved);assert.equal(unknown.phone,null);assert.equal(unknown.canImport,false);assert.equal(unknown.selectionToken,null);
});
test('search ignores accents/order and can continue across a bounded catalog window',async()=>{
 assert.equal((await allPages('oliveira nubia'))[0].chatId,knownItem.chatId);
 assert.equal((await allPages('(85) 98888-7777'))[0].contactId,known.id);
 const page=await catalog({search:'cliente 249',limit:50});assert.equal(page.scanned,200);assert.equal(page.items.length,0);assert.equal(page.hasMore,true);
 const next=await catalog({search:'cliente 249',limit:50,before:page.nextCursor});assert.equal(next.items[0].name,'Cliente 249');
});
test('cursor and selection proofs are bound to actor, line, query and limit',async()=>{
 const before=count('crm_contacts');
 await assert.rejects(catalog({limit:20,before:first.nextCursor}),/mudou|expirou/);
 await assert.rejects(catalog({search:'outro',limit:50,before:first.nextCursor}),/mudou|expirou/);
 await assert.rejects(waha.readWahaContactCatalog(other,{limit:50,before:first.nextCursor}),/mudou|expirou/);
 await assert.rejects(waha.importWahaContact(other,{chatId:newItem.chatId,selectionToken:newItem.selectionToken}),/mudou|expirou/);
 await assert.rejects(waha.importWahaContact(seller,{chatId:knownItem.chatId,selectionToken:newItem.selectionToken}),/mudou|expirou/);
 await assert.rejects(waha.importWahaContact(seller,{chatId:newItem.chatId,selectionToken:newItem.selectionToken+'a'}),/inválida|expirou/);
 assert.equal(count('crm_contacts'),before);
});
test('explicit import creates only the chosen contact, preserves owner/unit and is idempotent',async()=>{
 const before=stateCounts();const saved=await waha.importWahaContact(seller,{chatId:newItem.chatId,selectionToken:newItem.selectionToken});assert.equal(saved.created,true);
 const contact=crm.requireCrmContact(seller,saved.contactId);assert.equal(contact.ownerId,seller.id);assert.equal(contact.unitId,unit.id);assert.equal(contact.name,'Cliente 200');
 const repeated=await waha.importWahaContact(seller,{chatId:newItem.chatId,selectionToken:newItem.selectionToken});assert.deepEqual(repeated,{contactId:saved.contactId,created:false});
 const after=stateCounts();assert.equal(after.crm_contacts,before.crm_contacts+1);for(const table of Object.keys(before).filter(t=>t!=='crm_contacts'))assert.equal(after[table],before[table]);
 assert.equal(crm.getCrmBootstrap(seller).counts.unread,0);
});
test('Brazilian phone aliases reuse the seller own contact without rewriting its name or another portfolio',async()=>{
 const before=count('crm_contacts');const saved=await waha.importWahaContact(seller,{chatId:knownItem.chatId,selectionToken:knownItem.selectionToken});assert.deepEqual(saved,{contactId:known.id,created:false});assert.equal(count('crm_contacts'),before);
 assert.equal(crm.requireCrmContact(seller,known.id).name,'Nome cadastrado preservado');assert.equal(crm.requireCrmContact(other,otherKnown.id).name,'Outra carteira privada');
});
test('LID must resolve to a confirmed phone and a changed identity is rejected before creation',async()=>{
 const before=count('crm_contacts');lidPhone='5585993335555';
 await assert.rejects(waha.importWahaContact(seller,{chatId:lidItem.chatId,selectionToken:lidItem.selectionToken}),/telefone.*mudou|confirmado/i);assert.equal(count('crm_contacts'),before);
 lidPhone='5585993334444';const saved=await waha.importWahaContact(seller,{chatId:lidItem.chatId,selectionToken:lidItem.selectionToken});assert.equal(crm.requireCrmContact(seller,saved.contactId).phone,lidPhone);
});
test('fresh roles, line ownership, multiple-line supervision and connection state are enforced',async()=>{
 await assert.rejects(waha.readWahaContactCatalog(dho),/Forbidden/);
 await assert.rejects(waha.readWahaContactCatalog({...dho,roles:['admin']}),/Forbidden/);
 await assert.rejects(waha.readWahaContactCatalog(other,{lineId:line.id}),/Forbidden/);
 await assert.rejects(waha.readWahaContactCatalog(admin),/Escolha a linha/);
 const page=await waha.readWahaContactCatalog(admin,{lineId:otherLine.id,search:'nubia oliveira'});assert.equal(page.items[0].contactId,otherKnown.id);
 state='STOPPED';await assert.rejects(catalog(),/conect|desconect|retomar/i);state='WORKING';
});
test('expiry, provider removal and concurrent line deactivation leave the CRM unchanged',async()=>{
 const before=stateCounts();const now=Date.now;
 try{Date.now=()=>now()+16*60_000;await assert.rejects(waha.importWahaContact(seller,{chatId:newItem.chatId,selectionToken:newItem.selectionToken}),/expirou/);}finally{Date.now=now;}
 override=async u=>u.pathname.endsWith('/chats/overview')?json([]):null;
 await assert.rejects(waha.importWahaContact(seller,{chatId:newItem.chatId,selectionToken:newItem.selectionToken}),/não está mais disponível/);
 override=async u=>{if(u.pathname.endsWith('/chats/overview'))db.getDb().prepare("UPDATE crm_waha_lines SET status='disabled',revision=revision+1 WHERE id=?").run(line.id);return null;};
 try{await assert.rejects(waha.importWahaContact(seller,{chatId:newItem.chatId,selectionToken:newItem.selectionToken}),/configuração da linha mudou/);}finally{override=null;db.getDb().prepare("UPDATE crm_waha_lines SET status='active',revision=revision+1 WHERE id=?").run(line.id);}
 assert.deepEqual(stateCounts(),before);
});
test('revoking an administrator during a provider request blocks even an existing-contact import',async()=>{
 const selected=(await waha.readWahaContactCatalog(admin,{lineId:line.id,search:'nubia oliveira'})).items[0];
 const before=stateCounts();
 override=async u=>{if(u.pathname.endsWith('/chats/overview'))db.getDb().prepare('UPDATE users SET roles=? WHERE id=?').run(JSON.stringify(['dho']),admin.id);return null;};
 try{await assert.rejects(waha.importWahaContact(admin,{lineId:line.id,chatId:selected.chatId,selectionToken:selected.selectionToken}),/Forbidden/);}finally{override=null;db.getDb().prepare('UPDATE users SET roles=? WHERE id=?').run(JSON.stringify(['admin']),admin.id);}
 assert.deepEqual(stateCounts(),before);
});
test('a previously unresolved or conflicting WhatsApp binding never becomes a second contact on import',async()=>{
 const {ensureWhatsAppStoreSchema}=await import('../src/lib/crm-whatsapp-store.server.ts');ensureWhatsAppStoreSchema();
 const selected=(await catalog({search:'cliente 201'})).items[0];
 const unresolvedContact=crm.createContact(seller,{name:'Identificação antiga',phone:'',email:'',city:''});
 db.getDb().prepare('INSERT INTO crm_whatsapp_bindings(id,session,chat_id,owner_id,contact_id,phone,triage_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('catalog-pending-binding','catalog',selected.chatId,seller.id,unresolvedContact.id,'','unresolved_identity',new Date().toISOString(),new Date().toISOString());
 db.getDb().prepare('INSERT INTO crm_whatsapp_identities(session,address,binding_id) VALUES(?,?,?)').run('catalog',selected.chatId,'catalog-pending-binding');
 const before=stateCounts();
 const listed=(await catalog({search:'cliente 201'})).items[0];assert.equal(listed.canImport,false);assert.equal(listed.contactId,null);assert.match(listed.unavailableReason,/identificação pendente|conflitante/);
 await assert.rejects(waha.importWahaContact(seller,{chatId:selected.chatId,selectionToken:selected.selectionToken}),/identificação pendente|conflitante/);
 assert.deepEqual(stateCounts(),before);
});
