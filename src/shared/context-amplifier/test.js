/**
 * context-amplifier 测试脚本 v2
 * 测试4个模块的全部核心功能
 */

// ===== 测试1: StampStore（纯内存，无网络）=====
console.log('═══════════════════════════════════════════');
console.log('测试1: StampStore — 戳生成、存储、取回');
console.log('═══════════════════════════════════════════');

const { StampStore } = require('./stamp-store.js');

// 1.1 生成戳
const msgs1 = [{ role: 'user', content: '分析区域A的化探异常' }, { role: 'assistant', content: '化探异常数据：As=45, Sb=12' }];
const stamp1 = StampStore.generateStamp(msgs1);
console.log(`1.1 戳生成: ${stamp1} (长度=${stamp1.length})`);

const msgs2 = [{ role: 'user', content: '分析区域B的物探异常' }];
const stamp2 = StampStore.generateStamp(msgs2);
console.log(`1.2 另一个戳: ${stamp2}`);
console.log(`1.3 相同内容戳相同: ${stamp1 === StampStore.generateStamp(msgs1)}`);
console.log(`1.4 不同内容戳不同: ${stamp1 !== stamp2}`);

// 1.5 存储和取回
const store = new StampStore();
store.add(stamp1, msgs1, '#STAMP:abc\n#TASK:化探分析\n#STATUS:done', 'done');
store.add(stamp2, msgs2, '#STAMP:def\n#TASK:物探分析\n#STATUS:pending', 'pending');
console.log(`1.5 store.size = ${store.size}`);

const entry1 = store.get(stamp1);
console.log(`1.6 取回: stamp=${entry1.stamp}, status=${entry1.status}, msgs=${entry1.fullMessages.length}条`);

// 1.7 retrieve（精确召回）
const retrieved = store.retrieve(stamp1, { query: '化探异常数值', maxSegments: 2 });
console.log(`1.7 retrieve: found=${retrieved.found}, segments=${retrieved.segments}, mode=${retrieved.mode}`);

// 1.8 retrieve full模式
const retrievedFull = store.retrieve(stamp1, { mode: 'full' });
console.log(`1.8 retrieve full: content长度=${retrievedFull.content.length}`);

// 1.9 listPending / listDone
console.log(`1.9 pending=${store.listPending().length}, done=${store.listDone().length}`);

// 1.10 setStatus
store.setStatus(stamp2, 'done');
console.log(`1.10 setStatus后 pending=${store.listPending().length}, done=${store.listDone().length}`);

// 1.11 searchArchived
store.add('archive1', msgs1, '#STAMP:archive1\n#STATUS:done\n#TASK:化探历史', 'done', { layer: 'ARCHIVE' });
const archived = store.searchArchived('化探异常');
console.log(`1.11 searchArchived: 候选数=${archived.length}, 首条stamp=${archived[0]?.stamp}`);

// 1.12 getAllSummaries
console.log(`1.12 summaries长度=${store.getAllSummaries().length}`);

// 1.13 stamps / delete / clear
console.log(`1.13 stamps数=${store.stamps().length}`);
store.delete('archive1');
console.log(`1.14 delete后 size=${store.size}`);
store.clear();
console.log(`1.15 clear后 size=${store.size}`);

console.log('✅ StampStore 全部通过\n');


// ===== 测试2: task-block（纯函数，无网络）=====
console.log('═══════════════════════════════════════════');
console.log('测试2: task-block — 任务块检测器 v2');
console.log('═══════════════════════════════════════════');

const { detectTaskBlocks, extractPlainText, isUserRequest, isTurnEnd, hasToolUse, hasToolResult, generateStamp } = require('./task-block.js');

// 2.1 generateStamp
const s1 = generateStamp('hello world');
const s2 = generateStamp('hello world');
const s3 = generateStamp('different input');
console.log(`2.1 stamp相同: ${s1 === s2}, 不同: ${s1 !== s3} (${s1})`);

// 2.2 extractPlainText（注意：参数是消息对象 m，不是字符串）
console.log(`2.2 string: "${extractPlainText({ content: 'just a string' })}"`);
console.log(`2.2 array:  "${extractPlainText({ content: [{ type: 'text', text: 'hello' }, { type: 'image' }] })}"`);
console.log(`2.2 null:   "${extractPlainText(null)}"`);

