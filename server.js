const express=require('express'),Database=require('better-sqlite3'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),
rate=require('express-rate-limit'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const D=path.join(__dirname,'data');fs.mkdirSync(D,{recursive:true});
const SECRET=process.env.JWT_SECRET||(()=>{const f=path.join(D,'.secret');if(!fs.existsSync(f))fs.writeFileSync(f,crypto.randomBytes(32).toString('hex'));return fs.readFileSync(f,'utf8')})();
const db=new Database(process.env.DB_PATH||path.join(D,'physio.db'));db.pragma('journal_mode=WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,hash TEXT,city TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS physios(id TEXT PRIMARY KEY,owner INTEGER,name TEXT,avatar TEXT,color TEXT,spec TEXT,rating REAL,dist REAL,price INTEGER,fee INTEGER,type TEXT,city TEXT,exp INTEGER,tags TEXT,bio TEXT);
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY,user_id INTEGER,physio_id TEXT,date TEXT,time TEXT,type TEXT,notes TEXT,status TEXT DEFAULT 'confirmed',created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS slot ON bookings(physio_id,date,time) WHERE status='confirmed';
CREATE TABLE IF NOT EXISTS pain(id INTEGER PRIMARY KEY,user_id INTEGER,day TEXT,v INTEGER);
CREATE TABLE IF NOT EXISTS favs(user_id INTEGER,physio_id TEXT,PRIMARY KEY(user_id,physio_id));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,name TEXT,email TEXT,msg TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);`);
if(!db.prepare('SELECT COUNT(*) c FROM physios').get().c){
  const ins=db.prepare('INSERT INTO physios(id,name,avatar,color,spec,rating,dist,price,fee,type,city,exp,tags,bio) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const p of require('./seed.json'))ins.run(p.id,p.name,p.avatar,p.color,p.spec,p.rating,p.dist,p.price,p.fee,JSON.stringify(p.type),p.city,p.exp,JSON.stringify(p.tags),p.bio);
}
if(!db.prepare("SELECT 1 FROM users WHERE email='demo@physioconnect.in'").get())
  db.prepare('INSERT INTO users(name,email,hash,city) VALUES(?,?,?,?)').run('Demo Patient','demo@physioconnect.in',bcrypt.hashSync('Demo@1234',10),'Delhi');

const app=express();app.use(express.json({limit:'20kb'}));app.disable('x-powered-by');
const wrap=f=>(q,s,n)=>Promise.resolve(f(q,s,n)).catch(e=>{console.error(e);s.status(500).json({error:'Server error'})});
const sign=u=>jwt.sign({id:u.id},SECRET,{expiresIn:'7d'});
const pub=u=>({id:u.id,name:u.name,email:u.email,city:u.city});
const auth=(q,s,n)=>{try{const t=(q.headers.authorization||'').replace('Bearer ','');q.uid=jwt.verify(t,SECRET).id;
  if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(q.uid))throw 0;n()}catch{s.status(401).json({error:'Please sign in.'})}};
const str=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
const physio=r=>({...r,owner:undefined,type:JSON.parse(r.type),tags:JSON.parse(r.tags)});
const email_ok=e=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

app.use('/api/auth',rate({windowMs:15*60e3,max:40,message:{error:'Too many attempts, try later.'}}));
app.get('/api/health',(q,s)=>s.json({ok:true}));
app.post('/api/auth/register',wrap((q,s)=>{
  const name=str(q.body.name,80),email=str(q.body.email,120).toLowerCase(),pw=String(q.body.password||''),city=str(q.body.city,60);
  if(!name||!email_ok(email))return s.status(400).json({error:'Enter a valid name and email.'});
  if(pw.length<6||pw.length>100)return s.status(400).json({error:'Password must be 6–100 characters.'});
  if(db.prepare('SELECT 1 FROM users WHERE email=?').get(email))return s.status(409).json({error:'Email already registered.'});
  const id=db.prepare('INSERT INTO users(name,email,hash,city) VALUES(?,?,?,?)').run(name,email,bcrypt.hashSync(pw,10),city).lastInsertRowid;
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(id);s.json({token:sign(u),user:pub(u)});}));
app.post('/api/auth/login',wrap((q,s)=>{
  const u=db.prepare('SELECT * FROM users WHERE email=?').get(str(q.body.email,120).toLowerCase());
  if(!u||!bcrypt.compareSync(String(q.body.password||''),u.hash))return s.status(401).json({error:'Invalid email or password.'});
  s.json({token:sign(u),user:pub(u)});}));
app.get('/api/me',auth,(q,s)=>s.json(pub(db.prepare('SELECT * FROM users WHERE id=?').get(q.uid))));

app.get('/api/physios',(q,s)=>s.json(db.prepare('SELECT * FROM physios').all().map(physio)));
app.post('/api/physios',auth,wrap((q,s)=>{
  const b=q.body,name=str(b.name,80),spec=str(b.spec,60),price=+b.price,exp=+b.exp;
  const type=(Array.isArray(b.type)?b.type:[]).filter(t=>['home','online'].includes(t)),tags=(Array.isArray(b.tags)?b.tags:[]).map(t=>str(t,20)).slice(0,8);
  if(!name||!spec||!type.length||!(price>=200&&price<=3000)||!(exp>=0&&exp<=40))return s.status(400).json({error:'Please check your profile details.'});
  const id='u'+Date.now(),fee=price>=800?100:price>=600?90:80,color=['#0A9688','#3949AB','#7E57C2','#EF6C00','#2E7D32'][Date.now()%5];
  db.prepare('INSERT INTO physios(id,owner,name,avatar,color,spec,rating,dist,price,fee,type,city,exp,tags,bio) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(id,q.uid,name,(name.replace(/^Dr\.?\s*/i,'')[0]||'P').toUpperCase(),color,spec,4.5,+(1+Math.random()*7).toFixed(1),price,fee,JSON.stringify(type),'Delhi',exp,JSON.stringify(tags),`New on PhysioConnect · ${exp} yrs experience in ${spec.toLowerCase()}.`);
  s.json(physio(db.prepare('SELECT * FROM physios WHERE id=?').get(id)));}));
app.get('/api/slots',(q,s)=>s.json(db.prepare("SELECT time FROM bookings WHERE physio_id=? AND date=? AND status='confirmed'").all(String(q.query.physioId),String(q.query.date)).map(r=>r.time)));

const bk=r=>({id:r.id,physioId:r.physio_id,physioName:r.pname,date:r.date,time:r.time,type:r.type,notes:r.notes,status:r.status});
app.get('/api/bookings',auth,(q,s)=>s.json(db.prepare('SELECT b.*,p.name pname FROM bookings b JOIN physios p ON p.id=b.physio_id WHERE b.user_id=? ORDER BY b.date DESC,b.time DESC').all(q.uid).map(bk)));
app.post('/api/bookings',auth,wrap((q,s)=>{
  const {physioId,date,time,type}=q.body,notes=str(q.body.notes,300),p=db.prepare('SELECT * FROM physios WHERE id=?').get(String(physioId));
  if(!p)return s.status(404).json({error:'Physiotherapist not found.'});
  if(!/^\d{4}-\d\d-\d\d$/.test(date||'')||date<new Date().toISOString().slice(0,10)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))return s.status(400).json({error:'Choose a valid future date and time.'});
  if(!['home_visit','online'].includes(type)||!JSON.parse(p.type).includes(type==='online'?'online':'home'))return s.status(400).json({error:'This physio does not offer that session type.'});
  try{const id=db.prepare('INSERT INTO bookings(user_id,physio_id,date,time,type,notes) VALUES(?,?,?,?,?,?)').run(q.uid,p.id,date,time,type,notes).lastInsertRowid;
    s.json(bk({...db.prepare('SELECT * FROM bookings WHERE id=?').get(id),pname:p.name}));}
  catch(e){if(String(e.code).startsWith('SQLITE_CONSTRAINT'))return s.status(409).json({error:'That slot was just taken. Please pick another time.'});throw e;}}));
app.delete('/api/bookings/:id',auth,(q,s)=>{
  const r=db.prepare("UPDATE bookings SET status='cancelled' WHERE id=? AND user_id=? AND status='confirmed'").run(+q.params.id,q.uid);
  r.changes?s.json({ok:true}):s.status(404).json({error:'Booking not found.'});});

app.get('/api/pain',auth,(q,s)=>s.json(db.prepare('SELECT day t,v FROM pain WHERE user_id=? ORDER BY id DESC LIMIT 14').all(q.uid).reverse()));
app.post('/api/pain',auth,(q,s)=>{const v=+q.body.v;if(!(v>=1&&v<=10))return s.status(400).json({error:'Pain must be 1–10.'});
  db.prepare('INSERT INTO pain(user_id,day,v) VALUES(?,?,?)').run(q.uid,new Date().toISOString().slice(0,10),Math.round(v));s.json({ok:true});});
app.get('/api/favs',auth,(q,s)=>s.json(db.prepare('SELECT physio_id FROM favs WHERE user_id=?').all(q.uid).map(r=>r.physio_id)));
app.post('/api/favs/:id',auth,(q,s)=>{const x=db.prepare('DELETE FROM favs WHERE user_id=? AND physio_id=?').run(q.uid,q.params.id);
  if(!x.changes)db.prepare('INSERT OR IGNORE INTO favs VALUES(?,?)').run(q.uid,q.params.id);s.json({ok:true});});
app.post('/api/contact',rate({windowMs:60e3,max:5}),(q,s)=>{const n=str(q.body.name,80),e=str(q.body.email,120),m=str(q.body.msg,2000);
  if(!n||!email_ok(e)||!m)return s.status(400).json({error:'Please complete the form.'});
  db.prepare('INSERT INTO messages(name,email,msg) VALUES(?,?,?)').run(n,e,m);s.json({ok:true});});

app.use(express.static(path.join(__dirname,'public')));
app.use('/api',(q,s)=>s.status(404).json({error:'Not found'}));
const port=process.env.PORT||3000;app.listen(port,()=>console.log('PhysioConnect running on http://localhost:'+port));
