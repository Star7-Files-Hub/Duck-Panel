'use strict';
function safe(v){return String(v||'').replace(/[\/:*?"<>|]/g,'').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'')}
function ext(v){const m=String(v||'').match(/(\.[^.]+)$/);return m?m[1]:''}
class MediaOrganizer{
  constructor(o={}){this.rules={movieRoot:'电影',seriesRoot:'剧集',languageMap:{zh:'华语',中文:'华语',en:'欧美',日语:'日本',韩语:'韩国'},...(o.rules||{})}}
  classify(m){const series=m.type==='series'||m.type==='tv';const l=m.language||m.originalLanguage||'en';const base=m.category||this.rules.languageMap[l]||'其他';return{type:series?'series':'movie',group:base.endsWith('电影')||base.endsWith('剧集')?base:base+(series?'剧集':'电影')}}
  pathFor(m,original){const c=this.classify(m),title=safe(m.title||m.name||'未命名'),y=m.year||m.releaseYear||'',tag=m.tmdbId?' {tmdb-'+m.tmdbId+'}':'',name=String(original||m.originalName||title),file=safe(name.replace(/\.[^.]+$/,''))+ext(name);if(c.type==='movie')return [this.rules.movieRoot,c.group,title+(y?' ('+y+')':'')+tag,file].join('/');return [this.rules.seriesRoot,c.group,title+(y?' ('+y+')':'')+tag,'Season '+String(m.season||1).padStart(2,'0'),file].join('/')}
  rename(m,original){const e=ext(original),base=safe(String(original||'').replace(/\.[^.]+$/,'')),ep=m.episode||m.indexNumber?' S'+String(m.season||1).padStart(2,'0')+'E'+String(m.episode||m.indexNumber).padStart(2,'0'):'';return safe((m.title||m.name||base)+ep)+e}
}
module.exports={MediaOrganizer,safe};
