const {fetch}=require('undici');
class EmbyStats{constructor(cfg){this.cfg=cfg||{}}
 async get(){const base=String(this.cfg.baseUrl||'').replace(/\/$/,'');if(!base||!this.cfg.apiKey)return {online:false,users:0,items:0,sessions:0};const headers={'X-Emby-Token':this.cfg.apiKey};const [users,items,sessions]=await Promise.all([fetch(base+'/Users',{headers}),fetch(base+'/Items?Recursive=true&IncludeItemTypes=Movie,Series,Episode&Limit=0',{headers}),fetch(base+'/Sessions',{headers})]);if(!users.ok||!items.ok||!sessions.ok)throw new Error('Emby stats request failed');const u=await users.json(),i=await items.json(),s=await sessions.json();return {online:true,users:Array.isArray(u)?u.length:0,items:Number(i.TotalRecordCount||0),sessions:Array.isArray(s)?s.filter(x=>x.NowPlayingItem).length:0}}
}
module.exports={EmbyStats};
