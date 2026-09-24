/**
 * StampStore — 戳→全文映射（替代 RAG 向量库）
 *
 * 核心思想：不再用 BGE 向量化+余弦搜索（大海捞针），
 * 而是按任务块生成戳（stamp），压缩时建立 戳→原始全文 的映射，
 * 模型按戳精确取回，100% 命中。
 *
 * 用法：
 *   const store = new StampStore();
 *   store.add(stamp, blockMsgs, summary, status);
 *   const block = store.get(stamp);        // 精确取回
 *   const pending = store.listPending();    // 列出所有未完成任务
 *   store.clear();                          // 清空
 */
// 见 sha256.js：渲染进程没有 Node crypto，用纯 JS 同步实现保证两侧戳一致
const { sha256Hex } = require('./sha256.js');

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content.map(item => {
    if (!item) return '';
    if (item.type === 'text') return item.text || '';
    if (item.type === 'tool_use') return `工具调用 ${item.name || 'tool'} ${JSON.stringify(item.input || {})}`;
    if (item.type === 'tool_result') return typeof item.content === 'string' ? item.content : JSON.stringify(item.content || '');
    return JSON.stringify(item);
  }).filter(Boolean).join('\n');
}

function queryTerms(query) {
  const matches = String(query || '').toLowerCase().match(/[a-z_][a-z0-9_./:-]*|\d+(?:\.\d+)?|[\u4e00-\u9fff]{2,}/g) || [];
  const terms = new Set(matches.filter(term => term.length >= 2));
  for (const match of matches) {
    if (!/^[\u4e00-\u9fff]+$/.test(match)) continue;
    for (let index = 0; index < match.length - 1; index++) {
      terms.add(match.slice(index, index + 2));
    }
  }
  return [...terms];
}

function splitText(text, maxChars = 1800, overlap = 180) {
  const source = String(text || '').trim();
  if (!source) return [];
  if (source.length <= maxChars) return [source];
  const parts = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + maxChars);
    if (end < source.length) {
      const breakAt = Math.max(
        source.lastIndexOf('\n', end),
        source.lastIndexOf('。', end),
        source.lastIndexOf(';', end)
      );
      if (breakAt > start + Math.floor(maxChars * 0.55)) end = breakAt + 1;
    }
    parts.push(source.slice(start, end));
    if (end >= source.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return parts;
}

function scoreSegment(text, terms) {
  const source = String(text || '').toLowerCase();
  let score = 0;
  for (const term of terms) {
    let index = source.indexOf(term);
    while (index !== -1) {
      score += term.length >= 6 ? 6 : 3;
      index = source.indexOf(term, index + term.length);
    }
  }
  return score;
}

function segmentsForEntry(entry, options = {}) {
  const segments = [];
  (entry?.fullMessages || []).forEach((message, messageIndex) => {
    const text = contentToText(message.content);
    splitText(text, options.segmentChars || 1800, options.overlap || 180).forEach((part, partIndex) => {
      segments.push({ messageIndex, partIndex, role: message.role, text: part });
    });
  });
  return segments;
}

function taskTitle(entry, limit = 96) {
  const firstUser = (entry?.fullMessages || []).find(message => message?.role === 'user');
  const source = contentToText(firstUser?.content).replace(/\s+/g, ' ').trim();
  return source.length > limit ? `${source.slice(0, limit)}...` : (source || '未命名任务');
}

class StampStore {
  constructor() {
    this._map = new Map();
  }

  /**
   * 基于任务块内容生成戳（sha256 前 12 位）
   * @param {Array<object>} blockMsgs 任务块的消息数组
   * @returns {string} 12 位十六进制戳
   */
  static generateStamp(blockMsgs) {
    return sha256Hex(JSON.stringify(blockMsgs)).slice(0, 12);
  }

