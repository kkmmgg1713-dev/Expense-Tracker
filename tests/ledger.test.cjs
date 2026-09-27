const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/setupPwa\(\);\s*bootApp\(\);/, '');
function app() {
    const elements = new Map(), storage = new Map(), alerts = [];
    const element = id => {
        if (!elements.has(id)) {
            const classes = new Set();
            elements.set(id, { value: '', innerHTML: '', innerText: '', textContent: '', style: {}, dataset: {},
                classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c),
                    toggle: (c, on = !classes.has(c)) => on ? classes.add(c) : classes.delete(c) },
                getContext: () => ({}), focus() {}, querySelector: () => null });
        }
        return elements.get(id);
    };
    const context = vm.createContext({ console, Blob, Event, Date, Map, Set,
        window: {}, navigator: {}, location: { protocol: 'http:', hostname: 'localhost' },
        document: { getElementById: element, querySelectorAll: () => [], querySelector: () => null, addEventListener() {} },
        localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
        setTimeout: () => 1, clearTimeout() {}, alert: text => alerts.push(text), confirm: () => true });
    vm.runInContext(source, context);
    const run = code => vm.runInContext(code, context);
    run("currentData = createDefaultLedgerData(); currentMonth = '2026-09'; ensureMonth(currentMonth);");
    return { context, run, element, alerts, json: code => JSON.parse(JSON.stringify(run(code))) };
}

test('monthly and yearly totals include uncategorized entries, refunds, and unbudgeted categories', () => {
    const a = app();
    a.run(`currentData.months['2026-09'].variable = [
        {item:'점심',category:'식비',amount:12000}, {item:'점심',category:'식비',amount:8000},
        {item:'환불',category:'식비',amount:-3000}, {item:'기타',category:'',amount:5000},
        {item:'이전 분류',category:'삭제된 분류',amount:2000}];
        ensureMonth('2026-08'); currentData.months['2026-08'].common = [{item:'월세',amount:500000}];
        ensureMonth('2025-09'); currentData.months['2025-09'].variable = [{amount:999}];`);
    assert.equal(a.run('getAmountSummary().total'), 24000);
    assert.equal(a.run("getAmountSummary('year').total"), 524000);
    assert.equal(a.run("getAmountSummary('month','expense','item').groups.find(g=>g.name==='점심').amount"), 20000);
    assert.equal(a.run('getAmountSummary().count'), 5);
});

test('income and assets are separate; assets are a current snapshot in either period', () => {
    const a = app();
    a.run("currentData.assets=[{item:'예금',amount:400}]; currentData.months[currentMonth].income=[{item:'급여',amount:200}];");
    assert.equal(a.run("getAmountSummary('month','income').total"), 200);
    assert.equal(a.run("getAmountSummary('year','assets').total"), 400);
    assert.equal(a.run('getAmountSummary().total'), 0);
});

test('special category names cannot break aggregation and report text is escaped', () => {
    const a = app();
    a.run(`currentData.budgets['2026'] = [{name:'hasOwnProperty',amount:100}, {name:'__proto__',amount:100}];
        currentData.months[currentMonth].variable = [{category:'hasOwnProperty',amount:30}, {category:'__proto__',amount:20}, {item:'<img src=x>',category:'<script>',amount:10}];
        renderChart('category');`);
    assert.equal(a.run("getSpentMap('2026')['__proto__']"), 20);
    assert.equal(a.run('getAmountSummary().total'), 60);
    assert.match(a.element('chartLegend').innerHTML, /&lt;img src=x&gt;/);
    assert.equal(a.element('chartCanvasWrap').style.display, 'none');
});

test('deleting a recurring row stays deleted for that month only', () => {
    const a = app();
    a.run("currentData.recurringRules=[{id:'rent',section:'common',item:'월세',amount:100,startMonth:'2026-09'}]; applyRecurringToMonth(currentMonth); deleteRow('common',0);");
    assert.equal(a.run('applyRecurringToMonth(currentMonth)'), 0);
    assert.equal(a.run("applyRecurringToMonth('2026-10')"), 1);
});

test('recurring rows generated on two devices merge once', () => {
    const a = app();
    a.run(`currentData.recurringRules=[{id:'rent',section:'common',item:'월세',amount:100}];
        const base=cloneData(currentData); applyRecurringToMonth(currentMonth); const local=cloneData(currentData);
        currentData=cloneData(base); applyRecurringToMonth(currentMonth);
        const merged=mergeLedgerData(base,local,currentData);`);
    assert.equal(a.run("merged.months[currentMonth].common.length"), 1);
});

test('empty month input and deleting the final budget preserve valid state', () => {
    const a = app();
    a.element('monthPicker').value = '';
    a.run("changeMonth(); currentData.budgets['2026']=[]; render();");
    assert.equal(a.run('currentMonth'), '2026-09');
    assert.equal(a.run("currentData.budgets['2026'].length"), 0);
    assert.equal(a.run("Object.hasOwn(currentData.months,'')"), false);
});

test('budget category names are unique and blank renames are rejected', () => {
    const a = app();
    a.run("currentData.budgets['2026']=[]; addCategory(); addCategory(); renameCategory(1,'새 카테고리'); renameCategory(0,'  ');");
    assert.deepEqual(a.json("currentData.budgets['2026'].map(b=>b.name)"), ['새 카테고리', '새 카테고리 2']);
    assert.equal(a.alerts.length, 2);
});

