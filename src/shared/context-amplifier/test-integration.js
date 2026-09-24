/**
 * 集成测试：验证四层分级 + 归档 + 召回边界
 *
 * 只测试不需要网络的部分：分层、归档、StampStore 存储、召回的作用域校验。
 * 不传 compressBlock，因此不会调用压缩 API——分层逻辑本身与压缩无关。
 *
 * 运行：node test-integration.js   （需 Node 22.x，与项目 engines 一致）
 */

const path = require('path')

// pipeline.ts 是 TypeScript，此脚本直接测底层 JS 模块 + 复刻分层判定，
// 避免为一个测试引入 ts 运行时依赖。
const { StampStore } = require('./stamp-store.js')
const { detectTaskBlocks, isUserRequest } = require('./task-block.js')
const { recallByStamp } = require('./recall-agent.js')

const L0_ROUNDS = 2
const L1 = 200 * 1024
const L2 = 384 * 1024
const L3 = 712 * 1024

function mkMsg(role, sizeKB, index) {
  const padding = 'x'.repeat(Math.max(0, sizeKB * 1024 - 120))
  return {
    role,
    content: [
      { type: 'text', text: `Message ${index} (${sizeKB}KB) ${padding}` },
    ],
  }
}

function bytesOf(msgs) {
  return Buffer.byteLength(
    msgs.map((m) => JSON.stringify(m.content)).join('\n'),
    'utf8'
  )
}

/** 复刻 pipeline.ts 的 classifyBlocks 分层判定 */
function classify(blocks) {
  let cumulative = 0
  let rounds = 0
  const out = []
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    const bytes = bytesOf(b.msgs)
    cumulative += bytes
    let layer
    if (rounds < L0_ROUNDS) {
      layer = 'L0'
      rounds++
    } else if (cumulative <= L1) layer = 'L1'
    else if (cumulative <= L2) layer = 'L2'
    else if (cumulative <= L3) layer = 'L3'
    else layer = 'ARCHIVE'
    out.unshift({ stamp: b.stamp, status: b.status, msgs: b.msgs, bytes, layer, cumulative })
  }
  return out
}

