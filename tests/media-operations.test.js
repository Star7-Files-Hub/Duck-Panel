const test=require('node:test');
const assert=require('node:assert/strict');
const {open}=require('../src/db');
const {SubscriptionService}=require('../src/services/subscriptionService');
const {MediaOrganizer}=require('../src/services/mediaOrganizer');
const {RemasterService}=require('../src/services/remasterService');

test('subscription service marks one-click subscriptions and queues jobs',()=>{
  const db=open(':memory:'); const jobs=[]; const service=new SubscriptionService({db,queue:x=>jobs.push(x)});
  db.prepare('INSERT INTO missing_episodes(library_id,provider,provider_episode_id,series,season,episode) VALUES(?,?,?,?,?,?)').run('lib','tvmaze','ep-1','Demo',2,3);
  const row=db.prepare('SELECT * FROM missing_episodes').get(); const result=service.subscribe({...row,id:row.id});
  assert.equal(result.status,'subscribed'); assert.equal(db.prepare('SELECT status FROM missing_episodes WHERE id=?').get(row.id).status,'subscribed'); assert.equal(jobs.length,1);
});

test('organizer creates requested movie and season paths',()=>{
  const organizer=new MediaOrganizer();
  assert.equal(organizer.pathFor({type:'movie',title:'黑客帝国',year:1999,tmdbId:603,language:'zh'},'source.mkv'),'电影/华语电影/黑客帝国 (1999) {tmdb-603}/source.mkv');
  assert.equal(organizer.pathFor({type:'series',title:'庆余年',year:2024,tmdbId:213338,language:'zh',season:2,episode:3},'source.mkv'),'剧集/华语剧集/庆余年 (2024) {tmdb-213338}/Season 02/source.mkv');
});

test('remaster queues only better candidates and completes at target score',()=>{
  const jobs=[];const service=new RemasterService({queue:x=>jobs.push(x)});
  const plan=service.plan({objectId:1,current:'1080p WEB-DL H.264',candidates:['2160p HDR REMUX H.265']});
  assert.equal(plan.state,'queued'); assert.equal(jobs.length,1);
  assert.equal(service.completeIfOptimal({targetScore:plan.score},plan),'completed');
});