test('copying previous month excludes expired rules and generates independent row IDs', () => {
    const a = app();
    a.run(`ensureMonth('2026-08'); currentData.recurringRules=[{id:'expired',section:'common',item:'구독',amount:10,endMonth:'2026-08'}];
        currentData.months['2026-08'].common=[{id:'a',item:'구독',amount:10,recurringRuleId:'expired'}, {id:'b',item:'일반',amount:20}]; copyPrevMonth();`);
    assert.equal(a.run('currentData.months[currentMonth].common.length'), 1);
    assert.notEqual(a.run('currentData.months[currentMonth].common[0].id'), 'b');
    assert.equal(a.run("currentData.months['2026-08'].common.length"), 2);
});

test('different fields edited on two devices survive a merge', () => {
    const a = app();
    assert.deepEqual(a.json("mergeIdArray([{id:'a',amount:1,note:'old'}],[{id:'a',amount:2,note:'old'}],[{id:'a',amount:1,note:'new'}])"), [{id:'a',amount:2,note:'new'}]);
});

test('saving to the cloud preserves edits typed while the transaction is pending', async () => {
    const a = app();
    let complete;
    const pending = new Promise(resolve => { complete = resolve; });
    let remote;
    a.context.holdTransaction = pending;
    a.context.capture = data => { remote = structuredClone(data); };
    a.run(`currentData.months[currentMonth].variable=[{id:'a',item:'식사',amount:10,note:''}]; normalizeLedgerData();
        lastSyncedData=cloneData(currentData); cloudBooted=true; cloudSyncEnabled=true; currentUser={uid:'test'}; localDataDirty=true;
        firebaseServices={db:{},doc:()=>({}),serverTimestamp:()=>0,runTransaction:async(db,callback)=>{
            await callback({get:async()=>({exists:()=>true,data:()=>({data:lastSyncedData})}),set:(ref,payload)=>capture(payload.data)});
            await holdTransaction;
        }};
        currentData.months[currentMonth].variable[0].amount=20;`);
    const saving = a.run('saveCloudData()');
    await new Promise(resolve => setImmediate(resolve));
    a.run("currentData.months[currentMonth].variable[0].amount=30; currentData.months[currentMonth].variable.push({id:'b',item:'추가',amount:5});");
    complete(); await saving;
    assert.equal(remote.months['2026-09'].variable[0].amount, 20);
    assert.equal(a.run('currentData.months[currentMonth].variable[0].amount'), 30);
    assert.equal(a.run('currentData.months[currentMonth].variable.length'), 2);
    assert.equal(a.run('localDataDirty'), true);
    assert.equal(a.run('cloudSaveInFlight'), null);
});

test('invalid amounts are rejected instead of silently zeroing existing data', () => {
    const a = app();
    a.run("currentData.months[currentMonth].variable=[{id:'a',amount:20}]; updateData('variable',0,'amount','Infinity');");
    assert.equal(a.run('currentData.months[currentMonth].variable[0].amount'), 20);
    assert.equal(a.alerts.length, 1);
    assert.equal(a.run("normalizeRow({amount:'1,234'}).amount"), 1234);
});

test('typing names does not replace the input DOM before its next click', () => {
    const a = app();
    a.run("currentData.months[currentMonth].variable=[{id:'a',amount:20}]; renderSections();");
    a.element('tab-detail').innerHTML = 'preserve-active-editor';
    a.run("updateData('variable',0,'item','수정');");
    assert.equal(a.element('tab-detail').innerHTML, 'preserve-active-editor');
});

test('changing months refreshes an already open report', () => {
    const a = app();
    a.element('tab-chart').classList.add('active');
    a.run("currentChartType='category'; changeMonthByArrow(1);");
    assert.match(a.element('chartLegend').innerHTML, /2026년 10월/);
});

test('calculator rejects malformed decimal input when applying', () => {
    const a = app();
    a.run("activeInputRef={value:'123',dispatchEvent:()=>{throw Error('must not save')}}; calcExpr='1.2.3'; applyCalculator();");
    assert.equal(a.run('activeInputRef.value'), '123');
    assert.equal(a.run('calcExpr'), 'Error');
});

test('budget warnings distinguish zero-budget overspending, exhaustion, and refunds', () => {
    const a = app();
    a.run("currentData.budgets['2026']=[{name:'식비',amount:0}]; currentData.months[currentMonth].variable=[{category:'식비',amount:10}]; renderBudget();");
    assert.match(a.element('budgetBody').innerHTML, /초과/);
    a.run("currentData.budgets['2026'][0].amount=10; renderBudget();");
    assert.match(a.element('budgetBody').innerHTML, /소진/);
    assert.doesNotMatch(a.element('budgetBody').innerHTML, /초과/);
    a.run("currentData.months[currentMonth].variable[0].amount=-10; renderBudget();");
    assert.match(a.element('budgetBody').innerHTML, /width:0%/);
});

test('late completion from a previous login session cannot replace current data', async () => {
    const a = app();
    let complete;
    a.context.holdTransaction = new Promise(resolve => { complete = resolve; });
    a.run(`cloudBooted=true; cloudSyncEnabled=true; currentUser={uid:'first'}; localDataDirty=true;
        firebaseServices={db:{},doc:()=>({}),serverTimestamp:()=>0,runTransaction:async(db,callback)=>{
            await callback({get:async()=>({exists:()=>false}),set:()=>{}}); await holdTransaction;
        }};`);
    const saving = a.run('saveCloudData()');
    await new Promise(resolve => setImmediate(resolve));
    a.run("stopLedgerSync(); currentData.months[currentMonth].income=[{item:'다른 계정',amount:999}];");
    complete(); await saving;
    assert.equal(a.run('currentData.months[currentMonth].income[0].amount'), 999);
});