async function run() {
  let failures = 0
  const fail = (msg) => {
    console.error(`  FAIL: ${msg}`)
    failures++
  }
  const pass = (msg) => console.log(`  ok: ${msg}`)

  console.log('=== 集成测试 ===\n')

  // 构造会话：交替 user/assistant，总量跨过 712K 以产生 ARCHIVE
  const sizes = [90, 90, 90, 90, 90, 90, 90, 90, 60, 60, 40, 40]
  const messages = sizes.map((kb, i) =>
    mkMsg(i % 2 === 0 ? 'user' : 'assistant', kb, i + 1)
  )
  const totalKB = sizes.reduce((a, b) => a + b, 0)
  console.log(`输入 ${messages.length} 条消息，约 ${totalKB}KB\n`)

  // 1. 任务块检测
  console.log('[1] 任务块检测')
  const raw = detectTaskBlocks(messages, { l0Count: 999 })
  if (!raw.length) {
    fail('detectTaskBlocks 返回空')
    return failures
  }
  pass(`检测到 ${raw.length} 个任务块`)

  // 2. 分层
  console.log('\n[2] 按累计字节分层')
  const blocks = classify(raw)
  const counts = blocks.reduce((acc, b) => {
    acc[b.layer] = (acc[b.layer] || 0) + 1
    return acc
  }, {})
  for (const b of blocks) {
    console.log(
      `    ${b.stamp.slice(0, 8)}  ${b.layer.padEnd(7)} ` +
        `块 ${(b.bytes / 1024).toFixed(0).padStart(4)}KB  累计 ${(b.cumulative / 1024).toFixed(0).padStart(4)}KB`
    )
  }
  console.log(`    分布: ${JSON.stringify(counts)}`)

  const l0Count = blocks.filter((b) => b.layer === 'L0').length
  if (l0Count === Math.min(L0_ROUNDS, blocks.length)) pass(`L0 保留最近 ${l0Count} 块`)
  else fail(`L0 应为 ${Math.min(L0_ROUNDS, blocks.length)} 块，实际 ${l0Count}`)

  // 单调性：越靠前的块层级不应更"浅"
  const order = { L0: 0, L1: 1, L2: 2, L3: 3, ARCHIVE: 4 }
  const nonL0 = blocks.filter((b) => b.layer !== 'L0')
  const monotonic = nonL0.every(
    (b, i) => i === 0 || order[nonL0[i - 1].layer] >= order[b.layer]
  )
  if (monotonic) pass('层级随时间单调（早期不浅于晚期）')
  else fail('层级非单调，分层逻辑有误')

  // 边界校验
  const bad = blocks.find(
    (b) =>
      (b.layer === 'L1' && b.cumulative > L1) ||
      (b.layer === 'L2' && b.cumulative > L2) ||
      (b.layer === 'L3' && b.cumulative > L3) ||
      (b.layer === 'ARCHIVE' && b.cumulative <= L3)
  )
  if (bad) fail(`${bad.stamp.slice(0, 8)} 层级 ${bad.layer} 与累计 ${(bad.cumulative / 1024).toFixed(0)}KB 不符`)
  else pass('所有块符合 200K/384K/712K 边界')

  // 3. StampStore：模拟 pipeline 的写入
  console.log('\n[3] StampStore 存储')
  const store = new StampStore()
  for (const b of blocks) {
    store.add(b.stamp, b.msgs, `summary of ${b.stamp}`, b.status, {
      layer: b.layer,
      bytes: b.bytes,
    })
  }
  if (store.size === blocks.length) pass(`存入 ${store.size} 块（size 是 getter）`)
  else fail(`应存 ${blocks.length} 块，实际 ${store.size}`)

  const sample = blocks[0]
  const entry = store.get(sample.stamp)
  if (entry && entry.meta.layer === sample.layer) pass('get() 可取回，meta.layer 正确')
  else fail('get() 取回失败或 meta.layer 丢失')

  if (entry && entry.fullMessages.length === sample.msgs.length) pass('fullMessages 无损保存')
  else fail('fullMessages 数量不符，原文有损')

  // 4. 归档区可被 searchArchived 发现
  console.log('\n[4] 远古区检索')
  const archived = blocks.filter((b) => b.layer === 'ARCHIVE')
  if (archived.length) {
    const hits = store.searchArchived('Message', { maxCandidates: 5 })
    if (hits.length) pass(`searchArchived 命中 ${hits.length} 个归档块`)
    else fail('存在归档块但 searchArchived 返回空')
  } else {
    console.log('  skip: 本次输入未产生 ARCHIVE 块')
  }

  // 5. 召回作用域校验（不发网络请求：只测前置校验分支）
  console.log('\n[5] 召回作用域校验')

  const missing = await recallByStamp(store, { stamp: 'deadbeef', question: 'q' })
  if (missing.ok === false && /未找到戳/.test(missing.error)) pass('未知戳被拒绝（返回 ok:false）')
  else fail(`未知戳应返回 ok:false，实际 ${JSON.stringify(missing).slice(0, 120)}`)

  const noQuestion = await recallByStamp(store, { stamp: sample.stamp, question: '' })
  if (noQuestion.ok === false && /缺少问题/.test(noQuestion.error)) pass('空问题被拒绝')
  else fail('空问题应被拒绝')

  if (archived.length) {
    const wrongScope = await recallByStamp(store, {
      stamp: archived[0].stamp,
      question: 'q',
      searchScope: 'compressed',
    })
    if (wrongScope.ok === false && /远古区/.test(wrongScope.error)) {
      pass("归档块在 searchScope='compressed' 下被正确拒绝")
    } else {
      fail("归档块应拒绝 searchScope='compressed'")
    }
  }

  const compressed = blocks.find((b) => b.layer === 'L1' || b.layer === 'L2' || b.layer === 'L3')
  if (compressed) {
    const wrongScope2 = await recallByStamp(store, {
      stamp: compressed.stamp,
      question: 'q',
      searchScope: 'archive',
    })
    if (wrongScope2.ok === false && /不在远古区/.test(wrongScope2.error)) {
      pass("压缩块在 searchScope='archive' 下被正确拒绝")
    } else {
      fail("压缩块应拒绝 searchScope='archive'")
    }
  }

  console.log(
    `\n=== ${failures === 0 ? '全部通过' : `${failures} 项失败`} ===`
  )
  return failures
}

run()
  .then((f) => process.exit(f === 0 ? 0 : 1))
  .catch((e) => {
    console.error('测试异常:', e)
    process.exit(1)
  })