  /**
   * 添加或更新一个任务块。
   *
   * 戳基于任务块身份（序号 + 首条用户消息），块推进时戳不变，因此这里必须
   * 用新内容覆盖旧快照——否则一个 20 轮的任务块只会留下第 1 轮的原文，
   * 召回拿到的是残缺历史。
   *
   * @param {string} stamp 戳
   * @param {Array<object>} fullMessages 该任务块的完整原始消息
   * @param {string} summary 压缩后的摘要（含 #STAMP / #TASK / #ACTION / #ANSWER / #STATUS）
   * @param {string} status 'pending' | 'done'
   * @param {object} meta 附加元数据（可选）
   */
  add(stamp, fullMessages, summary, status = 'pending', meta = {}) {
    const existing = this._map.get(stamp);
    if (existing) {
      // 只在内容确实增长时覆盖：避免上游用同一戳传入更短的快照造成回退
      if (fullMessages.length >= existing.fullMessages.length) {
        existing.fullMessages = fullMessages.slice();
        existing.summary = summary;
        existing.meta = { ...existing.meta, ...meta };
        existing.updatedAt = Date.now();
      }
      // status 不降级：done 不回退成 pending
      if (status === 'done' || existing.status === 'pending') {
        existing.status = status;
      }
      return;
    }
    this._map.set(stamp, {
      stamp,
      fullMessages: fullMessages.slice(),  // 完整原始消息（无损）
      summary,
      status,
      meta,
      createdAt: Date.now()
    });
  }

  /**
   * 按戳精确取回完整消息
   * @param {string} stamp
   * @returns {object|null} { stamp, fullMessages, summary, status, meta }
   */
  get(stamp) {
    return this._map.get(stamp) || null;
  }

  /**
   * 按任务戳在单个完整任务块内定位相关片段。
   * 这是两阶段精确召回：L3 先给出戳，再在该戳的原文中按 query 选片段；
   * 只有模型明确要求 full 时才返回整块，避免把无关工具输出重新塞回上下文。
   */
  retrieve(stamp, options = {}) {
    const entry = this.get(stamp);
    if (!entry) return null;
    const mode = options.mode === 'full' ? 'full' : 'relevant';
    const query = String(options.query || '');
    if (mode === 'full') {
      return {
        stamp,
        mode,
        found: true,
        content: entry.fullMessages.map(message => JSON.stringify(message)).join('\n'),
        segments: entry.fullMessages.length
      };
    }

    const terms = queryTerms(query);
    const segments = segmentsForEntry(entry, options).map(segment => ({ ...segment, score: scoreSegment(segment.text, terms) }));
    const maxSegments = Math.max(1, Math.min(options.maxSegments || 4, 8));
    const selected = segments
      .sort((left, right) => right.score - left.score || left.messageIndex - right.messageIndex || left.partIndex - right.partIndex)
      .slice(0, maxSegments)
      .sort((left, right) => left.messageIndex - right.messageIndex || left.partIndex - right.partIndex);
    const fallback = selected.length && selected.every(segment => segment.score === 0)
      ? segments.slice(0, maxSegments)
      : selected;
    const content = fallback.map(segment => [
      `[STAMP:${stamp}][MESSAGE:${segment.messageIndex}][PART:${segment.partIndex}][ROLE:${segment.role}]`,
      segment.text
    ].join('\n')).join('\n\n');
    return { stamp, mode, found: true, content, segments: fallback.length, query };
  }

  /** 返回指定戳内可供召回子智能体读取的结构化片段。 */
  searchSegments(stamp, query, options = {}) {
    const entry = this.get(stamp);
    if (!entry) return null;
    const terms = queryTerms(query);
    const maxSegments = Math.max(1, Math.min(options.maxSegments || 6, 12));
    const all = segmentsForEntry(entry, options).map(segment => ({ ...segment, score: scoreSegment(segment.text, terms) }));
    const ranked = all
      .sort((left, right) => right.score - left.score || left.messageIndex - right.messageIndex || left.partIndex - right.partIndex);
    const selected = ranked.some(segment => segment.score > 0) ? ranked.slice(0, maxSegments) : all.slice(0, maxSegments);
    return selected.sort((left, right) => left.messageIndex - right.messageIndex || left.partIndex - right.partIndex);
  }

