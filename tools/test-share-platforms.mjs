import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
const source = fs.readFileSync('supabase/functions/spotter/index.ts','utf8');
const start = source.indexOf('function matchInstagram(');
const end = source.indexOf('// ---------- AI chain ----------', start);
let requested = [];
const ctx = vm.createContext({ URL, crypto, TextEncoder, console,
  DESKTOP_UA:'test',
  assertPublicUrl: async target => {
    const url = new URL(target);
    return {ok: !['127.0.0.1','localhost','169.254.169.254'].includes(url.hostname), url, reason:'test private address'};
  },
  fetch: async url => {
    requested.push(String(url));
    const locations = {
      'https://vm.tiktok.com/test/':'https://www.tiktok.com/@trainer/video/123456789',
      'https://fb.watch/test/':'https://www.facebook.com/reel/123456789',
      'https://pin.it/test':'https://www.pinterest.com/pin/123456789/',
      'https://redirect.example/private':'http://127.0.0.1/private'
    };
    return {headers:{get:()=>locations[String(url)] || null},body:{cancel:async()=>{}}};
  }
});
vm.runInContext(transformSync(source.slice(start,end),{loader:'ts',target:'es2022'}).code + '\nfunction matchUrl(u) { return matchInstagram(u) || matchTikTok(u) || matchYouTube(u); }',ctx);
const cases = [
 ['https://vm.tiktok.com/test/', 'tiktok'],
 ['https://www.tiktok.com/@trainer/photo/123456789','tiktok'],
 ['https://youtu.be/dQw4w9WgXcQ','youtube'],
 ['https://youtube.com/shorts/dQw4w9WgXcQ','youtube'],
 ['https://youtube.com/watch?v=dQw4w9WgXcQ&si=xyz','youtube'],
 ['https://instagram.com/reel/ABC123/','instagram'],
 ['https://fb.watch/test/','web'],
 ['https://www.facebook.com/trainer/videos/123456/','web'],
 ['https://www.facebook.com/share/r/ABC123/','web'],
 ['https://www.facebook.com/watch/?v=123456','web'],
 ['https://www.facebook.com/trainer/posts/123456/','web'],
 ['https://www.facebook.com/groups/123/permalink/456/','web'],
 ['https://www.facebook.com/photo.php?fbid=123','web'],
 ['https://pin.it/test','web'],
 ['https://x.com/trainer/status/123','web'],
 ['https://reddit.com/r/fitness/comments/abc/title','web'],
 ['https://www.threads.com/@trainer/post/123','web'],
 ['https://vimeo.com/123456','web'],
 ['https://www.snapchat.com/spotlight/123','web'],
 ['https://www.strava.com/activities/123','web']
];
for (const [url, platform] of cases) {
 ctx.raw = 'Try this workout! ' + url;
 const r = await vm.runInContext('resolveShare(raw)',ctx);
 assert.equal(r?.platform, platform, url);
}
for (const url of ['https://facebook.com/trainer','https://facebook.com/login','https://instagram.com/trainer','https://youtube.com/@trainer']) {
 ctx.raw=url; assert.equal(await vm.runInContext('resolveShare(raw)',ctx),null,url);
}
for (const url of ['http://127.0.0.1/private','https://redirect.example/private']) {
 ctx.raw=url; assert.equal(await vm.runInContext('resolveShare(raw).then(r=>r===BLOCKED)',ctx),true);
}
assert(!requested.some(url=>url.includes('127.0.0.1')));
console.log('PASS 20 platform/short-link routes, Facebook posts, profile rejection and redirect validation (mock network; not live extraction).');
