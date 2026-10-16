const Database=require('better-sqlite3');const fs=require('fs');const path=require('path');
function open(file='./data/duck.sqlite'){
 fs.mkdirSync(path.dirname(file),{recursive:true});const db=new Database(file);db.pragma('journal_mode=WAL');
 db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'viewer',permissions TEXT NOT NULL DEFAULT '[]',enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS storage_accounts(id INTEGER PRIMARY KEY,name TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'official',base_url TEXT NOT NULL,credential_ref TEXT NOT NULL,quota_bytes INTEGER NOT NULL DEFAULT 5497558138880,used_bytes INTEGER NOT NULL DEFAULT 0,egress_bytes INTEGER NOT NULL DEFAULT 0,health TEXT NOT NULL DEFAULT 'unknown',enabled INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS media_objects(id INTEGER PRIMARY KEY,series TEXT,season INTEGER,episode INTEGER,logical_path TEXT UNIQUE,size_bytes INTEGER NOT NULL DEFAULT 0,hotness REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS replicas(id INTEGER PRIMARY KEY,object_id INTEGER NOT NULL,account_id INTEGER NOT NULL,remote_key TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'ready',is_primary INTEGER NOT NULL DEFAULT 0,access_count INTEGER NOT NULL DEFAULT 0,last_access_at TEXT,UNIQUE(object_id,account_id));
 CREATE TABLE IF NOT EXISTS quota_ledger(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL,period TEXT NOT NULL,ingress_bytes INTEGER NOT NULL DEFAULT 0,egress_bytes INTEGER NOT NULL DEFAULT 0,operation_id TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY,type TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',payload TEXT NOT NULL,progress REAL NOT NULL DEFAULT 0,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS route_cache(logical_path TEXT PRIMARY KEY,target_url TEXT NOT NULL,account_id INTEGER,expires_at INTEGER,hit_count INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,resource TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS emby_libraries(id TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS missing_episodes(id INTEGER PRIMARY KEY,library_id TEXT NOT NULL,provider TEXT NOT NULL,provider_episode_id TEXT NOT NULL,series TEXT NOT NULL,season INTEGER NOT NULL,episode INTEGER NOT NULL,title TEXT,air_date TEXT,status TEXT NOT NULL DEFAULT 'watching',last_scanned_at TEXT,source_url TEXT,UNIQUE(library_id,provider,provider_episode_id));
 CREATE TABLE IF NOT EXISTS telegram_channels(id TEXT PRIMARY KEY,title TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,interval_minutes INTEGER NOT NULL DEFAULT 30,last_scanned_at TEXT,next_scan_at TEXT,peer_id TEXT);
 CREATE TABLE IF NOT EXISTS monitor_tasks(id INTEGER PRIMARY KEY,type TEXT NOT NULL,target_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',scheduled_at TEXT,payload TEXT NOT NULL DEFAULT '{}',last_run_at TEXT,last_error TEXT,UNIQUE(type,target_id));
 CREATE TABLE IF NOT EXISTS notification_templates(id INTEGER PRIMARY KEY,name TEXT NOT NULL,event TEXT NOT NULL,template TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS seen_messages(channel_id TEXT NOT NULL,message_id TEXT NOT NULL,seen_at TEXT NOT NULL,PRIMARY KEY(channel_id,message_id));`);
 const add=(table,column,definition)=>{const cols=db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name);if(!cols.includes(column))db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+definition)};
 add('storage_accounts','credential_ref',"TEXT NOT NULL DEFAULT ''");add('media_objects','account_id','INTEGER');add('media_objects','remote_key','TEXT');add('media_objects','message_chat_id','TEXT');add('media_objects','message_id','TEXT');add('media_objects','metadata_json','TEXT');
 db.exec('CREATE INDEX IF NOT EXISTS idx_missing_status ON missing_episodes(status,library_id); CREATE INDEX IF NOT EXISTS idx_monitor_schedule ON monitor_tasks(state,scheduled_at); CREATE INDEX IF NOT EXISTS idx_jobs_type_state ON jobs(type,state);');return db;
}
module.exports={open};
