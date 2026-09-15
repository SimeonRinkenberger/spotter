import { writeFileSync, copyFileSync } from 'node:fs';
import sharp from '/Users/simeon/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.mjs';
const path='releases/android/store/';
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
<rect width="1024" height="500" fill="#17191b"/>
<circle cx="965" cy="475" r="390" fill="#202225"/>
<rect x="64" y="62" width="48" height="48" rx="13" fill="#f35b1c"/>
<g fill="#17191b"><rect x="76" y="75" width="5" height="22" rx="2"/><rect x="70" y="80" width="5" height="12" rx="2"/><rect x="95" y="75" width="5" height="22" rx="2"/><rect x="101" y="80" width="5" height="12" rx="2"/><rect x="81" y="83" width="14" height="6" rx="2"/></g>
<text x="128" y="98" font-family="Arial,sans-serif" font-size="38" font-weight="700" fill="#f7f6f2">Spotter</text>
<text x="64" y="217" font-family="Arial,sans-serif" font-size="57" font-weight="700" fill="#f7f6f2">Save the workout.</text>
<text x="64" y="287" font-family="Arial,sans-serif" font-size="57" font-weight="700" fill="#ff7c43">Make it happen.</text>
<text x="66" y="354" font-family="Arial,sans-serif" font-size="25" fill="#c4c6ca">Save videos. Log sets. See your progress.</text>
<g transform="translate(744 167) rotate(-15 90 80)" fill="#ff7c43"><rect x="15" y="16" width="32" height="128" rx="10"/><rect x="-12" y="46" width="24" height="68" rx="8"/><rect x="137" y="16" width="32" height="128" rx="10"/><rect x="172" y="46" width="24" height="68" rx="8"/><rect x="47" y="66" width="90" height="28" rx="5"/></g>
<rect x="64" y="422" width="64" height="5" rx="2" fill="#f35b1c"/>
</svg>`;
writeFileSync(path+'feature-graphic.svg',svg);
await sharp(Buffer.from(svg)).png().toFile(path+'feature-graphic.png');
copyFileSync('docs/icon.png',path+'icon.png');
console.log('Created 1024×500 feature graphic and copied 512×512 Spotter icon.');