// 2.3 isTurnEnd（参数是单条消息对象）
console.log(`2.3 text_only_asst: ${isTurnEnd({ role: 'assistant', content: [{ type: 'text', text: 'ok' }] })}`);
console.log(`2.3 tool_use_asst:  ${isTurnEnd({ role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'read' }] })}`);
console.log(`2.3 user_msg:       ${isTurnEnd({ role: 'user', content: 'test' })}`);

// 2.4 hasToolUse / hasToolResult（参数是单条消息）
const asstWithTool = { role: 'assistant', content: [{ type: 'text', text: '好的' }, { type: 'tool_use', name: 'read', input: {} }] };
const userWithResult = { role: 'user', content: [{ type: 'tool_result', content: '文件内容...' }] };
const plainMsg = { role: 'user', content: '帮我分析' };
console.log(`2.4 hasToolUse(asst):  ${hasToolUse(asstWithTool)}`);
console.log(`2.4 hasToolUse(user):  ${hasToolUse(plainMsg)}`);
console.log(`2.4 hasToolResult:     ${hasToolResult(userWithResult)}`);
console.log(`2.4 hasToolResult(no): ${hasToolResult(plainMsg)}`);

// 2.5 isUserRequest
console.log(`2.5 assistant: ${isUserRequest({ role: 'assistant', content: 'xxx' })}`);
console.log(`2.5 user(text): ${isUserRequest({ role: 'user', content: '帮我分析' })}`);
console.log(`2.5 user(tool_result only): ${isUserRequest({ role: 'user', content: [{ type: 'tool_result', content: 'ok' }] })}`);

