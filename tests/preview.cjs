// Isolated UI fixture. No Firebase, service worker, or real ledger storage.
// Run: node tests/preview.cjs, then open http://127.0.0.1:8765
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const fixture = `
    currentData = createDefaultLedgerData(); currentMonth = '2026-09';
    ensureMonth(currentMonth); ensureMonth('2026-08');
    currentData.months[currentMonth].income = [{item:'급여',amount:3000000}];
    currentData.months[currentMonth].variable = [
        {item:'점심',category:'식비',amount:12000}, {item:'점심',category:'식비',amount:8000},
        {item:'환불',category:'식비',amount:-3000}, {item:'택배',category:'',amount:5000}];
    currentData.months[currentMonth].common = [{item:'월세',category:'주거/통신',amount:500000}];
    currentData.months['2026-08'].variable = [{item:'점심',category:'식비',amount:10000}];
    currentData.assets = [{item:'예금',category:'은행',amount:5000000}];
    writeLocalLedgerBackup = () => {}; getOrCreateSyncClientId = () => 'preview';
    initCurrentView(false); setAppVisible(true);
    setAuthUi('local', null, '화면 검증용 예시 데이터 · 실제 가계부와 연결되지 않습니다.');
`;
http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
        .replace('const SYNC_CLIENT_ID = getOrCreateSyncClientId();', "const SYNC_CLIENT_ID = 'preview';")
        .replace(/setupPwa\(\);\s*bootApp\(\);/, fixture);
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(html);
}).listen(8765, '127.0.0.1', () => console.log('Isolated preview: http://127.0.0.1:8765'));