  /** 读取指定戳内的单个片段，不暴露其他任务块。 */
  readSegment(stamp, messageIndex, partIndex, options = {}) {
    const entry = this.get(stamp);
    if (!entry) return null;
    return segmentsForEntry(entry, options).find(segment =>
      segment.messageIndex === Number(messageIndex) && segment.partIndex === Number(partIndex)
    ) || null;
  }

  /**
   * 在当前窗口之外的归档任务中找少量候选标识。该方法只读取归档原文进行本地评分，
   * 返回内容不包含任何归档正文；主模型必须再通过 retrieve_by_stamp 取得最小证据包。
   */
  searchArchived(query, options = {}) {
    const terms = queryTerms(query);
    if (!terms.length) return [];
    const allowed = Array.isArray(options.archivedStamps) && options.archivedStamps.length
      ? new Set(options.archivedStamps)
      : null;
    const excluded = new Set(options.excludedStamps || []);
    const maxCandidates = Math.max(1, Math.min(Number(options.maxCandidates || 3), 5));
    const candidates = [];
    for (const entry of this._map.values()) {
      if (allowed ? !allowed.has(entry.stamp) : entry.meta?.layer !== 'ARCHIVE') continue;
      if (excluded.has(entry.stamp)) continue;
      const title = taskTitle(entry);
      const source = [title, entry.summary || '', ...(entry.fullMessages || []).map(message => contentToText(message.content))].join('\n');
      const score = scoreSegment(source, terms);
      if (score <= 0) continue;
      const matchedTerms = terms.filter(term => String(source).toLowerCase().includes(term)).slice(0, 4);
      candidates.push({
        stamp: entry.stamp,
        status: entry.status,
        title,
        score,
        relevance: `命中关键词：${matchedTerms.join('、')}`
      });
    }
    return candidates
      .sort((left, right) => right.score - left.score || right.stamp.localeCompare(left.stamp))
      .slice(0, maxCandidates)
      .map(({ score, ...candidate }) => candidate);
  }

  /**
   * 更新任务状态
   * @param {string} stamp
   * @param {string} status 'done' | 'pending'
   */
  setStatus(stamp, status) {
    const entry = this._map.get(stamp);
    if (entry) {
      entry.status = status;
      return true;
    }
    return false;
  }

  /**
   * 列出所有未完成任务
   * @returns {Array<{stamp, summary, meta}>}
   */
  listPending() {
    const result = [];
    for (const entry of this._map.values()) {
      if (entry.status === 'pending') {
        result.push({
          stamp: entry.stamp,
          summary: entry.summary,
          meta: entry.meta
        });
      }
    }
    return result;
  }

  /**
   * 列出所有已完成任务
   * @returns {Array<{stamp, summary, meta}>}
   */
  listDone() {
    const result = [];
    for (const entry of this._map.values()) {
      if (entry.status === 'done') {
        result.push({
          stamp: entry.stamp,
          summary: entry.summary,
          meta: entry.meta
        });
      }
    }
    return result;
  }

  /**
   * 获取所有任务摘要（用于发送给上游模型）
   * @returns {string} 所有任务的摘要文本
   */
  getAllSummaries() {
    const lines = [];
    for (const entry of this._map.values()) {
      lines.push(entry.summary);
    }
    return lines.join('\n\n');
  }

  /**
   * 删除一个任务块
   * @param {string} stamp
   */
  delete(stamp) {
    return this._map.delete(stamp);
  }

  /**
   * 清空所有
   */
  clear() {
    this._map.clear();
  }

  /**
   * 获取总数
   */
  get size() {
    return this._map.size;
  }

  /**
   * 获取所有戳
   * @returns {string[]}
   */
  stamps() {
    return Array.from(this._map.keys());
  }
}

module.exports = { StampStore, contentToText, splitText, queryTerms };