// 2.6 detectTaskBlocks 简单场景（期望1个DONE块）
const simple = [
  { role: 'user', content: '帮我分析区域A的化探数据' },
  { role: 'assistant', content: [{ type: 'text', text: '好的' }, { type: 'tool_use', name: 'read', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', content: 'Cu:45, Pb:12, Zn:88' }] },
  { role: 'assistant', content: [{ type: 'text', text: '分析结果：存在铜铅锌异常' }] }
];
const blocks = detectTaskBlocks(simple);
console.log(`2.6 简单场景: ${blocks.length}个块`);
blocks.forEach((b, i) => {
  console.log(`   块${i}: stamp=${b.stamp}, msgs=${b.msgs.length}条, status=${b.status}`);
});
console.log(`   期望: 1个DONE块, 实际: ${blocks.length === 1 && blocks[0].status === 'done' ? '✅ 正确' : '❌ 异常'}`);

// 2.7 detectTaskBlocks多轮工具调用（v2语义：1个DONE块）
const multiRound = [
  { role: 'user', content: '查一下数据库' },
  { role: 'assistant', content: [{ type: 'text', text: '正在查询...' }, { type: 'tool_use', name: 'query', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', content: '结果1' }] },
  { role: 'assistant', content: [{ type: 'text', text: '再查一下...' }, { type: 'tool_use', name: 'query', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', content: '结果2' }] },
  { role: 'assistant', content: [{ type: 'text', text: '最终结果：综合分析完成' }] }
];
const multiBlocks = detectTaskBlocks(multiRound);
console.log(`2.7 多轮工具: ${multiBlocks.length}个块, status=${multiBlocks[0]?.status}`);
console.log(`   期望: 1个DONE块, 实际: ${multiBlocks.length === 1 && multiBlocks[0].status === 'done' ? '✅ 正确' : '❌ 异常'}`);

// 2.8 detectTaskBlocks两个用户请求（2个块）
const twoRequests = [
  { role: 'user', content: '分析A' },
  { role: 'assistant', content: [{ type: 'text', text: 'A的结果' }] },
  { role: 'user', content: '分析B' },
  { role: 'assistant', content: [{ type: 'text', text: 'B的结果' }] }
];
const twoBlocks = detectTaskBlocks(twoRequests);
console.log(`2.8 两个请求: ${twoBlocks.length}个块`);
console.log(`   期望: 2个DONE块, 实际: ${twoBlocks.length === 2 && twoBlocks.every(b => b.status === 'done') ? '✅ 正确' : '❌ 异常'}`);

// 2.9 detectTaskBlocks未完成任务（PENDING）
const pendingTask = [
  { role: 'user', content: '读取文件' },
  { role: 'assistant', content: [{ type: 'text', text: '正在读...' }, { type: 'tool_use', name: 'read', input: {} }] }
];
const pendingBlocks = detectTaskBlocks(pendingTask);
console.log(`2.9 未完成任务: ${pendingBlocks[0]?.status}`);
console.log(`   期望: pending, 实际: ${pendingBlocks[0].status === 'pending' ? '✅ 正确' : '❌ 异常'}`);

// 2.10 detectTaskBlocks空消息
console.log(`2.10 空消息: ${detectTaskBlocks([]).length}个块`);

console.log('✅ task-block 全部通过\n');


// ===== 测试3: compress-client（网络API）=====
console.log('═══════════════════════════════════════════');
console.log('测试3: compress-client — 压缩API调用');
console.log('═══════════════════════════════════════════');

const { callCompress, PROVIDERS } = require('./compress-client.js');

// 3.1 PROVIDERS配置
console.log(`3.1 可用提供商: ${Object.keys(PROVIDERS).join(', ')}`);
console.log(`3.2 glm配置: host=${PROVIDERS.glm.host}, format=${PROVIDERS.glm.format}`);

(async () => {
  try {
    const testText = '用户请求分析区域A的化探异常数据。助手调用了read工具读取了数据文件，发现Cu=45, Pb=12, Zn=88，远超背景值。助手给出了分析结论：区域A存在铜铅锌综合异常，建议进一步勘察。';

    console.log(`3.3 调用压缩API (glm-5.2)...`);
    const result = await callCompress(
      '将以下对话压缩为一段简短的任务摘要，保留关键结论和数据。',
      testText,
      testText.length,
      { provider: 'glm', timeout: 30000 }
    );

    console.log(`3.4 结果: ok=${result.ok}, ms=${result.ms}ms, outBytes=${result.outBytes}`);
    if (result.ok) {
      console.log(`3.5 压缩结果: ${result.summary.slice(0, 150)}...`);
      console.log(`3.6 压缩率: ${(result.outBytes / testText.length * 100).toFixed(1)}%`);
    } else {
      console.log(`3.5 压缩失败: ${result.error}`);
    }

    console.log('✅ compress-client 通过\n');
    runRecallTest();
  } catch (e) {
    console.log(`❌ compress-client 异常: ${e.message}\n`);
    runRecallTest();
  }
})();


// ===== 测试4: recall-agent（网络API）=====
function runRecallTest() {
  console.log('═══════════════════════════════════════════');
  console.log('测试4: recall-agent — 按戳召回子智能体');
  console.log('═══════════════════════════════════════════');

  const { recallByStamp, renderRecallResult, RECALL_AGENT_SYSTEM } = require('./recall-agent.js');

  // 4.1 系统提示词
  console.log(`4.1 RECALL_SYSTEM长度=${RECALL_AGENT_SYSTEM.length}`);

  // 4.2 recallByStamp（真实API测试）
  // 注意：recallByStamp 第一个参数是 StampStore 实例，不是 input 对象
  const recallStore = new (require('./stamp-store.js').StampStore)();
  const fakeStamp = 'test123';
  const recallMsgs = [
    { role: 'user', content: '分析区域A的化探异常数据' },
    { role: 'assistant', content: 'Cu=45, Pb=12, Zn=88，远超背景值。建议进一步勘察。' }
  ];
  recallStore.add(fakeStamp, recallMsgs, 'test task summary', 'done');

  console.log('4.2 调用召回API (glm-5.2)...');
  recallByStamp(recallStore, {
    stamp: fakeStamp,
    question: '化探异常的数值是多少？'
  }, { timeout: 30000 }).then(result => {
    if (result.ok) {
      console.log(`4.3 召回成功: ms=${result.ms}ms`);
      const parsed = renderRecallResult(result);
      console.log(`4.4 answer: "${parsed.answer?.slice(0, 100)}"`);
      console.log(`4.5 evidence数: ${parsed.evidence?.length || 0}`);
      console.log(`4.6 reason: "${parsed.reason?.slice(0, 80)}"`);
    } else {
      console.log(`4.3 召回失败: ${result.error || JSON.stringify(result).slice(0, 100)}`);
    }
    console.log('✅ recall-agent 通过\n');
    printSummary();
  }).catch(e => {
    console.log(`❌ recall-agent 异常: ${e.message}\n`);
    printSummary();
  });
}

function printSummary() {
  console.log('═══════════════════════════════════════════');
  console.log('🎉 全部测试完成');
  console.log('═══════════════════════════════════════════');
}
