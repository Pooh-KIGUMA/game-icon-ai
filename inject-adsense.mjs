import fs from 'node:fs';

const file = 'index.html';
const publisherId = 'ca-pub-3315416823173996';
const adScript = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}" crossorigin="anonymous"></script>`;

if (!fs.existsSync(file)) {
  throw new Error(`${file} not found`);
}

const html = fs.readFileSync(file, 'utf8');

if (html.includes('pagead2.googlesyndication.com/pagead/js/adsbygoogle.js')) {
  console.log('AdSense script already present; no change needed.');
  process.exit(0);
}

const headClose = html.indexOf('</head>');
if (headClose === -1) {
  throw new Error('Could not find </head> in index.html');
}

const updated = html.slice(0, headClose) + adScript + '\n' + html.slice(headClose);
fs.writeFileSync(file, updated, 'utf8');
console.log('AdSense script injected into index.html');
